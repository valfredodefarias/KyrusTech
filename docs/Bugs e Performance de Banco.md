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

### D. O Bug de Ausência de Colunas na Query Minimizada (Grid de Lançamentos)
*   **O Problema**: Marcar um lançamento como IPP (ou editar previsto/conciliado) no frontend enviava o PUT correto para o backend, mas, ao recarregar a tabela principal de Lançamentos, o estado do checkbox continuava desmarcado na tela.
*   **Causa Raiz**: O endpoint `/api/v1/lancamentos/` no modo otimizado (`minimized=true`) não selecionava as colunas `ipp`, `previsto`, `conciliado` e `numero_parcela` na query SQL nem serializava estes atributos no dicionário final de resposta. O frontend recebia estes valores como `undefined` e renderizava o estado desmarcado.
*   **Como Evitar**:
    - Ao criar queries SQL personalizadas no SQLAlchemy para otimização de payload (minimização), assegure-se de mapear explicitamente todos os atributos essenciais para a renderização do estado dos componentes no frontend.

### E. O Bug de Corrupção do Saldo Bancário em Memória (Receipt vs. Revenue Mismatch)
*   **O Problema**: Ao criar, pagar ou atualizar um lançamento do tipo Receita no frontend, o saldo bancário da conta no cabeçalho e na aba de contas era decrementado (subtraído) em vez de incrementado (somado), corrompendo a visualização dos saldos em tempo real até o F5.
*   **Causa Raiz**: O helper de ajuste de saldo local `adjustBalanceForTx` no frontend validava `tx.tipo` com a string `'RECEBIMENTO'`, enquanto o backend e o restante do frontend salvam o tipo da transação como `'RECEITA'`. Isso fazia com que todas as receitas caíssem na regra de despesa, subtraindo o valor do saldo.
*   **Como Evitar**:
    - Mantenha conformidade exata nos enums e chaves de tipagem entre o banco de dados e os cálculos locais em memória do cliente. Utilize verificações robustas (como `.toUpperCase()` e mapeamento de enums) para evitar descompasso.

### F. O Gargalo de Processamento CPU-bound no Boletim (Redundant Category Tree Climbs)
*   **O Problema**: Em bases de dados com milhares de lançamentos, aplicar filtros ou navegar no Boletim causava lentidão, quedas de frames da tela (UI lag) e travamento das abas Keep-Alive do navegador.
*   **Causa Raiz**: A função de classificação da DRE subia recursivamente a árvore hierárquica de categorias pai/filho para cada lançamento individual no loop da tabela. Isso repetia milhares de buscas repetidas para a mesma categoria.
*   **Como Evitar**:
    - **Memoização local**: Cacheie resultados de funções complexas de travessia de grafos/árvores em objetos locais de lookup durante iterações de loops pesados para evitar repetições desnecessárias.

### G. O Descompasso de Tenant em Consultores Multi-Empresa (X-Company-ID Bypass)
*   **O Problema**: Quando consultores externos com acesso a múltiplas empresas trocavam de filial via header HTTP `X-Company-ID`, interceptores de autorização (`require_permission`) e funções de CRUD ainda avaliavam o `current_user.empresa_id` fixado no banco de dados. Isso causava avaliação de permissões contra a matriz e atribuição errônea dos registros da auditoria (`audit_logs.empresa_id`).
*   **Causa Raiz**: Falta de propagação do objeto `Request` para os resolvedores de dependência e ausência de sincronização no ContextVar de auditoria (`_empresa_id`).
*   **Como Evitar**:
    - Centralize a captura da requisição HTTP ativa em um `ContextVar` global (`current_http_request`) no middleware de entrada.
    - O resolvedor de tenant (`get_empresa_id_from_user`) sincroniza imediatamente a empresa ativa com `set_audit_empresa(empresa_id)` e `session.info["audit_empresa_id"] = empresa_id`.
    - Todas as rotas de negócios devem injetar `empresa_id: int = Depends(get_empresa_id_from_user)` em vez de ler `current_user.empresa_id`.

### H. O Risco de Exaustão de Memória e DoS por Upload sem Validação (Upload Memory Spike)
*   **O Problema**: Endpoints de importação de planilhas de cartão (`/api/v1/cartoes/upload-xlsx`) liam o payload inteiro em memória síncrona sem validação de tamanho máximo nem verificação de extensão. Um arquivo corrompido ou de centenas de megabytes travava o processo Python do backend.
*   **Causa Raiz**: Leitura de streams não delimitados (`file.file.read()`) sem verificação prévia de `Content-Length` ou leitura incremental com teto de bytes.
*   **Como Evitar**:
    - Valide extensões permitidas (`.xlsx`, `.xls`) antes da leitura.
    - Efetue leitura limitada por teto fixo (ex: `file.file.read(max_size + 1)` com teto de 10MB) e retorne imediatamente `HTTP 413 Payload Too Large` se o arquivo exceder o limite.
    - Proteja o endpoint com permissões RBAC apropriadas (`require_any_permission`).

### I. O Gargalo de JS Exception Overhead por JSON.parse de Observações
*   **O Problema**: Travamento e lentidão adicionais na renderização e filtragem do Boletim sob grandes volumes de lançamentos.
*   **Causa Raiz**: O loop de mapeamento executava `JSON.parse` cegamente na coluna `observacao` de todos os lançamentos para ler metadados. Como a grande maioria dos registros possui textos planos (não JSON), o JavaScript gerava e capturava milhares de exceções por segundo, gerando enorme overhead de CPU e lixo para o Garbage Collector.
*   **Como Evitar**:
    - Faça checagens superficiais eficientes (ex: validar se a string começa com `{` e termina com `}`) antes de submeter uma entrada a analisadores sintáticos estruturados como o `JSON.parse`.

### J. O Bug de Descarte de Metadados JSON no PDV (Comissões e Relatórios)
*   **O Problema**: Vendas geradas pelo PDV não pontuavam comissões de produtos ou cálculo de dezenas para vendedores no dashboard de comissões.
*   **Causa Raiz**: No serviço `venda_service.py`, o dicionário `obs_data` continha todos os metadados de itens vendidos e pagamentos estruturados, mas ao instanciar o `Lancamento`, o atributo `observacao` era preenchido com `venda_in.observacao` (texto plano original ou nulo), descartando o payload JSON compilado.
*   **Como Evitar**:
    - Assegure que geradores de lançamentos operacionais persistam os metadados ricos em `observacao=json.dumps(obs_data)` de maneira consistente em todas as ramificações de liquidação (à vista, a prazo, split e parcelado).

### K. O Bug de Exaustão de Heap de Memória em Testes Frontend (Vitest OOM)
*   **O Problema**: Executar os testes unitários do frontend (`vitest run`) congelava o runner e culminava no crash do Node.js com estouro de memória `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`.
*   **Causa Raiz**: No mock de testes de `useAuthStore`, o objeto de estado (`{ user, empresa, setEmpresa }`) era instanciado novamente como um novo literal de objeto a cada chamada do seletor. Como o hook `useEmpresa` possui `useEffect` ouvindo `storeUser` e `storeEmpresa`, cada render causava re-render imediato, entrando em loop infinito de dezenas de milhares de renders até o estouro da heap.
*   **Como Evitar**:
    - Mantenha instâncias estáticas e referências de memória estáveis para objetos mockados de stores Zustand fora da função de fábrica do mock.

### L. O Risco de Corrupção em Produção com `synchronous_commit=off`
*   **O Problema**: O `docker-compose.prod.yml` definia a flag `-c synchronous_commit=off` no PostgreSQL para supostamente acelerar escrita. Em caso de queda de energia do host ou reinicialização do container, transações financeiras já confirmadas ao usuário poderiam ser perdidas no WAL.
*   **Causa Raiz**: Desativação indevida da durabilidade (D do ACID) em um sistema de ledger contábil e fiscal.
*   **Como Evitar**:
    - Em sistemas ERP que lidam com lançamentos contábeis, conciliação e caixa, mantenha `synchronous_commit=on` mandatório em produção.

### M. O Bug de Ignorar Contexto de Consultor e Brechas de IDOR (Cartões, Comissões e PDV)
*   **O Problema**: Consultores corporativos que alternavam para empresas clientes via cabeçalho `X-Company-ID` continuavam vendo dados da empresa original nos módulos de cartões e comissões. Além disso, mutações de status no PDV e exclusão de regras de comissão aceitavam IDs sem conferir `empresa_id`.
*   **Causa Raiz**: Acesso direto a `current_user.empresa_id` em vez do resolvedor canônico `Depends(get_empresa_id_from_user)` e consultas diretas `db.get(Model, id)` sem filtro de tenant.
*   **Como Evitar**:
    - Nunca leia `current_user.empresa_id` diretamente em rotas de negócio. Use sempre a dependência `empresa_id: int = Depends(get_empresa_id_from_user)` e restrinja todas as mutações e buscas com `Model.empresa_id == empresa_id`.

### N. A Sincronização Incompleta de Modelos com o Alembic (`alembic/env.py`)
*   **O Problema**: O arquivo de configuração do Alembic importava manualmente apenas 29 modelos, enquanto a base possuía 48 modelos ativos. Uma geração de migração com `--autogenerate` tentaria dropar 19 tabelas em produção.
*   **Causa Raiz**: Importações manuais estáticas não sincronizadas com o crescimento do schema.
*   **Como Evitar**:
    - Importe `import app.models` no `alembic/env.py` e mantenha `app/models/__init__.py` exportando 100% dos modelos do banco de dados.

### O. O Bloqueio do Event Loop do FastAPI em Uploads de Planilhas (`upload_xlsx`)
*   **O Problema**: Ao subir planilhas Excel para conciliação ou cadastro em lote de cartões, a rota assíncrona `async def upload_xlsx` chamava `pd.read_excel` (CPU-bound e síncrona), travando a thread principal do asyncio e causando timeout nas requisições de outros usuários.
*   **Causa Raiz**: Operações síncronas de I/O pesado de CPU em rotas `async def`.
*   **Como Evitar**:
    - Declare rotas que usam pandas/openpyxl como `def` (síncronas normais) para que o FastAPI as execute automaticamente na threadpool separada do AnyIO, mantendo o event loop livre.

### P. A Exposição de Dados Financeiros e Integrações Bancárias por Ausência de Permissões RBAC
*   **O Problema**: Rotas de leitura do DRE (`GET /dre/`, `GET /dre/anual`), orçamentos anuais e integrações bancárias (`GET /integracoes-bancarias/`, saldos Asaas, contas a receber e clientes) não continham dependências de permissões RBAC (`require_permission` ou `require_any_permission`). Usuários comuns com privilégios restritos (como caixas de PDV) conseguiam consultar dados financeiros estratégicos da empresa.
*   **Causa Raiz**: Omissão do parâmetro `dependencies=[Depends(require_any_permission([...]))]` nas anotações de rota do FastAPI.
*   **Como Evitar**:
    - Todos os endpoints do ERP devem ser explicitamente protegidos com verificação de permissão RBAC (`require_permission` ou `require_any_permission`).

### Q. A Ordem Invertida de Exclusão de Chaves Estrangeiras na Limpeza de Demonstrações
*   **O Problema**: O serviço `demo_cleanup_service.py` tentava deletar da tabela pai `integracoes_bancarias` antes da tabela filha `mapeamentos_categoria`, o que violava constraints de integridade referencial ou gerava registros órfãos. Além disso, a auto-referência pai-filho em `plano_contas` podia impedir a limpeza limpa em cascata.
*   **Causa Raiz**: Ordem cronológica incorreta na topologia de exclusão SQL.
*   **Como Evitar**:
    - Sempre execute a deleção respeitando a topologia: tabelas filhas primeiro (`mapeamentos_categoria`), depois pais (`integracoes_bancarias`). Para tabelas auto-relacionadas (árvores hierárquicas), quebre os vínculos com `UPDATE ... SET parent_id = NULL` antes do delete.

### R. A Validação Residual de Contexto de Consultores com Acesso Revogado
*   **O Problema**: Em `_resolve_empresa_contexto`, caso um consultor não-super tivesse `consultor.empresa_id` armazenado previamente no seu usuário, o sistema utilizava essa empresa diretamente sem checar se ele ainda possuía vínculo ativo na tabela de associação `ConsultorEmpresa`. Se seu acesso fosse revogado, o consultor continuava operando na empresa cliente.
*   **Causa Raiz**: Omissão da verificação `tem_acesso(db, consultor.id, empresa_id)` no bloco de leitura rápida do contexto gravado.
*   **Como Evitar**:
    - Nunca confie no valor estático de `user.empresa_id` para usuários consultores sem antes validar `tem_acesso(db, consultor_id, empresa_id)`. Se o acesso não existir mais, faça fallback automático para uma empresa autorizada ou lance `HTTP 403 Forbidden`.

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
