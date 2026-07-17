import sys
import json
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.pdv_venda import PdvVenda
from app.models.pdv_venda_item import PdvVendaItem

def main():
    if len(sys.argv) < 2:
        print("Uso: python delete_legacy_sale.py <pdv_venda_id>")
        sys.exit(1)
        
    venda_id = sys.argv[1]
    
    db = Session(engine)
    try:
        # Find the sale
        venda = db.get(PdvVenda, venda_id)
        if not venda:
            print(f"Venda {venda_id} não encontrada.")
            sys.exit(1)
            
        print(f"Encontrada venda: {venda.id} - {venda.valor_total} - RV: {venda.rv}")
        
        # Find launches associated with the sale
        launches = db.exec(select(Lancamento).where(Lancamento.empresa_id == 27)).all()
        launches_to_delete = []
        for l in launches:
            if l.observacao and venda_id in l.observacao:
                launches_to_delete.append(l)
                
        print(f"Lançamentos associados encontrados para excluir: {len(launches_to_delete)}")
        for l in launches_to_delete:
            print(f"  Lançamento: ID {l.id}, Data {l.data_vencimento}, Valor {l.valor_pago}, Conciliado: {l.conciliado}")
            
        # Find items
        items = db.exec(select(PdvVendaItem).where(PdvVendaItem.venda_id == venda_id)).all()
        print(f"Itens da venda encontrados para excluir: {len(items)}")
        
        # Perform deletion
        # 1. Un-reconcile launches if any
        for l in launches_to_delete:
            l.conciliado = False
            db.add(l)
        db.flush()
        
        # 2. Delete launches
        for l in launches_to_delete:
            db.delete(l)
            
        # 3. Delete items
        for item in items:
            db.delete(item)
            
        # 4. Delete sale
        db.delete(venda)
        
        db.commit()
        print("Exclusão concluída com sucesso!")
        
    except Exception as e:
        db.rollback()
        print(f"Erro ao excluir venda: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
