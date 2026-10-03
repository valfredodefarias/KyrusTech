"""Rota que serve o frontend (SPA): nunca entrega arquivo fora de kyrus-web/dist.

Antes, `GET /..%2F..%2F.env` devolvia o .env do servidor (senha do banco e
chaves) sem login, e rota de API inexistente respondia 200 com o index.html.
"""
from __future__ import annotations

import pytest

import app.main as principal


@pytest.fixture
def raiz_falsa(tmp_path, monkeypatch):
    dist = tmp_path / "kyrus-web" / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>spa</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.info('ok')", encoding="utf-8")
    (tmp_path / ".env").write_text("SEGREDO=nao-pode-vazar", encoding="utf-8")
    (tmp_path / "frontend").mkdir()
    monkeypatch.setattr(principal, "ROOT_DIR", tmp_path)
    return tmp_path


@pytest.mark.parametrize(
    "caminho",
    [
        "/..%2F..%2F.env",
        "/%2e%2e/%2e%2e/.env",
        "/assets/..%2F..%2F..%2F.env",
        "/..%2F.env",
        "/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f.env",
    ],
)
def test_nao_entrega_arquivo_fora_do_dist(client, raiz_falsa, caminho):
    resposta = client.get(caminho)

    assert "nao-pode-vazar" not in resposta.text


def test_arquivo_do_dist_e_rota_do_react_continuam_funcionando(client, raiz_falsa):
    assert client.get("/assets/app.js").text == "console.info('ok')"
    assert client.get("/estoque/saldos").text == "<html>spa</html>"


def test_rota_de_api_inexistente_responde_404_em_json(client, raiz_falsa):
    resposta = client.get("/api/v1/rota-que-nao-existe")

    assert resposta.status_code == 404
    assert resposta.headers["content-type"].startswith("application/json")
