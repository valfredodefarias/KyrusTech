import sys
import os
import argparse
from datetime import datetime

# Certifique-se de que o python run command execute do diretorio correto.
sys.path.insert(0, os.path.abspath("."))
os.environ["DISABLE_AUDIT"] = "1"

from sqlmodel import Session, select
from app.db.session import engine
from app.models.conta import Conta
from app.models.lancamento import Lancamento
from app.models.baixa import Baixa
from app.models.movimento import Movimento

def clear_conta_rmusic(empresa_id: int = 27, conta_id: int = 215, apply: bool = False):
    with Session(engine) as db:
        conta = db.get(Conta, conta_id)
        if not conta:
            print(f"Conta ID {conta_id} não encontrada!")
            return

        print(f"=== LIMPANDO LANÇAMENTOS E BAIXAS DA CONTA: {conta.nome} (ID {conta.id}) ===")
        print(f"Modo: {'APLICAÇÃO REAL' if apply else 'SIMULAÇÃO (DRY RUN)'}")
        
        # 1. Encontrar todos os lançamentos ativos (não deletados) de Julho
        from datetime import date
        lances = db.exec(
            select(Lancamento).where(
                Lancamento.empresa_id == empresa_id,
                Lancamento.conta_id == conta_id,
                Lancamento.is_deleted == False,
                Lancamento.data_vencimento >= date(2026, 7, 1),
                Lancamento.data_vencimento <= date(2026, 7, 31)
            )
        ).all()
        
        print(f"\n[1] Lançamentos ativos encontrados: {len(lances)}")
        
        # 2. Processar Lançamentos e Baixas associadas
        baixas_deletadas = 0
        lances_deletados = 0
        
        for l in lances:
            # Buscar baixas
            baixas = db.exec(select(Baixa).where(Baixa.lancamento_id == l.id, Baixa.is_deleted == False)).all()
            for b in baixas:
                baixas_deletadas += 1
                if apply:
                    b.is_deleted = True
                    b.deleted_at = datetime.utcnow()
                    db.add(b)
            
            lances_deletados += 1
            if apply:
                l.is_deleted = True
                l.deleted_at = datetime.utcnow()
                db.add(l)
                
        # 3. Soft-delete também os movimentos bancários (OFX/Extrato) para evitar que fiquem pendentes na conciliação
        movs = db.exec(
            select(Movimento).where(
                Movimento.empresa_id == empresa_id,
                Movimento.conta_id == conta_id,
                Movimento.is_deleted == False,
                Movimento.data_compensacao >= date(2026, 7, 1),
                Movimento.data_compensacao <= date(2026, 7, 31)
            )
        ).all()
        
        print(f"[2] Movimentos bancários ativos encontrados: {len(movs)}")
        movs_deletados = 0
        for m in movs:
            movs_deletados += 1
            if apply:
                m.is_deleted = True
                db.add(m)
        
        if apply:
            db.commit()
            print("\n✅ Todas as deleções lógicas (soft-delete) foram aplicadas com sucesso no banco de dados!")
        else:
            print("\n⚠️ Nenhuma alteração foi salva no banco. Para aplicar, execute o script com '--apply'.")
            
        print("\n=== RESUMO ===")
        print(f"Lançamentos desativados: {lances_deletados}")
        print(f"Baixas vinculadas desativadas: {baixas_deletadas}")
        print(f"Movimentos bancários desativados: {movs_deletados}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Limpar lançamentos da conta Itaú RMUSIC")
    parser.add_argument("--apply", action="store_true", help="Aplica a exclusão no banco de dados")
    args = parser.parse_args()
    
    clear_conta_rmusic(27, 215, apply=args.apply)
