
import requests

s = requests.Session()
res = s.post('http://localhost:8000/api/v1/auth/login', data={'username': 'cirocaue12@gmail.com', 'password': '@Ciro1310'})
print('Login:', res.status_code)
if res.status_code == 200:
    token = res.json().get('access_token')
    s.headers.update({'Authorization': f'Bearer {token}'})

    res = s.get('http://localhost:8000/api/v1/usuarios/me')
    print('Me:', res.status_code, res.json())
    user = res.json()
    empresa_id = user.get('empresa_id')

    res = s.get(f'http://localhost:8000/api/v1/empresas/{empresa_id}')
    print(f'Empresa {empresa_id}:', res.status_code, res.json())

