"""Importa as vendas do arquivo da Rede de 13/07/2026."""
import os
import sys
import json
import datetime
from datetime import date, timedelta
from decimal import Decimal
import openpyxl

# Setup path
sys.path.insert(0, ".")
os.environ.setdefault("DISABLE_AUDIT", "1")

from sqlmodel import Session, select
from app.db.session import engine
from app.models.pdv_venda import PdvVenda
from app.models.pdv_venda_item import PdvVendaItem
from app.models.pdv_movimentacao import PdvMovimentacao
from app.models.lancamento import Lancamento
from app.models.lote_cartao import LoteCartao
from app.models.lote_cartao_item import LoteCartaoItem

FILE_PATH = "/app/backups/Rede_Rel_Vendas_13_07_2026-13_07_2026-4801d830-4c10-4a73-9b41-46d5f264db39.xlsx"
EMPRESA_ID = 75
CENTRO_CUSTO_ID = 156
CONTA_CARTAO_ID = 413 # Itaú Aplicação (recebíveis)
CONTA_LOTE_ID = 412   # Itaú Corrente (líquido recebido)
DEFAULT_CLIENT_ID = 48721 # Cliente Consumidor
DEFAULT_USER_ID = 141     # Link Financeiro
PLANO_DEBITO_ID = 9145    # Cartão Débito

def clean_str(val):
    if val is None:
        return ""
    return str(val).strip()

def parse_decimal(val):
    if val is None or val == "":
        return Decimal("0.00")
    if isinstance(val, (int, float)):
        return Decimal(str(val))
    if isinstance(val, Decimal):
        return val
    try:
        return Decimal(str(val).replace(",", ".").strip())
    except:
        return Decimal("0.00")

def main():
    if not os.path.exists(FILE_PATH):
        print(f"Erro: arquivo {FILE_PATH} não encontrado!")
        sys.exit(1)

    wb = openpyxl.load_workbook(FILE_PATH, data_only=True)
    sheet = wb["vendas"]
    rows = list(sheet.iter_rows(values_only=True))
    wb.close()

    if len(rows) <= 1:
        print("Erro: planilha sem dados!")
        sys.exit(1)

    # Headers na linha index 1 (segunda linha)
    headers = [clean_str(h) for h in rows[1]]
    
    def idx(name):
        return headers.index(name)

    dt_venda_idx = idx("data da venda")
    hora_venda_idx = idx("hora da venda")
    status_idx = idx("status da venda")
    val_bruto_idx = idx("valor da venda original")
    modalidade_idx = idx("modalidade")
    tipo_idx = idx("tipo")
    bandeira_idx = idx("bandeira")
    taxa_mdr_idx = idx("taxa MDR")
    val_mdr_idx = idx("valor MDR")
    val_liq_idx = idx("valor líquido")
    nsu_idx = idx("NSU/CV")
    resumo_idx = idx("resumo de vendas/número do lote")
    cnpj_idx = idx("CNPJ")

    print(f"Total de linhas no arquivo: {len(rows)-2}")

    with Session(engine) as db:
        # Pre-cache existing sales
        existing_hashes = set(db.exec(
            select(PdvVenda.import_hash)
            .where(PdvVenda.empresa_id == EMPRESA_ID)
        ).all())

        imported_vendas = 0
        lote_groups = {} # (payout_date, bandeira, modalidade) -> list of txs

        for row in rows[2:]:
            if not any(row):
                continue

            status = clean_str(row[status_idx]).lower()
            if status != "aprovada":
                continue

            nsu = clean_str(row[nsu_idx])
            import_hash = f"rede-{nsu}"

            if import_hash in existing_hashes:
                print(f"  Venda NSU {nsu} já importada. Pulando.")
                continue

            dt_venda_raw = row[dt_venda_idx]
            dt_venda = dt_venda_raw.date() if isinstance(dt_venda_raw, datetime.datetime) else dt_venda_raw
            if not dt_venda:
                continue

            hora_venda_raw = row[hora_venda_idx]
            hora_venda = hora_venda_raw.strftime("%H:%M:%S") if isinstance(hora_venda_raw, datetime.time) else (
                hora_venda_raw.strftime("%H:%M:%S") if isinstance(hora_venda_raw, datetime.datetime) else "18:00:00"
            )

            val_bruto = parse_decimal(row[val_bruto_idx])
            val_mdr = parse_decimal(row[val_mdr_idx])
            val_liq = parse_decimal(row[val_liq_idx])
            taxa_mdr = parse_decimal(row[taxa_mdr_idx])

            modalidade = clean_str(row[modalidade_idx]).upper()
            bandeira = clean_str(row[bandeira_idx]).upper()
            resumo = clean_str(row[resumo_idx])

            # Payout date is D+1 for debit
            payout_date = dt_venda + timedelta(days=1)

            # Map payments
            tipo_pag = "cartao_debito"
            forma_pag_mov = "DEBITO"
            if "CRED" in modalidade:
                tipo_pag = "cartao_credito_vista"
                forma_pag_mov = "CREDITO_AVISTA"
                payout_date = dt_venda + timedelta(days=30)

            # Create PdvVenda
            venda_uuid = f"rede-pdv-{EMPRESA_ID}-{nsu}"
            venda = PdvVenda(
                id=venda_uuid,
                empresa_id=EMPRESA_ID,
                entidade_id=DEFAULT_CLIENT_ID,
                vendedor_id=DEFAULT_USER_ID,
                centro_custo_id=CENTRO_CUSTO_ID,
                data_venda=dt_venda,
                hora_venda=hora_venda,
                valor_subtotal=val_bruto,
                valor_desconto=Decimal("0.00"),
                valor_total=val_bruto,
                status="REALIZADO",
                observacao=f"Importação Rede NSU {nsu}",
                rv=resumo,
                is_direct_sale=False,
                import_hash=import_hash,
                created_by_id=DEFAULT_USER_ID,
                updated_by_id=DEFAULT_USER_ID,
                created_at=datetime.datetime.utcnow(),
                updated_at=datetime.datetime.utcnow()
            )
            db.add(venda)

            # Create PdvVendaItem
            venda_item = PdvVendaItem(
                venda_id=venda_uuid,
                produto_id=866, # Venda PDV Balcão (Umarizal)
                quantidade=Decimal("1.00"),
                preco_unitario=val_bruto,
                desconto=Decimal("0.00"),
                subtotal=val_bruto,
                nome_customizado="Venda PDV Balcão"
            )
            db.add(venda_item)

            # Create PdvMovimentacao
            mov = PdvMovimentacao(
                empresa_id=EMPRESA_ID,
                tipo="ENTRADA",
                descricao=f"Venda Rede {bandeira} {forma_pag_mov}",
                valor=val_bruto,
                forma_pagamento=forma_pag_mov,
                bandeira=bandeira,
                parcelas=1,
                data=dt_venda,
                centro_custo_id=CENTRO_CUSTO_ID,
                conta_id=CONTA_CARTAO_ID,
                conciliado=True,
                venda_id=venda_uuid,
                import_hash=f"mov-rede-{nsu}",
                created_by_id=DEFAULT_USER_ID,
                updated_by_id=DEFAULT_USER_ID,
                created_at=datetime.datetime.utcnow(),
                updated_at=datetime.datetime.utcnow()
            )
            db.add(mov)

            # Create Lancamento
            obs_data = {
                "origem": "PDV",
                "rv": resumo,
                "tipo_pagamento": tipo_pag,
                "vendedor_id": DEFAULT_USER_ID,
                "cliente_id": DEFAULT_CLIENT_ID,
                "centro_custo_id": CENTRO_CUSTO_ID,
                "desconto_total": 0.0,
                "bandeira": bandeira,
                "cartao_taxa": float(taxa_mdr * 100),
                "cartao_taxa_valor": float(val_mdr),
                "cartao_liquido_previsto": float(val_liq),
                "itens": [
                    {
                        "produto_id": 866,
                        "nome": "Venda PDV Balcão",
                        "quantidade": 1,
                        "preco_unitario": float(val_bruto),
                        "desconto": 0.0,
                        "subtotal": float(val_bruto)
                    }
                ]
            }

            l = Lancamento(
                descricao=f"Venda Rede RV-{resumo} NSU-{nsu}",
                tipo="RECEITA",
                status="PAGO",
                origem="PDV",
                valor_previsto=val_bruto,
                valor_pago=val_bruto,
                valor_juros=Decimal("0.00"),
                valor_desconto=Decimal("0.00"),
                valor_multa=Decimal("0.00"),
                data_vencimento=payout_date,
                data_pagamento=payout_date,
                data_competencia=dt_venda,
                empresa_id=EMPRESA_ID,
                plano_contas_id=PLANO_DEBITO_ID,
                conta_id=CONTA_CARTAO_ID,
                entidade_id=DEFAULT_CLIENT_ID,
                centro_custo_id=CENTRO_CUSTO_ID,
                created_by_id=DEFAULT_USER_ID,
                updated_by_id=DEFAULT_USER_ID,
                observacao=json.dumps(obs_data),
                is_deleted=False,
                created_at=datetime.datetime.utcnow(),
                updated_at=datetime.datetime.utcnow(),
                conciliado=True
            )
            db.add(l)
            db.flush() # obtain l.id

            # Add to lote group
            key = (payout_date, bandeira, modalidade)
            if key not in lote_groups:
                lote_groups[key] = []
            lote_groups[key].append({
                "lancamento_id": l.id,
                "val_bruto": val_bruto,
                "val_mdr": val_mdr,
                "val_liq": val_liq
            })
            imported_vendas += 1

        # Create Lotes
        imported_lotes = 0
        for (payout_date, bandeira, modalidade), items in lote_groups.items():
            total_bruto = sum(item["val_bruto"] for item in items)
            total_taxa = sum(item["val_mdr"] for item in items)
            total_liq = sum(item["val_liq"] for item in items)

            lote = LoteCartao(
                empresa_id=EMPRESA_ID,
                data_pagamento=payout_date,
                valor_bruto=total_bruto,
                valor_taxa=total_taxa,
                valor_liquido=total_liq,
                conta_destino_id=CONTA_LOTE_ID,
                status="CONCILIADO",
                bandeira=bandeira,
                forma_pagamento="Débito" if "DEB" in modalidade else "Crédito à vista",
                created_by_id=DEFAULT_USER_ID,
                updated_by_id=DEFAULT_USER_ID,
                created_at=datetime.datetime.utcnow(),
                updated_at=datetime.datetime.utcnow()
            )
            db.add(lote)
            db.flush()

            for item in items:
                lote_item = LoteCartaoItem(
                    lote_cartao_id=lote.id,
                    lancamento_id=item["lancamento_id"],
                    valor_bruto=item["val_bruto"],
                    valor_taxa=item["val_mdr"],
                    valor_liquido=item["val_liq"]
                )
                db.add(lote_item)
            
            imported_lotes += 1

        db.commit()
        print(f"Sucesso: {imported_vendas} vendas e {imported_lotes} lotes de cartão importados com sucesso!")

if __name__ == "__main__":
    main()
