# 📘 Manual de Desenvolvimento e Arquitetura - Kyrus ERP

Este documento é a referência única e **contrato principal** para o desenvolvimento do Kyrus ERP. Ele consolida a arquitetura técnica, as diretrizes de design de interface, as topologias de infraestrutura e os **protocolos profissionais por especialidade** para que qualquer alteração siga os mais altos padrões de engenharia de software, análise de dados e cibersegurança do mercado de sistemas corporativos (ERPs).

---

## 1. Stack Tecnológico e Estrutura do Projeto

O Kyrus ERP é construído sob um modelo conteinerizado de alta paridade de ambiente (desenvolvimento/homologação/produção):

*   **Backend**: FastAPI (Python 3.10+), SQLModel (ORM híbrido Pydantic/SQLAlchemy), PostgreSQL como banco de dados e Alembic para migrações versionadas.
*   **Frontend**: React (SPA), Vite (Bundler), TypeScript, Zustand (gerenciador de estado leve e descentralizado) e CSS Vanilla com foco em design responsivo e micro-animações.
*   **Orquestração**: Docker e Docker Compose operando em rede isolada e segura.

### 📂 Estrutura de Diretórios

#### Backend (`app/`)
*   `models/`: Definições das tabelas do banco de dados utilizando SQLModel e mixins de auditoria.
*   `schemas/`: Schemas Pydantic específicos para validação e serialização de dados de entrada/saída das rotas, mantendo separação estrita da camada de banco.
*   `crud/`: Métodos encapsulados para operações no banco de dados (Repository Pattern simplificado).
*   `services/`: Integrações externas e lógica de negócios pesada (ex: conexão com o gateway Asaas, processadores de arquivos OFX/NF-e XML).
*   `api/v1/endpoints/`: Controladores de rotas HTTP. Apenas injetam dependências, acionam a camada CRUD/Service correspondente e tratam exceções.

#### Frontend (`kyrus-web/`)
*   `src/pages/`: Telas e visualizações principais da aplicação (ex: `Dre.tsx`, `Boletim.tsx`).
*   `src/components/`: Componentes UI reutilizáveis (ex: `CurrencyInput.tsx`, `SearchableSelect.tsx`).
*   `src/store/`: Gerenciamento de estado global com Zustand.
*   `src/services/`: Cliente de requisições HTTP (Axios configurado com interceptors).

---

## 2. Protocolos de Engenharia por Especialidade (O Fluxo de Time)

Para garantir que o desenvolvimento do Kyrus ERP ocorra de forma segura, robusta e escalável, todo programador ou agente de IA deve seguir as diretrizes das especialidades técnicas descritas abaixo:

### 📊 Engenheiro de Análise de Dados (Data & Analytics)
*   **Integridade e Idempotência**: Lançamentos financeiros e conciliações não podem ser duplicados. Sempre utilize chaves de unicidade natural ou tokens de transação (`transaction_token` / `import_hash`) para garantir que requisições repetidas não gerem transações duplicadas no livro-razão (ledger).
*   **Constraints Físicas de Banco**: Toda tabela deve possuir constraints explícitas (`NOT NULL`, `DEFAULT`, chaves estrangeiras vinculadas a deleções controladas e índices únicos).
*   **Indexação Inteligente**: Colunas utilizadas frequentemente em filtros de busca, ordenação ou joins (como `empresa_id`, `plano_contas_id`, `conta_id`, `data_vencimento`, `data_competencia` e `status`) devem ter índices correspondentes (`CREATE INDEX`) criados via migrations.
*   **Agregações Performáticas**: Ao calcular balanços (DRE/Boletim), dê preferência a agregações no banco ou utilize chamadas otimizadas (como o endpoint `/entidades/lookup` e a flag `minimized=true` em lançamentos) para evitar carregar relacionamentos redundantes e serializações desnecessárias em loops longos de CPU.
*   **Histórico Imutável**: Transações financeiras fechadas ou consolidadas em períodos contábeis anteriores são imutáveis. O sistema deve prever bloqueios de alterações retroativas.

### 🛡️ Engenheiro de Cibersegurança (Security Engineer)
*   **Isolamento Multitenant (Regra de Ouro)**: O Kyrus ERP é multiempresa. Toda e qualquer query de leitura, escrita, exclusão ou atualização no banco de dados DEVE conter o filtro `empresa_id = usuario.empresa_id`. Falhar nessa validação (gerando vulnerabilidades de IDOR) é inaceitável.
*   **Sanitização Rígida de Entradas**: Nunca confie no frontend. Valide tipagens, limites de caracteres e formatos no backend com Pydantic.
*   **Segurança em Uploads**: Upload de anexos de transações deve passar por validação de tamanho máximo, arquivo não-vazio, extensões restritas a tipos de imagem/documento permitidos e checagem de assinatura de bytes mágicos (MIME real). O caminho de armazenamento deve ser protegido contra injeção de caracteres especiais para evitar Directory Traversal.
*   **Sigilo de Logs**: É terminantemente proibido registrar senhas, tokens de autenticação, segredos de API (ex: chaves do Asaas) ou payloads contendo arquivos binários em logs estruturados ou de erro.
*   **Cabeçalhos e CSP**: O sistema deve manter configurações estritas de cabeçalhos HTTP (`X-Frame-Options`, `X-Content-Type-Options`) e Content-Security-Policy (CSP) robusta, permitindo chamadas externas de CDNs e fontes apenas para rotas explicitamente autorizadas (como `/docs` e `/swagger`).

### 🧪 Engenheiro de Qualidade e Software (QA & Dev)
*   **Fluxo em Micro-Tarefas (Baby Steps)**: O ciclo de desenvolvimento deve ser incremental:
    1.  Criação da migration do banco e testes unitários do schema.
    2.  Implementação do endpoint backend e validação dos testes (pytest).
    3.  Ajustes ou novas telas no frontend e validação manual/visual.
*   **Testes Automatizados Obrigatórios**: Nenhuma feature está concluída sem testes automatizados que cubram cenários positivos (sucesso do fluxo) e negativos (erros esperados, entradas inválidas, tentativas de quebra de regras). Os testes devem rodar com sucesso dentro do ambiente Docker.
*   **Rollback Imediato**: Se uma alteração quebrar fluxos centrais e o problema não for resolvido em até 3 iterações de depuração, o código deve ser revertido imediatamente (`git restore .` e `git clean -df`) para restaurar o estado estável da branch de trabalho.

### 🏢 Arquiteto de Sistemas ERP (Regras de Negócio Corporativo)
*   **Trilha de Auditoria (Audit Trail)**: Toda modificação (inserção, atualização, deleção) em tabelas centrais do sistema (Lançamentos, Contas, RBAC) deve herdar do `AuditMixin`. Ela registra automaticamente no banco de dados (`audit_logs`) o ID do usuário que fez a ação, o IP, o User-Agent e o diff das alterações (`before`/`after` em formato JSON).
*   **Preservação por Ajuste Contábil**: No financeiro corporativo, deleções permanentes (hard deletes) em transações conciliadas são evitadas. A exclusão de um lançamento deve ser tratada como soft delete ou rebatida com lançamentos de estorno, mantendo a consistência do fluxo de caixa histórico.

---

## 3. Diretrizes de UX/UI do Frontend

Para garantir que a interface do usuário permaneça limpa, amigável e rápida, seguimos as seguintes diretrizes:

1.  **Divulgação Progressiva**: Mostre primeiro o essencial (resumos, totais e status). Use gavetas laterais (Drawers) ou acordeões para detalhamentos secundários e formulários de edição complexos, evitando modais centralizados que bloqueiam o contexto.
2.  **Otimização de Listas**: Evite renderizar tabelas gigantes como visão inicial se as informações puderem ser representadas por cards visuais organizados (ex: lista de Contas, Perfis, ou Clientes). Sempre aplique paginação ou filtros robustos.
3.  **Inputs Inteligentes**:
    *   Sempre formate valores monetários em tempo real no client-side usando o componente `CurrencyInput`.
    *   Trate máscaras de CPF/CNPJ, CEP e telefone localmente e garanta que o backend limpe caracteres especiais antes de persistir no banco.
    *   Ofereça autocomplete de CEP integrado ao serviço ViaCEP para acelerar o preenchimento de endereços.
4.  **Rótulos Diretos**: Mantenha as labels curtas e acionáveis. Dê feedback visual imediato para carregamentos (spinners), estados vazios inteligentes (com instruções úteis) e mensagens claras em caso de erros de rede.

---

## 4. Topologia de Infraestrutura e Comandos Úteis

### 🔌 Conectividade de Rede e Segurança
O PostgreSQL do Kyrus ERP roda em um container standalone isolado. A porta externa `5432` não é aberta publicamente. O backend se comunica com o banco estritamente através da rede bridge interna do Docker (`kyrus_portal`).

Para criar a rede de conectividade antes do primeiro deploy:
```bash
docker network create kyrus_portal
```

### 🐳 Cenários de Deploy com Docker Compose

#### Desenvolvimento / Base (Frontend + Backend local)
*   **Arquivo**: `docker-compose.yml`
*   **Portas**: Backend em `8000`, Frontend em `3000`.
*   **Comando**: `docker compose -f docker-compose.yml up -d`

#### Produção (Backend + Nginx reverso)
*   **Arquivo**: `docker-compose.prod.yml`
*   **Descrição**: Utiliza o profile `prod` e expõe a aplicação de forma segura nas portas `80` e `443` através do Nginx.
*   **Comando**: `docker compose --profile prod -f docker-compose.prod.yml up -d`

#### SSL / HTTPS
*   **Arquivo**: `docker-compose.ssl.yml`
*   **Descrição**: Configuração do Nginx reverso com suporte a certificados gerados via Certbot.
*   **Comando**: `docker compose -f docker-compose.ssl.yml up -d`

#### CasaOS
*   **Arquivo**: `docker-compose.casaos.yml`
*   **Descrição**: Deploy simplificado utilizando imagem única consolidada do registro GHCR com Watchtower para atualizações automatizadas.
*   **Comando**: `docker compose -f docker-compose.casaos.yml up -d`

---

## 🧪 Comandos Úteis de Diagnóstico e Execução

### Validar Arquivos de Configuração do Compose:
```bash
docker compose -f docker-compose.yml config
docker compose --profile prod -f docker-compose.prod.yml config
```

### Recompilar e Atualizar Serviços (Hot-fix/Mudanças de Código):
```bash
# Recompilar tudo
docker compose up -d --build

# Recompilar apenas o frontend
docker compose up -d --build frontend

# Recompilar apenas o backend
docker compose up -d --build backend
```

### Acompanhar Logs em Tempo Real:
```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### Executar Testes Automatizados no Container:
```bash
# Rodar todos os testes
docker compose exec backend pytest

# Rodar um arquivo de testes específico
docker compose exec backend pytest tests/test_lancamentos_minimized.py
```

### Validar Conexão Interna com o PostgreSQL a partir do App:
```bash
docker exec -it kyrustech_backend sh -lc "getent hosts postgresql && nc -zv postgresql 5432"
```
