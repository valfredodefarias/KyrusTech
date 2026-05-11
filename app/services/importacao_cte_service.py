from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import re
from decimal import Decimal, InvalidOperation
from typing import Optional
import xml.etree.ElementTree as ET


@dataclass
class CTeDocumento:
    chave_cte: str
    numero_cte: str
    data_emissao: date
    valor_total: Decimal
    transportadora_nome: str
    transportadora_documento: str
    nfe_referenciada_chave: str


def _strip_xml_namespaces(root: ET.Element) -> None:
    for elem in root.iter():
        if isinstance(elem.tag, str) and "}" in elem.tag:
            elem.tag = elem.tag.split("}", 1)[1]


def _find_text(node: Optional[ET.Element], path: str) -> str:
    if node is None:
        return ""
    found = node.find(path)
    if found is None or found.text is None:
        return ""
    return str(found.text).strip()


def _find_first_text(node: Optional[ET.Element], paths: tuple[str, ...]) -> str:
    for path in paths:
        value = _find_text(node, path)
        if value:
            return value
    return ""


def _only_digits(value: str) -> str:
    return re.sub(r"[^0-9]", "", str(value or ""))


def _parse_decimal(value: str) -> Decimal:
    text = str(value or "").strip()
    if not text:
        return Decimal("0")

    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")

    try:
        return Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"Valor decimal invalido no XML do CTe: {value}") from exc


def _parse_date(value: str) -> date:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("Data obrigatoria ausente no XML do CTe")

    iso_candidate = raw
    if iso_candidate.endswith("Z"):
        iso_candidate = iso_candidate[:-1] + "+00:00"

    try:
        if "T" in iso_candidate:
            return datetime.fromisoformat(iso_candidate).date()
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue

    raise ValueError(f"Data invalida no XML do CTe: {value}")


def parse_cte_xml(xml_content: bytes) -> CTeDocumento:
    if not xml_content:
        raise ValueError("Arquivo XML do CTe vazio")

    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as exc:
        raise ValueError("XML CTe invalido ou corrompido") from exc

    _strip_xml_namespaces(root)

    inf_cte = root.find("CTe/infCte") or root.find("infCte")
    if inf_cte is None:
        raise ValueError("Estrutura CTe nao encontrada (infCte ausente)")

    ide = inf_cte.find("ide")
    emit = inf_cte.find("emit")
    vprest = inf_cte.find("vPrest")
    imp = inf_cte.find("imp")

    chave_via_id = str(inf_cte.attrib.get("Id") or "").strip()
    chave_cte = _only_digits(chave_via_id[3:] if chave_via_id.upper().startswith("CTE") else chave_via_id)
    if not chave_cte:
        chave_cte = _only_digits(_find_text(root, "protCTe/infProt/chCTe"))
    if not chave_cte:
        raise ValueError("Chave do CTe nao encontrada")

    numero_cte = _find_first_text(ide, ("nCT",))
    if not numero_cte:
        raise ValueError("Numero do CTe (nCT) nao encontrado")

    data_emissao = _parse_date(_find_first_text(ide, ("dhEmi", "dEmi")))

    valor_total = _parse_decimal(_find_first_text(vprest, ("vTPrest", "vRec")))
    if valor_total <= 0:
        valor_total = _parse_decimal(_find_first_text(imp, ("vTotDFe", "vTotTrib")))
    if valor_total <= 0:
        raise ValueError("Valor total do CTe nao encontrado")

    transportadora_nome = _find_first_text(emit, ("xNome", "xFant"))
    if not transportadora_nome:
        transportadora_nome = "Transportadora"

    transportadora_documento = _only_digits(_find_first_text(emit, ("CNPJ", "CPF")))

    nfe_referenciada_chave = ""
    inf_doc = inf_cte.find("infCTeNorm/infDoc")
    if inf_doc is not None:
        inf_nfe = inf_doc.find("infNFe")
        if inf_nfe is not None:
            nfe_referenciada_chave = _only_digits(_find_first_text(inf_nfe, ("chave",)))

    if not nfe_referenciada_chave:
        raise ValueError("CTe sem chave de NF-e referenciada")

    return CTeDocumento(
        chave_cte=chave_cte,
        numero_cte=str(numero_cte).strip(),
        data_emissao=data_emissao,
        valor_total=valor_total,
        transportadora_nome=str(transportadora_nome).strip(),
        transportadora_documento=transportadora_documento,
        nfe_referenciada_chave=nfe_referenciada_chave,
    )
