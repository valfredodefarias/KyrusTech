import requests

# Fazer login
response = requests.post(
    "http://localhost:8000/api/v1/auth/login",
    data={
        "username": "admin@kyrustech.com",
        "password": "admin123"
    }
)

print(f"Login Status: {response.status_code}")
if response.status_code == 200:
    token = response.json()["access_token"]
    print(f"Token: {token}")
    
    # Agora testar o endpoint com token válido
    headers = {"Authorization": f"Bearer {token}"}
    
    response2 = requests.get(
        "http://localhost:8000/api/v1/consultor/super/consultores",
        headers=headers
    )
    print(f"Endpoint Status: {response2.status_code}")
    print(f"Response: {response2.text}")
else:
    print(f"Login failed: {response.text}")
