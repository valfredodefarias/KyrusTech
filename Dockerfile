FROM python:3.11-slim

WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    build-essential \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements
COPY requirements.txt .

# Instalar Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código da aplicação
COPY . .

# Criar diretórios necessários
RUN mkdir -p static/uploads

# Expor porta
EXPOSE 8000

# Script de inicialização
RUN chmod +x scripts/*.py

# Comando padrão - executa migrations e inicia o servidor
CMD python -u run.py

