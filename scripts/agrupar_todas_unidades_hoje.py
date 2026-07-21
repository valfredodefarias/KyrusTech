import json
from decimal import Decimal
from datetime import datetime, date
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.entidade import Entidade
from app.models.empresa import Empresa
from app.services.pdv_service import (
    obter_regra_cartao,
    adicionar_ou_atualizar_recebivel_cartao_agrupado,
    format_card_description,
    calcular_payout_date
)

def run():
    session = Session(engine)
    
    # 1. Lista de IDs das empresas da Pizza Fábio
    EMPRESAS_IDS = [35, 37, 39, 40]
    
    total_grouped = 0
    for emp_id in EMPRESAS_IDS:
        emp = session.get(Empresa, emp_id)
        if not emp:
            continue
            
        business_name = getattr(emp, 'razao_social', None) or getattr(emp, 'nome_fantasia', None) or f"Empresa {emp_id}"
        print(f"\n>>> Processando unidade: {business_name} (ID: {emp_id})")
        
        # Obter ou criar "Recebimento Cartões" para a empresa
        entidade = session.exec(
            select(Entidade)
            .where(
                Entidade.empresa_id == emp_id,
                Entidade.nome == "Recebimento Cartões"
            )
        ).first()
        
        if not entidade:
            entidade = Entidade(
                nome="Recebimento Cartões",
                empresa_id=emp_id,
                tipo="AMBOS",
                tipo_pessoa="PJ",
                status="ATIVO"
            )
            session.add(entidade)
            session.flush()
        
        # Buscar lançamentos individuais de cartão de hoje (Crédito ou Débito) que não foram deletados
        lances = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == emp_id,
                Lancamento.data_vencimento == '2026-07-21',
                Lancamento.is_deleted == False,
                Lancamento.origem == 'PDV'
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
                    
            # Identificar tipo de pagamento por categoria se não estiver na observação
            if not tipo_pagamento:
                if l.plano_contas_id == 6203:
                    tipo_pagamento = "cartao_credito_vista"
                elif l.plano_contas_id == 6204:
                    tipo_pagamento = "cartao_debito"
                else:
                    continue
                    
            # Apenas processar cartões à vista ou débito (que devem ser agrupados)
            if tipo_pagamento not in ["cartao_debito", "cartao_credito_vista"]:
                continue
                
            # Buscar regra de cartão
            regra = obter_regra_cartao(session, emp_id, tipo_pagamento, bandeira, l.centro_custo_id)
            
            # Calcular data de vencimento correta
            hoje_pag = l.data_competencia or date(2026, 7, 21)
            vencimento = l.data_vencimento
                
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
                    
            venda_key = l.id_parcelamento if l.id_parcelamento else f"L-{l.id}"
            
            # Adicionar ao agrupado
            adicionar_ou_atualizar_recebivel_cartao_agrupado(
                db=session,
                empresa_id=emp_id,
                venda_id=venda_key,
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
            total_grouped += 1
            
        print(f"-> {grouped_count} lançamentos individuais consolidados com sucesso.")
        
    session.commit()
    print(f"\nConcluído! Total de {total_grouped} lançamentos consolidados em todas as unidades Pizza Fábio.")

if __name__ == "__main__":
    run()
