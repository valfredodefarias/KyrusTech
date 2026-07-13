# scripts/inspect_fix_active_apps.py
# Diagnóstica e corrige os active_apps de cada pizzaria
import sys, json
from pathlib import Path
from sqlmodel import Session, select

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.empresa import Empresa

PIZZARIAS = [
    "Pizza Fábio Umarizal",
    "Pizza Fábio Ananindeua",
    "Pizza Fábio Marco - Salão",
    "Pizza Fábio Marco - Delivery",
]

# Apps que DEVEM estar ativos para todas as pizzarias
REQUIRED_APPS = ["movimentacao_pdv", "ifood"]

def main():
    db = Session(engine)
    try:
        print("=== DIAGNÓSTICO & CORREÇÃO DE active_apps ===\n")
        
        for nome in PIZZARIAS:
            empresa = db.exec(select(Empresa).where(Empresa.nome_fantasia == nome, Empresa.is_deleted == False)).first()
            if not empresa:
                print(f"[ERRO] Empresa '{nome}' não encontrada.")
                continue
            
            # Parse pdv_config
            config = {}
            if empresa.pdv_config:
                try:
                    config = json.loads(empresa.pdv_config)
                except Exception:
                    config = {}
            
            active_apps = config.get("active_apps", [])
            print(f"📦 {nome} (ID: {empresa.id})")
            print(f"   active_apps ATUAL: {active_apps}")
            
            # Add missing apps
            missing = [app for app in REQUIRED_APPS if app not in active_apps]
            if missing:
                active_apps = list(set(active_apps + missing))
                config["active_apps"] = active_apps
                empresa.pdv_config = json.dumps(config, ensure_ascii=False)
                db.add(empresa)
                print(f"   ✅ CORRIGIDO: adicionados {missing} -> active_apps agora: {active_apps}")
            else:
                print(f"   ✅ OK: todos os apps já estão ativos.")
            print()
        
        db.commit()
        print("[OK] Correções salvas com sucesso!")
        
    except Exception as e:
        print(f"[ERRO] {e}")
        db.rollback()
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    main()
