# scripts/delete_company.py
import sys
from pathlib import Path
from sqlmodel import Session, select

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models import *  # noqa: F401, F403
from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.conta import Conta
from app.models.plano_contas import PlanoContas
from app.models.centro_custo import CentroCusto
from app.models.entidade import Entidade
from app.models.regra_cartao import RegraCartao
from app.models.regra_comissao import RegraComissao
from app.models.cartao import Cartao
from app.models.integracao_bancaria import IntegracaoBancaria
from app.models.produto import Produto
from app.models.dashboard_view_config import DashboardViewConfig
from app.models.user_company_profile import UserCompanyProfile
from app.models.lancamento import Lancamento
from app.models.pdv_venda import PdvVenda
from app.models.pdv_venda_item import PdvVendaItem
from app.models.pdv_movimentacao import PdvMovimentacao
from app.models.pdv_ifood_lancamento import PdvIfoodLancamento
from app.models.consultor_empresa import ConsultorEmpresa

def delete_company_data(company_name: str):
    print(f"=== DELETANDO DADOS DA EMPRESA: '{company_name}' ===")
    db = Session(engine)
    try:
        # Find company
        company = db.exec(select(Empresa).where(Empresa.nome_fantasia == company_name)).first()
        if not company:
            print(f"Empresa '{company_name}' não encontrada no banco. Nenhuma ação necessária.")
            return
            
        empresa_id = company.id
        print(f"Encontrada empresa ID: {empresa_id}")
        
        # Deleting dependent items in correct order of foreign keys
        
        # 1. PdvMovimentacao
        movs = db.exec(select(PdvMovimentacao).where(PdvMovimentacao.empresa_id == empresa_id)).all()
        print(f"Deletando {len(movs)} PdvMovimentacoes...")
        for item in movs:
            db.delete(item)
        db.flush()
        
        # 2. PdvVendaItem (via PdvVenda ID)
        sales = db.exec(select(PdvVenda).where(PdvVenda.empresa_id == empresa_id)).all()
        sale_ids = [s.id for s in sales]
        if sale_ids:
            items = db.exec(select(PdvVendaItem).where(PdvVendaItem.venda_id.in_(sale_ids))).all()
            print(f"Deletando {len(items)} itens de venda (PdvVendaItem)...")
            for item in items:
                db.delete(item)
            db.flush()
            
        # 3. PdvVenda
        print(f"Deletando {len(sales)} vendas (PdvVenda)...")
        for item in sales:
            db.delete(item)
        db.flush()
        
        # 4. Lancamento (All financial entries)
        txs = db.exec(select(Lancamento).where(Lancamento.empresa_id == empresa_id)).all()
        print(f"Deletando {len(txs)} lançamentos (Lancamento)...")
        for item in txs:
            db.delete(item)
        db.flush()
        
        # 5. PdvIfoodLancamento
        ifood_txs = db.exec(select(PdvIfoodLancamento).where(PdvIfoodLancamento.empresa_id == empresa_id)).all()
        print(f"Deletando {len(ifood_txs)} conciliações de iFood...")
        for item in ifood_txs:
            db.delete(item)
        db.flush()
        
        # 6. RegraCartao
        regras_cartao = db.exec(select(RegraCartao).where(RegraCartao.empresa_id == empresa_id)).all()
        print(f"Deletando {len(regras_cartao)} regras de cartão (RegraCartao)...")
        for item in regras_cartao:
            db.delete(item)
        db.flush()

        # 7. RegraComissao
        regras_comissao = db.exec(select(RegraComissao).where(RegraComissao.empresa_id == empresa_id)).all()
        print(f"Deletando {len(regras_comissao)} regras de comissão (RegraComissao)...")
        for item in regras_comissao:
            db.delete(item)
        db.flush()

        # 8. Cartao
        cartoes = db.exec(select(Cartao).where(Cartao.empresa_id == empresa_id)).all()
        print(f"Deletando {len(cartoes)} cartões (Cartao)...")
        for item in cartoes:
            db.delete(item)
        db.flush()

        # 9. IntegracaoBancaria
        integracoes = db.exec(select(IntegracaoBancaria).where(IntegracaoBancaria.empresa_id == empresa_id)).all()
        print(f"Deletando {len(integracoes)} integrações bancárias (IntegracaoBancaria)...")
        for item in integracoes:
            db.delete(item)
        db.flush()

        # 10. Produto
        produtos = db.exec(select(Produto).where(Produto.empresa_id == empresa_id)).all()
        print(f"Deletando {len(produtos)} produtos (Produto)...")
        for item in produtos:
            db.delete(item)
        db.flush()

        # 11. DashboardViewConfig
        configs = db.exec(select(DashboardViewConfig).where(DashboardViewConfig.empresa_id == empresa_id)).all()
        print(f"Deletando {len(configs)} configs de dashboard (DashboardViewConfig)...")
        for item in configs:
            db.delete(item)
        db.flush()
        
        # 12. Entidade
        entidades = db.exec(select(Entidade).where(Entidade.empresa_id == empresa_id)).all()
        print(f"Deletando {len(entidades)} entidades (Clientes/Fornecedores)...")
        for item in entidades:
            db.delete(item)
        db.flush()
        
        # 13. PlanoContas
        pcs = db.exec(select(PlanoContas).where(PlanoContas.empresa_id == empresa_id)).all()
        print(f"Deletando {len(pcs)} categorias (PlanoContas)...")
        for item in pcs:
            db.delete(item)
        db.flush()
        
        # 14. Conta (Bank accounts)
        contas = db.exec(select(Conta).where(Conta.empresa_id == empresa_id)).all()
        print(f"Deletando {len(contas)} contas bancárias (Conta)...")
        for item in contas:
            db.delete(item)
        db.flush()
        
        # 15. CentroCusto
        ccs = db.exec(select(CentroCusto).where(CentroCusto.empresa_id == empresa_id)).all()
        print(f"Deletando {len(ccs)} centros de custo (CentroCusto)...")
        for item in ccs:
            db.delete(item)
        db.flush()
        
        # 16. ConsultorEmpresa
        acessos = db.exec(select(ConsultorEmpresa).where(ConsultorEmpresa.empresa_id == empresa_id)).all()
        print(f"Deletando {len(acessos)} vínculos de consultoria...")
        for item in acessos:
            db.delete(item)
        db.flush()

        # 17. UserCompanyProfile
        profiles = db.exec(select(UserCompanyProfile).where(UserCompanyProfile.empresa_id == empresa_id)).all()
        print(f"Deletando {len(profiles)} perfis de acesso (UserCompanyProfile)...")
        for item in profiles:
            db.delete(item)
        db.flush()
        
        # 18. Usuario (only non-consultant users belonging to this company)
        users = db.exec(
            select(Usuario)
            .where(Usuario.empresa_id == empresa_id, Usuario.is_consultor == False)
        ).all()
        print(f"Deletando {len(users)} usuários locais (não consultores)...")
        for item in users:
            db.delete(item)
        db.flush()
        
        # 19. Empresa (the company itself)
        db.delete(company)
        db.commit()
        print(f"\n[OK] Empresa '{company_name}' e todos os seus dados foram deletados com sucesso!")
        
    except Exception as e:
        print(f"ERRO durante deleção: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    name = "Pizza Fábio Marco"
    if len(sys.argv) > 1:
        name = " ".join(sys.argv[1:])
    delete_company_data(name)
