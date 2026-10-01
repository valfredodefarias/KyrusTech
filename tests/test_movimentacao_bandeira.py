from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.pdv import MovimentacaoPDVSchema


def _payload(**overrides):
    base = {
        "tipo": "ENTRADA",
        "descricao": "Venda Frente de Caixa",
        "valor": Decimal("59.00"),
        "forma_pagamento": "CREDITO_AVISTA",
        "bandeira": "MASTERCARD",
        "parcelas": 1,
        "data": date(2026, 9, 23),
    }
    base.update(overrides)
    return base


@pytest.mark.parametrize("forma", ["DEBITO", "CREDITO_AVISTA", "CREDITO_PARCELADO"])
@pytest.mark.parametrize("bandeira", [None, "", "OUTROS", "outros", "QUALQUER"])
def test_cartao_sem_bandeira_valida_e_rejeitado(forma, bandeira):
    with pytest.raises(ValidationError):
        MovimentacaoPDVSchema(**_payload(forma_pagamento=forma, bandeira=bandeira))


def test_cartao_com_bandeira_e_normalizado():
    mov = MovimentacaoPDVSchema(**_payload(bandeira="visa"))
    assert mov.bandeira == "VISA"


@pytest.mark.parametrize("forma", ["DINHEIRO", "PIX"])
def test_formas_sem_cartao_nao_exigem_bandeira(forma):
    mov = MovimentacaoPDVSchema(**_payload(forma_pagamento=forma, bandeira="OUTROS"))
    assert mov.forma_pagamento == forma


def test_saida_nao_exige_bandeira():
    mov = MovimentacaoPDVSchema(**_payload(tipo="SAIDA", forma_pagamento="DINHEIRO", bandeira="OUTROS"))
    assert mov.tipo == "SAIDA"
