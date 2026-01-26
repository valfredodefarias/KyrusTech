import psycopg2
from psycopg2 import OperationalError

# --- LISTA DE SUSPEITOS PARA TESTAR ---
cenarios = [
    {
        "nome": "1. Docker Local (Padrão Novo)",
        "host": "103.63.28.155",
        "port": "5432",
        "user": "kyrus_user",
        "password": "kyrus_pass",
        "dbname": "kyrus_erp"
    },
    {
        "nome": "2. Docker Local (Usuário Antigo)",
        "host": "103.63.28.155",
        "port": "5432",
        "user": "kyrus_admin",
        "password": "Consultoria@2025",
        "dbname": "kyrus_erp"
    },
    {
        "nome": "3. Docker Local (Padrão Postgres)",
        "host": "103.63.28.155",
        "port": "5432",
        "user": "postgres",
        "password": "postgres",
        "dbname": "postgres"
    },
    {
        "nome": "4. Servidor Remoto (Online)",
        "host": "103.63.28.155",
        "port": "5432",
        "user": "kyrus_admin",
        "password": "Consultoria@2025",
        "dbname": "kyrus_erp",
    }
]

print("\n🕵️  INICIANDO INVESTIGACAO DE CONEXAO...\n")

for cenario in cenarios:
    print(f"Tentando: {cenario['nome']}...")
    print(f"   -> {cenario['user']}@{cenario['host']} (DB: {cenario['dbname']})")
    
    try:
        # Monta os argumentos
        conn_args = {
            "host": cenario["host"],
            "port": cenario["port"],
            "user": cenario["user"],
            "password": cenario["password"],
            "dbname": cenario["dbname"],
            "connect_timeout": 3
        }
        
        if "sslmode" in cenario:
            conn_args["sslmode"] = cenario["sslmode"]

        # Tenta conectar
        conn = psycopg2.connect(**conn_args)
        conn.close()
        
        # SE CHEGOU AQUI, FUNCIONOU!
        print("✅ SUCESSO! CONECTADO!")
        print(f"   CREDENCIAIS CORRETAS: User='{cenario['user']}' | Pass='{cenario['password']}'")
        print("   (Use isso no seu .env)\n")
        
    except OperationalError as e:
        erro = str(e).strip()
        if 'password authentication failed' in erro:
            print("❌ FALHA: Senha incorreta.")
        elif 'role' in erro and 'does not exist' in erro:
            print(f"❌ FALHA: O usuário '{cenario['user']}' nao existe.")
        elif 'database' in erro and 'does not exist' in erro:
            print(f"❌ FALHA: O banco '{cenario['dbname']}' nao existe.")
        elif 'timeout' in erro or 'Connection refused' in erro:
            print("❌ FALHA: Não conseguiu alcançar o servidor (Timeout/Recusado).")
        else:
            print(f"❌ ERRO: {erro}")
    except Exception as e:
        print(f"❌ ERRO CRÍTICO: {e}")
    
    print("-" * 40)

print("\nFim.")