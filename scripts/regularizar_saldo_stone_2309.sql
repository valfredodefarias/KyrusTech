BEGIN;

-- 1. Restaurar o lançamento 1127110 de volta para a venda de 01/09/2026 no valor de R$ 903,80
UPDATE lancamentos
SET valor_pago = 903.80,
    valor_previsto = 903.80,
    data_vencimento = '2026-09-01',
    data_pagamento = '2026-09-01',
    data_competencia = '2026-09-01',
    updated_at = NOW()
WHERE id = 1127110 AND empresa_id = 67;

-- 2. Inserir a venda de Maestro Débito do dia 23/09/2026 no valor de R$ 231,16
INSERT INTO lancamentos (
    empresa_id, conta_id, plano_contas_id, entidade_id, centro_custo_id,
    descricao, tipo, status, origem, previsto, ipp, conciliado,
    valor_previsto, valor_pago, valor_juros, valor_desconto, valor_multa,
    data_vencimento, data_pagamento, data_competencia, competencia,
    observacao, is_deleted, created_at, updated_at
) VALUES (
    67, 399, 9288, 46831, 146,
    'MAESTRO DÉBITO', 'RECEITA', 'PAGO', 'MANUAL', true, false, false,
    231.16, 231.16, 0.00, 0.00, 0.00,
    '2026-09-23', '2026-09-23', '2026-09-23', '09-2026',
    'Venda Maestro Débito 23/09/2026 (Regularização de conciliação)', false, NOW(), NOW()
);

-- 3. Conferência final do saldo da conta 399
SELECT 
    c.id, c.nome, c.saldo_inicial,
    COALESCE(SUM(CASE WHEN l.tipo = 'RECEITA' AND l.status = 'PAGO' THEN l.valor_pago ELSE 0 END), 0) as total_receitas,
    COALESCE(SUM(CASE WHEN l.tipo = 'DESPESA' AND l.status = 'PAGO' THEN l.valor_pago ELSE 0 END), 0) as total_despesas,
    c.saldo_inicial 
    + COALESCE(SUM(CASE WHEN l.tipo = 'RECEITA' AND l.status = 'PAGO' THEN l.valor_pago ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN l.tipo = 'DESPESA' AND l.status = 'PAGO' THEN l.valor_pago ELSE 0 END), 0) as saldo_atual_calculado
FROM contas c
LEFT JOIN lancamentos l ON l.conta_id = c.id AND l.is_deleted = false
WHERE c.id = 399 AND c.empresa_id = 67
GROUP BY c.id, c.nome, c.saldo_inicial;

COMMIT;
