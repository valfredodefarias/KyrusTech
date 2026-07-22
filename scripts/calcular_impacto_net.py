from sqlmodel import Session, select, or_, not_
from app.db.session import engine
from app.models.conta import Conta
from app.models.lancamento import Lancamento
from decimal import Decimal

def run():
    session = Session(engine)
    
    # Contas de Pizza Fábio
    contas = [324, 325, 326, 331, 334, 330, 329, 328, 337]
    
    print("=== ANÁLISE DE IMPACTO NET DE LANÇAMENTOS RESTAURADOS INDESEJADOS ===")
    
    for cid in contas:
        conta = session.get(Conta, cid)
        if not conta:
            continue
            
        launches = session.exec(
            select(Lancamento)
            .where(
                Lancamento.conta_id == cid,
                Lancamento.origem == "WEB",
                Lancamento.is_deleted == False
            )
        ).all()
        
        net_impact = Decimal("0.00")
        count = 0
        
        for l in launches:
            obs = l.observacao or ""
            is_legacy = "importação financeiro" in obs.lower() or "importacao financeiro" in obs.lower()
            is_clean_up = "DUPLICADO DELETADO EM LIMPEZA EM MASSA" in obs
            
            # Se era legado e já estava deletado antes de nossa intervenção
            if is_legacy and not is_clean_up:
                val = Decimal(str(l.valor_pago if l.valor_pago is not None else 0))
                tipo = (l.tipo or "").strip().upper()
                if tipo.startswith("R"):
                    net_impact += val
                elif tipo.startswith("D"):
                    net_impact -= val
                count += 1
                
        print(f"\nConta '{conta.nome}' (ID: {cid}):")
        print(f"  - Lançamentos Indesejados Restaurados: {count}")
        print(f"  - Impacto Líquido (Net): R$ {net_impact:,.2f}")

if __name__ == "__main__":
    run()
