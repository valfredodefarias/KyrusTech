import sys, os
sys.path.insert(0, "/app")
os.environ["DISABLE_AUDIT"] = "1"

from app.db.session import engine
from sqlalchemy import text

EMPRESA_ID = 35  # Umarizal

def q(conn, sql, params=None):
    return conn.execute(text(sql), params or {}).all()

with engine.connect() as conn:
    # 1. Contagem por tipo + status
    print("=" * 60)
    print("1. LANÇAMENTOS POR TIPO + STATUS (Umarizal)")
    print("=" * 60)
    rows = db.exec(text("""
        SELECT tipo, status, COUNT(*) as qtd, SUM(valor_previsto) as total
        FROM lancamentos
        WHERE empresa_id = :eid AND is_deleted = false
        GROUP BY tipo, status
        ORDER BY tipo, status
    """), {"eid": EMPRESA_ID}).all()
    for r in rows:
        print(f"  {r[0]:<10} {r[1]:<15} {r[2]:>6,}  R$ {float(r[3] or 0):>12,.2f}")

    # 2. Receitas EM ABERTO (aparecem como Atrasado)
    print()
    print("=" * 60)
    print("2. RECEITAS EM ABERTO (mostram como ATRASADO/A VENCER)")
    print("=" * 60)
    rows = db.exec(text("""
        SELECT origem, LEFT(descricao, 50) as desc, COUNT(*) as qtd, SUM(valor_previsto) as total
        FROM lancamentos
        WHERE empresa_id = :eid AND tipo = 'RECEITA' AND status = 'EM ABERTO' AND is_deleted = false
        GROUP BY origem, LEFT(descricao, 50)
        ORDER BY qtd DESC
        LIMIT 20
    """), {"eid": EMPRESA_ID}).all()
    for r in rows:
        print(f"  [{r[0]}] {r[1]:<50} qtd={r[2]:>5,}  R$={float(r[3] or 0):>10,.2f}")

    # 3. Vencimentos HOJE
    print()
    print("=" * 60)
    print("3. LANÇAMENTOS COM VENCIMENTO HOJE")
    print("=" * 60)
    rows = db.exec(text("""
        SELECT tipo, status, origem, LEFT(descricao, 40) as desc, COUNT(*) as qtd, SUM(valor_previsto) as total
        FROM lancamentos
        WHERE empresa_id = :eid AND is_deleted = false
          AND DATE(data_vencimento) = CURRENT_DATE
        GROUP BY tipo, status, origem, LEFT(descricao, 40)
        ORDER BY tipo, status
    """), {"eid": EMPRESA_ID}).all()
    for r in rows:
        print(f"  {r[0]:<10} {r[1]:<15} [{r[2]}] {r[3]:<40} qtd={r[4]:>4,}  R$={float(r[5] or 0):>10,.2f}")

    # 4. De onde vêm os lançamentos "Movimento em PIX no PDV"?
    print()
    print("=" * 60)
    print("4. ENTRADAS 'PIX no PDV' - origem e conta")
    print("=" * 60)
    rows = db.exec(text("""
        SELECT l.origem, l.status, c.nome as conta, COUNT(*) as qtd, SUM(l.valor_previsto) as total,
               MIN(l.data_vencimento) as mais_antiga, MAX(l.data_vencimento) as mais_nova
        FROM lancamentos l
        LEFT JOIN contas c ON c.id = l.conta_id
        WHERE l.empresa_id = :eid AND l.is_deleted = false
          AND l.descricao ILIKE '%PIX%PDV%'
        GROUP BY l.origem, l.status, c.nome
    """), {"eid": EMPRESA_ID}).all()
    for r in rows:
        print(f"  [{r[0]}] status={r[1]} conta={r[2]} qtd={r[3]:,}  R$={float(r[4] or 0):,.2f}  range={r[5]}→{r[6]}")

    # 5. Duplicação? Mesmo rv em PDV e Financeiro?
    print()
    print("=" * 60)
    print("5. POSSÍVEL DUPLICAÇÃO PDV×FINANCEIRO (mesmo valor/data/tipo)")
    print("=" * 60)
    rows = db.exec(text("""
        SELECT data_vencimento, valor_previsto, COUNT(*) as cnt
        FROM lancamentos
        WHERE empresa_id = :eid AND tipo = 'RECEITA' AND is_deleted = false
          AND data_vencimento >= '2025-01-01'
        GROUP BY data_vencimento, valor_previsto
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 10
    """), {"eid": EMPRESA_ID}).all()
    print(f"  Grupos com >1 lançamento mesmo (data+valor): {len(rows)}")
    for r in rows[:5]:
        print(f"    data={r[0]}  valor=R${float(r[1]):,.2f}  count={r[2]}")

    # 6. Financeiro importado: qual banco as entradas de receita usam?
    print()
    print("=" * 60)
    print("6. LANCAMENTOS FINANCEIRO RECEITA - top contas/origens")
    print("=" * 60)
    rows = db.exec(text("""
        SELECT l.origem, c.nome as conta, l.status, COUNT(*) as qtd, SUM(l.valor_previsto) as total
        FROM lancamentos l
        LEFT JOIN contas c ON c.id = l.conta_id
        WHERE l.empresa_id = :eid AND l.tipo = 'RECEITA' AND l.is_deleted = false
          AND l.origem != 'PDV'
        GROUP BY l.origem, c.nome, l.status
        ORDER BY qtd DESC
        LIMIT 15
    """), {"eid": EMPRESA_ID}).all()
    for r in rows:
        print(f"  [{r[0]}] conta={r[1]} status={r[2]} qtd={r[3]:,}  R$={float(r[4] or 0):,.2f}")
