from fastapi import Request
from app.core.network import get_client_ip

def test_get_client_ip_no_request():
    assert get_client_ip(None) == "127.0.0.1"

def test_get_client_ip_no_headers():
    scope = {
        "type": "http",
        "headers": [],
        "client": ("192.168.1.50", 12345)
    }
    req = Request(scope)
    assert get_client_ip(req) == "192.168.1.50"

def test_get_client_ip_x_forwarded_for():
    scope = {
        "type": "http",
        "headers": [
            (b"x-forwarded-for", b"203.0.113.195, 70.41.3.18, 150.172.238.178")
        ],
        "client": ("192.168.1.50", 12345)
    }
    req = Request(scope)
    assert get_client_ip(req) == "203.0.113.195"

def test_get_client_ip_x_real_ip():
    scope = {
        "type": "http",
        "headers": [
            (b"x-real-ip", b"203.0.113.196")
        ],
        "client": ("192.168.1.50", 12345)
    }
    req = Request(scope)
    assert get_client_ip(req) == "203.0.113.196"

def test_get_client_ip_both_headers():
    scope = {
        "type": "http",
        "headers": [
            (b"x-forwarded-for", b"203.0.113.195"),
            (b"x-real-ip", b"203.0.113.196")
        ],
        "client": ("192.168.1.50", 12345)
    }
    req = Request(scope)
    assert get_client_ip(req) == "203.0.113.195"
