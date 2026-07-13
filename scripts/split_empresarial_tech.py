# scripts/split_empresarial_tech.py
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
from app.models.lancamento import Lancamento
from app.models.consultor_empresa import ConsultorEmpresa

def split_empresarial_tech():
    print("=== INICIANDO MIGRAÇÃO DO CENTRO DE CUSTO EMPRESARIALTECH ===")
    db = Session(engine)
    try:
        # 1. Find parent company (Link Financeiro)
        parent_company = db.exec(
            select(Empresa)
            .where(Empresa.nome_fantasia.like("%Link Financeiro%") | Empresa.nome_fantasia.like("%LinkFinanceiro%"))
        ).first()
        
        if not parent_company:
            print("[ERRO] Empresa mãe 'Link Financeiro' não encontrada. Verifique se o nome está correto.")
            return
            
        print(f"Empresa mãe encontrada: '{parent_company.nome_fantasia}' (ID: {parent_company.id})")
        
        # 2. Find Cost Center (EmpresarialTech)
        cost_center = db.exec(
            select(CentroCusto)
            .where(
                CentroCusto.empresa_id == parent_company.id,
                CentroCusto.nome.like("%Empresarial%")
            )
        ).first()
        
        if not cost_center:
            print("[ERRO] Centro de Custo 'EmpresarialTech' não encontrado na empresa mãe. Abortando.")
            return
            
        cc_id = cost_center.id
        print(f"Centro de Custo encontrado: '{cost_center.nome}' (ID: {cc_id})")
        
        # 3. Create New Company (Empresarial Tech)
        new_company_name = "Empresarial Tech"
        existing_new = db.exec(select(Empresa).where(Empresa.nome_fantasia == new_company_name)).first()
        if existing_new:
            print(f"Nova empresa '{new_company_name}' já existe (ID: {existing_new.id}). Utilizando existente.")
            new_company = existing_new
        else:
            new_company = Empresa(
                nome_fantasia=new_company_name,
                razao_social=f"{new_company_name} LTDA",
                cnpj="legacy-empresarialtech",
                is_active=True
            )
            db.add(new_company)
            db.flush()
            print(f"Criada nova empresa: '{new_company_name}' (ID: {new_company.id})")
            
        new_emp_id = new_company.id
        
        # 4. Copy PlanoContas structure to the new company
        print("\nCopiando Plano de Contas...")
        old_pcs = db.exec(select(PlanoContas).where(PlanoContas.empresa_id == parent_company.id)).all()
        
        plano_map = {}
        for pc in old_pcs:
            # Check if this code already exists for the new company
            existing_pc = db.exec(
                select(PlanoContas)
                .where(PlanoContas.empresa_id == new_emp_id, PlanoContas.codigo == pc.codigo)
            ).first()
            
            if existing_pc:
                plano_map[pc.id] = existing_pc.id
            else:
                new_pc = PlanoContas(
                    codigo=pc.codigo,
                    nome=pc.nome,
                    tipo=pc.tipo,
                    eh_cabecalho=pc.eh_cabecalho,
                    permite_lancamentos=pc.permite_lancamentos,
                    empresa_id=new_emp_id
                )
                db.add(new_pc)
                db.flush()
                plano_map[pc.id] = new_pc.id
        print(f"Plano de contas copiado: {len(plano_map)} categorias mapeadas.")
        
        # 5. Migrate Bank Accounts (Conta) belonging to that cost center
        print("\nMigrando Contas Bancárias vinculadas ao Centro de Custo...")
        contas = db.exec(
            select(Conta)
            .where(Conta.empresa_id == parent_company.id, Conta.centro_custo_id == cc_id)
        ).all()
        
        conta_ids = [c.id for c in contas]
        for c in contas:
            c.empresa_id = new_emp_id
            db.add(c)
            print(f"  - Conta bancária movida: '{c.nome}' (ID: {c.id})")
        db.flush()
        
        # 6. Migrate Centro de Custo itself
        print("\nMovendo Centro de Custo...")
        cost_center.empresa_id = new_emp_id
        db.add(cost_center)
        db.flush()
        print(f"  - Centro de Custo '{cost_center.nome}' movido para a nova empresa.")
        
        # 7. Migrate Entities (Clientes/Fornecedores) referenced by EmpresarialTech transactions
        print("\nMigrando Entidades (Clientes/Fornecedores)...")
        # Find all entity IDs used in those transactions
        referenced_entity_ids = db.exec(
            select(Lancamento.entidade_id)
            .where(Lancamento.empresa_id == parent_company.id, Lancamento.centro_custo_id == cc_id)
            .group_by(Lancamento.entidade_id)
        ).all()
        
        entity_map = {}
        for ent_id in referenced_entity_ids:
            if not ent_id:
                continue
            ent = db.get(Entidade, ent_id)
            if not ent:
                continue
                
            # Copy entity to new company
            existing_ent = db.exec(
                select(Entidade)
                .where(Entidade.empresa_id == new_emp_id, Entidade.nome == ent.nome)
            ).first()
            
            if existing_ent:
                entity_map[ent_id] = existing_ent.id
            else:
                new_ent = Entidade(
                    nome=ent.nome,
                    documento=ent.documento,
                    tipo=ent.tipo,
                    status=ent.status,
                    empresa_id=new_emp_id
                )
                db.add(new_ent)
                db.flush()
                entity_map[ent_id] = new_ent.id
        print(f"Entidades copiadas/mapeadas: {len(entity_map)}")
        
        # 8. Migrate Transactions (Lancamento)
        print("\nMigrando Lançamentos Financeiros...")
        # Match by cost center OR by the migrated account IDs
        txs_query = select(Lancamento).where(
            (Lancamento.empresa_id == parent_company.id) & 
            ((Lancamento.centro_custo_id == cc_id) | (Lancamento.conta_id.in_(conta_ids)))
        )
        txs = db.exec(txs_query).all()
        
        migrated_tx_count = 0
        for tx in txs:
            tx.empresa_id = new_emp_id
            
            # Map plano de contas to new company plano de contas
            if tx.plano_contas_id:
                if tx.plano_contas_id in plano_map:
                    tx.plano_contas_id = plano_map[tx.plano_contas_id]
                else:
                    tx.plano_contas_id = None
                
            # Map entity to new company entity
            if tx.entidade_id:
                if tx.entidade_id in entity_map:
                    tx.entidade_id = entity_map[tx.entidade_id]
                else:
                    tx.entidade_id = None
                
            db.add(tx)
            migrated_tx_count += 1
            
        db.flush()
        print(f"Lançamentos migrados com sucesso: {migrated_tx_count}")
        
        # 9. Migrate Cartao (Corporate credit cards)
        print("\nMigrando Cartões Corporativos...")
        cartoes = db.exec(select(Cartao).where(Cartao.empresa_id == parent_company.id, Cartao.centro_custo_id == cc_id)).all()
        for cartao in cartoes:
            cartao.empresa_id = new_emp_id
            db.add(cartao)
            print(f"  - Cartão movido: '{cartao.nome}' (ID: {cartao.id})")
        db.flush()

        # 10. Migrate IntegracaoBancaria (API configurations)
        print("\nMigrando Integrações Bancárias...")
        integracoes = db.exec(
            select(IntegracaoBancaria)
            .where(
                IntegracaoBancaria.empresa_id == parent_company.id,
                (IntegracaoBancaria.centro_custo_id == cc_id) | (IntegracaoBancaria.conta_id.in_(conta_ids))
            )
        ).all()
        for integ in integracoes:
            integ.empresa_id = new_emp_id
            db.add(integ)
            print(f"  - Integração Bancária movida (ID: {integ.id}, Tipo: {integ.tipo_provedor})")
        db.flush()

        # 11. Migrate RegraComissao
        print("\nMigrando Regras de Comissão...")
        comissoes = db.exec(select(RegraComissao).where(RegraComissao.empresa_id == parent_company.id, RegraComissao.centro_custo_id == cc_id)).all()
        for com in comissoes:
            com.empresa_id = new_emp_id
            db.add(com)
            print(f"  - Regra de Comissão movida (ID: {com.id})")
        db.flush()

        # 12. Migrate RegraCartao
        print("\nMigrando Regras de Cartão...")
        regras_cartao = db.exec(select(RegraCartao).where(RegraCartao.empresa_id == parent_company.id, RegraCartao.centro_custo_id == cc_id)).all()
        for rc in regras_cartao:
            rc.empresa_id = new_emp_id
            db.add(rc)
            print(f"  - Regra de Cartão movida (ID: {rc.id})")
        db.flush()

        # 13. Migrate PdvVenda & PdvMovimentacao (operational sales)
        print("\nMigrando Vendas e Movimentações de PDV...")
        pdv_sales = db.exec(select(PdvVenda).where(PdvVenda.empresa_id == parent_company.id, PdvVenda.centro_custo_id == cc_id)).all()
        for sale in pdv_sales:
            sale.empresa_id = new_emp_id
            db.add(sale)
        db.flush()
        
        pdv_movs = db.exec(select(PdvMovimentacao).where(PdvMovimentacao.empresa_id == parent_company.id, PdvMovimentacao.centro_custo_id == cc_id)).all()
        for mov in pdv_movs:
            mov.empresa_id = new_emp_id
            db.add(mov)
        db.flush()
        
        # 14. Link new company to all super consultores and consultores of the parent company
        print("\nConfigurando acessos para consultores...")
        consultor_links = db.exec(
            select(ConsultorEmpresa)
            .where(ConsultorEmpresa.empresa_id == parent_company.id, ConsultorEmpresa.ativo == True)
        ).all()
        
        for link in consultor_links:
            # Check if link already exists for the new company
            existing_link = db.exec(
                select(ConsultorEmpresa)
                .where(ConsultorEmpresa.usuario_id == link.usuario_id, ConsultorEmpresa.empresa_id == new_emp_id)
            ).first()
            
            if not existing_link:
                new_link = ConsultorEmpresa(
                    usuario_id=link.usuario_id,
                    empresa_id=new_emp_id,
                    ativo=True
                )
                db.add(new_link)
        db.flush()
        
        db.commit()
        print(f"\n[OK] SUCESSO! O Centro de Custo 'EmpresarialTech' foi migrado para a empresa '{new_company_name}'!")
        print(f"Resumo da migração:")
        print(f"  - Contas bancárias movidas: {len(conta_ids)}")
        print(f"  - Lançamentos migrados: {migrated_tx_count}")
        print(f"  - Entidades migradas: {len(entity_map)}")
        print(f"  - Cartões corporativos migrados: {len(cartoes)}")
        print(f"  - Integrações bancárias migradas: {len(integracoes)}")
        print(f"  - Regras de Comissão migradas: {len(comissoes)}")
        print(f"  - Regras de Cartão migradas: {len(regras_cartao)}")
        print(f"  - Vendas PDV migradas: {len(pdv_sales)}")
        
    except Exception as e:
        print(f"\n[ERRO] Ocorreu uma falha durante a migração: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    split_empresarial_tech()
