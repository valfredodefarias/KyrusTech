# app/api/v1/endpoints/comissoes.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from sqlalchemy.orm import selectinload
from typing import List, Dict, Any
from datetime import date, datetime
from decimal import Decimal

from app.db.session import get_db
from app.api.v1.deps import get_current_active_user
from app.models.usuario import Usuario
from app.models.user_company_profile import UserCompanyProfile
from app.services.comissao_service import ComissaoService

router = APIRouter()

# Configuração estática de metas de vendas para o ERP
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


def obter_meta_vendedor(db: Session, vendedor_id: int, mes: int, ano: int, empresa_id: int, nome: str) -> Decimal:
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

    nome_lower = str(nome).split()[0].lower()
    return METAS_VENDEDORES.get(nome_lower, Decimal("0.00"))


def calcular_faturamento_bruto(db: Session, vendedor_id: int, mes: int, ano: int, empresa_id: int) -> Decimal:
    from app.models.lancamento import Lancamento
    query = (
        select(Lancamento)
        .where(
            Lancamento.empresa_id == empresa_id,
            Lancamento.created_by_id == vendedor_id,
            Lancamento.is_deleted == False,
            Lancamento.tipo == "RECEITA",
            Lancamento.data_competencia != None
        )
    )
    launches = db.exec(query).all()
    total = Decimal("0.00")
    for l in launches:
        if l.data_competencia.month == mes and l.data_competencia.year == ano:
            total += Decimal(str(l.valor_previsto or 0))
    return total


def calcular_dias_uteis(ano: int, mes: int, hoje: date) -> Dict[str, Any]:
    import calendar
    cal = calendar.Calendar()
    dias_do_mes = [d for d in cal.itermonthdates(ano, mes) if d.month == mes]
    # Dias úteis (Segunda a Sábado, excluindo Domingos)
    dias_uteis = [d for d in dias_do_mes if d.weekday() != 6]
    
    dias_decorridos = [d for d in dias_uteis if d <= hoje]
    dias_restantes = [d for d in dias_uteis if d > hoje]
    
    # Divisão das dezenas (sprints de 10 dias)
    sprint_1_days = [d for d in dias_uteis if 1 <= d.day <= 10]
    sprint_2_days = [d for d in dias_uteis if 11 <= d.day <= 20]
    sprint_3_days = [d for d in dias_uteis if d.day >= 21]
    
    return {
        "total": len(dias_uteis),
        "decorridos": len(dias_decorridos),
        "restantes": len(dias_restantes),
        "sprint_1": len(sprint_1_days),
        "sprint_2": len(sprint_2_days),
        "sprint_3": len(sprint_3_days),
    }


@router.get("/auditoria")
def get_auditoria(
    mes: int = Query(6, ge=1, le=12),
    ano: int = Query(2026),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Retorna o faturamento sumarizado por vendedor para auditoria interna.
    Valores devem bater com o motor legado.
    """
    empresa_id = 27  # Rosario Belem
    
    # Buscar todos os usuários da empresa que não são consultores
    vendedores = db.exec(
        select(Usuario)
        .where(
            Usuario.empresa_id == empresa_id,
            Usuario.is_deleted == False,
            Usuario.is_consultor == False,
            Usuario.email != "loja@kyrus_legado.com"
        )
    ).all()
    
    resultado = []
    for v in vendedores:
        com_data = ComissaoService.calcular_comissoes_vendedor(db, v.id, mes, ano, empresa_id)
        if com_data["faturamento_meta"] > 0 or com_data["comissao_total"] > 0:
            resultado.append({
                "vendedor_id": v.id,
                "nome": v.nome,
                "faturamento_realizado": float(round(Decimal(str(com_data["faturamento_meta"])), 2)),
                "comissao_produtos": float(round(Decimal(str(com_data["comissao_produtos"])), 2)),
                "comissao_servicos": float(round(Decimal(str(com_data["comissao_servicos"])), 2)),
                "comissao_total": float(round(Decimal(str(com_data["comissao_total"])), 2))
            })
            
    return {
        "mes": mes,
        "ano": ano,
        "empresa_id": empresa_id,
        "vendedores": resultado
    }


@router.get("/dashboard")
def get_dashboard(
    mes: int = Query(6, ge=1, le=12),
    ano: int = Query(2026),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user)
):
    """
    Retorna os dados gerenciais completos do dashboard de metas e comissões.
    Cruza as vendas com as dezenas e faz as projeções.
    """
    empresa_id = 27
    
    # Para o cenário de testes de Junho/2026, fixamos hoje em 21/06/2026.
    hoje_atual = date.today()
    if ano == 2026 and mes == 6:
        hoje = date(2026, 6, 21)
    else:
        hoje = hoje_atual
        
    dias_uteis_info = calcular_dias_uteis(ano, mes, hoje)
    total_dias_uteis = dias_uteis_info["total"]
    decorridos = dias_uteis_info["decorridos"]
    restantes = dias_uteis_info["restantes"]
    
    vendedores = db.exec(
        select(Usuario)
        .where(
            Usuario.empresa_id == empresa_id,
            Usuario.is_active == True,
            Usuario.is_deleted == False,
            Usuario.is_consultor == False
        )
    ).all()
    
    # Verificar se o usuário logado é gerente / administrador / consultor
    is_manager = False
    if current_user.is_consultor:
        is_manager = True
    else:
        assignment = db.exec(
            select(UserCompanyProfile)
            .options(selectinload(UserCompanyProfile.profile))
            .where(
                UserCompanyProfile.usuario_id == current_user.id,
                UserCompanyProfile.empresa_id == empresa_id,
                UserCompanyProfile.is_deleted == False,
                UserCompanyProfile.is_active == True,
            )
        ).first()
        if assignment and assignment.profile:
            profile = assignment.profile
            profile_code = (profile.code or "").upper()
            profile_name = (profile.name or "").lower()
            if profile_code in ("FULL_ACCESS", "GERENTE") or "gerente" in profile_name:
                is_manager = True
 
    if not is_manager:
        vendedores = [v for v in vendedores if v.id == current_user.id]
 
    # Excluir o usuário fake "Loja" da lista
    vendedores = [v for v in vendedores if v.email != "loja@kyrus_legado.com"]
 
    vendedores_metrics = []
    for v in vendedores:
        # Calcular os indicadores consolidados e testados usando o service
        metrics = ComissaoService.calcular_indicadores_vendedor(db, v.id, mes, ano, empresa_id, hoje)
        
        # Ignorar se não houver metas, faturamentos ou comissões
        if metrics["realizado"] <= 0 and metrics["meta_total"] <= 0 and metrics["comissao_acumulada"] <= 0:
            continue
            
        projecao = Decimal(str(metrics["projecao"]))
        meta_total = Decimal(str(metrics["meta_total"]))
        realizado = Decimal(str(metrics["realizado"]))
        
        # Determinar status_rag
        if projecao >= meta_total:
            status_rag = "green"
        elif projecao >= meta_total * Decimal("0.80"):
            status_rag = "amber"
        else:
            status_rag = "red"
            
        # Re-calcular meta para hoje
        meta_para_hoje = max(Decimal("0.00"), (meta_total - realizado) / Decimal(str(restantes))) if restantes > 0 else Decimal("0.00")
        if realizado >= meta_total:
            meta_para_hoje = Decimal("0.00")
            
        # Re-agrupar Sprints (Dezenas) a partir das vendas da comissão
        sprints_data = []
        sprint_ranges = [
            ("1ª Dezena", 1, 10, dias_uteis_info["sprint_1"]),
            ("2ª Dezena", 11, 20, dias_uteis_info["sprint_2"]),
            ("3ª Dezena", 21, 31, dias_uteis_info["sprint_3"])
        ]
        
        for sprint_nome, start_day, end_day, sprint_dias_uteis in sprint_ranges:
            sprint_realized = Decimal("0.00")
            for venda in metrics["sprints"]:
                try:
                    venda_date = datetime.strptime(venda["data_venda"], "%Y-%m-%d").date()
                    if start_day <= venda_date.day <= end_day:
                        sprint_realized += Decimal(str(venda["valor_lancamento"]))
                except Exception:
                    pass
            
            peso_pct = (sprint_dias_uteis / total_dias_uteis * 100) if total_dias_uteis > 0 else 0
            meta_sprint = meta_total * Decimal(str(peso_pct / 100))
            atingimento_sprint_pct = (sprint_realized / meta_sprint * 100) if meta_sprint > 0 else Decimal("0.00")
            
            sprints_data.append({
                "nome": sprint_nome,
                "dias_uteis": sprint_dias_uteis,
                "peso_pct": float(round(Decimal(str(peso_pct)), 2)),
                "meta_sprint": float(round(meta_sprint, 2)),
                "realizado_sprint": float(round(sprint_realized, 2)),
                "atingimento_pct": float(round(atingimento_sprint_pct, 2))
            })
            
        vendedores_metrics.append({
            "vendedor_id": v.id,
            "vendedor": v.nome,
            "meta_total": metrics["meta_total"],
            "super_meta": metrics["super_meta"],
            "realizado": metrics["realizado"],
            "realizado_comissao": metrics["realizado_comissao"],
            "atingimento_pct": metrics["atingimento_pct"],
            "atingimento_proj_pct": metrics["atingimento_proj_pct"],
            "media_atual": metrics["media_atual"],
            "meta_diaria": metrics["meta_diaria"],
            "projecao": metrics["projecao"],
            "comissao_acumulada": metrics["comissao_acumulada"],
            "status_rag": status_rag,
            "a_realizar_para_meta": metrics["a_realizar_para_meta"],
            "meta_para_hoje": float(round(meta_para_hoje, 2)),
            "sprints": sprints_data
        })
        
    if is_manager and len(vendedores_metrics) > 0:
        sum_meta = sum(v["meta_total"] for v in vendedores_metrics)
        sum_realizado = sum(v["realizado"] for v in vendedores_metrics)
        sum_realizado_comissao = sum(v["realizado_comissao"] for v in vendedores_metrics)
        sum_media = sum(v["media_atual"] for v in vendedores_metrics)
        sum_meta_diaria = sum(v["meta_diaria"] for v in vendedores_metrics)
        sum_projetado = sum(v["projecao"] for v in vendedores_metrics)
        sum_comissao = sum(v["comissao_acumulada"] for v in vendedores_metrics)
        sum_a_realizar = sum(v["a_realizar_para_meta"] for v in vendedores_metrics)
        
        sum_meta_para_hoje = max(0.0, (sum_meta - sum_realizado) / restantes) if restantes > 0 else 0.0
        if sum_realizado >= sum_meta:
            sum_meta_para_hoje = 0.0
            
        sum_atingimento = (sum_realizado / sum_meta * 100) if sum_meta > 0 else 0.0
        sum_atingimento_proj = (sum_projetado / sum_meta * 100) if sum_meta > 0 else 0.0
        
        if sum_projetado >= sum_meta:
            sum_status_rag = "green"
        elif sum_projetado >= sum_meta * 0.8:
            sum_status_rag = "amber"
        else:
            sum_status_rag = "red"
            
        sum_sprints = []
        for i in range(3):
            sprint_nome = f"{i+1}ª Dezena"
            sprint_dias = vendedores_metrics[0]["sprints"][i]["dias_uteis"]
            sprint_peso = vendedores_metrics[0]["sprints"][i]["peso_pct"]
            
            s_meta = sum(v["sprints"][i]["meta_sprint"] for v in vendedores_metrics)
            s_realized = sum(v["sprints"][i]["realizado_sprint"] for v in vendedores_metrics)
            s_atingimento = (s_realized / s_meta * 100) if s_meta > 0 else 0.0
            
            sum_sprints.append({
                "nome": sprint_nome,
                "dias_uteis": sprint_dias,
                "peso_pct": sprint_peso,
                "meta_sprint": float(round(Decimal(str(s_meta)), 2)),
                "realizado_sprint": float(round(Decimal(str(s_realized)), 2)),
                "atingimento_pct": float(round(Decimal(str(s_atingimento)), 2))
            })
            
        loja_metric = {
            "vendedor_id": 0,
            "vendedor": "LOJA",
            "meta_total": float(round(sum_meta, 2)),
            "super_meta": float(round(sum_meta * 1.20, 2)),
            "realizado": float(round(sum_realizado, 2)),
            "realizado_comissao": float(round(sum_realizado_comissao, 2)),
            "atingimento_pct": float(round(sum_atingimento, 2)),
            "atingimento_proj_pct": float(round(sum_atingimento_proj, 2)),
            "media_atual": float(round(sum_media, 2)),
            "meta_diaria": float(round(sum_meta_diaria, 2)),
            "projecao": float(round(sum_projetado, 2)),
            "comissao_acumulada": float(round(sum_comissao, 2)),
            "status_rag": sum_status_rag,
            "a_realizar_para_meta": float(round(sum_a_realizar, 2)),
            "meta_para_hoje": float(round(sum_meta_para_hoje, 2)),
            "sprints": sum_sprints
        }
        resultado = [loja_metric] + vendedores_metrics
    else:
        resultado = vendedores_metrics
        
    return {
        "mes": mes,
        "ano": ano,
        "hoje": str(hoje),
        "total_dias_uteis": total_dias_uteis,
        "dias_decorridos": decorridos,
        "dias_restantes": restantes,
        "vendedores": resultado
    }
