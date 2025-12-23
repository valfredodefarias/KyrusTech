# app/core/logging.py

import logging
import sys
from loguru import logger
from app.core.config import settings

# --- CONFIGURAÇÃO DO LOGURU ---

# 1. Removemos os handlers padrão para ter controle total
logger.remove()

# 2. Adicionamos um handler para o modo de DESENVOLVIMENTO
# Logs coloridos e formatados para fácil leitura humana
logger.add(
    sys.stderr,
    level="DEBUG",
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    colorize=True,
    enqueue=True, # Torna a escrita de logs assíncrona para não bloquear a aplicação
    backtrace=True, # Mostra o traceback completo em caso de erro
    diagnose=True # Adiciona informações de diagnóstico em exceções
)

# 3. (Futuro/Opcional) Adicionar um handler para o modo de PRODUÇÃO
# Em produção, você comentaria o handler acima e descomentaria este.
# logger.add(
#     sys.stderr,
#     level="INFO",
#     format="{level} {message}", # Formato simples, pois o JSON fará o resto
#     serialize=True, # O SEGREDO: Transforma o log em um JSON
#     enqueue=True
# )