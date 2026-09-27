[🗺️ Visão Geral](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/Visao%20Geral.md) / [🚀 Fluxo de Desenvolvimento](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/Loops%20e%20Validacoes.md)
***

# 🛠️ Guia de Solução de Problemas (Troubleshooting)

Este documento centraliza as soluções para os problemas e erros mais comuns enfrentados no ambiente de desenvolvimento local, testes e produção do Kyrus ERP.

---

## 1. Banco de Dados e Conexão

### ❌ Erro: `could not translate host name "db_kyrustech" to address: Name or service not known`
*   **Causa**: O host `db_kyrustech` é o nome do container do banco de dados na rede interna do Docker. Ele só é resolvido se o backend estiver rodando de dentro do Docker. Se você tentar rodar o backend localmente na máquina física (ex: via `uvicorn app.main:app`), ele não conseguirá resolver este host.
*   **Solução**:
    1.  Certifique-se de que o container do banco de dados está rodando no Docker:
        ```bash
        docker compose up -d db_kyrustech
        ```
    2.  No seu arquivo `.env` local, altere o valor de `POSTGRES_SERVER` de `db_kyrustech` para `localhost` (ou `127.0.0.1`).
    3.  Ajuste a porta `POSTGRES_PORT` para a porta exposta localmente no host (a configuração padrão do compose expõe a porta `5432` no host).

### ❌ O servidor backend trava na inicialização em `Checking database migrations...`
*   **Causa**: O Alembic utiliza locks consultivos (`pg_advisory_lock`) para evitar que múltiplos workers apliquem migrações simultaneamente. Se o servidor for interrompido de forma abrupta durante uma migração, o lock pode ficar retido.
*   **Solução**:
    Conecte no banco de dados (via DBeaver ou terminal do PostgreSQL) e execute a liberação manual do lock consultivo:
    ```sql
    SELECT pg_advisory_unlock_all();
    ```

---

## 2. Testes e Frontend (Vitest & Zustand)

### ❌ Vitest trava e falha com `Allocation failed - JavaScript heap out of memory`
*   **Causa**: Em testes unitários que mockam seletores do Zustand (como `useEmpresa`), retornar novos objetos literais dentro do callback do seletor:
    ```typescript
    vi.mock('@/hooks/useEmpresa', () => ({
      useEmpresa: vi.fn((selector) => selector({ empresa: { id: 1 } })) // ❌ Cria nova referência a cada render
    }));
    ```
    Isso provoca loops infinitos de re-renderização dentro do `useEffect` / `useMemo` do componente testado, saturando o garbage collector do V8 até estourar o limite de memória do Node.js.
*   **Solução**: Declare o estado do mock em uma variável estável externa antes do callback:
    ```typescript
    const mockState = {
      empresa: { id: 1, razao_social: 'Empresa Teste' },
      empresaId: 1,
      carregando: false,
    };
    vi.mock('@/hooks/useEmpresa', () => ({
      useEmpresa: vi.fn((selector) => selector ? selector(mockState) : mockState) // ✅ Referência estável
    }));
    ```

### ❌ Erro de importação `undefined` ou travamento de HMR por Dependência Circular de Stores
*   **Causa**: Importação cruzada no topo de arquivos entre Zustand stores (ex: `lookupStore.ts` importa `useTransactionStore` e `transactionStore.ts` importa `useLookupStore`). No carregamento do módulo, uma das referências ainda é `undefined`.
*   **Solução**: Desacople as stores utilizando dispatch funcional ou callbacks dinâmicos injetados em tempo de execução:
    ```typescript
    // Exemplo: notificador desacoplado via listener em lookupStore.ts
    let refreshTransactionListener: (() => void) | null = null;
    export const registerTransactionRefresh = (fn: () => void) => { refreshTransactionListener = fn; };
    export const notifyTransactionRefresh = () => { refreshTransactionListener?.(); };
    ```

---

## 3. Backend e Performance de I/O (FastAPI)

### ❌ Servidor congela ou requisições HTTP dão timeout durante upload de planilha Excel (.xlsx)
*   **Causa**: Se a rota de upload for declarada como `async def upload_xlsx(...)`, o parsing síncrono de planilhas com dezenas de milhares de linhas usando `openpyxl` executa na thread principal do event loop do asyncio, bloqueando completamente o atendimento a todas as outras requisições da API.
*   **Solução**: Declare a rota como uma função síncrona comum:
    ```python
    @router.post("/upload-xlsx")
    def upload_xlsx(...): # ✅ FastAPI despacha automaticamente para threadpool worker
        ...
    ```
    Ou use explicitamente `await asyncio.to_thread(processar_planilha, content)`.

---

## 4. Inicialização e Scripts (Windows / PowerShell)

### ❌ Erro: `npx : File ...\npx.ps1 cannot be loaded because running scripts is disabled on this system`
*   **Causa**: A política de execução do Windows PowerShell bloqueia a execução de scripts `.ps1` locais por motivos de segurança.
*   **Solução**:
    *   No PowerShell, você pode ignorar temporariamente a restrição para a sessão atual:
        ```powershell
        powershell -ExecutionPolicy Bypass -Command "npx tsc --noEmit"
        ```
    *   Ou, alternativamente, execute os comandos do Node através do prompt de comando clássico (`cmd.exe`):
        ```cmd
        cmd /c "npm run dev"
        ```

---

## 5. Qualidade de Código e Linter (Frontend)

### ❌ Muitos erros de `@typescript-eslint/no-explicit-any` ao rodar o lint
*   **Causa**: A regra recomendada do TypeScript-ESLint proíbe o uso do tipo `any`. Em partes mais antigas ou em transição da base de código do frontend, o tipo `any` é amplamente utilizado, gerando centenas de erros no console.
*   **Solução**:
    *   A regra foi configurada para `'off'` no `eslint.config.js` para permitir a execução limpa dos builds locais e pipelines.
    *   Tente tipar novos códigos de forma estrita sempre que possível, evitando a proliferação do tipo `any` nos novos componentes.

