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
- `docker compose up -d --build`: Reconstrói as imagens e inicia os serviços.
- `docker compose up -d --build frontend`: Recompila e atualiza o container do frontend.
- `docker compose down`: Para os serviços e remove os containers.
- `docker compose logs -f [serviço]`: Acompanha os logs de um serviço em tempo real (ex: `backend`, `frontend`, `db`).

## 🧪 Executando Testes Automatizados
Para rodar a suíte de testes unitários e de integração do backend:
```bash
# Executa todos os testes
docker compose exec backend pytest

# Executa um teste específico (ex: teste do payload minimizado)
docker compose exec backend pytest tests/test_lancamentos_minimized.py
```

## ⚡ Otimizações de Desempenho Recentes
Para manter o carregamento das telas instantâneo, implementamos otimizações de tráfego de dados e CPU:
- **Boletim Financeiro**: Otimizado para realizar **uma única chamada paralela** (removendo requisições sequenciais consecutivas).
- **Endpoint Minimizado**: Adição da flag `minimized=true` no endpoint `/lancamentos/` no backend para retornar apenas dados essenciais via `JSONResponse` direto, ignorando a serialização demorada do Pydantic (economia de **56% de banda** e redução no uso de CPU do servidor).
- **Lookup de Entidades**: A busca de interessados passou a usar `/entidades/lookup`, reduzindo o payload inicial de entidades em **90%**.
- Para diagnósticos completos, análises e reflexões de viabilidade sobre o uso de matrizes/Arrays tipados no frontend, consulte o documento: [OTIMIZACAO_BOLETIM.md](OTIMIZACAO_BOLETIM.md).

## Usuários de Teste Padrão
* **Administrador (SUPER_CONSULTOR):**
  * Email: `admin@kyrustech.com`
  * Senha: `admin123`
* **Consultor Interno:**
  * Email: `consultor@kyrustech.com`
  * Senha: `consultor123`