import sys
import os
import argparse
from pathlib import Path
from datetime import date, datetime
from decimal import Decimal
import json

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def main():
    parser = argparse.ArgumentParser(description="Relança e sincroniza no Financeiro a Agenda exata exibida na Conciliadora de Cartões.")
    parser.add_argument("--commit", action="store_true", help="Aplica as alteracoes no banco de dados.")
    parser.add_argument("--start-date", type=str, default="2026-07-29", help="Data inicial de vencimento (YYYY-MM-DD). Padrao: 2026-07-29.")
    args = parser.parse_args()

    filter_start_date = datetime.strptime(args.start_date, "%Y-%m-%d").date()

    from sqlmodel import Session, select, col
    from app.db.session import engine
    from app.models import Empresa, Lancamento, PdvMovimentacao, Entidade, PdvVenda, Usuario
    from app.services.pdv_service import format_card_description, obter_categoria_receita_pdv, obter_regra_cartao, calcular_payout_date, shift_months
    from datetime import timedelta

    pizzeria_ids = [35, 37, 39, 40]

    with Session(engine) as session:
        empresas = session.exec(select(Empresa).where(Empresa.id.in_(pizzeria_ids))).all()
        emp_names = {e.id: (getattr(e, 'nome_fantasia', None) or getattr(e, 'razao_social', None) or f"Empresa #{e.id}") for e in empresas}

        print("==========================================================================")
        print("RELANÇADOR AUTOMÁTICO DA AGENDA DA CONCILIADORA DE CARTÕES")
        print(f"Filtro de Exibição/Vencimento: {filter_start_date.strftime('%d/%m/%Y')} em diante")
        print("==========================================================================")
        print(f"Modo: {'⚠️ APLICAÇÃO REAL (--commit)' if args.commit else '🔍 SIMULAÇÃO (Dry Run - Use --commit para aplicar)'}\n")

        # 1. Buscar todas movimentações ativas de cartão no PDV
        query = (
            select(PdvMovimentacao)
            .where(
                PdvMovimentacao.empresa_id.in_(pizzeria_ids),
                PdvMovimentacao.is_deleted == False,
                PdvMovimentacao.forma_pagamento.in_(["CREDITO_AVISTA", "CREDITO_PARCELADO", "DEBITO"])
            )
        )
        movs = session.exec(query).all()

        # 2. Calcular para cada movimentacao sua data de exibicao/vencimento exata na Conciliadora
        agenda_groups = {}
        for m in movs:
            tipo_pag_lower = "cartao_debito" if m.forma_pagamento == "DEBITO" else ("cartao_credito_parcelado" if m.forma_pagamento == "CREDITO_PARCELADO" else "cartao_credito_vista")
            regra = obter_regra_cartao(session, m.empresa_id, tipo_pag_lower, m.bandeira, m.centro_custo_id)

            if regra:
                if regra.modo_parcelamento == "ANTECIPADO":
                    dt_venc = calcular_payout_date(m.data, regra)
                else:
                    base_installment_date = shift_months(m.data, (m.numero_parcela or 1) - 1)
                    dt_venc = calcular_payout_date(base_installment_date, regra)
            else:
                if m.forma_pagamento == "CREDITO_PARCELADO":
                    dt_venc = shift_months(m.data, (m.numero_parcela or 1) - 1)
                else:
                    prazo = 1 if m.forma_pagamento == "DEBITO" else 30
                    dt_venc = m.data + timedelta(days=prazo)

            # Filtrar a partir da data especificada
            if dt_venc < filter_start_date:
                continue

            band = (m.bandeira or "OUTROS").upper()
            group_key = (m.empresa_id, m.centro_custo_id, dt_venc, band, m.forma_pagamento)
            if group_key not in agenda_groups:
                agenda_groups[group_key] = []
            agenda_groups[group_key].append(m)

        synced_count = 0
        for key, items in agenda_groups.items():
            emp_id, cc_id, dt_venc, band, forma = key
            emp_name = emp_names.get(emp_id, f"Empresa #{emp_id}")

            formatted_desc = format_card_description(band, forma)
            modality = "Debito" if ("debito" in forma.lower() or "debit" in forma.lower()) else "Credito"
            total_bruto = sum(Decimal(str(m.valor or 0)) for m in items)

            plano_id = obter_categoria_receita_pdv(session, emp_id)

            entidade_nome = "Recebimento Cartões"
            entidade = session.exec(
                select(Entidade).where(Entidade.empresa_id == emp_id, Entidade.nome == entidade_nome)
            ).first()
            if not entidade:
                entidade = Entidade(
                    nome=entidade_nome,
                    tipo="CLIENTE",
                    empresa_id=emp_id
                )
                session.add(entidade)
                session.flush()

            contribuicoes = {}
            for m in items:
                v_id = str(m.venda_id or m.id)
                contribuicoes[v_id] = {
                    "valor": float(m.valor or 0),
                    "rv": "PDV",
                    "vendedor": "PDV",
                    "cliente": "Consumidor Final",
                    "status": "REALIZADO"
                }

            meta = {
                "grouped_card_launch": True,
                "bandeira": band,
                "modalidade": modality,
                "contribuicoes": contribuicoes
            }

            tp_lower = "cartao_debito" if forma == "DEBITO" else ("cartao_credito_parcelado" if forma == "CREDITO_PARCELADO" else "cartao_credito_vista")
            regra = obter_regra_cartao(session, emp_id, tp_lower, band, cc_id)
            fee_pct = regra.taxa_porcentagem if regra else Decimal("0.00")
            val_taxa = (total_bruto * fee_pct / Decimal("100")).quantize(Decimal("0.01"))
            total_liquido = total_bruto - val_taxa

            # Verificar se Lancamento existe (mesmo se estivesse is_deleted)
            l = session.exec(
                select(Lancamento)
                .where(
                    Lancamento.empresa_id == emp_id,
                    Lancamento.tipo == "RECEITA",
                    Lancamento.data_vencimento == dt_venc,
                    Lancamento.descricao == formatted_desc,
                    Lancamento.centro_custo_id == cc_id,
                    Lancamento.origem == "PDV"
                )
            ).first()

            if l:
                was_deleted = l.is_deleted
                l.valor_previsto = total_liquido
                l.is_deleted = False  # Reativa se estivesse deletado
                l.observacao = json.dumps(meta)
                l.updated_at = datetime.utcnow()
                session.add(l)
                status_msg = "Reativado e Atualizado" if was_deleted else "Atualizado"
                print(f"🔄 [{emp_name}] {formatted_desc} ({dt_venc.strftime('%d/%m/%Y')}): Líquido R$ {total_liquido:.2f} (Bruto: R$ {total_bruto:.2f}, Taxa: R$ {val_taxa:.2f})")
            else:
                l = Lancamento(
                    descricao=formatted_desc,
                    tipo="RECEITA",
                    status="EM ABERTO",
                    origem="PDV",
                    valor_previsto=total_liquido,
                    valor_pago=Decimal("0.00"),
                    valor_juros=Decimal("0.00"),
                    valor_desconto=Decimal("0.00"),
                    valor_multa=Decimal("0.00"),
                    data_vencimento=dt_venc,
                    data_pagamento=None,
                    data_competencia=items[0].data,
                    empresa_id=emp_id,
                    plano_contas_id=plano_id,
                    conta_id=None,
                    entidade_id=entidade.id,
                    centro_custo_id=cc_id,
                    observacao=json.dumps(meta),
                    is_deleted=False,
                    ipp=False,
                    previsto=True,
                    conciliado=False,
                    numero_parcela=None,
                    id_parcelamento=None,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow()
                )
                session.add(l)
                print(f"✨ [{emp_name}] {formatted_desc} ({dt_venc.strftime('%d/%m/%Y')}): R$ {total_bruto:.2f} (Criado EM ABERTO)")
            
            synced_count += 1

        if args.commit:
            session.commit()
            print(f"\n✅ SUCESSO DE SINCRONIZAÇÃO: {synced_count} lançamentos agrupados da Conciliadora foram alinhados perfeitamente no Financeiro!")
        else:
            print(f"\n🔍 SIMULAÇÃO CONCLUÍDA: {synced_count} lançamentos seriam alinhados no Financeiro. Use --commit para aplicar.")

if __name__ == "__main__":
    main()
