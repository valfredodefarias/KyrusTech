from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import re
from typing import Optional
import xml.etree.ElementTree as ET


@dataclass
class NFeParcela:
    index: int
    numero_label: str
    data_vencimento: date
    valor: Decimal


@dataclass
class NFeDocumento:
    chave_nfe: str
    numero_nfe: str
    tipo_lancamento: str
    data_emissao: date
    valor_total: Decimal
    natureza_operacao: str
    emitente_nome: str
    emitente_documento: str
    destinatario_nome: str
    destinatario_documento: str
    entidade_referencia_nome: str
    entidade_referencia_documento: str
    cfops: list[str]
    ncms: list[str]
    parcelas: list[NFeParcela]


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
    return re.sub(r"[^0-9]", "", value or "")


def _parse_decimal(value: str) -> Decimal:
    text = str(value or "").strip()
    if not text:
        raise ValueError("Valor decimal vazio no XML")

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
        raise ValueError(f"Valor decimal invalido no XML: {value}") from exc


def _parse_date(value: str) -> date:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("Data obrigatoria ausente no XML")

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

    raise ValueError(f"Data invalida no XML: {value}")


def _extract_chave_nfe(inf_nfe: ET.Element, root: ET.Element) -> str:
    chave = _find_text(root, "protNFe/infProt/chNFe")
    if chave:
        return _only_digits(chave)

    inf_id = str(inf_nfe.attrib.get("Id") or "").strip()
    if inf_id.upper().startswith("NFE"):
        return _only_digits(inf_id[3:])

    return _only_digits(inf_id)


def parse_nfe_xml(xml_content: bytes) -> NFeDocumento:
    if not xml_content:
        raise ValueError("Arquivo XML vazio")

    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as exc:
        raise ValueError("XML NF-e invalido ou corrompido") from exc

    _strip_xml_namespaces(root)

    inf_nfe = root.find("NFe/infNFe")
    if inf_nfe is None:
        inf_nfe = root.find("infNFe")
    if inf_nfe is None:
        raise ValueError("Estrutura NF-e nao encontrada (infNFe ausente)")

    ide = inf_nfe.find("ide")
    emit = inf_nfe.find("emit")
    dest = inf_nfe.find("dest")
    total = inf_nfe.find("total/ICMSTot")

    numero_nfe = _find_first_text(ide, ("nNF",))
    if not numero_nfe:
        raise ValueError("Numero da NF-e (nNF) nao encontrado")

    tp_nf = _find_first_text(ide, ("tpNF",))
    tipo_lancamento = "RECEITA" if tp_nf == "1" else "DESPESA"

    data_emissao_texto = _find_first_text(ide, ("dhEmi", "dEmi"))
    data_emissao = _parse_date(data_emissao_texto)

    chave_nfe = _extract_chave_nfe(inf_nfe, root)
    if not chave_nfe:
        raise ValueError("Chave da NF-e nao encontrada")

    natureza_operacao = _find_first_text(ide, ("natOp",))

    emitente_nome = _find_first_text(emit, ("xNome", "xFant"))
    emitente_documento = _only_digits(_find_first_text(emit, ("CNPJ", "CPF")))

    destinatario_nome = _find_first_text(dest, ("xNome", "xFant"))
    destinatario_documento = _only_digits(_find_first_text(dest, ("CNPJ", "CPF")))

    entidade_referencia_nome = destinatario_nome if tipo_lancamento == "RECEITA" else emitente_nome
    entidade_referencia_documento = destinatario_documento if tipo_lancamento == "RECEITA" else emitente_documento

    cfops: list[str] = []
    ncms: list[str] = []
    total_itens = Decimal("0")

    for det in inf_nfe.findall("det"):
        prod = det.find("prod")
        if prod is None:
            continue

        cfop = _find_first_text(prod, ("CFOP",))
        if cfop and cfop not in cfops:
            cfops.append(cfop)

        ncm = _find_first_text(prod, ("NCM",))
        if ncm and ncm not in ncms:
            ncms.append(ncm)

        v_prod = _find_first_text(prod, ("vProd",))
        if v_prod:
            try:
                total_itens += _parse_decimal(v_prod)
            except ValueError:
                continue

    valor_total = Decimal("0")
    total_xml = _find_first_text(total, ("vNF",))
    if total_xml:
        valor_total = _parse_decimal(total_xml)
    elif total_itens > 0:
        valor_total = total_itens

    duplicatas = inf_nfe.findall("cobr/dup")
    parcelas: list[NFeParcela] = []

    if duplicatas:
        for index, dup in enumerate(duplicatas, start=1):
            numero_label = _find_first_text(dup, ("nDup",)) or str(index)
            data_vencimento = _parse_date(_find_first_text(dup, ("dVenc",)))
            valor = _parse_decimal(_find_first_text(dup, ("vDup",)))
            parcelas.append(
                NFeParcela(
                    index=index,
                    numero_label=numero_label,
                    data_vencimento=data_vencimento,
                    valor=valor,
                )
            )
    else:
        if valor_total <= 0:
            raise ValueError("Nao foi possivel identificar o valor total da NF-e")
        parcelas.append(
            NFeParcela(
                index=1,
                numero_label="1",
                data_vencimento=data_emissao,
                valor=valor_total,
            )
        )

    if valor_total <= 0:
        valor_total = sum((item.valor for item in parcelas), Decimal("0"))

    return NFeDocumento(
        chave_nfe=chave_nfe,
        numero_nfe=numero_nfe,
        tipo_lancamento=tipo_lancamento,
        data_emissao=data_emissao,
        valor_total=valor_total,
        natureza_operacao=natureza_operacao,
        emitente_nome=emitente_nome,
        emitente_documento=emitente_documento,
        destinatario_nome=destinatario_nome,
        destinatario_documento=destinatario_documento,
        entidade_referencia_nome=entidade_referencia_nome,
        entidade_referencia_documento=entidade_referencia_documento,
        cfops=cfops,
        ncms=ncms,
        parcelas=parcelas,
    )
