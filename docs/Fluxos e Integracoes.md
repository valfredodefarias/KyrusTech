# 🔄 Fluxos e Integrações do Kyrus ERP

Este documento explica os fluxos lógicos e integrações de dados críticas do ERP.

---

## 📥 1. Fluxo de Importação OFX
Permite reconciliar o extrato do banco com os lançamentos do sistema.
1.  **Leitura do OFX**: O arquivo XML/OFX é lido na rota `importacao_ofx.py`.
2.  **Busca de Correspondência**:
    *   O sistema busca por lançamentos **atrasados** com o mesmo valor.
    *   Busca por lançamentos **previstos** com mesmo valor e dia.
3.  **Idempotência**: Cada transação do OFX possui um identificador único (`import_hash` ou `ofx_bank_id`) para impedir importações duplicadas se o usuário subir o mesmo arquivo duas vezes.

---

## 🧾 2. Integração com Gateway de Pagamentos (Asaas)
Gerencia cobranças automatizadas e conciliação de recebimentos de clientes.
*   **Sincronização**: O scheduler interno roda em background (a cada 60 segundos) executando `run_due_integracoes_sync` para atualizar o status das faturas integradas.
*   **webhook**: O Asaas envia notificações de pagamento recebido, ativando a baixa automática de lançamentos correspondentes no banco de dados.

---

## 🏪 3. Frente de Caixa (PDV) e Venda Rápida
Módulo para registro ágil de vendas diretas com baixa no estoque e conciliação imediata de caixa (Dinheiro, PIX ou Cartão).
*   **Idempotência**: A criação de vendas utiliza a chave `X-Idempotency-Key` enviada pelo frontend. Se a requisição cair e for retransmitida, o backend não duplicará os lançamentos contábeis.
