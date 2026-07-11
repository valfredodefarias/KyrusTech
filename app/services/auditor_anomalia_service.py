import math
from typing import Optional, Dict, Any, List
from decimal import Decimal
from datetime import date, datetime, timedelta
from sqlmodel import Session, select

from app.models.alerta_anomalia import AlertaAnomalia
from app.models.lancamento import Lancamento
from app.models.movimento import Movimento
from app.models.baixa import Baixa
from app.models.conta import Conta
from app.models.regra_silenciamento_auditor import RegraSilenciamentoAuditor

class AuditorAnomaliaService:
    def __init__(self, session: Session):
        self.session = session

    def _is_silenced(self, tipo: str, plano_contas_id: Optional[int] = None, entidade_id: Optional[int] = None, valor: Optional[float] = None, empresa_id: Optional[int] = None) -> bool:
        """
        Verifica se existe uma regra de silenciamento correspondente aos dados da transação.
        """
        query = select(RegraSilenciamentoAuditor).where(
            RegraSilenciamentoAuditor.tipo_anomalia == tipo,
            RegraSilenciamentoAuditor.empresa_id == empresa_id,
            RegraSilenciamentoAuditor.is_deleted == False
        )
        regras = self.session.exec(query).all()
        for r in regras:
            if r.plano_contas_id is not None and r.plano_contas_id != plano_contas_id:
                continue
            if r.entidade_id is not None and r.entidade_id != entidade_id:
                continue
            if r.valor_limite is not None and valor is not None and valor > r.valor_limite:
                continue
            return True
        return False

    def analisar_lancamento(self, lancamento: Lancamento) -> List[AlertaAnomalia]:
        """
        Executa análises em um lançamento (ao criar ou atualizar) e gera alertas de anomalias se necessário.
        """
        alertas = []
        if not lancamento.id:
            return alertas

        # Evitar duplicar alertas idênticos pendentes
        def alerta_ja_existe(tipo: str) -> bool:
            existente = self.session.exec(
                select(AlertaAnomalia).where(
                    AlertaAnomalia.tipo_objeto == "lancamento",
                    AlertaAnomalia.objeto_id == lancamento.id,
                    AlertaAnomalia.tipo_anomalia == tipo,
                    AlertaAnomalia.status == "PENDENTE",
                    AlertaAnomalia.empresa_id == lancamento.empresa_id
                )
            ).first()
            return existente is not None

        # 1. VALOR_ATIPICO (Z-Score Adaptativo)
        # Regra: Se o valor for maior que a média + 3 * desvio padrão dos últimos 180 dias.
        # Requer pelo menos 5 lançamentos históricos, desvio > R$ 100 e valor > 1.5 * média.
        if lancamento.plano_contas_id and lancamento.valor_previsto > 0:
            seis_meses_atras = date.today() - timedelta(days=180)
            historico = self.session.exec(
                select(Lancamento.valor_previsto)
                .where(
                    Lancamento.plano_contas_id == lancamento.plano_contas_id,
                    Lancamento.empresa_id == lancamento.empresa_id,
                    Lancamento.id != lancamento.id,
                    Lancamento.data_vencimento >= seis_meses_atras,
                    Lancamento.is_deleted == False
                )
            ).all()

            if len(historico) >= 5:
                valores = [float(val) for val in historico]
                media = sum(valores) / len(valores)
                variancia = sum((x - media) ** 2 for x in valores) / len(valores)
                desvio_padrao = math.sqrt(variancia)
                valor_atual = float(lancamento.valor_previsto)

                limite = media + (3 * desvio_padrao)
                ultrapassa_absoluto = (valor_atual - media) > 100.0
                ultrapassa_percentual = valor_atual >= (media * 1.5)

                if valor_atual > limite and ultrapassa_absoluto and ultrapassa_percentual and not alerta_ja_existe("VALOR_ATIPICO"):
                    if not self._is_silenced("VALOR_ATIPICO", plano_contas_id=lancamento.plano_contas_id, entidade_id=lancamento.entidade_id, valor=valor_atual, empresa_id=lancamento.empresa_id):
                        alerta = AlertaAnomalia(
                            tipo_objeto="lancamento",
                            objeto_id=lancamento.id,
                            tipo_anomalia="VALOR_ATIPICO",
                            gravidade="MEDIA",
                            descricao=f"Valor R$ {lancamento.valor_previsto:.2f} é atípico para o plano de contas. Média histórica de R$ {media:.2f} (limite: R$ {limite:.2f}).",
                            dados_extras={
                                "media": media,
                                "desvio_padrao": desvio_padrao,
                                "valor_atual": valor_atual,
                                "limite_calculado": limite
                            },
                            empresa_id=lancamento.empresa_id
                        )
                        alertas.append(alerta)

        # 2. PAGAMENTO_DUPLO
        if lancamento.valor_previsto > 0 and not alerta_ja_existe("PAGAMENTO_DUPLO"):
            duplicados = self.session.exec(
                select(Lancamento)
                .where(
                    Lancamento.empresa_id == lancamento.empresa_id,
                    Lancamento.id != lancamento.id,
                    Lancamento.valor_previsto == lancamento.valor_previsto,
                    Lancamento.data_vencimento == lancamento.data_vencimento,
                    Lancamento.plano_contas_id == lancamento.plano_contas_id,
                    Lancamento.tipo == lancamento.tipo,
                    Lancamento.is_deleted == False
                )
            ).all()
            if duplicados:
                if not self._is_silenced("PAGAMENTO_DUPLO", plano_contas_id=lancamento.plano_contas_id, entidade_id=lancamento.entidade_id, valor=float(lancamento.valor_previsto), empresa_id=lancamento.empresa_id):
                    alerta = AlertaAnomalia(
                        tipo_objeto="lancamento",
                        objeto_id=lancamento.id,
                        tipo_anomalia="PAGAMENTO_DUPLO",
                        gravidade="ALTA",
                        descricao=f"Possível lançamento ou pagamento duplicado. Outro lançamento de mesmo valor R$ {lancamento.valor_previsto:.2f} e vencimento {lancamento.data_vencimento.strftime('%d/%m/%Y')} foi encontrado.",
                        dados_extras={
                            "lancamento_duplicado_id": duplicados[0].id,
                            "valor": float(lancamento.valor_previsto),
                            "data": lancamento.data_vencimento.isoformat()
                        },
                        empresa_id=lancamento.empresa_id
                    )
                    alertas.append(alerta)

        # 3. DESVIO_PLANO_CONTAS
        if lancamento.entidade_id and lancamento.plano_contas_id and not alerta_ja_existe("DESVIO_PLANO_CONTAS"):
            doze_meses_atras = date.today() - timedelta(days=365)
            historico_entidade = self.session.exec(
                select(Lancamento.plano_contas_id)
                .where(
                    Lancamento.entidade_id == lancamento.entidade_id,
                    Lancamento.empresa_id == lancamento.empresa_id,
                    Lancamento.id != lancamento.id,
                    Lancamento.data_vencimento >= doze_meses_atras,
                    Lancamento.is_deleted == False
                )
            ).all()

            if len(historico_entidade) >= 5:
                counts = {}
                for pid in historico_entidade:
                    counts[pid] = counts.get(pid, 0) + 1
                
                majoritaria_id = max(counts, key=counts.get)
                ocorrencias_maj = counts[majoritaria_id]
                ocorrencias_atual = counts.get(lancamento.plano_contas_id, 0)
                freq_atual = ocorrencias_atual / len(historico_entidade)
                
                if freq_atual < 0.20 and lancamento.plano_contas_id != majoritaria_id:
                    from app.models.plano_contas import PlanoContas
                    plano_maj = self.session.get(PlanoContas, majoritaria_id)
                    plano_atual = self.session.get(PlanoContas, lancamento.plano_contas_id)
                    nome_maj = plano_maj.nome if plano_maj else "Desconhecido"
                    nome_atual = plano_atual.nome if plano_atual else "Desconhecido"
                    
                    if not self._is_silenced("DESVIO_PLANO_CONTAS", plano_contas_id=lancamento.plano_contas_id, entidade_id=lancamento.entidade_id, valor=float(lancamento.valor_previsto), empresa_id=lancamento.empresa_id):
                        alerta = AlertaAnomalia(
                            tipo_objeto="lancamento",
                            objeto_id=lancamento.id,
                            tipo_anomalia="DESVIO_PLANO_CONTAS",
                            gravidade="MEDIA",
                            descricao=f"Classificação incomum de Plano de Contas ({nome_atual}) para esta entidade. Historicamente, a categoria majoritária é {nome_maj} (com {ocorrencias_maj} ocorrências).",
                            dados_extras={
                                "categoria_majoritaria_id": majoritaria_id,
                                "categoria_majoritaria": nome_maj,
                                "categoria_atual": nome_atual,
                                "ocorrencias_majoritaria": ocorrencias_maj,
                                "total_historico_entidade": len(historico_entidade)
                            },
                            empresa_id=lancamento.empresa_id
                        )
                        alertas.append(alerta)

        # 4. HORARIO_ATIPICO
        agora = datetime.utcnow()
        is_horario_risco = agora.hour >= 23 or agora.hour < 5 or agora.weekday() == 6
        if is_horario_risco and not alerta_ja_existe("HORARIO_ATIPICO"):
            if not self._is_silenced("HORARIO_ATIPICO", plano_contas_id=lancamento.plano_contas_id, entidade_id=lancamento.entidade_id, valor=float(lancamento.valor_previsto), empresa_id=lancamento.empresa_id):
                dia_semana = "Domingo" if agora.weekday() == 6 else "Madrugada"
                alerta = AlertaAnomalia(
                    tipo_objeto="lancamento",
                    objeto_id=lancamento.id,
                    tipo_anomalia="HORARIO_ATIPICO",
                    gravidade="MEDIA",
                    descricao=f"Operação realizada em horário incomum ({dia_semana} às {agora.strftime('%H:%M:%S')} UTC).",
                    dados_extras={
                        "horario_registro": agora.isoformat(),
                        "dia_semana": agora.weekday(),
                        "user_id": lancamento.updated_by_id or lancamento.created_by_id
                    },
                    empresa_id=lancamento.empresa_id
                )
                alertas.append(alerta)

        # 5. CONTA_DIVERGENTE
        if lancamento.id and not alerta_ja_existe("CONTA_DIVERGENTE"):
            baixas = self.session.exec(
                select(Baixa).where(Baixa.lancamento_id == lancamento.id, Baixa.is_deleted == False)
            ).all()
            for b in baixas:
                mov = self.session.get(Movimento, b.movimento_id)
                if mov and mov.conta_id != lancamento.conta_id:
                    from app.models.conta import Conta
                    conta_prevista = self.session.get(Conta, lancamento.conta_id)
                    conta_real = self.session.get(Conta, mov.conta_id)
                    nome_prev = conta_prevista.nome if conta_prevista else f"Conta {lancamento.conta_id}"
                    nome_real = conta_real.nome if conta_real else f"Conta {mov.conta_id}"
                    
                    if not self._is_silenced("CONTA_DIVERGENTE", plano_contas_id=lancamento.plano_contas_id, entidade_id=lancamento.entidade_id, valor=float(lancamento.valor_previsto), empresa_id=lancamento.empresa_id):
                        alerta = AlertaAnomalia(
                            tipo_objeto="lancamento",
                            objeto_id=lancamento.id,
                            tipo_anomalia="CONTA_DIVERGENTE",
                            gravidade="MEDIA",
                            descricao=f"Divergência de conta bancária. Lançamento previsto na conta '{nome_prev}', mas liquidado na conta '{nome_real}'.",
                            dados_extras={
                                "conta_planejada_id": lancamento.conta_id,
                                "conta_real_id": mov.conta_id,
                                "movimento_id": mov.id,
                                "baixa_id": b.id
                            },
                            empresa_id=lancamento.empresa_id
                        )
                        alertas.append(alerta)
                        break

        # 6. LANCAMENTO_SEM_COMPROVANTE
        if (lancamento.status == "PAGO" or lancamento.conciliado) and lancamento.valor_previsto >= Decimal("5000.00") and not alerta_ja_existe("LANCAMENTO_SEM_COMPROVANTE"):
            from app.models.anexo_lancamento import AnexoLancamento
            anexos = self.session.exec(
                select(AnexoLancamento).where(AnexoLancamento.lancamento_id == lancamento.id, AnexoLancamento.is_deleted == False)
            ).all()
            if not anexos:
                if not self._is_silenced("LANCAMENTO_SEM_COMPROVANTE", plano_contas_id=lancamento.plano_contas_id, entidade_id=lancamento.entidade_id, valor=float(lancamento.valor_previsto), empresa_id=lancamento.empresa_id):
                    alerta = AlertaAnomalia(
                        tipo_objeto="lancamento",
                        objeto_id=lancamento.id,
                        tipo_anomalia="LANCAMENTO_SEM_COMPROVANTE",
                        gravidade="MEDIA",
                        descricao=f"Pagamento de alto valor (R$ {lancamento.valor_previsto:.2f}) realizado sem comprovação fiscal/anexo cadastrado.",
                        dados_extras={
                            "valor": float(lancamento.valor_previsto)
                        },
                        empresa_id=lancamento.empresa_id
                    )
                    alertas.append(alerta)

        for a in alertas:
            self.session.add(a)
        if alertas:
            self.session.commit()
        return alertas

    def analisar_movimento(self, movimento: Movimento) -> List[AlertaAnomalia]:
        """
        Executa análises em um movimento bancário (OFX/Open Finance) para detectar anomalias.
        """
        alertas = []
        if not movimento.id:
            return alertas

        def alerta_ja_existe(tipo: str) -> bool:
            existente = self.session.exec(
                select(AlertaAnomalia).where(
                    AlertaAnomalia.tipo_objeto == "movimento",
                    AlertaAnomalia.objeto_id == movimento.id,
                    AlertaAnomalia.tipo_anomalia == tipo,
                    AlertaAnomalia.status == "PENDENTE",
                    AlertaAnomalia.empresa_id == movimento.empresa_id
                )
            ).first()
            return existente is not None

        # 1. DUPLICIDADE_OFX
        if not alerta_ja_existe("DUPLICIDADE_OFX"):
            query = select(Movimento).where(
                Movimento.empresa_id == movimento.empresa_id,
                Movimento.conta_id == movimento.conta_id,
                Movimento.id != movimento.id,
                Movimento.descricao == movimento.descricao,
                Movimento.valor == movimento.valor,
                Movimento.data == movimento.data,
                Movimento.is_deleted == False
            )

            duplicados = self.session.exec(query).all()
            if duplicados:
                if not self._is_silenced("DUPLICIDADE_OFX", valor=float(movimento.valor), empresa_id=movimento.empresa_id):
                    alerta = AlertaAnomalia(
                        tipo_objeto="movimento",
                        objeto_id=movimento.id,
                        tipo_anomalia="DUPLICIDADE_OFX",
                        gravidade="ALTA",
                        descricao=f"Movimento de extrato duplicado detectado. Outro registro idêntico com valor R$ {movimento.valor:.2f} e data {movimento.data.strftime('%d/%m/%Y')} já existe na conta.",
                        dados_extras={
                            "movimento_duplicado_id": duplicados[0].id,
                            "import_hash": movimento.import_hash
                        },
                        empresa_id=movimento.empresa_id
                    )
                    alertas.append(alerta)

        # 2. HORARIO_ATIPICO
        agora = datetime.utcnow()
        is_horario_risco = agora.hour >= 23 or agora.hour < 5 or agora.weekday() == 6
        if is_horario_risco and not alerta_ja_existe("HORARIO_ATIPICO"):
            if not self._is_silenced("HORARIO_ATIPICO", valor=float(movimento.valor), empresa_id=movimento.empresa_id):
                dia_semana = "Domingo" if agora.weekday() == 6 else "Madrugada"
                alerta = AlertaAnomalia(
                    tipo_objeto="movimento",
                    objeto_id=movimento.id,
                    tipo_anomalia="HORARIO_ATIPICO",
                    gravidade="MEDIA",
                    descricao=f"Movimento importado ou criado em horário incomum ({dia_semana} às {agora.strftime('%H:%M:%S')} UTC).",
                    dados_extras={
                        "horario_registro": agora.isoformat(),
                        "dia_semana": agora.weekday()
                    },
                    empresa_id=movimento.empresa_id
                )
                alertas.append(alerta)

        for a in alertas:
            self.session.add(a)
        if alertas:
            self.session.commit()
        return alertas

    def analisar_exclusao(self, lancamento: Lancamento) -> Optional[AlertaAnomalia]:
        """
        Gera alertas de exclusão suspeita (EXCLUSAO_SUSPEITA) se um lançamento de alto valor ou já pago/conciliado for excluído.
        """
        era_pago = lancamento.status == "PAGO" or lancamento.conciliado
        alto_valor = lancamento.valor_previsto >= Decimal("10000.00")

        if (era_pago or alto_valor) and lancamento.id:
            motivo = []
            if era_pago:
                motivo.append("estava marcado como PAGO/conciliado")
            if alto_valor:
                motivo.append("possui alto valor (>= R$ 10.000,00)")
            
            descricao = f"Exclusão suspeita detectada. O lançamento '{lancamento.descricao}' ({', '.join(motivo)}) foi excluído."
            
            if not self._is_silenced("EXCLUSAO_SUSPEITA", plano_contas_id=lancamento.plano_contas_id, entidade_id=lancamento.entidade_id, valor=float(lancamento.valor_previsto), empresa_id=lancamento.empresa_id):
                alerta = AlertaAnomalia(
                    tipo_objeto="lancamento",
                    objeto_id=lancamento.id,
                    tipo_anomalia="EXCLUSAO_SUSPEITA",
                    gravidade="CRITICA",
                    descricao=descricao,
                    dados_extras={
                        "valor": float(lancamento.valor_previsto),
                        "status_anterior": lancamento.status,
                        "conciliado_anterior": lancamento.conciliado,
                        "data_exclusao": datetime.utcnow().isoformat()
                    },
                    empresa_id=lancamento.empresa_id
                )
                self.session.add(alerta)
                self.session.commit()
                return alerta
        return None

    def gerar_alerta_brute_force(self, email: str, ip_address: str, empresa_id: int) -> AlertaAnomalia:
        """
        Cria um alerta crítico de LOGIN_BRUTE_FORCE.
        """
        existente = self.session.exec(
            select(AlertaAnomalia).where(
                AlertaAnomalia.tipo_objeto == "usuario",
                AlertaAnomalia.tipo_anomalia == "LOGIN_BRUTE_FORCE",
                AlertaAnomalia.status == "PENDENTE",
                AlertaAnomalia.empresa_id == empresa_id
            )
        ).first()
        if existente:
            return existente

        alerta = AlertaAnomalia(
            tipo_objeto="usuario",
            objeto_id=0,
            tipo_anomalia="LOGIN_BRUTE_FORCE",
            gravidade="CRITICA",
            descricao=f"Múltiplas tentativas de login malsucedidas ({email}) a partir do IP {ip_address}.",
            dados_extras={
                "email": email,
                "ip_address": ip_address,
                "horario_registro": datetime.utcnow().isoformat()
            },
            empresa_id=empresa_id
        )
        self.session.add(alerta)
        self.session.commit()
        return alerta

    def analisar_alteracao_conta(self, conta: Conta, old_fields: dict) -> Optional[AlertaAnomalia]:
        """
        Monitora alterações de dados bancários de contas se houver lançamentos programados para os próximos 7 dias.
        """
        banco_mudou = old_fields.get("agencia") != conta.agencia or old_fields.get("conta_numero") != conta.conta_numero
        if not banco_mudou:
            return None

        hoje = date.today()
        sete_dias = hoje + timedelta(days=7)
        lancamentos_pendentes = self.session.exec(
            select(Lancamento).where(
                Lancamento.conta_id == conta.id,
                Lancamento.empresa_id == conta.empresa_id,
                Lancamento.status == "EM ABERTO",
                Lancamento.data_vencimento >= hoje,
                Lancamento.data_vencimento <= sete_dias,
                Lancamento.is_deleted == False
            )
        ).all()

        if lancamentos_pendentes:
            if not self._is_silenced("ALTERACAO_DADOS_BANCARIOS", valor=None, empresa_id=conta.empresa_id):
                alerta = AlertaAnomalia(
                    tipo_objeto="conta",
                    objeto_id=conta.id,
                    tipo_anomalia="ALTERACAO_DADOS_BANCARIOS",
                    gravidade="ALTA",
                    descricao=f"Alteração de dados bancários da conta '{conta.nome}' com {len(lancamentos_pendentes)} lançamentos programados nos próximos 7 dias.",
                    dados_extras={
                        "conta_id": conta.id,
                        "agencia_antiga": old_fields.get("agencia"),
                        "agencia_nova": conta.agencia,
                        "conta_antiga": old_fields.get("conta_numero"),
                        "conta_nova": conta.conta_numero,
                        "lancamentos_afetados_count": len(lancamentos_pendentes)
                    },
                    empresa_id=conta.empresa_id
                )
                self.session.add(alerta)
                self.session.commit()
                return alerta
        return None

    def analisar_regra_silenciamento(self, regra: RegraSilenciamentoAuditor) -> Optional[AlertaAnomalia]:
        """
        Monitora se uma regra de silenciamento de anomalias de alta gravidade foi criada.
        """
        anomalias_criticas = ["LOGIN_BRUTE_FORCE", "ALTERACAO_DADOS_BANCARIOS", "EXCLUSAO_SUSPEITA", "DUPLICIDADE_OFX", "PAGAMENTO_DUPLO"]
        if regra.tipo_anomalia in anomalias_criticas:
            alerta = AlertaAnomalia(
                tipo_objeto="regra_silenciamento",
                objeto_id=regra.id or 0,
                tipo_anomalia="SILENCIAMENTO_SUSPEITO",
                gravidade="ALTA",
                descricao=f"Nova regra de silenciamento suspeita cadastrada para o tipo '{regra.tipo_anomalia}' (desativação de monitoramento de risco).",
                dados_extras={
                    "regra_id": regra.id,
                    "tipo_anomalia_silenciada": regra.tipo_anomalia,
                    "plano_contas_id": regra.plano_contas_id,
                    "entidade_id": regra.entidade_id
                },
                empresa_id=regra.empresa_id
            )
            self.session.add(alerta)
            self.session.commit()
            return alerta
        return None
