"""
Motor de Machine Learning Preditivo por Empresa para Classificação Financeira.
Aprende continuamente com o histórico de lançamentos e movimentações de cada empresa (multi-tenant estrito).
Utiliza vetorização N-gram ponderada por TF-IDF simplificado, decaimento temporal exponencial (recência)
e Classificação Probabilística Bayesiana Multivariada com Suavização de Laplace.
"""
from __future__ import annotations

import math
import re
import time
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlmodel import Session, select, func

from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.models.centro_custo import CentroCusto
from app.models.entidade import Entidade


def normalizar_texto(texto: Any) -> str:
    if not texto:
        return ""
    texto_str = str(texto)
    nfkd = unicodedata.normalize("NFKD", texto_str)
    sem_acento = "".join(c for c in nfkd if not unicodedata.combining(c))
    limpo = re.sub(r"[^a-zA-Z0-9\s]", " ", sem_acento.lower())
    return re.sub(r"\s+", " ", limpo).strip()


STOPWORDS = {
    "de", "da", "do", "das", "dos", "para", "com", "sem", "por", "via", "pix", "ted", "doc",
    "pgto", "pagamento", "recebimento", "receber", "pagar", "nf", "nfe", "boleto", "transf",
    "transferencia", "saida", "entrada", "em", "na", "no", "nas", "nos", "e", "ou", "a", "o",
    "os", "as", "um", "uma", "uns", "umas", "ref", "referente", "ltda", "me", "epp", "sa",
}


def extrair_ngrams(texto: str) -> List[str]:
    norm = normalizar_texto(texto)
    palavras = [p for p in norm.split() if len(p) >= 2 and p not in STOPWORDS]
    if not palavras:
        return []
    
    tokens = list(palavras)
    # Adicionar bigrams para capturar termos compostos como "sonotec eletronica", "harman brasil"
    for i in range(len(palavras) - 1):
        tokens.append(f"{palavras[i]}_{palavras[i+1]}")
    return tokens


def faixa_valor(valor: float) -> str:
    v = abs(valor)
    if v < 50:
        return "val_micro"
    elif v < 200:
        return "val_pequeno"
    elif v < 1000:
        return "val_medio"
    elif v < 5000:
        return "val_alto"
    else:
        return "val_muito_alto"


@dataclass
class ModeloTreinado:
    empresa_id: int
    data_treinamento: float = field(default_factory=time.time)
    total_amostras: int = 0
    # Contadores de classes
    plano_counts: Counter[int] = field(default_factory=Counter)
    centro_counts: Counter[int] = field(default_factory=Counter)
    entidade_counts: Counter[int] = field(default_factory=Counter)
    # Contadores de features condicionais
    # feature -> class_id -> count_ponderado
    plano_feature_counts: Dict[str, Counter[int]] = field(default_factory=lambda: defaultdict(Counter))
    centro_feature_counts: Dict[str, Counter[int]] = field(default_factory=lambda: defaultdict(Counter))
    entidade_feature_counts: Dict[str, Counter[int]] = field(default_factory=lambda: defaultdict(Counter))
    # Nomes cacheados
    plano_nomes: Dict[int, str] = field(default_factory=dict)
    centro_nomes: Dict[int, str] = field(default_factory=dict)
    entidade_nomes: Dict[int, str] = field(default_factory=dict)


@dataclass
class PrevisaoML:
    plano_contas_id: Optional[int] = None
    plano_contas_nome: Optional[str] = None
    score_plano: float = 0.0

    centro_custo_id: Optional[int] = None
    centro_custo_nome: Optional[str] = None
    score_centro: float = 0.0

    entidade_id: Optional[int] = None
    entidade_nome: Optional[str] = None
    score_entidade: float = 0.0

    confianca_geral: float = 0.0
    features_relevantes: List[str] = field(default_factory=list)
    explicacao: str = ""


class MLLancamentosService:
    """
    Serviço central de Machine Learning Preditivo por Empresa.
    Mantém modelos treinados em memória por empresa com atualização inteligente.
    """
    _cache_modelos: Dict[int, ModeloTreinado] = {}
    CACHE_TTL_SEGUNDOS = 1800  # 30 minutos

    @classmethod
    def invalidar_cache(cls, empresa_id: int) -> None:
        cls._cache_modelos.pop(empresa_id, None)

    @classmethod
    def obter_ou_treinar_modelo(cls, db: Session, empresa_id: int, forcar_retreino: bool = False) -> ModeloTreinado:
        modelo = cls._cache_modelos.get(empresa_id)
        agora = time.time()
        if not forcar_retreino and modelo and (agora - modelo.data_treinamento < cls.CACHE_TTL_SEGUNDOS):
            return modelo

        logger.info(f"[ML] Treinando modelo preditivo para empresa_id={empresa_id}...")
        novo_modelo = cls._treinar_modelo_interno(db, empresa_id)
        cls._cache_modelos[empresa_id] = novo_modelo
        logger.info(
            f"[ML] Modelo treinado com sucesso para empresa_id={empresa_id}: "
            f"{novo_modelo.total_amostras} amostras analisadas."
        )
        return novo_modelo

    @classmethod
    def _treinar_modelo_interno(cls, db: Session, empresa_id: int, max_amostras: int = 10000) -> ModeloTreinado:
        modelo = ModeloTreinado(empresa_id=empresa_id)

        # 1. Carregar nomes de referência
        planos = db.exec(
            select(PlanoContas.id, PlanoContas.codigo, PlanoContas.nome).where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.is_deleted == False,
            )
        ).all()
        for p_id, p_cod, p_nome in planos:
            if p_id is not None:
                rotulo = f"{p_cod} - {p_nome}" if p_cod else str(p_nome)
                modelo.plano_nomes[int(p_id)] = rotulo

        centros = db.exec(
            select(CentroCusto.id, CentroCusto.nome).where(
                CentroCusto.empresa_id == empresa_id,
                CentroCusto.is_deleted == False,
            )
        ).all()
        for c_id, c_nome in centros:
            if c_id is not None:
                modelo.centro_nomes[int(c_id)] = str(c_nome)

        entidades = db.exec(
            select(Entidade.id, Entidade.nome).where(
                Entidade.empresa_id == empresa_id,
                Entidade.is_deleted == False,
            )
        ).all()
        for e_id, e_nome in entidades:
            if e_id is not None:
                modelo.entidade_nomes[int(e_id)] = str(e_nome)

        # 2. Carregar histórico de lançamentos consistentes
        hoje = date.today()
        lancamentos = db.exec(
            select(
                Lancamento.descricao,
                Lancamento.valor_pago,
                Lancamento.valor_previsto,
                Lancamento.tipo,
                Lancamento.data_pagamento,
                Lancamento.data_vencimento,
                Lancamento.plano_contas_id,
                Lancamento.centro_custo_id,
                Lancamento.entidade_id,
            )
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.is_deleted == False,
                Lancamento.plano_contas_id.is_not(None),  # type: ignore[attr-defined]
            )
            .order_by(Lancamento.id.desc())  # type: ignore[attr-defined]
            .limit(max_amostras)
        ).all()

        amostras_count = 0
        meia_vida_dias = 180.0  # Decaimento exponencial: peso cai pela metade a cada 180 dias

        for (
            descricao,
            val_pago,
            val_prev,
            tipo_lanc,
            dt_pag,
            dt_venc,
            p_id,
            c_id,
            e_id,
        ) in lancamentos:
            if not p_id:
                continue

            # Peso temporal baseado na recência
            dt_ref = dt_pag or dt_venc or hoje
            idade_dias = max(0, (hoje - dt_ref).days)
            peso_temporal = math.exp(-0.693 * (idade_dias / meia_vida_dias))
            # Peso mínimo para não ignorar histórico mais antigo
            peso = max(0.15, peso_temporal)

            val_efetivo = float(val_pago or val_prev or 0.0)
            tipo_norm = str(tipo_lanc or "").upper().strip()

            features = cls._extrair_features_lancamento(
                descricao=descricao or "",
                valor=val_efetivo,
                tipo=tipo_norm,
                dt=dt_ref,
            )

            # Acumula no modelo
            p_int = int(p_id)
            modelo.plano_counts[p_int] += peso
            for feat in features:
                modelo.plano_feature_counts[feat][p_int] += peso

            if c_id:
                c_int = int(c_id)
                modelo.centro_counts[c_int] += peso
                for feat in features:
                    modelo.centro_feature_counts[feat][c_int] += peso

            if e_id:
                e_int = int(e_id)
                modelo.entidade_counts[e_int] += peso
                for feat in features:
                    modelo.entidade_feature_counts[feat][e_int] += peso

            amostras_count += 1

        modelo.total_amostras = amostras_count
        return modelo

    @classmethod
    def _extrair_features_lancamento(
        cls,
        descricao: str,
        valor: float,
        tipo: str,
        dt: Optional[date] = None,
        interessado: Optional[str] = None,
    ) -> List[str]:
        features: List[str] = []

        # Tipo (RECEITA / DESPESA)
        if tipo:
            tipo_clean = "tipo_rec" if tipo.startswith("R") else "tipo_desp"
            features.append(tipo_clean)

        # Faixa de valor
        features.append(faixa_valor(valor))

        # N-grams de texto da descrição
        ngrams_desc = extrair_ngrams(descricao)
        for token in ngrams_desc:
            features.append(f"w_{token}")

        # Interessado / Contraparte se fornecido
        if interessado:
            ngrams_int = extrair_ngrams(interessado)
            for token in ngrams_int:
                features.append(f"int_{token}")

        # Sazonalidade (dia da semana / quinzena)
        if dt:
            features.append(f"dow_{dt.weekday()}")
            features.append("quinzena_1" if dt.day <= 15 else "quinzena_2")

        return features

    @classmethod
    def prever(
        cls,
        db: Session,
        empresa_id: int,
        descricao: str,
        valor: float,
        tipo: str,
        data: Optional[date] = None,
        interessado: Optional[str] = None,
        conta_id: Optional[int] = None,
    ) -> PrevisaoML:
        """
        Executa predição bayesiana estruturada para classificação de um movimento financeiro.
        """
        modelo = cls.obter_ou_treinar_modelo(db, empresa_id)
        if modelo.total_amostras < 3:
            # Histórico insuficiente para ML
            return PrevisaoML(explicacao="Histórico insuficiente para predição via Machine Learning.")

        features = cls._extrair_features_lancamento(
            descricao=descricao,
            valor=valor,
            tipo=tipo,
            dt=data,
            interessado=interessado,
        )

        # 1. Predição de Plano de Contas (Categoria)
        pred_plano, score_plano = cls._classificar_bayes(
            features=features,
            class_counts=modelo.plano_counts,
            feature_counts=modelo.plano_feature_counts,
            alpha_laplace=0.8,
        )

        # 2. Predição de Centro de Custo
        pred_centro, score_centro = cls._classificar_bayes(
            features=features,
            class_counts=modelo.centro_counts,
            feature_counts=modelo.centro_feature_counts,
            alpha_laplace=1.0,
        )

        # 3. Predição de Entidade (Fornecedor / Cliente)
        pred_entidade, score_entidade = cls._classificar_bayes(
            features=features,
            class_counts=modelo.entidade_counts,
            feature_counts=modelo.entidade_feature_counts,
            alpha_laplace=1.2,
        )

        # Features relevantes que dispararam a pontuação
        relevantes = [
            f.replace("w_", "").replace("int_", "")
            for f in features
            if f.startswith("w_") or f.startswith("int_")
        ][:6]

        nome_plano = modelo.plano_nomes.get(pred_plano) if pred_plano else None
        nome_centro = modelo.centro_nomes.get(pred_centro) if pred_centro else None
        nome_entidade = modelo.entidade_nomes.get(pred_entidade) if pred_entidade else None

        confianca_geral = round((score_plano * 0.5) + (score_centro * 0.25) + (score_entidade * 0.25), 3)

        partes_expl = []
        if nome_plano and score_plano >= 0.40:
            partes_expl.append(f"Categoria '{nome_plano}' ({int(score_plano*100)}% confiança)")
        if nome_centro and score_centro >= 0.45:
            partes_expl.append(f"Centro '{nome_centro}' ({int(score_centro*100)}%)")
        if nome_entidade and score_entidade >= 0.50:
            partes_expl.append(f"Interessado '{nome_entidade}' ({int(score_entidade*100)}%)")

        explicacao = (
            f"ML Kyrus ({len(relevantes)} termos identificados): " + ", ".join(partes_expl)
            if partes_expl
            else "Predição de baixa certeza estatística baseada em termos gerais."
        )

        return PrevisaoML(
            plano_contas_id=pred_plano if score_plano >= 0.30 else None,
            plano_contas_nome=nome_plano if score_plano >= 0.30 else None,
            score_plano=round(score_plano, 3),
            centro_custo_id=pred_centro if score_centro >= 0.35 else None,
            centro_custo_nome=nome_centro if score_centro >= 0.35 else None,
            score_centro=round(score_centro, 3),
            entidade_id=pred_entidade if score_entidade >= 0.35 else None,
            entidade_nome=nome_entidade if score_entidade >= 0.35 else None,
            score_entidade=round(score_entidade, 3),
            confianca_geral=confianca_geral,
            features_relevantes=relevantes,
            explicacao=explicacao,
        )

    @classmethod
    def _classificar_bayes(
        cls,
        features: List[str],
        class_counts: Counter[int],
        feature_counts: Dict[str, Counter[int]],
        alpha_laplace: float = 1.0,
    ) -> Tuple[Optional[int], float]:
        if not class_counts:
            return None, 0.0

        total_classes_peso = sum(class_counts.values())
        num_classes = len(class_counts)
        if total_classes_peso <= 0:
            return None, 0.0

        # Filtra apenas features que existem no vocabulário aprendido
        features_ativas = [f for f in features if f in feature_counts]
        if not features_ativas:
            # Fallback para classe majoritária a priori
            melhor_id, melhor_cnt = class_counts.most_common(1)[0]
            score_prior = min(0.35, melhor_cnt / total_classes_peso)
            return melhor_id, score_prior

        # Log-posterior para evitar underflow numérico
        log_scores: Dict[int, float] = {}

        for c_id, c_count in class_counts.items():
            # Log Prior P(C)
            prior = (c_count + 1.0) / (total_classes_peso + num_classes)
            log_prob = math.log(prior)

            # Log Likelihoods P(F|C)
            # Total de ocorrências de features nessa classe
            total_feat_class = c_count * len(features_ativas)

            for feat in features_ativas:
                feat_count_in_class = feature_counts[feat].get(c_id, 0.0)
                # Suavização de Laplace
                prob_feat = (feat_count_in_class + alpha_laplace) / (total_feat_class + (alpha_laplace * 100))
                
                # Boost extra para correspondência de tokens de texto específicos
                if feat.startswith("w_") and feat_count_in_class > 0:
                    prob_feat *= 1.5
                elif feat.startswith("int_") and feat_count_in_class > 0:
                    prob_feat *= 2.0

                log_prob += math.log(max(1e-12, prob_feat))

            log_scores[c_id] = log_prob

        # Softmax calibrado para converter log-odds em probabilidades normalizadas (0.0 a 1.0)
        max_log = max(log_scores.values())
        exp_scores = {c_id: math.exp(val - max_log) for c_id, val in log_scores.items()}
        soma_exp = sum(exp_scores.values())

        sorted_cands = sorted(exp_scores.items(), key=lambda x: x[1], reverse=True)
        melhor_id, melhor_exp = sorted_cands[0]
        prob_calibrada = melhor_exp / soma_exp if soma_exp > 0 else 0.0

        # Penalização se a margem sobre o segundo colocado for muito estreita
        if len(sorted_cands) > 1:
            segundo_exp = sorted_cands[1][1]
            margem = (melhor_exp - segundo_exp) / soma_exp
            prob_calibrada = min(prob_calibrada, (prob_calibrada * 0.7) + (margem * 0.3))

        return melhor_id, min(0.99, max(0.0, prob_calibrada))
