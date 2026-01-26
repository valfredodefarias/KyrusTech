@echo off
REM ============================================================
REM KYRUS ERP - Quick Start Script (Windows)
REM Inicializa o projeto rapidamente
REM ============================================================

setlocal enabledelayedexpansion

echo.
echo 🚀 KYRUS ERP - INICIALIZAÇÃO RÁPIDA (WINDOWS)
echo ====================================

REM 1. Verificar se Docker está instalado
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker não está instalado. Instale primeiro: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

echo ✅ Docker encontrado

REM 2. Gerar .env se não existir
if not exist .env (
    echo.
    echo 📝 Gerando arquivo .env...
    
    if exist .env.example (
        copy .env.example .env
        echo ✅ Arquivo .env criado
        echo ⚠️  IMPORTANTE: Edite o arquivo .env com suas configurações!
        echo    Abra: .env
    ) else (
        echo ❌ Arquivo .env.example não encontrado
        pause
        exit /b 1
    )
) else (
    echo ✅ Arquivo .env encontrado
)

REM 3. Compilar frontend
if not exist kyrus-web\dist (
    echo.
    echo 🔨 Compilando frontend ^(primeira vez, pode levar alguns minutos^)...
    
    if not exist kyrus-web\node_modules (
        cd kyrus-web
        call npm install
        cd ..
    )
    
    cd kyrus-web
    call npm run build
    cd ..
    
    echo ✅ Frontend compilado
) else (
    echo ✅ Frontend já compilado
)

REM 4. Build do Docker
echo.
echo 🐳 Construindo imagens Docker...
docker-compose build

REM 5. Iniciar containers
echo.
echo ▶️  Iniciando containers...
docker-compose up -d

REM 6. Aguardar banco de dados estar pronto
echo.
echo ⏳ Aguardando banco de dados estar pronto ^(pode levar 10-20 segundos^)...
timeout /t 15

REM 7. Exibir informações finais
echo.
echo ✅ ============================================
echo ✅ KYRUS ERP INICIADO COM SUCESSO!
echo ✅ ============================================
echo.
echo 📱 URLs de acesso:
echo    Frontend:        http://localhost:3000
echo    API Backend:     http://localhost:8000/api/v1
echo    Documentação:    http://localhost:8000/docs
echo.
echo 🔍 Para ver logs:
echo    docker-compose logs -f
echo.
echo 🛑 Para parar:
echo    docker-compose down
echo.
echo 📝 Próximos passos:
echo    1. Acesse http://localhost:3000
echo    2. Teste o login com as credenciais configuradas
echo    3. Explore a aplicação
echo.
echo ❓ Precisa de ajuda? Veja DEPLOYMENT.md
echo.

pause
