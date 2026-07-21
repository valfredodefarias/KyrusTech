from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from collections import defaultdict

def run():
    session = Session(engine)
    
    # Mapear categorias por ID
    categorias = session.exec(select(PlanoContas)).all()
    categoria_by_id = {c.id: f"{c.codigo} - {c.nome}" for c in categorias}
    
    EMPRESAS_IDS = [35, 37, 39, 40]
    
    print("=== ANÁLISE DE DUPLICATAS RESTANTES APÓS APLICAÇÃO ===")
    
    for emp_id in EMPRESAS_IDS:
        # 1. Contar excluídos por duplicidade
        deleted_count = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == emp_id,
                Lancamento.is_deleted == True,
                Lancamento.descricao.like("[DUPLICADO DELETADO]%")
            )
        ).all()
        
        # 2. Buscar todas as receitas ATIVAS
        active_receitas = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == emp_id,
                Lancamento.tipo == "RECEITA",
                Lancamento.is_deleted == False
            )
        ).all()
        
        print(f"\n--------------------------------------------------")
        print(f"Empresa ID: {emp_id}")
        print(f"--------------------------------------------------")
        print(f"Lançamentos já deletados como duplicidade: {len(deleted_count)}")
        print(f"Lançamentos de receita ativos restantes: {len(active_receitas)}")
        
        # Agrupar receitas ativas por (data, valor)
        groups = defaultdict(list)
        for l in active_receitas:
            groups[(l.data_vencimento, round(float(l.valor_previsto), 2))].append(l)
            
        dup_groups = []
        for (dt, val), items in groups.items():
            if len(items) > 1:
                origins = {l.origem for l in items}
                if "PDV" in origins and "WEB" in origins:
                    dup_groups.append(((dt, val), items))
                    
        print(f"Grupos de potenciais duplicidades ainda ATIVOS (mesmo valor e data, origens PDV e WEB): {len(dup_groups)}")
        
        # Mostrar os primeiros 5 grupos de duplicidades restantes
        for (dt, val), items in dup_groups[:5]:
            print(f"\n  Data: {dt} | Valor: R$ {val:.2f}")
            for l in items:
                cat_name = categoria_by_id.get(l.plano_contas_id, f"Desconhecida (ID: {l.plano_contas_id})")
                print(f"    ID: {l.id} | Origem: {l.origem} | Cat: {cat_name} | Desc: '{l.descricao}' | Obs: '{l.observacao}' | Status: {l.status}")

if __name__ == "__main__":
    run()
