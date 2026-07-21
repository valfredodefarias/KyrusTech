from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from datetime import date

def run():
    session = Session(engine)
    
    # Umarizal (35) - Jan/2026
    start = date(2026, 1, 1)
    end = date(2026, 1, 31)
    
    # Buscar lançamentos de receita da Empresa 35 em Jan/2026
    launches = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.tipo == "RECEITA",
            Lancamento.data_vencimento >= start,
            Lancamento.data_vencimento <= end
        )
    ).all()
    
    print("=== ANÁLISE DETALHADA WEB VS PDV JANEIRO/2026 ===")
    
    web_launches = [l for l in launches if l.origem == "WEB"]
    pdv_launches = [l for l in launches if l.origem == "PDV"]
    
    print(f"Total WEB: {len(web_launches)} (Ativos: {len([l for l in web_launches if not l.is_deleted])}, Deletados: {len([l for l in web_launches if l.is_deleted])})")
    print(f"Total PDV: {len(pdv_launches)} (Ativos: {len([l for l in pdv_launches if not l.is_deleted])})")
    
    # Vamos listar os lançamentos WEB (ativos e deletados) ordenados por data e valor
    print("\n--- Lançamentos WEB em Jan/2026 ---")
    for l in sorted(web_launches, key=lambda x: (x.data_vencimento, x.valor_previsto))[:30]:
        status_str = "DELETADO" if l.is_deleted else "ATIVO"
        print(f"  [{status_str}] Data: {l.data_vencimento} | Valor: R$ {l.valor_previsto:<8.2f} | Desc: '{l.descricao}' | Obs: '{l.observacao}'")

if __name__ == "__main__":
    run()
