[🗺️ Visão Geral]([[Visao Geral]]) / [🚀 Fluxo de Desenvolvimento]([[Loops e Validacoes]])
***

# Guia de Gerenciamento do Kyrus ERP com Inteligência Artificial

Este manual foi criado para você gerenciar o desenvolvimento do ERP de forma segura e autônoma, sem precisar escrever uma única linha de código. Use este guia como seu livro de regras para interagir com a IA (Antigravity, Cursor, Cline ou similares).

---

## 1. O Salva-Vidas (Controle do Git)
Como você não fará a depuração linha a linha, o **Git** é o seu botão de "desfazer". Siga esta regra estritamente:

* **Sempre que uma tela ou funcionalidade funcionar, salve o progresso!**
  Abra um terminal na pasta do projeto e digite:
  ```bash
  git add .
  git commit -m "IA: Criou a funcionalidade X com sucesso"
  ```
* **Botão de Pânico (Rollback)**: Se a IA começar a errar seguidamente (tentando consertar o mesmo bug 3 vezes ou mais) ou quebrar o que já estava funcionando, **não insista**. Digite estes comandos no terminal para limpar tudo e voltar ao último commit salvo:
  ```bash
  git restore .
  git clean -df
  ```
  *Após a limpeza, mude a forma de pedir a tarefa (seja mais simples e quebre em partes menores).*

---

## 2. Inicializando o Agente (O Prompt de Ouro)
Sempre que abrir uma nova conversa com a IA para iniciar um desenvolvimento, cole este comando exato:

> **PROMPT DE INICIALIZAÇÃO:**
> *"Antes de fazer qualquer alteração ou leitura, leia atentamente os arquivos `ARCHITECTURE.md` e `.clinerules` na raiz do projeto. Você deve seguir estritamente o mapa de arquitetura e as regras de token economy estabelecidas ali."*

Isso impede que a IA invente conexões inexistentes ou escreva códigos fora do padrão do Kyrus ERP.

---

## 3. Estratégia de Micro-Tarefas (Baby Steps)
Nunca peça um módulo inteiro de uma vez (ex: "crie o módulo de vendas"). Divida a tarefa em etapas menores.

**Exemplo de fluxo correto para criar uma nova funcionalidade (ex: Cadastro de Clientes):**
1. **Etapa 1 (Banco de Dados)**: *"Crie o modelo SQLModel em `app/models` para a tabela de Clientes e gere a migration do Alembic correspondente."* -> **(Valide, teste e faça commit!)**
2. **Etapa 2 (Backend)**: *"Crie o schema Pydantic, o CRUD e os endpoints no FastAPI para listagem, criação e edição de clientes."* -> **(Valide, teste e faça commit!)**
3. **Etapa 3 (Frontend)**: *"Crie a página de listagem e o modal de cadastro de clientes no frontend React usando os componentes padronizados como SearchableSelect e Tailwind."* -> **(Valide, teste e faça commit!)**

---

## 4. Testes como Auditoria (Garantia de Qualidade)
Você não precisa ler o código para saber se ele é seguro e funcional. Deixe que os testes façam isso por você.

* **Exigência**: Toda tarefa finalizada pela IA deve vir acompanhada da criação ou atualização de testes em Python.
* **Comando para Rodar os Testes**: Sempre que a IA disser que terminou, execute o seguinte comando no seu terminal para auditar se ela não quebrou nada:
  ```bash
  .\.venv\Scripts\pytest
  ```
* **Regra de Ouro**: O trabalho só está concluído e pronto para ser salvo (commit) se todos os testes passarem sem erro.
