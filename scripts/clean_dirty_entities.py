import re
import sys
import os
from typing import Optional

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlmodel import Session, select, text
from app.db.session import engine
from app.models.entidade import Entidade
from app.models.lancamento import Lancamento

# List of generic banking/noise patterns that shouldn't be actual entities
GENERIC_NOISE_PATTERNS = [
    r"(?i)^dep\s+dinheiro",
    r"(?i)^seguro\s+itauempresa",
    r"(?i)^tar\s+plano",
    r"(?i)^tarifa",
    r"(?i)^pix\s*-\s*enviado",
    r"(?i)^pix\s*-\s*recebido",
    r"(?i)^transfer[êe]ncia\s+recebida",
    r"(?i)^tar\s+",
]

def is_dirty_date_name(nome: Optional[str]) -> bool:
    if not nome:
        return False
    temp = re.sub(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}", "", nome)
    temp = re.sub(r"\d{3}\.\d{3}\.\d{3}-\d{2}", "", temp)
    temp = re.sub(r"/\d{4}-\d{2}", "", temp)
    return bool(re.search(r"[a-zA-Z]*\d{1,2}[/-]\d{1,2}\b", temp))

def clean_entity_name(name: str) -> str:
    # 1. Clean prefix noise
    name = re.sub(r"(?i)^(?:Pix\s*-\s*(?:Enviado|Recebido)\s*-\s*\d{1,2}[/-]\d{1,2}\s*\d{2}:\d{2}\s*)", "", name)
    name = re.sub(r"(?i)^(?:Pix\s*-\s*(?:Enviado|Recebido)\s*-\s*\d{1,2}[/-]\d{1,2}\s*)", "", name)
    name = re.sub(r"(?i)^(?:Pix\s*Qr\s*Code\s*Recebido\s*)", "", name)
    name = re.sub(r"(?i)^(?:Transfer[êe]ncia\s*Recebida\s*-\s*\d{1,2}[/-]\d{1,2}\s*\d{2}:\d{2}\s*)", "", name)
    
    # 2. Check if name contains a date pattern after stripping document noise
    temp = re.sub(r"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}", "", name)
    temp = re.sub(r"\d{3}\.\d{3}\.\d{3}-\d{2}", "", temp)
    temp = re.sub(r"/\d{4}-\d{2}", "", temp)
    
    match = re.search(r"[a-zA-Z]*\d{1,2}[/-]\d{1,2}\b", temp)
    if match:
        start, end = match.span()
        prefix = temp[:start].strip()
        suffix = temp[end:].strip()
        
        if suffix.lower().startswith(prefix.lower()):
            clean = suffix
        elif len(suffix) > len(prefix):
            clean = suffix
        else:
            clean = prefix
    else:
        clean = temp

    # 3. Strip trailing CNPJ/CPF noise or truncated document numbers
    clean = re.sub(r"[\s\d./-]+\.?$", "", clean).strip()
    
    # 4. Clean multiple spaces
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean

def is_generic_noise(name: str) -> bool:
    for pattern in GENERIC_NOISE_PATTERNS:
        if re.search(pattern, name):
            return True
    return False

def run_cleanup(dry_run: bool = True):
    print(f"--- RUNNING ENTITY CLEANUP (DRY_RUN={dry_run}) ---")
    with Session(engine) as session:
        # Fetch all active, non-deleted entities
        stmt = select(Entidade).where(
            Entidade.is_deleted == False,
            Entidade.status == "ATIVO"
        )
        entities = session.exec(stmt).all()
        print(f"Total active entities in DB: {len(entities)}")

        dirty_count = 0
        cleaned_count = 0
        merged_count = 0
        inactivated_count = 0

        # Build a map of clean entities by (empresa_id, normalized_name) and (empresa_id, cpf_cnpj)
        # to quickly find potential merge targets.
        clean_by_name = {}
        clean_by_doc = {}

        for ent in entities:
            # Skip if it's dirty
            if is_dirty_date_name(ent.nome) or is_generic_noise(ent.nome):
                continue
            
            emp_id = ent.empresa_id
            norm_name = ent.nome.strip().lower()
            doc = re.sub(r"\D", "", ent.cpf_cnpj or "")
            
            if norm_name:
                clean_by_name[(emp_id, norm_name)] = ent
            if doc:
                clean_by_doc[(emp_id, doc)] = ent

        for ent in entities:
            if not (is_dirty_date_name(ent.nome) or is_generic_noise(ent.nome)):
                continue

            dirty_count += 1
            old_name = ent.nome
            
            # Check if generic noise
            if is_generic_noise(old_name):
                print(f"[INACTIVATE] ID {ent.id}: '{old_name}' (generic banking noise)")
                inactivated_count += 1
                if not dry_run:
                    ent.status = "INATIVO"
                    session.add(ent)
                continue

            clean_name = clean_entity_name(old_name)
            
            if not clean_name or len(clean_name) < 2:
                print(f"[INACTIVATE] ID {ent.id}: '{old_name}' -> cleaned name too short: '{clean_name}'")
                inactivated_count += 1
                if not dry_run:
                    ent.status = "INATIVO"
                    session.add(ent)
                continue

            emp_id = ent.empresa_id
            doc = re.sub(r"\D", "", ent.cpf_cnpj or "")
            
            # Check if there is a merge target
            merge_target = None
            if doc and (emp_id, doc) in clean_by_doc:
                merge_target = clean_by_doc[(emp_id, doc)]
            elif (emp_id, clean_name.lower()) in clean_by_name:
                merge_target = clean_by_name[(emp_id, clean_name.lower())]

            if merge_target and merge_target.id != ent.id:
                # Merge!
                print(f"[MERGE] ID {ent.id} '{old_name}' -> merge into ID {merge_target.id} '{merge_target.nome}'")
                merged_count += 1
                if not dry_run:
                    # Update transactions
                    session.execute(
                        text("UPDATE lancamentos SET entidade_id = :target_id WHERE entidade_id = :old_id"),
                        {"target_id": merge_target.id, "old_id": ent.id}
                    )
                    # Inactivate old entity
                    ent.status = "INATIVO"
                    ent.is_deleted = True
                    session.add(ent)
            else:
                # Rename / clean
                print(f"[RENAME] ID {ent.id}: '{old_name}' -> '{clean_name}'")
                cleaned_count += 1
                if not dry_run:
                    ent.nome = clean_name
                    session.add(ent)
                    # Add to cleanup maps to avoid duplicate creations later in the loop
                    clean_by_name[(emp_id, clean_name.lower())] = ent
                    if doc:
                        clean_by_doc[(emp_id, doc)] = ent

        if not dry_run:
            session.commit()
            print("Changes committed to database successfully.")
        else:
            print("Dry run finished. No changes were committed.")

        print(f"Summary:")
        print(f"  Dirty entities processed: {dirty_count}")
        print(f"  Renamed/Cleaned: {cleaned_count}")
        print(f"  Merged: {merged_count}")
        print(f"  Inactivated: {inactivated_count}")

if __name__ == "__main__":
    dry = True
    if len(sys.argv) > 1 and sys.argv[1].lower() == "apply":
        dry = False
    run_cleanup(dry_run=dry)
