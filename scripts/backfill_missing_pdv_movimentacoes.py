# scripts/backfill_missing_pdv_movimentacoes.py
import json
from datetime import datetime
from sqlmodel import Session, select
from app.db.session import engine
from app.models import PdvVenda, PdvMovimentacao, Lancamento

def run_backfill():
    with Session(engine) as session:
        vendas = session.exec(select(PdvVenda).where(PdvVenda.is_deleted == False)).all()
        created_count = 0
        
        for v in vendas:
            # Check if PdvMovimentacao already exists for this venda_id
            existing_movs = session.exec(
                select(PdvMovimentacao).where(PdvMovimentacao.venda_id == v.id, PdvMovimentacao.is_deleted == False)
            ).all()
            
            if not existing_movs:
                # Find associated lancamentos
                lancamentos = session.exec(
                    select(Lancamento).where(Lancamento.id_parcelamento == v.id, Lancamento.is_deleted == False)
                ).all()
                
                for l in lancamentos:
                    forma_pag = "DINHEIRO"
                    if l.observacao:
                        try:
                            meta = json.loads(l.observacao)
                            tp = (meta.get("tipo_pagamento") or "").upper()
                            if "PIX" in tp:
                                forma_pag = "PIX"
                            elif "DEBITO" in tp or "CARTAO_DEBITO" in tp:
                                forma_pag = "DEBITO"
                            elif "PARCELADO" in tp:
                                forma_pag = "CREDITO_PARCELADO"
                            elif "CREDITO" in tp or "VISTA" in tp:
                                forma_pag = "CREDITO_AVISTA"
                            elif "BOLETO" in tp:
                                forma_pag = "BOLETO"
                        except Exception:
                            pass
                    
                    mov = PdvMovimentacao(
                        empresa_id=l.empresa_id,
                        tipo="ENTRADA",
                        descricao=f"Venda PDV {v.id}",
                        valor=l.valor_previsto or l.valor_pago,
                        forma_pagamento=forma_pag,
                        bandeira="OUTROS",
                        parcelas=1,
                        numero_parcela=l.numero_parcela or 1,
                        data=l.data_competencia or l.data_vencimento,
                        centro_custo_id=l.centro_custo_id,
                        conta_id=l.conta_id,
                        conciliado=l.conciliado,
                        venda_id=v.id,
                        created_by_id=l.created_by_id or 1,
                        updated_by_id=l.updated_by_id or 1,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow()
                    )
                    session.add(mov)
                    created_count += 1
        
        session.commit()
        print(f"Backfill concluído: {created_count} movimentações PDV recuperadas para vendas sem movimentação.")

if __name__ == "__main__":
    run_backfill()
