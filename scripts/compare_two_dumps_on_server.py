# scripts/compare_two_dumps_on_server.py
import sys
import subprocess
from pathlib import Path
from sqlalchemy import create_engine, text
from decimal import Decimal
from datetime import date

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import settings

def run_cmd(cmd):
    try:
        res = subprocess.run(cmd, check=False, capture_output=True, text=True)
        return res.returncode, res.stdout, res.stderr
    except Exception as e:
        return 1, "", str(e)

def get_dre_totals(conn, empresa_id, year=2026, month=6):
    inicio_mes = date(year, month, 1)
    if month == 12:
        fim_mes = date(year, 12, 31)
    else:
        import calendar
        fim_mes = date(year, month, calendar.monthrange(year, month)[1])
        
    cat_rows = conn.execute(text("""
        SELECT id, nome, codigo, tipo, dre_grupo
        FROM plano_contas
        WHERE empresa_id = :empresa_id AND is_deleted = false AND oculta = false
    """), {"empresa_id": empresa_id}).all()
    
    categorias_por_id = {row[0]: row for row in cat_rows}
    
    rows = conn.execute(text("""
        SELECT plano_contas_id, tipo, data_competencia, data_vencimento, valor_pago, valor_previsto, data_pagamento, observacao
        FROM lancamentos
        WHERE empresa_id = :empresa_id
          AND is_deleted = false
          AND COALESCE(data_competencia, data_vencimento) >= :inicio_mes
          AND COALESCE(data_competencia, data_vencimento) <= :fim_mes
    """), {"empresa_id": empresa_id, "inicio_mes": inicio_mes, "fim_mes": fim_mes}).all()
    
    tot_rec = Decimal("0")
    tot_desp = Decimal("0")
    
    for row in rows:
        pid = row[0]
        t_lan = row[1]
        v_pago = Decimal(str(row[4] or 0))
        v_prev = Decimal(str(row[5] or 0))
        d_pag = row[6]
        
        cat = categorias_por_id.get(pid)
        if not cat:
            continue
        dre_g = str(cat[4] or "").strip().upper()
        if dre_g in ("FORA_DRE", "FORA DRE", "FORA DA DRE"):
            continue
            
        if d_pag is not None or v_pago != Decimal("0"):
            val = v_pago if v_pago != Decimal("0") else v_prev
        else:
            val = v_prev
            
        tipo = str(cat[3] or t_lan or "").upper()
        if tipo.startswith("R") or tipo == "RECEITA":
            tot_rec += val
        elif tipo.startswith("D") or tipo == "DESPESA":
            tot_desp += val
            
    return tot_rec, tot_desp, tot_rec - tot_desp

def main():
    print("==========================================================================================")
    print("COMPARATIVO CIRÚRGICO DA DRE E DOS DADOS: BACKUP MEIO-DIA (11:28H) vs PRODUÇÃO RECENTE")
    print("==========================================================================================")
    
    base_db_url = str(settings.DATABASE_URL).replace("postgresql+psycopg2://", "postgresql://")
    # URLs for temporary comparison DBs
    midday_db_name = "db_midday_temp"
    recent_db_name = "db_recent_temp"
    
    # Root connection to create DBs
    admin_url = base_db_url.rsplit("/", 1)[0] + "/postgres"
    admin_eng = create_engine(admin_url)
    
    with admin_eng.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {midday_db_name};"))
        conn.execute(text(f"CREATE DATABASE {midday_db_name};"))
        conn.execute(text(f"DROP DATABASE IF EXISTS {recent_db_name};"))
        conn.execute(text(f"CREATE DATABASE {recent_db_name};"))
        
    print("✅ Bancos de comparação 'db_midday_temp' e 'db_recent_temp' criados no Postgres!")
    
    midday_dump_file = ROOT_DIR / "backups" / "backup_producao (1).dump"
    if not midday_dump_file.exists():
        midday_dump_file = ROOT_DIR / "backups" / "backup_producao.dump"
        
    recent_dump_file = ROOT_DIR / "backups" / "backup_producao (2).dump"
    if not recent_dump_file.exists():
        recent_dump_file = ROOT_DIR / "backups" / "prod_backup_today.dump"
        
    url_midday = base_db_url.rsplit("/", 1)[0] + f"/{midday_db_name}"
    url_recent = base_db_url.rsplit("/", 1)[0] + f"/{recent_db_name}"
    
    print(f"\n1. Restaurando Backup Meio-dia ({midday_dump_file.name}) em {midday_db_name}...")
    run_cmd(["pg_restore", "--dbname", url_midday, "--no-owner", "--no-privileges", str(midday_dump_file)])
    
    print(f"2. Restaurando Backup Recente ({recent_dump_file.name}) em {recent_db_name}...")
    run_cmd(["pg_restore", "--dbname", url_recent, "--no-owner", "--no-privileges", str(recent_dump_file)])
    
    midday_eng = create_engine(url_midday)
    recent_eng = create_engine(url_recent)
    
    empresas = [
        (27, "Rosário Belém"),
        (35, "Pizza Fábio Umarizal"),
        (37, "Pizza Fábio Ananindeua"),
        (39, "Pizza Fábio Marco - Salão"),
        (40, "Pizza Fábio Marco - Delivery")
    ]
    
    with midday_eng.connect() as m_conn, recent_eng.connect() as r_conn:
        print("\n------------------------------------------------------------------------------------------")
        print("📌 COMPARATIVO DE TOTAL DE REGISTROS POR TABELA:")
        print("------------------------------------------------------------------------------------------")
        for t in ["lancamentos", "contas", "pdv_vendas", "pdv_movimentacoes", "plano_contas"]:
            c_mid = m_conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
            c_rec = r_conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
            diff = c_rec - c_mid
            print(f"  Tabela [{t:18s}]: Meio-dia (11:28h) = {c_mid:8d} | Recente = {c_rec:8d} | Dif = {diff:+8d}")
            
        print("\n------------------------------------------------------------------------------------------")
        print("📌 COMPARATIVO DE RECEITAS DA DRE MÊS A MÊS (JANEIRO A JULHO/2026):")
        print("------------------------------------------------------------------------------------------")
        for emp_id, emp_name in empresas:
            print(f"\n🏬 Empresa [{emp_id}] {emp_name}:")
            for month in range(1, 8):
                m_rec, m_desp, m_res = get_dre_totals(m_conn, emp_id, 2026, month)
                r_rec, r_desp, r_res = get_dre_totals(r_conn, emp_id, 2026, month)
                diff_rec = r_rec - m_rec
                diff_res = r_res - m_res
                status = "✅ MATCH" if abs(diff_res) < Decimal("0.01") else f"❌ DIF: Rec Dif R$ {diff_rec:10.2f} | Res Dif R$ {diff_res:10.2f}"
                print(f"  Mês 2026-{month:02d}: Meio-dia Rec = R$ {m_rec:11.2f} | Recente Rec = R$ {r_rec:11.2f} | {status}")

if __name__ == "__main__":
    main()
