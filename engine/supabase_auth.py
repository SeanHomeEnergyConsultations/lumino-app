import os

import requests


AUTH_TIMEOUT_SECONDS = 15


def supabase_auth_enabled():
    return bool(_base_url() and _public_key())


def sign_in_with_password(email, password):
    if not supabase_auth_enabled():
        return {"ok": False, "error": "Supabase auth is not configured."}

    try:
        response = requests.post(
            f"{_base_url()}/auth/v1/token?grant_type=password",
            headers={
                "apikey": _public_key(),
                "Content-Type": "application/json",
            },
            json={"email": email, "password": password},
            timeout=AUTH_TIMEOUT_SECONDS,
        )
        if response.status_code >= 400:
            try:
                detail = response.json()
                message = detail.get("msg") or detail.get("message") or str(detail)
            except Exception:
                message = response.text
            return {"ok": False, "error": message}
        payload = response.json()
        return {
            "ok": True,
            "access_token": payload.get("access_token"),
            "refresh_token": payload.get("refresh_token"),
            "expires_in": payload.get("expires_in"),
            "token_type": payload.get("token_type"),
            "user": payload.get("user") or {},
        }
    except Exception as err:
        return {"ok": False, "error": str(err)}


def sign_out():
    return {"ok": True}


def _base_url():
    return os.getenv("SUPABASE_URL", "").rstrip("/")


def _public_key():
    return (
        os.getenv("SUPABASE_ANON_KEY", "").strip()
        or os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        or os.getenv("SUPABASE_SECRET_KEY", "").strip()
    )
