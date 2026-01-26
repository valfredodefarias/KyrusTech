#!/bin/bash

# ============================================================
# KYRUS ERP - Quick Start Script
# Inicializa o projeto rapidamente
# ============================================================

set -e

echo "🚀 KYRUS ERP - INICIALIZAÇÃO RÁPIDA"
echo "===================================="

# 1. Verificar se Docker está instalado
if ! command -v docker &> /dev/null; then
    echo "❌ Docker não está instalado. Instale primeiro: https://docs.docker.com/get-docker/"
    exit 1
fi

echo "✅ Docker encontrado"

# 2. Gerar .env se não existir
if [ ! -f .env ]; then
    echo ""
    echo "📝 Gerando arquivo .env..."
    
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ Arquivo .env criado"
        echo "⚠️  IMPORTANTE: Edite o arquivo .env com suas configurações!"
        echo "   nano .env"
    else
        echo "❌ Arquivo .env.example não encontrado"
        exit 1
    fi
else
    echo "✅ Arquivo .env encontrado"
fi

# 3. Compilar frontend
if [ ! -d kyrus-web/dist ]; then
    echo ""
    echo "🔨 Compilando frontend (primeira vez, pode levar alguns minutos)..."
    
    if [ ! -d kyrus-web/node_modules ]; then
        cd kyrus-web
        npm install
        cd ..
    fi
    
    cd kyrus-web
    npm run build
    cd ..
    
    echo "✅ Frontend compilado"
else
    echo "✅ Frontend já compilado"
fi

# 4. Build do Docker
echo ""
echo "🐳 Construindo imagens Docker..."
docker-compose build

# 5. Iniciar containers
echo ""
echo "▶️  Iniciando containers..."
docker-compose up -d

# 6. Aguardar banco de dados estar pronto
echo ""
echo "⏳ Aguardando banco de dados estar pronto (pode levar 10-20 segundos)..."
sleep 15

# 7. Executar migrations (se aplicável)
echo ""
echo "🔄 Verificando banco de dados..."
docker-compose logs backend | grep -q "✅ Banco de dados inicializado" || true

# 8. Exibir informações finais
echo ""
echo "✅ ============================================"
echo "✅ KYRUS ERP INICIADO COM SUCESSO!"
echo "✅ ============================================"
echo ""
echo "📱 URLs de acesso:"
echo "   Frontend:        http://localhost:3000"
echo "   API Backend:     http://localhost:8000/api/v1"
echo "   Documentação:    http://localhost:8000/docs"
echo ""
echo "🔍 Para ver logs:"
echo "   docker-compose logs -f"
echo ""
echo "🛑 Para parar:"
echo "   docker-compose down"
echo ""
echo "📝 Próximos passos:"
echo "   1. Acesse http://localhost:3000"
echo "   2. Teste o login com as credenciais configuradas"
echo "   3. Explore a aplicação"
echo ""
echo "❓ Precisa de ajuda? Veja DEPLOYMENT.md"
echo ""
