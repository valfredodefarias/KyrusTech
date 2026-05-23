"""
Backfill conservador do campo ofx_bank_id nos lancamentos OFX antigos.

O script so preenche quando o banco consegue ser inferido com boa confianca
a partir da conta, do cartao ou da integracao bancária vinculada.
Por padrao roda em dry-run. Use --apply para gravar as alteracoes.
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path
from typing import Optional

from sqlalchemy import text
from sqlmodel import Session, select

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine  # noqa: E402
from app.models.cartao import Cartao  # noqa: E402
from app.models.conta import Conta  # noqa: E402
from app.models.integracao_bancaria import IntegracaoBancaria  # noqa: E402
from app.models.lancamento import Lancamento  # noqa: E402


BANK_ID_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("341", ("itau", "itaú")),
    ("237", ("bradesco",)),
    ("033", ("santander",)),
    ("077", ("inter", "banco inter")),
    ("001", ("banco do brasil", "banco brasil", "bb")),
    ("104", ("caixa", "caixa economica", "caixa econômica")),
    ("260", ("nubank", "nu bank")),
    ("748", ("sicredi",)),
    ("756", ("sicoob",)),
    ("336", ("c6 bank", "c6")),
    ("323", ("mercado pago", "mercadopago")),
    ("037", ("banpara", "banpará")),
    ("380", ("picpay", "pic pay")),
]


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    base = unicodedata.normalize("NFKD", str(value).strip().lower())
    sem_acento = "".join(char for char in base if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", sem_acento).strip()


def infer_bank_id(*texts: object) -> Optional[str]:
    normalized_haystack = " ".join(
        normalized
        for text_value in texts
        if (normalized := normalize_text(text_value))
    )
    if not normalized_haystack:
        return None

    for bank_id, aliases in BANK_ID_RULES:
        for alias in aliases:
            normalized_alias = normalize_text(alias)
            if not normalized_alias:
                continue
            if re.search(rf"\b{re.escape(normalized_alias)}\b", normalized_haystack):
                return bank_id
    return None


def parse_reference_context(reference: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    value = str(reference or "").strip()
    if not value:
        return None, None

    parts = value.split(":")
    if len(parts) < 2:
        return None, None

    contexto = parts[0].strip().lower()
    try:
        identifier = int(parts[1])
    except Exception:
        return None, None

    if contexto not in {"conta", "cartao"}:
        return None, None
    return contexto, identifier


def ensure_schema(session: Session) -> None:
    statements = [
        text("ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS ofx_bank_id VARCHAR"),
        text("CREATE INDEX IF NOT EXISTS ix_lancamentos_ofx_bank_id ON lancamentos (ofx_bank_id)"),
    ]
    for statement in statements:
        session.exec(statement)
    session.commit()


def load_context_maps(session: Session, lancamentos: list[Lancamento]) -> tuple[dict[int, Conta], dict[int, Cartao], dict[int, IntegracaoBancaria]]:
    conta_ids: set[int] = set()
    cartao_ids: set[int] = set()

    for lancamento in lancamentos:
        if lancamento.conta_id:
            conta_ids.add(int(lancamento.conta_id))
        if lancamento.cartao_id:
            cartao_ids.add(int(lancamento.cartao_id))

        contexto, contexto_id = parse_reference_context(lancamento.referencia_externa)
        if contexto == "conta" and contexto_id:
            conta_ids.add(contexto_id)
        elif contexto == "cartao" and contexto_id:
            cartao_ids.add(contexto_id)

    contas: dict[int, Conta] = {}
    cartoes: dict[int, Cartao] = {}
    integracoes: dict[int, IntegracaoBancaria] = {}

    if conta_ids:
        contas = {
            conta.id: conta
            for conta in session.exec(select(Conta).where(Conta.id.in_(conta_ids))).all()
            if conta.id is not None
        }
        integracoes = {
            integracao.conta_id: integracao
            for integracao in session.exec(select(IntegracaoBancaria).where(IntegracaoBancaria.conta_id.in_(conta_ids))).all()
            if integracao.conta_id is not None
        }

    if cartao_ids:
        cartoes = {
            cartao.id: cartao
            for cartao in session.exec(select(Cartao).where(Cartao.id.in_(cartao_ids))).all()
            if cartao.id is not None
        }

        conta_ids_from_cartoes = {
            int(cartao.conta_id)
            for cartao in cartoes.values()
            if cartao.conta_id is not None
        }
        conta_ids_missing = conta_ids_from_cartoes.difference(conta_ids)
        if conta_ids_missing:
            contas_extra = {
                conta.id: conta
                for conta in session.exec(select(Conta).where(Conta.id.in_(conta_ids_missing))).all()
                if conta.id is not None
            }
            contas.update(contas_extra)

            integracoes_extra = {
                integracao.conta_id: integracao
                for integracao in session.exec(select(IntegracaoBancaria).where(IntegracaoBancaria.conta_id.in_(conta_ids_missing))).all()
                if integracao.conta_id is not None
            }
            integracoes.update(integracoes_extra)

    return contas, cartoes, integracoes


def resolve_context_for_lancamento(
    lancamento: Lancamento,
    contas: dict[int, Conta],
    cartoes: dict[int, Cartao],
) -> tuple[Optional[Conta], Optional[Cartao]]:
    conta = contas.get(int(lancamento.conta_id)) if lancamento.conta_id else None
    cartao = cartoes.get(int(lancamento.cartao_id)) if lancamento.cartao_id else None

    if not conta:
        contexto, contexto_id = parse_reference_context(lancamento.referencia_externa)
        if contexto == "conta" and contexto_id:
            conta = contas.get(contexto_id)
        elif contexto == "cartao" and contexto_id:
            cartao = cartoes.get(contexto_id)
            if cartao and cartao.conta_id:
                conta = contas.get(int(cartao.conta_id))

    if not conta and cartao and cartao.conta_id:
        conta = contas.get(int(cartao.conta_id))

    return conta, cartao


def run_backfill(*, apply_changes: bool = False, empresa_id: Optional[int] = None) -> int:
    with Session(engine) as session:
        ensure_schema(session)

        query = select(Lancamento).where(
            Lancamento.is_deleted == False,
            Lancamento.ofx_bank_id.is_(None),
            Lancamento.origem.ilike("OFX%"),
        )
        if empresa_id is not None:
            query = query.where(Lancamento.empresa_id == empresa_id)

        candidatos = list(session.exec(query).all())
        if not candidatos:
            print("Nenhum lancamento OFX pendente de backfill encontrado.")
            return 0

        contas, cartoes, integracoes = load_context_maps(session, candidatos)

        atualizados = 0
        ignorados = 0
        exemplos: list[str] = []

        for lancamento in candidatos:
            conta, cartao = resolve_context_for_lancamento(lancamento, contas, cartoes)
            integracao = integracoes.get(int(conta.id)) if conta and conta.id is not None else None

            inferred = infer_bank_id(
                conta.banco if conta else None,
                conta.nome if conta else None,
                conta.tipo_integracao if conta else None,
                getattr(integracao, "tipo", None),
                getattr(integracao, "nome", None),
                cartao.nome_cartao if cartao else None,
                cartao.bandeira if cartao else None,
                lancamento.referencia_externa,
            )

            if not inferred:
                ignorados += 1
                continue

            if apply_changes:
                lancamento.ofx_bank_id = inferred
                session.add(lancamento)

            atualizados += 1
            if len(exemplos) < 10:
                descricao_contexto = conta.nome if conta and conta.nome else conta.banco if conta else None
                exemplos.append(
                    f"ID {lancamento.id} -> banco {inferred}"
                    + (f" (contexto={descricao_contexto})" if descricao_contexto else "")
                )

        if apply_changes:
            session.commit()

        print(f"Lancamentos analisados: {len(candidatos)}")
        print(f"Lancamentos com banco inferido: {atualizados}")
        print(f"Lancamentos sem inferencia segura: {ignorados}")
        if exemplos:
            print("Exemplos:")
            for exemplo in exemplos:
                print(f" - {exemplo}")

        return atualizados


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill do campo ofx_bank_id em lancamentos OFX antigos")
    parser.add_argument("--apply", action="store_true", help="Grava as atualizacoes no banco")
    parser.add_argument("--empresa-id", type=int, default=None, help="Limita o backfill a uma empresa especifica")
    args = parser.parse_args()

    updated = run_backfill(apply_changes=bool(args.apply), empresa_id=args.empresa_id)
    if not args.apply:
        print("Dry-run concluido. Use --apply para gravar os valores inferidos.")
    return 0 if updated >= 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())