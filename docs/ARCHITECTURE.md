# 📘 Manual de Arquitetura e Engenharia - KyrusERP

**Padrão de Engenharia**: Nível Google / Enterprise  
**Versão**: 5.0 (Pós-Refatoração Estrutural)  
**Última Atualização**: Setembro de 2026  

---

## 🏛️ 1. Princípio Máximo: Desenvolvimento Estrutural, Zero Gambiarras

Todo desenvolvimento, refatoração ou manutenção no KyrusERP deve obedecer rigorosamente a este contrato técnico. Qualquer solução temporária, remendo ou atalho que viole a consistência do sistema é classificada como débito técnico inaceitável.

### Os Cinco Mandamentos da Engenharia Kyrus:
1. **Modelagem Íntegra, Sem Registros Fantasmas**:
   - É terminantemente proibido criar entidades artificiais no banco de dados para contornar limitações de tela ou de fluxo.
   - *Exemplo Real de Violação Erradicada*: Nunca criar uma `PdvVenda` fictícia com produto ID 0 e valor arbitrário para registrar um suprimento ou sangria de caixa. Caixas possuem movimentações próprias; vendas possuem ordens próprias.
2. **Decomposição Modular por Domínio (Fim dos Godfiles)**:
   - Nenhum arquivo de serviço deve ultrapassar 600–800 linhas ou acumular mais de uma responsabilidade de negócio.
   - Serviços monolíticos devem ser decompostos em pacotes de domínio dedicados, mantendo facades leves apenas para preservação de compatibilidade retroativa de imports.
3. **Aritmética Monetária em Centavos Inteiros**:
   - Proibido dividir valores fracionários com aritmética de ponto flutuante padrão IEEE-754 sem tratamento de resíduos, o que gera dízimas como `33.3333333334`.
   - Divisões de parcelas e rateios contábeis devem converter valores em centavos (`Math.round(val * 100)`), calcular quociente e resto inteiro, e distribuir o resíduo na primeira ou última parcela (utilizando `kyrus-web/src/utils/money.ts`).
4. **Gerenciamento de Estado Honesto no Frontend**:
   - O estado global da aplicação (Zustand/React) deve refletir com fidelidade a resposta do servidor.
   - É proibido criar caches arbitrários com temporizadores (ex.: `setTimeout` de 30 segundos) que forcem valores desatualizados por cima de novas chamadas de rede.
5. **Proteção de Unicidade no Banco com Soft-Delete**:
   - Validações de unicidade no código da aplicação são sujeitas a concorrência (`race conditions`).
   - Tabelas com exclusão lógica (`is_deleted`) devem possuir índices únicos parciais no PostgreSQL:
     ```sql
     CREATE UNIQUE INDEX uq_contas_empresa_nome_active ON contas (empresa_id, nome) WHERE is_deleted = false;
     ```

---

## 🧩 2. Arquitetura de Domínios do PDV (`app/services/pdv/`)

O monolito legado `pdv_service.py` (+2.400 linhas) foi completamente decomposto na seguinte arquitetura de domínio:

```
app/services/
├── pdv/
│   ├── __init__.py           # Reexportações canônicas dos serviços
│   ├── venda_service.py      # Ciclo de vida da venda de balcão (criação, edição, itens)
│   ├── caixa_service.py      # Gestão do caixa físico, sessões, suprimentos e sangrias duplas
│   ├── cartao_service.py     # Regras de adquirentes, taxas, cálculo de payout útil e agenda agrupada
│   ├── estoque_service.py    # Baixa automática, estorno e recálculo de custo médio ponderado
│   └── ifood_service.py      # Marketplace: importação e consolidação com split de comissões
└── pdv_service.py            # Facade retrocompatível (~80 linhas) que delega aos especialistas
```

### Responsabilidades Claras:
- **`venda_service.py`**: Validação de clientes, vendedores, produtos cadastrados vs. avulsos, cálculo de totais, descontos e gravação atômica da venda (`PdvVenda` e `PdvVendaItem`).
- **`caixa_service.py`**: Controle da gaveta física e conciliação de numerário. Criação de lançamentos contábeis de saída/entrada com vínculo bidirecional em sangrias.
- **`cartao_service.py`**: Motor de liquidação futura de recebíveis. Calcula datas úteis de repasse (`D+1`, `D+30`), gera agrupamentos por bandeira e previne duplicidade na agenda financeira.
- **`estoque_service.py`**: Mantém o Kardex de movimentação de estoque atualizado. Recalcula o Custo Médio Ponderado a cada entrada ou cancelamento.
- **`ifood_service.py`**: Isola o ecossistema do marketplace externo, dividindo o faturamento bruto em receita líquida e despesa de taxa de comissão.

---

## 🖥️ 3. Infraestrutura e Topologia do Servidor

O KyrusERP opera em produção sob uma VPS HostHatch dedicada:

```
                  [ Internet / Usuários ]
                            │
                            ▼
              ┌───────────────────────────┐
              │  Nginx Proxy Manager     │  (Portas 80, 443 com SSL Let's Encrypt)
              │  (Reverse Proxy / NPM)    │
              └─────────────┬─────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
     [ kyrustech.com.br ]       [ api.kyrustech.com.br ]
              │                           │
              ▼                           ▼
    ┌───────────────────┐       ┌───────────────────┐
    │ kyrustech_frontend│       │ kyrustech_backend │ (FastAPI, 4 workers)
    │ (Node 20 / Vite)  │       │ (FastAPI / Python)│
    │ Porta 3000        │       │ Porta 8000        │
    └───────────────────┘       └─────────┬─────────┘
                                          │
                        ┌─────────────────┴─────────────────┐
                        │ Rede Interna: kyrus_db_internal   │
                        │                                   │
                        ▼                                   ▼
              ┌───────────────────┐               ┌───────────────────┐
              │   db_kyrustech    │               │  redis_kyrustech  │
              │  (PostgreSQL 17)  │               │     (Redis 7)     │
              │  Porta 5432       │               │  Porta 6379       │
              └───────────────────┘               └───────────────────┘
```

### Configurações de Destaque:
1. **Host Header no Vite**: O container frontend utiliza `allowedHosts: true` no `vite.config.ts`, permitindo tráfego com proxy reverso sem erro `400 Bad Request`.
2. **Workers Uvicorn**: O backend roda com `--workers 4` para maximizar throughput sob alta concorrência de lançamentos e consultas de Boletim/DRE.
3. **Isolamento de Banco**: A rede `kyrus_db_internal` é dedicada aos serviços de dados.

---

## 💾 4. Estratégia de Backups e Disaster Recovery

### Protocolo de Backup Pré-Deploy:
```bash
# Executado dentro do servidor de produção (/root/KyrusERP)
docker exec db_kyrustech pg_dump -U kyrus_Ciro -Fc -f /tmp/backup_erp.dump kyrus_erp
docker cp db_kyrustech:/tmp/backup_erp.dump ./backup_erp_$(date +%Y%m%d_%H%M%S).dump
```

### Procedimento de Restauração:
```bash
# Encerrar conexões e restaurar o dump
docker stop kyrustech_backend
docker exec db_kyrustech pg_restore -U kyrus_Ciro -d kyrus_erp --clean --if-exists -f /caminho/do/dump.dump
docker start kyrustech_backend
```

Para o roteiro completo de recuperação de desastres, consulte [docs/MANUAL_RESTAURACAO_BACKUP.md](MANUAL_RESTAURACAO_BACKUP.md).
