FROM python:3.11-slim

WORKDIR /app

# Instalar dependências de sistema mínimas sem pacotes recomendados desnecessários
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    postgresql-client \
    chromium \
    chromium-driver \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libu2f-udev \
    libvulkan1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver

# Copiar requirements primeiro para utilizar o cache de camadas do Docker
COPY requirements.txt .

# Instalar pacotes Python com cache limpo
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código da aplicação
COPY . .

# Criar diretórios necessários
RUN mkdir -p static/uploads

EXPOSE 8000

RUN chmod +x scripts/*.py

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
