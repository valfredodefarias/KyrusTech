[🗺️ Visão Geral]([[Visao Geral]]) / [🚀 Fluxo de Desenvolvimento]([[Loops e Validacoes]])
***

# 🐛 Bugs Conhecidos e Engenharia de Banco de Dados (PostgreSQL & FastAPI)

Esta documentação serve de guia técnico para desenvolvedores (e agentes de IA) sobre os bugs estruturais de concorrência e banco de dados encontrados e resolvidos no Kyrus ERP, bem como as melhores práticas de performance recomendadas para manter o sistema altamente escalável e resiliente.

---

## 🪳 1. Bugs Históricos e Lições Aprendidas

### A. O Bug de Violação de Chave Estrangeira na Limpeza (ForeignKeyViolation)
*   **O Problema**: A exclusão de empresas de demonstração e testes (`DEMO_TEMP_*`) falhava devido ao apagamento de lançamentos antes do apagamento de baixas contábeis. O Postgres retornava o erro:
    `violates foreign key constraint "baixas_lancamento_id_fkey" on table "baixas"`
*   **Causa Raiz**: Tentativa de deletar registros em uma tabela principal (pai) que ainda são referenciados por registros em uma tabela dependente (filho) com restrições de integridade referencial.
*   **Como Evitar**:
    - **Topologia de Deleção**: Ao deletar registros de forma síncrona, limpe as tabelas filhas (ex: `baixas`, `anexo_lancamento`, `movimentacao_estoque`) antes de deletar as tabelas principais (ex: `lancamentos`, `empresas`).
    - **Bypass Seguro para Scripts Administrativos**: Em rotas ou scripts de limpeza onde as dependências são muito complexas ou mudam frequentemente, utilize a instrução SQL `SET session_replication_role = 'replica';` temporariamente dentro da transação. Isso desativa temporariamente as restrições de chaves estrangeiras e triggers apenas para aquela conexão de sessão, permitindo a deleção segura em massa. *Nota: Nunca utilize isso em rotas de negócios de usuários comuns.*

### B. O Bug de Congelamento do Event Loop do FastAPI (Event Loop Block)
*   **O Problema**: O Kyrus ERP utiliza sessões síncronas do SQLAlchemy/SQLModel (`with Session(engine) as session:`). Em ambientes de desenvolvimento rodando com um único worker do Uvicorn, queries muito pesadas (ex: cálculo do DRE) travam o loop de eventos assíncronos do FastAPI. Consequentemente, todas as outras requisições concorrentes de usuários entram em fila no socket do SO e expiram por timeout de conexão (12 segundos), colapsando o sistema inteiro com apenas 5 usuários ativos.
*   **Causa Raiz**: Threads do event loop assíncrono bloqueadas por chamadas síncronas de banco de dados e processamento CPU-bound em um servidor monoprocesso.
*   **Como Evitar**:
    - **Trabalho em Background**: Operações demoradas de importação ou relatórios pesados devem ser processados de forma assíncrona, seja usando `BackgroundTasks` do FastAPI ou filas de mensageria dedicadas (como Celery).
    - **Workers Paralelos**: Em produção, configure o Uvicorn com múltiplos workers (`--workers 4` ou `CPUs * 2`) para paralelizar o processamento e isolar as travas de processos.

### C. O Gargalo de Escrita de Sessão por Clique (Session Write Lock Contention)
*   **O Problema**: Toda requisição de usuário autenticado atualizava a coluna `last_activity_at` no banco de dados e executava um commit de transação (`session.commit()`). Sob carga concorrente, isso causava extrema contenção de travas de escrita no Postgres e exaustão do I/O de disco por conta do flush síncrono do Write-Ahead Log (WAL) para cada clique no frontend.
*   **Causa Raiz**: Persistência de metadados redundantes com commits síncronos frequentes.
*   **Como Evitar**:
    - **Throttling de Gravação**: Implemente uma verificação de tempo limite para a atualização. Grave o registro no banco de dados apenas se o intervalo decorrido desde a última gravação em disco for maior do que um limiar aceitável (ex: 60 segundos).

---

## ⚡ 2. Boas Práticas de Performance em Banco de Dados

### 1. Evitar Cláusulas Negativas de Texto Soltas (`NOT ILIKE '%...%'`)
Consultas SQL contendo `NOT ILIKE` com curingas (`%`) impedem o uso de índices convencionais (B-Tree), forçando o Postgres a realizar uma varredura sequencial completa em disco (*Sequential Scan*).
*   **Boas Práticas**:
    - Se a query precisa excluir registros com base em texto estático (ex: filtrar observações específicas de demonstração), crie um **Índice Parcial** (com cláusula `WHERE` idêntica) no Postgres. Isso pré-filtra as linhas no índice, reduzindo a busca a $O(\log N)$.
    - *Exemplo de Índice Parcial Composto*:
      ```sql
      CREATE INDEX idx_lancamentos_dre_perf ON lancamentos (empresa_id, data_competencia) 
      WHERE is_deleted = false AND (observacao NOT ILIKE '%Demonstracao%')
      ```

### 2. Seleção Apenas de Colunas Necessárias (Evitar Custo de Instanciação ORM)
Instanciar objetos completos do ORM (`select(Lancamento)`) consome muita CPU e memória do Python ao converter tipos e montar registros do banco em classes Python.
*   **Boas Práticas**:
    - Em consultas de agregação, listagens leves ou relatórios (onde não é necessária a edição do objeto), utilize o `select()` passando apenas os atributos específicos do modelo.
    - *Exemplo*:
      ```python
      # Rápido: retorna tuplas leves contendo dados puros
      rows = db.exec(select(Lancamento.id, Lancamento.valor_pago, Lancamento.data_vencimento)).all()
      ```

### 3. Proteção contra Sobrecarga de Cache (Cache Stampede)
Em endpoints cacheados pesados (como o DRE), no instante em que o cache é invalidado, múltiplos usuários simultâneos tentarão calcular a mesma query pesada ao mesmo tempo, saturando o banco.
*   **Boas Práticas**:
    - Utilize o padrão **Double-Checked Locking** utilizando locks distribuídos no Redis (`redis_client.lock(...)`). Somente um worker executará a consulta de geração, enquanto os outros aguardam a liberação para ler o cache recém-preenchido.

### 4. Alinhamento da Pool de Conexões (Client vs. Server)
A pool de conexões do cliente (SQLAlchemy) e a capacidade máxima do servidor de banco de dados (Postgres) devem ser alinhadas para evitar erros de falta de slots de conexões:
$$\text{Pool Total Acumulada} = (\text{pool\_size} + \text{max\_overflow}) \times \text{quantidade\_de\_workers}$$
*   **Boas Práticas**:
    - Certifique-se de que a variável `max_connections` do PostgreSQL no `docker-compose.yml` seja maior do que a Pool Total Acumulada de todos os containers e workers combinados.

---

## 📋 Checklist de Auditoria de Performance SQL (Para PRs / Commits)

Antes de submeter ou aprovar qualquer alteração que execute consultas ou operações de banco de dados, verifique os seguintes pontos:

*   `[ ]` **Seleção de Colunas**: A query seleciona apenas as colunas estritamente necessárias (`select(Model.campo1, Model.campo2)`) em vez de instanciar a classe ORM completa (`select(Model)`) em listagens ou relatórios?
*   `[ ]` **Filtros de Texto Negativo**: A query faz uso de exclusão de texto via `NOT ILIKE '%...%'`? Se sim, foi criado um **Índice Parcial** correspondente no Postgres para evitar scans sequenciais?
*   `[ ]` **Throttling de Escrita**: Se o código realiza atualizações de metadados em alta frequência (ex: última atividade, logs, cliques), há um limitador para evitar commits repetidos a cada requisição?
*   `[ ]` **Proteção contra Cache Stampede**: Queries de relatórios pesados com cache utilizam o padrão **Double-Checked Locking** (via Redis lock ou travas de thread) para evitar que requisições concorrentes saturem o Postgres quando o cache estiver frio?
*   `[ ]` **Problema de Queries N+1**: A rota traz relacionamentos aninhados? Foram configurados `selectinload` ou `joinedload` explícitos para evitar consultas consecutivas individuais?
*   `[ ]` **Tempo de Execução**: A consulta foi medida localmente sob volume realista de dados para garantir tempo de execução inferior a 100ms?
