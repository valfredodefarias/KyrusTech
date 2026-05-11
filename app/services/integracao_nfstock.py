from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
import os
import re
import shutil
import time
import uuid
from typing import Any, Optional

from loguru import logger
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException
from sqlmodel import Session, select

from app.models.anexo_lancamento import AnexoLancamento
from app.models.empresa import Empresa
from app.models.integracao_bancaria import IntegracaoBancaria
from app.models.lancamento import Lancamento
from app.models.plano_contas import PlanoContas
from app.services.importacao_nfe_service import parse_nfe_xml
from app.api.v1.endpoints.importacao_nfe import (
    NfeParcelaConfirmar,
    NfeConfirmarRequest,
    NfeItemPersistencia,
    confirmar_importacao_nfe,
    _buscar_categoria_sugerida,
    _only_digits,
)


@dataclass
class NfstockConfig:
    username: str
    password: str
    select_company: bool
    company_name: str
    login_url: str = "https://nfstock.alterdata.com.br/"
    target_url: str = "https://nfstock.alterdata.com.br/Nfe/Recebidas"


@dataclass
class NfstockRow:
    numero: str
    documento: str


def _extract_config(integracao: IntegracaoBancaria) -> dict[str, Any]:
    from app.core.encryption import decrypt_dict

    raw = str(integracao.configuracao_adicional or "").strip()
    if not raw:
        return {}
    try:
        payload = decrypt_dict(raw)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def get_nfstock_config(integracao: IntegracaoBancaria) -> NfstockConfig:
    from app.core.encryption import decrypt_token

    payload = _extract_config(integracao)
    password = decrypt_token(str(integracao.token_criptografado or "").strip())

    username = str(payload.get("username") or "").strip()
    if not username:
        raise ValueError("Configuração NFStock inválida: usuário ausente")

    return NfstockConfig(
        username=username,
        password=password,
        select_company=bool(payload.get("select_company", False)),
        company_name=str(payload.get("company_name") or "").strip(),
        login_url=str(payload.get("login_url") or "https://nfstock.alterdata.com.br/").strip(),
        target_url=str(payload.get("target_url") or "https://nfstock.alterdata.com.br/Nfe/Recebidas").strip(),
    )


def _next_daily_1am_utc() -> datetime:
    now = datetime.utcnow()
    next_run = now.replace(hour=1, minute=0, second=0, microsecond=0)
    if next_run <= now:
        next_run = next_run + timedelta(days=1)
    return next_run


def set_nfstock_schedule(integracao: IntegracaoBancaria) -> None:
    integracao.sincronizar_automaticamente = True
    integracao.intervalo_sincronizacao_minutos = 24 * 60
    integracao.proxima_sincronizacao = _next_daily_1am_utc()


def _build_driver(download_path: str) -> webdriver.Chrome:
    options = webdriver.ChromeOptions()
    options.binary_location = os.getenv("CHROME_BIN", "/usr/bin/chromium")
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-setuid-sandbox")
    options.add_argument("--no-zygote")
    options.add_argument("--single-process")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-extensions")
    options.add_experimental_option("excludeSwitches", ["enable-logging"])
    options.add_experimental_option("prefs", {
        "download.default_directory": download_path,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
    })

    # 1) Prioriza binário do sistema no container (mais estável em produção)
    local_driver_path = os.getenv("CHROMEDRIVER_PATH", "/usr/bin/chromedriver")
    if os.path.exists(local_driver_path):
        try:
            return webdriver.Chrome(service=ChromeService(local_driver_path), options=options)
        except Exception as exc:
            logger.warning("Falha ao iniciar chromedriver local ({}): {}", local_driver_path, exc)

    # 2) Tenta webdriver-manager (ambiente dev)
    try:
        from webdriver_manager.chrome import ChromeDriverManager
        return webdriver.Chrome(service=ChromeService(ChromeDriverManager().install()), options=options)
    except Exception as exc:
        logger.warning("Falha ao usar ChromeDriverManager no NFStock: {}. Tentando PATH.", exc)

    # 3) Fallback final: PATH
    try:
        return webdriver.Chrome(options=options)
    except Exception as exc:
        raise RuntimeError(
            "Não foi possível iniciar o navegador para sincronização NFStock. "
            "Verifique se Chromium/Chrome e chromedriver estão instalados no container "
            "e com versões compatíveis."
        ) from exc


def _extract_digits_document(text: str) -> str:
    # Busca CNPJ (14) primeiro, depois CPF (11)
    cleaned = re.sub(r"\D", "", str(text or ""))
    cnpj_match = re.search(r"\d{14}", cleaned)
    if cnpj_match:
        return cnpj_match.group(0)
    cpf_match = re.search(r"\d{11}", cleaned)
    if cpf_match:
        return cpf_match.group(0)
    return ""


def _extract_rows(driver: webdriver.Chrome, wait: WebDriverWait) -> list[NfstockRow]:
    wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, "tbody tr")))
    rows = driver.find_elements(By.CSS_SELECTOR, "tbody tr")
    result: list[NfstockRow] = []

    for row in rows:
        cells = row.find_elements(By.CSS_SELECTOR, "td")
        numero = ""
        if len(cells) >= 3:
            numero = str(cells[2].text or "").strip()
        if not numero:
            text = row.text
            match = re.search(r"\b(\d{1,9})\b", text)
            numero = match.group(1) if match else ""

        documento = _extract_digits_document(row.text)
        if numero:
            result.append(NfstockRow(numero=str(int(numero)), documento=documento))

    return result


def _wait_new_download(download_dir: str, previous_files: set[str], timeout_seconds: int = 45) -> Optional[str]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        current = {f for f in os.listdir(download_dir)}
        new_files = [f for f in current - previous_files if not f.endswith(".crdownload")]
        if new_files:
            # mais recente
            new_files.sort(key=lambda name: os.path.getctime(os.path.join(download_dir, name)), reverse=True)
            return os.path.join(download_dir, new_files[0])
        time.sleep(0.4)
    return None


def _download_note_files(driver: webdriver.Chrome, wait: WebDriverWait, download_dir: str, nf_number: str) -> tuple[Optional[str], Optional[str]]:
    xpath_row = f"//tr[td[3][normalize-space()='{nf_number}']]"
    table_row = wait.until(EC.presence_of_element_located((By.XPATH, xpath_row)))

    download_button = table_row.find_element(By.CSS_SELECTOR, "button.download-nota")
    driver.execute_script("arguments[0].click();", download_button)
    time.sleep(0.8)

    xml_path = None
    pdf_path = None

    # XML
    before = set(os.listdir(download_dir))
    xml_link = wait.until(EC.element_to_be_clickable((By.ID, "link-download-xml")))
    driver.execute_script("arguments[0].click();", xml_link)
    xml_path = _wait_new_download(download_dir, before, timeout_seconds=50)

    # PDF - tenta seletor por ID e CSS alternativo
    before_pdf = set(os.listdir(download_dir))
    pdf_link = None
    for locator in [
        (By.ID, "link-download-pdf"),
        (By.CSS_SELECTOR, "#link-download-pdf"),
        (By.CSS_SELECTOR, "a#link-download-pdf"),
    ]:
        try:
            pdf_link = WebDriverWait(driver, 8).until(EC.element_to_be_clickable(locator))
            break
        except TimeoutException:
            continue

    if pdf_link is not None:
        driver.execute_script("arguments[0].click();", pdf_link)
        pdf_path = _wait_new_download(download_dir, before_pdf, timeout_seconds=50)

    return xml_path, pdf_path


def _nfe_exists_by_number_document(db: Session, *, empresa_id: int, numero: str, documento: str) -> bool:
    numero_nf = str(int(str(numero or "0"))) if str(numero or "").strip() else ""
    doc = _only_digits(documento or "")
    if not numero_nf:
        return False

    query = select(Lancamento.id).where(
        Lancamento.empresa_id == empresa_id,
        Lancamento.is_deleted == False,
        Lancamento.origem == "NFE_XML",
        Lancamento.observacao.ilike(f"%NF-e {numero_nf}%"),
    )

    if doc:
        query = query.where(Lancamento.observacao.ilike(f"%EmitenteDoc {doc}%"))

    return db.exec(query).first() is not None


def _save_pdf_anexos(db: Session, *, empresa_id: int, id_parcelamento: str, lancamento_ids: list[int], pdf_path: str) -> None:
    if not pdf_path or not os.path.exists(pdf_path):
        return

    src = Path(pdf_path)
    group_safe = re.sub(r"[^A-Za-z0-9_-]+", "_", id_parcelamento).strip("_") or "nfe"
    destino_dir = Path("static/uploads/lancamentos") / str(empresa_id) / "nfstock" / group_safe
    destino_dir.mkdir(parents=True, exist_ok=True)

    nome_storage = f"{uuid.uuid4().hex}.pdf"
    destino = destino_dir / nome_storage
    shutil.copyfile(src, destino)

    tamanho = int(destino.stat().st_size)
    url_relativa = f"/static/uploads/lancamentos/{empresa_id}/nfstock/{group_safe}/{nome_storage}"

    for lanc_id in lancamento_ids:
        exists = db.exec(
            select(AnexoLancamento.id).where(
                AnexoLancamento.empresa_id == empresa_id,
                AnexoLancamento.is_deleted == False,
                AnexoLancamento.lancamento_id == lanc_id,
                AnexoLancamento.tipo == "NOTA_FISCAL",
                AnexoLancamento.nome_arquivo == src.name,
            )
        ).first()
        if exists:
            continue

        db.add(AnexoLancamento(
            nome_arquivo=src.name,
            url=url_relativa,
            tipo="NOTA_FISCAL",
            tamanho_bytes=tamanho,
            content_type="application/pdf",
            lancamento_id=lanc_id,
            empresa_id=empresa_id,
        ))


def _build_confirm_request(db: Session, *, empresa_id: int, centro_custo_id: Optional[int], xml_bytes: bytes) -> NfeConfirmarRequest:
    doc = parse_nfe_xml(xml_bytes)

    empresa = db.exec(
        select(Empresa).where(Empresa.id == empresa_id, Empresa.is_deleted == False)
    ).first()

    categoria_id: Optional[int] = None
    if empresa and getattr(empresa, "categoria_nfe_fornecedores_id", None):
        categoria_id = int(empresa.categoria_nfe_fornecedores_id)
    else:
        sugestao = _buscar_categoria_sugerida(
            db,
            empresa_id=empresa_id,
            tipo_lancamento=doc.tipo_lancamento,
            natureza_operacao=doc.natureza_operacao,
            cfops=doc.cfops,
            ncms=doc.ncms,
        )
        if sugestao and sugestao.id:
            categoria_id = int(sugestao.id)

    if not categoria_id:
        categoria = db.exec(
            select(PlanoContas).where(
                PlanoContas.empresa_id == empresa_id,
                PlanoContas.is_deleted == False,
                PlanoContas.permite_lancamentos == True,
                PlanoContas.eh_cabecalho == False,
                PlanoContas.oculta == False,
                PlanoContas.tipo.ilike("D%"),
                PlanoContas.nome.ilike("%fornecedor%"),
            )
        ).first()
        if categoria and categoria.id:
            categoria_id = int(categoria.id)

    if not categoria_id:
        raise ValueError("Categoria financeira não configurada para importação NF-e")

    itens = [
        NfeItemPersistencia(
            descricao=item.descricao,
            quantidade=float(item.quantidade),
            valor_unitario=float(item.valor_unitario),
            valor_total=float(item.valor_total),
            cfop=item.cfop or None,
            ncm=item.ncm or None,
        )
        for item in doc.itens
    ]

    parcelas = [
        NfeParcelaConfirmar(
            indice=parcela.index,
            numero_parcela=parcela.numero_label,
            data_vencimento=parcela.data_vencimento,
            valor=Decimal(parcela.valor),
            descricao=f"NFE: ({doc.numero_nfe})",
            plano_contas_id=categoria_id,
        )
        for parcela in doc.parcelas
    ]

    return NfeConfirmarRequest(
        chave_nfe=doc.chave_nfe,
        numero_nfe=doc.numero_nfe,
        tipo_lancamento="DESPESA",
        situacao="AGUARDANDO_ENTREGA",
        natureza_operacao=doc.natureza_operacao or None,
        destino_compra="ESTOQUE",
        valor_frete=doc.valor_frete,
        cfop=doc.cfops[0] if doc.cfops else None,
        data_emissao=doc.data_emissao,
        emitente_nome=doc.emitente_nome,
        emitente_documento=doc.emitente_documento,
        emitente_nome_fantasia=doc.emitente_nome_fantasia or None,
        centro_custo_id=centro_custo_id,
        plano_contas_id=categoria_id,
        observacao=f"NF-e {doc.numero_nfe} | Chave {doc.chave_nfe}",
        itens=itens,
        parcelas=parcelas,
    )


def sincronizar_nfstock(
    *,
    db: Session,
    integracao: IntegracaoBancaria,
    dry_run: bool = False,
) -> dict[str, Any]:
    empresa_id = int(integracao.empresa_id)
    centro_custo_id = int(integracao.centro_custo_id) if integracao.centro_custo_id is not None else None
    cfg = get_nfstock_config(integracao)

    download_dir = Path("/tmp") / f"kyrus_nfstock_{empresa_id}_{integracao.id}_{int(time.time())}"
    download_dir.mkdir(parents=True, exist_ok=True)

    try:
        driver = _build_driver(str(download_dir))
    except (WebDriverException, RuntimeError) as exc:
        logger.error("[NFSTOCK] Falha ao iniciar WebDriver para integração {}: {}", integracao.id, exc)
        raise RuntimeError(
            "Falha ao iniciar navegador da integração NFStock no servidor. "
            "Confirme a instalação de Chromium/Chrome e chromedriver no ambiente."
        ) from exc
    wait = WebDriverWait(driver, 30)

    baixadas = 0
    importadas = 0
    puladas = 0

    try:
        driver.get(cfg.login_url)
        wait.until(EC.presence_of_element_located((By.ID, "login-cliente"))).send_keys(cfg.username)
        driver.find_element(By.ID, "senha-cliente").send_keys(cfg.password)
        driver.find_element(By.CLASS_NAME, "entrar-login").click()

        driver.get(cfg.target_url)

        if cfg.select_company and cfg.company_name:
            dropdown = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "#id_chosen a.chosen-single")))
            dropdown.click()
            opcao = wait.until(EC.element_to_be_clickable((By.XPATH, f"//li[text()='{cfg.company_name}']")))
            opcao.click()

        time.sleep(2)
        notas = _extract_rows(driver, wait)
        logger.info("[NFSTOCK] {} notas listadas para integração {}", len(notas), integracao.id)

        for row in notas:
            if _nfe_exists_by_number_document(db, empresa_id=empresa_id, numero=row.numero, documento=row.documento):
                puladas += 1
                continue

            if dry_run:
                baixadas += 1
                continue

            try:
                xml_path, pdf_path = _download_note_files(driver, wait, str(download_dir), row.numero)
                if not xml_path or not os.path.exists(xml_path):
                    logger.warning("[NFSTOCK] XML não encontrado para NF {}", row.numero)
                    continue

                with open(xml_path, "rb") as f:
                    xml_bytes = f.read()

                req = _build_confirm_request(db, empresa_id=empresa_id, centro_custo_id=centro_custo_id, xml_bytes=xml_bytes)

                # Checagem extra por número + documento após parse
                if _nfe_exists_by_number_document(
                    db,
                    empresa_id=empresa_id,
                    numero=req.numero_nfe,
                    documento=req.emitente_documento or "",
                ):
                    puladas += 1
                    continue

                resp = confirmar_importacao_nfe(request=req, db=db, empresa_id=empresa_id)
                baixadas += 1
                importadas += 1

                if pdf_path and os.path.exists(pdf_path):
                    _save_pdf_anexos(
                        db,
                        empresa_id=empresa_id,
                        id_parcelamento=resp.id_parcelamento,
                        lancamento_ids=resp.lancamento_ids,
                        pdf_path=pdf_path,
                    )
                    db.commit()

            except Exception as exc:
                logger.error("[NFSTOCK] Falha ao importar NF {} integração {}: {}", row.numero, integracao.id, exc)

        integracao.ultima_sincronizacao = datetime.utcnow()
        set_nfstock_schedule(integracao)
        db.add(integracao)
        db.commit()

        return {
            "sucesso": True,
            "integracao_id": integracao.id,
            "notas_listadas": len(notas),
            "notas_baixadas": baixadas,
            "notas_importadas": importadas,
            "notas_puladas": puladas,
            "proxima_sincronizacao": integracao.proxima_sincronizacao.isoformat() if integracao.proxima_sincronizacao else None,
        }
    finally:
        try:
            driver.quit()
        except Exception:
            pass
        shutil.rmtree(download_dir, ignore_errors=True)
