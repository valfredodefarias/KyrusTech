import pytest
from decimal import Decimal
from datetime import date
from app.services.importacao_bancaria_service import gerar_import_hash

def test_gerar_import_hash_stability_line_number():
    # Test that the same transaction with different line numbers generates the exact same hash
    tx1 = {
        "origem": "OFX_EXTRATO",
        "tipo": "DESPESA",
        "data": date(2026, 7, 8),
        "data_hora": "2026-07-08T10:00:00",
        "valor": Decimal("100.00"),
        "descricao": "COMPRA SUPERMERCADO",
        "razao_social": "Supermercado Exemplo",
        "cpf_cnpj": "12.345.678/0001-99",
        "referencia_externa": "conta:1:fitid-123456",
        "movimento_uid": "fitid-123456",
        "ofx_bank_id": "341",
        "linha_arquivo": 10,
    }
    
    tx2 = dict(tx1)
    tx2["linha_arquivo"] = 25  # Different line number
    
    hash1 = gerar_import_hash(tx1, conta_id=1)
    hash2 = gerar_import_hash(tx2, conta_id=1)
    
    assert hash1 == hash2, "Hashes should be identical even if line_arquivo changes"

def test_gerar_import_hash_stability_fallback_references():
    # Test that fallback references (both hyphen-based and colon-based) are correctly ignored in generating hash
    tx_fallback_hyphen = {
        "origem": "OFX_EXTRATO",
        "tipo": "DESPESA",
        "data": date(2026, 7, 8),
        "data_hora": "2026-07-08T10:00:00",
        "valor": Decimal("100.00"),
        "descricao": "COMPRA SUPERMERCADO",
        "razao_social": "Supermercado Exemplo",
        "cpf_cnpj": "12.345.678/0001-99",
        "referencia_externa": "conta:1:fallback-2026-07-08-100.00-10-compra",
        "movimento_uid": "fallback-2026-07-08-100.00-10-compra",
        "ofx_bank_id": "341",
        "linha_arquivo": 10,
    }
    
    tx_fallback_colon = dict(tx_fallback_hyphen)
    tx_fallback_colon["referencia_externa"] = "conta:1:fallback:conta:1:25"
    tx_fallback_colon["movimento_uid"] = "fallback:conta:1:25"
    tx_fallback_colon["linha_arquivo"] = 25
    
    hash1 = gerar_import_hash(tx_fallback_hyphen, conta_id=1)
    hash2 = gerar_import_hash(tx_fallback_colon, conta_id=1)
    
    assert hash1 == hash2, "Hashes should be identical even if fallback reference strings or line numbers differ"
