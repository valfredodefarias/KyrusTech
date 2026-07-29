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
    parser = argparse.ArgumentParser(description="Gera/sincroniza os lancamentos de cartao agrupados no Financeiro a partir das movimentacoes ativas do PDV.")
    parser.add_argument("--commit", action="store_true", help="Aplica as alteracoes no banco de dados.")
    parser.add_argument("--start-date", type=str, default="2026-07-28", help="Data inicial (YYYY-MM-DD). Padrao: 2026-07-28.")
    args = parser.parse_args()

    filter_start_date = datetime.strptime(args.start_date, "%Y-%m-%d").date()

    from sqlmodel import Session, select
    from app.db.session import engine
    from app.models import Empresa, Lancamento, PdvMovimentacao, Entidade
    from app.services.pdv_service import format_card_description, obter_categoria_receita_pdv

    pizzeria_ids = [35, 37, 39, 40]

    with Session(engine) as session:
        empresas = session.exec(select(Empresa).where(Empresa.id.in_(pizzeria_ids))).all()
        emp_names = {e.id: (getattr(e, 'nome_fantasia', None) or getattr(e, 'razao_social', None) or f"Empresa #{e.id}") for e in empresas}

        print("==========================================================================")
        print("SINCRONIZAÇÃO DE LANÇAMENTOS AGRUPADOS DE CARTÃO (DÉBITO E CRÉDITO)")
        print(f"Data Inicial: {filter_start_date.strftime('%d/%m/%Y')} em diante")
        print("==========================================================================")
        print(f"Modo: {'⚠️ APLICAÇÃO REAL (--commit)' if args.commit else '🔍 SIMULAÇÃO (Dry Run - Use --commit para aplicar)'}\n")

        # Buscar todas movimentações ativas de cartão
        movs = session.exec(
            select(PdvMovimentacao)
            .where(
                PdvMovimentacao.empresa_id.in_(pizzeria_ids),
                PdvMovimentacao.is_deleted == False,
                PdvMovimentacao.data >= filter_start_date,
                PdvMovimentacao.forma_pagamento.in_(["DEBITO", "CREDITO_AVISTA", "CREDITO_PARCELADO"])
            )
        ).all()

        print(f"📌 Total de movimentações de cartão ativas no PDV a partir de {filter_start_date.strftime('%d/%m/%Y')}: {len(movs)}\n")

        # Agrupar por (empresa_id, centro_custo_id, data, bandeira, forma_pagamento)
        groups = {}
        for m in movs:
            band = (m.bandeira or "OUTROS").upper()
            forma = m.forma_pagamento.upper()
            group_key = (m.empresa_id, m.centro_custo_id, m.data, band, forma)
            if group_key not in groups:
                groups[group_key] = []
            groups[group_key].append(m)

        synced_count = 0
        for key, items in groups.items():
            emp_id, cc_id, dt_venda, band, forma = key
            emp_name = emp_names.get(emp_id, f"Empresa #{emp_id}")

            tp_lower = forma.lower()
            formatted_desc = format_card_description(band, forma)
            modality = "Debito" if ("debito" in tp_lower or "debit" in tp_lower) else "Credito"
            target_vencimento = dt_venda  # Para exibir no proprio dia

            total_val = sum(Decimal(str(m.valor or 0)) for m in items)

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

            # Buscar se ja existe Lancamento ativo
            l = session.exec(
                select(Lancamento)
                .where(
                    Lancamento.empresa_id == emp_id,
                    Lancamento.tipo == "RECEITA",
                    Lancamento.data_vencimento == target_vencimento,
                    Lancamento.descricao == formatted_desc,
                    Lancamento.centro_custo_id == cc_id,
                    Lancamento.origem == "PDV",
                    Lancamento.is_deleted == False
                )
            ).first()

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

            if l:
                print(f"🔄 Atualizando [{emp_name}] {formatted_desc} ({dt_venda.strftime('%d/%m/%Y')}): R$ {l.valor_previsto:.2f} -> R$ {total_val:.2f}")
                l.valor_previsto = total_val
                l.observacao = json.dumps(meta)
                l.updated_at = datetime.utcnow()
                session.add(l)
            else:
                print(f"✨ Criando [{emp_name}] {formatted_desc} ({dt_venda.strftime('%d/%m/%Y')}): R$ {total_val:.2f} (Status: EM ABERTO, Conta: Nenhuma)")
                l = Lancamento(
                    descricao=formatted_desc,
                    tipo="RECEITA",
                    status="EM ABERTO",
                    origem="PDV",
                    valor_previsto=total_val,
                    valor_pago=Decimal("0.00"),
                    valor_juros=Decimal("0.00"),
                    valor_desconto=Decimal("0.00"),
                    valor_multa=Decimal("0.00"),
                    data_vencimento=target_vencimento,
                    data_pagamento=None,
                    data_competencia=dt_venda,
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
            
            synced_count += 1

        if args.commit:
            session.commit()
            print(f"\n✅ SUCESSO: {synced_count} recebíveis agrupados foram sincronizados com sucesso no banco de dados!")
        else:
            print(f"\n🔍 SIMULAÇÃO CONCLUÍDA: {synced_count} recebíveis seriam sincronizados. Use --commit para salvar.")

if __name__ == "__main__":
    main()
