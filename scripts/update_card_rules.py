import sys
import os
import json
from datetime import datetime

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlmodel import select, Session
from decimal import Decimal
from app.db.session import engine
from app.models.empresa import Empresa
from app.models.centro_custo import CentroCusto
from app.models.regra_cartao import RegraCartao

BACKUP_FILE = os.path.join(os.path.dirname(__file__), "backups", "card_rules_backup.json")

def get_target(db, name):
    cc = db.exec(select(CentroCusto).where(CentroCusto.nome.ilike(f"%{name}%"))).first()
    if cc:
        return {"empresa_id": cc.empresa_id, "centro_custo_id": cc.id, "type": "Centro de Custo", "name": cc.nome}
    
    empresa = db.exec(select(Empresa).where(Empresa.nome_fantasia.ilike(f"%{name}%"))).first()
    if empresa:
        return {"empresa_id": empresa.id, "centro_custo_id": None, "type": "Empresa", "name": empresa.nome_fantasia}
    return None

def apply_rules(db, target, rules, backup_data):
    print(f"\nAplicando regras para: {target['name']}")
    hoje = datetime(2026, 8, 1).date() # Sábado passado
    
    for r in rules:
        tipo_pagamento = r["tipo"]
        bandeiras = ["PIX"] if tipo_pagamento == "pix" else ["VISA", "MASTERCARD", "ELO", "AMEX", "OUTROS"]
        
        for bandeira in bandeiras:
            # Check if there is already a rule for today
            regra_hoje = db.exec(
                select(RegraCartao)
                .where(
                    RegraCartao.empresa_id == target["empresa_id"],
                    RegraCartao.centro_custo_id == target["centro_custo_id"],
                    RegraCartao.tipo_pagamento == tipo_pagamento,
                    RegraCartao.bandeira == bandeira,
                    RegraCartao.data_inicio == hoje,
                    RegraCartao.is_deleted == False
                )
            ).first()
            
            if regra_hoje:
                regra_hoje.taxa_porcentagem = Decimal(str(r["taxa"]))
                regra_hoje.dias_payout = r["dias"]
                regra_hoje.tipo_prazo = r.get("prazo", "DIAS_UTEIS")
                print(f"  -> Atualizada regra de HOJE {bandeira} - {tipo_pagamento} para {r['taxa']}% e {r['dias']} {regra_hoje.tipo_prazo}")
            else:
                nova = RegraCartao(
                    empresa_id=target["empresa_id"],
                    centro_custo_id=target["centro_custo_id"],
                    tipo_pagamento=tipo_pagamento,
                    bandeira=bandeira,
                    taxa_porcentagem=Decimal(str(r["taxa"])),
                    dias_payout=r["dias"],
                    tipo_prazo=r.get("prazo", "DIAS_UTEIS"),
                    modo_parcelamento="PRO_RATA",
                    fds_proximo_dia_util=True,
                    data_inicio=hoje
                )
                db.add(nova)
                db.flush()
                print(f"  -> Criada NOVA versao de regra {bandeira} - {tipo_pagamento} para {r['taxa']}% a partir de {hoje}")

def run_update():
    print("--- INICIANDO ATUALIZAÇÃO DE TAXAS DE CARTÃO ---")
    backup_data = {}
    
    # Carrega backup existente se quiser incrementar, senao cria um novo
    if os.path.exists(BACKUP_FILE):
        with open(BACKUP_FILE, "r") as f:
            backup_data = json.load(f)

    with Session(engine) as db:
        # Umarizal
        umarizal = get_target(db, "umarizal")
        if umarizal:
            apply_rules(db, umarizal, [
                {"tipo": "cartao_debito", "taxa": 0.80, "dias": 2},
                {"tipo": "cartao_credito_vista", "taxa": 1.88, "dias": 31},
                {"tipo": "cartao_credito_parcelado", "taxa": 1.88, "dias": 31}
            ], backup_data)
        
        # Ananindeua
        ananindeua = get_target(db, "ananindeua")
        if ananindeua:
            apply_rules(db, ananindeua, [
                {"tipo": "pix", "taxa": 0.00, "dias": 1, "prazo": "DIAS_CORRIDOS"},
                {"tipo": "cartao_debito", "taxa": 0.85, "dias": 2},
                {"tipo": "cartao_credito_vista", "taxa": 3.12, "dias": 2},
                {"tipo": "cartao_credito_parcelado", "taxa": 3.12, "dias": 2}
            ], backup_data)
        
        # Marco Salão
        marco = get_target(db, "marco - salão")
        if marco:
            apply_rules(db, marco, [
                {"tipo": "pix", "taxa": 0.00, "dias": 1, "prazo": "DIAS_CORRIDOS"},
                {"tipo": "cartao_debito", "taxa": 0.85, "dias": 2},
                {"tipo": "cartao_credito_vista", "taxa": 3.12, "dias": 2},
                {"tipo": "cartao_credito_parcelado", "taxa": 3.12, "dias": 2}
            ], backup_data)
            
        # Marco Delivery
        delivery = get_target(db, "delivery")
        if delivery:
            apply_rules(db, delivery, [
                {"tipo": "pix", "taxa": 0.00, "dias": 1, "prazo": "DIAS_CORRIDOS"},
                {"tipo": "cartao_debito", "taxa": 0.85, "dias": 2},
                {"tipo": "cartao_credito_vista", "taxa": 3.12, "dias": 2},
                {"tipo": "cartao_credito_parcelado", "taxa": 3.12, "dias": 2}
            ], backup_data)

        db.commit()
        
    with open(BACKUP_FILE, "w") as f:
        json.dump(backup_data, f)
        
    print(f"\nSucesso! Backup salvo em {BACKUP_FILE}")

def run_restore():
    print("--- RESTAURANDO TAXAS DE CARTÃO ---")
    if not os.path.exists(BACKUP_FILE):
        print("Nenhum arquivo de backup encontrado!")
        return
        
    with open(BACKUP_FILE, "r") as f:
        backup_data = json.load(f)
        
    with Session(engine) as db:
        for key, data in backup_data.items():
            if str(key).startswith("new_"):
                # Foi criada, vamos deletar
                regra = db.get(RegraCartao, data["id"])
                if regra:
                    db.delete(regra)
                    print(f"Deletada regra nova criada (ID: {data['id']})")
            else:
                regra = db.get(RegraCartao, data["id"])
                if regra:
                    regra.taxa_porcentagem = Decimal(str(data["taxa_porcentagem"]))
                    regra.dias_payout = data["dias_payout"]
                    regra.tipo_prazo = data["tipo_prazo"]
                    db.add(regra)
                    print(f"Regra (ID: {data['id']}) restaurada para {data['taxa_porcentagem']}%")
        db.commit()
        
    # Limpar backup
    os.remove(BACKUP_FILE)
    print("\nRestauração concluída com sucesso!")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "restore":
        run_restore()
    else:
        run_update()
