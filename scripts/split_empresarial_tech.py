# scripts/split_empresarial_tech.py
import sys
from pathlib import Path
from sqlmodel import Session, select, text, col

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.empresa import Empresa
from app.models.conta import Conta
from app.models.plano_contas import PlanoContas
from app.models.centro_custo import CentroCusto
from app.models.entidade import Entidade
from app.models.consultor_empresa import ConsultorEmpresa

def split_empresarial_tech():
    print("=== INICIANDO MIGRAÇÃO ULTRA-RÁPIDA DO CENTRO DE CUSTO EMPRESARIALTECH ===")
    db = Session(engine)
    try:
        # 1. Find parent company (Link Financeiro)
        parent_company = db.exec(
            select(Empresa)
            .where(Empresa.nome_fantasia.like("%Link Financeiro%") | Empresa.nome_fantasia.like("%LinkFinanceiro%"))
        ).first()
        
        if not parent_company:
            print("[ERRO] Empresa mãe 'Link Financeiro' não encontrada.")
            return
            
        parent_emp_id = parent_company.id
        print(f"Empresa mãe encontrada: '{parent_company.nome_fantasia}' (ID: {parent_emp_id})")
        
        # 2. Find Cost Center (EmpresarialTech)
        cost_center = db.exec(
            select(CentroCusto)
            .where(
                CentroCusto.empresa_id == parent_emp_id,
                col(CentroCusto.nome).ilike("%empresarial%")
            )
        ).first()
        
        if not cost_center:
            print("[ERRO] Centro de Custo 'EmpresarialTech' não encontrado.")
            return
            
        cc_id = cost_center.id
        print(f"Centro de Custo encontrado: '{cost_center.nome}' (ID: {cc_id})")
        
        # 3. Create or Fetch New Company
        new_company_name = "Empresarial Tech"
        existing_new = db.exec(select(Empresa).where(Empresa.nome_fantasia == new_company_name)).first()
        if existing_new:
            print(f"Empresa '{new_company_name}' já existe (ID: {existing_new.id}).")
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
        print("\nMapeando e Copiando Plano de Contas...")
        old_pcs = db.exec(select(PlanoContas).where(PlanoContas.empresa_id == parent_emp_id)).all()
        plano_map = {}
        for pc in old_pcs:
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
        print(f"  - Mapeadas {len(plano_map)} categorias do plano de contas.")
        
        # 5. Fetch Account IDs to migrate
        contas = db.exec(
            select(Conta)
            .where(Conta.empresa_id == parent_emp_id, Conta.centro_custo_id == cc_id)
        ).all()
        conta_ids = [c.id for c in contas]
        
        # 6. Fetch referenced Entities in target transactions
        print("\nMapeando e Copiando Entidades...")
        # Get raw entity IDs from transactions using SQL
        res_entities = db.execute(
            text("SELECT DISTINCT entidade_id FROM lancamentos WHERE empresa_id = :parent_id AND (centro_custo_id = :cc_id OR conta_id = ANY(:conta_ids))"),
            {"parent_id": parent_emp_id, "cc_id": cc_id, "conta_ids": list(conta_ids) if conta_ids else [-1]}
        ).all()
        referenced_entity_ids = [r[0] for r in res_entities if r[0] is not None]
        
        entity_map = {}
        for ent_id in referenced_entity_ids:
            ent = db.get(Entidade, ent_id)
            if ent:
                existing_ent = db.exec(
                    select(Entidade)
                    .where(Entidade.empresa_id == new_emp_id, Entidade.nome == ent.nome)
                ).first()
                if existing_ent:
                    entity_map[ent_id] = existing_ent.id
                else:
                    new_ent = Entidade(
                        nome=ent.nome,
                        tipo=ent.tipo,
                        tipo_pessoa=ent.tipo_pessoa,
                        nome_fantasia=ent.nome_fantasia,
                        cpf_cnpj=ent.cpf_cnpj,
                        email=ent.email,
                        telefone=ent.telefone,
                        celular=ent.celular,
                        contato_nome=ent.contato_nome,
                        cep=ent.cep,
                        logradouro=ent.logradouro,
                        numero=ent.numero,
                        complemento=ent.complemento,
                        bairro=ent.bairro,
                        cidade=ent.cidade,
                        uf=ent.uf,
                        observacoes=ent.observacoes,
                        status=ent.status,
                        empresa_id=new_emp_id
                    )
                    db.add(new_ent)
                    db.flush()
                    entity_map[ent_id] = new_ent.id
        print(f"  - Mapeadas {len(entity_map)} entidades.")

        # 7. BULK SQL UPDATES - Fast Execution
        print("\nExecutando Atualizações em Lote (BULK SQL)...")
        
        # Update Contas
        res_contas = db.execute(
            text("UPDATE contas SET empresa_id = :new_emp_id WHERE empresa_id = :parent_id AND centro_custo_id = :cc_id"),
            {"new_emp_id": new_emp_id, "parent_id": parent_emp_id, "cc_id": cc_id}
        )
        print(f"  - Contas bancárias movidas: {res_contas.rowcount}")

        # Update Centro de Custo
        res_cc = db.execute(
            text("UPDATE centros_custo SET empresa_id = :new_emp_id WHERE id = :cc_id"),
            {"new_emp_id": new_emp_id, "cc_id": cc_id}
        )
        print(f"  - Centros de custo movidos: {res_cc.rowcount}")
        
        # Update Cartões Corporativos
        res_cartao = db.execute(
            text("UPDATE cartoes SET empresa_id = :new_emp_id WHERE empresa_id = :parent_id AND centro_custo_id = :cc_id"),
            {"new_emp_id": new_emp_id, "parent_id": parent_emp_id, "cc_id": cc_id}
        )
        print(f"  - Cartões corporativos movidos: {res_cartao.rowcount}")
        
        # Update Integrações Bancárias
        res_integ = db.execute(
            text("UPDATE integracoes_bancarias SET empresa_id = :new_emp_id WHERE empresa_id = :parent_id AND (centro_custo_id = :cc_id OR conta_id = ANY(:conta_ids))"),
            {"new_emp_id": new_emp_id, "parent_id": parent_emp_id, "cc_id": cc_id, "conta_ids": list(conta_ids) if conta_ids else [-1]}
        )
        print(f"  - Integrações bancárias movidas: {res_integ.rowcount}")
        
        # Update Regras de Comissão
        res_com = db.execute(
            text("UPDATE regras_comissao SET empresa_id = :new_emp_id WHERE empresa_id = :parent_id AND centro_custo_id = :cc_id"),
            {"new_emp_id": new_emp_id, "parent_id": parent_emp_id, "cc_id": cc_id}
        )
        print(f"  - Regras de comissão movidas: {res_com.rowcount}")
        
        # Update Regras de Cartão
        res_rc = db.execute(
            text("UPDATE regras_cartao SET empresa_id = :new_emp_id WHERE empresa_id = :parent_id AND centro_custo_id = :cc_id"),
            {"new_emp_id": new_emp_id, "parent_id": parent_emp_id, "cc_id": cc_id}
        )
        print(f"  - Regras de cartão movidas: {res_rc.rowcount}")
        
        # Update PDV Vendas e Movimentações
        res_pv = db.execute(
            text("UPDATE pdv_vendas SET empresa_id = :new_emp_id WHERE empresa_id = :parent_id AND centro_custo_id = :cc_id"),
            {"new_emp_id": new_emp_id, "parent_id": parent_emp_id, "cc_id": cc_id}
        )
        res_pm = db.execute(
            text("UPDATE pdv_movimentacoes SET empresa_id = :new_emp_id WHERE empresa_id = :parent_id AND centro_custo_id = :cc_id"),
            {"new_emp_id": new_emp_id, "parent_id": parent_emp_id, "cc_id": cc_id}
        )
        print(f"  - Movimentos operacionais de PDV movidos: Vendas={res_pv.rowcount}, Movimentações={res_pm.rowcount}")
        
        # 8. Migrate Lancamentos (Lote principal)
        res_txs = db.execute(
            text("UPDATE lancamentos SET empresa_id = :new_emp_id WHERE empresa_id = :parent_id AND (centro_custo_id = :cc_id OR conta_id = ANY(:conta_ids))"),
            {"new_emp_id": new_emp_id, "parent_id": parent_emp_id, "cc_id": cc_id, "conta_ids": list(conta_ids) if conta_ids else [-1]}
        )
        print(f"  - Lançamentos financeiros movidos: {res_txs.rowcount}")
        
        # Remap PlanoContas IDs inside the new company in bulk per category
        print("\nRemapeando categorias contábeis nos lançamentos...")
        for old_id, new_id in plano_map.items():
            db.execute(
                text("UPDATE lancamentos SET plano_contas_id = :new_id WHERE empresa_id = :new_emp_id AND plano_contas_id = :old_id"),
                {"new_id": new_id, "new_emp_id": new_emp_id, "old_id": old_id}
            )
            
        # Clean any cross-company PlanoContas leak
        res_pc_clean = db.execute(
            text("""
                UPDATE lancamentos 
                SET plano_contas_id = NULL 
                WHERE empresa_id = :new_emp_id 
                  AND plano_contas_id IS NOT NULL 
                  AND plano_contas_id NOT IN (
                      SELECT id FROM plano_contas WHERE empresa_id = :new_emp_id
                  )
            """),
            {"new_emp_id": new_emp_id}
        )
        print(f"  - Limpos {res_pc_clean.rowcount} vínculos residuais de categorias.")
        
        # Remap Entity IDs in bulk per entity
        print("Remapeando clientes e fornecedores...")
        for old_id, new_id in entity_map.items():
            db.execute(
                text("UPDATE lancamentos SET entidade_id = :new_id WHERE empresa_id = :new_emp_id AND entidade_id = :old_id"),
                {"new_id": new_id, "new_emp_id": new_emp_id, "old_id": old_id}
            )
            
        # Clean any cross-company Entity leak
        res_ent_clean = db.execute(
            text("""
                UPDATE lancamentos 
                SET entidade_id = NULL 
                WHERE empresa_id = :new_emp_id 
                  AND entidade_id IS NOT NULL 
                  AND entidade_id NOT IN (
                      SELECT id FROM entidades WHERE empresa_id = :new_emp_id
                  )
            """),
            {"new_emp_id": new_emp_id}
        )
        print(f"  - Limpos {res_ent_clean.rowcount} vínculos residuais de entidades.")
        
        # 9. Configure Consultant permissions for the new company
        print("\nConfigurando permissões de consultores...")
        consultor_links = db.exec(
            select(ConsultorEmpresa)
            .where(ConsultorEmpresa.empresa_id == parent_emp_id, ConsultorEmpresa.ativo == True)
        ).all()
        
        for link in consultor_links:
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
                
        db.commit()
        print(f"\n[OK] SUCESSO! A migração da '{new_company_name}' foi concluída em milissegundos via BULK SQL!")
        
    except Exception as e:
        print(f"\n[ERRO] Ocorreu uma falha durante a migração: {e}")
        db.rollback()
        raise e
    finally:
        db.close()

if __name__ == "__main__":
    split_empresarial_tech()
