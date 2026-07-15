# scripts/reorganize_plano_contas.py
import re
import json
from sqlmodel import Session, select
from app.db.session import engine
from app.models.plano_contas import PlanoContas

DRE_MAPPING = {
    "01": "RECEITA_BRUTA",
    "02": "DEDUCOES_RECEITA",
    "03": "CUSTOS_VARIAVEIS",
    "04": "DESPESAS_OPERACIONAIS",
    "05": "OUTRAS_RECEITAS",
    "06": "OUTRAS_DESPESAS",
    "07": "NAO_OPERACIONAL",
}

HEADER_CODES = {
    "01", "02", "03", "04", "04.01", "04.02", "04.03", "04.04", "04.05", "05", "06", "07"
}

def normalize_code(code: str) -> str:
    if not code:
        return ""
    c = code.strip().rstrip(".")
    if c == "4.5":
        return "04.05"
    return c

def get_parent_code(code: str) -> str:
    parts = code.split(".")
    if len(parts) > 1:
        return ".".join(parts[:-1])
    return ""

def main():
    print("=== INICIANDO REORGANIZAÇÃO CIRÚRGICA DO PLANO DE CONTAS (PIZZA FÁBIO) ===")
    with Session(engine) as session:
        for emp_id in [75, 77, 79, 80]:
            print(f"\n================ EMPRESA ID: {emp_id} ================")
            pcs = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == emp_id)).all()
            
            if not pcs:
                print("Nenhuma categoria encontrada para esta empresa.")
                continue
                
            # Map of normalized_code -> category_object
            code_map = {}
            for pc in pcs:
                norm = normalize_code(pc.codigo)
                code_map[norm] = pc
                
            # Perform updates
            updated_count = 0
            for pc in pcs:
                norm_code = normalize_code(pc.codigo)
                
                # 1. Determine Tipo
                new_tipo = "D"
                if norm_code.startswith("01") or norm_code.startswith("05") or norm_code.startswith("07.01") or "saldo positivo" in pc.nome.lower():
                    new_tipo = "R"
                    
                # 2. Determine DRE Grupo
                prefix = norm_code[:2]
                new_dre_grupo = DRE_MAPPING.get(prefix, "NAO_OPERACIONAL")
                if norm_code in ["saldo positivo", "saldo negative", "saldo negativo"]:
                    new_dre_grupo = "NAO_OPERACIONAL"
                    
                # 3. Determine Header
                new_eh_cabecalho = norm_code in HEADER_CODES
                new_permite_lancamentos = not new_eh_cabecalho
                
                # 4. Determine Results settings
                new_considerar = True
                new_operacional = True
                if prefix == "07" or norm_code in ["saldo positivo", "saldo negativo"]:
                    new_considerar = False
                    new_operacional = False
                elif prefix == "05" or prefix == "06":
                    new_operacional = False
                    
                # 5. Parent Code and ID
                parent_code = get_parent_code(norm_code)
                parent_pc = code_map.get(parent_code)
                parent_id = parent_pc.id if parent_pc else None
                
                # Check if change is needed
                if (
                    pc.tipo != new_tipo or
                    pc.dre_grupo != new_dre_grupo or
                    pc.eh_cabecalho != new_eh_cabecalho or
                    pc.permite_lancamentos != new_permite_lancamentos or
                    pc.considerar_nos_resultados != new_considerar or
                    pc.eh_operacional != new_operacional or
                    pc.conta_pai_id != parent_id
                ):
                    pc.tipo = new_tipo
                    pc.dre_grupo = new_dre_grupo
                    pc.eh_cabecalho = new_eh_cabecalho
                    pc.permite_lancamentos = new_permite_lancamentos
                    pc.considerar_nos_resultados = new_considerar
                    pc.eh_operacional = new_operacional
                    pc.conta_pai_id = parent_id
                    session.add(pc)
                    updated_count += 1
                    
            print(f"Atualizando {updated_count} categorias no banco de dados...")
            session.commit()
            print("Sucesso!")

if __name__ == "__main__":
    main()
