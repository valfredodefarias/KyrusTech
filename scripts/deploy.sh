#!/bin/bash

# Kyrus ERP - Script de Inicialização para Produção

echo "=================================================="
echo "🚀 KYRUS ERP - INICIALIZAÇÃO PARA PRODUÇÃO"
echo "=================================================="

# Verificar se o arquivo .env existe
if [ ! -f .env ]; then
    echo "❌ Arquivo .env não encontrado!"
    echo "💡 Copie .env.example para .env e preencha as variáveis:"
    echo "   cp .env.example .env"
    exit 1
fi

# Carregar variáveis de ambiente
export $(cat .env | grep -v '#' | xargs)

echo "📦 Ambiente: $ENVIRONMENT"
echo "🗄️  Banco de Dados: $POSTGRES_SERVER:$POSTGRES_PORT"
echo "🔐 CORS Origins: $BACKEND_CORS_ORIGINS"

# Parar containers anteriores
echo ""
echo "🛑 Parando containers anteriores..."
docker-compose down

# Pull de atualizações
echo "⬇️  Atualizando imagens..."
docker-compose pull

# Build do projeto
echo "🔨 Compilando projeto..."
docker-compose build

# Iniciar containers
echo "▶️  Iniciando containers..."
docker-compose up -d

# Aguardar o banco de dados ficar pronto
echo "⏳ Aguardando banco de dados estar pronto..."
sleep 5

# Executar migrations
echo "🔄 Executando migrations..."
docker-compose exec -T backend alembic upgrade head

# Criar usuário admin (opcional)
echo "👤 Criando usuário admin..."
docker-compose exec -T backend python scripts/create_admin.py

echo ""
echo "=================================================="
echo "✅ KYRUS ERP INICIADO COM SUCESSO!"
echo "=================================================="
echo ""
echo "📱 Frontend: http://$HOSTNAME:3000"
echo "⚙️  Backend API: http://$HOSTNAME:8000"
echo "📄 Documentação: http://$HOSTNAME:8000/docs"
echo ""
echo "🔍 Para ver logs:"
echo "   docker-compose logs -f backend"
echo "   docker-compose logs -f frontend"
echo ""
