from sqlalchemy import text
from app.db.session import engine

tables = [
    'pdv_venda_itens', 'lote_cartao_itens', 'mapeamentos_categoria',
    'fornecedor_produto_equivalencias', 'usuario_conta_acesso',
    'user_company_profiles', 'access_profile_permissions',
    'baixas', 'anexos_lancamento', 'cartoes'
]
with engine.connect() as conn:
    for t in tables:
        try:
            r = conn.execute(text(
                f"SELECT column_name FROM information_schema.columns "
                f"WHERE table_name='{t}' ORDER BY ordinal_position LIMIT 6"
            ))
            cols = [row[0] for row in r]
            print(f"{t}: {cols}")
        except Exception as e:
            print(f"{t}: ERRO {e}")
