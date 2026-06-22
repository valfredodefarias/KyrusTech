import os
import sys
import json
from pathlib import Path

# Add root dir to sys path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from sqlmodel import Session, create_engine, select
from app.core.config import settings
from app.models.lancamento import Lancamento
from app.services.comissao_service import ComissaoService

database_url = str(settings.DATABASE_URL)
engine = create_engine(database_url)

with Session(engine) as session:
    print("=== Erick (11877) Vendas em Junho/2026 ===")
    query = (
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 27,
            Lancamento.created_by_id == 11877,
            Lancamento.is_deleted == False,
            Lancamento.tipo == "RECEITA"
        )
    )
    launches = session.exec(query).all()
    print(f"Total launches: {len(launches)}")
    
    comp_total = 0
    cash_total = 0
    
    for l in launches:
        meta = {}
        if l.observacao:
            try:
                meta = json.loads(l.observacao)
            except:
                pass
        
        tipo_pag = str(meta.get("tipo_pagamento", "")).lower()
        is_boleto_parcelado = "boleto" in tipo_pag and (meta.get("total_parcelas", 1) > 1 or meta.get("numero_parcela") is not None)
        
        # Competence check
        is_comp = False
        if l.data_competencia and l.data_competencia.month == 6 and l.data_competencia.year == 2026:
            is_comp = True
            comp_total += l.valor_previsto
            
        # Cash check
        is_cash = False
        if is_boleto_parcelado:
            if l.status == "PAGO" and l.data_pagamento and l.data_pagamento.month == 6 and l.data_pagamento.year == 2026:
                is_cash = True
                cash_total += l.valor_previsto
        else:
            if l.data_competencia and l.data_competencia.month == 6 and l.data_competencia.year == 2026:
                is_cash = True
                cash_total += l.valor_previsto
                
        print(f"ID: {l.id} | Desc: {l.descricao} | Valor: {l.valor_previsto} | Status: {l.status} | Comp: {l.data_competencia} | Pag: {l.data_pagamento} | TipoPag: {tipo_pag} | CompMonth: {is_comp} | CashMonth: {is_cash}")
        
    print("\n--- Summary ---")
    print(f"Competence Total (June 2026): {comp_total}")
    print(f"Cash Total (June 2026): {cash_total}")
    
    # Let's run calcular_comissoes_vendedor for Erick
    com_vendedor = ComissaoService.calcular_comissoes_vendedor(session, 11877, 6, 2026, 27)
    print("\n=== Comissoes Vendedor Output ===")
    print(f"faturamento_meta: {com_vendedor['faturamento_meta']}")
    print(f"comissao_total: {com_vendedor['comissao_total']}")
    print(f"faturamento_produtos_total: {com_vendedor['faturamento_produtos_total']}")
    print(f"faturamento_servicos_total: {com_vendedor['faturamento_servicos_total']}")
    print(f"comissao_produtos: {com_vendedor['comissao_produtos']}")
    print(f"comissao_servicos: {com_vendedor['comissao_servicos']}")
