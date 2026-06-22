from sqlmodel import Session
from app.db.session import engine
from app.models.empresa import Empresa
import json

with Session(engine) as db:
    empresa = db.get(Empresa, 27)
    if empresa:
        print(f"Nome da Empresa: {empresa.nome_fantasia or empresa.razao_social}")
        print("PDV Config:", json.dumps(json.loads(empresa.pdv_config) if empresa.pdv_config else {}, indent=2))
    else:
        print("Empresa 27 não encontrada!")
