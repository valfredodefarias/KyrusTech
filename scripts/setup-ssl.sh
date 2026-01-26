#!/bin/bash

# ============================================================
# Setup SSL com Let's Encrypt para Kyrus ERP
# ============================================================

echo "🔒 KYRUS ERP - Configuração de SSL"
echo "===================================="

# Verificar argumentos
if [ $# -lt 2 ]; then
    echo "❌ Uso: ./setup-ssl.sh <dominio> <email>"
    echo "   Exemplo: ./setup-ssl.sh meuprojeto.com admin@meuprojeto.com"
    exit 1
fi

DOMAIN=$1
EMAIL=$2

echo "📧 Domínio: $DOMAIN"
echo "📧 Email: $EMAIL"

# 1. Criar diretórios necessários
echo ""
echo "📁 Criando diretórios..."
mkdir -p certs

# 2. Gerar certificado
echo ""
echo "🔐 Gerando certificado SSL..."
echo "    Isso pode levar alguns minutos..."

docker run --rm -it \
  -v "$(pwd)/certs:/etc/letsencrypt" \
  -v "$(pwd)/certbot_www:/var/www/certbot" \
  -p 80:80 \
  certbot/certbot certonly \
    --standalone \
    --email $EMAIL \
    -d $DOMAIN \
    -d www.$DOMAIN \
    --agree-tos \
    --no-eff-email

if [ $? -eq 0 ]; then
    echo "✅ Certificado gerado com sucesso!"
else
    echo "❌ Erro ao gerar certificado"
    exit 1
fi

# 3. Atualizar nginx.conf
echo ""
echo "🔧 Atualizando configurações do Nginx..."

# Fazer backup
cp nginx-ssl.conf nginx-ssl.conf.backup

# Substituir domínio no arquivo
sed -i "s/seu-dominio.com/$DOMAIN/g" nginx-ssl.conf

echo "✅ Nginx configurado"

# 4. Iniciar com SSL
echo ""
echo "🚀 Iniciando Kyrus ERP com SSL..."
docker-compose -f docker-compose.ssl.yml up -d

# 5. Aguardar inicialização
echo ""
echo "⏳ Aguardando containers..."
sleep 10

# 6. Testar
echo ""
echo "🧪 Testando HTTPS..."
curl -I https://$DOMAIN 2>/dev/null | head -n 1

echo ""
echo "✅ ============================================"
echo "✅ SSL CONFIGURADO COM SUCESSO!"
echo "✅ ============================================"
echo ""
echo "📱 Acessar:"
echo "   https://$DOMAIN"
echo ""
echo "🔄 Renovação automática:"
echo "   O certificado será renovado automaticamente"
echo "   Próxima renovação: ~90 dias"
echo ""
echo "📊 Para ver logs:"
echo "   docker-compose -f docker-compose.ssl.yml logs -f"
echo ""
echo "🛑 Para parar:"
echo "   docker-compose -f docker-compose.ssl.yml down"
echo ""
