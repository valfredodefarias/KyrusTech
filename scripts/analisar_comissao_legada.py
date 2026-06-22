from sqlmodel import Session, select, col
from app.db.session import engine
from app.models.lancamento import Lancamento
from app.models.usuario import Usuario
import json
from collections import defaultdict
from decimal import Decimal

with Session(engine) as db:
    # Buscar usuários
    vendedores = db.exec(select(Usuario).where(Usuario.empresa_id == 27)).all()
    vendedor_nomes = {u.id: u.nome for u in vendedores}
    print("Vendedores na Empresa 27:", vendedor_nomes)
    
    # Buscar todos os lançamentos ativos de receita do PDV
    launches = db.exec(
        select(Lancamento)
        .where(
            Lancamento.empresa_id == 27,
            Lancamento.is_deleted == False,
            Lancamento.tipo == "RECEITA",
            Lancamento.origem == "PDV"
        )
    ).all()
    
    print(f"Total de lançamentos PDV recuperados: {len(launches)}")
    
    # Agrupar faturamento por vendedor e mês/ano
    faturamento_por_vendedor_mes = defaultdict(lambda: defaultdict(Decimal))
    
    for l in launches:
        vendedor_nome = vendedor_nomes.get(l.created_by_id, "Desconhecido")
        # Vamos verificar pela data de competência
        if l.data_competencia:
            key_mes = f"{l.data_competencia.year}-{l.data_competencia.month:02d}"
            
            meta = {}
            if l.observacao:
                try:
                    meta = json.loads(l.observacao)
                except Exception:
                    pass
            tipo_pag_original = str(meta.get("tipo_pagamento", "")).lower()
            is_boleto = "boleto" in tipo_pag_original
            
            # Se for faturamento total sem boletos em aberto (faturamento meta do ComissaoService)
            if is_boleto:
                if l.status == "PAGO" and l.data_pagamento:
                    key_mes_pag = f"{l.data_pagamento.year}-{l.data_pagamento.month:02d}"
                    faturamento_por_vendedor_mes[vendedor_nome][key_mes_pag] += Decimal(str(l.valor_previsto or 0))
            else:
                faturamento_por_vendedor_mes[vendedor_nome][key_mes] += Decimal(str(l.valor_previsto or 0))

    # Mostrar faturamentos agrupados
    for vend, meses in faturamento_por_vendedor_mes.items():
        print(f"\nVendedor: {vend}")
        for mes, valor in sorted(meses.items()):
            # Apenas meses com valores significativos ou todos
            if valor > 0:
                print(f"  Mês: {mes} | Faturamento Meta: R$ {valor:,.2f}")
