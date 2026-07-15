# scripts/reorganize_plano_contas.py
#
# Reorganiza cirurgicamente o Plano de Contas das empresas Pizza Fábio:
#   - Detecta empresas dinamicamente pelo nome
#   - Corrige tipo (R/D), dre_grupo, eh_cabecalho, conta_pai_id
#   - Só grava no banco se houver diferença real (dirty check)
#   - Commit único por empresa (transação rápida)
#
from sqlmodel import Session, select, col
from app.db.session import engine
from app.models.plano_contas import PlanoContas
from app.models.empresa import Empresa

# Mapeamento DRE por prefixo NORMALIZADO (sempre 2 dígitos, ex: "01", "04")
DRE_MAPPING = {
    "01": "RECEITA_BRUTA",
    "02": "DEDUCOES_RECEITA",
    "03": "CUSTOS_VARIAVEIS",
    "04": "DESPESAS_OPERACIONAIS",
    "05": "OUTRAS_RECEITAS",
    "06": "OUTRAS_DESPESAS",
    "07": "NAO_OPERACIONAL",
}

# Categorias que são agrupadores/cabeçalhos (não permitem lançamentos diretos)
HEADER_CODES = {
    "01", "02", "03", "04", "04.01", "04.02", "04.03", "04.04", "04.05",
    "05", "06", "07",
    # Equivalentes de dígito único
    "1", "2", "3", "4", "4.01", "4.02", "4.03", "4.04", "4.05",
    "5", "6", "7",
}

# Categorias de RECEITA por nome (independente do código numérico)
# Usado como fallback quando o código não deixa claro
NOME_RECEITA_KEYWORDS = [
    "transferência recebida", "transferencia recebida",
    "receita", "recebimento", "entrada", "saldo positivo",
    "rendimento", "juros recebido", "desconto obtido",
]
NOME_DESPESA_OVERRIDE_KEYWORDS = [
    "transferência emitida", "transferencia emitida",
    "despesa", "pagamento", "saída", "saida",
]

# Categorias que são não-operacionais (não entram na DRE)
# Baseado no código ou no nome
NAO_OPERACIONAL_KEYWORDS = [
    "transferência", "transferencia", "aporte", "investimento",
    "saldo positivo", "saldo negativo", "aplicação", "aplicacao",
    "retirada", "prolabore", "distribuição", "distribuicao",
]


def normalize_prefix(code: str) -> str:
    """
    Extrai o prefixo de 2 dígitos a partir de um código numérico.
    Suporta tanto '01.xx' quanto '1.xx' (zero à esquerda opcional).
    Exemplos:
        '01'     -> '01'
        '1'      -> '01'
        '04.03'  -> '04'
        '4.3'    -> '04'
        '2.08'   -> '02'
    """
    if not code:
        return ""
    first_part = code.split(".")[0].strip()
    try:
        return f"{int(first_part):02d}"
    except ValueError:
        return ""


def normalize_code(code: str) -> str:
    """Remove espaços e pontos finais do código."""
    if not code:
        return ""
    return code.strip().rstrip(".")


def get_parent_code(code: str) -> str:
    parts = code.split(".")
    if len(parts) > 1:
        return ".".join(parts[:-1])
    return ""


def nome_contains(nome: str, keywords: list) -> bool:
    nome_lower = nome.lower()
    return any(kw in nome_lower for kw in keywords)


def main():
    print("=== REORGANIZAÇÃO CIRÚRGICA DO PLANO DE CONTAS (PIZZA FÁBIO) ===\n")
    with Session(engine) as session:
        empresas = session.exec(
            select(Empresa).where(
                col(Empresa.nome_fantasia).ilike("%Pizza%Fábio%") |
                col(Empresa.nome_fantasia).ilike("%Pizza%Fabio%")
            )
        ).all()
        if not empresas:
            print("ERRO: Nenhuma empresa Pizza Fábio encontrada! Verifique o nome.")
            return

        print(f"Empresas encontradas: {[(e.id, e.nome_fantasia) for e in empresas]}\n")

        for empresa in empresas:
            emp_id = empresa.id
            print(f"================ {empresa.nome_fantasia} (ID: {emp_id}) ================")
            pcs = session.exec(select(PlanoContas).where(PlanoContas.empresa_id == emp_id)).all()

            if not pcs:
                print("  Nenhuma categoria encontrada.\n")
                continue

            # Index por código normalizado para busca O(1) de pai
            code_map: dict[str, PlanoContas] = {}
            for pc in pcs:
                norm = normalize_code(pc.codigo)
                code_map[norm] = pc

            updated_count = 0
            for pc in pcs:
                norm_code = normalize_code(pc.codigo)
                prefix_2d = normalize_prefix(norm_code)  # sempre '01'..'07'
                nome = pc.nome or ""

                # --- 1. Tipo (R = Receita, D = Despesa) ---
                is_transferencia = nome_contains(nome, ["transferência", "transferencia"])

                if nome_contains(nome, NOME_RECEITA_KEYWORDS):
                    new_tipo = "R"
                elif prefix_2d in ("01", "05"):
                    new_tipo = "R"
                else:
                    new_tipo = "D"

                # Transferência emitida é sempre Despesa (saída)
                if "emitida" in nome.lower():
                    new_tipo = "D"
                # Transferência recebida é sempre Receita (entrada)
                if "recebida" in nome.lower():
                    new_tipo = "R"

                # --- 2. DRE Grupo ---
                new_dre_grupo = DRE_MAPPING.get(prefix_2d, "NAO_OPERACIONAL")

                # Transferências e contas de movimento ficam fora da DRE
                if is_transferencia or nome_contains(nome, NAO_OPERACIONAL_KEYWORDS):
                    new_dre_grupo = "NAO_OPERACIONAL"

                # --- 3. Cabeçalho ---
                new_eh_cabecalho = norm_code in HEADER_CODES
                new_permite_lancamentos = not new_eh_cabecalho

                # --- 4. Considera nos resultados / Operacional ---
                if new_dre_grupo == "NAO_OPERACIONAL":
                    new_considerar = False
                    new_operacional = False
                elif prefix_2d in ("05", "06"):
                    new_considerar = True
                    new_operacional = False
                else:
                    new_considerar = True
                    new_operacional = True

                # --- 5. Pai ---
                parent_code = get_parent_code(norm_code)
                parent_pc = code_map.get(parent_code) if parent_code else None
                parent_id = parent_pc.id if parent_pc else None

                # --- Dirty check: só grava se houver diferença real ---
                if (
                    pc.tipo != new_tipo or
                    pc.dre_grupo != new_dre_grupo or
                    pc.eh_cabecalho != new_eh_cabecalho or
                    pc.permite_lancamentos != new_permite_lancamentos or
                    pc.considerar_nos_resultados != new_considerar or
                    pc.eh_operacional != new_operacional or
                    pc.conta_pai_id != parent_id
                ):
                    # Log categorias que mudaram de tipo (impacto em saldo)
                    if pc.tipo != new_tipo:
                        print(f"  [TIPO ALTERADO] {norm_code} | {nome[:40]:<40} | {pc.tipo} -> {new_tipo}")

                    pc.tipo = new_tipo
                    pc.dre_grupo = new_dre_grupo
                    pc.eh_cabecalho = new_eh_cabecalho
                    pc.permite_lancamentos = new_permite_lancamentos
                    pc.considerar_nos_resultados = new_considerar
                    pc.eh_operacional = new_operacional
                    pc.conta_pai_id = parent_id
                    session.add(pc)
                    updated_count += 1

            session.commit()
            print(f"  {updated_count} categorias atualizadas. Sucesso!\n")

    print("=== CONCLUÍDO ===")


if __name__ == "__main__":
    main()
