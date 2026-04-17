import os
import math
import secrets
import string
import time
from datetime import datetime, timezone

import requests

from engine.cache_keys import make_analysis_cache_key


TIMEOUT_SECONDS = 15


def supabase_enabled():
    return bool(os.getenv("SUPABASE_URL", "").strip() and os.getenv("SUPABASE_SECRET_KEY", "").strip())


def _base_url():
    return os.getenv("SUPABASE_URL", "").rstrip("/")


def _public_key():
    return (
        os.getenv("SUPABASE_ANON_KEY", "").strip()
        or os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        or os.getenv("SUPABASE_SECRET_KEY", "").strip()
    )


def _looks_like_jwt(value):
    token = str(value or "").strip()
    return token.count(".") == 2


def _headers(prefer=None, auth_context=None):
    key = (auth_context or {}).get("api_key") or _public_key()
    headers = {
        "apikey": key,
        "Content-Type": "application/json",
    }
    bearer = (auth_context or {}).get("access_token")
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    elif _looks_like_jwt(key):
        headers["Authorization"] = f"Bearer {key}"
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _request(method, path, *, params=None, json_body=None, prefer=None, auth_context=None):
    safe_json_body = _json_safe(json_body)
    response = requests.request(
        method,
        f"{_base_url()}/rest/v1/{path.lstrip('/')}",
        headers=_headers(prefer=prefer, auth_context=auth_context),
        params=params,
        json=safe_json_body,
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        raise RuntimeError(f"Supabase {method} {path} failed: {detail}")
    if not response.text:
        return None
    return response.json()


def _service_headers():
    secret = os.getenv("SUPABASE_SECRET_KEY", "").strip()
    return {
        "apikey": secret,
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
    }


def _auth_admin_request(method, path, *, params=None, json_body=None):
    response = requests.request(
        method,
        f"{_base_url()}/auth/v1/admin/{path.lstrip('/')}",
        headers=_service_headers(),
        params=params,
        json=_json_safe(json_body),
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        raise RuntimeError(f"Supabase auth admin {method} {path} failed: {detail}")
    if not response.text:
        return None
    return response.json()


def _json_safe(value):
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    try:
        if value is not None and hasattr(value, "item"):
            return _json_safe(value.item())
    except Exception:
        return value
    return value


def _normalize_address(address):
    return " ".join(str(address or "").strip().lower().split())


def _lead_payload(result):
    return {
        "normalized_address": _normalize_address(result.get("address")),
        "address": result.get("address"),
        "zipcode": result.get("zipcode"),
        "lat": result.get("lat"),
        "lng": result.get("lng"),
        "owner_name": _combine_name(result.get("first_name"), result.get("last_name")),
        "first_name": result.get("first_name"),
        "last_name": result.get("last_name"),
        "phone": result.get("phone"),
        "email": result.get("email"),
        "notes": result.get("notes"),
        "unqualified": _coerce_bool(result.get("unqualified")),
        "unqualified_reason": result.get("unqualified_reason"),
        "listing_agent": result.get("listing_agent"),
        "source": "imported",
    }


def _analysis_payload(cache_key, lead_id, result):
    return {
        "lead_id": lead_id,
        "cache_key": cache_key,
        "sale_price": result.get("sale_price"),
        "price_display": result.get("price_display"),
        "value_badge": result.get("value_badge"),
        "sqft": result.get("sqft"),
        "sqft_display": result.get("sqft_display"),
        "beds": _string_or_none(result.get("beds")),
        "baths": _string_or_none(result.get("baths")),
        "sold_date": result.get("sold_date"),
        "permit_pulled": result.get("permit_pulled"),
        "sun_hours": result.get("sun_hours"),
        "sun_hours_display": result.get("sun_hours_display"),
        "category": result.get("category"),
        "solar_details": _solar_details_payload(result),
        "priority_score": result.get("priority_score", 0),
        "priority_label": result.get("priority_label"),
        "parking_address": result.get("parking_address"),
        "parking_ease": result.get("parking_ease"),
        "doors_to_knock": result.get("doors_to_knock", 0),
        "ideal_count": result.get("ideal_count", 0),
        "good_count": result.get("good_count", 0),
        "walkable_count": result.get("walkable_count", 0),
        "street_view_link": result.get("street_view_link"),
        "value_score": result.get("value_score", 0),
        "sqft_score": result.get("sqft_score", 0),
        "analysis_error": result.get("analysis_error"),
        "source_hash": cache_key,
    }


def _solar_details_payload(result):
    return _json_safe(
        {
            "solar_fit_score": result.get("solar_fit_score"),
            "roof_capacity_score": result.get("roof_capacity_score"),
            "roof_complexity_score": result.get("roof_complexity_score"),
            "max_array_panels_count": result.get("max_array_panels_count"),
            "max_array_area_m2": result.get("max_array_area_m2"),
            "panel_capacity_watts": result.get("panel_capacity_watts"),
            "system_capacity_kw": result.get("system_capacity_kw"),
            "yearly_energy_dc_kwh": result.get("yearly_energy_dc_kwh"),
            "roof_segment_count": result.get("roof_segment_count"),
            "south_facing_segment_count": result.get("south_facing_segment_count"),
            "whole_roof_area_m2": result.get("whole_roof_area_m2"),
            "building_area_m2": result.get("building_area_m2"),
            "imagery_quality": result.get("imagery_quality"),
        }
    )


def _neighbor_payloads(analysis_id, result):
    payloads = []
    for neighbor in result.get("neighbor_records", []):
        payloads.append(
            {
                "lead_analysis_id": analysis_id,
                "address": neighbor.get("address"),
                "zipcode": neighbor.get("zipcode"),
                "lat": neighbor.get("lat"),
                "lng": neighbor.get("lng"),
                "sun_hours": neighbor.get("sun_hours"),
                "sun_hours_display": neighbor.get("sun_hours_display"),
                "category": neighbor.get("category"),
                "priority_score": neighbor.get("priority_score", 0),
            }
        )
    return payloads


def _result_from_supabase_row(row):
    lead_row = row.get("leads") or {}
    result = {
        "address": lead_row.get("address", ""),
        "lat": lead_row.get("lat"),
        "lng": lead_row.get("lng"),
        "zipcode": lead_row.get("zipcode", "Unknown"),
        "sun_hours": row.get("sun_hours"),
        "sun_hours_display": row.get("sun_hours_display", "N/A"),
        "category": row.get("category", "Unknown"),
        "street_view_link": row.get("street_view_link", ""),
        "parking_ease": row.get("parking_ease", ""),
        "walkable_count": row.get("walkable_count", 0),
        "ideal_count": row.get("ideal_count", 0),
        "good_count": row.get("good_count", 0),
        "priority_score": row.get("priority_score", 0),
        "priority_label": row.get("priority_label", ""),
        "parking_address": row.get("parking_address") or lead_row.get("address", ""),
        "doors_to_knock": row.get("doors_to_knock", 0),
        "knock_addresses": _knock_addresses(
            lead_row.get("address", ""),
            row.get("lead_neighbors", []),
            row.get("category"),
        ),
        "neighbor_records": [_neighbor_record_from_row(item) for item in row.get("lead_neighbors", [])],
        "sale_price": row.get("sale_price"),
        "price_display": row.get("price_display", "N/A"),
        "value_badge": row.get("value_badge", "Unknown"),
        "sqft": row.get("sqft"),
        "sqft_display": row.get("sqft_display", "N/A"),
        "sold_date": row.get("sold_date", "Unknown"),
        "permit_pulled": row.get("permit_pulled", "Unknown"),
        "beds": row.get("beds", ""),
        "baths": row.get("baths", ""),
        "value_score": row.get("value_score", 0),
        "sqft_score": row.get("sqft_score", 0),
        "analysis_error": row.get("analysis_error"),
        "first_name": lead_row.get("first_name"),
        "last_name": lead_row.get("last_name"),
        "phone": lead_row.get("phone"),
        "email": lead_row.get("email"),
        "notes": lead_row.get("notes"),
        "unqualified": lead_row.get("unqualified"),
        "unqualified_reason": lead_row.get("unqualified_reason"),
        "listing_agent": lead_row.get("listing_agent"),
    }
    return _merge_solar_details(result, row.get("solar_details"))


def _neighbor_record_from_row(row):
    return {
        "address": row.get("address"),
        "lat": row.get("lat"),
        "lng": row.get("lng"),
        "zipcode": row.get("zipcode", "Unknown"),
        "sun_hours": row.get("sun_hours"),
        "sun_hours_display": row.get("sun_hours_display", "N/A"),
        "category": row.get("category", "Unknown"),
        "priority_score": row.get("priority_score", 0),
        "price_display": "N/A",
        "sqft_display": "N/A",
        "beds": "",
        "baths": "",
        "sold_date": "N/A",
        "doors_to_knock": 0,
        "source": "Cluster Neighbor",
    }


def _open_lead_pool_row_to_result(row):
    result = {
        "lead_id": row.get("id"),
        "address": row.get("address", ""),
        "lat": row.get("lat"),
        "lng": row.get("lng"),
        "zipcode": row.get("zipcode", "Unknown"),
        "sun_hours": row.get("sun_hours"),
        "sun_hours_display": row.get("sun_hours_display", "N/A"),
        "category": row.get("category", "Unknown"),
        "street_view_link": "",
        "parking_ease": "",
        "walkable_count": 0,
        "ideal_count": 0,
        "good_count": 0,
        "priority_score": row.get("priority_score", 0),
        "priority_label": row.get("priority_label", ""),
        "parking_address": row.get("address", ""),
        "doors_to_knock": row.get("doors_to_knock", 0),
        "knock_addresses": _knock_addresses(row.get("address", ""), [], row.get("category")),
        "neighbor_records": [],
        "sale_price": row.get("sale_price"),
        "price_display": row.get("price_display", "N/A"),
        "value_badge": "Unknown",
        "sqft": row.get("sqft"),
        "sqft_display": row.get("sqft_display", "N/A"),
        "sold_date": row.get("sold_date", "Unknown"),
        "permit_pulled": row.get("permit_pulled", "Unknown"),
        "beds": row.get("beds", ""),
        "baths": row.get("baths", ""),
        "value_score": 0,
        "sqft_score": 0,
        "analysis_error": None,
        "first_name": row.get("first_name"),
        "last_name": row.get("last_name"),
        "phone": row.get("phone"),
        "email": row.get("email"),
        "notes": row.get("notes"),
        "unqualified": row.get("unqualified"),
        "unqualified_reason": row.get("unqualified_reason"),
        "listing_agent": row.get("listing_agent"),
    }
    return _merge_solar_details(result, row.get("solar_details"))


def _knock_addresses(primary_address, neighbor_rows, category):
    knock_list = [primary_address] if category in {"Best", "Better", "Good"} and primary_address else []
    knock_list.extend(
        item.get("address")
        for item in neighbor_rows
        if item.get("priority_score", 0) >= 2 and item.get("address")
    )
    return knock_list


def _combine_name(first_name, last_name):
    parts = [str(value).strip() for value in [first_name, last_name] if value not in (None, "")]
    return " ".join(part for part in parts if part)


def _string_or_none(value):
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _coerce_bool(value):
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"", "nan", "none", "null"}:
        return None
    if text in {"true", "t", "yes", "y", "1"}:
        return True
    if text in {"false", "f", "no", "n", "0"}:
        return False
    return None


def _missing_solar_details_column(error):
    message = str(error).lower()
    return "solar_details" in message and ("column" in message or "schema cache" in message)


def _missing_open_lead_pool_column(error):
    message = str(error).lower()
    return "open_lead_pool" in message and ("column" in message or "schema cache" in message)


def _merge_solar_details(result, solar_details):
    merged = dict(result)
    for key, default in {
        "solar_fit_score": 0,
        "roof_capacity_score": 0,
        "roof_complexity_score": 0,
        "max_array_panels_count": None,
        "max_array_area_m2": None,
        "panel_capacity_watts": None,
        "system_capacity_kw": None,
        "yearly_energy_dc_kwh": None,
        "roof_segment_count": None,
        "south_facing_segment_count": None,
        "whole_roof_area_m2": None,
        "building_area_m2": None,
        "imagery_quality": None,
    }.items():
        merged[key] = (solar_details or {}).get(key, default)
    return merged


def get_cached_analysis(row_data, auth_context=None):
    if not supabase_enabled():
        return None

    cache_key = make_analysis_cache_key(row_data)
    try:
        rows = _request(
            "GET",
            "lead_analysis",
            params={
                "cache_key": f"eq.{cache_key}",
                "select": (
                    "*,"
                    "leads(id,address,zipcode,lat,lng,first_name,last_name,phone,email,notes,unqualified,unqualified_reason,listing_agent),"
                    "lead_neighbors(address,zipcode,lat,lng,sun_hours,sun_hours_display,category,priority_score)"
                ),
                "limit": "1",
            },
            auth_context=auth_context,
        )
        if rows:
            return _result_from_supabase_row(rows[0])
    except Exception:
        return None
    return None


def _chunked(items, size):
    chunk_size = max(1, int(size or 1))
    for index in range(0, len(items), chunk_size):
        yield items[index : index + chunk_size]


def _minimal_result_from_lead(lead_row):
    result = {
        "lead_id": lead_row.get("id"),
        "address": lead_row.get("address", ""),
        "lat": lead_row.get("lat"),
        "lng": lead_row.get("lng"),
        "zipcode": lead_row.get("zipcode", "Unknown"),
        "sun_hours": None,
        "sun_hours_display": "N/A",
        "category": "Unknown",
        "street_view_link": "",
        "parking_ease": "",
        "walkable_count": 0,
        "ideal_count": 0,
        "good_count": 0,
        "priority_score": 0,
        "priority_label": "",
        "parking_address": lead_row.get("address", ""),
        "doors_to_knock": 0,
        "knock_addresses": _knock_addresses(lead_row.get("address", ""), [], "Unknown"),
        "neighbor_records": [],
        "sale_price": None,
        "price_display": "N/A",
        "value_badge": "Unknown",
        "sqft": None,
        "sqft_display": "N/A",
        "sold_date": "Unknown",
        "permit_pulled": "Unknown",
        "beds": "",
        "baths": "",
        "value_score": 0,
        "sqft_score": 0,
        "analysis_error": None,
        "first_name": lead_row.get("first_name"),
        "last_name": lead_row.get("last_name"),
        "phone": lead_row.get("phone"),
        "email": lead_row.get("email"),
        "notes": lead_row.get("notes"),
        "unqualified": lead_row.get("unqualified"),
        "unqualified_reason": lead_row.get("unqualified_reason"),
        "listing_agent": lead_row.get("listing_agent"),
    }
    return _merge_solar_details(result, None)


def _open_lead_result_rank(row):
    return (
        int(row.get("priority_score") or 0),
        int(row.get("doors_to_knock") or 0),
        1 if row.get("sun_hours") is not None else 0,
        1 if row.get("sale_price") is not None else 0,
        1 if row.get("sqft") is not None else 0,
        len(str(row.get("notes") or "")),
    )


def _dedupe_open_lead_results(rows):
    best_by_lead_id = {}
    for row in rows or []:
        lead_id = row.get("lead_id") or row.get("id")
        if not lead_id:
            continue
        current = best_by_lead_id.get(lead_id)
        if current is None or _open_lead_result_rank(row) > _open_lead_result_rank(current):
            best_by_lead_id[lead_id] = row
    deduped_rows = list(best_by_lead_id.values())
    deduped_rows.sort(
        key=lambda row: (
            -(row.get("priority_score") or 0),
            -(row.get("doors_to_knock") or 0),
            str(row.get("address") or "").lower(),
        )
    )
    return deduped_rows


def _cleanup_duplicate_lead_analysis_rows(lead_id, keep_analysis_id, auth_context=None):
    if not lead_id or not keep_analysis_id:
        return
    try:
        analysis_rows = _request(
            "GET",
            "lead_analysis",
            params={
                "lead_id": f"eq.{lead_id}",
                "select": "id",
                "order": "updated_at.desc",
            },
            auth_context=auth_context,
        ) or []
    except Exception:
        return

    duplicate_ids = [
        row.get("id")
        for row in analysis_rows
        if row.get("id") and row.get("id") != keep_analysis_id
    ]
    if not duplicate_ids:
        return

    try:
        _request(
            "DELETE",
            "lead_neighbors",
            params={"lead_analysis_id": f"in.({','.join(_quoted(analysis_id) for analysis_id in duplicate_ids)})"},
            auth_context=auth_context,
        )
    except Exception:
        pass

    try:
        _request(
            "DELETE",
            "lead_analysis",
            params={"id": f"in.({','.join(_quoted(analysis_id) for analysis_id in duplicate_ids)})"},
            auth_context=auth_context,
        )
    except Exception:
        pass


def _get_open_lead_pool_direct(limit=5000, auth_context=None):
    organization_id = (auth_context or {}).get("organization_id")
    if not organization_id:
        return []

    lead_rows = _request(
        "GET",
        "leads",
        params={
            "organization_id": f"eq.{organization_id}",
            "status": "eq.open",
            "assignment_status": "eq.unassigned",
            "select": (
                "id,address,zipcode,lat,lng,first_name,last_name,phone,email,notes,"
                "unqualified,unqualified_reason,listing_agent,updated_at"
            ),
            "order": "updated_at.desc,address.asc",
            "limit": str(limit),
        },
        auth_context=auth_context,
    ) or []
    if not lead_rows:
        return []

    lead_lookup = {row["id"]: row for row in lead_rows if row.get("id")}
    lead_ids = list(lead_lookup.keys())
    analysis_rows = []
    for lead_id_chunk in _chunked(lead_ids, 200):
        analysis_rows.extend(
            _request(
                "GET",
                "lead_analysis",
                params={
                    "lead_id": f"in.({','.join(_quoted(lead_id) for lead_id in lead_id_chunk)})",
                    "select": "*",
                    "order": "updated_at.desc",
                },
                auth_context=auth_context,
            ) or []
        )

    analysis_lookup = {}
    analysis_ids = []
    for analysis_row in analysis_rows:
        lead_id = analysis_row.get("lead_id")
        if not lead_id or lead_id in analysis_lookup:
            continue
        analysis_lookup[lead_id] = analysis_row
        if analysis_row.get("id"):
            analysis_ids.append(analysis_row["id"])

    neighbor_lookup = {}
    for analysis_id_chunk in _chunked(analysis_ids, 200):
        neighbor_rows = _request(
            "GET",
            "lead_neighbors",
            params={
                "lead_analysis_id": f"in.({','.join(_quoted(analysis_id) for analysis_id in analysis_id_chunk)})",
                "select": "lead_analysis_id,address,zipcode,lat,lng,sun_hours,sun_hours_display,category,priority_score",
            },
            auth_context=auth_context,
        ) or []
        for neighbor in neighbor_rows:
            neighbor_lookup.setdefault(neighbor.get("lead_analysis_id"), []).append(neighbor)

    results = []
    for lead_row in lead_rows:
        analysis_row = analysis_lookup.get(lead_row.get("id"))
        if analysis_row:
            analysis_row = dict(analysis_row)
            analysis_row["lead_neighbors"] = neighbor_lookup.get(analysis_row.get("id"), [])
            results.append(_draft_result_from_parts(lead_row, analysis_row))
        else:
            results.append(_minimal_result_from_lead(lead_row))

    return _dedupe_open_lead_results(results)


def get_open_lead_pool(limit=5000, auth_context=None):
    if not supabase_enabled():
        return []
    if auth_context and not can_access_manager_workspace(auth_context=auth_context):
        return []
    organization_id = (auth_context or {}).get("organization_id")
    if not organization_id:
        return []

    params = {
        "organization_id": f"eq.{organization_id}",
        "select": (
            "id,address,zipcode,lat,lng,first_name,last_name,phone,email,notes,"
            "unqualified,unqualified_reason,listing_agent,sale_price,price_display,sqft,sqft_display,"
            "beds,baths,sold_date,permit_pulled,priority_score,priority_label,category,sun_hours,sun_hours_display,"
            "solar_details,doors_to_knock"
        ),
        "order": "priority_score.desc,doors_to_knock.desc,address.asc",
        "limit": str(limit),
    }
    try:
        rows = _request("GET", "open_lead_pool", params=params, auth_context=auth_context)
    except Exception as err:
        if not (_missing_solar_details_column(err) or _missing_open_lead_pool_column(err)):
            return []
        try:
            rows = _request(
                "GET",
                "open_lead_pool",
                params={
                    "organization_id": f"eq.{organization_id}",
                    "select": (
                        "id,address,zipcode,lat,lng,first_name,last_name,phone,email,notes,"
                        "unqualified,unqualified_reason,listing_agent,sale_price,price_display,sqft,sqft_display,"
                        "beds,baths,sold_date,permit_pulled,priority_score,priority_label,category,sun_hours,doors_to_knock"
                    ),
                    "order": "priority_score.desc,doors_to_knock.desc,address.asc",
                    "limit": str(limit),
                },
                auth_context=auth_context,
            )
        except Exception as fallback_err:
            if not (_missing_solar_details_column(fallback_err) or _missing_open_lead_pool_column(fallback_err)):
                return []
            try:
                rows = _request(
                    "GET",
                    "open_lead_pool",
                    params={
                        "organization_id": f"eq.{organization_id}",
                        "select": (
                            "id,address,zipcode,lat,lng,first_name,last_name,phone,email,notes,"
                            "unqualified,unqualified_reason,listing_agent,priority_score,priority_label,"
                            "category,sun_hours,doors_to_knock"
                        ),
                        "order": "priority_score.desc,doors_to_knock.desc,address.asc",
                        "limit": str(limit),
                    },
                    auth_context=auth_context,
                )
            except Exception:
                try:
                    return _get_open_lead_pool_direct(limit=limit, auth_context=auth_context)
                except Exception:
                    return []
    if rows:
        return _dedupe_open_lead_results([_open_lead_pool_row_to_result(row) for row in rows])
    try:
        return _get_open_lead_pool_direct(limit=limit, auth_context=auth_context)
    except Exception:
        return []


def get_visible_leads(limit=1000, auth_context=None):
    if not supabase_enabled():
        return []

    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id:
        return []

    params = {
        "organization_id": f"eq.{organization_id}",
        "select": (
            "id,address,zipcode,status,assignment_status,assigned_to,created_by,"
            "first_name,last_name,phone,email,notes,unqualified,unqualified_reason,"
            "listing_agent,created_at,updated_at"
        ),
        "order": "updated_at.desc,address.asc",
        "limit": str(limit),
    }

    if auth_context and not can_access_manager_workspace(auth_context=auth_context):
        if not current_user_id:
            return []
        params["or"] = f"(created_by.eq.{current_user_id},assigned_to.eq.{current_user_id})"

    try:
        rows = _request("GET", "leads", params=params, auth_context=auth_context)
        return rows or []
    except Exception:
        return []


def get_team_route_activity(limit=5000, auth_context=None):
    if not supabase_enabled():
        return []

    organization_id = (auth_context or {}).get("organization_id")
    if not organization_id:
        return []

    try:
        route_runs = _request(
            "GET",
            "route_runs",
            params={
                "organization_id": f"eq.{organization_id}",
                "select": "id,rep_id,started_at,app_users!route_runs_rep_id_fkey(id,full_name,email)",
                "order": "started_at.desc",
                "limit": str(limit),
            },
            auth_context=auth_context,
        ) or []
        if not route_runs:
            return []

        route_run_ids = [row["id"] for row in route_runs if row.get("id")]
        if not route_run_ids:
            return []

        stop_rows = _request(
            "GET",
            "route_run_stops",
            params={
                "route_run_id": f"in.({','.join(_quoted(route_run_id) for route_run_id in route_run_ids)})",
                "select": (
                    "route_run_id,address,stop_status,outcome,disposition,best_follow_up_time,"
                    "interest_level,phone,email,completed_at,notes"
                ),
                "limit": str(limit),
            },
            auth_context=auth_context,
        ) or []
        run_lookup = {row["id"]: row for row in route_runs}

        activity_rows = []
        for stop in stop_rows:
            route_run = run_lookup.get(stop.get("route_run_id")) or {}
            rep_row = route_run.get("app_users") or {}
            activity_rows.append(
                {
                    **stop,
                    "rep_id": route_run.get("rep_id"),
                    "rep_name": rep_row.get("full_name") or rep_row.get("email") or route_run.get("rep_id") or "Unknown Rep",
                    "rep_email": rep_row.get("email") or "",
                    "started_at": route_run.get("started_at"),
                }
            )
        return activity_rows
    except Exception:
        return []


def update_lead_assignment(lead_id, assigned_to=None, auth_context=None):
    if not supabase_enabled() or not lead_id:
        return False

    payload = {
        "assigned_to": assigned_to or None,
        "assignment_status": "assigned" if assigned_to else "unassigned",
    }
    try:
        _request(
            "PATCH",
            "leads",
            params={"id": f"eq.{lead_id}"},
            json_body=payload,
            prefer="return=minimal",
            auth_context=auth_context,
        )
        return True
    except Exception:
        return False


def get_rep_options(auth_context=None):
    if not supabase_enabled():
        return []

    try:
        app_user = get_current_app_user(auth_context=auth_context)
        org_id = (auth_context or {}).get("organization_id")
        if not app_user or not org_id:
            return []
        rows = _request(
            "GET",
            "organization_members",
            params={
                "organization_id": f"eq.{org_id}",
                "is_active": "eq.true",
                "select": "role,app_users!organization_members_user_id_fkey(id,full_name,email,role)",
                "order": "app_users(full_name).asc",
            },
            auth_context=auth_context,
        )
        return [
            {
                "id": row["app_users"]["id"],
                "full_name": row["app_users"].get("full_name"),
                "email": row["app_users"].get("email"),
                "role": row.get("role") or row["app_users"].get("role"),
            }
            for row in (rows or [])
            if row.get("app_users")
        ]
    except Exception:
        return []


def get_current_app_user(auth_context=None):
    if not supabase_enabled() or not auth_context:
        return None
    user_id = auth_context.get("user_id")
    if not user_id:
        return None
    try:
        rows = _request(
            "GET",
            "app_users",
            params={
                "external_auth_id": f"eq.{user_id}",
                "select": "id,email,full_name,role,default_organization_id",
                "limit": "1",
            },
            auth_context=auth_context,
        )
        return (rows or [None])[0]
    except Exception:
        return None


def get_user_memberships(auth_context=None):
    app_user = get_current_app_user(auth_context=auth_context)
    if not app_user:
        return []
    try:
        rows = _request(
            "GET",
            "organization_members",
            params={
                "user_id": f"eq.{app_user['id']}",
                "is_active": "eq.true",
                "select": "organization_id,role,organizations(id,name,slug,status,billing_plan)",
            },
            auth_context=auth_context,
        )
        memberships = []
        for row in rows or []:
            org = row.get("organizations") or {}
            memberships.append(
                {
                    "organization_id": row.get("organization_id"),
                    "role": row.get("role"),
                    "organization_name": org.get("name"),
                    "organization_slug": org.get("slug"),
                    "organization_status": org.get("status"),
                    "billing_plan": org.get("billing_plan"),
                }
            )
        return memberships
    except Exception:
        return []


def get_active_org_role(auth_context=None):
    org_id = (auth_context or {}).get("organization_id")
    if not org_id:
        return None
    for membership in get_user_memberships(auth_context=auth_context):
        if membership.get("organization_id") == org_id:
            return str(membership.get("role") or "").strip().lower()
    return None


def can_access_manager_workspace(auth_context=None):
    return get_active_org_role(auth_context=auth_context) in {"owner", "admin", "manager"}


def create_onboarding_user(
    *,
    full_name,
    email,
    role="rep",
    organization_id,
    invited_by=None,
    temporary_password=None,
):
    if not supabase_enabled():
        return {"ok": False, "error": "Supabase is not configured."}
    if not organization_id:
        return {"ok": False, "error": "No organization selected."}
    if not email or not full_name:
        return {"ok": False, "error": "Full name and email are required."}

    normalized_email = (email or "").strip().lower()
    normalized_role = str(role or "rep").strip().lower()
    app_role = normalized_role if normalized_role in {"rep", "manager", "admin"} else "rep"
    member_role = normalized_role if normalized_role in {"rep", "manager", "admin"} else "rep"
    temp_password = temporary_password or _generate_temporary_password()

    auth_user_id = None
    try:
        auth_payload = _auth_admin_request(
            "POST",
            "users",
            json_body={
                "email": normalized_email,
                "password": temp_password,
                "email_confirm": True,
                "user_metadata": {
                    "full_name": full_name.strip(),
                    "name": full_name.strip(),
                },
            },
        )
        auth_user_id = _extract_auth_user_id(auth_payload)
    except Exception as err:
        message = str(err)
        if "already been registered" not in message and "User already registered" not in message:
            return {"ok": False, "error": message}
        auth_user_id = _find_auth_user_id_by_email(normalized_email)

    app_user_row = None
    for _ in range(8):
        app_user_row = _find_app_user_by_email(normalized_email)
        if app_user_row:
            break
        if auth_user_id:
            app_user_row = _find_app_user_by_external_auth_id(auth_user_id)
            if app_user_row:
                break
        time.sleep(0.35)

    if not app_user_row and auth_user_id:
        _request(
            "POST",
            "app_users",
            params={"on_conflict": "external_auth_id"},
            json_body={
                "external_auth_id": auth_user_id,
                "email": normalized_email,
                "full_name": full_name.strip(),
                "role": app_role,
                "default_organization_id": organization_id,
            },
            prefer="resolution=merge-duplicates,return=representation",
            auth_context=None,
        )
        app_user_row = _find_app_user_by_external_auth_id(auth_user_id) or _find_app_user_by_email(normalized_email)

    if not app_user_row:
        return {"ok": False, "error": "Could not create or find the app user record."}

    _request(
        "PATCH",
        "app_users",
        params={"id": f"eq.{app_user_row['id']}"},
        json_body={
            "full_name": full_name.strip(),
            "email": normalized_email,
            "role": app_role,
            "default_organization_id": organization_id,
            "is_active": True,
        },
        prefer="return=minimal",
        auth_context=None,
    )

    _request(
        "POST",
        "organization_members",
        params={"on_conflict": "organization_id,user_id"},
        json_body={
            "organization_id": organization_id,
            "user_id": app_user_row["id"],
            "role": member_role,
            "is_active": True,
            "invited_by": invited_by,
        },
        prefer="resolution=merge-duplicates,return=representation",
        auth_context=None,
    )

    return {
        "ok": True,
        "app_user_id": app_user_row["id"],
        "email": normalized_email,
        "temporary_password": temp_password,
        "role": member_role,
    }


def _extract_auth_user_id(auth_payload):
    if not auth_payload:
        return None
    if isinstance(auth_payload, dict):
        if auth_payload.get("id"):
            return auth_payload.get("id")
        nested_user = auth_payload.get("user") or {}
        if isinstance(nested_user, dict) and nested_user.get("id"):
            return nested_user.get("id")
    return None


def _find_app_user_by_email(email):
    try:
        rows = _request(
            "GET",
            "app_users",
            params={
                "email": f"eq.{email.strip()}",
                "select": "id,email,full_name,role,external_auth_id,default_organization_id",
                "limit": "1",
            },
            auth_context=None,
        )
        return (rows or [None])[0]
    except Exception:
        return None


def _find_app_user_by_external_auth_id(external_auth_id):
    try:
        rows = _request(
            "GET",
            "app_users",
            params={
                "external_auth_id": f"eq.{external_auth_id}",
                "select": "id,email,full_name,role,external_auth_id,default_organization_id",
                "limit": "1",
            },
            auth_context=None,
        )
        return (rows or [None])[0]
    except Exception:
        return None


def _find_auth_user_id_by_email(email):
    if not email:
        return None
    try:
        payload = _auth_admin_request(
            "GET",
            "users",
            params={"email": email.strip().lower()},
        )
        for row in (payload.get("users") if isinstance(payload, dict) else payload) or []:
            row_email = str(row.get("email") or "").strip().lower()
            if row_email == email.strip().lower() and row.get("id"):
                return row.get("id")
    except Exception:
        return None
    return None


def _generate_temporary_password(length=12):
    alphabet = string.ascii_letters + string.digits
    return "Lumino!" + "".join(secrets.choice(alphabet) for _ in range(max(6, length - 7)))


def save_route_draft(name, selected_results, assigned_rep_id=None, auth_context=None):
    if not supabase_enabled() or not selected_results:
        return None
    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id:
        return None

    try:
        draft_rows = _request(
            "POST",
            "route_drafts",
            json_body={
                "organization_id": organization_id,
                "name": name,
                "created_by": current_user_id,
                "assigned_rep_id": assigned_rep_id or None,
                "status": "assigned" if assigned_rep_id else "draft",
                "selection_mode": "manual",
            },
            prefer="return=representation",
            auth_context=auth_context,
        )
        if not draft_rows:
            return None

        draft_id = draft_rows[0]["id"]

        direct_lead_ids = [item.get("lead_id") for item in selected_results if item.get("lead_id")]
        lead_lookup = {}
        if direct_lead_ids:
            lead_rows = _request(
                "GET",
                "leads",
                params={
                    "select": "id,address,normalized_address",
                    "id": f"in.({','.join(_quoted(lead_id) for lead_id in direct_lead_ids)})",
                },
                auth_context=auth_context,
            )
            lead_lookup = {row["id"]: row for row in (lead_rows or [])}
        else:
            lead_rows = _request(
                "GET",
                "leads",
                params={
                    "select": "id,address,normalized_address",
                    "normalized_address": f"in.({','.join(_quoted(_normalize_address(item.get('address'))) for item in selected_results if item.get('address'))})",
                },
                auth_context=auth_context,
            )
            lead_lookup = {row["normalized_address"]: row for row in (lead_rows or [])}

        stop_payloads = []
        for idx, result in enumerate(selected_results, start=1):
            lead_row = None
            if result.get("lead_id"):
                lead_row = lead_lookup.get(result.get("lead_id"))
            if lead_row is None:
                normalized_address = _normalize_address(result.get("address"))
                lead_row = lead_lookup.get(normalized_address)
            if not lead_row:
                continue
            stop_payloads.append(
                {
                    "route_draft_id": draft_id,
                    "lead_id": lead_row["id"],
                    "selected_by": current_user_id,
                    "priority_score": result.get("priority_score"),
                    "sort_order": idx,
                    "selection_reason": "Selected in planning workspace",
                }
            )

        if stop_payloads:
            _request(
                "POST",
                "route_draft_stops",
                json_body=stop_payloads,
                prefer="return=minimal",
                auth_context=auth_context,
            )

            _request(
                "PATCH",
                "leads",
                params={
                    "id": f"in.({','.join(_quoted(item['lead_id']) for item in stop_payloads)})",
                },
                json_body={
                    "assignment_status": "assigned",
                    "assigned_to": assigned_rep_id or None,
                },
                prefer="return=minimal",
                auth_context=auth_context,
            )

        return draft_rows[0]
    except Exception:
        return None


def get_route_drafts(limit=100, auth_context=None):
    if not supabase_enabled():
        return []

    try:
        params = {
            "select": "id,name,status,assigned_rep_id,created_at,app_users!route_drafts_assigned_rep_id_fkey(full_name,email)",
            "order": "created_at.desc",
            "limit": str(limit),
        }
        if auth_context and not can_access_manager_workspace(auth_context=auth_context):
            app_user = get_current_app_user(auth_context=auth_context)
            if not app_user:
                return []
            params["assigned_rep_id"] = f"eq.{app_user['id']}"
        rows = _request(
            "GET",
            "route_drafts",
            params=params,
            auth_context=auth_context,
        )
        return rows or []
    except Exception:
        return []


def load_route_draft_results(route_draft_id, auth_context=None):
    if not supabase_enabled():
        return []

    try:
        draft_rows = _request(
            "GET",
            "route_drafts",
            params={
                "id": f"eq.{route_draft_id}",
                "select": "id,assigned_rep_id",
                "limit": "1",
            },
            auth_context=auth_context,
        )
        draft_row = (draft_rows or [None])[0]
        if not draft_row:
            return []
        if auth_context and not can_access_manager_workspace(auth_context=auth_context):
            app_user = get_current_app_user(auth_context=auth_context)
            if not app_user or draft_row.get("assigned_rep_id") != app_user.get("id"):
                return []

        stop_rows = _request(
            "GET",
            "route_draft_stops",
            params={
                "route_draft_id": f"eq.{route_draft_id}",
                "select": "lead_id,sort_order",
                "order": "sort_order.asc",
            },
            auth_context=auth_context,
        )
        if not stop_rows:
            return []

        lead_ids = [row["lead_id"] for row in stop_rows if row.get("lead_id")]
        if not lead_ids:
            return []

        lead_rows = _request(
            "GET",
            "leads",
            params={
                "id": f"in.({','.join(_quoted(lead_id) for lead_id in lead_ids)})",
                "select": "id,address,zipcode,lat,lng,first_name,last_name,phone,email,notes,unqualified,unqualified_reason,listing_agent",
            },
            auth_context=auth_context,
        ) or []
        lead_lookup = {row["id"]: row for row in lead_rows}

        analysis_rows = _request(
            "GET",
            "lead_analysis",
            params={
                "lead_id": f"in.({','.join(_quoted(lead_id) for lead_id in lead_ids)})",
                "select": "*",
            },
            auth_context=auth_context,
        ) or []
        analysis_lookup = {row["lead_id"]: row for row in analysis_rows}

        analysis_ids = [row["id"] for row in analysis_rows if row.get("id")]
        neighbor_lookup = {}
        if analysis_ids:
            neighbor_rows = _request(
                "GET",
                "lead_neighbors",
                params={
                    "lead_analysis_id": f"in.({','.join(_quoted(analysis_id) for analysis_id in analysis_ids)})",
                    "select": "lead_analysis_id,address,zipcode,lat,lng,sun_hours,sun_hours_display,category,priority_score",
                },
                auth_context=auth_context,
            ) or []
            for neighbor in neighbor_rows:
                neighbor_lookup.setdefault(neighbor["lead_analysis_id"], []).append(neighbor)

        results = []
        for stop_row in stop_rows:
            lead_id = stop_row.get("lead_id")
            lead_row = lead_lookup.get(lead_id)
            analysis_row = analysis_lookup.get(lead_id)
            if not lead_row or not analysis_row:
                continue
            analysis_row = dict(analysis_row)
            analysis_row["lead_neighbors"] = neighbor_lookup.get(analysis_row["id"], [])
            results.append(_draft_result_from_parts(lead_row, analysis_row))
        return results
    except Exception:
        return []


def create_route_run(route_draft_id, selected_results, start_lat=None, start_lng=None, start_label=None, auth_context=None):
    if not supabase_enabled() or not selected_results:
        return None
    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id:
        return None

    try:
        route_run_rows = _request(
            "POST",
            "route_runs",
            json_body={
                "organization_id": organization_id,
                "route_draft_id": route_draft_id,
                "rep_id": current_user_id,
                "status": "active",
                "optimization_mode": "drive_time",
                "started_from_lat": start_lat,
                "started_from_lng": start_lng,
                "started_from_label": start_label or "Current location placeholder",
            },
            prefer="return=representation",
            auth_context=auth_context,
        )
        if not route_run_rows:
            return None

        route_run = route_run_rows[0]
        stop_payloads = []
        for idx, result in enumerate(selected_results, start=1):
            stop_payloads.append(
                {
                    "route_run_id": route_run["id"],
                    "lead_id": result.get("lead_id"),
                    "is_ad_hoc": bool(result.get("is_ad_hoc", False)),
                    "address": result.get("address"),
                    "lat": result.get("lat"),
                    "lng": result.get("lng"),
                    "sequence_number": idx,
                    "stop_status": "pending",
                }
            )

        route_run_stops = []
        if stop_payloads:
            route_run_stops = _request(
                "POST",
                "route_run_stops",
                json_body=stop_payloads,
                prefer="return=representation",
                auth_context=auth_context,
            ) or []

        _request(
            "POST",
            "route_run_events",
            json_body={
                "route_run_id": route_run["id"],
                "event_type": "run_started",
                "event_payload": {
                    "start_lat": start_lat,
                    "start_lng": start_lng,
                    "stop_count": len(stop_payloads),
                },
                "created_by": current_user_id,
            },
            prefer="return=minimal",
            auth_context=auth_context,
        )

        return {"route_run": route_run, "route_run_stops": route_run_stops}
    except Exception:
        return None


def update_route_run_stop(
    route_run_stop_id,
    *,
    stop_status=None,
    outcome=None,
    disposition=None,
    skipped_reason=None,
    homeowner_name=None,
    phone=None,
    email=None,
    best_follow_up_time=None,
    interest_level=None,
    notes=None,
    auth_context=None,
):
    if not supabase_enabled():
        return False

    payload = {}
    if stop_status is not None:
        payload["stop_status"] = stop_status
    if outcome is not None:
        payload["outcome"] = outcome
    if disposition is not None:
        payload["disposition"] = disposition
    if skipped_reason is not None:
        payload["skipped_reason"] = skipped_reason
    if homeowner_name is not None:
        payload["homeowner_name"] = homeowner_name
    if phone is not None:
        payload["phone"] = phone
    if email is not None:
        payload["email"] = email
    if best_follow_up_time is not None:
        payload["best_follow_up_time"] = best_follow_up_time
    if interest_level is not None:
        payload["interest_level"] = interest_level
    if notes is not None:
        payload["notes"] = notes
    if stop_status == "completed":
        payload["completed_at"] = datetime.now(timezone.utc).isoformat()

    try:
        _request(
            "PATCH",
            "route_run_stops",
            params={"id": f"eq.{route_run_stop_id}"},
            json_body=payload,
            prefer="return=minimal",
            auth_context=auth_context,
        )
        return True
    except Exception:
        return False


def save_analysis_result(row_data, result, auth_context=None):
    if not supabase_enabled():
        return None
    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id:
        return {"ok": False, "error": "No active organization selected."}

    cache_key = make_analysis_cache_key(row_data)
    try:
        lead_rows = _request(
            "POST",
            "leads",
            params={"on_conflict": "organization_id,normalized_address"},
            json_body={
                **_lead_payload(result),
                "organization_id": organization_id,
                "created_by": current_user_id,
            },
            prefer="resolution=merge-duplicates,return=representation",
            auth_context=auth_context,
        )
        if not lead_rows:
            return None
        lead_id = lead_rows[0]["id"]

        existing_analysis = _request(
            "GET",
            "lead_analysis",
            params={
                "lead_id": f"eq.{lead_id}",
                "select": "id",
                "order": "updated_at.desc",
                "limit": "1",
            },
            auth_context=auth_context,
        )

        analysis_payload = _analysis_payload(cache_key, lead_id, result)
        legacy_analysis_payload = dict(analysis_payload)
        legacy_analysis_payload.pop("solar_details", None)
        if existing_analysis:
            analysis_id = existing_analysis[0]["id"]
            try:
                updated_rows = _request(
                    "PATCH",
                    "lead_analysis",
                    params={
                        "id": f"eq.{analysis_id}",
                        "select": "id",
                    },
                    json_body=analysis_payload,
                    prefer="return=representation",
                    auth_context=auth_context,
                )
            except Exception as err:
                if not _missing_solar_details_column(err):
                    raise
                updated_rows = _request(
                    "PATCH",
                    "lead_analysis",
                    params={
                        "id": f"eq.{analysis_id}",
                        "select": "id",
                    },
                    json_body=legacy_analysis_payload,
                    prefer="return=representation",
                    auth_context=auth_context,
                )
            if not updated_rows:
                return None
            analysis_id = updated_rows[0]["id"]
        else:
            try:
                created_rows = _request(
                    "POST",
                    "lead_analysis",
                    json_body=analysis_payload,
                    prefer="return=representation",
                    auth_context=auth_context,
                )
            except Exception as err:
                if not _missing_solar_details_column(err):
                    raise
                created_rows = _request(
                    "POST",
                    "lead_analysis",
                    json_body=legacy_analysis_payload,
                    prefer="return=representation",
                    auth_context=auth_context,
                )
            if not created_rows:
                return None
            analysis_id = created_rows[0]["id"]

        _request(
            "DELETE",
            "lead_neighbors",
            params={"lead_analysis_id": f"eq.{analysis_id}"},
            auth_context=auth_context,
        )
        neighbor_payloads = _neighbor_payloads(analysis_id, result)
        if neighbor_payloads:
            _request(
                "POST",
                "lead_neighbors",
                json_body=neighbor_payloads,
                prefer="return=minimal",
                auth_context=auth_context,
            )
        _cleanup_duplicate_lead_analysis_rows(lead_id, analysis_id, auth_context=auth_context)
        return {
            "ok": True,
            "lead_id": lead_id,
            "lead_analysis_id": analysis_id,
        }
    except Exception as err:
        return {
            "ok": False,
            "error": str(err),
        }


def _quoted(value):
    return f'"{str(value).replace(chr(34), "")}"'


def _draft_result_from_parts(lead_row, analysis_row):
    neighbor_rows = analysis_row.get("lead_neighbors", [])
    result = {
        "lead_id": lead_row.get("id"),
        "address": lead_row.get("address", ""),
        "lat": lead_row.get("lat"),
        "lng": lead_row.get("lng"),
        "zipcode": lead_row.get("zipcode", "Unknown"),
        "sun_hours": analysis_row.get("sun_hours"),
        "sun_hours_display": analysis_row.get("sun_hours_display", "N/A"),
        "category": analysis_row.get("category", "Unknown"),
        "street_view_link": analysis_row.get("street_view_link", ""),
        "parking_ease": analysis_row.get("parking_ease", ""),
        "walkable_count": analysis_row.get("walkable_count", 0),
        "ideal_count": analysis_row.get("ideal_count", 0),
        "good_count": analysis_row.get("good_count", 0),
        "priority_score": analysis_row.get("priority_score", 0),
        "priority_label": analysis_row.get("priority_label", ""),
        "parking_address": analysis_row.get("parking_address") or lead_row.get("address", ""),
        "doors_to_knock": analysis_row.get("doors_to_knock", 0),
        "knock_addresses": _knock_addresses(
            lead_row.get("address", ""),
            neighbor_rows,
            analysis_row.get("category"),
        ),
        "neighbor_records": [_neighbor_record_from_row(item) for item in neighbor_rows],
        "sale_price": analysis_row.get("sale_price"),
        "price_display": analysis_row.get("price_display", "N/A"),
        "value_badge": analysis_row.get("value_badge", "Unknown"),
        "sqft": analysis_row.get("sqft"),
        "sqft_display": analysis_row.get("sqft_display", "N/A"),
        "sold_date": analysis_row.get("sold_date", "Unknown"),
        "permit_pulled": analysis_row.get("permit_pulled", "Unknown"),
        "beds": analysis_row.get("beds", ""),
        "baths": analysis_row.get("baths", ""),
        "value_score": analysis_row.get("value_score", 0),
        "sqft_score": analysis_row.get("sqft_score", 0),
        "analysis_error": analysis_row.get("analysis_error"),
        "first_name": lead_row.get("first_name"),
        "last_name": lead_row.get("last_name"),
        "phone": lead_row.get("phone"),
        "email": lead_row.get("email"),
        "notes": lead_row.get("notes"),
        "unqualified": lead_row.get("unqualified"),
        "unqualified_reason": lead_row.get("unqualified_reason"),
        "listing_agent": lead_row.get("listing_agent"),
    }
    return _merge_solar_details(result, analysis_row.get("solar_details"))
