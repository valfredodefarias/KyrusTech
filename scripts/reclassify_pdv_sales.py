# scripts/reclassify_pdv_sales.py
import json
from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas

def main():
    print("Iniciando reclassificação contábil de Vendas PDV...")
    db = Session(engine)
    try:
        # Load all child category mappings for each company
        companies = db.exec(select(PlanoContas.empresa_id).group_by(PlanoContas.empresa_id)).all()
        print(f"Empresas no banco: {companies}")
        
        # Build category cache per company
        pc_cache = {}
        for emp_id in companies:
            pcs = db.exec(select(PlanoContas).where(PlanoContas.empresa_id == emp_id)).all()
            pc_cache[emp_id] = {
                "dinheiro": next((p.id for p in pcs if p.codigo and p.codigo.startswith("01.01")), None),
                "credito": next((p.id for p in pcs if p.codigo and p.codigo.startswith("01.02")), None),
                "debito": next((p.id for p in pcs if p.codigo and p.codigo.startswith("01.03")), None),
                # Fallback to pix_qrs or pix_deposito
                "pix": next((p.id for p in pcs if p.codigo and p.codigo.startswith("01.05")), None) or next((p.id for p in pcs if p.codigo and p.codigo.startswith("01.04")), None),
            }
            # Fallback if specific code not found, try by name
            if not pc_cache[emp_id]["dinheiro"]:
                pc_cache[emp_id]["dinheiro"] = next((p.id for p in pcs if "dinheiro" in p.nome.lower()), None)
            if not pc_cache[emp_id]["credito"]:
                pc_cache[emp_id]["credito"] = next((p.id for p in pcs if "crédito" in p.nome.lower() or "credito" in p.nome.lower()), None)
            if not pc_cache[emp_id]["debito"]:
                pc_cache[emp_id]["debito"] = next((p.id for p in pcs if "débito" in p.nome.lower() or "debito" in p.nome.lower()), None)
            if not pc_cache[emp_id]["pix"]:
                pc_cache[emp_id]["pix"] = next((p.id for p in pcs if "pix" in p.nome.lower()), None)
                
        # Load all PDV sales
        sales = db.exec(
            select(Lancamento)
            .where(Lancamento.origem == "PDV", Lancamento.is_deleted == False)
        ).all()
        
        print(f"Total de vendas PDV encontradas: {len(sales)}")
        updated_count = 0
        skipped_count = 0
        
        for sale in sales:
            emp_id = sale.empresa_id
            if emp_id not in pc_cache:
                skipped_count += 1
                continue
                
            tipo_pag = None
            if sale.observacao:
                try:
                    obs = json.loads(sale.observacao)
                    tipo_pag = obs.get("tipo_pagamento")
                except Exception:
                    pass
            
            # Resolve plan
            target_pc_id = None
            if tipo_pag:
                tipo_pag_l = tipo_pag.lower()
                if "dinheiro" in tipo_pag_l:
                    target_pc_id = pc_cache[emp_id]["dinheiro"]
                elif "debito" in tipo_pag_l:
                    target_pc_id = pc_cache[emp_id]["debito"]
                elif "credito" in tipo_pag_l:
                    target_pc_id = pc_cache[emp_id]["credito"]
                elif "pix" in tipo_pag_l:
                    target_pc_id = pc_cache[emp_id]["pix"]
            
            # Fallback based on description if json failed
            if not target_pc_id and sale.descricao:
                desc_l = sale.descricao.lower()
                if "dinheiro" in desc_l:
                    target_pc_id = pc_cache[emp_id]["dinheiro"]
                elif "debito" in desc_l:
                    target_pc_id = pc_cache[emp_id]["debito"]
                elif "credito" in desc_l:
                    target_pc_id = pc_cache[emp_id]["credito"]
                elif "pix" in desc_l:
                    target_pc_id = pc_cache[emp_id]["pix"]
                    
            if target_pc_id and sale.plano_contas_id != target_pc_id:
                sale.plano_contas_id = target_pc_id
                updated_count += 1
            else:
                skipped_count += 1
                
        db.commit()
        print(f"Reclassificação concluída! Atualizados: {updated_count} lançamentos, Mantidos/Ignorados: {skipped_count}.")
        
    except Exception as e:
        print(f"Erro durante reclassificação: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    main()
