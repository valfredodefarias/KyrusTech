"""
Auto-conciliação histórica de cartões.

Para cada LoteCartao importado (sem lancamento_deposito_id), encontra os PDV Lancamentos
com data_vencimento = lote.data_pagamento + bandeira correspondente (quando disponível),
cria LoteCartaoItem e marca os Lancamentos como PAGO.

Uso:
  python scripts/auto_reconciliar_cartoes.py [--dry-run] [--empresa-id 35]
"""
import sys, json, argparse
from decimal import Decimal
from datetime import datetime
from collections import defaultdict

sys.path.insert(0, "/app")
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.lote_cartao import LoteCartao
from app.models.lote_cartao_item import LoteCartaoItem

# Normaliza bandeira para comparação
BANDEIRA_ALIASES = {
    "MASTER": "MASTER", "MASTERCARD": "MASTER",
    "VISA": "VISA", "VISADEBIT": "VISA",
    "ELO": "ELO", "ELODEBIT": "ELO",
    "AMEX": "AMEX", "AMERICANEXPRESS": "AMEX",
    "HIPERCARD": "HIPERCARD",
    "IFOOD": "IFOOD",
    "PIX": "PIX",
    "OUTROS": "OUTROS",
}

def norm_band(b: str) -> str:
    if not b:
        return "OUTROS"
    b = b.upper().replace(" ", "").replace("-", "")
    return BANDEIRA_ALIASES.get(b, b)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=False)
    parser.add_argument("--empresa-id", type=int, default=None)
    args = parser.parse_args()
    dry_run = args.dry_run

    print(f"{'[DRY RUN] ' if dry_run else ''}Iniciando auto-conciliação histórica de cartões...")

    with Session(engine) as db:
        # Seleciona empresas a processar
        empresa_ids_q = (
            select(LoteCartao.empresa_id)
            .where(LoteCartao.lancamento_deposito_id.is_(None))
            .distinct()
        )
        if args.empresa_id:
            empresa_ids_q = empresa_ids_q.where(LoteCartao.empresa_id == args.empresa_id)
        empresa_ids = list(db.exec(empresa_ids_q).all())
        print(f"Empresas a processar: {empresa_ids}")

        total_lotes_matched = 0
        total_lanc_pago = 0

        for emp_id in empresa_ids:
            print(f"\n--- Empresa {emp_id} ---")

            # Lotes sem deposito desta empresa
            lotes = db.exec(
                select(LoteCartao)
                .where(
                    LoteCartao.empresa_id == emp_id,
                    LoteCartao.lancamento_deposito_id.is_(None)
                )
                .order_by(LoteCartao.data_pagamento)
            ).all()
            print(f"  LoteCartao sem deposito: {len(lotes):,}")

            # Verifica quais lotes já têm itens (não reprocessar)
            lotes_com_itens = set()
            for lote in lotes:
                itens_existentes = db.exec(
                    select(LoteCartaoItem.id)
                    .where(LoteCartaoItem.lote_cartao_id == lote.id)
                    .limit(1)
                ).first()
                if itens_existentes:
                    lotes_com_itens.add(lote.id)
            
            lotes_pendentes = [l for l in lotes if l.id not in lotes_com_itens]
            print(f"  Lotes pendentes (sem itens): {len(lotes_pendentes):,}")

            # PDV card lancamentos EM ABERTO desta empresa
            card_lancs = db.exec(
                select(Lancamento)
                .where(
                    Lancamento.empresa_id == emp_id,
                    Lancamento.is_deleted == False,
                    Lancamento.tipo == "RECEITA",
                    Lancamento.origem == "PDV",
                    Lancamento.status == "EM ABERTO",
                    Lancamento.observacao.is_not(None),
                    Lancamento.observacao.ilike('%"cartao_%')
                )
            ).all()
            print(f"  PDV card lancamentos EM ABERTO: {len(card_lancs):,}")

            # Indexa por (data_vencimento, bandeira_norm)
            lanc_idx: dict = defaultdict(list)
            for l in card_lancs:
                try:
                    meta = json.loads(l.observacao)
                    band = norm_band(meta.get("bandeira", "OUTROS"))
                    lanc_idx[(l.data_vencimento, band)].append(l)
                except Exception:
                    pass

            matched = 0
            unmatched = 0
            em_pago = 0

            for lote in lotes_pendentes:
                # Bandeira do lote (pode ser NULL para lotes antigos sem a coluna)
                lote_band_raw = getattr(lote, "bandeira", None)
                lote_band = norm_band(lote_band_raw) if lote_band_raw else None

                # Busca candidatos
                if lote_band and lote_band != "OUTROS":
                    candidates = lanc_idx.get((lote.data_pagamento, lote_band), [])
                else:
                    # Sem bandeira: pega todos da data (independente de bandeira)
                    candidates = []
                    for k, v in lanc_idx.items():
                        if k[0] == lote.data_pagamento:
                            candidates.extend(v)

                if not candidates:
                    unmatched += 1
                    continue

                if not dry_run:
                    for lanc in list(candidates):
                        try:
                            meta = json.loads(lanc.observacao)
                            taxa_v = Decimal(str(meta.get("cartao_taxa_valor", 0.0)))
                        except Exception:
                            taxa_v = Decimal("0.00")

                        item = LoteCartaoItem(
                            lote_cartao_id=lote.id,
                            lancamento_id=lanc.id,
                            valor_bruto=lanc.valor_previsto,
                            valor_taxa=taxa_v,
                            valor_liquido=lanc.valor_previsto - taxa_v
                        )
                        db.add(item)

                        lanc.status = "PAGO"
                        lanc.data_pagamento = lote.data_pagamento
                        lanc.valor_pago = lanc.valor_previsto
                        lanc.conta_id = lote.conta_destino_id
                        lanc.conciliado = True
                        lanc.updated_at = datetime.utcnow()
                        db.add(lanc)

                        # Remove do índice para não re-usar
                        band_k = norm_band(json.loads(lanc.observacao).get("bandeira", "OUTROS"))
                        key = (lanc.data_vencimento, band_k)
                        if lanc in lanc_idx.get(key, []):
                            lanc_idx[key].remove(lanc)

                em_pago += len(candidates)
                matched += 1

            print(f"  Lotes matched: {matched:,} | Sem match: {unmatched:,}")
            print(f"  Lancamentos a marcar PAGO: {em_pago:,}")
            total_lotes_matched += matched
            total_lanc_pago += em_pago

        # ── Passo Final: Force-PAGO ─────────────────────────────────────────────
        # Todo lançamento PDV EM ABERTO com data_vencimento < hoje já foi recebido
        # (o adquirente paga conforme o prazo acordado). Marca como PAGO.
        print(f"\n{'[DRY RUN] ' if dry_run else ''}Verificando recebíveis vencidos sem PAGO...")
        from datetime import date as date_type
        today = date_type.today()

        empresa_filter_ids = [args.empresa_id] if args.empresa_id else None
        force_q = (
            select(Lancamento)
            .where(
                Lancamento.origem == "PDV",
                Lancamento.status == "EM ABERTO",
                Lancamento.tipo == "RECEITA",
                Lancamento.data_vencimento < today,
                Lancamento.is_deleted == False,
            )
        )
        if empresa_filter_ids:
            force_q = force_q.where(Lancamento.empresa_id.in_(empresa_filter_ids))

        force_list = db.exec(force_q).all()
        print(f"  Recebíveis vencidos EM ABERTO: {len(force_list):,}")

        if not dry_run:
            for lanc in force_list:
                lanc.status = "PAGO"
                lanc.valor_pago = lanc.valor_previsto
                lanc.data_pagamento = lanc.data_vencimento
                lanc.conciliado = True
                lanc.updated_at = datetime.utcnow()
                db.add(lanc)
            db.commit()
            print(f"  [OK] {len(force_list):,} lançamentos marcados PAGO.")
        else:
            print(f"  [DRY RUN] {len(force_list):,} seriam marcados PAGO.")

        if not dry_run:
            db.commit()
            print(f"\n[OK] Commit realizado.")
        else:
            print(f"\n[DRY RUN] Nenhuma alteração salva.")

        print(f"\n=== RESUMO ===")
        print(f"  Lotes conciliados: {total_lotes_matched:,}")
        print(f"  Lancamentos marcados PAGO (lote match): {total_lanc_pago:,}")
        print(f"  Lancamentos marcados PAGO (vencidos):   {len(force_list):,}")

if __name__ == "__main__":
    main()
