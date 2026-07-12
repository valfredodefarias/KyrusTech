# tests/test_importacao_fabio.py
import os
import openpyxl
from datetime import date, datetime
from decimal import Decimal
import pytest
from sqlmodel import Session, select

from app.models.empresa import Empresa
from app.models.usuario import Usuario
from app.models.entidade import Entidade
from app.models.centro_custo import CentroCusto
from app.models.plano_contas import PlanoContas
from app.models.conta import Conta
from app.models.produto import Produto
from app.models.lancamento import Lancamento
from app.models.regra_cartao import RegraCartao
from app.models.pdv_ifood_lancamento import PdvIfoodLancamento
from app.models.pdv_venda import PdvVenda
from app.models.pdv_venda_item import PdvVendaItem
from app.models.pdv_movimentacao import PdvMovimentacao

# We will create mock excel files in a temporary directory for testing
@pytest.fixture
def mock_excel_files(tmp_path):
    path_umarizal = tmp_path / "Base_PizzaFabioUmarizal.xlsx"
    path_ananindeua = tmp_path / "Base_PizzaFabioAnanindeua.xlsx"
    path_ifood_marco = tmp_path / "Base_IFood_PizzaFabioMarco.xlsx"

    # Create Umarizal
    wb = openpyxl.Workbook()
    
    # a.Usuario
    ws_user = wb.active
    ws_user.title = "a.Usuario"
    ws_user.append(["Usuário", "Email", "Função"])
    ws_user.append(["Link Financeiro", "linkfinanceirooficial@gmail.com", "Master"])
    ws_user.append(["Operação Umarizal", "pizzadofabioumarizal@gmail.com", "Operacional"])
    ws_user.append(["Operação Marco", "linkcasamarco2018@gmail.com", "Operacional"])

    # CadClassificacao
    ws_class = wb.create_sheet("CadClassificacao")
    ws_class.append(["Classificação", "Descrição"])
    ws_class.append(["01.01. Dinheiro", "Receitas em Dinheiro"])
    ws_class.append(["01.02. Cartão crédito", "Receitas em Cartão Crédito"])
    ws_class.append(["01.03. Cartão débito", "Receitas em Cartão Débito"])
    ws_class.append(["01.04. IFood", "Receitas do iFood"])
    ws_class.append(["01.05. Pix QRS", "Receitas em PIX"])
    ws_class.append(["03.01. Fornecedores matéria prima", "Pagamento de Matéria Prima"])

    # Tb_Banco
    ws_bank = wb.create_sheet("Tb_Banco")
    ws_bank.append(["Banco", "Saldo Inicial", "Saldo Final"])
    ws_bank.append(["Caixa PDV Umarizal", 0, 100])
    ws_bank.append(["Tesouraria Umarizal", 0, 50])
    ws_bank.append(["Itaú Umarizal", 0, 1000])
    ws_bank.append(["Caixa PDV Marco", 0, 200])

    # CadInteressado
    ws_ent = wb.create_sheet("CadInteressado")
    ws_ent.append(["Nome", "Tipo"])
    ws_ent.append(["EQUATORIAL PA", "FORNECEDOR"])
    ws_ent.append(["CLIENTE GERAL", "CLIENTE"])

    # TxCartoes
    ws_tx = wb.create_sheet("TxCartoes")
    ws_tx.append(["IT", "Tipo", "Parcelas", "Bandeira", "Taxa", "Dias"])
    ws_tx.append(["Débito1Master", "Débito", 1, "Master", 0.0085, 1])
    ws_tx.append(["Crédito à vista1Master", "Crédito à vista", 1, "Master", 0.0195, 31])
    ws_tx.append(["Crédito parcelado2Master", "Crédito parcelado", 2, "Master", 0.0254, 1])

    # Tb_Movimentacao (PDV Sales)
    ws_mov = wb.create_sheet("Tb_Movimentacao")
    ws_mov.append(["IdPDV", "Data", "Tipo", "Histórico", "FormaPagto", "Bandeira", "Qtde Parcelas", "Valor Cheio", "Centro de Custo", "Saldo", "Horário", "Data Registro", "Usuário", "Exportado?", "TipoForma"])
    ws_mov.append(["PDV-1", date(2025, 1, 23), "Entrada", "MESA", "Dinheiro", None, 1, 100.0, "Umarizal", 100.0, "19:00:00", date(2025, 1, 23), "Operação Umarizal", "Sim", "Dinheiro"])
    ws_mov.append(["PDV-2", date(2025, 1, 23), "Entrada", "DELIVERY", "Pix", None, 1, 93.0, "Umarizal", 93.0, "19:05:00", date(2025, 1, 23), "Operação Umarizal", "Sim", "Pix"])
    ws_mov.append(["PDV-3", date(2025, 1, 23), "Entrada", "MESA", "Crédito à vista", "Master", 1, 120.0, "Marco", 120.0, "19:10:00", date(2025, 1, 23), "Operação Marco", "Sim", "Cartão"])

    # Tb_Financeira
    ws_fin = wb.create_sheet("Tb_Financeira")
    ws_fin.append(["IdFinanceiro", "Data Vcto", "Data Pagto", "Tipo", "Classificação", "Descrição", "Valor Previsto", "Valor Realizado", "Banco", "Situação", "IdParcelamento", "Interessado", "Centro de Custo"])
    # Umarizal row before PDV start
    ws_fin.append(["FIN-1", date(2025, 1, 20), date(2025, 1, 20), "Recebimento", "01.01. Dinheiro", "Venda antiga", 50.0, 50.0, "Caixa PDV Umarizal", "Pago", None, "CLIENTE GERAL", "Umarizal"])
    # Umarizal PIX row on/after PDV start (should be skipped because PDV-2 is PIX of 93.0 on 2025-01-23)
    ws_fin.append(["FIN-2", date(2025, 1, 23), date(2025, 1, 23), "Recebimento", "01.05. Pix QRS", "Movimentação em pix na unidade", 93.0, 93.0, "Itaú Umarizal", "Pago", None, "CLIENTE GERAL", "Umarizal"])
    # Marco Expense row
    ws_fin.append(["FIN-3", date(2025, 1, 23), date(2025, 1, 23), "Pagamento", "03.01. Fornecedores matéria prima", "Energia Equatorial", 150.0, 150.0, "Caixa PDV Marco", "Pago", None, "EQUATORIAL PA", "Marco"])

    # Tb_Ifood
    ws_ifood = wb.create_sheet("Tb_Ifood")
    ws_ifood.append(["Id_Ifood", "Data", "Hora", "Forma Pagto", "Valor Bruto", "Valor Líquido", "Status", "Data Recebimento"])
    ws_ifood.append(["IF-1", date(2025, 1, 23), "18:00:00", "credito_vista", 50.0, 44.0, "CONCILIADO", date(2025, 1, 30)])

    wb.save(path_umarizal)
    wb.close()

    # Create Ananindeua
    wb_an = openpyxl.Workbook()
    ws_user_an = wb_an.active
    ws_user_an.title = "a.Usuario"
    ws_user_an.append(["Usuário", "Email", "Função"])
    ws_user_an.append(["Operação Ananindeua", "casaananindeuafabio@gmail.com", "Operacional"])

    ws_class_an = wb_an.create_sheet("CadClassificacao")
    ws_class_an.append(["Classificação", "Descrição"])
    ws_class_an.append(["01.01. Dinheiro", "Receitas em Dinheiro"])
    ws_class_an.append(["01.05. Pix QRS", "Receitas em PIX"])

    ws_bank_an = wb_an.create_sheet("Tb_Banco")
    ws_bank_an.append(["Banco", "Saldo Inicial", "Saldo Final"])
    ws_bank_an.append(["Caixa PDV Ananindeua", 0, 0])
    ws_bank_an.append(["Itaú Ananindeua", 50000, 50100]) # Testing the offset of 50000!

    ws_tx_an = wb_an.create_sheet("TxCartoes")
    ws_tx_an.append(["IT", "Tipo", "Parcelas", "Bandeira", "Taxa", "Dias"])
    ws_tx_an.append(["Débito1Master", "Débito", 1, "Master", 0.0085, 1])

    ws_mov_an = wb_an.create_sheet("Tb_Movimentacao")
    ws_mov_an.append(["IdPDV", "Data", "Tipo", "Histórico", "FormaPagto", "Bandeira", "Qtde Parcelas", "Valor Cheio", "Centro de Custo", "Saldo", "Horário", "Data Registro", "Usuário", "Exportado?", "TipoForma"])
    ws_mov_an.append(["PDV-AN-1", date(2025, 1, 23), "Entrada", "DELIVERY", "Pix", None, 1, 100.0, "Ananindeua", 100.0, "20:00:00", date(2025, 1, 23), "Operação Ananindeua", "Sim", "Pix"])

    ws_fin_an = wb_an.create_sheet("Tb_Financeira")
    ws_fin_an.append(["IdFinanceiro", "Data Vcto", "Data Pagto", "Tipo", "Classificação", "Descrição", "Valor Previsto", "Valor Realizado", "Banco", "Situação", "IdParcelamento", "Interessado", "Centro de Custo"])
    ws_fin_an.append(["FIN-AN-1", date(2025, 1, 23), date(2025, 1, 23), "Recebimento", "01.05. Pix QRS", "Movimentação em pix na unidade", 100.0, 100.0, "Itaú Ananindeua", "Pago", None, "CLIENTE GERAL", "Ananindeua"])

    ws_ifood_an = wb_an.create_sheet("Tb_Ifood")
    ws_ifood_an.append(["Id_Ifood", "Data", "Hora", "Forma Pagto", "Valor Bruto", "Valor Líquido", "Status", "Data Recebimento"])
    ws_ifood_an.append(["IF-AN-1", date(2025, 1, 23), "18:00:00", "credito_vista", 60.0, 52.8, "CONCILIADO", date(2025, 1, 30)])

    wb_an.save(path_ananindeua)
    wb_an.close()

    # Create Marco Delivery (iFood file)
    wb_mar = openpyxl.Workbook()
    ws_user_mar = wb_mar.active
    ws_user_mar.title = "a.Usuario"
    ws_user_mar.append(["Usuário", "Email", "Função"])
    ws_user_mar.append(["Link Financeiro", "linkfinanceirooficial@gmail.com", "Master"])

    ws_class_mar = wb_mar.create_sheet("CadClassificacao")
    ws_class_mar.append(["Classificação", "Descrição"])
    ws_class_mar.append(["01.04. IFood", "Receitas do iFood"])

    ws_bank_mar = wb_mar.create_sheet("Tb_Banco")
    ws_bank_mar.append(["Banco", "Saldo Inicial", "Saldo Final"])
    ws_bank_mar.append(["PDV Ifood", 0, 0])
    ws_bank_mar.append(["Itaú Ifood Marco", 0, 0])

    ws_tx_mar = wb_mar.create_sheet("TxCartoes")
    ws_tx_mar.append(["IT", "Tipo", "Parcelas", "Bandeira", "Taxa", "Dias"])

    ws_mov_mar = wb_mar.create_sheet("Tb_Movimentacao")
    ws_mov_mar.append(["IdPDV", "Data", "Tipo", "Histórico", "FormaPagto", "Bandeira", "Qtde Parcelas", "Valor Cheio", "Centro de Custo", "Saldo", "Horário", "Data Registro", "Usuário", "Exportado?", "TipoForma"])

    ws_fin_mar = wb_mar.create_sheet("Tb_Financeira")
    ws_fin_mar.append(["IdFinanceiro", "Data Vcto", "Data Pagto", "Tipo", "Classificação", "Descrição", "Valor Previsto", "Valor Realizado", "Banco", "Situação", "IdParcelamento", "Interessado", "Centro de Custo"])
    # Consolidated repasse iFood
    ws_fin_mar.append(["FIN-MAR-1", date(2025, 1, 23), date(2025, 1, 23), "Recebimento", "01.04. IFood", "Repasse iFood", 1000.0, 1000.0, "Itaú Ifood Marco", "Pago", None, "CLIENTE GERAL", "Marco"])

    ws_ifood_mar = wb_mar.create_sheet("Tb_Ifood")
    ws_ifood_mar.append(["Id_Ifood", "Data", "Hora", "Forma Pagto", "Valor Bruto", "Valor Líquido", "Status", "Data Recebimento"])
    ws_ifood_mar.append(["IF-MAR-1", date(2025, 1, 23), "18:00:00", "credito_vista", 70.0, 61.6, "CONCILIADO", date(2025, 1, 30)])

    wb_mar.save(path_ifood_marco)
    wb_mar.close()

    return {
        "Umarizal": str(path_umarizal),
        "Ananindeua": str(path_ananindeua),
        "MarcoDelivery": str(path_ifood_marco)
    }

def test_importacao_complete_flow(session: Session, mock_excel_files):
    from scripts.import_pizza_fabio import import_all_data

    # Run the import process
    import_all_data(
        db=session,
        path_umarizal=mock_excel_files["Umarizal"],
        path_ananindeua=mock_excel_files["Ananindeua"],
        path_ifood_marco=mock_excel_files["MarcoDelivery"],
        dry_run=False
    )

    # 1. Assert Companies exist
    companies = session.exec(select(Empresa)).all()
    assert len(companies) == 3
    names = {c.nome_fantasia for c in companies}
    assert "Pizza Fábio Umarizal" in names
    assert "Pizza Fábio Ananindeua" in names
    assert "Pizza Fábio Marco" in names

    # 2. Assert Accounts exist and Itaú Ananindeua has offset
    account_ananindeua_itau = session.exec(
        select(Conta)
        .join(Empresa)
        .where(Empresa.nome_fantasia == "Pizza Fábio Ananindeua", Conta.nome == "Itaú Ananindeua")
    ).first()
    assert account_ananindeua_itau is not None
    assert account_ananindeua_itau.saldo_inicial == Decimal("49900.00")

    # Umarizal accounts
    umarizal_accounts = session.exec(
        select(Conta)
        .join(Empresa)
        .where(Empresa.nome_fantasia == "Pizza Fábio Umarizal")
    ).all()
    assert len(umarizal_accounts) >= 3

    # 3. Assert Users exist
    users = session.exec(select(Usuario)).all()
    assert len(users) >= 4

    # 4. Assert PlanoContas entries exist
    categories = session.exec(select(PlanoContas)).all()
    assert len(categories) > 0

    # 5. Assert card rules exist
    rules = session.exec(select(RegraCartao)).all()
    assert len(rules) > 0

    # 6. Assert PDV Sales were imported
    sales = session.exec(select(Lancamento).where(Lancamento.origem == "PDV")).all()
    # Umarizal and Marco physical should have PDV sales
    assert len(sales) == 4
    # PDV-1 in Umarizal: Dinheiro, 100.0, status PAGO
    pdv_1 = session.exec(select(Lancamento).where(Lancamento.import_hash == "legacy-PDV-1")).first()
    assert pdv_1 is not None
    assert pdv_1.valor_previsto == Decimal("100.00")
    assert pdv_1.status == "PAGO"
    assert pdv_1.origem == "PDV"

    # PDV-3 in Marco Salão: Crédito à vista, 120.0, status EM ABERTO
    pdv_3 = session.exec(select(Lancamento).where(Lancamento.import_hash == "legacy-PDV-3")).first()
    assert pdv_3 is not None
    assert pdv_3.valor_previsto == Decimal("120.00")
    assert pdv_3.status == "EM ABERTO"

    # Assert new operational tables are populated
    vendas_op = session.exec(select(PdvVenda)).all()
    assert len(vendas_op) == 4
    venda_item_op = session.exec(select(PdvVendaItem)).all()
    assert len(venda_item_op) == 4
    movs_op = session.exec(select(PdvMovimentacao)).all()
    assert len(movs_op) == 4

    # 7. Assert iFood transactions were imported
    ifood_txs = session.exec(select(PdvIfoodLancamento)).all()
    assert len(ifood_txs) == 3

    # 8. Assert general Financeiro rows were imported with deduplication
    finance_rows = session.exec(select(Lancamento).where(Lancamento.origem == "WEB")).all()
    # Umarizal should have:
    # FIN-1 (Venda antiga, Recebimento, 50.0) -> Imported
    # FIN-2 (Pix, 93.0) -> Skipped, because of PDV-2 (93.0, Pix) on same date
    # FIN-3 (Despesa, 150.0 in Marco) -> Imported under Marco Salão
    
    fin_1 = session.exec(select(Lancamento).where(Lancamento.import_hash == "legacy-FIN-1")).first()
    assert fin_1 is not None
    assert fin_1.valor_previsto == Decimal("50.00")

    fin_2 = session.exec(select(Lancamento).where(Lancamento.import_hash == "legacy-FIN-2")).first()
    assert fin_2 is not None
    assert fin_2.transferencia_grupo_id is not None

    fin_3 = session.exec(select(Lancamento).where(Lancamento.import_hash == "legacy-FIN-3")).first()
    assert fin_3 is not None
    assert fin_3.valor_previsto == Decimal("150.00")
    assert fin_3.tipo == "DESPESA"

    # 9. Test Idempotency: run import again and verify no duplicates are created
    all_lancamentos_before = session.exec(select(Lancamento)).all()
    count_before = len(all_lancamentos_before)

    import_all_data(
        db=session,
        path_umarizal=mock_excel_files["Umarizal"],
        path_ananindeua=mock_excel_files["Ananindeua"],
        path_ifood_marco=mock_excel_files["MarcoDelivery"],
        dry_run=False
    )
    
    # Count of all lancamentos should remain exactly the same
    all_lancamentos_after = session.exec(select(Lancamento)).all()
    assert len(all_lancamentos_after) == count_before
