import os
import sys
import json
from decimal import Decimal

# Adiciona o diretório app ao PYTHONPATH
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.services.comissao_service import ComissaoService

with Session(engine) as db:
    for uid, name in [(11534, "Joel"), (11587, "Murillo")]:
        launches = db.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == 27,
                Lancamento.created_by_id == uid,
                Lancamento.is_deleted == False
            )
        ).all()
        
        total_gross = Decimal("0")
        boleto_aberto = Decimal("0")
        boleto_pago = Decimal("0")
        other_paid = Decimal("0")
        
        # Check competency month June 2026
        for l in launches:
            meta = {}
            if l.observacao:
                try:
                    meta = json.loads(l.observacao)
                except Exception:
                    pass
            pay_type = str(meta.get("tipo_pagamento", "")).lower()
            is_boleto = "boleto" in pay_type
            
            # Competency
            if l.data_competencia and l.data_competencia.month == 6 and l.data_competencia.year == 2026:
                total_gross += Decimal(str(l.valor_previsto or 0))
                if is_boleto:
                    if l.status == "PAGO":
                        boleto_pago += Decimal(str(l.valor_previsto or 0))
                    else:
                        boleto_aberto += Decimal(str(l.valor_previsto or 0))
                else:
                    other_paid += Decimal(str(l.valor_previsto or 0))
                    
        # Also compute via ComissaoService
        com_data = ComissaoService.calcular_comissoes_vendedor(db, uid, 6, 2026, 27)
        
        print(f"Vendedor: {name} ({uid})")
        print(f"  Total Gross (Competencia Junho 2026): {total_gross}")
        print(f"  Boleto Aberto (Competencia Junho 2026): {boleto_aberto}")
        print(f"  Boleto Pago (Competencia Junho 2026): {boleto_pago}")
        print(f"  Other Paid (Competencia Junho 2026): {other_paid}")
        print(f"  ComissaoService faturamento_meta: {com_data['faturamento_meta']}")
        print(f"  ComissaoService comissao_total: {com_data['comissao_total']}")
