from sqlmodel import Session, select, or_
from app.db.session import engine
from app.models.lancamento import Lancamento
from collections import defaultdict
from decimal import Decimal

def run():
    session = Session(engine)
    
    EMPRESAS_IDS = [35, 37, 39, 40]
    
    for emp_id in EMPRESAS_IDS:
        print(f"\n>>> Investigando duplicatas para Empresa ID: {emp_id}")
        
        # Buscar todas as receitas ativas
        launches = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == emp_id,
                Lancamento.tipo == "RECEITA",
                Lancamento.is_deleted == False
            )
        ).all()
        
        print(f"Total de receitas ativas: {len(launches)}")
        
        # Agrupar por (data, valor)
        groups = defaultdict(list)
        for l in launches:
            groups[(l.data_vencimento, round(float(l.valor_previsto), 2))].append(l)
            
        duplicates = []
        for (dt, val), items in groups.items():
            if len(items) > 1:
                # Verificar se temos tanto origem='PDV' quanto origem='WEB' no mesmo grupo
                origins = {l.origem for l in items}
                if "PDV" in origins and "WEB" in origins:
                    duplicates.append(((dt, val), items))
                    
        print(f"Encontrados {len(duplicates)} grupos de potencial duplicidade (mesma data, mesmo valor, origens PDV e WEB)")
        
        # Mostrar os primeiros 5 grupos de duplicatas
        for (dt, val), items in duplicates[:5]:
            print(f"\n  Data: {dt} | Valor: R$ {val:.2f}")
            for l in items:
                print(f"    ID: {l.id} | Origem: {l.origem} | Desc: {l.descricao} | Obs: {l.observacao} | Status: {l.status}")
                
if __name__ == "__main__":
    run()
