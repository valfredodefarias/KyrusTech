# 🗺️ Visão Geral do Kyrus ERP

Bem-vindo ao cofre do Kyrus ERP. Este documento serve como ponto de partida para entender o funcionamento e a organização do sistema.

## 🏗️ Arquitetura do Sistema
O Kyrus ERP é construído sob uma arquitetura de duas camadas principais (Frontend SPA e Backend REST API) totalmente conteinerizadas em Docker.

- **Backend**: FastAPI (Python), SQLModel (ORM), PostgreSQL.
- **Frontend**: React (TypeScript) + Vite + Tailwind CSS v4.
- **Auditoria**: Mixins de banco que registram todas as criações, edições e exclusões no banco de dados (`is_deleted` para soft-deletes).

---

## 🗂️ Links Rápidos de Navegação (Obsidian Wiki)
*   [[Regras de Seguranca]] - Normas críticas contra vazamento de dados de empresas.
*   [[Modelos de Dados]] - Estrutura e relacionamentos das tabelas do banco.
*   [[Fluxos e Integracoes]] - Como funciona o fluxo financeiro e conexões como Asaas.

---

## 💻 Stack Tecnológico
*   **Gerenciador de Estado**: Zustand.
*   **Ícones**: Lucide React.
*   **Banco de Dados**: PostgreSQL com migrations via Alembic.
