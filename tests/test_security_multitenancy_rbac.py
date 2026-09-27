import io
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session
from app.main import app
from app.api.deps import get_current_user, get_current_active_user, get_empresa_id_from_user
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.consultor_empresa import ConsultorEmpresa
from app.models.user_company_profile import UserCompanyProfile
from app.models.access_profile import AccessProfile
from app.models.access_permission import AccessPermission
from app.models.access_profile_permission import AccessProfilePermission
from app.enums import ConsultorRole


@pytest.fixture(name="security_setup")
def security_setup_fixture(session: Session):
    # Duas empresas distintas
    empresa1 = Empresa(id=1, razao_social="Empresa Matriz LTDA", nome_fantasia="Matriz", cnpj="11111111000101")
    empresa2 = Empresa(id=2, razao_social="Empresa Filial LTDA", nome_fantasia="Filial", cnpj="22222222000102")
    session.add(empresa1)
    session.add(empresa2)
    session.flush()

    # Consultor com acesso a ambas as empresas
    consultor = Usuario(
        id=10,
        email="consultor@kyrus.com.br",
        nome="Consultor Especialista",
        hashed_password="fakehashpassword",
        is_active=True,
        is_consultor=True,
        consultor_role=ConsultorRole.CONSULTOR.value,
        empresa_id=1,  # Empresa padrão = 1
    )
    session.add(consultor)
    session.flush()

    # Vínculos com as duas empresas
    link1 = ConsultorEmpresa(usuario_id=consultor.id, empresa_id=1, ativo=True)
    link2 = ConsultorEmpresa(usuario_id=consultor.id, empresa_id=2, ativo=True)
    session.add(link1)
    session.add(link2)

    # Permissões e perfis para Empresa 1 (apenas leitura) e Empresa 2 (criação)
    perm_view = AccessPermission(code="lancamentos:view", module="lancamentos", action="view", description="Visualizar")
    perm_create = AccessPermission(code="lancamentos:create", module="lancamentos", action="create", description="Criar")
    perm_update = AccessPermission(code="lancamentos:update", module="lancamentos", action="update", description="Atualizar")
    perm_delete = AccessPermission(code="lancamentos:delete", module="lancamentos", action="delete", description="Excluir")
    session.add(perm_view)
    session.add(perm_create)
    session.add(perm_update)
    session.add(perm_delete)
    session.flush()

    # Perfil Operador (tem lancamentos:create)
    perfil_operador = AccessProfile(empresa_id=2, name="Operador Filial", code="OPERADOR_FILIAL")
    session.add(perfil_operador)
    session.flush()

    app_perm_create = AccessProfilePermission(profile_id=perfil_operador.id, permission_id=perm_create.id)
    session.add(app_perm_create)

    # Perfil Leitor (apenas lancamentos:view) na Empresa 1
    perfil_leitor = AccessProfile(empresa_id=1, name="Leitor Matriz", code="LEITOR_MATRIZ")
    session.add(perfil_leitor)
    session.flush()

    app_perm_view = AccessProfilePermission(profile_id=perfil_leitor.id, permission_id=perm_view.id)
    session.add(app_perm_view)

    # Atribuir perfil leitor na Empresa 1 e perfil operador na Empresa 2
    ucp1 = UserCompanyProfile(usuario_id=consultor.id, empresa_id=1, profile_id=perfil_leitor.id, is_active=True)
    ucp2 = UserCompanyProfile(usuario_id=consultor.id, empresa_id=2, profile_id=perfil_operador.id, is_active=True)
    session.add(ucp1)
    session.add(ucp2)

    # Super consultor com acesso administrativo total em ambas empresas
    admin_user = Usuario(
        id=99,
        email="admin@kyrus.com.br",
        nome="Admin Total",
        hashed_password="fakehashpassword",
        is_active=True,
        is_consultor=True,
        consultor_role=ConsultorRole.SUPER_CONSULTOR.value,
        empresa_id=1,
    )
    session.add(admin_user)
    session.add(ConsultorEmpresa(usuario_id=admin_user.id, empresa_id=1, ativo=True))
    session.add(ConsultorEmpresa(usuario_id=admin_user.id, empresa_id=2, ativo=True))
    session.commit()

    return {
        "empresa1": empresa1,
        "empresa2": empresa2,
        "consultor": consultor,
        "admin_user": admin_user,
    }


def test_consultor_read_user_me_with_company_header(client: TestClient, security_setup):
    consultor = security_setup["consultor"]
    app.dependency_overrides[get_current_user] = lambda: consultor
    app.dependency_overrides[get_current_active_user] = lambda: consultor

    try:
        # Sem header, retorna empresa padrão (1)
        res_default = client.get("/api/v1/usuarios/me")
        assert res_default.status_code == 200
        assert res_default.json()["empresa_id"] == 1

        # Com header X-Company-ID: 2, deve refletir empresa 2
        res_company2 = client.get("/api/v1/usuarios/me", headers={"X-Company-ID": "2"})
        assert res_company2.status_code == 200
        data2 = res_company2.json()
        assert data2["empresa_id"] == 2
        assert "lancamentos:create" in data2["permissions"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_cartoes_upload_xlsx_validation_and_size_limits(client: TestClient, security_setup):
    consultor = security_setup["consultor"]
    app.dependency_overrides[get_current_user] = lambda: consultor
    app.dependency_overrides[get_current_active_user] = lambda: consultor

    try:
        # 1. Tentativa de upload com extensão não permitida (.txt)
        bad_file = ("teste.txt", io.BytesIO(b"conteudo simples"), "text/plain")
        res_bad_ext = client.post(
            "/api/v1/cartoes/upload-xlsx",
            files={"file": bad_file},
            headers={"X-Company-ID": "2"}
        )
        assert res_bad_ext.status_code == 400
        assert "Arquivo deve ser XLSX ou XLS" in res_bad_ext.json()["detail"]

        # 2. Tentativa de upload com arquivo que excede 10MB
        huge_bytes = b"0" * (10 * 1024 * 1024 + 10)
        huge_file = ("arquivo_gigante.xlsx", io.BytesIO(huge_bytes), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res_huge = client.post(
            "/api/v1/cartoes/upload-xlsx",
            files={"file": huge_file},
            headers={"X-Company-ID": "2"}
        )
        assert res_huge.status_code == 413
        assert "Arquivo muito grande" in res_huge.json()["detail"]

        # 3. Usuário sem permissão na Empresa 1 (onde só tem Leitor)
        res_forbidden = client.post(
            "/api/v1/cartoes/upload-xlsx",
            files={"file": ("valido.xlsx", io.BytesIO(b"dummy"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers={"X-Company-ID": "1"}
        )
        assert res_forbidden.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_contas_cross_tenant_isolation(client: TestClient, session: Session, security_setup):
    from app.models.centro_custo import CentroCusto

    admin = security_setup["admin_user"]
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    # Setup Centro de Custo para cada empresa
    cc1 = CentroCusto(id=101, empresa_id=1, nome="CC Matriz", is_deleted=False)
    cc2 = CentroCusto(id=202, empresa_id=2, nome="CC Filial", is_deleted=False)
    session.add(cc1)
    session.add(cc2)

    # Usuário que pertence apenas à empresa 2
    user_filial = Usuario(
        id=77,
        email="operador_filial@kyrus.com.br",
        nome="Operador Filial",
        hashed_password="fakehashpassword",
        is_active=True,
        is_consultor=False,
        empresa_id=2,
    )
    session.add(user_filial)
    session.commit()

    try:
        # 1. Tentativa de vincular centro_custo da Empresa 2 na Conta da Empresa 1 -> deve falhar 400
        payload_invalid_cc = {
            "nome": "Conta Banco Matriz",
            "tipo": "CORRENTE",
            "centro_custo_id": 202,
        }
        res_cc = client.post("/api/v1/contas/", json=payload_invalid_cc, headers={"X-Company-ID": "1"})
        assert res_cc.status_code == 400
        assert "não pertencente a esta empresa" in res_cc.json()["detail"]

        # 2. Tentativa de vincular usuário da Empresa 2 nos allowed_user_ids da Empresa 1 -> deve falhar 400
        payload_invalid_user = {
            "nome": "Conta Banco Matriz",
            "tipo": "CORRENTE",
            "centro_custo_id": 101,
            "allowed_user_ids": [77],
        }
        res_usr = client.post("/api/v1/contas/", json=payload_invalid_user, headers={"X-Company-ID": "1"})
        assert res_usr.status_code == 400
        assert "não pertencem a esta empresa" in res_usr.json()["detail"]

        # 3. Criação válida na Empresa 1
        payload_valid = {
            "nome": "Conta Banco Matriz OK",
            "tipo": "CORRENTE",
            "centro_custo_id": 101,
        }
        res_ok = client.post("/api/v1/contas/", json=payload_valid, headers={"X-Company-ID": "1"})
        assert res_ok.status_code == 201
        conta_id = res_ok.json()["id"]

        # 4. Tentativa de PATCH com centro_custo da Empresa 2 -> deve falhar 400
        res_patch = client.patch(
            f"/api/v1/contas/{conta_id}",
            json={"centro_custo_id": 202},
            headers={"X-Company-ID": "1"},
        )
        assert res_patch.status_code == 400
        assert "não pertencente a esta empresa" in res_patch.json()["detail"]

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_plano_contas_cross_tenant_parent(client: TestClient, session: Session, security_setup):
    from app.models.plano_contas import PlanoContas

    admin = security_setup["admin_user"]
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    # Categorias para Empresa 1 e Empresa 2
    pc1 = PlanoContas(id=501, empresa_id=1, codigo="1.01", nome="Receita Matriz", tipo="R", is_deleted=False)
    pc2 = PlanoContas(id=601, empresa_id=2, codigo="1.01", nome="Receita Filial", tipo="R", is_deleted=False)
    session.add(pc1)
    session.add(pc2)
    session.commit()

    try:
        # 1. Tentativa de criar categoria na Empresa 1 com pai na Empresa 2 -> deve falhar 400
        payload_create = {
            "nome": "Subcategoria Invalida",
            "tipo": "R",
            "conta_pai_id": 601,
        }
        res_create = client.post("/api/v1/plano-contas/", json=payload_create, headers={"X-Company-ID": "1"})
        assert res_create.status_code == 400
        assert "não pertencente a esta empresa" in res_create.json()["detail"]

        # 2. Tentativa de PATCH com pai na Empresa 2 -> deve falhar 400
        res_patch_cross = client.patch(
            f"/api/v1/plano-contas/501",
            json={"conta_pai_id": 601},
            headers={"X-Company-ID": "1"},
        )
        assert res_patch_cross.status_code == 400
        assert "não pertencente a esta empresa" in res_patch_cross.json()["detail"]

        # 3. Tentativa de auto-filiação (pai de si mesma) -> deve falhar 400
        res_self = client.patch(
            f"/api/v1/plano-contas/501",
            json={"conta_pai_id": 501},
            headers={"X-Company-ID": "1"},
        )
        assert res_self.status_code == 400
        assert "não pode ser pai de si mesma" in res_self.json()["detail"]

        # 4. Tentativa de reordenar apontando pai da Empresa 2 -> deve falhar 400
        reorder_payload = [
            {"id": 501, "codigo": "1.01.01", "conta_pai_id": 601, "tipo": "R"}
        ]
        res_reorder = client.post("/api/v1/plano-contas/reordenar", json=reorder_payload, headers={"X-Company-ID": "1"})
        assert res_reorder.status_code == 400
        assert "não pertencem a esta empresa" in res_reorder.json()["detail"]

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_entidades_soft_delete_and_block_with_lancamentos(client: TestClient, session: Session, security_setup):
    from app.models.entidade import Entidade
    from app.models.lancamento import Lancamento
    from datetime import date
    from sqlmodel import select

    admin = security_setup["admin_user"]
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    from app.models.plano_contas import PlanoContas

    pc = PlanoContas(id=777, empresa_id=1, codigo="2.01", nome="Despesa Geral", tipo="D", is_deleted=False)
    session.add(pc)

    ent = Entidade(id=801, empresa_id=1, nome="Fornecedor Protegido", tipo="FORNECEDOR", is_deleted=False)
    session.add(ent)
    session.commit()

    lanc = Lancamento(
        id=901,
        empresa_id=1,
        entidade_id=801,
        plano_contas_id=777,
        descricao="Despesa vinculada",
        valor_previsto=150.0,
        tipo="DESPESA",
        status="EM ABERTO",
        data_vencimento=date(2026, 6, 1),
        data_competencia=date(2026, 6, 1),
        is_deleted=False,
    )
    session.add(lanc)
    session.commit()

    try:
        # 1. Tentativa de excluir entidade com lançamento ativo vinculado -> deve falhar 400
        res_del_blocked = client.delete("/api/v1/entidades/801", headers={"X-Company-ID": "1"})
        assert res_del_blocked.status_code == 400
        assert "com lançamentos vinculados" in res_del_blocked.json()["detail"]

        # 2. Excluir o lançamento e tentar excluir a entidade novamente
        lanc.is_deleted = True
        session.add(lanc)
        session.commit()

        res_del_ok = client.delete("/api/v1/entidades/801", headers={"X-Company-ID": "1"})
        assert res_del_ok.status_code == 200

        # 3. Validar que foi soft-deleted (permanece no banco com is_deleted=True)
        session.expire_all()
        db_ent = session.get(Entidade, 801)
        assert db_ent is not None
        assert db_ent.is_deleted is True

        # 4. Não deve aparecer na listagem ativa
        res_list = client.get("/api/v1/entidades/", headers={"X-Company-ID": "1"})
        assert res_list.status_code == 200
        ids_ativos = [item["id"] for item in res_list.json()]
        assert 801 not in ids_ativos

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_transferencia_cross_tenant_isolation(client: TestClient, session: Session, security_setup):
    from app.models.conta import Conta
    from app.models.centro_custo import CentroCusto
    from datetime import date

    admin = security_setup["admin_user"]
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    c_matriz = Conta(id=1101, empresa_id=1, nome="Conta Matriz", tipo="CORRENTE", is_deleted=False)
    c_matriz_2 = Conta(id=1102, empresa_id=1, nome="Conta Matriz 2", tipo="CORRENTE", is_deleted=False)
    c_filial = Conta(id=2101, empresa_id=2, nome="Conta Filial", tipo="CORRENTE", is_deleted=False)
    session.add(c_matriz)
    session.add(c_matriz_2)
    session.add(c_filial)

    cc_filial = CentroCusto(id=2201, empresa_id=2, nome="CC Filial", is_deleted=False)
    session.add(cc_filial)
    session.commit()

    try:
        # 1. Transferência para conta de outra empresa -> 400
        payload_cross_dest = {
            "conta_origem_id": 1101,
            "conta_destino_id": 2101,
            "valor": 100.0,
            "data": "2026-06-15",
        }
        res_dest = client.post("/api/v1/lancamentos/transferir", json=payload_cross_dest, headers={"X-Company-ID": "1"})
        assert res_dest.status_code == 400
        assert "não pertencente a esta empresa" in res_dest.json()["detail"]

        # 2. Transferência de conta de outra empresa -> 400
        payload_cross_orig = {
            "conta_origem_id": 2101,
            "conta_destino_id": 1102,
            "valor": 100.0,
            "data": "2026-06-15",
        }
        res_orig = client.post("/api/v1/lancamentos/transferir", json=payload_cross_orig, headers={"X-Company-ID": "1"})
        assert res_orig.status_code == 400
        assert "não pertencente a esta empresa" in res_orig.json()["detail"]

        # 3. Transferência com centro_custo de outra empresa -> 400
        payload_cross_cc = {
            "conta_origem_id": 1101,
            "conta_destino_id": 1102,
            "centro_custo_id": 2201,
            "valor": 100.0,
            "data": "2026-06-15",
        }
        res_cc = client.post("/api/v1/lancamentos/transferir", json=payload_cross_cc, headers={"X-Company-ID": "1"})
        assert res_cc.status_code == 400
        assert "não pertencente a esta empresa" in res_cc.json()["detail"]

        # 4. Transferência válida dentro da mesma empresa -> 200
        payload_valid = {
            "conta_origem_id": 1101,
            "conta_destino_id": 1102,
            "valor": 100.0,
            "data": "2026-06-15",
        }
        res_valid = client.post("/api/v1/lancamentos/transferir", json=payload_valid, headers={"X-Company-ID": "1"})
        assert res_valid.status_code == 200
        assert res_valid.json()["msg"] == "Transferência realizada"

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_centro_custo_soft_delete_and_block_with_lancamentos(client: TestClient, session: Session, security_setup):
    from app.models.centro_custo import CentroCusto
    from app.models.lancamento import Lancamento
    from app.models.plano_contas import PlanoContas
    from datetime import date

    admin = security_setup["admin_user"]
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    pc = PlanoContas(id=3001, empresa_id=1, codigo="3.01", nome="Despesa Operacional", tipo="D", is_deleted=False)
    cc = CentroCusto(id=3101, empresa_id=1, nome="Almoxarifado Matriz", is_deleted=False)
    session.add(pc)
    session.add(cc)
    session.commit()

    lanc = Lancamento(
        id=3201,
        empresa_id=1,
        centro_custo_id=3101,
        plano_contas_id=3001,
        descricao="Material Almoxarifado",
        valor_previsto=80.0,
        tipo="DESPESA",
        status="EM ABERTO",
        data_vencimento=date(2026, 6, 20),
        data_competencia=date(2026, 6, 20),
        is_deleted=False,
    )
    session.add(lanc)
    session.commit()

    try:
        # 1. Tentativa de excluir centro de custo com lançamento ativo -> 400
        res_block = client.delete("/api/v1/centro-custo/3101", headers={"X-Company-ID": "1"})
        assert res_block.status_code == 400
        assert "vinculados" in res_block.json()["detail"]

        # 2. Exclui o lançamento e tenta excluir o centro de custo
        lanc.is_deleted = True
        session.add(lanc)
        session.commit()

        res_ok = client.delete("/api/v1/centro-custo/3101", headers={"X-Company-ID": "1"})
        assert res_ok.status_code == 200

        # 3. Validar soft-delete no banco
        session.expire_all()
        db_cc = session.get(CentroCusto, 3101)
        assert db_cc is not None
        assert db_cc.is_deleted is True

        # 4. Não deve constar na listagem de ativos
        res_list = client.get("/api/v1/centro-custo/", headers={"X-Company-ID": "1"})
        assert res_list.status_code == 200
        ids_ativos = [c["id"] for c in res_list.json()]
        assert 3101 not in ids_ativos

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_cartoes_cross_tenant_and_soft_delete(client: TestClient, session: Session, security_setup):
    from app.models.cartao import Cartao
    from app.models.conta import Conta
    from app.models.centro_custo import CentroCusto
    from app.models.lancamento import Lancamento
    from app.models.plano_contas import PlanoContas
    from datetime import date

    admin = security_setup["admin_user"]
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    conta_matriz = Conta(id=4001, empresa_id=1, nome="Conta Matriz Cartão", tipo="CORRENTE", is_deleted=False)
    cc_filial = CentroCusto(id=4002, empresa_id=2, nome="CC Filial Cartão", is_deleted=False)
    session.add(conta_matriz)
    session.add(cc_filial)
    session.commit()

    try:
        # 1. Tentativa de criar cartão com centro_custo de outra empresa -> 400
        payload_cross_cc = {
            "nome_cartao": "Cartão Matriz Black",
            "bandeira": "MASTERCARD",
            "dia_fechamento": 5,
            "dia_vencimento": 15,
            "conta_id": 4001,
            "centro_custo_id": 4002,
        }
        res_cross = client.post("/api/v1/cartoes/", json=payload_cross_cc, headers={"X-Company-ID": "1"})
        assert res_cross.status_code == 400
        assert "não pertence a esta empresa" in res_cross.json()["detail"]

        # 2. Criação válida de cartão
        payload_valid = {
            "nome_cartao": "Cartão Matriz OK",
            "bandeira": "VISA",
            "dia_fechamento": 5,
            "dia_vencimento": 15,
            "conta_id": 4001,
        }
        res_create = client.post("/api/v1/cartoes/", json=payload_valid, headers={"X-Company-ID": "1"})
        assert res_create.status_code == 201
        cartao_id = res_create.json()["id"]

        # 3. Vincular lançamento ao cartão
        pc = PlanoContas(id=4003, empresa_id=1, codigo="4.01", nome="Despesa Cartão", tipo="D", is_deleted=False)
        session.add(pc)
        lanc = Lancamento(
            id=4101,
            empresa_id=1,
            cartao_id=cartao_id,
            plano_contas_id=4003,
            descricao="Compra Cartão",
            valor_previsto=250.0,
            tipo="DESPESA",
            status="EM ABERTO",
            data_vencimento=date(2026, 6, 15),
            data_competencia=date(2026, 6, 15),
            is_deleted=False,
        )
        session.add(lanc)
        session.commit()

        # 4. Tentativa de excluir cartão com lançamentos vinculados -> 400
        res_del_block = client.delete(f"/api/v1/cartoes/{cartao_id}", headers={"X-Company-ID": "1"})
        assert res_del_block.status_code == 400
        assert "lançamentos financeiros vinculados" in res_del_block.json()["detail"]

        # 5. Excluir o lançamento e tentar excluir o cartão novamente
        lanc.is_deleted = True
        session.add(lanc)
        session.commit()

        res_del_ok = client.delete(f"/api/v1/cartoes/{cartao_id}", headers={"X-Company-ID": "1"})
        assert res_del_ok.status_code == 200

        # 6. Validar soft-delete no banco e na listagem
        session.expire_all()
        db_cartao = session.get(Cartao, cartao_id)
        assert db_cartao is not None
        assert db_cartao.is_deleted is True

        res_list = client.get("/api/v1/cartoes/", headers={"X-Company-ID": "1"})
        assert res_list.status_code == 200
        ids_ativos = [c["id"] for c in res_list.json()]
        assert cartao_id not in ids_ativos

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_pdv_produtos_barcode_unique_per_tenant(client: TestClient, session: Session, security_setup):
    from app.models.produto import Produto

    admin = security_setup["admin_user"]
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    try:
        # 1. Cadastra produto na Empresa 1 com barcode 7890001112223
        payload_p1 = {
            "nome": "Produto Alpha",
            "preco_unitario": 25.50,
            "tipo": "PRODUTO",
            "codigo_barras": "7890001112223",
        }
        res_p1 = client.post("/api/v1/pdv/produtos", json=payload_p1, headers={"X-Company-ID": "1"})
        assert res_p1.status_code == 201

        # 2. Tentar cadastrar outro produto na Empresa 1 com o MESMO barcode -> deve falhar 400
        payload_p1_dup = {
            "nome": "Produto Alpha Clonado",
            "preco_unitario": 30.00,
            "tipo": "PRODUTO",
            "codigo_barras": "7890001112223",
        }
        res_p1_dup = client.post("/api/v1/pdv/produtos", json=payload_p1_dup, headers={"X-Company-ID": "1"})
        assert res_p1_dup.status_code == 400
        assert "Já existe um produto com o código de barras" in res_p1_dup.json()["detail"]

        # 3. Cadastrar produto na Empresa 2 com o MESMO barcode -> deve ser PERMITIDO (isolamento multitenant)
        payload_p2 = {
            "nome": "Produto Alpha na Filial",
            "preco_unitario": 28.00,
            "tipo": "PRODUTO",
            "codigo_barras": "7890001112223",
        }
        res_p2 = client.post("/api/v1/pdv/produtos", json=payload_p2, headers={"X-Company-ID": "2"})
        assert res_p2.status_code == 201
        assert res_p2.json()["codigo_barras"] == "7890001112223"

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_contas_soft_delete_and_block_with_relations(client: TestClient, session: Session, security_setup):
    from datetime import date
    from app.models.conta import Conta
    from app.models.lancamento import Lancamento
    from app.models.movimento import Movimento
    from app.models.plano_contas import PlanoContas
    from app.models.integracao_bancaria import IntegracaoBancaria
    from app.models.cartao import Cartao

    admin = security_setup["admin_user"]
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    # 1. Cria conta e plano de contas para testes
    conta = Conta(id=5001, empresa_id=1, nome="Conta Teste Exclusao", tipo="CORRENTE", is_deleted=False)
    pc = PlanoContas(id=5003, empresa_id=1, codigo="5.03", nome="Despesa Conta Teste", tipo="D", is_deleted=False)
    session.add(conta)
    session.add(pc)
    session.commit()

    try:
        # 2. Vincula movimento bancário ativo à conta
        mov = Movimento(
            id=5001,
            empresa_id=1,
            conta_id=5001,
            descricao="Movimento PIX Teste",
            valor=100.0,
            tipo="RECEITA",
            data=date(2026, 6, 1),
            import_hash="hash-mov-5001",
            is_deleted=False,
        )
        session.add(mov)
        session.commit()

        # Tentativa de exclusão -> bloqueio 400 por movimento vinculado
        res_del_mov = client.delete("/api/v1/contas/5001", headers={"X-Company-ID": "1"})
        assert res_del_mov.status_code == 400
        assert "movimentações bancárias vinculadas" in res_del_mov.json()["detail"]

        # Remove movimento (soft delete)
        mov.is_deleted = True
        session.add(mov)
        session.commit()

        # 3. Agora adiciona lançamento financeiro ativo
        lanc = Lancamento(
            id=5002,
            empresa_id=1,
            conta_id=5001,
            plano_contas_id=5003,
            descricao="Lancamento Teste",
            valor_previsto=50.0,
            tipo="DESPESA",
            status="EM ABERTO",
            data_vencimento=date(2026, 6, 1),
            data_competencia=date(2026, 6, 1),
            is_deleted=False,
        )
        session.add(lanc)
        session.commit()

        # Tentativa de exclusão -> bloqueio 400 por lançamento vinculado
        res_del_lanc = client.delete("/api/v1/contas/5001", headers={"X-Company-ID": "1"})
        assert res_del_lanc.status_code == 400
        assert "lançamentos (transações) vinculados" in res_del_lanc.json()["detail"]

        # Remove lançamento (soft delete)
        lanc.is_deleted = True
        session.add(lanc)
        session.commit()

        # 4. Exclui a conta com sucesso
        res_del_ok = client.delete("/api/v1/contas/5001", headers={"X-Company-ID": "1"})
        assert res_del_ok.status_code == 200
        assert res_del_ok.json() == {"ok": True}

        # 5. Verifica soft-delete no banco e que a conta não aparece em listagens ativas
        session.expire_all()
        db_conta = session.get(Conta, 5001)
        assert db_conta is not None
        assert db_conta.is_deleted is True

        res_list = client.get("/api/v1/contas/", headers={"X-Company-ID": "1"})
        assert res_list.status_code == 200
        ids_contas = [c["id"] for c in res_list.json()]
        assert 5001 not in ids_contas

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_integracao_bancaria_cross_tenant_and_soft_delete(client: TestClient, session: Session, security_setup):
    from sqlmodel import select
    from app.models.integracao_bancaria import IntegracaoBancaria
    from app.models.mapeamento_categoria import MapeamentoCategoria
    from app.models.conta import Conta
    from app.models.plano_contas import PlanoContas

    admin = security_setup["admin_user"]
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    # Cria conta e categoria para Empresa 1 e categoria para Empresa 2
    conta_1 = Conta(id=6001, empresa_id=1, nome="Conta Asaas 1", tipo="CORRENTE", is_deleted=False)
    cat_filial = PlanoContas(id=6002, empresa_id=2, codigo="6.02", nome="Despesa Filial 2", tipo="D", is_deleted=False)
    cat_matriz = PlanoContas(id=6003, empresa_id=1, codigo="6.03", nome="Receita Matriz 1", tipo="R", is_deleted=False)
    session.add(conta_1)
    session.add(cat_filial)
    session.add(cat_matriz)
    session.commit()

    try:
        # 1. Tentativa de criar integração vinculando categoria padrão da Empresa 2 -> 404
        payload_cross = {
            "nome": "Asaas Teste",
            "tipo": "ASAAS",
            "ambiente": "PRODUCAO",
            "token": "token-asaas-super-secreto-123",
            "conta_id": 6001,
            "categoria_padrao_id": 6002,
        }
        res_cross = client.post("/api/v1/integracoes-bancarias/", json=payload_cross, headers={"X-Company-ID": "1"})
        assert res_cross.status_code == 404
        assert "não encontrada ou não pertence a esta empresa" in res_cross.json()["detail"]

        # 2. Criação válida da integração
        payload_valid = {
            "nome": "Asaas Valida",
            "tipo": "ASAAS",
            "ambiente": "PRODUCAO",
            "token": "token-asaas-super-secreto-123",
            "conta_id": 6001,
            "categoria_padrao_id": 6003,
        }
        res_valid = client.post("/api/v1/integracoes-bancarias/", json=payload_valid, headers={"X-Company-ID": "1"})
        assert res_valid.status_code == 201
        integ_id = res_valid.json()["id"]

        # 3. Adiciona mapeamento de categoria na integração (PAYMENT_RECEIVED -> tipo R)
        map_payload = {
            "categoria_externa": "PAYMENT_RECEIVED",
            "plano_contas_id": 6003,
        }
        res_map = client.post(f"/api/v1/integracoes-bancarias/{integ_id}/mapeamentos", json=map_payload, headers={"X-Company-ID": "1"})
        assert res_map.status_code == 201

        # 4. Exclui a integração bancária -> soft delete de integração e mapeamentos
        res_del = client.delete(f"/api/v1/integracoes-bancarias/{integ_id}", headers={"X-Company-ID": "1"})
        assert res_del.status_code == 204

        session.expire_all()
        db_integ = session.get(IntegracaoBancaria, integ_id)
        assert db_integ is not None
        assert db_integ.is_deleted is True

        map_db = session.exec(select(MapeamentoCategoria).where(MapeamentoCategoria.integracao_id == integ_id)).first()
        assert map_db is not None
        assert map_db.is_deleted is True

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_convite_usuario_cross_tenant_profile_rejection(session: Session, security_setup):
    from app.services.convite_usuario_service import convidar_ou_vincular_usuario
    from app.models.access_profile import AccessProfile
    from fastapi import HTTPException
    import pytest

    empresa1 = security_setup["empresa1"]
    empresa2 = security_setup["empresa2"]

    # Perfil exclusivo da Empresa 2
    perfil_empresa_2 = AccessProfile(
        id=7001,
        empresa_id=empresa2.id,
        name="Perfil Exclusivo Filial",
        code="PERFIL_FILIAL_EXCLUSIVO",
        is_active=True,
        is_deleted=False,
    )
    session.add(perfil_empresa_2)
    session.commit()

    # Tentativa de convidar usuário para a Empresa 1 usando o perfil da Empresa 2 -> deve levantar HTTPException 400
    with pytest.raises(HTTPException) as exc_info:
        convidar_ou_vincular_usuario(
            db=session,
            email="novo.usuario.isolado@kyrus.com.br",
            nome="Novo Usuário Isolado",
            empresa_ids=[empresa1.id],
            profile_id=7001,
        )
    assert exc_info.value.status_code == 400
    assert "não pertence à empresa" in str(exc_info.value.detail)


def test_compras_xml_soft_deleted_centro_custo_rejection(session: Session, security_setup):
    from app.services.compras_service import confirmar_e_processar_compra_xml
    from app.models.centro_custo import CentroCusto
    import pytest

    empresa1 = security_setup["empresa1"]

    cc_deleted = CentroCusto(
        id=8001,
        empresa_id=empresa1.id,
        nome="CC Deletado Compras",
        is_deleted=True,
    )
    session.add(cc_deleted)
    session.commit()

    xml_mock = b"""<?xml version="1.0" encoding="UTF-8"?>
    <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <NFe><infNFe Id="NFe12345678901234567890123456789012345678901234" versao="4.00">
            <ide><nNF>1001</nNF><dhEmi>2026-06-01T10:00:00-03:00</dhEmi></ide>
            <emit><CNPJ>11222333000199</CNPJ><xNome>Fornecedor Mock</xNome></emit>
            <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
        </infNFe></NFe>
    </nfeProc>"""

    with pytest.raises(ValueError) as exc_info:
        confirmar_e_processar_compra_xml(
            db=session,
            empresa_id=empresa1.id,
            xml_content=xml_mock,
            centro_custo_id=8001,
        )
    assert "Centro de custo inválido ou não pertencente a esta empresa" in str(exc_info.value)


def test_plano_contas_soft_delete_and_referential_integrity(client: TestClient, session: Session, security_setup):
    from datetime import date
    from decimal import Decimal
    from app.models.plano_contas import PlanoContas
    from app.models.lancamento import Lancamento
    from app.models.lancamento_cartao import LancamentoCartao
    from app.models.cartao import Cartao
    from app.models.conta import Conta
    from app.models.integracao_bancaria import IntegracaoBancaria

    admin = security_setup["admin_user"]
    empresa1 = security_setup["empresa1"]
    empresa2 = security_setup["empresa2"]

    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    try:
        # 1. Categoria pai na Empresa 2
        pai_empresa2 = PlanoContas(
            id=9001,
            empresa_id=empresa2.id,
            nome="Despesas Administrativas Filial",
            tipo="D",
            codigo="9.01",
            is_deleted=False,
        )
        session.add(pai_empresa2)
        session.commit()

        # Tentativa de criar categoria na Empresa 1 usando pai da Empresa 2 -> deve retornar 400
        payload_cross = {
            "nome": "Material de Escritório",
            "tipo": "D",
            "conta_pai_id": 9001,
        }
        res_cross = client.post("/api/v1/plano-contas/", json=payload_cross, headers={"X-Company-ID": str(empresa1.id)})
        assert res_cross.status_code == 400
        assert "Categoria pai inválida ou não pertencente a esta empresa" in res_cross.json()["detail"]

        # 2. Criar categoria válida na Empresa 1
        payload_valid = {
            "nome": "Combustível e Lubrificantes",
            "tipo": "D",
        }
        res_valid = client.post("/api/v1/plano-contas/", json=payload_valid, headers={"X-Company-ID": str(empresa1.id)})
        assert res_valid.status_code == 201
        cat_id = res_valid.json()["id"]

        # 3. Vincular lançamento financeiro -> exclusão deve ser bloqueada
        lanc = Lancamento(
            id=9101,
            empresa_id=empresa1.id,
            plano_contas_id=cat_id,
            descricao="Abastecimento Frota",
            valor_previsto=180.0,
            tipo="DESPESA",
            status="EM ABERTO",
            data_vencimento=date(2026, 6, 15),
            data_competencia=date(2026, 6, 15),
            is_deleted=False,
        )
        session.add(lanc)
        session.commit()

        res_del_lanc = client.delete(f"/api/v1/plano-contas/{cat_id}", headers={"X-Company-ID": str(empresa1.id)})
        assert res_del_lanc.status_code == 400
        assert "possui lançamentos" in res_del_lanc.json()["detail"]

        # Soft-delete o lançamento
        lanc.is_deleted = True
        session.add(lanc)
        session.commit()

        # 4. Vincular despesa de cartão -> exclusão deve ser bloqueada
        conta_banco = Conta(id=9201, empresa_id=empresa1.id, nome="Banco Cartão", tipo="BANCO", is_deleted=False)
        session.add(conta_banco)
        session.flush()
        cartao = Cartao(id=9202, empresa_id=empresa1.id, nome_cartao="Cartão Corporativo", bandeira="VISA", dia_fechamento=1, dia_vencimento=10, conta_id=9201, is_deleted=False)
        session.add(cartao)
        session.flush()
        despesa_cartao = LancamentoCartao(
            id=9203,
            empresa_id=empresa1.id,
            cartao_id=9202,
            plano_contas_id=cat_id,
            descricao="Abastecimento Cartão",
            valor=Decimal("95.00"),
            data_compra=date(2026, 6, 1),
            data_vencimento_fatura=date(2026, 6, 10),
            competencia_fatura="2026-06",
            is_deleted=False,
        )
        session.add(despesa_cartao)
        session.commit()

        res_del_cartao = client.delete(f"/api/v1/plano-contas/{cat_id}", headers={"X-Company-ID": str(empresa1.id)})
        assert res_del_cartao.status_code == 400
        assert "despesas de cartão" in res_del_cartao.json()["detail"]

        # Soft-delete despesa de cartão
        despesa_cartao.is_deleted = True
        session.add(despesa_cartao)
        session.commit()

        # 5. Vincular como categoria padrão de integração bancária -> exclusão deve ser bloqueada
        integ = IntegracaoBancaria(
            id=9301,
            nome="Integração Cora",
            empresa_id=empresa1.id,
            banco="CORA",
            tipo="CORA",
            token_criptografado="fake_encrypted_token_123",
            conta_id=9201,
            categoria_padrao_id=cat_id,
            is_deleted=False,
            ativo=True,
        )
        session.add(integ)
        session.commit()

        res_del_integ = client.delete(f"/api/v1/plano-contas/{cat_id}", headers={"X-Company-ID": str(empresa1.id)})
        assert res_del_integ.status_code == 400
        assert "categoria padrão de uma integração bancária" in res_del_integ.json()["detail"]

        # Soft-delete integração
        integ.is_deleted = True
        session.add(integ)
        session.commit()

        # 6. Exclusão agora deve suceder (soft delete)
        res_del_ok = client.delete(f"/api/v1/plano-contas/{cat_id}", headers={"X-Company-ID": str(empresa1.id)})
        assert res_del_ok.status_code == 200

        # Validar soft-delete no banco e listagem ativa
        session.expire_all()
        db_cat = session.get(PlanoContas, cat_id)
        assert db_cat is not None
        assert db_cat.is_deleted is True
        assert db_cat.deleted_at is not None

        res_list = client.get("/api/v1/plano-contas/", headers={"X-Company-ID": str(empresa1.id)})
        assert res_list.status_code == 200
        ids_ativos = [c["id"] for c in res_list.json()]
        assert cat_id not in ids_ativos

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_pdv_venda_status_cross_tenant_isolation(client: TestClient, session: Session, security_setup):
    from datetime import date
    from decimal import Decimal
    from app.models.pdv_venda import PdvVenda

    admin = security_setup["admin_user"]
    empresa1 = security_setup["empresa1"]
    empresa2 = security_setup["empresa2"]

    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    try:
        # Venda pertencente exclusivamente à Empresa 2
        venda_e2 = PdvVenda(
            id="venda-uuid-empresa-2",
            empresa_id=empresa2.id,
            data_venda=date(2026, 6, 1),
            hora_venda="12:00:00",
            valor_subtotal=Decimal("150.00"),
            valor_total=Decimal("150.00"),
            status="REALIZADO",
            is_deleted=False,
        )
        session.add(venda_e2)
        session.commit()

        # Usuário autenticado na Empresa 1 tenta alterar o status da venda da Empresa 2 -> deve retornar 404
        res = client.patch(
            "/api/v1/pdv/vendas/venda-uuid-empresa-2/status?status_in=CANCELADO",
            headers={"X-Company-ID": str(empresa1.id)},
        )
        assert res.status_code == 404
        assert "Venda não encontrada" in res.json()["detail"]

        # Garantir que no banco de dados o status da venda da Empresa 2 permaneceu inalterado
        session.expire_all()
        db_venda = session.get(PdvVenda, "venda-uuid-empresa-2")
        assert db_venda is not None
        assert db_venda.status == "REALIZADO"

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_crud_cartao_soft_delete_and_multitenancy(session: Session, security_setup):
    from app.crud import crud_cartao
    from app.schemas.cartao import CartaoCreate

    empresa1 = security_setup["empresa1"]
    empresa2 = security_setup["empresa2"]

    # Cria cartão na Empresa 1
    c1 = crud_cartao.create(
        session,
        obj_in=CartaoCreate(
            nome_cartao="Cartão Corporativo Visa",
            bandeira="VISA",
            limite=Decimal("5000.00"),
            dia_fechamento=1,
            dia_vencimento=10,
        ),
        empresa_id=empresa1.id,
    )
    assert c1.id is not None
    assert c1.is_deleted is False

    # Valida isolamento: get_multi e get_by_id na Empresa 2 não devem enxergar o cartão
    c_e2 = crud_cartao.get_by_id(session, id=c1.id, empresa_id=empresa2.id)
    assert c_e2 is None
    multi_e2 = crud_cartao.get_multi(session, empresa_id=empresa2.id)
    assert not any(c.id == c1.id for c in multi_e2)

    # Deleta cartão via CRUD (deve ser soft delete)
    del_obj = crud_cartao.delete(session, id=c1.id, empresa_id=empresa1.id)
    assert del_obj is not None
    assert del_obj.is_deleted is True
    assert del_obj.deleted_at is not None

    # Consulta pós-delete não deve retornar o cartão
    assert crud_cartao.get_by_id(session, id=c1.id, empresa_id=empresa1.id) is None
    multi_e1 = crud_cartao.get_multi(session, empresa_id=empresa1.id)
    assert not any(c.id == c1.id for c in multi_e1)


def test_crud_lancamento_delete_multi_and_transfer_isolation(session: Session, security_setup):
    from datetime import date
    from app.crud import crud_lancamento
    from app.models.lancamento import Lancamento
    from app.models.conta import Conta
    from app.schemas.lancamento import TransferenciaCreate

    empresa1 = security_setup["empresa1"]
    empresa2 = security_setup["empresa2"]

    # 1. Cria 2 lançamentos na Empresa 1
    l1 = Lancamento(
        descricao="Despesa A",
        tipo="DESPESA",
        valor_previsto=Decimal("100.00"),
        data_vencimento=date(2026, 7, 1),
        data_competencia=date(2026, 7, 1),
        competencia="2026-07",
        empresa_id=empresa1.id,
        plano_contas_id=1,
        status="EM ABERTO",
        is_deleted=False,
    )
    l2 = Lancamento(
        descricao="Despesa B",
        tipo="DESPESA",
        valor_previsto=Decimal("200.00"),
        data_vencimento=date(2026, 7, 2),
        data_competencia=date(2026, 7, 2),
        competencia="2026-07",
        empresa_id=empresa1.id,
        plano_contas_id=1,
        status="EM ABERTO",
        is_deleted=False,
    )
    session.add(l1)
    session.add(l2)
    session.commit()
    session.refresh(l1)
    session.refresh(l2)

    # Empresa 2 tenta deletar os lançamentos da Empresa 1 -> deleted_count deve ser 0
    res_cross = crud_lancamento.delete_multi(session, ids=[l1.id, l2.id], empresa_id=empresa2.id)
    assert res_cross["deleted_count"] == 0

    session.refresh(l1)
    session.refresh(l2)
    assert l1.is_deleted is False
    assert l2.is_deleted is False

    # Empresa 1 deleta seus próprios lançamentos -> soft delete aplicado
    res_valid = crud_lancamento.delete_multi(session, ids=[l1.id, l2.id], empresa_id=empresa1.id)
    assert res_valid["deleted_count"] == 2

    session.refresh(l1)
    session.refresh(l2)
    assert l1.is_deleted is True
    assert l1.deleted_at is not None
    assert l2.is_deleted is True
    assert l2.deleted_at is not None

    # 2. Testar validação de transferência com contas de outra empresa
    conta_e1 = Conta(
        nome="Conta Empresa 1",
        tipo="BANCO",
        saldo_inicial=Decimal("1000.00"),
        status="ATIVO",
        empresa_id=empresa1.id,
        is_deleted=False,
    )
    conta_e2 = Conta(
        nome="Conta Empresa 2",
        tipo="BANCO",
        saldo_inicial=Decimal("1000.00"),
        status="ATIVO",
        empresa_id=empresa2.id,
        is_deleted=False,
    )
    session.add(conta_e1)
    session.add(conta_e2)
    session.commit()
    session.refresh(conta_e1)
    session.refresh(conta_e2)

    # Tentativa de transferir de conta_e1 para conta_e2 a partir do contexto de empresa1 -> deve lançar ValueError
    transf = TransferenciaCreate(
        conta_origem_id=conta_e1.id,
        conta_destino_id=conta_e2.id,
        valor=Decimal("50.00"),
        data=date(2026, 7, 3),
        efetivado=True,
    )
    with pytest.raises(ValueError, match="Conta de destino inválida ou não pertencente a esta empresa"):
        crud_lancamento.realizar_transferencia(session, transf_in=transf, empresa_id=empresa1.id)


def test_anexo_lancamento_soft_delete_and_listing(client: TestClient, session: Session, security_setup):
    from datetime import date
    from app.models.lancamento import Lancamento
    from app.models.anexo_lancamento import AnexoLancamento

    admin = security_setup["admin_user"]
    empresa1 = security_setup["empresa1"]

    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    try:
        # Cria lançamento
        lanc = Lancamento(
            descricao="Compra de Material com Anexo",
            tipo="DESPESA",
            valor_previsto=Decimal("350.00"),
            data_vencimento=date(2026, 8, 1),
            data_competencia=date(2026, 8, 1),
            competencia="2026-08",
            empresa_id=empresa1.id,
            plano_contas_id=1,
            status="EM ABERTO",
            is_deleted=False,
        )
        session.add(lanc)
        session.commit()
        session.refresh(lanc)

        # Adiciona anexo
        anexo = AnexoLancamento(
            nome_arquivo="recibo_01.pdf",
            url="/static/uploads/lancamentos/recibo_01.pdf",
            tipo="COMPROVANTE",
            lancamento_id=lanc.id,
            empresa_id=empresa1.id,
            is_deleted=False,
        )
        session.add(anexo)
        session.commit()
        session.refresh(anexo)

        # Deleta anexo via endpoint
        res = client.delete(
            f"/api/v1/lancamentos/{lanc.id}/anexos/{anexo.id}",
            headers={"X-Company-ID": str(empresa1.id)},
        )
        assert res.status_code == 204

        # Verifica soft-delete no banco
        session.expire_all()
        db_anexo = session.get(AnexoLancamento, anexo.id)
        assert db_anexo is not None
        assert db_anexo.is_deleted is True
        assert db_anexo.deleted_at is not None

        # Tentar deletar novamente -> deve retornar 404 (já deletado)
        res_dup = client.delete(
            f"/api/v1/lancamentos/{lanc.id}/anexos/{anexo.id}",
            headers={"X-Company-ID": str(empresa1.id)},
        )
        assert res_dup.status_code == 404

        # Consulta lista de lançamentos com include_anexos=true -> não deve listar o anexo soft-deletado
        res_list = client.get(
            f"/api/v1/lancamentos/?ids={lanc.id}&include_anexos=true",
            headers={"X-Company-ID": str(empresa1.id)},
        )
        assert res_list.status_code == 200
        data = res_list.json()
        assert len(data) == 1
        assert len(data[0].get("anexos", [])) == 0

    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_comissoes_dashboard_is_manager_and_isolation(client: TestClient, session: Session, security_setup):
    from app.models.usuario import Usuario
    from app.models.empresa import Empresa

    admin = security_setup["admin_user"]
    empresa1 = security_setup["empresa1"]

    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    try:
        # Testa endpoint /api/v1/comissoes/dashboard garantindo que is_manager não gere NameError
        res = client.get(
            "/api/v1/comissoes/dashboard?mes=6&ano=2026",
            headers={"X-Company-ID": str(empresa1.id)},
        )
        assert res.status_code == 200
        data = res.json()
        assert "vendedores" in data
        assert "total_dias_uteis" in data
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_comissao_config_metas_active_vendedor_only(client: TestClient, session: Session, security_setup):
    from app.models.usuario import Usuario

    admin = security_setup["admin_user"]
    empresa1 = security_setup["empresa1"]
    empresa2 = security_setup["empresa2"]

    # Cria vendedor soft-deletado na empresa 1
    u_deleted = Usuario(
        id=7701,
        email="vendedor.deleted@empresa1.com",
        hashed_password="hash",
        nome="Vendedor Deletado",
        empresa_id=empresa1.id,
        is_active=True,
        is_deleted=True,
        is_consultor=False,
    )
    # Cria vendedor na empresa 2
    u_cross = Usuario(
        id=7702,
        email="vendedor.cross@empresa2.com",
        hashed_password="hash",
        nome="Vendedor Empresa 2",
        empresa_id=empresa2.id,
        is_active=True,
        is_deleted=False,
        is_consultor=False,
    )
    session.add(u_deleted)
    session.add(u_cross)
    session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    try:
        # 1. Tentativa de cadastrar meta para vendedor soft-deletado -> 400
        payload_del = {
            "vendedor_id": u_deleted.id,
            "mes": 6,
            "ano": 2026,
            "valor_meta": 50000.0,
        }
        res_del = client.post(
            "/api/v1/comissoes/config/metas",
            json=payload_del,
            headers={"X-Company-ID": str(empresa1.id)},
        )
        assert res_del.status_code == 400
        assert "não pertence a esta empresa" in res_del.json()["detail"]

        # 2. Tentativa de cadastrar meta para vendedor de outra empresa -> 400
        payload_cross = {
            "vendedor_id": u_cross.id,
            "mes": 6,
            "ano": 2026,
            "valor_meta": 50000.0,
        }
        res_cross = client.post(
            "/api/v1/comissoes/config/metas",
            json=payload_cross,
            headers={"X-Company-ID": str(empresa1.id)},
        )
        assert res_cross.status_code == 400
        assert "não pertence a esta empresa" in res_cross.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_cartao_lancamento_soft_delete_and_is_deleted_flag(client: TestClient, session: Session, security_setup):
    from app.models.cartao import Cartao
    from app.models.conta import Conta
    from app.models.plano_contas import PlanoContas
    from app.models.lancamento_cartao import LancamentoCartao
    from datetime import date

    admin = security_setup["admin_user"]
    empresa1 = security_setup["empresa1"]

    conta = Conta(id=7801, empresa_id=empresa1.id, nome="Conta Cartao Test", tipo="CORRENTE", saldo_inicial=0.0, is_deleted=False)
    cartao = Cartao(
        id=7802,
        empresa_id=empresa1.id,
        nome_cartao="Corporativo Visa",
        conta_id=7801,
        dia_fechamento=1,
        dia_vencimento=10,
        limite_total=10000.0,
        is_deleted=False,
    )
    pc = PlanoContas(id=7803, empresa_id=empresa1.id, codigo="4.01", nome="Despesa Cartao", tipo="D", is_deleted=False)
    session.add(conta)
    session.add(cartao)
    session.add(pc)
    session.commit()

    lc = LancamentoCartao(
        id=7804,
        empresa_id=empresa1.id,
        cartao_id=cartao.id,
        plano_contas_id=pc.id,
        descricao="Uber Viagem",
        valor=45.50,
        data_compra=date(2026, 6, 10),
        data_vencimento_fatura=date(2026, 7, 10),
        competencia_fatura="2026-07",
        fatura_paga=False,
        is_deleted=False,
    )
    session.add(lc)
    session.commit()

    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    try:
        # Exclui lançamento de cartão via endpoint
        res_del = client.delete(
            f"/api/v1/cartoes/lancamentos/{lc.id}",
            headers={"X-Company-ID": str(empresa1.id)},
        )
        assert res_del.status_code == 200

        # Verifica banco de dados: is_deleted True, deleted_at preenchido, deleted_by_id preenchido
        db_lc = session.get(LancamentoCartao, lc.id)
        assert db_lc is not None
        assert db_lc.is_deleted is True
        assert db_lc.deleted_at is not None
        assert db_lc.deleted_by_id == admin.id

        # Tenta excluir novamente -> 404
        res_dup = client.delete(
            f"/api/v1/cartoes/lancamentos/{lc.id}",
            headers={"X-Company-ID": str(empresa1.id)},
        )
        assert res_dup.status_code == 404

        # Listar lançamentos do cartão -> não deve retornar o item deletado
        res_list = client.get(
            f"/api/v1/cartoes/{cartao.id}/lancamentos",
            headers={"X-Company-ID": str(empresa1.id)},
        )
        assert res_list.status_code == 200
        items = res_list.json()
        assert all(item["id"] != lc.id for item in items)
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)


def test_lancamento_service_sync_baixa_movimento_soft_delete(session: Session, security_setup):
    from sqlmodel import select
    from app.models.lancamento import Lancamento
    from app.models.conta import Conta
    from app.models.plano_contas import PlanoContas
    from app.models.movimento import Movimento
    from app.models.baixa import Baixa
    from app.services.lancamento_service import LancamentoService
    from datetime import date

    admin = security_setup["admin_user"]
    empresa1 = security_setup["empresa1"]

    conta = Conta(id=7901, empresa_id=empresa1.id, nome="Conta Sincronizacao", tipo="CORRENTE", saldo_inicial=1000.0, is_deleted=False)
    pc = PlanoContas(id=7902, empresa_id=empresa1.id, codigo="5.01", nome="Despesa Soft Delete", tipo="D", is_deleted=False)
    session.add(conta)
    session.add(pc)
    session.commit()

    service = LancamentoService(session)

    # 1. Cria um lançamento pago
    lanc = Lancamento(
        id=7903,
        empresa_id=empresa1.id,
        conta_id=conta.id,
        plano_contas_id=pc.id,
        descricao="Pagamento Fornecedor Manual",
        valor_previsto=150.0,
        valor_pago=150.0,
        tipo="DESPESA",
        status="PAGO",
        data_vencimento=date(2026, 6, 15),
        data_pagamento=date(2026, 6, 15),
        data_competencia=date(2026, 6, 15),
        is_deleted=False,
    )
    session.add(lanc)
    session.commit()

    # Sincroniza movimento e baixa
    service._sincronizar_movimento_manual(lanc, admin.id)
    session.commit()

    # Verifica se gerou baixa e movimento MANUAL
    baixa = session.exec(select(Baixa).where(Baixa.lancamento_id == lanc.id, Baixa.is_deleted == False)).first()
    assert baixa is not None
    mov = session.get(Movimento, baixa.movimento_id)
    assert mov is not None
    assert mov.is_deleted is False

    # 2. Desmarca o pagamento (altera para EM ABERTO)
    lanc.status = "EM ABERTO"
    lanc.data_pagamento = None
    lanc.valor_pago = 0.0
    service._sincronizar_movimento_manual(lanc, admin.id)
    session.commit()

    # Verifica se baixa e movimento foram soft-deleted (NÃO removidos fisicamente)
    db_baixa = session.get(Baixa, baixa.id)
    assert db_baixa is not None
    assert db_baixa.is_deleted is True
    assert db_baixa.deleted_at is not None

    db_mov = session.get(Movimento, mov.id)
    assert db_mov is not None
    assert db_mov.is_deleted is True
    assert db_mov.deleted_at is not None


def test_websocket_unauthenticated_and_cross_tenant_rejection(client: TestClient, session: Session, security_setup):
    import pytest
    from starlette.websockets import WebSocketDisconnect
    from app.core.security import create_access_token
    from datetime import timedelta
    from app.models.usuario import Usuario

    admin = security_setup["admin_user"]
    user_e2 = Usuario(
        email="user.e2.ws@kyrus.com.br",
        hashed_password="pw",
        empresa_id=2,
        is_active=True,
        is_deleted=False,
    )
    session.add(user_e2)
    session.commit()
    session.refresh(user_e2)

    token_e1 = create_access_token(subject=admin.email, expires_delta=timedelta(minutes=30))
    token_e2 = create_access_token(subject=user_e2.email, expires_delta=timedelta(minutes=30))

    # 1. Anonymous connection must be closed with 1008 (policy violation)
    with pytest.raises(WebSocketDisconnect) as exc_anon:
        with client.websocket_connect("/api/v1/ws/empresa/1"):
            pass
    assert exc_anon.value.code == 1008

    # 2. Cross-tenant user (empresa 2) trying to listen to empresa 1 must be closed with 1008
    with pytest.raises(WebSocketDisconnect) as exc_cross:
        with client.websocket_connect(f"/api/v1/ws/empresa/1?token={token_e2}"):
            pass
    assert exc_cross.value.code == 1008

    # 3. Legitimate user of empresa 1 must connect successfully
    with client.websocket_connect(f"/api/v1/ws/empresa/1?token={token_e1}") as ws:
        ws.send_text("ping")


def test_consultor_endpoints_soft_deleted_consultor_and_usuario_checks(client: TestClient, session: Session, security_setup):
    from app.models.usuario import Usuario
    from app.models.empresa import Empresa
    from app.enums import ConsultorRole
    from app.api.deps import get_super_consultor_user

    admin = security_setup["admin_user"]
    empresa1 = session.get(Empresa, 1)

    # Cria um consultor e um usuario regular e marca ambos como soft-deleted
    del_consultor = Usuario(
        email="consultor.deletado@kyrus.com.br",
        hashed_password="hash",
        empresa_id=1,
        is_active=True,
        is_deleted=True,
        is_consultor=True,
        consultor_role=ConsultorRole.CONSULTOR.value,
    )
    del_usuario = Usuario(
        email="usuario.deletado@kyrus.com.br",
        hashed_password="hash",
        empresa_id=1,
        is_active=True,
        is_deleted=True,
        is_consultor=False,
    )
    session.add(del_consultor)
    session.add(del_usuario)
    session.commit()
    session.refresh(del_consultor)
    session.refresh(del_usuario)

    app.dependency_overrides[get_super_consultor_user] = lambda: admin
    try:
        # Endpoints de consultor devem retornar 404 para consultor soft-deleted
        r1 = client.get(f"/api/v1/consultor/super/consultores/{del_consultor.id}/empresas")
        assert r1.status_code == 404
        assert r1.json()["detail"] == "Consultor não encontrado"

        r2 = client.post(f"/api/v1/consultor/super/consultores/{del_consultor.id}/empresas/1/adicionar")
        assert r2.status_code == 404
        assert r2.json()["detail"] == "Consultor não encontrado"

        r3 = client.post(f"/api/v1/consultor/super/consultores/{del_consultor.id}/empresas/1/revogar")
        assert r3.status_code == 404
        assert r3.json()["detail"] == "Consultor não encontrado"

        r4 = client.post(f"/api/v1/consultor/super/consultores/{del_consultor.id}/role", json={"role": ConsultorRole.SUPER_CONSULTOR.value})
        assert r4.status_code == 404
        assert r4.json()["detail"] == "Consultor não encontrado"

        # Endpoints de usuario devem retornar 404 para usuario soft-deleted
        r5 = client.post(f"/api/v1/consultor/super/usuarios/{del_usuario.id}/desativar")
        assert r5.status_code == 404
        assert r5.json()["detail"] == "Usuário não encontrado"

        r6 = client.post(f"/api/v1/consultor/super/usuarios/{del_usuario.id}/ativar")
        assert r6.status_code == 404
        assert r6.json()["detail"] == "Usuário não encontrado"

        r7 = client.post(f"/api/v1/consultor/super/usuarios/{del_usuario.id}/reset-senha", json={"new_password": "NewSecretPass123!"})
        assert r7.status_code == 404
        assert r7.json()["detail"] == "Usuário não encontrado"

        r8 = client.delete(f"/api/v1/consultor/super/usuarios/{del_usuario.id}")
        assert r8.status_code == 404
        assert r8.json()["detail"] == "Usuário não encontrado"
    finally:
        app.dependency_overrides.pop(get_super_consultor_user, None)


def test_importacao_ofx_rejects_soft_deleted_conta(client: TestClient, session: Session, security_setup):
    from app.models.conta import Conta
    from app.api.deps import get_current_user, get_current_active_user

    admin = security_setup["admin_user"]
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_current_active_user] = lambda: admin

    try:
        # Cria conta soft-deleted
        conta_del = Conta(
            nome="Conta Antiga Encerrada",
            tipo="CORRENTE",
            empresa_id=1,
            is_deleted=True,
            saldo_inicial=0.0,
        )
        session.add(conta_del)
        session.commit()
        session.refresh(conta_del)

        payload = {
            "conta_id": conta_del.id,
            "itens": [
                {"tipo": "RECEITA", "valor": 500.0}
            ]
        }
        res = client.post("/api/v1/importacao/ofx/simular-saldo", json=payload, headers={"X-Company-ID": "1"})
        assert res.status_code == 404
        assert "Conta bancária não encontrada" in res.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_active_user, None)









