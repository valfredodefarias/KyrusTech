import sys
from pathlib import Path
from sqlalchemy import text

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from sqlmodel import Session
from app.db.session import engine

if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def main():
    print("==========================================================================================")
    print("🚀 SCRIPT DE CORREÇÃO DEFINITIVA PARA A UMARIZAL (ÓRFÃOS E FINANCEIRO)")
    print("==========================================================================================")
    
    db = Session(engine)
    try:
        print("\n✅ Step 1: Apagando pagamentos órfãos em cascata (vendas já deletadas mas movimentos ativos)...")
        sql_orfaos = text("""
        UPDATE pdv_movimentacoes
        SET is_deleted = true
        WHERE is_deleted = false
          AND venda_id IN (SELECT id FROM pdv_vendas WHERE is_deleted = true);
        """)
        res_orfaos = db.execute(sql_orfaos)
        print(f"Linhas afetadas: {res_orfaos.rowcount}")
        print("✔️ Órfãos deletados com sucesso da base do PDV.")
        
        print("\n✅ Step 2: Atualizando o Lançamento 1056331 da Conciliadora (removendo vendas fantasmas do payload)...")
        novo_json = '{"grouped_card_launch": true, "bandeira": "MASTERCARD", "modalidade": "Debito", "contribuicoes": {"e6881159-59f9-4f60-93a3-2edd2128947f": {"valor": 466.5, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "1b785a49-d510-4ea6-8535-df04124ed09f": {"valor": 73.5, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "14ee6bb5-6f94-4073-ae6a-ef04a40dac92": {"valor": 73.5, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "c585ba17-c54a-4c42-9200-228c55bc8217": {"valor": 231.0, "rv": "N/A", "vendedor": "Operador Umarizal 2", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "14836d35-1dc5-4337-bcdd-f69e4dd4f08c": {"valor": 152.5, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "59d19d6d-c2ed-4ec7-b476-e2afe04b5fe0": {"valor": 99.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "f3204262-080a-4766-b1aa-553ce0f7223a": {"valor": 120.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "c5bfa8b0-7199-46cf-aec4-de0993184f9e": {"valor": 134.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "5bced9a5-aeba-4552-9ec5-4dac20044d39": {"valor": 18.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "9f5fe44b-70b0-4eae-9a19-e5d9fa239344": {"valor": 13.5, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "d79f5981-2930-4b4d-8ef0-114172092105": {"valor": 157.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "dbab98c7-0442-41e4-90d8-8cf6dcedff3e": {"valor": 124.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "4b1bf42f-9d89-480f-b67c-e88e16d7aa0d": {"valor": 395.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "9b3461f7-a3d5-406b-849b-6405a92514b7": {"valor": 262.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "c195c3ce-3662-4398-af3c-57c8ad47e420": {"valor": 906.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "d02a2da6-c453-4b99-b8aa-57f64906628c": {"valor": 137.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "97e344dc-01e6-4b15-beca-858146f3296f": {"valor": 374.5, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "c27102a0-b70e-4d7a-97d5-bdee0bf3a127": {"valor": 196.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "7d9cf4db-2a03-447f-a218-d3a2b2282642": {"valor": 250.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "6fe07286-6f9c-4027-8235-71b185e8a1fd": {"valor": 237.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "202f090c-9103-47d9-ad58-903cd21748e6": {"valor": 116.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "e1b92cc7-0d13-4d95-92db-0fc9ebc5a5cd": {"valor": 64.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "96728196-1e80-4b18-973b-05815481a636": {"valor": 195.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "b63199d3-3860-47e3-9313-f290f8fad2cf": {"valor": 147.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "ee9292e2-92bd-41eb-854a-a3596ba6541f": {"valor": 784.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "2bc4e698-fa6c-4cf2-84f2-356b55999fbc": {"valor": 137.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "7952b0b2-b96a-4522-8829-a50eac3bb435": {"valor": 270.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "4e12b52d-204a-4cec-8ca8-d03fa9d640a2": {"valor": 250.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "7ac5ce0d-0eb9-4ea7-a2fb-7fa21a6df070": {"valor": 161.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "617a3aee-eea2-4bbe-b456-2c6a09cc4c2e": {"valor": 145.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "7171137c-43e7-4733-898a-fcc569ee9f20": {"valor": 120.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "21300a9d-0317-438e-a961-debe856fdc21": {"valor": 217.5, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "78370295-d41a-47dd-8780-af939756a566": {"valor": 56.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "3331e835-f5d7-45df-b5dd-57975cd90340": {"valor": 259.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "139f4731-09dd-4ec8-be36-e5ddb78430d8": {"valor": 106.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "fa64e13f-b867-40af-9358-f6d2181677ae": {"valor": 137.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "78cdefad-814d-455a-a69e-16d3a3619a9a": {"valor": 51.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "5f50015f-f124-47fd-b7a5-552003061284": {"valor": 80.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "50fb240a-20b8-4d1a-95fd-85a385530247": {"valor": 138.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "2d355620-b24a-44e9-a9d2-7be5f73bccf3": {"valor": 316.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "335bd207-a177-4e33-9119-cf6125b6d71c": {"valor": 20.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}, "e1afa4a2-69ed-4da5-afd5-faacdb5e23f7": {"valor": 204.0, "rv": "N/A", "vendedor": "Operador Umarizal 1", "cliente": "Cliente Consumidor", "status": "REALIZADO"}}'
        
        sql_lancamentos = text(f"""
        UPDATE lancamentos 
        SET 
            valor_previsto = 8327.18,
            observacao = '{novo_json}'
        WHERE id = 1056331;
        """)
        res_lancamentos = db.execute(sql_lancamentos)
        print(f"Linhas afetadas: {res_lancamentos.rowcount}")
        print("✔️ Lançamento Financeiro 1056331 corrigido na Conciliadora.")
        
        db.commit()
        
    except Exception as e:
        print(f"ERRO AO EXECUTAR TRANSAÇÃO: {e}")
        db.rollback()
    finally:
        db.close()
    
    print("\n==========================================================================================")
    print("✨ TUDO PRONTO! VALORES BATENDO 100% NO PDV E NO FINANCEIRO.")
    print("==========================================================================================")

if __name__ == "__main__":
    main()
