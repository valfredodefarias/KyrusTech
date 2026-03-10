import requests

session = requests.Session()

login_response = session.post(
    "http://localhost:8000/api/v1/auth/login",
    data={
        "username": "admin@kyrustech.com",
        "password": "admin123"
    }
)

print(f"Login Status: {login_response.status_code}")
if login_response.status_code == 200:
    print(f"Sessao criada por {login_response.json()['expires_in_minutes']} minutos")
    print(f"Cookies recebidos: {session.cookies.get_dict()}")

    response = session.get("http://localhost:8000/api/v1/consultor/super/consultores")
    print(f"Endpoint Status: {response.status_code}")
    print(f"Response: {response.text}")

    logout_response = session.post("http://localhost:8000/api/v1/auth/logout")
    print(f"Logout Status: {logout_response.status_code}")
else:
    print(f"Login failed: {login_response.text}")
