# scripts/inspect_integracoes.py
import sys
from pathlib import Path
from sqlmodel import Session, select

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.db.session import engine
from app.models.empresa import Empresa

def main():
    db = Session(engine)
    try:
        # Import integration model dynamically (might be named differently)
        try:
            from app.models.integracao import Integracao
            has_integracao = True
        except ImportError:
            has_integracao = False
            print("[AVISO] Model 'Integracao' não encontrado, tentando alternativas...")

        try:
            from app.models.pdv_integracao import PdvIntegracao
            has_pdv_integracao = True
        except ImportError:
            has_pdv_integracao = False

        # Find Umarizal
        target_company_names = [
            "Pizza Fábio Umarizal",
            "Pizza Fábio Ananindeua",
            "Pizza Fábio Marco - Salão",
            "Pizza Fábio Marco - Delivery",
        ]
        
        companies = db.exec(
            select(Empresa).where(Empresa.is_deleted == False)
        ).all()
        
        pizza_companies = [c for c in companies if any(name in (c.nome_fantasia or "") for name in target_company_names)]
        
        print("=== DIAGNÓSTICO DE INTEGRAÇÕES POR EMPRESA ===\n")
        
        for company in pizza_companies:
            print(f"📦 {company.nome_fantasia} (ID: {company.id})")
            
            if has_integracao:
                integracoes = db.exec(
                    select(Integracao).where(
                        Integracao.empresa_id == company.id,
                        Integracao.is_deleted == False
                    )
                ).all()
                if integracoes:
                    for intg in integracoes:
                        tipo = getattr(intg, 'tipo', getattr(intg, 'type', 'N/A'))
                        ativo = getattr(intg, 'is_active', 'N/A')
                        nome = getattr(intg, 'nome', getattr(intg, 'name', 'N/A'))
                        print(f"   ✅ Integração: '{nome}' | tipo={tipo} | ativo={ativo} (ID: {intg.id})")
                else:
                    print(f"   ❌ Nenhuma integração cadastrada para esta empresa!")
            
            print()

    except Exception as e:
        print(f"[ERRO] {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    main()
