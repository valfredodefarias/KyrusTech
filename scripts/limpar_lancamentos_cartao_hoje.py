import json
from datetime import datetime
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.empresa import Empresa

def run():
    session = Session(engine)
    
    EMPRESAS_IDS = [35, 37, 39, 40]
    total_cleaned = 0
    
    for emp_id in EMPRESAS_IDS:
        emp = session.get(Empresa, emp_id)
        if not emp:
            continue
            
        business_name = getattr(emp, 'razao_social', None) or getattr(emp, 'nome_fantasia', None) or f"Empresa {emp_id}"
        
        # Buscar lançamentos de cartão (individuais ou agrupados) de hoje que estão ativos
        lances = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == emp_id,
                Lancamento.data_vencimento == '2026-07-21',
                Lancamento.is_deleted == False,
                Lancamento.origem == 'PDV'
            )
        ).all()
        
        cleaned_count = 0
        for l in lances:
            l.is_deleted = True
            l.deleted_at = datetime.utcnow()
            session.add(l)
            cleaned_count += 1
            total_cleaned += 1
            
        print(f"Unidade: {business_name} (ID: {emp_id}) -> {cleaned_count} lançamentos de hoje arquivados/excluídos.")
        
    session.commit()
    print(f"\nSucesso! Total de {total_cleaned} lançamentos de cartão de hoje foram arquivados para todas as unidades da Pizza Fábio.")

if __name__ == "__main__":
    run()
