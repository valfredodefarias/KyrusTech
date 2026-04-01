# app/services/lancamento_service.py

from datetime import datetime, date
import re
import uuid
from decimal import Decimal
from typing import List, Optional
from sqlmodel import Session, select, func, asc, desc, col 
from fastapi import HTTPException, status

# Models
from app.models.lancamento import Lancamento
from app.models.anexo_lancamento import AnexoLancamento
from app.models.plano_contas import PlanoContas 
from app.models.conta import Conta
from app.models.empresa import Empresa
from app.crud import crud_plano_contas, crud_auto_adjustment_config

# Schemas 
from app.schemas.lancamento import (
    LancamentoCreate, 
    LancamentoUpdate, 
    BulkUpdateSchema, 
    TransferenciaCreate
)
from app.schemas.anexo import AnexoCreate

class LancamentoService:
    @staticmethod
    def _normalize_nome_plano_contas(nome: str) -> str:
        import unicodedata
        # Remove acentos, transforma em maiúsculas, remove espaços extras e caracteres não alfanuméricos
        if not nome:
            return ""
        nome = nome.strip().upper()
        nome = unicodedata.normalize('NFKD', nome)
        nome = ''.join([c for c in nome if not unicodedata.combining(c)])
        nome = re.sub(r'[^A-Z0-9 ]', '', nome)
        nome = re.sub(r'\s+', ' ', nome)
        return nome.strip()

    def __init__(self, session: Session):
        self.session = session

    def _format_competencia(self, dt: date) -> str:
        return f"{dt.month:02d}-{dt.year}"

    def _validate_competencia(self, value: str) -> None:
        if not re.match(r"^(0[1-9]|1[0-2])-\d{4}$", value or ""):
            raise HTTPException(status_code=400, detail="competencia inválida. Use MM-AAAA.")

    def _validate_entidade_required(self, payload: dict, *, operation: str) -> None:
        entidade_id = payload.get("entidade_id")
        if entidade_id in (None, "", 0, "0"):
            raise HTTPException(
                status_code=400,
                detail=f"Interessado é obrigatório para {operation} de lançamento.",
            )

    def _ensure_id_parcelamento(self, payload: dict) -> None:
        if payload.get("numero_parcela") and not payload.get("id_parcelamento"):
            payload["id_parcelamento"] = str(uuid.uuid4())

    def _normalize_bulk_parcelamento_ids(self, payloads: List[dict]) -> None:
        grouped_ids: dict[str, str] = {}
        parcela_pattern = re.compile(r"^(.+?)\s*\((\d+)/(\d+)\)\s*$")

        for payload in payloads:
            if payload.get("id_parcelamento") or not payload.get("numero_parcela"):
                continue

            descricao = str(payload.get("descricao") or "").strip()
            match = parcela_pattern.match(descricao)
            if not match:
                payload["id_parcelamento"] = str(uuid.uuid4())
                continue

            base_desc = match.group(1).strip().lower()
            total = match.group(3)
            group_key = "|".join([
                base_desc,
                total,
                str(payload.get("tipo") or ""),
                str(payload.get("plano_contas_id") or ""),
                str(payload.get("entidade_id") or ""),
                str(payload.get("conta_id") or ""),
                str(payload.get("cartao_id") or ""),
                str(payload.get("centro_custo_id") or ""),
            ])

            if group_key not in grouped_ids:
                grouped_ids[group_key] = str(uuid.uuid4())
            payload["id_parcelamento"] = grouped_ids[group_key]

    def _aplicar_regras_negocio(self, lancamento: Lancamento):
        """
        Centraliza a lógica:
        1. Sem Data Pagamento = EM ABERTO (e zera valor pago).
        2. Com Data Pagamento = PAGO.
        """
        if lancamento.data_pagamento:
            lancamento.status = "PAGO"
            # Se pagou mas não informou valor, assume o valor previsto
            if not lancamento.valor_pago:
                lancamento.valor_pago = lancamento.valor_previsto
        else:
            lancamento.status = "EM ABERTO"
            # Se está em aberto, não tem valor pago ainda
            lancamento.valor_pago = Decimal("0.00")

    def _is_transferencia(self, lancamento: Lancamento) -> bool:
        return str(lancamento.origem or "").upper() == "TRANSFERENCIA"

    def _is_compensado_ou_pago(self, lancamento: Lancamento) -> bool:
        status_pago = str(lancamento.status or "").upper() == "PAGO"
        return bool(status_pago or lancamento.data_pagamento or lancamento.conciliado)

    def _find_transfer_related_ids(self, lancamento: Lancamento) -> set[int]:
        ids = {int(lancamento.id)} if lancamento.id is not None else set()

        if lancamento.transferencia_grupo_id:
            related = self.session.exec(
                select(Lancamento.id).where(
                    Lancamento.empresa_id == lancamento.empresa_id,
                    Lancamento.is_deleted == False,
                    Lancamento.transferencia_grupo_id == lancamento.transferencia_grupo_id,
                )
            ).all()
            ids.update(int(item_id) for item_id in related if item_id is not None)
            return ids

        counterpart_tipo = "RECEITA" if str(lancamento.tipo).upper() == "DESPESA" else "DESPESA"
        related = self.session.exec(
            select(Lancamento.id).where(
                Lancamento.empresa_id == lancamento.empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.origem == "TRANSFERENCIA",
                Lancamento.id != lancamento.id,
                Lancamento.descricao == lancamento.descricao,
                Lancamento.data_vencimento == lancamento.data_vencimento,
                Lancamento.valor_previsto == lancamento.valor_previsto,
                Lancamento.tipo == counterpart_tipo,
            )
        ).all()
        ids.update(int(item_id) for item_id in related if item_id is not None)
        return ids

    def _auto_adjust_token(self, lancamento_id: int, kind: str) -> str:
        return f"AUTO_AJUSTE:{lancamento_id}:{kind}"

    def _get_empresa_tipo_pessoa(self, empresa_id: int) -> str:
        empresa = self.session.get(Empresa, empresa_id)
        if not empresa:
            return "PJ"
        value = str(empresa.tipo_pessoa or "PJ").strip().upper()
        return value if value in {"PF", "PJ"} else "PJ"

    def _resolve_adjust_category(
        self,
        *,
        empresa_id: int,
        nome: str,
        tipo: str,
        dre_grupo: str,
        user_id: int,
        preferred_category_id: Optional[int] = None,
    ) -> int:
        normalized_name = self._normalize_nome_plano_contas(nome)
        normalized_tipo = (str(tipo or "D").strip().upper() or "D")[:1]
        normalized_dre = str(dre_grupo or "DESPESAS_OPERACIONAIS").strip().upper()

        if preferred_category_id is not None:
            preferred = self.session.exec(
                select(PlanoContas).where(
                    PlanoContas.id == int(preferred_category_id),
                    PlanoContas.empresa_id == empresa_id,
                    PlanoContas.is_deleted == False,
                )
            ).first()
            if preferred and preferred.id is not None:
                preferred.permite_lancamentos = True
                preferred.updated_by_id = user_id
                self.session.add(preferred)
                self.session.flush()
                return int(preferred.id)

        # Busca todos os planos de contas da empresa e compara pelo nome normalizado
        planos = self.session.exec(
            select(PlanoContas).where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.is_deleted == False,
            )
        ).all()
        existing = None
        for plano in planos:
            if self._normalize_nome_plano_contas(plano.nome) == normalized_name:
                existing = plano
                break
        if existing and existing.id is not None:
            if existing.tipo != normalized_tipo:
                existing.tipo = normalized_tipo
            existing.dre_grupo = normalized_dre
            existing.eh_operacional = normalized_dre != "NAO_OPERACIONAL"
            existing.permite_lancamentos = True
            existing.considerar_nos_resultados = True
            existing.updated_by_id = user_id
            self.session.add(existing)
            self.session.flush()
            return int(existing.id)

        created = PlanoContas(
            nome=nome.strip(),
            tipo=normalized_tipo,
            codigo=None,
            empresa_id=empresa_id,
            permite_lancamentos=True,
            eh_operacional=normalized_dre != "NAO_OPERACIONAL",
            considerar_nos_resultados=True,
            dre_grupo=normalized_dre,
            created_by_id=user_id,
            updated_by_id=user_id,
        )
        self.session.add(created)
        self.session.flush()
        if created.id is None:
            raise HTTPException(status_code=500, detail="Nao foi possivel criar categoria de ajuste automatico")
        return int(created.id)

    def _find_adjustment_by_token(self, *, empresa_id: int, token: str) -> Optional[Lancamento]:
        return self.session.exec(
            select(Lancamento).where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.origem == "AJUSTE_DIFERENCA",
                Lancamento.observacao == token,
            )
        ).first()

    def _soft_delete_adjustment(self, *, empresa_id: int, lancamento_id: int, kind: str, user_id: int) -> None:
        token = self._auto_adjust_token(lancamento_id, kind)
        existing = self._find_adjustment_by_token(empresa_id=empresa_id, token=token)
        if not existing:
            return
        existing.is_deleted = True
        existing.deleted_at = datetime.utcnow()
        existing.deleted_by_id = user_id
        existing.updated_by_id = user_id
        self.session.add(existing)

    def _soft_delete_all_adjustments_for_lancamento(self, *, empresa_id: int, lancamento_id: int, user_id: int) -> None:
        token_prefix = f"AUTO_AJUSTE:{lancamento_id}:"
        related = self.session.exec(
            select(Lancamento).where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.origem == "AJUSTE_DIFERENCA",
                Lancamento.observacao.like(f"{token_prefix}%"),
            )
        ).all()
        for item in related:
            item.is_deleted = True
            item.deleted_at = datetime.utcnow()
            item.deleted_by_id = user_id
            item.updated_by_id = user_id
            self.session.add(item)

    def _upsert_auto_adjustment(self, lancamento: Lancamento, *, user_id: int) -> None:
        if lancamento.id is None:
            return
        if self._is_transferencia(lancamento):
            return
        if str(lancamento.origem or "").upper() == "AJUSTE_DIFERENCA":
            return

        empresa_tipo = self._get_empresa_tipo_pessoa(int(lancamento.empresa_id))
        config = crud_auto_adjustment_config.get_for_empresa(
            self.session,
            empresa_id=int(lancamento.empresa_id),
            tipo_pessoa=empresa_tipo,
        )

        if not lancamento.data_pagamento:
            self._soft_delete_adjustment(empresa_id=int(lancamento.empresa_id), lancamento_id=int(lancamento.id), kind="juros_multa", user_id=user_id)
            self._soft_delete_adjustment(empresa_id=int(lancamento.empresa_id), lancamento_id=int(lancamento.id), kind="descontos", user_id=user_id)
            return

        valor_previsto = Decimal(lancamento.valor_previsto or Decimal("0.00"))
        valor_pago = Decimal(lancamento.valor_pago or Decimal("0.00"))
        delta = valor_pago - valor_previsto

        kind: Optional[str] = None
        amount = Decimal("0.00")
        tipo_lanc = str(lancamento.tipo or "").upper()

        if tipo_lanc == "DESPESA" and delta > 0:
            kind = "juros_multa"
            amount = delta
        elif tipo_lanc == "RECEITA" and delta < 0:
            kind = "descontos"
            amount = abs(delta)

        for extra_kind in ("juros_multa", "descontos"):
            if extra_kind != kind:
                self._soft_delete_adjustment(empresa_id=int(lancamento.empresa_id), lancamento_id=int(lancamento.id), kind=extra_kind, user_id=user_id)

        if not kind or amount <= 0:
            return

        target_cfg = (config or {}).get(kind) or {}
        preferred_category_id = int(target_cfg.get("plano_contas_id")) if target_cfg.get("plano_contas_id") is not None else None
        categoria_nome = str(target_cfg.get("categoria_nome") or ("Juros e Multas" if kind == "juros_multa" else "Descontos Concedidos"))
        categoria_tipo = str(target_cfg.get("tipo") or "D")
        categoria_dre = str(target_cfg.get("dre_grupo") or ("OUTRAS_DESPESAS" if kind == "juros_multa" else "DEDUCOES_RECEITA"))
        categoria_id = self._resolve_adjust_category(
            empresa_id=int(lancamento.empresa_id),
            nome=categoria_nome,
            tipo=categoria_tipo,
            dre_grupo=categoria_dre,
            user_id=user_id,
            preferred_category_id=preferred_category_id,
        )

        token = self._auto_adjust_token(int(lancamento.id), kind)
        existing = self._find_adjustment_by_token(empresa_id=int(lancamento.empresa_id), token=token)
        descricao_kind = "Juros/Multa" if kind == "juros_multa" else "Desconto"
        base_date = lancamento.data_pagamento or lancamento.data_vencimento

        if existing:
            existing.descricao = f"Ajuste automatico ({descricao_kind}) - {lancamento.descricao}"
            existing.tipo = "DESPESA" if categoria_tipo.upper().startswith("D") else "RECEITA"
            existing.valor_previsto = amount
            existing.valor_pago = amount
            existing.valor_juros = amount if kind == "juros_multa" else Decimal("0.00")
            existing.valor_multa = Decimal("0.00")
            existing.valor_desconto = amount if kind == "descontos" else Decimal("0.00")
            existing.status = "PAGO"
            existing.previsto = True
            existing.data_pagamento = base_date
            existing.data_vencimento = base_date
            existing.data_competencia = base_date
            existing.competencia = self._format_competencia(base_date)
            existing.plano_contas_id = categoria_id
            existing.conta_id = lancamento.conta_id
            existing.entidade_id = lancamento.entidade_id
            existing.centro_custo_id = lancamento.centro_custo_id
            existing.cartao_id = lancamento.cartao_id
            existing.updated_by_id = user_id
            existing.is_deleted = False
            existing.deleted_at = None
            existing.deleted_by_id = None
            self.session.add(existing)
            return

        ajuste = Lancamento(
            descricao=f"Ajuste automatico ({descricao_kind}) - {lancamento.descricao}",
            tipo="DESPESA" if categoria_tipo.upper().startswith("D") else "RECEITA",
            status="PAGO",
            origem="AJUSTE_DIFERENCA",
            ipp=False,
            previsto=True,
            valor_previsto=amount,
            valor_pago=amount,
            valor_juros=amount if kind == "juros_multa" else Decimal("0.00"),
            valor_multa=Decimal("0.00"),
            valor_desconto=amount if kind == "descontos" else Decimal("0.00"),
            data_vencimento=base_date,
            data_pagamento=base_date,
            data_competencia=base_date,
            competencia=self._format_competencia(base_date),
            observacao=token,
            conciliado=lancamento.conciliado,
            empresa_id=lancamento.empresa_id,
            plano_contas_id=categoria_id,
            conta_id=lancamento.conta_id,
            entidade_id=lancamento.entidade_id,
            cartao_id=lancamento.cartao_id,
            centro_custo_id=lancamento.centro_custo_id,
            created_by_id=user_id,
            updated_by_id=user_id,
        )
        self.session.add(ajuste)

    # --- Métodos CRUD Básicos ---

    def create(self, dados: LancamentoCreate, empresa_id: int, user_id: int) -> Lancamento:
        # Converte para dict para ajustar campos opcionais antes de instanciar o modelo
        payload = dados.model_dump()
        payload.setdefault("previsto", True)
        if not payload.get("data_competencia"):
            payload["data_competencia"] = payload.get("data_vencimento")
        if not payload.get("competencia") and payload.get("data_vencimento"):
            payload["competencia"] = self._format_competencia(payload["data_vencimento"])
        if payload.get("competencia"):
            self._validate_competencia(payload["competencia"])

        if payload.get("status") == "PAGO" and not payload.get("data_pagamento"):
            payload["data_pagamento"] = payload.get("data_vencimento")

        self._ensure_id_parcelamento(payload)

        self._validate_entidade_required(payload, operation="criação")

        db_lancamento = Lancamento(**payload)
        db_lancamento.empresa_id = empresa_id
        db_lancamento.created_by_id = user_id
        db_lancamento.updated_by_id = user_id
        
        # Aplica a regra de negócio (Data Pagamento x Status)
        self._aplicar_regras_negocio(db_lancamento)

        self.session.add(db_lancamento)
        self.session.flush()
        self._upsert_auto_adjustment(db_lancamento, user_id=user_id)
        self.session.commit()
        self.session.refresh(db_lancamento)
        return db_lancamento
    def get_by_id(self, lancamento_id: int, empresa_id: int) -> Lancamento:
        query = select(Lancamento).where(
            Lancamento.id == lancamento_id,
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )
        lancamento = self.session.exec(query).first()
        if not lancamento:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lançamento não encontrado.")
        return lancamento

    def listar(self, empresa_id: int, skip: int = 0, limit: int = 100, data_inicio: Optional[date] = None, data_fim: Optional[date] = None) -> List[Lancamento]:
        query = select(Lancamento).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )
        if data_inicio:
            query = query.where(Lancamento.data_vencimento >= data_inicio)
        if data_fim:
            query = query.where(Lancamento.data_vencimento <= data_fim)
            
        # Ordena por vencimento
        query = query.offset(skip).limit(limit).order_by(asc(Lancamento.data_vencimento))
        
        return list(self.session.exec(query).all())

    def listar_por_parcelamento(self, parcelamento_id: str, empresa_id: int) -> List[Lancamento]:
        query = select(Lancamento).where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
            Lancamento.id_parcelamento == parcelamento_id,
        ).order_by(asc(Lancamento.numero_parcela), asc(Lancamento.data_vencimento), asc(Lancamento.id))
        return list(self.session.exec(query).all())

    def update(self, lancamento_id: int, dados_atualizacao: LancamentoUpdate, empresa_id: int, user_id: int) -> Lancamento:
        db_lancamento = self.get_by_id(lancamento_id, empresa_id)
        if self._is_transferencia(db_lancamento):
            raise HTTPException(status_code=400, detail="Transferências internas não podem ser editadas.")
        dados_dict = dados_atualizacao.dict(exclude_unset=True)

        if "competencia" in dados_dict:
            self._validate_competencia(dados_dict["competencia"])

        if "data_vencimento" in dados_dict and "competencia" not in dados_dict:
            dados_dict["competencia"] = self._format_competencia(dados_dict["data_vencimento"])

        if "entidade_id" in dados_dict and dados_dict.get("entidade_id") in (None, "", 0, "0"):
            raise HTTPException(status_code=400, detail="Interessado é obrigatório para atualização de lançamento.")

        for key, value in dados_dict.items():
            setattr(db_lancamento, key, value)

        # Reaplica regras (caso a data de pagamento tenha mudado ou sido removida)
        if "data_pagamento" in dados_dict:
            self._aplicar_regras_negocio(db_lancamento)
        elif dados_dict.get("status") == "PAGO" and not db_lancamento.data_pagamento:
            db_lancamento.data_pagamento = db_lancamento.data_vencimento
            self._aplicar_regras_negocio(db_lancamento)

        db_lancamento.updated_by_id = user_id
        db_lancamento.updated_at = datetime.utcnow()

        self.session.add(db_lancamento)
        self.session.flush()
        self._upsert_auto_adjustment(db_lancamento, user_id=user_id)
        self.session.commit()
        self.session.refresh(db_lancamento)
        return db_lancamento
    def delete(self, lancamento_id: int, empresa_id: int, user_id: int, confirmar_exclusao_pagos: bool = False):
        lancamento = self.get_by_id(lancamento_id, empresa_id)
        if self._is_compensado_ou_pago(lancamento) and not confirmar_exclusao_pagos:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Lancamento compensado/pago so pode ser excluido com confirmacao explicita do usuario.",
            )
        delete_ids = self._find_transfer_related_ids(lancamento) if self._is_transferencia(lancamento) else {int(lancamento.id)}
        related = self.session.exec(
            select(Lancamento).where(
                col(Lancamento.id).in_(list(delete_ids)),
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
            )
        ).all()
        if not confirmar_exclusao_pagos:
            bloqueados = [item for item in related if self._is_compensado_ou_pago(item)]
            if bloqueados:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Ha lancamentos compensados/pagos no escopo da exclusao. Confirme explicitamente para prosseguir.",
                )
        for item in related:
            item.is_deleted = True
            item.deleted_at = datetime.utcnow()
            item.deleted_by_id = user_id
            self.session.add(item)
            if item.id is not None:
                self._soft_delete_all_adjustments_for_lancamento(
                    empresa_id=empresa_id,
                    lancamento_id=int(item.id),
                    user_id=user_id,
                )
        self.session.commit()

    # --- Gestão de Anexos ---
    def adicionar_anexo(self, lancamento_id: int, dados_anexo: AnexoCreate, empresa_id: int, user_id: int) -> AnexoLancamento:
        self.get_by_id(lancamento_id, empresa_id) 
        novo_anexo = AnexoLancamento.from_orm(dados_anexo)
        novo_anexo.lancamento_id = lancamento_id
        novo_anexo.empresa_id = empresa_id
        novo_anexo.created_by_id = user_id
        
        self.session.add(novo_anexo)
        self.session.commit()
        self.session.refresh(novo_anexo)
        return novo_anexo
    
    # --- MÉTODOS BULK ---

    def criar_em_massa(self, lista_dados: List[LancamentoCreate], empresa_id: int, user_id: int) -> List[Lancamento]:
        novos_objetos = []
        payloads = [dados.model_dump() for dados in lista_dados]
        self._normalize_bulk_parcelamento_ids(payloads)

        for payload in payloads:
            payload.setdefault("previsto", True)
            if not payload.get("data_competencia"):
                payload["data_competencia"] = payload.get("data_vencimento")
            if not payload.get("competencia") and payload.get("data_vencimento"):
                payload["competencia"] = self._format_competencia(payload["data_vencimento"])
            if payload.get("competencia"):
                self._validate_competencia(payload["competencia"])

            if payload.get("status") == "PAGO" and not payload.get("data_pagamento"):
                payload["data_pagamento"] = payload.get("data_vencimento")

            self._ensure_id_parcelamento(payload)

            self._validate_entidade_required(payload, operation="criação em massa")

            obj = Lancamento(**payload)
            obj.empresa_id = empresa_id
            obj.created_by_id = user_id
            obj.updated_by_id = user_id
            self._aplicar_regras_negocio(obj)
            self.session.add(obj)
            novos_objetos.append(obj)
        
        self.session.flush()
        for obj in novos_objetos:
            self._upsert_auto_adjustment(obj, user_id=user_id)
        self.session.commit()
        for obj in novos_objetos:
            self.session.refresh(obj)
        return novos_objetos
    def deletar_em_massa(self, ids: List[int], empresa_id: int, user_id: int, confirmar_exclusao_pagos: bool = False):
        statement = select(Lancamento).where(
            col(Lancamento.id).in_(ids),
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False,
        )
        lancamentos = self.session.exec(statement).all()
        ids_para_deletar: set[int] = set()
        for lanc in lancamentos:
            if self._is_transferencia(lanc):
                ids_para_deletar.update(self._find_transfer_related_ids(lanc))
            elif lanc.id is not None:
                ids_para_deletar.add(int(lanc.id))

        if not ids_para_deletar:
            return

        related = self.session.exec(
            select(Lancamento).where(
                col(Lancamento.id).in_(list(ids_para_deletar)),
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
            )
        ).all()
        if not confirmar_exclusao_pagos:
            bloqueados = [lanc for lanc in related if self._is_compensado_ou_pago(lanc)]
            if bloqueados:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Existem lancamentos compensados/pagos na selecao. Para excluir, confirme explicitamente.",
                )
        for lanc in related:
            lanc.is_deleted = True
            lanc.deleted_at = datetime.utcnow()
            lanc.deleted_by_id = user_id
            self.session.add(lanc)
            if lanc.id is not None:
                self._soft_delete_all_adjustments_for_lancamento(
                    empresa_id=empresa_id,
                    lancamento_id=int(lanc.id),
                    user_id=user_id,
                )
        self.session.commit()

    def baixar_em_massa(self, ids: List[int], data_pagamento: date, conta_id: Optional[int], empresa_id: int, user_id: int) -> int:
        statement = select(Lancamento).where(
            col(Lancamento.id).in_(ids),
            Lancamento.empresa_id == empresa_id,
            Lancamento.is_deleted == False
        )
        lancamentos = self.session.exec(statement).all()
        if any(self._is_transferencia(lanc) for lanc in lancamentos):
            raise HTTPException(status_code=400, detail="Transferências internas não podem ser alteradas em lote.")
        count = 0
        data_efetiva = data_pagamento or date.today()

        for lanc in lancamentos:
            lanc.status = "PAGO"
            lanc.data_pagamento = data_efetiva
            if conta_id:
                lanc.conta_id = conta_id
            if not lanc.valor_pago or lanc.valor_pago == 0:
                lanc.valor_pago = lanc.valor_previsto
            lanc.updated_by_id = user_id
            lanc.updated_at = datetime.utcnow()
            self.session.add(lanc)
            self.session.flush()
            self._upsert_auto_adjustment(lanc, user_id=user_id)
            count += 1
            
        self.session.commit()
        return count
    def atualizar_em_massa(self, payload: BulkUpdateSchema, empresa_id: int, user_id: int) -> dict:
        statement = select(Lancamento).where(
            col(Lancamento.id).in_(payload.ids),
            Lancamento.empresa_id == empresa_id
        )
        lancamentos = self.session.exec(statement).all()
        if any(self._is_transferencia(lanc) for lanc in lancamentos):
            raise HTTPException(status_code=400, detail="Transferências internas não podem ser alteradas em lote.")
        
        sucesso = 0
        erros = []
        dados_dict = payload.dict(exclude={"ids"}, exclude_unset=True)
        if "competencia" in dados_dict:
            self._validate_competencia(dados_dict["competencia"])

        for lanc in lancamentos:
            try:
                for key, value in dados_dict.items():
                    setattr(lanc, key, value)
                
                # Reaplica regra se mudou data
                if "data_pagamento" in dados_dict:
                    self._aplicar_regras_negocio(lanc)
                elif dados_dict.get("status") == "PAGO" and not lanc.data_pagamento:
                    lanc.data_pagamento = lanc.data_vencimento
                    self._aplicar_regras_negocio(lanc)

                lanc.updated_by_id = user_id
                self.session.add(lanc)
                self.session.flush()
                self._upsert_auto_adjustment(lanc, user_id=user_id)
                sucesso += 1
            except Exception as e:
                erros.append(f"Erro ID {lanc.id}: {str(e)}")
        
        self.session.commit()
        return {"sucesso": True, "atualizados": sucesso, "erros": erros}

    def transferir(self, dados: TransferenciaCreate, empresa_id: int, user_id: int):
        # 1. Busca os Nomes das Contas (Origem e Destino)
        conta_origem = self.session.get(Conta, dados.conta_origem_id)
        conta_destino = self.session.get(Conta, dados.conta_destino_id)

        if not conta_origem or not conta_destino:
            raise HTTPException(status_code=404, detail="Conta de origem ou destino não encontrada.")
        if dados.conta_origem_id == dados.conta_destino_id:
            raise HTTPException(status_code=400, detail="Selecione contas diferentes para a transferência.")

        descricao_transf = f"Transf de {conta_origem.nome} para {conta_destino.nome}"
        categoria_transferencia = crud_plano_contas.ensure_transfer_category(self.session, empresa_id=empresa_id)
        grupo_id = str(uuid.uuid4())

        saida = Lancamento(
            descricao=descricao_transf,
            tipo="DESPESA",
            valor_previsto=dados.valor,
            valor_pago=dados.valor,
            data_vencimento=dados.data,
            data_pagamento=dados.data,
            data_competencia=dados.data,
            competencia=self._format_competencia(dados.data),
            previsto=True,
            conta_id=dados.conta_origem_id,
            status="PAGO",
            origem="TRANSFERENCIA",
            empresa_id=empresa_id,
            plano_contas_id=int(categoria_transferencia.id), 
            centro_custo_id=dados.centro_custo_id,
            transferencia_grupo_id=grupo_id,
            created_by_id=user_id,
            observacao=dados.observacao
        )
        
        entrada = Lancamento(
            descricao=descricao_transf,
            tipo="RECEITA",
            valor_previsto=dados.valor,
            valor_pago=dados.valor,
            data_vencimento=dados.data,
            data_pagamento=dados.data,
            data_competencia=dados.data,
            competencia=self._format_competencia(dados.data),
            previsto=True,
            conta_id=dados.conta_destino_id,
            status="PAGO",
            origem="TRANSFERENCIA",
            empresa_id=empresa_id,
            plano_contas_id=int(categoria_transferencia.id),
            centro_custo_id=dados.centro_custo_id,
            transferencia_grupo_id=grupo_id,
            created_by_id=user_id,
            observacao=dados.observacao
        )

        self.session.add(saida)
        self.session.add(entrada)
        self.session.commit()
        return {"msg": "Transferência realizada", "ids": [saida.id, entrada.id]}