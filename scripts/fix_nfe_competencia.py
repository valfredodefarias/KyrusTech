import os
import re
import sys
from datetime import date
from collections import Counter, defaultdict
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento

def get_nfe_key_year_month(key_or_id):
    # Extract 44 digits
    digits = re.sub(r"\D", "", key_or_id)
    if len(digits) == 44:
        yy = int(digits[2:4])
        mm = int(digits[4:6])
        return 2000 + yy, mm
    return None

def run_fix(dry_run: bool = True):
    print(f"--- RUNNING NFE COMPETENCE FIX (DRY_RUN={dry_run}) ---")
    with Session(engine) as session:
        stmt = select(Lancamento).where(
            Lancamento.origem == "NFE_XML",
            Lancamento.is_deleted == False
        )
        results = session.exec(stmt).all()
        
        groups = defaultdict(list)
        for l in results:
            groups[l.id_parcelamento].append(l)
            
        print(f"Total NFE groups found: {len(groups)}")
        
        to_fix = []
        
        for gid, launches in groups.items():
            ym = get_nfe_key_year_month(gid)
            if not ym:
                for l in launches:
                    ym = get_nfe_key_year_month(l.observacao or "")
                    if ym:
                        break
            
            if not ym:
                continue
                
            key_year, key_month = ym
            
            # Collect all data_competencia values that match the key's year and month
            matching_dates = [
                l.data_competencia 
                for l in launches 
                if l.data_competencia and l.data_competencia.year == key_year and l.data_competencia.month == key_month
            ]
            
            # Determine correct data_competencia
            if matching_dates:
                correct_date = Counter(matching_dates).most_common(1)[0][0]
            else:
                correct_date = date(key_year, key_month, 1)
                
            correct_competencia_str = f"{correct_date.month:02d}-{correct_date.year}"
            
            for l in launches:
                needs_fix = False
                reasons = []
                
                if l.data_competencia != correct_date:
                    needs_fix = True
                    reasons.append(f"data_competencia: {l.data_competencia} -> {correct_date}")
                    
                if l.competencia != correct_competencia_str:
                    needs_fix = True
                    reasons.append(f"competencia: {l.competencia} -> {correct_competencia_str}")
                    
                if needs_fix:
                    to_fix.append((l, correct_date, correct_competencia_str, reasons))
                    
        print(f"Launches needing correction: {len(to_fix)}")
        
        if not dry_run:
            print("Applying changes to database...")
            for l, new_date, new_comp, _ in to_fix:
                l.data_competencia = new_date
                l.competencia = new_comp
                session.add(l)
            session.commit()
            print("Changes committed to database successfully.")
        else:
            for l, _, _, reasons in to_fix[:20]:
                print(f"  [DRY RUN] Launch ID {l.id} ({l.descricao}): reasons={reasons}")
            if len(to_fix) > 20:
                print(f"  ... and {len(to_fix) - 20} more launches.")
            print("Dry run finished. No changes were committed to database.")

if __name__ == "__main__":
    dry = True
    if len(sys.argv) > 1 and sys.argv[1].lower() == "apply":
        dry = False
    run_fix(dry_run=dry)
