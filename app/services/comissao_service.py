# app/services/comissao_service.py
from __future__ import annotations
import json
from datetime import date
from decimal import Decimal
from typing import Dict, List, Any
from sqlmodel import Session, select, or_

from app.models.lancamento import Lancamento
from app.models.produto import Produto


class ComissaoService:
    @staticmethod
    def calcular_faturamento_meta(
        db: Session,
        vendedor_id: int,
        mes: int,
        ano: int,
        empresa_id: int
    ) -> Decimal:
        """
        Calcula o faturamento total do vendedor no mês/ano para fins de meta (escalonamento).
        Exclui lançamentos em 'boleto parcelado' ou 'boleto' que estão em aberto.
        Inclui os lançamentos de boleto que foram pagos no mês correspondente.
        """
        # 1. Buscar lançamentos ativos de receita do vendedor na empresa filtrados pelo mês/ano alvo
        import calendar
        _, last_day = calendar.monthrange(ano, mes)
        start_date = date(ano, mes, 1)
        end_date = date(ano, mes, last_day)

        query = (
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.created_by_id == vendedor_id,
                Lancamento.is_deleted == False,
                Lancamento.tipo == "RECEITA",
                or_(
                    (Lancamento.data_pagamento >= start_date) & (Lancamento.data_pagamento <= end_date),
                    (Lancamento.data_competencia >= start_date) & (Lancamento.data_competencia <= end_date)
                )
            )
        )
        launches = db.exec(query).all()
        
        faturamento_total = Decimal("0.00")
        
        for l in launches:
            # Pegamos o metadado do lançamento se houver
            meta = {}
            if l.observacao:
                try:
                    meta = json.loads(l.observacao)
                except Exception:
                    pass
            
            tipo_pagamento = str(meta.get("tipo_pagamento", "")).lower()
            is_boleto = "boleto" in tipo_pagamento
            
            if is_boleto:
                # Regime de caixa: Só entra se estiver PAGO e se o pagamento foi no mês/ano alvo
                if l.status == "PAGO" and l.data_pagamento:
                    if l.data_pagamento.month == mes and l.data_pagamento.year == ano:
                        # O valor pago entra
                        faturamento_total += Decimal(str(l.valor_previsto or 0))
            else:
                # Outros pagamentos: Entram pelo mês de competência (data da venda)
                if l.data_competencia and l.data_competencia.month == mes and l.data_competencia.year == ano:
                    faturamento_total += Decimal(str(l.valor_previsto or 0))
                    
        return faturamento_total

    @staticmethod
    def obter_regra_aplicavel(
        db_or_rules: Session | List[Any],
        empresa_id: int,
        centro_custo_id: Optional[int],
        data_venda: date
    ) -> Any | None:
        from app.models.regra_comissao import RegraComissao
        
        if isinstance(db_or_rules, list):
            # Filtering and matching in-memory from pre-fetched list
            regras = [r for r in db_or_rules if r.data_inicio <= data_venda]
        else:
            # 1. Buscar todas as regras ativas da empresa vigentes na data da venda
            query = (
                select(RegraComissao)
                .where(
                    RegraComissao.empresa_id == empresa_id,
                    RegraComissao.data_inicio <= data_venda,
                    RegraComissao.is_deleted == False
                )
            )
            regras = db_or_rules.exec(query).all()
        
        if not regras:
            return None
            
        # 2. Filtrar e ordenar em Python para maior robustez banco-agnóstica
        # Primeiro, tentar achar correspondência exata para centro_custo_id
        if centro_custo_id is not None:
            regras_cc = [r for r in regras if r.centro_custo_id == centro_custo_id]
            if regras_cc:
                return max(regras_cc, key=lambda r: r.data_inicio)
                
        # Se não achou ou centro_custo_id é None, pega a regra global (centro_custo_id == None)
        regras_globais = [r for r in regras if r.centro_custo_id is None]
        if regras_globais:
            return max(regras_globais, key=lambda r: r.data_inicio)
            
        return None

    @staticmethod
    def obter_taxa_comissao_produtos(faturamento_meta: Decimal, regra: Any | None = None) -> Decimal:
        """
        Retorna o percentual de comissão escalonada de produtos com base no faturamento de meta:
        Se existir uma regra cadastrada, usa as faixas dinâmicas dela.
        Caso contrário, usa as faixas de fallback estáticas.
        """
        if regra and regra.faixas_produtos_json:
            try:
                import json
                faixas = json.loads(regra.faixas_produtos_json)
                faixas_ordenadas = sorted(faixas, key=lambda x: float(x.get("min_faturamento", 0)), reverse=True)
                for f in faixas_ordenadas:
                    min_fat = Decimal(str(f.get("min_faturamento", 0)))
                    if faturamento_meta >= min_fat:
                        return Decimal(str(f.get("taxa", 0)))
            except Exception:
                pass
                
        # Fallback estático (Degraus da nova Especificação Técnica Matemática)
        if faturamento_meta < Decimal("50000.00"):
            return Decimal("0.00")
        elif faturamento_meta < Decimal("100000.00"):
            return Decimal("0.006")  # 0.6%
        elif faturamento_meta < Decimal("150000.00"):
            return Decimal("0.019")  # 1.9%
        else:
            return Decimal("0.050")  # 5.0%

    @classmethod
    def calcular_comissoes_vendedor(
        cls,
        db: Session,
        vendedor_id: int,
        mes: int,
        ano: int,
        empresa_id: int,
        hoje: date | None = None
    ) -> Dict[str, Any]:
        """
        Calcula o detalhamento de comissão do vendedor no mês/ano especificado.
        Retorna um dicionário com os valores das vendas de produtos, de serviços, a taxa aplicada,
        e as comissões calculadas.
        """
        if hoje is None:
            today = date.today()
            if today.month == mes and today.year == ano:
                hoje = today
            else:
                import calendar
                last_day = calendar.monthrange(ano, mes)[1]
                hoje = date(ano, mes, last_day)

        # 1. Calcular o faturamento elegível para metas
        faturamento_meta = cls.calcular_faturamento_meta(db, vendedor_id, mes, ano, empresa_id)
        
        # 2. Obter a meta do vendedor
        meta = cls.obter_meta_vendedor(db, vendedor_id, mes, ano, empresa_id)
        super_meta = meta * Decimal("1.20")
        
        # Calcular a projeção
        tempo = cls.calcular_dias_uteis(ano, mes, hoje)
        dias_totais = tempo["DIAS_TOTAIS"]
        dias_decorridos = tempo["DIAS_DECORRIDOS"]
        dias_restantes = tempo["DIAS_RESTANTES"]
        
        if dias_decorridos > 0:
            media_diaria = faturamento_meta / Decimal(str(dias_decorridos))
        else:
            media_diaria = Decimal("0.00")
            
        projecao = faturamento_meta + (media_diaria * Decimal(str(dias_restantes)))

        # Pre-fetch all rules for the company to avoid N+1 queries in the loop
        from app.models.regra_comissao import RegraComissao
        todas_regras = db.exec(
            select(RegraComissao)
            .where(
                RegraComissao.empresa_id == empresa_id,
                RegraComissao.is_deleted == False
            )
        ).all()
        
        # Buscar regra global para preencher a taxa padrão de retorno da API
        data_referencia = date(ano, mes, 1)
        regra_global = cls.obter_regra_aplicavel(todas_regras, empresa_id, None, data_referencia)
        
        # Determinar a Taxa de Comissão Dinâmica baseada no Futuro (Projeção)
        if regra_global and regra_global.faixas_produtos_json:
            taxa_produtos_global = cls.obter_taxa_comissao_produtos(projecao, regra_global)
        else:
            if meta == 0:
                taxa_produtos_global = Decimal("0.03")
            else:
                if projecao >= super_meta:
                    taxa_produtos_global = Decimal("0.03")
                elif projecao >= meta:
                    taxa_produtos_global = Decimal("0.02")
                else:
                    taxa_produtos_global = Decimal("0.01")
        
        # 3. Buscar lançamentos que geram pagamento de comissão neste mês (filtrados no banco)
        import calendar
        _, last_day = calendar.monthrange(ano, mes)
        start_date = date(ano, mes, 1)
        end_date = date(ano, mes, last_day)

        query = (
            select(Lancamento)
            .where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.created_by_id == vendedor_id,
                Lancamento.is_deleted == False,
                Lancamento.tipo == "RECEITA",
                or_(
                    (Lancamento.data_pagamento >= start_date) & (Lancamento.data_pagamento <= end_date),
                    (Lancamento.data_competencia >= start_date) & (Lancamento.data_competencia <= end_date)
                )
            )
        )
        launches = db.exec(query).all()
        
        vendas_detalhadas = []
        comissao_produtos = Decimal("0.00")
        comissao_servicos = Decimal("0.00")
        vendas_para_comissao = Decimal("0.00")
        faturamento_servicos_total = Decimal("0.00")
        
        # Mapeamento rápido de produtos para evitar múltiplas queries
        produtos_cache: Dict[int, Produto] = {}
        
        for l in launches:
            meta_json = {}
            if l.observacao:
                try:
                    meta_json = json.loads(l.observacao)
                except Exception:
                    pass
            
            tipo_pagamento = str(meta_json.get("tipo_pagamento", "")).lower()
            is_boleto = "boleto" in tipo_pagamento
            
            # Verificar se este lançamento gera pagamento de comissão no mês alvo
            elegivel_pagamento = False
            if is_boleto:
                if l.status == "PAGO" and l.data_pagamento and l.data_pagamento.month == mes and l.data_pagamento.year == ano:
                    elegivel_pagamento = True
            else:
                if l.data_competencia and l.data_competencia.month == mes and l.data_competencia.year == ano:
                    elegivel_pagamento = True
                    
            if not elegivel_pagamento:
                continue
                
            # Buscar regra aplicável específica para o lançamento
            regra_l = cls.obter_regra_aplicavel(todas_regras, empresa_id, l.centro_custo_id, l.data_competencia)
            taxa_servico_l = Decimal(str(regra_l.taxa_servico)) if (regra_l and regra_l.taxa_servico is not None) else Decimal("1.00")
            
            # Determinar a taxa do produto para este lançamento com base na projeção
            if regra_l and regra_l.faixas_produtos_json:
                taxa_produtos_l = cls.obter_taxa_comissao_produtos(projecao, regra_l)
            else:
                if meta == 0:
                    taxa_produtos_l = Decimal("0.03")
                else:
                    if projecao >= super_meta:
                        taxa_produtos_l = Decimal("0.03")
                    elif projecao >= meta:
                        taxa_produtos_l = Decimal("0.02")
                    else:
                        taxa_produtos_l = Decimal("0.01")
            
            # Exclusão de venda com Forma Pagto vazia (identificada por legacy_id_venda == 'eadd9ee4' ou tipo_pagamento vazio)
            is_excluded = False
            if meta_json.get("legacy_id_venda") == "eadd9ee4" or not tipo_pagamento or tipo_pagamento.strip() == "" or tipo_pagamento == "none":
                is_excluded = True

            # Calcular fator de multa por atraso no boleto
            fator_multa = Decimal("1.00")
            dias_atraso = 0
            if is_boleto and l.data_pagamento and l.data_vencimento:
                dias_atraso = (l.data_pagamento - l.data_vencimento).days
                if dias_atraso > 0:
                    tolerancia = regra_l.dias_tolerancia_atraso if regra_l else 0
                    limite = regra_l.dias_limite_atraso if regra_l else 365
                    redutor = regra_l.redutor_atraso_intermediario_pct if regra_l else Decimal("0.00")
                    
                    if dias_atraso > limite:
                        fator_multa = Decimal("0.00")
                    elif dias_atraso > tolerancia:
                        fator_multa = max(Decimal("0.00"), Decimal("1.00") - redutor)

            # Calcular o valor deste pagamento proporcional ao total da venda
            itens = meta_json.get("itens", [])
            subtotal_venda = Decimal(str(meta_json.get("subtotal") or l.valor_previsto or 0))
            desconto_venda = Decimal(str(meta_json.get("desconto") or 0))
            valor_liquido_venda = subtotal_venda - desconto_venda
            
            if valor_liquido_venda <= 0:
                continue
                
            # O valor pago/previsto nesta linha específica de lançamento
            valor_lancamento = Decimal(str(l.valor_previsto or 0))
            proporção_linha = valor_lancamento / valor_liquido_venda
            
            comissao_lancamento_prod = Decimal("0.00")
            comissao_lancamento_serv = Decimal("0.00")
            
            detalhe_itens_comissao = []
            
            if not itens:
                # Fallback: se a descrição sugerir serviços
                if "serviço" in l.descricao.lower() or "servicos" in l.descricao.lower():
                    if meta > 0:
                        if not is_excluded:
                            comissao_lancamento_serv = valor_lancamento * taxa_servico_l * fator_multa
                            faturamento_servicos_total += valor_lancamento
                    else:
                        if not is_boleto and not is_excluded:
                            comissao_lancamento_prod = valor_lancamento * taxa_produtos_l * fator_multa
                            vendas_para_comissao += valor_lancamento * fator_multa
                else:
                    if not is_boleto and not is_excluded:
                        comissao_lancamento_prod = valor_lancamento * taxa_produtos_l * fator_multa
                        vendas_para_comissao += valor_lancamento * fator_multa
            else:
                for item in itens:
                    produto_id = item.get("produto_id")
                    nome_item = item.get("nome", "Item")
                    subtotal_item = Decimal(str(item.get("subtotal", 0)))
                    desconto_item = Decimal(str(item.get("desconto", 0)))
                    
                    valor_liquido_item = subtotal_item - desconto_item
                    if subtotal_venda > 0:
                        proporcao_item = subtotal_item / subtotal_venda
                        desconto_geral_item = desconto_venda * proporcao_item
                        valor_liquido_item -= desconto_geral_item
                        
                    if valor_liquido_item < 0:
                        valor_liquido_item = Decimal("0.00")
                        
                    valor_item_na_parcela = valor_liquido_item * proporção_linha
                    
                    is_servico = False
                    if produto_id:
                        if produto_id not in produtos_cache:
                            p_db = db.get(Produto, produto_id)
                            if p_db:
                                produtos_cache[produto_id] = p_db
                        p_obj = produtos_cache.get(produto_id)
                        if p_obj and p_obj.tipo == "SERVICO":
                            is_servico = True
                            
                    if "serviço" in nome_item.lower() or "servicos" in nome_item.lower() or "frete" in nome_item.lower():
                        is_servico = True
                        
                    comissao_item = Decimal("0.00")
                    if is_servico and meta > 0:
                        if not is_excluded:
                            comissao_item = valor_item_na_parcela * taxa_servico_l * fator_multa
                            comissao_lancamento_serv += comissao_item
                            faturamento_servicos_total += valor_item_na_parcela
                    else:
                        if not is_boleto and not is_excluded:
                            comissao_item = valor_item_na_parcela * taxa_produtos_l * fator_multa
                            comissao_lancamento_prod += comissao_item
                            vendas_para_comissao += valor_item_na_parcela * fator_multa
                        
                    detalhe_itens_comissao.append({
                        "nome": nome_item,
                        "valor_na_parcela": float(valor_item_na_parcela),
                        "is_servico": is_servico,
                        "comissao": float(comissao_item)
                    })
            
            comissao_produtos += comissao_lancamento_prod
            comissao_servicos += comissao_lancamento_serv
            
            vendas_detalhadas.append({
                "lancamento_id": l.id,
                "rv": meta_json.get("rv", f"RV-{l.id:06d}"),
                "data_venda": str(l.data_competencia),
                "descricao": l.descricao,
                "tipo_pagamento": meta_json.get("tipo_pagamento"),
                "valor_lancamento": float(valor_lancamento),
                "comissao_produtos": float(comissao_lancamento_prod),
                "comissao_servicos": float(comissao_lancamento_serv),
                "dias_atraso": dias_atraso,
                "fator_multa": float(fator_multa),
                "itens": detalhe_itens_comissao
            })
            
        comissao_total = comissao_produtos + comissao_servicos
        
        return {
            "vendedor_id": vendedor_id,
            "mes": mes,
            "ano": ano,
            "faturamento_meta": float(faturamento_meta),
            "taxa_produtos": float(taxa_produtos_global),
            "faturamento_produtos_total": float(vendas_para_comissao),
            "faturamento_servicos_total": float(faturamento_servicos_total),
            "comissao_produtos": float(comissao_produtos),
            "comissao_servicos": float(comissao_servicos),
            "comissao_total": float(comissao_total),
            "vendas": vendas_detalhadas
        }

    @classmethod
    def obter_meta_vendedor(
        cls,
        db: Session,
        vendedor_id: int,
        mes: int,
        ano: int,
        empresa_id: int
    ) -> Decimal:
        from app.models.meta_vendedor import MetaVendedor
        query = (
            select(MetaVendedor)
            .where(
                MetaVendedor.empresa_id == empresa_id,
                MetaVendedor.vendedor_id == vendedor_id,
                MetaVendedor.mes == mes,
                MetaVendedor.ano == ano,
                MetaVendedor.is_deleted == False
            )
        )
        meta_db = db.exec(query).first()
        if meta_db:
            return meta_db.valor_meta

        # Fallback estático
        from app.models.usuario import Usuario
        user_obj = db.get(Usuario, vendedor_id)
        if user_obj:
            nome_lower = str(user_obj.nome or "").split()[0].lower()
            # Metas estáticas
            METAS_VENDEDORES = {
                "joel": Decimal("150000.00"),
                "murillo": Decimal("450000.00"),
                "christiano": Decimal("40000.00"),
                "raphael": Decimal("30000.00"),
                "breno": Decimal("60000.00"),
                "danilo": Decimal("25000.00"),
                "adson": Decimal("20000.00"),
                "erick": Decimal("150000.00"),
                "silas": Decimal("0.00"),
            }
            return METAS_VENDEDORES.get(nome_lower, Decimal("0.00"))
        return Decimal("0.00")

    @classmethod
    def calcular_dias_uteis(
        cls,
        ano: int,
        mes: int,
        hoje: date
    ) -> Dict[str, int]:
        import calendar
        cal = calendar.Calendar()
        dias_do_mes = [d for d in cal.itermonthdates(ano, mes) if d.month == mes]
        # Dias úteis (Segunda a Sábado, excluindo Domingos)
        dias_uteis = [d for d in dias_do_mes if d.weekday() != 6]
        
        dias_decorridos = [d for d in dias_uteis if d <= hoje]
        dias_restantes = [d for d in dias_uteis if d > hoje]
        
        return {
            "DIAS_TOTAIS": len(dias_uteis),
            "DIAS_DECORRIDOS": len(dias_decorridos),
            "DIAS_RESTANTES": len(dias_restantes),
        }

    @classmethod
    def calcular_indicadores_vendedor(
        cls,
        db: Session,
        vendedor_id: int,
        mes: int,
        ano: int,
        empresa_id: int,
        hoje: date
    ) -> Dict[str, Any]:
        """
        Calcula os indicadores matemáticos do dashboard de metas e comissões para um vendedor específico.
        """
        # 1. Variáveis de tempo
        tempo = cls.calcular_dias_uteis(ano, mes, hoje)
        dias_totais = tempo["DIAS_TOTAIS"]
        dias_decorridos = tempo["DIAS_DECORRIDOS"]
        dias_restantes = tempo["DIAS_RESTANTES"]
        
        # 2. Obter meta e realizado
        meta = cls.obter_meta_vendedor(db, vendedor_id, mes, ano, empresa_id)
        realizado = cls.calcular_faturamento_meta(db, vendedor_id, mes, ano, empresa_id)
        
        # 3. Fórmulas Matemáticas da Especificação
        super_meta = meta * Decimal("1.20")
        
        if dias_decorridos > 0:
            media_diaria = realizado / Decimal(str(dias_decorridos))
        else:
            media_diaria = Decimal("0.00")
            
        meta_por_dia = meta / Decimal(str(dias_totais)) if dias_totais > 0 else Decimal("0.00")
        
        a_realizar_meta = max(Decimal("0.00"), meta - realizado)
        
        percentual_realizado = (realizado / meta * 100) if meta > 0 else Decimal("0.00")
        
        projecao = realizado + (media_diaria * Decimal(str(dias_restantes)))
        
        percentual_projecao = (projecao / meta * 100) if meta > 0 else Decimal("0.00")
        
        # 4. Calcular comissão detalhada
        com_data = cls.calcular_comissoes_vendedor(db, vendedor_id, mes, ano, empresa_id, hoje)
        comissao = Decimal(str(com_data["comissao_total"]))
        
        return {
            "meta_total": float(round(meta, 2)),
            "super_meta": float(round(super_meta, 2)),
            "realizado": float(round(realizado, 2)),
            "media_atual": float(round(media_diaria, 2)),
            "meta_diaria": float(round(meta_por_dia, 2)),
            "a_realizar_para_meta": float(round(a_realizar_meta, 2)),
            "atingimento_pct": float(round(percentual_realizado, 2)),
            "projecao": float(round(projecao, 2)),
            "atingimento_proj_pct": float(round(percentual_projecao, 2)),
            "comissao_acumulada": float(round(comissao, 2)),
            "realizado_comissao": float(round(Decimal(str(com_data["faturamento_produtos_total"])), 2)),
            "comissao_produtos": float(round(Decimal(str(com_data["comissao_produtos"])), 2)),
            "comissao_servicos": float(round(Decimal(str(com_data["comissao_servicos"])), 2)),
            "faturamento_produtos_total": float(round(Decimal(str(com_data["faturamento_produtos_total"])), 2)),
            "faturamento_servicos_total": float(round(Decimal(str(com_data["faturamento_servicos_total"])), 2)),
            "sprints": com_data["vendas"]
        }

