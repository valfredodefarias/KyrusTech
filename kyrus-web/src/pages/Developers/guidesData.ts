import type { GuideItem } from './types';

export const GUIDES: GuideItem[] = [
  {
    id: 'comece-por-aqui',
    title: 'Comece por aqui',
    summary: 'Visão geral da API Kyrus, primeiros passos e fluxo de integração.',
    iconName: 'Rocket',
    content: `# Comece por aqui

Bem-vindo à documentação oficial para desenvolvedores da plataforma **Kyrus ERP**.

A API do Kyrus foi projetada seguindo os padrões RESTful modernos para permitir que você integre ferramentas de automação (como **n8n**, **Zapier**, **Make**), plataformas de comércio eletrônico, sistemas legados e webhooks diretamente ao ecossistema financeiro e contábil da sua empresa.

---

### O que você pode fazer com a API:
- **Financeiro:** Criar, consultar, atualizar e liquidar lançamentos (receitas e despesas).
- **Contas Bancárias:** Consultar saldos, conciliar extratos e gerenciar contas correntes.
- **Entidades:** Cadastrar e sincronizar clientes, fornecedores e contatos.
- **PDV & Vendas:** Registrar faturamentos, vendas de balcão e conferência de caixa.
- **Plano de Contas & Centros de Custo:** Categorizar despesas e classificar orçamentos.

---

### Princípios da Arquitetura:
1. **Contas de Serviço Dedicadas:** Ao criar uma Chave de API no painel, uma conta de serviço interna é associada à chave com permissões estritas e isoladas por empresa (*multi-tenant*).
2. **Criptografia Segura:** As chaves são criptografadas com HMAC-SHA256 e pepper exclusivo do servidor. Seu valor plano é exibido **uma única vez** no momento da geração.
3. **Idempotência Nativa:** Operações de escrita aceitam o cabeçalho \`X-Idempotency-Key\` para evitar duplicação em caso de instabilidade de rede ou retentativas automáticas.

Para obter sua primeira chave de acesso, acesse **Configurações > Integrações & APIs > Nova Chave de API** dentro do seu painel Kyrus.
`,
  },
  {
    id: 'autenticacao',
    title: 'Autenticação',
    summary: 'Como assinar requisições usando o cabeçalho X-Api-Key ou Bearer token.',
    iconName: 'Key',
    content: `# Autenticação

Todas as chamadas à API Kyrus devem ser autenticadas por meio de uma **Chave de API** gerada no painel de administração da sua empresa.

---

### Formato das Chaves:
As chaves do Kyrus possuem um prefixo identificador de ambiente:
- **Produção:** Inicia com \`kyr_live_\` seguido por 32 bytes hexadecimais aleatórios (ex: \`kyr_live_8f3a9e1d2c4b5a60718293a4b5c6d7e8\`).
- **Testes / Sandbox:** Inicia com \`kyr_test_\`.

---

### Enviando a Chave nas Requisições:
Você pode autenticar suas chamadas utilizando qualquer um dos dois métodos abaixo:

#### Método Recomendado: Header \`X-Api-Key\`
\`\`\`http
GET /api/v1/lancamentos HTTP/1.1
Host: api.kyrustech.com.br
X-Api-Key: kyr_live_8f3a9e1d2c4b5a60718293a4b5c6d7e8
\`\`\`

#### Método Alternativo: Header \`Authorization: Bearer\`
\`\`\`http
GET /api/v1/lancamentos HTTP/1.1
Host: api.kyrustech.com.br
Authorization: Bearer kyr_live_8f3a9e1d2c4b5a60718293a4b5c6d7e8
\`\`\`

---

### Regras de Segurança:
- **Apenas Headers:** Chaves de API **não** são aceitas via query string (URL) nem cookies de sessão.
- **Anti-Escalada:** A chave de API nunca pode possuir permissões superiores às do usuário que a emitiu.
- **Revogação Instantânea:** Se uma chave for comprometida, ela pode ser revogada ou rotacionada imediatamente em **Configurações > Integrações & APIs**.
`,
  },
  {
    id: 'ambientes',
    title: 'Ambientes',
    summary: 'URLs de conexão para Produção e Desenvolvimento.',
    iconName: 'Server',
    content: `# Ambientes

A API Kyrus disponibiliza ambientes seguros com criptografia TLS 1.3 obrigatória.

---

### Servidor de Produção Oficial:
Todas as requisições comerciais e automações em funcionamento devem apontar para:

\`\`\`
https://api.kyrustech.com.br
\`\`\`

Prefixo dos endpoints: \`/api/v1\`  
Exemplo de URL completa: \`https://api.kyrustech.com.br/api/v1/lancamentos\`

---

### Servidor Local / Desenvolvimento:
Para testes locais em ambiente Docker ou desenvolvimento interno:

\`\`\`
http://localhost:8000
\`\`\`

Exemplo: \`http://localhost:8000/api/v1/lancamentos\`

---

### Protocolo & Codificação:
- **Transporte:** HTTPS obrigatório em produção.
- **Formato:** Todas as requisições com corpo (POST, PUT, PATCH) devem enviar o cabeçalho \`Content-Type: application/json\`.
- **Codificação de Caracteres:** UTF-8 estrito.
`,
  },
  {
    id: 'codigos-http',
    title: 'Códigos HTTP e Erros',
    summary: 'Convenções de status HTTP e estrutura de respostas de erro.',
    iconName: 'AlertCircle',
    content: `# Códigos HTTP e Tratamento de Erros

A API utiliza códigos padrão de status HTTP para sinalizar o sucesso ou falha das operações.

---

### Resumo dos Códigos:

| Código | Descrição | Significado |
|---|---|---|
| **200 OK** | Sucesso | Requisição processada com êxito. |
| **201 Created** | Criado | Recurso criado com sucesso (ex: novo lançamento ou entidade). |
| **400 Bad Request** | Erro de Negócio | Dados inconsistentes ou parâmetros inválidos. |
| **401 Unauthorized** | Não Autenticado | Chave ausente, expirada, revogada ou inválida. |
| **403 Forbidden** | Acesso Negado | Chave não tem permissão RBAC para este endpoint, ou rota não pública. |
| **404 Not Found** | Não Encontrado | Registro inexistente ou de outra empresa. |
| **409 Conflict** | Conflito / Idempotência | Requisição idêntica já está sendo processada neste momento. |
| **422 Unprocessable Entity** | Erro de Validação | Schema incorreto (ex: campo numérico enviado como texto inválido). |
| **429 Too Many Requests** | Limite Excedido | Limite de requisições por minuto atingido (rate limit). |
| **500 Internal Server Error** | Erro Interno | Falha inesperada no servidor. |

---

### Estrutura Padrão de Erro:
\`\`\`json
{
  "detail": "Permissão necessária: lancamentos:create"
}
\`\`\`

Em caso de erro de validação (HTTP 422):
\`\`\`json
{
  "detail": [
    {
      "loc": ["body", "valor_previsto"],
      "msg": "Input should be a valid number",
      "type": "decimal_type"
    }
  ]
}
\`\`\`
`,
  },
  {
    id: 'listagem-e-paginacao',
    title: 'Listagem e Paginação',
    summary: 'Como paginar resultados em endpoints de listagem.',
    iconName: 'ListOrdered',
    content: `# Listagem e Paginação

Endpoints que retornam múltiplos registros utilizam parâmetros de paginação via query string para otimizar desempenho e tráfego.

---

### Parâmetros de Paginação:
- **\`skip\`** *(inteiro, padrão: 0)*: Quantidade de registros a serem pulados no início.
- **\`limit\`** *(inteiro, padrão: 50, máx: 200)*: Quantidade máxima de registros a retornar na página.

---

### Exemplo de Requisição:
\`\`\`http
GET /api/v1/entidades/paged?skip=0&limit=20&q=Distribuidora HTTP/1.1
Host: api.kyrustech.com.br
X-Api-Key: kyr_live_...
\`\`\`

---

### Formato de Resposta Paginada:
\`\`\`json
{
  "items": [
    {
      "id": 1,
      "nome": "Distribuidora Modelo LTDA",
      "tipo": "CLIENTE",
      "status": "ATIVO"
    }
  ],
  "total": 85,
  "skip": 0,
  "limit": 20
}
\`\`\`

Para navegar para a próxima página, envie \`skip = skip + limit\` (ex: \`skip=20\`).
`,
  },
  {
    id: 'limites-rate-limit',
    title: 'Limites de Requisição (Rate Limit)',
    summary: 'Regras de taxa de chamadas por minuto e cabeçalhos de controle.',
    iconName: 'Gauge',
    content: `# Limites de Requisição (Rate Limit)

Para garantir a disponibilidade e estabilidade do ecossistema para todas as integrações, a API Kyrus aplica limites automáticos de taxa de requisições.

---

### Limites Aplicados:
- **Requisições com Chave de API:** **120 requisições por minuto** por prefixo de chave (\`kyr_live_...\`).
- **Limite Adicional por IP:** Proteção contínua contra ataques volumétricos. Ambos os limites devem passar simultaneamente.

---

### Cabeçalhos de Resposta:
Toda resposta da API inclui os cabeçalhos de controle:

\`\`\`http
X-RateLimit-Limit: 120
X-RateLimit-Window: 60
X-RateLimit-Remaining: 114
\`\`\`

- **\`X-RateLimit-Limit\`**: Cota máxima permitida dentro da janela temporal.
- **\`X-RateLimit-Window\`**: Janela de tempo em segundos (60 segundos).
- **\`X-RateLimit-Remaining\`**: Quantidade de requisições restantes até a renovação.

---

### Resposta ao Exceder (HTTP 429):
\`\`\`json
{
  "detail": "Muitas requisições para esta chave de API. Tente novamente em instantes."
}
\`\`\`

**Dica de Arquitetura:** Recomendamos configurar nas suas automações (n8n/código) um mecanismo de espera com recuo exponencial (*exponential backoff*) quando o status HTTP 429 for recebido.
`,
  },
  {
    id: 'idempotencia',
    title: 'Idempotência',
    summary: 'Como usar o cabeçalho X-Idempotency-Key para evitar duplicidade.',
    iconName: 'ShieldCheck',
    content: `# Idempotência

Em integrações de automação e pagamentos, problemas transitórios de rede podem fazer com que um webhook ou chamada HTTP falhe sem que o cliente saiba se o servidor processou a operação.

Para evitar a criação de lançamentos ou pedidos duplicados em retentativas, utilize **Idempotência**.

---

### Cabeçalho de Idempotência:
Envie um identificador único no cabeçalho \`X-Idempotency-Key\` (ou \`Idempotency-Key\`):

\`\`\`http
POST /api/v1/pdv/vendas HTTP/1.1
Host: api.kyrustech.com.br
X-Api-Key: kyr_live_...
X-Idempotency-Key: pedido_ecommerce_98451_tentativa_1
Content-Type: application/json

{
  "entidade_id": 12,
  ...
}
\`\`\`

---

### Comportamento do Servidor:
1. **Primeira Chamada:** O servidor processa normalmente a requisição, grava o resultado e armazena a resposta em cache vinculada à chave e à sua empresa.
2. **Retentativa Concluída:** Se você reenviar a mesma requisição com a mesma chave, o servidor **não reexecuta** a lógica de negócio e retorna imediatamente a resposta gravada anteriormente.
3. **Chamada Simultânea (HTTP 409 Conflict):** Se uma segunda requisição chegar com a mesma chave enquanto a primeira ainda está sendo processada, o servidor retorna \`409 Conflict\` informando que a operação está em andamento.

> **Recomendação Forte:** Utilize UUID v4 ou o ID do evento externo (ex: \`id_pedido_shopify_12345\`) como chave de idempotência.
`,
  },
  {
    id: 'usando-com-n8n',
    title: 'Usando com n8n',
    summary: 'Tutorial completo de configuração no n8n com o nó HTTP Request.',
    iconName: 'Workflow',
    content: `# Usando com o n8n

O **n8n** é uma das principais plataformas de automação utilizadas com o Kyrus ERP. Veja como configurar uma integração profissional em menos de 2 minutos.

---

### 1. Criar a Chave de API no Kyrus:
1. No menu lateral do Kyrus, acesse **Configurações > Integrações & APIs**.
2. Clique em **Nova Chave de API**.
3. Dê o nome \`n8n Automação de Vendas\` e selecione o perfil **Integração Completa (Padrão)**.
4. Clique em **Gerar Chave de API** e copie o segredo exibido (\`kyr_live_...\`).

---

### 2. Configurar o nó HTTP Request no n8n:
No seu fluxo do n8n, adicione o nó **HTTP Request**:

- **Method:** \`POST\` (ou \`GET\`, dependendo da rota).
- **URL:** \`https://api.kyrustech.com.br/api/v1/lancamentos/\`
- **Authentication:** \`None\` (pois configuraremos o header explicitamente).
- **Send Headers:** \`true\`
  - Adicione o parâmetro:
    - **Name:** \`X-Api-Key\`
    - **Value:** \`kyr_live_sua_chave_aqui\`
  - Para POST/PUT, adicione também:
    - **Name:** \`X-Idempotency-Key\`
    - **Value:** \`{{ $json.id || $execution.id }}\`
- **Send Body:** \`true\`
- **Specify Body:** \`JSON\`
- **JSON:**
\`\`\`json
{
  "descricao": "Venda via n8n - Pedido #{{ $json.order_id }}",
  "tipo": "RECEITA",
  "valor_previsto": {{ $json.total_price }},
  "data_vencimento": "{{ $now.format('yyyy-MM-dd') }}",
  "plano_contas_id": 12,
  "conta_id": 1,
  "entidade_id": {{ $json.customer_id }}
}
\`\`\`

---

### 3. Tratamento de Retries:
Nas configurações avançadas do nó HTTP Request do n8n:
- Marque a opção **Retry on Fail**.
- **Max Tries:** 3
- **Wait Between Tries:** 2000 ms

Graças ao cabeçalho \`X-Idempotency-Key\`, o n8n pode retentar com segurança total sem risco de duplicar receitas ou despesas!
`,
  },
];
