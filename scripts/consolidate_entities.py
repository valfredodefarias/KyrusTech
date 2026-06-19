# scripts/consolidate_entities.py
import os
import sys
import re
import argparse
from sqlmodel import Session, select, text, create_engine
from typing import List, Dict, Optional, Tuple

# Set PYTHONPATH path
sys.path.append(os.getcwd())

from app.core.config import settings
from app.models.entidade import Entidade
from app.models.lancamento import Lancamento
from app.services.importacao_bancaria_service import _normalizar_nome_entidade, _normalizar_texto

def clean_entity_name(name: str) -> str:
    if not name:
        return ""
    # Use the official normalizer function from Kyrus importacao_bancaria_service
    cleaned = _normalizar_nome_entidade(name)
    if not cleaned:
        cleaned = name.strip()
    return cleaned

def main():
    parser = argparse.ArgumentParser(description="Consolidate duplicate and messy entities in the database.")
    parser.add_argument("--dry-run", action="store_true", help="Print changes without committing to the database.")
    args = parser.parse_args()

    database_url = str(settings.DATABASE_URL)
    engine = create_engine(database_url)

    print(f"Connecting to database: {settings.POSTGRES_SERVER}")
    
    with Session(engine) as session:
        # Fetch all entities
        entidades = session.exec(select(Entidade)).all()
        print(f"Total entities found in database: {len(entidades)}")

        # Group by company_id
        by_company: Dict[int, List[Entidade]] = {}
        for ent in entidades:
            by_company.setdefault(ent.empresa_id, []).append(ent)

        for empresa_id, group in by_company.items():
            print(f"\n--- Company ID: {empresa_id} (Entities: {len(group)}) ---")
            
            # Map of normalized cleaned name to list of entities
            # We also check for identical CPF/CNPJ if populated
            cleaned_map: Dict[str, List[Entidade]] = {}
            cpf_cnpj_map: Dict[str, List[Entidade]] = {}
            
            for ent in group:
                cleaned_name = clean_entity_name(ent.nome)
                norm_name = _normalizar_texto(cleaned_name)
                
                # Check for dirty/updated names
                if ent.nome != cleaned_name:
                    print(f"  Dirty entity name cleanup: ID {ent.id} | '{ent.nome}' -> '{cleaned_name}'")
                    if not args.dry_run:
                        ent.nome = cleaned_name
                        ent.nome_fantasia = clean_entity_name(ent.nome_fantasia) if ent.nome_fantasia else None
                        session.add(ent)
                
                if norm_name:
                    cleaned_map.setdefault(norm_name, []).append(ent)
                
                if ent.cpf_cnpj:
                    norm_cpf = re.sub(r"\D+", "", ent.cpf_cnpj)
                    if norm_cpf:
                        cpf_cnpj_map.setdefault(norm_cpf, []).append(ent)

            # Find duplicates to merge
            merges: Dict[int, int] = {} # Y (duplicate) -> X (master)
            
            # 1. Merge by cleaned name
            for norm_name, list_ent in cleaned_map.items():
                if len(list_ent) > 1:
                    # Determine master entity
                    # Master has the highest number of referencing lancamentos, fallback to smallest ID
                    candidates: List[Tuple[Entidade, int]] = []
                    for e in list_ent:
                        # Count referencing lancamentos
                        cnt = session.exec(
                            select(text("COUNT(*)")).select_from(text("lancamentos")).where(text("entidade_id = :eid")).params(eid=e.id)
                        ).first() or 0
                        candidates.append((e, cnt))
                    
                    # Sort candidates by:
                    # - lancamento count descending
                    # - ID ascending
                    candidates.sort(key=lambda item: (-item[1], item[0].id))
                    master = candidates[0][0]
                    
                    print(f"  Duplicate name group for '{norm_name}':")
                    print(f"    Master Chosen: ID {master.id} | '{master.nome}' ({candidates[0][1]} lancamentos)")
                    
                    for duplicate, cnt in candidates[1:]:
                        print(f"    Duplicate: ID {duplicate.id} | '{duplicate.nome}' ({cnt} lancamentos) -> Merging into {master.id}")
                        merges[duplicate.id] = master.id

            # 2. Merge by CPF/CNPJ (if not already merged)
            for cpf_cnpj, list_ent in cpf_cnpj_map.items():
                if len(list_ent) > 1:
                    # Ensure they are not already scheduled for different merges
                    candidates = []
                    for e in list_ent:
                        # Find the master if it's already merged, or itself
                        curr_id = e.id
                        while curr_id in merges:
                            curr_id = merges[curr_id]
                        
                        ent_obj = session.get(Entidade, curr_id)
                        if ent_obj and ent_obj not in [c[0] for c in candidates]:
                            cnt = session.exec(
                                select(text("COUNT(*)")).select_from(text("lancamentos")).where(text("entidade_id = :eid")).params(eid=ent_obj.id)
                            ).first() or 0
                            candidates.append((ent_obj, cnt))
                    
                    if len(candidates) > 1:
                        candidates.sort(key=lambda item: (-item[1], item[0].id))
                        master = candidates[0][0]
                        print(f"  Duplicate CPF/CNPJ group for '{cpf_cnpj}':")
                        print(f"    Master Chosen: ID {master.id} | '{master.nome}' ({candidates[0][1]} lancamentos)")
                        
                        for duplicate, cnt in candidates[1:]:
                            print(f"    Duplicate: ID {duplicate.id} | '{duplicate.nome}' ({cnt} lancamentos) -> Merging into {master.id}")
                            merges[duplicate.id] = master.id

            # Execute merges
            if merges:
                print(f"  Total merges to execute for Company {empresa_id}: {len(merges)}")
                for dup_id, master_id in merges.items():
                    # Update lancamentos
                    cnt_updated = 0
                    if not args.dry_run:
                        res = session.execute(
                            text("UPDATE lancamentos SET entidade_id = :master_id WHERE entidade_id = :dup_id"),
                            {"master_id": master_id, "dup_id": dup_id}
                        )
                        cnt_updated = res.rowcount
                        # Delete duplicate entity
                        dup_ent = session.get(Entidade, dup_id)
                        if dup_ent:
                            session.delete(dup_ent)
                    else:
                        cnt_raw = session.exec(
                            select(text("COUNT(*)")).select_from(text("lancamentos")).where(text("entidade_id = :eid")).params(eid=dup_id)
                        ).first() or 0
                        cnt_updated = cnt_raw
                        
                    print(f"    Merged ID {dup_id} -> {master_id} (Updated {cnt_updated} lancamentos)")

        if not args.dry_run:
            session.commit()
            print("\nDatabase changes committed successfully!")
        else:
            print("\nDry-run completed. No database changes were committed.")

if __name__ == "__main__":
    main()
