import os
import sys
import pandas as pd
from datetime import datetime, date
from decimal import Decimal
from collections import defaultdict
from sqlmodel import Session, select, or_

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DISABLE_AUDIT", "1")

from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.conta import Conta

# Normalize date helper
def to_date(val):
    if pd.isna(val):
        return None
    if isinstance(val, (datetime, date)):
        return val.date() if isinstance(val, datetime) else val
    try:
        dt = pd.to_datetime(val)
        return dt.date()
    except:
        return None

# Normalize decimal helper
def to_decimal(val):
    if pd.isna(val):
        return Decimal("0.00")
    return Decimal(f"{float(val):.2f}")

# Helper to calculate account balance using the exact formula from contas.py
def get_calculated_balance(session, conta_id):
    conta = session.get(Conta, conta_id)
    val_inicial = Decimal(str(conta.saldo_inicial or 0))
    
    # Query paid revenues
    receitas = session.exec(
        select(Lancamento)
        .where(
            Lancamento.conta_id == conta_id,
            Lancamento.tipo == "RECEITA",
            Lancamento.is_deleted == False,
            or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None)),
            or_(
                Lancamento.observacao.is_(None),
                (~Lancamento.observacao.ilike("%DestinoCompra DEMONSTRACAO%") & ~Lancamento.observacao.ilike('%"legacy_id_venda"%'))
            )
        )
    ).all()
    
    # Query paid expenses
    despesas = session.exec(
        select(Lancamento)
        .where(
            Lancamento.conta_id == conta_id,
            Lancamento.tipo == "DESPESA",
            Lancamento.is_deleted == False,
            or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None)),
            or_(
                Lancamento.observacao.is_(None),
                (~Lancamento.observacao.ilike("%DestinoCompra DEMONSTRACAO%") & ~Lancamento.observacao.ilike('%"legacy_id_venda"%'))
            )
        )
    ).all()
    
    val_receitas = sum(Decimal(str(r.valor_pago or 0)) for r in receitas)
    val_despesas = sum(Decimal(str(d.valor_pago or 0)) for d in despesas)
    
    return val_inicial + val_receitas - val_despesas

# Normalize status helper
def normalize_status(st):
    st = str(st).strip().upper()
    if st in ["PAGO", "LIQUIDADO"]:
        return "PAGO"
    return "PENDENTE"

def run():
    session = Session(engine)
    
    dry_run = "--commit" not in sys.argv
    if dry_run:
        print("=== MODO SIMULAÇÃO (DRY RUN) - Nenhuma alteração será salva no banco ===")
        print("Para salvar de fato, execute com o parâmetro: --commit\n")
    else:
        print("=== MODO COMPROMETIMENTO (COMMIT) - Alterações serão gravadas! ===\n")
        
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # Mapeamento de empresas para arquivos de planilha
    MAPPING = {
        35: {
            "name": "Pizza Fábio Umarizal LTDA",
            "file": os.path.join(base_dir, "backups", "Base_PizzaFabioUmarizal.xlsx")
        },
        37: {
            "name": "Pizza Fábio Ananindeua LTDA",
            "file": os.path.join(base_dir, "backups", "Base_PizzaFabioAnanindeua.xlsx")
        },
        39: {
            "name": "Pizza Fábio Marco - Salão LTDA",
            "file": os.path.join(base_dir, "backups", "fabio", "Base_PizzaFabioMarco (1).xlsx")
        },
        40: {
            "name": "Pizza Fábio Marco - Delivery LTDA",
            "file": os.path.join(base_dir, "backups", "Base_IFood_PizzaFabioMarco.xlsx")
        }
    }
    
    for emp_id, info in MAPPING.items():
        print(f"\n==================================================")
        print(f"PROCESSANDO: {info['name']} (ID: {emp_id})")
        print(f"Spreadsheet: {info['file']}")
        print(f"==================================================")
        
        if not os.path.exists(info["file"]):
            print(f"ERROR: Planilha {info['file']} não encontrada. Pulando...")
            continue
            
        print("Carregando planilha...")
        df = pd.read_excel(info["file"], sheet_name="Tb_Financeira")
        print(f"Planilha carregada. Total de linhas: {len(df)}")
        
        # Mapear planilha por IdFinanceiro
        df["Data Vcto"] = pd.to_datetime(df["Data Vcto"])
        df_old = df[df["Data Vcto"] < "2026-07-14"]
        sheet_by_id = {str(row["IdFinanceiro"]).strip(): row for _, row in df_old.iterrows()}
        print(f"Registros históricos na planilha (< 14/07): {len(sheet_by_id)}")
        
        # Salvar saldos originais calculados de todas as contas da empresa
        contas = session.exec(select(Conta).where(Conta.empresa_id == emp_id)).all()
        original_balances = {}
        for acc in contas:
            original_balances[acc.id] = get_calculated_balance(session, acc.id)
            print(f"Conta '{acc.nome}' (ID: {acc.id}) | Saldo Atual: R$ {original_balances[acc.id]:,.2f} | Saldo Inicial: R$ {acc.saldo_inicial:,.2f}")
            
        # Buscar lançamentos no banco de dados
        db_lances = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == emp_id,
                Lancamento.data_vencimento < '2026-07-14',
                Lancamento.is_deleted == False
            )
        ).all()
        print(f"Lançamentos históricos no banco (< 14/07): {len(db_lances)}")
        
        # Guardar saldos iniciais originais
        original_saldos_iniciais = {acc.id: acc.saldo_inicial for acc in contas}
        
        # Comparar e realizar as alterações
        mismatches_count = 0
        corrected_count = 0
        
        for l in db_lances:
            h = (l.import_hash or "").strip()
            if not h:
                continue
            if h.startswith("legacy-"):
                h = h[7:]
            if h in sheet_by_id:
                row = sheet_by_id[h]
                sheet_status = normalize_status(row["Situa\u00e7\u00e3o"])
                db_status = normalize_status(l.status)
                
                if db_status != sheet_status:
                    mismatches_count += 1
                    
                    # Status corrigido
                    if sheet_status == "PENDENTE" and db_status == "PAGO":
                        corrected_count += 1
                        l.status = "EM ABERTO"
                        l.valor_pago = Decimal("0.00")
                        l.data_pagamento = None
                        l.updated_at = datetime.utcnow()
                        session.add(l)
                        
                    elif sheet_status == "PAGO" and db_status == "PENDENTE":
                        corrected_count += 1
                        l.status = "PAGO"
                        l.valor_pago = l.valor_previsto
                        l.data_pagamento = l.data_vencimento
                        l.updated_at = datetime.utcnow()
                        session.add(l)
                        
        print(f"Divergências encontradas: {mismatches_count} | Corrigidas: {corrected_count}")
        session.flush()
        
        # Ajustar saldos iniciais de cada conta
        print("\nCalculando ajustes de Saldo Inicial...")
        for acc in contas:
            # Recalcular receitas e despesas pagas com os novos status
            receitas = session.exec(
                select(Lancamento)
                .where(
                    Lancamento.conta_id == acc.id,
                    Lancamento.tipo == "RECEITA",
                    Lancamento.is_deleted == False,
                    or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None)),
                    or_(
                        Lancamento.observacao.is_(None),
                        (~Lancamento.observacao.ilike("%DestinoCompra DEMONSTRACAO%") & ~Lancamento.observacao.ilike('%"legacy_id_venda"%'))
                    )
                )
            ).all()
            
            despesas = session.exec(
                select(Lancamento)
                .where(
                    Lancamento.conta_id == acc.id,
                    Lancamento.tipo == "DESPESA",
                    Lancamento.is_deleted == False,
                    or_(Lancamento.status == "PAGO", Lancamento.data_pagamento.is_not(None)),
                    or_(
                        Lancamento.observacao.is_(None),
                        (~Lancamento.observacao.ilike("%DestinoCompra DEMONSTRACAO%") & ~Lancamento.observacao.ilike('%"legacy_id_venda"%'))
                    )
                )
            ).all()
            
            val_receitas = sum(Decimal(str(r.valor_pago or 0)) for r in receitas)
            val_despesas = sum(Decimal(str(d.valor_pago or 0)) for d in despesas)
            
            # novo_saldo_inicial = saldo_original_calculado - val_receitas + val_despesas
            orig_bal = original_balances[acc.id]
            novo_saldo_inicial = orig_bal - val_receitas + val_despesas
            
            diff = novo_saldo_inicial - original_saldos_iniciais[acc.id]
            
            if abs(diff) > Decimal("0.001"):
                print(f"  AJUSTANDO conta '{acc.nome}':")
                print(f"    Saldo Inicial Antigo: R$ {original_saldos_iniciais[acc.id]:,.2f}")
                print(f"    Novo Saldo Inicial:  R$ {novo_saldo_inicial:,.2f}")
                print(f"    Ajuste (Delta):      R$ {diff:+,.2f}")
                acc.saldo_inicial = novo_saldo_inicial
                session.add(acc)
            else:
                print(f"  Conta '{acc.nome}': nenhuma mudança necessária.")
                
        session.flush()
        
        # Verificação final para essa empresa
        all_matched = True
        print("\nVerificando consistência dos saldos pós-ajuste...")
        for acc in contas:
            final_bal = get_calculated_balance(session, acc.id)
            orig_bal = original_balances[acc.id]
            diff = final_bal - orig_bal
            print(f"  Conta '{acc.nome}': Saldo Original: R$ {orig_bal:,.2f} | Saldo Novo: R$ {final_bal:,.2f} | Diferença: R$ {diff:,.2f}")
            if abs(diff) > Decimal("0.001"):
                all_matched = False
                
        if not all_matched:
            print(f"ERROR: Falha de consistência de saldos para a empresa {info['name']}. Abortando...")
            session.rollback()
            sys.exit(1)
            
        print(f"Sucesso: Todos os saldos da empresa {info['name']} continuam batendo perfeitamente!")
        
    if not dry_run:
        print("\nGravando alterações de forma definitiva no banco de dados...")
        session.commit()
        print("[OK] Alterações persistidas com sucesso!")
    else:
        print("\nModo Simulação: Nenhuma alteração foi gravada. Revertendo...")
        session.rollback()

if __name__ == "__main__":
    run()
