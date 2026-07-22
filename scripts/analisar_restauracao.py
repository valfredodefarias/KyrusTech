from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.conta import Conta
from decimal import Decimal

def run():
    session = Session(engine)
    
    # Contas de Pizza Fábio
    contas = [324, 325, 326, 331, 334, 330, 329, 328, 337]
    
    print("=== ANÁLISE DE LANÇAMENTOS RESTAURADOS ===")
    
    for cid in contas:
        conta = session.get(Conta, cid)
        if not conta:
            continue
            
        # Lançamentos WEB ativos nessa conta
        launches = session.exec(
            select(Lancamento)
            .where(
                Lancamento.conta_id == cid,
                Lancamento.origem == "WEB",
                Lancamento.is_deleted == False
            )
        ).all()
        
        limpeza_massa_count = 0
        limpeza_massa_sum = Decimal("0.00")
        
        outros_restaurados_count = 0
        outros_restaurados_sum = Decimal("0.00")
        
        for l in launches:
            obs = l.observacao or ""
            val = Decimal(str(l.valor_pago or l.valor_previsto or 0))
            
            if "DUPLICADO DELETADO EM LIMPEZA EM MASSA" in obs:
                limpeza_massa_count += 1
                limpeza_massa_sum += val
            elif "Importação Financeiro - Legado" in obs:
                # Foi restaurado por nós, mas não tinha o prefixo de limpeza em massa!
                # Isso significa que já estava deletado antes!
                outros_restaurados_count += 1
                outros_restaurados_sum += val
                
        if outros_restaurados_count > 0 or limpeza_massa_count > 0:
            print(f"\nConta '{conta.nome}' (ID: {cid}):")
            print(f"  - Deletados pela Limpeza em Massa (Corretos): {limpeza_massa_count} lançamentos | Total: R$ {limpeza_massa_sum:,.2f}")
            print(f"  - Outros Restaurados (Já estavam deletados antes!): {outros_restaurados_count} lançamentos | Total: R$ {outros_restaurados_sum:,.2f}")

if __name__ == "__main__":
    run()
