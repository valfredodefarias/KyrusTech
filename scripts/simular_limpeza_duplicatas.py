from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
import re

def run():
    session = Session(engine)
    
    # Obter todas as categorias
    categorias = session.exec(select(PlanoContas)).all()
    categoria_by_id = {c.id: f"{c.codigo} - {c.nome}" for c in categorias}
    
    EMPRESAS_IDS = [35, 37, 39, 40]
    
    # Padrões de descrição de duplicatas de vendas
    KEYWORDS = [
        "movimentacao", "movimentação", "movimento", "pix", "rede", "stone", 
        "visa", "mast", "elo", "sangria", "amex", "getnet", "cielo", 
        "pagseguro", "ifood", "debito", "débito", "credito", "crédito",
        "brendi"
    ]
    
    for emp_id in EMPRESAS_IDS:
        print(f"\n==================================================")
        print(f"SIMULAÇÃO EMPRESA ID: {emp_id}")
        print(f"==================================================")
        
        launches = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == emp_id,
                Lancamento.tipo == "RECEITA",
                Lancamento.origem == "WEB",
                Lancamento.is_deleted == False
            )
        ).all()
        
        total_value_active = sum(l.valor_previsto for l in launches)
        print(f"Total de receitas WEB ativas: {len(launches)} (Valor total: R$ {total_value_active:,.2f})")
        
        to_delete = []
        to_keep = []
        
        for l in launches:
            desc = (l.descricao or "").lower()
            obs = (l.observacao or "").lower()
            
            # Verificar se a descrição ou obs contém qualquer uma das palavras chave de duplicatas
            is_dup = False
            for kw in KEYWORDS:
                if kw in desc or kw in obs:
                    is_dup = True
                    break
                    
            # Apenas deleta se vier da importação
            if "importação financeiro" not in obs and "importacao financeiro" not in obs:
                is_dup = False
                
            # Exceções: Rendimentos e dividendos não devem ser deletados
            cat_name = (categoria_by_id.get(l.plano_contas_id, "")).lower()
            if "rendimento" in cat_name or "dividendo" in cat_name:
                is_dup = False
                
            if is_dup:
                to_delete.append(l)
            else:
                to_keep.append(l)
                
        val_delete = sum(l.valor_previsto for l in to_delete)
        val_keep = sum(l.valor_previsto for l in to_keep)
        
        print(f"-> Para DELETAR: {len(to_delete)} lançamentos (Valor: R$ {val_delete:,.2f})")
        print(f"-> Para MANTER: {len(to_keep)} lançamentos (Valor: R$ {val_keep:,.2f})")
        
        # Mostrar o que vamos MANTER para garantir que não estamos apagando nada errado
        print("\n--- Exemplos de lançamentos que seriam MANTIDOS (origem WEB) ---")
        for l in to_keep[:10]:
            print(f"  ID: {l.id} | Cat: {categoria_by_id.get(l.plano_contas_id)} | Desc: '{l.descricao}' | Obs: '{l.observacao}' | Valor: R$ {l.valor_previsto:.2f}")

if __name__ == "__main__":
    run()
