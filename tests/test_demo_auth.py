from fastapi.testclient import TestClient
from sqlmodel import Session, select
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.lancamento import Lancamento
from scripts.cleanup_demos import cleanup_expired_demos

def test_demo_login_flow(client: TestClient, session: Session):
    # 1. Chamar o endpoint de demo-login
    response = client.post("/api/v1/auth/demo-login")
    print("RESPONSE STATUS:", response.status_code)
    print("RESPONSE HEADERS:", response.headers)
    print("RESPONSE TEXT:", response.text)
    
    assert response.status_code == 200
    
    # 2. Verificar se retornou os dados de expiração da sessão
    data = response.json()
    assert "expires_at" in data
    assert "expires_in_minutes" in data
    
    # 3. Verificar no DB se a empresa temporária e o usuário convidado foram criados
    empresa = session.exec(select(Empresa).where(Empresa.razao_social.like("DEMO_TEMP_%"))).first()
    assert empresa is not None
    assert "Demonstração - Convidado #" in empresa.nome_fantasia
    
    user = session.exec(select(Usuario).where(Usuario.empresa_id == empresa.id)).first()
    assert user is not None
    assert user.nome == "Convidado"
    assert user.email.startswith("convidado_")
    
    # 4. Verificar se a empresa foi devidamente populada com lançamentos fictícios
    launches = session.exec(select(Lancamento).where(Lancamento.empresa_id == empresa.id)).all()
    assert len(launches) > 0
    
    # 5. Chamar o endpoint /usuarios/me para validar a sessão ativa (usando cookies definidos pelo login)
    res_me = client.get("/api/v1/usuarios/me")
    assert res_me.status_code == 200
    user_me = res_me.json()
    assert user_me["email"] == user.email
    assert user_me["nome"] == "Convidado"

    # 6. Testar o script de cleanup
    import datetime
    empresa_id = empresa.id
    user_id = user.id
    
    empresa.created_at = datetime.datetime.utcnow() - datetime.timedelta(hours=3)
    session.add(empresa)
    session.commit()
    
    cleanup_expired_demos(hours_threshold=2, db_session=session)
    
    session.expire_all()
    empresa_removed = session.exec(select(Empresa).where(Empresa.id == empresa_id)).first()
    assert empresa_removed is None
    
    user_removed = session.exec(select(Usuario).where(Usuario.id == user_id)).first()
    assert user_removed is None
    
    launches_removed = session.exec(select(Lancamento).where(Lancamento.empresa_id == empresa_id)).all()
    assert len(launches_removed) == 0
