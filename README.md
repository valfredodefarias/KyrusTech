# 📘 KyrusTech - Arquitetura Escalável v4.0

Documentação de infraestrutura completa: [INFRAESTRUTURA.md](INFRAESTRUTURA.md)

Este projeto foi configurado com paridade de ambientes em mente, utilizando Docker para garantir que o desenvolvimento seja o mais próximo possível da produção.

## Pré-requisitos
- Python 3.10+
- Docker e Docker Compose

## Workflow de Setup Inicial (Ambiente Linux)
1.  **Configure o Ambiente:**
    - Renomeie `.env.example` para `.env`.
    - **IMPORTANTE:** As senhas no `.env` devem ser as mesmas do `docker-compose.yml`.

2.  **Inicie o Banco de Dados com Docker:**
    ```bash
docker compose up -d
    ```
    *(O `-d` roda em modo "detached", liberando seu terminal).*

3.  **Crie e Ative o Ambiente Virtual Python:**
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```

4.  **Instale as Dependências:**
    ```bash
    pip install -r requirements.txt
    ```

5.  **Configure e Execute as Migrações do Banco:**
    - Edite `alembic.ini` e `alembic/env.py` para conectar com o banco (instruções no terminal do setup).
    ```bash
    alembic revision --autogenerate -m "Cria tabelas iniciais"
    alembic upgrade head
    ```

6.  **Rode o Servidor da Aplicação:**
    ```bash
    uvicorn app.main:app --reload
    ```

## Comandos Úteis do Docker
- `docker compose up -d`: Inicia os serviços em segundo plano.
- `docker compose down`: Para os serviços e remove os containers.
- `docker compose logs -f db`: Vê os logs do banco de dados em tempo real.    

consultor@kyrustech.com
Senha: consultor123