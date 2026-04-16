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


def send_password_reset_email(email, redirect_to=None):
    if not supabase_auth_enabled():
        return {"ok": False, "error": "Supabase auth is not configured."}
    if not email:
        return {"ok": False, "error": "Email is required."}

    params = {}
    if redirect_to:
        params["redirect_to"] = redirect_to

    try:
        _auth_request(
            "POST",
            "recover",
            params=params,
            json_body={"email": email.strip().lower()},
        )
        return {"ok": True}
    except Exception as err:
        return {"ok": False, "error": str(err)}


def verify_otp_token(token_hash, otp_type="recovery"):
    if not supabase_auth_enabled():
        return {"ok": False, "error": "Supabase auth is not configured."}
    if not token_hash:
        return {"ok": False, "error": "Recovery token is missing."}

    try:
        payload = _auth_request(
            "POST",
            "verify",
            json_body={
                "token_hash": token_hash,
                "type": otp_type or "recovery",
            },
        )
        return {
            "ok": True,
            "access_token": payload.get("access_token"),
            "refresh_token": payload.get("refresh_token"),
            "user": payload.get("user") or {},
        }
    except Exception as err:
        return {"ok": False, "error": str(err)}


def update_user_password(access_token, password):
    if not supabase_auth_enabled():
        return {"ok": False, "error": "Supabase auth is not configured."}
    if not access_token:
        return {"ok": False, "error": "Auth session is missing."}
    if not password:
        return {"ok": False, "error": "Password is required."}

    try:
        payload = _auth_request(
            "PUT",
            "user",
            access_token=access_token,
            json_body={"password": password},
        )
        return {"ok": True, "user": payload or {}}
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


def _auth_request(method, path, *, params=None, json_body=None, access_token=None):
    headers = {
        "apikey": _public_key(),
        "Content-Type": "application/json",
    }
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    response = requests.request(
        method,
        f"{_base_url()}/auth/v1/{path.lstrip('/')}",
        headers=headers,
        params=params,
        json=json_body,
        timeout=AUTH_TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        try:
            detail = response.json()
            message = detail.get("msg") or detail.get("message") or str(detail)
        except Exception:
            message = response.text
        raise RuntimeError(message)
    if not response.text:
        return None
    return response.json()
