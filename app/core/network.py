"""
Módulo para detecção automática de IP da máquina.
Centraliza a lógica de obtenção do IP para uso em toda a aplicação.
"""
import socket
import logging
from typing import Optional

from app.core.config import settings

# Configura logging básico se não estiver configurado
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_local_ip() -> str:
    """
    Detecta automaticamente o IP local da máquina na rede.
    
    Tenta múltiplas estratégias para garantir robustez:
    1. Conecta a um socket externo para descobrir o IP
    2. Fallback para métodos alternativos se necessário
    
    Returns:
        str: IP local da máquina (ex: "192.168.0.39")
        
    Raises:
        RuntimeError: Se não conseguir detectar o IP
    """
    try:
        # Método mais confiável: conecta a um socket externo
        # para descobrir qual interface de rede está sendo usada
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            # Não precisa realmente conectar, só descobrir a interface
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            
        logger.info(f"✅ IP local detectado automaticamente: {ip}")
        return ip
        
    except Exception as e:
        logger.warning(f"⚠️ Erro ao detectar IP automaticamente: {e}")
        
        # Fallback: tenta obter hostname
        try:
            hostname = socket.gethostname()
            ip = socket.gethostbyname(hostname)
            
            # Se retornou 127.0.0.1, tenta método alternativo
            if ip == "127.0.0.1":
                # Tenta obter IP de interfaces de rede
                import platform
                if platform.system() == "Windows":
                    # Windows: usa ipconfig via subprocess
                    import subprocess
                    result = subprocess.run(
                        ["ipconfig"], 
                        capture_output=True, 
                        text=True
                    )
                    # Procura por IPv4 Address
                    for line in result.stdout.split('\n'):
                        if 'IPv4 Address' in line or 'Endereço IPv4' in line:
                            ip = line.split(':')[-1].strip()
                            if ip and ip != "127.0.0.1":
                                logger.info(f"✅ IP detectado via ipconfig: {ip}")
                                return ip
                else:
                    # Linux/Mac: usa ifconfig ou ip
                    import subprocess
                    try:
                        result = subprocess.run(
                            ["hostname", "-I"], 
                            capture_output=True, 
                            text=True
                        )
                        if result.returncode == 0:
                            ips = result.stdout.strip().split()
                            for candidate_ip in ips:
                                if candidate_ip and not candidate_ip.startswith("127."):
                                    logger.info(f"✅ IP detectado via hostname -I: {candidate_ip}")
                                    return candidate_ip
                    except:
                        pass
            
            if ip and ip != "127.0.0.1":
                logger.info(f"✅ IP detectado via hostname: {ip}")
                return ip
                
        except Exception as e2:
            logger.error(f"❌ Erro no fallback de detecção de IP: {e2}")
        
        # Último recurso: retorna localhost
        logger.warning("⚠️ Não foi possível detectar IP, usando 127.0.0.1")
        return "127.0.0.1"


def get_backend_url(ip: Optional[str] = None, port: int = 8000) -> str:
    """
    Retorna a URL completa do backend.
    
    Args:
        ip: IP a ser usado. Se None, detecta automaticamente.
        port: Porta do backend (padrão: 8000)
        
    Returns:
        str: URL completa (ex: "http://192.168.0.39:8000")
    """
    if settings.BACKEND_PUBLIC_URL:
        return settings.BACKEND_PUBLIC_URL.rstrip("/")
    if ip is None:
        ip = get_local_ip()
    return f"http://{ip}:{port}"


def get_frontend_url(ip: Optional[str] = None, port: int = 5501) -> str:
    """
    Retorna a URL completa do frontend.
    
    Args:
        ip: IP a ser usado. Se None, detecta automaticamente.
        port: Porta do frontend (padrão: 5501)
        
    Returns:
        str: URL completa (ex: "http://192.168.0.39:5501")
    """
    if ip is None:
        ip = get_local_ip()
    return f"http://{ip}:{port}"

