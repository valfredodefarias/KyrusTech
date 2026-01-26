import uvicorn
import sys
import os
from pathlib import Path

# --- CONFIGURAÇÃO DE CAMINHOS ---
# Garante que o Python encontre a pasta 'app'
ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))

# Caminho da pasta do Frontend (React/Vite)
FRONTEND_DIR = ROOT_DIR / "kyrus-web"
ENV_FILE_PATH = FRONTEND_DIR / ".env"

# Importa utilitários de rede do próprio projeto
from app.core.network import get_local_ip

def update_frontend_env(current_ip: str):
    """
    Atualiza o arquivo .env do Frontend com o IP atual.
    Isso evita erro de CORS e 'Network Error' no celular.
    """
    api_url = f"http://{current_ip}:8000/api/v1"
    
    print(f"🔄 Configurando Frontend em: {ENV_FILE_PATH}")
    
    content = f"VITE_API_URL={api_url}\n"
    
    try:
        # Verifica se a pasta existe antes de tentar escrever
        if not FRONTEND_DIR.exists():
            print(f"⚠️  Pasta '{FRONTEND_DIR}' não encontrada. Pulei a configuração do frontend.")
            return

        # Escreve (ou sobrescreve) o arquivo .env
        with open(ENV_FILE_PATH, "w") as f:
            f.write(content)
            
        print(f"✅ Frontend configurado para apontar para: {api_url}")
        
    except Exception as e:
        print(f"❌ Erro ao atualizar .env do frontend: {e}")

if __name__ == "__main__":
    # 1. Detecta o IP da máquina
    local_ip = get_local_ip()
    print(f"\n🌍 IP Local Detectado: {local_ip}")

    # 2. Atualiza o Frontend automaticamente
    update_frontend_env(local_ip)

    print("\n" + "="*50)
    print("🚀 BACKEND INICIANDO...")
    print(f"📡 API Disponível em: http://{local_ip}:8000")
    print(f"📄 Documentação:     http://{local_ip}:8000/docs")
    print("="*50)
    
    print(f"\n💡 DICA: Para iniciar o Frontend, abra OUTRO terminal e rode:")
    print(f"   cd kyrus-web")
    print(f"   npm run dev")
    print("\n" + "="*50 + "\n")

    # 3. Inicia o Backend (Uvicorn)
    # host="0.0.0.0" permite que outros PCs/Celulares acessem
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)