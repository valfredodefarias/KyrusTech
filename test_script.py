import requests
import json

s = requests.Session()
res = s.post('http://localhost:8000/api/v1/auth/login', data={'username': 'cirocaue12@gmail.com', 'password': '@Ciro1310'})
print('Login:', res.status_code)

res = s.get('http://localhost:8000/api/v1/usuarios/me')
print('Me:', res.status_code)
if res.status_code == 200:
    user = res.json()
    e = user.get('empresa_id')
    print('Empresa_id:', e)
    res = s.get('http://localhost:8000/api/v1/empresas/' + str(e))
    print('Empresa request:', res.status_code, res.json())
