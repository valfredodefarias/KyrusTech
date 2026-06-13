# Arquitetura do Kyrus ERP

Este documento serve como mapa de referência e **contrato principal** para o desenvolvimento autônomo do Kyrus ERP. Todos os agentes de IA devem ler este arquivo antes de iniciar qualquer tarefa.

---

## 0. Contrato de Desenvolvimento (Como Trabalhar)
Para manter o projeto seguro, modular e livre de quebras silenciosas, o desenvolvimento deve seguir as seguintes premissas:

1. **Micro-Tarefas (Baby Steps)**: O desenvolvimento de novas features deve ser quebrado em passos isolados (1º banco, 2º endpoints/schemas, 3º telas). Nunca altere backend e frontend de uma vez só sem aprovação.
2. **Git Commit após Sucesso**: Assim que um passo for entregue com sucesso e validado pelos testes, o usuário deve realizar um commit local (ex: `git commit -m "Adiciona rota X"`).
3. **Rollback Rápido (3 Tentativas)**: Se a IA gerar um bug e não conseguir resolvê-lo em até 3 tentativas, ela deve admitir a perda de foco e instruir o usuário a fazer um descarte total executando `git restore .` e `git clean -df`.
4. **Trabalho Concluído = Testes Passando**: Nenhuma funcionalidade é considerada pronta se não houver um teste correspondente (pytest) e se todos os testes não passarem 100%.

---

## 1. Stack Tecnológico
* **Backend**: FastAPI (Python 3.10+), SQLModel (ORM), PostgreSQL, Alembic (migrações).
* **Frontend**: React, Vite, TypeScript, Tailwind CSS, Zustand (gerenciamento de estado).
* **Orquestração**: Docker & Docker Compose com rede interna segura `kyrus_portal`.

---

## 2. Estrutura de Diretórios e Camadas

### Backend (`app/`)
* **`models/`**: Entidades SQLModel mapeadas diretamente para as tabelas do banco.
* **`schemas/`**: Schemas Pydantic para validação e serialização de dados de entrada/saída das APIs (separação estrita).
* **`crud/`**: Métodos e consultas reutilizáveis no banco de dados (Repository Pattern simplificado).
* **`services/`**: Serviços auxiliares (ex: conexões com gateways como Asaas, importações OFX).
* **`api/v1/endpoints/`**: Controladores de rotas HTTP. Apenas chamam a camada CRUD/services e validam schemas.

### Frontend (`kyrus-web/`)
* **`src/pages/`**: Páginas e telas principais da aplicação (ex: `Lancamentos.tsx`, `Dre.tsx`).
* **`src/components/`**: Componentes reutilizáveis compartilhados entre as telas (ex: `CurrencyInput.tsx`, `BrandAvatar.tsx`).
* **`src/services/`**: Cliente de API unificado (`api.ts` com Axios).
* **`src/store/`**: Gerenciamento de estado global usando Zustand (ex: `authStore.ts`, `lookupStore.ts`).

---

## 3. Padrões de Interface (UX/UI)
Seguimos as regras do [FRONTEND_UI_GUIDELINES.md](FRONTEND_UI_GUIDELINES.md) e o padrão estabelecido na tela de referência `Lancamentos.tsx`:

* **Modais e Drawers**: Para formulários complexos (criação/edição), usamos gavetas deslizantes laterais (Drawers) em vez de modais centralizados pesados.
* **Seleções Dinâmicas**:
  - `SearchableSelect`: Para busca de itens únicos em listas longas (ex: contas, categorias).
  - `MultiSelectDropdown`: Para filtros ou seleções de múltiplos itens em listas dinâmicas.
* **Campos Formatados**:
  - Valores monetários formatados localmente no input via `CurrencyInput`.
  - CPFs/CNPJs e CEPs com máscaras em tempo real no client-side e limpando caracteres não-numéricos no backend.
  - Consulta automática de endereço a partir de CEP usando o serviço `Viacep` direto no formulário.

---

## 4. Diretrizes de Desenvolvimento e Segurança
1. **Migrations**: Nenhuma tabela ou coluna deve ser alterada manualmente em produção. Sempre gere migrations do Alembic (`alembic revision --autogenerate`).
2. **Validação**: Validação rígida sempre no backend via Pydantic. Nunca confie no frontend.
3. **Idempotência**: Jobs e conciliações financeiras devem validar unicidade/chaves naturais para evitar duplicidade.
4. **Logs**: Logs estruturados em pontos críticos. Dados sensíveis (senhas, segredos, chaves) são proibidos nos logs.
