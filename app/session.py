from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

SESSION_TOKEN_BYTES = 32
SESSION_TOKEN_LENGTH = 43
SESSION_SIGNATURE_LENGTH = 43
SESSION_SIGNATURE_BYTES = 32
URLSAFE_ALPHABET = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes | None:
    try:
        padding = "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode(value + padding)
    except (ValueError, TypeError):
        return None


def sign_session(visitor_id: str, secret: str) -> str:
    signature = hmac.new(secret.encode("utf-8"), visitor_id.encode("ascii"), hashlib.sha256).digest()
    return f"{visitor_id}.{_encode(signature)}"


def new_session(secret: str) -> tuple[str, str]:
    visitor_id = _encode(secrets.token_bytes(SESSION_TOKEN_BYTES))
    return visitor_id, sign_session(visitor_id, secret)


def verify_session(value: str | None, secret: str) -> str | None:
    if not value or value.count(".") != 1:
        return None
    visitor_id, encoded_signature = value.split(".", 1)
    if len(visitor_id) != SESSION_TOKEN_LENGTH or len(encoded_signature) != SESSION_SIGNATURE_LENGTH:
        return None
    try:
        value.encode("ascii")
    except UnicodeEncodeError:
        return None
    if any(char not in URLSAFE_ALPHABET for char in visitor_id + encoded_signature):
        return None
    signature = _decode(encoded_signature)
    if signature is None or len(signature) != SESSION_SIGNATURE_BYTES:
        return None
    expected = hmac.new(secret.encode("utf-8"), visitor_id.encode("ascii"), hashlib.sha256).digest()
    return visitor_id if hmac.compare_digest(signature, expected) else None
