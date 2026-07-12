# 🛠️ Guia de Solução de Problemas (Troubleshooting)

Este documento centraliza as soluções para os problemas e erros mais comuns enfrentados no ambiente de desenvolvimento local do Kyrus ERP.

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

## 2. Inicialização e Scripts (Windows / PowerShell)

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

## 3. Qualidade de Código e Linter (Frontend)

### ❌ Muitos erros de `@typescript-eslint/no-explicit-any` ao rodar o lint
*   **Causa**: A regra recomendada do TypeScript-ESLint proíbe o uso do tipo `any`. Em partes mais antigas ou em transição da base de código do frontend, o tipo `any` é amplamente utilizado, gerando centenas de erros no console.
*   **Solução**:
    *   A regra foi configurada para `'off'` no `eslint.config.js` para permitir a execução limpa dos builds locais e pipelines.
    *   Tente tipar novos códigos de forma estrita sempre que possível, evitando a proliferação do tipo `any` nos novos componentes.
