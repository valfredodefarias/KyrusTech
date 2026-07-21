from sqlmodel import Session, select
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.models.conta import Conta
from decimal import Decimal

def run(dry_run=True):
    session = Session(engine)
    
    # Mapear códigos por empresa
    DUPLICATE_CODES_BY_EMP = {
        35: {'01.01.01', '01.01.02', '01.01.03', '01.01.04', '01.01.05'},
        37: {'01.01', '01.02', '01.03', '01.04', '01.05'},
        39: {'01.01', '01.02', '01.03', '01.04', '01.05'},
        40: {'01.01.01', '01.01.02', '01.01.03', '01.01.04', '01.01.05'}
    }
    
    EMPRESAS_IDS = [35, 37, 39, 40]
    
    # Obter todas as categorias e contas
    categorias = session.exec(select(PlanoContas)).all()
    categoria_by_id = {c.id: c for c in categorias}
    
    contas = session.exec(select(Conta)).all()
    conta_by_id = {c.id: c for c in contas}
    
    print(f"=== {'SIMULAÇÃO' if dry_run else 'EXECUÇÃO REAL'} DE LIMPEZA DE RECEITAS DUPLICADAS ===")
    
    for emp_id in EMPRESAS_IDS:
        print(f"\n--------------------------------------------------")
        print(f"EMPRESA ID: {emp_id}")
        print(f"--------------------------------------------------")
        
        # Buscar todas as receitas ativas da origem WEB
        launches = session.exec(
            select(Lancamento)
            .where(
                Lancamento.empresa_id == emp_id,
                Lancamento.tipo == "RECEITA",
                Lancamento.origem == "WEB",
                Lancamento.is_deleted == False
            )
        ).all()
        
        dup_codes = DUPLICATE_CODES_BY_EMP[emp_id]
        
        to_delete = []
        # Dicionário de conta_id -> total valor pago deletado
        impacto_por_conta = {}
        
        for l in launches:
            cat = categoria_by_id.get(l.plano_contas_id)
            if not cat:
                continue
                
            obs = (l.observacao or "").lower()
            is_legacy = "importação financeiro" in obs or "importacao financeiro" in obs
            
            if is_legacy and cat.codigo in dup_codes:
                to_delete.append(l)
                # Acumula impacto financeiro se o lançamento estava marcado como pago
                pago = str(l.status).upper() == "PAGO" or l.data_pagamento is not None
                if pago and l.conta_id:
                    val_pago = l.valor_pago if l.valor_pago and l.valor_pago > 0 else l.valor_previsto
                    impacto_por_conta[l.conta_id] = impacto_por_conta.get(l.conta_id, Decimal("0.00")) + Decimal(str(val_pago))
        
        print(f"Total de duplicatas encontradas para exclusão: {len(to_delete)}")
        print(f"Valor total previstos para exclusão: R$ {sum(l.valor_previsto for l in to_delete):,.2f}")
        
        # Executar exclusão
        for l in to_delete:
            if not dry_run:
                l.is_deleted = True
                l.descricao = f"[DUPLICADO DELETADO] {l.descricao}"
                l.observacao = f"[DUPLICADO DELETADO EM LIMPEZA EM MASSA] {l.observacao or ''}"
                session.add(l)
                
        # Ajustar saldos das contas bancárias
        if impacto_por_conta:
            print("\nAjustes de Saldo Inicial das Contas:")
            for cid, val_deletado in impacto_por_conta.items():
                conta = conta_by_id.get(cid)
                if not conta:
                    continue
                    
                antigo_saldo_inicial = Decimal(str(conta.saldo_inicial or 0))
                novo_saldo_inicial = antigo_saldo_inicial + val_deletado
                
                print(f"  Conta '{conta.nome}' (ID: {cid}):")
                print(f"    - Saldo Inicial Antigo: R$ {antigo_saldo_inicial:,.2f}")
                print(f"    - Total Receitas Pagas Excluídas: R$ {val_deletado:,.2f}")
                print(f"    - Saldo Inicial Novo: R$ {novo_saldo_inicial:,.2f}")
                
                if not dry_run:
                    conta.saldo_inicial = novo_saldo_inicial
                    session.add(conta)
        else:
            print("\nNenhum impacto de saldo detectado.")
            
    if not dry_run:
        session.commit()
        print("\n>>> EXECUÇÃO CONCLUÍDA E COMITADA COM SUCESSO! <<<")
    else:
        print("\n>>> SIMULAÇÃO CONCLUÍDA (Sem alterações no banco de dados). <<<")

if __name__ == "__main__":
    # Para rodar de verdade, altere para False
    import sys
    dry_run = True
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        dry_run = False
    run(dry_run=dry_run)
