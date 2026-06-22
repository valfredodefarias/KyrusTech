import os
import sys
import json

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session
from app.db.session import engine
from app.api.v1.endpoints.comissoes import get_auditoria, get_dashboard
from app.models.usuario import Usuario

class MockUser:
    id = 19
    nome = "Ciro Caue Nery Cunha"
    email = "ciro@test.com"
    is_active = True
    empresa_id = 27

with Session(engine) as db:
    print("--- TESTING get_auditoria(mes=6, ano=2026) DIRECTLY ---")
    res_aud = get_auditoria(mes=6, ano=2026, db=db, current_user=MockUser())
    print("Response:")
    print(json.dumps(res_aud, indent=2, ensure_ascii=False))

    print("\n--- TESTING get_dashboard(mes=6, ano=2026) DIRECTLY ---")
    res_dash = get_dashboard(mes=6, ano=2026, db=db, current_user=MockUser())
    print("Response (first few sellers):")
    vendedores = res_dash.get("vendedores", [])
    for v in vendedores:
        if v["vendedor"] in ["Joel", "Murillo"]:
            print(json.dumps(v, indent=2, ensure_ascii=False))
            
    print("Global info:")
    for k, val in res_dash.items():
        if k != "vendedores":
            print(f"  {k}: {val}")
