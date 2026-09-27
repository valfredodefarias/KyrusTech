[🗺️ Visão Geral](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/Visao%20Geral.md) / [🚀 Fluxo de Desenvolvimento](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/Loops%20e%20Validacoes.md)
***

# 🛡️ Regras de Segurança do Kyrus ERP

Este documento lista as diretrizes essenciais de segurança para evitar vazamento de dados, controle de acessos indevidos e brechas de integridade em toda a aplicação.

---

## 🔒 1. Multitenancy (Regra de Ouro)
O Kyrus ERP é um sistema estritamente multiempresa. Sob nenhuma hipótese os dados de uma empresa podem ser visualizados ou editados por usuários de outra empresa.

*   **No Backend (Padrão Canônico)**: Toda query de busca, inserção, atualização ou deleção na base de dados deve conter explicitamente o filtro por `empresa_id` obtido via `Depends(get_empresa_id_from_user)`.
    *   **NUNCA utilize** `current_user.empresa_id` diretamente nas queries de negócio, pois isso quebra o contexto de consultores multiempresa e permite inconsistência de tenant.
    *   *Exemplo de Injeção*:
        ```python
        @router.get("/")
        async def listar_registros(
            empresa_id: int = Depends(get_empresa_id_from_user),
            current_user: Usuario = Security(get_current_user_with_permission, scopes=["financeiro:ler"]),
            session: AsyncSession = Depends(get_session)
        ):
            stmt = select(Lancamento).where(Lancamento.empresa_id == empresa_id)
            result = await session.execute(stmt)
            return result.scalars().all()
        ```
*   **No Frontend**: Todo cabeçalho de requisição HTTP (`api.ts`) carrega o header `X-Company-ID` dinâmico do contexto atual selecionado pelo usuário no seletor de empresa. O dependency `get_empresa_id_from_user` valida se o usuário autenticado possui vínculo ativo de associação (`UsuarioEmpresa`) com a empresa requisitada no header antes de conceder acesso.

---

## 🔑 2. Proteção Contra IDOR (Insecure Direct Object Reference)
Ao receber um ID por parâmetro na rota (ex: `PUT /cartoes/{cartao_id}`, `DELETE /pdv/caixa/{caixa_id}`, `POST /comissoes/fechamento/{id}`):
*   **Nunca** faça a atualização, busca ou deleção apenas pelo ID do registro.
*   **Sempre** combine o ID primário com o `empresa_id` validado pelo token/header:
    ```python
    stmt = select(Cartao).where(
        Cartao.id == cartao_id,
        Cartao.empresa_id == empresa_id
    )
    registro = (await session.execute(stmt)).scalar_one_or_none()
    if not registro:
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    ```
*   **Em Lotes / Uploads**: Ao importar ou conciliar registros vinculando entidades estrangeiras (ex: `conta_bancaria_id`, `categoria_id`, `vendedor_id`), valide explicitamente se tais entidades pertencem à mesma `empresa_id`.

---

## 📁 3. Segurança em Upload de Arquivos e Processamento Assíncrono
1.  **Renomear com UUID**: Salvar todo anexo ou comprovante com um UUID único (`uuid.uuid4()`) para evitar colisão e ataques de *directory traversal*.
2.  **Validar Assinatura MIME (Magic Bytes)**: Não confiar apenas na extensão informada pelo cliente. Validar cabeçalhos de bytes mágicos (`.png`, `.pdf`, `.jpeg`, `.xlsx`).
3.  **Tamanho Máximo Controlado**: Limitar uploads a 10MB para planilhas/documentos e 5MB para imagens.
4.  **Processamento sem Bloqueio de Event Loop**: Parsers intensivos em CPU (como leitura de arquivos Excel `.xlsx` com dezenas de milhares de linhas via `openpyxl`) devem ser executados em rotas síncronas (`def endpoint`) ou despachados para threadpool (`asyncio.to_thread`), impedindo congelamento do event loop do FastAPI.

---

## 🔐 4. Autenticação, Senhas e RBAC
1.  **Hashing de Senhas**: Utilização exclusiva de algoritmo `bcrypt` via PassLib, com salts automáticos.
2.  **Tokens JWT**: Assinados via `HS256` com `SECRET_KEY` segura vinda de variáveis de ambiente. Tokens contêm `sub` (ID do usuário), `exp` e `empresa_id` default.
3.  **Controle de Permissões Granulares (Scopes)**: Todo endpoint sensível utiliza `Security(get_current_user_with_permission, scopes=["recurso:acao"])` mapeado contra a tabela de perfis e permissões (`perfil_permissoes`).

---

## 🗄️ 5. Gestão de Credenciais e Regra de Ouro de Execução em Produção
1.  **Credenciais Isoladas**: O arquivo `.env` de produção contém senhas, usuários e portas distintos do ambiente local. Nunca hardcodear credenciais nos scripts e sempre ler dinamicamente das variáveis de ambiente.
2.  **Validação Local Obrigatória (Zero Risk)**: Sob nenhuma hipótese qualquer script de migração, alteração de banco ou procedimento administrativo deve ser executado no servidor de produção sem ter sido previamente testado e aprovado em uma restauração local do dump.
3.  **Dumps Não-Bloqueantes e Limpos**: Dumps em produção devem utilizar a técnica de gravação em arquivo interno do container (`-f /tmp/...`) seguida de `docker cp`, evitando qualquer poluição por STDOUT/TTY que possa corromper os dados binários. Para o procedimento completo, consulte o [MANUAL_DUMP_PRODUCAO.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/MANUAL_DUMP_PRODUCAO.md).
4.  **Durabilidade ACID**: O banco de dados PostgreSQL roda obrigatoriamente com `synchronous_commit=on`, garantindo persistência imediata das transações no WAL antes de retornar confirmação à aplicação.


