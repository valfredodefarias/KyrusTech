"""
Script para gerar arquivo de configuração JavaScript do frontend
com o IP detectado automaticamente.

Este script deve ser executado antes de iniciar a aplicação ou
pode ser chamado automaticamente pelo run.py
"""
import sys
from pathlib import Path

# Adiciona o diretório raiz ao path para importar módulos do app
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.core.config import LOCAL_IP, BACKEND_PORT, FRONTEND_PORT, API_BASE_URL
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def generate_frontend_config():
    """
    Gera o arquivo frontend/js/config.js com as configurações dinâmicas.
    """
    config_file = ROOT_DIR / "frontend" / "js" / "config.js"
    
    config_content = f"""// Configuração gerada automaticamente - NÃO EDITAR MANUALMENTE
// Este arquivo é gerado pelo script scripts/generate_frontend_config.py
// Para alterar o IP, edite app/core/config.py ou app/core/network.py

export const API_BASE_URL = '{API_BASE_URL}';
export const BACKEND_URL = 'http://{LOCAL_IP}:{BACKEND_PORT}';
export const FRONTEND_URL = 'http://{LOCAL_IP}:{FRONTEND_PORT}';
export const LOCAL_IP = '{LOCAL_IP}';
export const APP_NAME = 'Kyrus ERP';
"""
    
    try:
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text(config_content, encoding='utf-8')
        logger.info(f"✅ Arquivo de configuração gerado: {config_file}")
        logger.info(f"   IP detectado: {LOCAL_IP}")
        logger.info(f"   API URL: {API_BASE_URL}")
        return True
    except Exception as e:
        logger.error(f"❌ Erro ao gerar arquivo de configuração: {e}")
        return False


if __name__ == "__main__":
    success = generate_frontend_config()
    sys.exit(0 if success else 1)

