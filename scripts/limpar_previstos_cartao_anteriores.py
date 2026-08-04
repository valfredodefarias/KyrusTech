"""
Script de Limpeza de Previstos de Cartão de Meses Anteriores

Objetivo:
- Remover (soft-delete is_deleted=True) APENAS os previstos/recebíveis em aberto (não conciliados)
  de cartão de crédito cujas VENDAS ocorreram em meses anteriores (< 01/08/2026), mas cujo VENCIMENTO
  previso cai deste mês em diante (>= 01/08/2026).
- Manter 100% INTACTAS todas as Vendas (PdvVenda) e vendas de Agosto/2026 em diante.
- Gerar arquivo de BACKUP/ROLLBACK automático com a lista exata dos IDs alterados para permitir reversão instantânea.

Uso:
  python scripts/limpar_previstos_cartao_anteriores.py --dry-run
  python scripts/limpar_previstos_cartao_anteriores.py --execute
  python scripts/limpar_previstos_cartao_anteriores.py --rollback <arquivo_rollback.json>
"""

import sys
import os
import argparse
import json
import datetime
from decimal import Decimal

# Adicionar pasta raiz ao PATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, select, update
from app.db.session import engine
from app.models.pdv_movimentacao import PdvMovimentacao
from app.services.pdv_service import obter_regra_cartao, calcular_payout_date, shift_months

EMPRESAS_ALVO = {
    37: "Pizza Fábio Ananindeua",
    39: "Pizza Fábio Marco - Salão",
    40: "Pizza Fábio Marco - Delivery"
}

def decimal_default(obj):
    if isinstance(obj, (Decimal, datetime.date, datetime.datetime)):
        return str(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

def executar_limpeza(cutoff_date: datetime.date, dry_run: bool = True):
    print("=" * 70)
    print(f"MODO: {'DRY-RUN (SIMULAÇÃO - NENHUMA ALTERAÇÃO SERÁ FEITA)' if dry_run else 'EXECUÇÃO REAL'}")
    print(f"Empresas Alvo: {list(EMPRESAS_ALVO.keys())} ({', '.join(EMPRESAS_ALVO.values())})")
    print(f"Data de Corte (Início deste mês): {cutoff_date.strftime('%d/%m/%Y')}")
    print("=" * 70)

    with Session(engine) as db:
        regras_cache = {}
        movs = db.exec(
            select(PdvMovimentacao)
            .where(
                PdvMovimentacao.empresa_id.in_(list(EMPRESAS_ALVO.keys())),
                PdvMovimentacao.is_deleted == False,
                PdvMovimentacao.forma_pagamento.in_(["CREDITO_AVISTA", "CREDITO_PARCELADO"]),
                PdvMovimentacao.conciliado == False
            )
        ).all()

        previstos_a_remover = []

        for m in movs:
            # Condição 1: A Venda foi realizada ANTES deste mês (< cutoff_date)
            if m.data < cutoff_date:
                tipo_pag_lower = "cartao_debito" if m.forma_pagamento == "DEBITO" else ("cartao_credito_parcelado" if m.forma_pagamento == "CREDITO_PARCELADO" else "cartao_credito_vista")
                cache_key = (m.empresa_id, tipo_pag_lower, m.bandeira, m.centro_custo_id, m.data)
                
                if cache_key in regras_cache:
                    regra = regras_cache[cache_key]
                else:
                    regra = obter_regra_cartao(db, m.empresa_id, tipo_pag_lower, m.bandeira, m.centro_custo_id, m.data)
                    regras_cache[cache_key] = regra
                
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
                        dt_venc = m.data + datetime.timedelta(days=30)

                # Condição 2: O Vencimento caindo DESTE MÊS EM DIANTE (>= cutoff_date)
                if dt_venc >= cutoff_date:
                    previstos_a_remover.append({
                        "id": m.id,
                        "empresa_id": m.empresa_id,
                        "empresa_nome": EMPRESAS_ALVO.get(m.empresa_id, ""),
                        "venda_id": m.venda_id,
                        "data_venda": str(m.data),
                        "data_vencimento": str(dt_venc),
                        "bandeira": m.bandeira,
                        "forma_pagamento": m.forma_pagamento,
                        "parcela": f"{m.numero_parcela}/{m.parcelas}",
                        "valor": float(m.valor)
                    })

        print(f"\n📊 RESUMO DO DIAGNÓSTICO:")
        print(f"Total de previstos encontrados (Venda < {cutoff_date} e Vencimento >= {cutoff_date}): {len(previstos_a_remover)}")
        
        breakdown = {}
        for item in previstos_a_remover:
            emp_id = item["empresa_id"]
            breakdown.setdefault(emp_id, []).append(item)

        total_geral_valor = 0.0
        for emp_id, items in sorted(breakdown.items()):
            tot_emp = sum(i["valor"] for i in items)
            total_geral_valor += tot_emp
            print(f"  • {EMPRESAS_ALVO.get(emp_id, f'Empresa {emp_id}')}: {len(items)} previstos | Total: R$ {tot_emp:,.2f}")

        print(f"  👉 Valor Total dos Previstos a Desativar: R$ {total_geral_valor:,.2f}\n")

        if len(previstos_a_remover) == 0:
            print("Nenhum previsto encontrado atendendo aos critérios.")
            return

        if dry_run:
            print("🔍 Exemplos dos primeiros 5 previstos que seriam desativados:")
            for item in previstos_a_remover[:5]:
                print(f"   [ID {item['id']}] Empresa: {item['empresa_nome']} | Venda: {item['data_venda']} | Vencimento Previsto: {item['data_vencimento']} | {item['bandeira']} {item['forma_pagamento']} ({item['parcela']}) => R$ {item['valor']:.2f}")
            print("\n⚠️ Para EXECUTAR a limpeza real e gerar o arquivo de rollback, execute:")
            print("   python scripts/limpar_previstos_cartao_anteriores.py --execute")
        else:
            # EXECUTAR ALTERAÇÃO
            target_ids = [i["id"] for i in previstos_a_remover]
            
            # 1. Gerar arquivo de rollback JSON e SQL
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            rollback_json_path = f"rollback_previstos_anteriores_{timestamp}.json"
            rollback_sql_path = f"rollback_previstos_anteriores_{timestamp}.sql"

            rollback_data = {
                "timestamp": timestamp,
                "cutoff_date": str(cutoff_date),
                "total_registros": len(target_ids),
                "ids_alterados": target_ids,
                "detalhes": previstos_a_remover
            }

            with open(rollback_json_path, "w", encoding="utf-8") as f:
                json.dump(rollback_data, f, indent=2, ensure_ascii=False)

            with open(rollback_sql_path, "w", encoding="utf-8") as f:
                ids_str = ", ".join(map(str, target_ids))
                f.write(f"-- ROLLBACK DA LIMPEZA DE PREVISTOS DE {timestamp}\n")
                f.write(f"UPDATE pdv_movimentacoes SET is_deleted = false WHERE id IN ({ids_str});\n")

            # 2. Executar soft-delete no banco de dados
            db.exec(
                update(PdvMovimentacao)
                .where(PdvMovimentacao.id.in_(target_ids))
                .values(is_deleted=True)
            )
            db.commit()

            print("=" * 70)
            print("✅ EXCLUÍDOS COM SUCESSO! (soft-delete is_deleted=True)")
            print(f"Total de movimentações atualizadas: {len(target_ids)}")
            print(f"📁 Arquivo de Rollback JSON gerado em: {os.path.abspath(rollback_json_path)}")
            print(f"📁 Arquivo de Rollback SQL gerado em:  {os.path.abspath(rollback_sql_path)}")
            print("\n🔄 Caso precise REVERTER esta ação no futuro, basta rodar:")
            print(f"   python scripts/limpar_previstos_cartao_anteriores.py --rollback {rollback_json_path}")
            print("=" * 70)

def executar_rollback(rollback_file: str):
    if not os.path.exists(rollback_file):
        print(f"❌ Erro: Arquivo de rollback '{rollback_file}' não foi encontrado.")
        return

    with open(rollback_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    target_ids = data.get("ids_alterados", [])
    if not target_ids:
        print("❌ Erro: Nenhum ID encontrado no arquivo de rollback.")
        return

    print("=" * 70)
    print(f"🔄 EXECUTANDO ROLLBACK (REVERSÃO)")
    print(f"Arquivo: {rollback_file}")
    print(f"Total de previstos a reativar (is_deleted = False): {len(target_ids)}")
    print("=" * 70)

    with Session(engine) as db:
        db.exec(
            update(PdvMovimentacao)
            .where(PdvMovimentacao.id.in_(target_ids))
            .values(is_deleted=False)
        )
        db.commit()

    print("✅ REVERSÃO CONCLUÍDA COM SUCESSO! Todos os previstos foram reativados.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Limpeza de previstos de cartão de meses anteriores.")
    parser.add_argument("--dry-run", action="store_true", help="Simula a execução sem alterar o banco.")
    parser.add_argument("--execute", action="store_true", help="Executa a desativação dos previstos e gera arquivo de rollback.")
    parser.add_argument("--rollback", type=str, help="Caminho do arquivo JSON de rollback para desfazer a alteração.")
    parser.add_argument("--date", type=str, default="2026-08-01", help="Data de corte do mês (YYYY-MM-DD). Padrão: 2026-08-01")

    args = parser.parse_args()

    if args.rollback:
        executar_rollback(args.rollback)
    else:
        try:
            year, month, day = map(int, args.date.split("-"))
            cutoff = datetime.date(year, month, day)
        except Exception:
            cutoff = datetime.date(2026, 8, 1)

        is_dry_run = not args.execute
        executar_limpeza(cutoff, dry_run=is_dry_run)
