import json
from decimal import Decimal
from datetime import datetime, date
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.empresa import Empresa
from app.services.pdv_service import (
    obter_regra_cartao,
    adicionar_ou_atualizar_recebivel_cartao_agrupado,
    format_card_description,
    calcular_payout_date
)

def run():
    session = Session(engine)
    
    # 1. Obter config_categorias da empresa 35
    empresa = session.get(Empresa, 35)
    pdv_config_dict = {}
    if empresa and empresa.pdv_config:
        try:
            pdv_config_dict = json.loads(empresa.pdv_config)
        except:
            pass
            
    config_categorias = pdv_config_dict.get("categorias", {})
    plano_fallback_id = int(pdv_config_dict.get("pdv_sangria_entrada_plano_contas_id") or 6305)
    
    # 2. Buscar lançamentos individuais de cartão de hoje que ainda não foram agrupados
    lances = session.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 35,
            Lancamento.data_vencimento == '2026-07-21',
            Lancamento.is_deleted == False,
            Lancamento.origem == 'PDV',
            Lancamento.id_parcelamento != None
        )
    ).all()
    
    grouped_count = 0
    for l in lances:
        tipo_pagamento = None
        bandeira = "OUTROS"
        if l.observacao:
            try:
                meta = json.loads(l.observacao)
                tipo_pagamento = meta.get("tipo_pagamento")
                bandeira = meta.get("bandeira", "OUTROS")
            except:
                pass
                
        if not tipo_pagamento:
            continue
            
        # Apenas processar cartões à vista ou débito (que devem ser agrupados)
        if tipo_pagamento not in ["cartao_debito", "cartao_credito_vista"]:
            continue
            
        # Buscar regra de cartão
        regra = obter_regra_cartao(session, 35, tipo_pagamento, bandeira, l.centro_custo_id)
        
        # Calcular data de vencimento correta
        hoje_pag = l.data_competencia or date(2026, 7, 21)
        if regra:
            vencimento = calcular_payout_date(hoje_pag, regra)
        else:
            vencimento = hoje_pag
            
        bandeira_nome = (regra.bandeira if regra else bandeira) or "Outros"
        fmt_desc = format_card_description(bandeira_nome, tipo_pagamento)
        
        # Obter nomes para metadados
        vendedor_nome = "N/A"
        cliente_nome = "N/A"
        if l.observacao:
            try:
                meta = json.loads(l.observacao)
                cliente_nome = meta.get("cliente", "N/A")
            except:
                pass
                
        # Adicionar ao agrupado
        adicionar_ou_atualizar_recebivel_cartao_agrupado(
            db=session,
            empresa_id=35,
            venda_id=l.id_parcelamento,
            vencimento=vencimento,
            valor=l.valor_previsto,
            formatted_desc=fmt_desc,
            plano_id=l.plano_contas_id,
            conta_id=l.conta_id,
            centro_custo_id=l.centro_custo_id,
            hoje_pag=hoje_pag,
            bandeira=bandeira_nome,
            modality="Debito" if "debito" in fmt_desc.lower() else "Credito",
            current_user_id=l.updated_by_id or 1,
            venda_rv=l.descricao.split(" ")[1].replace("RV-", "") if "RV-" in l.descricao else "N/A",
            vendedor_nome=vendedor_nome,
            cliente_nome=cliente_nome
        )
        
        # Marcar lançamento individual antigo como deletado
        l.is_deleted = True
        l.deleted_at = datetime.utcnow()
        session.add(l)
        grouped_count += 1
        
    session.commit()
    print(f"Sucesso! {grouped_count} lançamentos individuais de cartão foram convertidos em lançamentos agrupados.")

if __name__ == "__main__":
    run()
