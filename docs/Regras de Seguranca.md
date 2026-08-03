[🗺️ Visão Geral]([[Visao Geral]]) / [🚀 Fluxo de Desenvolvimento]([[Loops e Validacoes]])
***

# 🛡️ Regras de Segurança do Kyrus ERP

Este documento lista as diretrizes essenciais de segurança para evitar vazamento de dados, controle de acessos indevidos e brechas de integridade.

---

## 🔒 1. Multitenancy (Regra de Ouro)
O Kyrus ERP é um sistema multiempresa. Sob nenhuma hipótese os dados de uma empresa podem ser visualizados ou editados por usuários de outra empresa.

*   **No Backend**: Toda query de busca, atualização ou deleção na base de dados deve conter explicitamente o filtro `empresa_id = current_user.empresa_id`.
    *   *Exemplo*: `select(Lancamento).where(Lancamento.empresa_id == current_user.empresa_id)`
*   **No Frontend**: Todo cabeçalho de requisição HTTP deve carregar o `X-Company-ID` dinâmico para suportar consultores que gerenciam múltiplas empresas.

---

## 🔑 2. Proteção Contra IDOR (Insecure Direct Object Reference)
Ao receber um ID por parâmetro na rota (ex: `PUT /cartoes/{cartao_id}`), nunca faça a atualização direta apenas buscando pelo ID.
*   **Correto**: Buscar o registro combinando o ID dele e a empresa do usuário:
    ```python
    query = select(Cartao).where(Cartao.id == cartao_id, Cartao.empresa_id == current_user.empresa_id)
    ```

---

## 📁 3. Segurança em Upload de Anexos
Sempre que o usuário enviar arquivos (ex: comprovantes):
1.  **Renomear**: Salvar o arquivo com um UUID único (`uuid.uuid4()`) para evitar injeção de nomes maliciosos ou directory traversal.
2.  **Validar Extensão e MIME**: Não confiar apenas na extensão informada. Validar os cabeçalhos de bytes mágicos (ex: checking signatures para `.png`, `.pdf`, `.jpeg`).
3.  **Tamanho Máximo**: Limitar a 5MB para imagens e 10MB para PDFs.

---

## 🗄️ 4. Gestão de Credenciais e Regra de Ouro de Execução em Produção

1.  **Credenciais Isoladas**: O arquivo `.env` de produção contém senhas, usuários e portas distintos do ambiente local. Nunca hardcodear credenciais nos scripts e sempre ler dinamicamente das variáveis de ambiente.
2.  **Validação Local Obrigatória (Zero Risk)**: Sob nenhuma hipótese qualquer script de migração, alteração de banco ou procedimento administrativo deve ser executado no servidor de produção sem ter sido previamente testado e aprovado em uma restauração local do dump.
3.  **Dumps Não-Bloqueantes e Limpos**: Dumps em produção devem utilizar a técnica de gravação em arquivo interno do container (`-f /tmp/...`) seguida de `docker cp`, evitando qualquer poluição por STDOUT/TTY que possa corromper os dados binários. Para o procedimento completo, consulte o [MANUAL_DUMP_PRODUCAO.md](file:///c:/Users/Ciro/Documents/ERP/KyrusERP/docs/MANUAL_DUMP_PRODUCAO.md).

