import uvicorn
import threading
import os
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler

# --- CONFIGURAÇÕES ---
BACKEND_HOST = "0.0.0.0"
BACKEND_PORT = 8000
FRONTEND_PORT = 5501 # Usando 5501 para evitar conflito
FRONTEND_DIR = "frontend" # Nome da pasta do frontend

def run_backend():
    print(f"🚀 [BACKEND] Iniciando em http://{BACKEND_HOST}:{BACKEND_PORT}")
    uvicorn.run("app.main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=True)

def run_frontend():
    # Muda para o diretório do frontend para servir os arquivos corretamente
    os.chdir(FRONTEND_DIR)
    
    server_address = (BACKEND_HOST, FRONTEND_PORT)
    httpd = HTTPServer(server_address, SimpleHTTPRequestHandler)
    
    print(f"🎨 [FRONTEND] Iniciando em http://{BACKEND_HOST}:{FRONTEND_PORT}")
    httpd.serve_forever()

if __name__ == "__main__":
    # Inicia o Frontend em uma thread separada (segundo plano)
    t_front = threading.Thread(target=run_frontend)
    t_front.daemon = True
    t_front.start()

    # Dá um tempinho para o print não encavalar
    time.sleep(1)

    # Inicia o Backend na thread principal
    run_backend()