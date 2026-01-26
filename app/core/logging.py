# app/core/logging.py

import logging
import sys
from loguru import logger
from app.core.config import settings

# --- CONFIGURAÇÃO DO LOGURU ---

# Remover handlers padrão
logger.remove()

# Configuração baseada no ambiente
if settings.ENVIRONMENT == "development":
    # Desenvolvimento: logs coloridos e detalhados
    logger.add(
        sys.stderr,
        level="DEBUG",
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        colorize=True,
        enqueue=True,
        backtrace=True,
        diagnose=True
    )
else:
    # Produção: logs em JSON para análise estruturada
    logger.add(
        sys.stderr,
        level="INFO",
        format="{message}",
        serialize=True,
        enqueue=True
    )
    
    # Também salvar em arquivo
    logger.add(
        "logs/app.log",
        level="INFO",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
        rotation="500 MB",
        retention="7 days",
        enqueue=True
    )
