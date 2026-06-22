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
class NFeItem:
    descricao: str
    quantidade: Decimal
    valor_unitario: Decimal
    valor_total: Decimal
    cfop: str
    ncm: str
    c_prod: str = ""
    c_ean: str = ""
    cest: str = ""


@dataclass
class NFeDocumento:
    chave_nfe: str
    numero_nfe: str
    serie: str
    tipo_lancamento: str
    data_emissao: date
    valor_total: Decimal
    valor_produtos: Decimal
    valor_frete: Decimal
    valor_seguro: Decimal
    valor_desconto: Decimal
    valor_outros: Decimal
    natureza_operacao: str
    emitente_nome: str
    emitente_nome_fantasia: str
    emitente_documento: str
    emitente_cep: str
    emitente_logradouro: str
    emitente_numero: str
    emitente_complemento: str
    emitente_bairro: str
    emitente_cidade: str
    emitente_uf: str
    emitente_telefone: str
    destinatario_nome: str
    destinatario_documento: str
    entidade_referencia_nome: str
    entidade_referencia_documento: str
    cfops: list[str]
    ncms: list[str]
    itens: list[NFeItem]
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


def _normalize_text(value: str) -> str:
    text = str(value or "").lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _infer_tipo_lancamento(
    *,
    tp_nf: str,
    empresa_cnpj: str,
    emitente_documento: str,
    destinatario_documento: str,
    cfops: list[str],
    natureza_operacao: str,
) -> str:
    return "DESPESA"


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


def parse_nfe_xml(xml_content: bytes, empresa_cnpj: str = "") -> NFeDocumento:
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

    serie = _find_first_text(ide, ("serie",))

    tp_nf = _find_first_text(ide, ("tpNF",))

    data_emissao_texto = _find_first_text(ide, ("dhEmi", "dEmi"))
    data_emissao = _parse_date(data_emissao_texto)

    chave_nfe = _extract_chave_nfe(inf_nfe, root)
    if not chave_nfe:
        raise ValueError("Chave da NF-e nao encontrada")

    natureza_operacao = _find_first_text(ide, ("natOp",))

    emitente_nome = _find_first_text(emit, ("xNome", "xFant"))
    emitente_nome_fantasia = _find_first_text(emit, ("xFant",))
    emitente_documento = _only_digits(_find_first_text(emit, ("CNPJ", "CPF")))

    ender_emit = emit.find("enderEmit") if emit is not None else None
    emitente_cep = _find_first_text(ender_emit, ("CEP",))
    emitente_logradouro = _find_first_text(ender_emit, ("xLgr",))
    emitente_numero = _find_first_text(ender_emit, ("nro",))
    emitente_complemento = _find_first_text(ender_emit, ("xCpl",))
    emitente_bairro = _find_first_text(ender_emit, ("xBairro",))
    emitente_cidade = _find_first_text(ender_emit, ("xMun",))
    emitente_uf = _find_first_text(ender_emit, ("UF",))
    emitente_telefone = _only_digits(_find_first_text(ender_emit, ("fone",)))

    destinatario_nome = _find_first_text(dest, ("xNome", "xFant"))
    destinatario_documento = _only_digits(_find_first_text(dest, ("CNPJ", "CPF")))

    cfops: list[str] = []
    ncms: list[str] = []
    itens: list[NFeItem] = []
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

        c_prod = _find_first_text(prod, ("cProd",))
        c_ean = _find_first_text(prod, ("cEAN",))
        cest = _find_first_text(prod, ("CEST",))

        x_prod = _find_first_text(prod, ("xProd",))
        q_com = _find_first_text(prod, ("qCom",))
        v_un_com = _find_first_text(prod, ("vUnCom",))
        v_prod = _find_first_text(prod, ("vProd",))
        if v_prod:
            try:
                valor_item = _parse_decimal(v_prod)
                total_itens += valor_item
                quantidade = Decimal("0")
                if q_com:
                    try:
                        quantidade = _parse_decimal(q_com)
                    except ValueError:
                        quantidade = Decimal("0")

                valor_unitario = Decimal("0")
                if v_un_com:
                    try:
                        valor_unitario = _parse_decimal(v_un_com)
                    except ValueError:
                        valor_unitario = Decimal("0")

                itens.append(
                    NFeItem(
                        descricao=x_prod or f"Item {len(itens) + 1}",
                        quantidade=quantidade,
                        valor_unitario=valor_unitario,
                        valor_total=valor_item,
                        cfop=cfop,
                        ncm=ncm,
                        c_prod=c_prod,
                        c_ean=c_ean,
                        cest=cest,
                    )
                )
            except ValueError:
                continue

    valor_total = Decimal("0")
    valor_produtos = Decimal("0")
    valor_frete = Decimal("0")
    valor_seguro = Decimal("0")
    valor_desconto = Decimal("0")
    valor_outros = Decimal("0")

    valor_produtos_xml = _find_first_text(total, ("vProd",))
    if valor_produtos_xml:
        valor_produtos = _parse_decimal(valor_produtos_xml)

    valor_frete_xml = _find_first_text(total, ("vFrete",))
    if valor_frete_xml:
        valor_frete = _parse_decimal(valor_frete_xml)

    valor_seguro_xml = _find_first_text(total, ("vSeg",))
    if valor_seguro_xml:
        valor_seguro = _parse_decimal(valor_seguro_xml)

    valor_desconto_xml = _find_first_text(total, ("vDesc",))
    if valor_desconto_xml:
        valor_desconto = _parse_decimal(valor_desconto_xml)

    valor_outros_xml = _find_first_text(total, ("vOutro",))
    if valor_outros_xml:
        valor_outros = _parse_decimal(valor_outros_xml)

    total_xml = _find_first_text(total, ("vNF",))
    if total_xml:
        valor_total = _parse_decimal(total_xml)
    elif total_itens > 0:
        if valor_produtos <= 0:
            valor_produtos = total_itens
        valor_total = total_itens + valor_frete + valor_seguro + valor_outros - valor_desconto
        if valor_total <= 0:
            valor_total = total_itens

    tipo_lancamento = _infer_tipo_lancamento(
        tp_nf=tp_nf,
        empresa_cnpj=empresa_cnpj,
        emitente_documento=emitente_documento,
        destinatario_documento=destinatario_documento,
        cfops=cfops,
        natureza_operacao=natureza_operacao,
    )

    if tipo_lancamento == "RECEITA":
        entidade_referencia_nome = destinatario_nome
        entidade_referencia_documento = destinatario_documento
    else:
        entidade_referencia_nome = emitente_nome
        entidade_referencia_documento = emitente_documento

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
        serie=serie,
        tipo_lancamento=tipo_lancamento,
        data_emissao=data_emissao,
        valor_total=valor_total,
        valor_produtos=valor_produtos,
        valor_frete=valor_frete,
        valor_seguro=valor_seguro,
        valor_desconto=valor_desconto,
        valor_outros=valor_outros,
        natureza_operacao=natureza_operacao,
        emitente_nome=emitente_nome,
        emitente_nome_fantasia=emitente_nome_fantasia,
        emitente_documento=emitente_documento,
        emitente_cep=emitente_cep,
        emitente_logradouro=emitente_logradouro,
        emitente_numero=emitente_numero,
        emitente_complemento=emitente_complemento,
        emitente_bairro=emitente_bairro,
        emitente_cidade=emitente_cidade,
        emitente_uf=emitente_uf,
        emitente_telefone=emitente_telefone,
        destinatario_nome=destinatario_nome,
        destinatario_documento=destinatario_documento,
        entidade_referencia_nome=entidade_referencia_nome,
        entidade_referencia_documento=entidade_referencia_documento,
        cfops=cfops,
        ncms=ncms,
        itens=itens,
        parcelas=parcelas,
    )
