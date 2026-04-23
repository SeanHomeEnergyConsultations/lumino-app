import os
import math
import re
import secrets
import string
import time
from datetime import datetime, timezone

import requests

from engine.cache_keys import make_analysis_cache_key
from engine.normalization import coerce_zipcode
from engine.scoring import score_home_value, score_sqft
try:
    from engine.lead_workflow import (
        ACTIVITY_TYPE_OPTIONS,
        FLAG_OPTIONS,
        LEAD_STATUS_OPTIONS,
        OUTCOME_OPTIONS,
        allowed_outcomes_for_activity,
        derive_lead_follow_up,
    )
except ModuleNotFoundError:
    # Deployment safety net: keep lead workflow logic available from an existing module.
    from engine.constants import (
        ACTIVITY_TYPE_OPTIONS,
        FLAG_OPTIONS,
        LEAD_STATUS_OPTIONS,
        OUTCOME_OPTIONS,
        allowed_outcomes_for_activity,
        derive_lead_follow_up,
    )


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


def _request_rpc(function_name, *, payload=None, auth_context=None, prefer=None):
    return _request(
        "POST",
        f"rpc/{function_name}",
        json_body=payload or {},
        prefer=prefer,
        auth_context=auth_context,
    )


def _missing_import_batch_source_payload_column(error):
    message = str(error or "")
    return "source_payload" in message and "import_batch_items" in message


def _request_paged_get(path, *, params=None, auth_context=None, desired_limit=None, page_size=500):
    collected = []
    offset = 0
    base_params = dict(params or {})
    base_params.pop("offset", None)
    base_params.pop("limit", None)

    while True:
        remaining = None if desired_limit is None else max(int(desired_limit) - len(collected), 0)
        if remaining == 0:
            break
        batch_size = page_size if remaining is None else min(page_size, remaining)
        page_rows = _request(
            "GET",
            path,
            params={
                **base_params,
                "limit": str(batch_size),
                "offset": str(offset),
            },
            auth_context=auth_context,
        ) or []
        if not page_rows:
            break
        collected.extend(page_rows)
        if len(page_rows) < batch_size:
            break
        offset += len(page_rows)

    return collected


def _count_rows(path, *, params=None, auth_context=None):
    response = requests.request(
        "HEAD",
        f"{_base_url()}/rest/v1/{path.lstrip('/')}",
        headers={
            **_headers(prefer="count=exact", auth_context=auth_context),
            "Range": "0-0",
        },
        params=params,
        timeout=TIMEOUT_SECONDS,
    )
    if response.status_code >= 400:
        return None
    content_range = response.headers.get("Content-Range", "")
    if "/" in content_range:
        try:
            return int(content_range.split("/")[-1])
        except Exception:
            return None
    return None


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


def _safe_float(value):
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except Exception:
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def _safe_number(value):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return None
        return number
    text = str(value).strip()
    if not text:
        return None
    compact = text.replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", compact)
    if not match:
        return None
    try:
        number = float(match.group(0))
    except Exception:
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def _safe_int(value):
    number = _safe_number(value)
    if number is None:
        return None
    try:
        return int(round(number))
    except Exception:
        return None


def _safe_iso_date(value):
    text = str(value or "").strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized).date().isoformat()
    except Exception:
        pass
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%m-%d-%Y", "%m-%d-%y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except Exception:
            continue
    return None


def _normalize_address(address):
    return " ".join(str(address or "").strip().lower().split())


def _address_street_signature(address):
    street = str(address or "").split(",")[0].strip().lower()
    cleaned = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in street)
    tokens = [token for token in cleaned.split() if token]
    suffix_map = {
        "street": "st",
        "st": "st",
        "road": "rd",
        "rd": "rd",
        "avenue": "ave",
        "ave": "ave",
        "boulevard": "blvd",
        "blvd": "blvd",
        "drive": "dr",
        "dr": "dr",
        "lane": "ln",
        "ln": "ln",
        "court": "ct",
        "ct": "ct",
        "place": "pl",
        "pl": "pl",
        "terrace": "ter",
        "ter": "ter",
        "circle": "cir",
        "cir": "cir",
        "highway": "hwy",
        "hwy": "hwy",
    }
    normalized_tokens = [suffix_map.get(token, token) for token in tokens]
    return " ".join(normalized_tokens)


def _location_fingerprint(row):
    normalized_address = _normalize_address(row.get("address"))
    if normalized_address:
        return f"addr:{normalized_address}"
    lat = row.get("lat")
    lng = row.get("lng")
    if lat is None or lng is None:
        return None
    try:
        return f"coord:{round(float(lat), 5)}:{round(float(lng), 5)}"
    except Exception:
        return None


def _duplicate_group_key(row):
    zipcode = coerce_zipcode(row.get("zipcode"))
    signature = _address_street_signature(row.get("address"))
    lat = row.get("lat")
    lng = row.get("lng")
    rounded_coords = None
    try:
        if lat is not None and lng is not None:
            rounded_coords = (round(float(lat), 5), round(float(lng), 5))
    except Exception:
        rounded_coords = None

    if signature and zipcode:
        return f"streetzip:{signature}|{zipcode}"
    if signature and rounded_coords:
        return f"streetcoord:{signature}|{rounded_coords[0]}|{rounded_coords[1]}"
    if rounded_coords and zipcode:
        return f"coordzip:{rounded_coords[0]}|{rounded_coords[1]}|{zipcode}"
    return None


def _duplicate_confidence(row_a, row_b):
    score = 0
    sig_a = _address_street_signature(row_a.get("address"))
    sig_b = _address_street_signature(row_b.get("address"))
    zip_a = coerce_zipcode(row_a.get("zipcode"))
    zip_b = coerce_zipcode(row_b.get("zipcode"))
    if sig_a and sig_b and sig_a == sig_b:
        score += 3
    if zip_a and zip_b and zip_a == zip_b:
        score += 2
    try:
        if row_a.get("lat") is not None and row_a.get("lng") is not None and row_b.get("lat") is not None and row_b.get("lng") is not None:
            if abs(float(row_a.get("lat")) - float(row_b.get("lat"))) <= 0.0002 and abs(float(row_a.get("lng")) - float(row_b.get("lng"))) <= 0.0002:
                score += 4
    except Exception:
        pass
    if _normalize_address(row_a.get("address")) and _normalize_address(row_a.get("address")) == _normalize_address(row_b.get("address")):
        score += 4
    return score


def _duplicate_confidence_label(score):
    if score >= 8:
        return "Exact"
    if score >= 6:
        return "High"
    return "Review"


def _iso_or_none(value):
    text = str(value or "").strip()
    return text or None


def _parse_iso_datetime(value):
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except Exception:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def _valid_json_flag_list(value):
    flags = []
    raw_flags = value or []
    if isinstance(raw_flags, str):
        raw_flags = [raw_flags]
    for flag in raw_flags:
        cleaned = str(flag or "").strip()
        if cleaned in FLAG_OPTIONS and cleaned not in flags:
            flags.append(cleaned)
    return flags


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
        "lead_id": lead_row.get("id"),
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
        "permit_pulled": row.get("permit_pulled"),
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
        "appointment_at": lead_row.get("appointment_at"),
        "lead_status": lead_row.get("lead_status"),
    }
    return _apply_display_priority(_merge_solar_details(result, row.get("solar_details")))


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
        "permit_pulled": row.get("permit_pulled"),
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
        "appointment_at": row.get("appointment_at"),
        "lead_status": row.get("lead_status"),
    }
    return _apply_display_priority(_merge_solar_details(result, row.get("solar_details")))


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


def _address_line_1_from_address(address):
    return _string_or_none(str(address or "").split(",")[0])


def _payload_value(payload, *keys):
    if not isinstance(payload, dict):
        return None
    lowered = {str(key).strip().lower(): key for key in payload.keys()}
    for key in keys:
        if key in payload and payload.get(key) not in (None, ""):
            return payload.get(key)
        matched_key = lowered.get(str(key).strip().lower())
        if matched_key is not None and payload.get(matched_key) not in (None, ""):
            return payload.get(matched_key)
    return None


def _calculate_property_data_completeness(facts):
    tracked_fields = [
        "beds",
        "baths",
        "square_feet",
        "lot_size_sqft",
        "year_built",
        "last_sale_date",
        "last_sale_price",
        "property_type",
        "listing_status",
        "sale_type",
        "days_on_market",
        "hoa_monthly",
    ]
    populated = sum(1 for field in tracked_fields if facts.get(field) not in (None, ""))
    return int(round((populated / len(tracked_fields)) * 100)) if tracked_fields else 0


def _extract_property_facts(source_payload=None, analysis_result=None):
    payload = source_payload or {}
    result = analysis_result or {}
    facts = {
        "beds": _safe_number(_payload_value(payload, "Beds", "BEDS", "beds", "beds_count")) or _safe_number(result.get("beds")),
        "baths": _safe_number(_payload_value(payload, "Baths", "BATHS", "baths", "bathrooms")) or _safe_number(result.get("baths")),
        "square_feet": _safe_int(_payload_value(payload, "SqFt", "SQFT", "SQUARE FEET", "square feet", "square_feet")) or _safe_int(result.get("sqft")),
        "lot_size_sqft": _safe_number(_payload_value(payload, "LOT SIZE", "Lot Size", "lot_size_sqft")),
        "year_built": _safe_int(_payload_value(payload, "YEAR BUILT", "Year Built", "year_built")),
        "last_sale_date": _safe_iso_date(_payload_value(payload, "Sale Date", "SOLD DATE", "sale_date", "sold_date")) or _safe_iso_date(result.get("sold_date")),
        "last_sale_price": _safe_number(_payload_value(payload, "Price", "PRICE", "price")) or _safe_number(result.get("sale_price")),
        "property_type": _string_or_none(_payload_value(payload, "PROPERTY TYPE", "Property Type", "property_type")),
        "listing_status": _string_or_none(_payload_value(payload, "STATUS", "Status", "listing_status")),
        "sale_type": _string_or_none(_payload_value(payload, "SALE TYPE", "Sale Type", "sale_type")),
        "days_on_market": _safe_int(_payload_value(payload, "DAYS ON MARKET", "Days On Market", "days_on_market")),
        "hoa_monthly": _safe_number(_payload_value(payload, "HOA/MONTH", "HOA", "hoa_monthly")),
    }
    facts["data_completeness_score"] = _calculate_property_data_completeness(facts)
    return facts


def _request_properties_write_with_fallback(method, params, payload, *, prefer, auth_context=None):
    working_payload = dict(payload or {})
    for _ in range(16):
        try:
            return _request(
                method,
                "properties",
                params=params,
                json_body=working_payload,
                prefer=prefer,
                auth_context=auth_context,
            )
        except Exception as err:
            missing_column = _missing_table_column(err, "properties")
            error_text = str(err or "").lower()
            if missing_column and missing_column in working_payload:
                working_payload.pop(missing_column, None)
                continue
            if "properties.organization_id" in error_text and "organization_id" in working_payload:
                working_payload.pop("organization_id", None)
                continue
            raise
    return _request(
        method,
        "properties",
        params=params,
        json_body=working_payload,
        prefer=prefer,
        auth_context=auth_context,
    )


def _request_property_enrichments_write_with_fallback(method, params, payload, *, prefer, auth_context=None):
    working_payload = dict(payload or {})
    for _ in range(12):
        try:
            return _request(
                method,
                "property_enrichments",
                params=params,
                json_body=working_payload,
                prefer=prefer,
                auth_context=auth_context,
            )
        except Exception as err:
            missing_column = _missing_table_column(err, "property_enrichments")
            if missing_column and missing_column in working_payload:
                working_payload.pop(missing_column, None)
                continue
            if "property_enrichments" in str(err or "").lower():
                return None
            raise
    return _request(
        method,
        "property_enrichments",
        params=params,
        json_body=working_payload,
        prefer=prefer,
        auth_context=auth_context,
    )


def _get_property_by_lookup(*, organization_id, property_id=None, normalized_address=None, auth_context=None):
    if not organization_id:
        return None
    base_params = {
        "select": "id,normalized_address,raw_address,address_line_1,city,state,postal_code,zipcode,lat,lng",
        "limit": "1",
    }
    if property_id:
        base_params["id"] = f"eq.{property_id}"
    elif normalized_address:
        base_params["normalized_address"] = f"eq.{normalized_address}"
    else:
        return None

    try:
        rows = _request(
            "GET",
            "properties",
            params={
                **base_params,
                "organization_id": f"eq.{organization_id}",
            },
            auth_context=auth_context,
        ) or []
        return (rows or [None])[0]
    except Exception as err:
        error_text = str(err or "").lower()
        missing_column = _missing_table_column(err, "properties")
        if missing_column != "organization_id" and "properties.organization_id" not in error_text:
            raise
        rows = _request(
            "GET",
            "properties",
            params=base_params,
            auth_context=auth_context,
        ) or []
        return (rows or [None])[0]


def _sync_lead_property_link(lead_id, property_id, *, auth_context=None):
    if not lead_id or not property_id:
        return
    try:
        _request_leads_with_fallback(
            "PATCH",
            params={"id": f"eq.{lead_id}"},
            payload={"property_id": property_id},
            prefer="return=minimal",
            auth_context=auth_context,
        )
    except Exception:
        return


def _upsert_property_record(
    *,
    organization_id,
    lead_row,
    source_payload=None,
    analysis_result=None,
    auth_context=None,
):
    if not organization_id:
        return None
    source_payload = source_payload or {}
    analysis_result = analysis_result or {}
    address = _string_or_none(
        source_payload.get("address")
        or source_payload.get("raw_address")
        or (lead_row or {}).get("address")
        or analysis_result.get("address")
    )
    normalized_address = _normalize_address(address)
    if not normalized_address:
        return None

    facts = _extract_property_facts(source_payload, analysis_result)
    core_payload = {
        "organization_id": organization_id,
        "normalized_address": normalized_address,
        "raw_address": address,
        "address_line_1": _address_line_1_from_address(address),
        "city": _string_or_none(source_payload.get("city") or (lead_row or {}).get("city")),
        "state": _string_or_none(source_payload.get("state") or (lead_row or {}).get("state")),
        "postal_code": coerce_zipcode(source_payload.get("zipcode") or (lead_row or {}).get("zipcode")),
        "zipcode": coerce_zipcode(source_payload.get("zipcode") or (lead_row or {}).get("zipcode")),
        "lat": _safe_float(source_payload.get("source_latitude") or (lead_row or {}).get("lat") or analysis_result.get("lat")),
        "lng": _safe_float(source_payload.get("source_longitude") or (lead_row or {}).get("lng") or analysis_result.get("lng")),
        "current_lead_id": (lead_row or {}).get("id"),
        **facts,
    }
    payload = {key: value for key, value in core_payload.items() if value not in (None, "")}

    property_row = _get_property_by_lookup(
        organization_id=organization_id,
        normalized_address=normalized_address,
        auth_context=auth_context,
    )
    if property_row:
        updated_rows = _request_properties_write_with_fallback(
            "PATCH",
            params={
                "id": f"eq.{property_row['id']}",
                "select": "id,normalized_address,raw_address,address_line_1,city,state,postal_code,zipcode,lat,lng",
            },
            payload=payload,
            prefer="return=representation",
            auth_context=auth_context,
        ) or []
        property_row = (updated_rows or [property_row])[0]
    else:
        created_rows = _request_properties_write_with_fallback(
            "POST",
            params={"select": "id,normalized_address,raw_address,address_line_1,city,state,postal_code,zipcode,lat,lng"},
            payload=payload,
            prefer="return=representation",
            auth_context=auth_context,
        ) or []
        property_row = (created_rows or [None])[0]

    if property_row and (lead_row or {}).get("id"):
        _sync_lead_property_link((lead_row or {}).get("id"), property_row.get("id"), auth_context=auth_context)
    return property_row


def _insert_property_source_record(
    *,
    organization_id,
    property_id,
    current_user_id,
    batch_row=None,
    source_payload=None,
    source_row_number=None,
    auth_context=None,
):
    if not organization_id or not property_id or not source_payload:
        return None
    record_payload = {
        "organization_id": organization_id,
        "property_id": property_id,
        "source_type": "csv_import",
        "source_name": (batch_row or {}).get("filename") or (batch_row or {}).get("source_name") or "Imported list",
        "source_batch_id": str((batch_row or {}).get("id")) if (batch_row or {}).get("id") else None,
        "source_record_id": str(source_row_number) if source_row_number not in (None, "") else None,
        "record_date": _safe_iso_date(
            _payload_value(source_payload, "Sale Date", "SOLD DATE", "sale_date", "sold_date")
        ),
        "payload": _json_safe(source_payload),
        "created_by": current_user_id,
    }
    try:
        rows = _request(
            "POST",
            "property_source_records",
            json_body=record_payload,
            prefer="return=representation",
            auth_context=auth_context,
        ) or []
        return (rows or [None])[0]
    except Exception:
        return None


def _sync_property_solar_enrichment(
    *,
    organization_id,
    property_id,
    analysis_result,
    auth_context=None,
):
    if not organization_id or not property_id or not analysis_result:
        return None
    solar_payload = _solar_details_payload(analysis_result)
    if not any(value not in (None, "", 0) for value in solar_payload.values()):
        return None

    enrichment_payload = {
        "organization_id": organization_id,
        "property_id": property_id,
        "provider": "google_solar",
        "enrichment_type": "solar",
        "status": "complete",
        "payload": solar_payload,
    }
    try:
        existing_rows = _request(
            "GET",
            "property_enrichments",
            params={
                "property_id": f"eq.{property_id}",
                "provider": "eq.google_solar",
                "enrichment_type": "eq.solar",
                "select": "id",
                "order": "fetched_at.desc",
                "limit": "1",
            },
            auth_context=auth_context,
        ) or []
    except Exception:
        return None
    existing_row = (existing_rows or [None])[0]
    if existing_row:
        updated_rows = _request_property_enrichments_write_with_fallback(
            "PATCH",
            params={"id": f"eq.{existing_row['id']}", "select": "id"},
            payload=enrichment_payload,
            prefer="return=representation",
            auth_context=auth_context,
        ) or []
        return (updated_rows or [existing_row])[0]
    created_rows = _request_property_enrichments_write_with_fallback(
        "POST",
        params={"select": "id"},
        payload=enrichment_payload,
        prefer="return=representation",
        auth_context=auth_context,
    ) or []
    return (created_rows or [None])[0]


def _visit_interest_level(value):
    cleaned = str(value or "").strip().lower()
    mapping = {
        "hot": "high",
        "warm": "medium",
        "cold": "low",
        "high": "high",
        "medium": "medium",
        "low": "low",
    }
    return mapping.get(cleaned) or None


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


def _missing_table_column(error, table_name):
    message = str(error)
    marker = f"column of '{table_name}' in the schema cache"
    if marker not in message:
        lowered = message.lower()
        if table_name.lower() not in lowered or "could not find the '" not in lowered:
            return None
    prefix = "Could not find the '"
    start = message.find(prefix)
    if start == -1:
        return None
    start += len(prefix)
    end = message.find("'", start)
    if end == -1:
        return None
    return message[start:end]


def _missing_open_lead_pool_column(error):
    message = str(error).lower()
    return "open_lead_pool" in message and ("column" in message or "schema cache" in message)


def _missing_lead_followup_column(error):
    message = str(error).lower()
    return "leads" in message and ("lead_status" in message or "follow_up_flags" in message or "column" in message or "schema cache" in message)


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


def _request_lead_analysis_with_fallback(method, params, payload, *, prefer, auth_context=None):
    working_payload = dict(payload or {})
    for _ in range(8):
        try:
            return _request(
                method,
                "lead_analysis",
                params=params,
                json_body=working_payload,
                prefer=prefer,
                auth_context=auth_context,
            )
        except Exception as err:
            missing_column = _missing_table_column(err, "lead_analysis")
            if not missing_column or missing_column not in working_payload:
                raise
            working_payload.pop(missing_column, None)
    return _request(
        method,
        "lead_analysis",
        params=params,
        json_body=working_payload,
        prefer=prefer,
        auth_context=auth_context,
    )


def _request_leads_with_fallback(method, params, payload, *, prefer, auth_context=None):
    working_payload = dict(payload or {})
    for _ in range(8):
        try:
            return _request(
                method,
                "leads",
                params=params,
                json_body=working_payload,
                prefer=prefer,
                auth_context=auth_context,
            )
        except Exception as err:
            missing_column = _missing_table_column(err, "leads")
            if not missing_column or missing_column not in working_payload:
                raise
            working_payload.pop(missing_column, None)
    return _request(
        method,
        "leads",
        params=params,
        json_body=working_payload,
        prefer=prefer,
        auth_context=auth_context,
    )


def _request_lead_analysis_get_with_fallback(*, params, auth_context=None, paged=True, desired_limit=None):
    select_fields = [
        field.strip()
        for field in str((params or {}).get("select") or "").split(",")
        if field.strip()
    ]
    working_params = dict(params or {})
    for _ in range(12):
        try:
            working_params["select"] = ",".join(select_fields)
            if paged:
                return _request_paged_get(
                    "lead_analysis",
                    params=working_params,
                    auth_context=auth_context,
                    desired_limit=desired_limit,
                )
            return _request(
                "GET",
                "lead_analysis",
                params=working_params,
                auth_context=auth_context,
            )
        except Exception as err:
            missing_column = _missing_table_column(err, "lead_analysis")
            if not missing_column or missing_column not in select_fields:
                raise
            select_fields = [field for field in select_fields if field != missing_column]
            if not select_fields:
                return []
    working_params["select"] = ",".join(select_fields)
    if paged:
        return _request_paged_get(
            "lead_analysis",
            params=working_params,
            auth_context=auth_context,
            desired_limit=desired_limit,
        )
    return _request(
        "GET",
        "lead_analysis",
        params=working_params,
        auth_context=auth_context,
    )


def _apply_display_priority(result):
    adjusted = dict(result or {})
    current_priority = int(adjusted.get("priority_score") or 0)
    if current_priority > 0:
        return adjusted

    sale_price = adjusted.get("sale_price")
    sqft = adjusted.get("sqft")
    sun_hours = adjusted.get("sun_hours")
    category = str(adjusted.get("category") or "").strip()
    value_score, _, _ = score_home_value(sale_price)
    sqft_score, _ = score_sqft(sqft)

    solar_hint = 0
    if sun_hours is not None:
        try:
            if float(sun_hours) >= 1400:
                solar_hint = 2
            elif float(sun_hours) >= 1200:
                solar_hint = 1
        except Exception:
            solar_hint = 0
    elif category in {"Best", "Better", "Good", "Fast Review"}:
        solar_hint = 1

    provisional_total = int(value_score or 0) + int(sqft_score or 0) + solar_hint
    if provisional_total >= 4:
        adjusted["priority_score"] = 2
        adjusted["priority_label"] = adjusted.get("priority_label") or "HIGH — Fast provisional"
    elif provisional_total >= 2:
        adjusted["priority_score"] = 1
        adjusted["priority_label"] = adjusted.get("priority_label") or "MEDIUM — Fast provisional"
    return adjusted


def _enrich_rows_with_analysis(rows, auth_context=None, chunk_size=50):
    enriched_rows = list(rows or [])
    if not enriched_rows:
        return enriched_rows

    lead_ids = [row.get("id") for row in enriched_rows if row.get("id")]
    analysis_lookup = {}
    for lead_id_chunk in _chunked(lead_ids, chunk_size):
        try:
            analysis_rows = _request_lead_analysis_get_with_fallback(
                params={
                    "lead_id": f"in.({','.join(_quoted(lead_id) for lead_id in lead_id_chunk)})",
                    "select": (
                        "lead_id,sale_price,price_display,sqft,sqft_display,beds,baths,sold_date,permit_pulled,"
                        "priority_score,priority_label,category,sun_hours,sun_hours_display,doors_to_knock,updated_at,created_at"
                    ),
                    "order": "updated_at.desc,created_at.desc,id.desc",
                },
                auth_context=auth_context,
                paged=True,
            ) or []
        except Exception:
            continue
        for analysis_row in analysis_rows:
            lead_id = analysis_row.get("lead_id")
            if lead_id and lead_id not in analysis_lookup:
                analysis_lookup[lead_id] = analysis_row

    for row in enriched_rows:
        analysis_row = analysis_lookup.get(row.get("id"), {})
        for field in [
            "sale_price",
            "price_display",
            "sqft",
            "sqft_display",
            "beds",
            "baths",
            "sold_date",
            "permit_pulled",
            "priority_score",
            "priority_label",
            "category",
            "sun_hours",
            "sun_hours_display",
            "doors_to_knock",
        ]:
            if field not in row or row.get(field) in (None, "", 0):
                row[field] = analysis_row.get(field, row.get(field))
        display_adjusted = _apply_display_priority(row)
        row.update(display_adjusted)
    return enriched_rows


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
        "permit_pulled": None,
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
        "appointment_at": lead_row.get("appointment_at"),
        "lead_status": lead_row.get("lead_status"),
    }
    return _apply_display_priority(_merge_solar_details(result, None))


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
    best_by_fingerprint = {}
    for row in deduped_rows:
        fingerprint = _location_fingerprint(row)
        if not fingerprint:
            fingerprint = f"lead:{row.get('lead_id') or row.get('id')}"
        current = best_by_fingerprint.get(fingerprint)
        if current is None or _open_lead_result_rank(row) > _open_lead_result_rank(current):
            best_by_fingerprint[fingerprint] = row
    deduped_rows = list(best_by_fingerprint.values())
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


def _find_existing_lead_by_normalized_address(organization_id, normalized_address, auth_context=None):
    if not organization_id or not normalized_address:
        return None
    rows = _request(
        "GET",
        "leads",
        params={
            "organization_id": f"eq.{organization_id}",
            "normalized_address": f"eq.{normalized_address}",
            "select": "id,address,normalized_address,zipcode,lat,lng",
            "limit": "1",
        },
        auth_context=auth_context,
    ) or []
    return (rows or [None])[0]


def _find_high_confidence_duplicate_lead(organization_id, result, auth_context=None):
    if not organization_id:
        return None

    zipcode = coerce_zipcode(result.get("zipcode"))
    street_signature = _address_street_signature(result.get("address"))
    lat = result.get("lat")
    lng = result.get("lng")

    if not zipcode and (lat is None or lng is None):
        return None

    params = {
        "organization_id": f"eq.{organization_id}",
        "select": "id,address,normalized_address,zipcode,lat,lng",
        "order": "updated_at.desc",
        "limit": "50",
    }
    if zipcode:
        params["zipcode"] = f"eq.{zipcode}"

    try:
        rows = _request("GET", "leads", params=params, auth_context=auth_context) or []
    except Exception:
        return None

    best_row = None
    best_score = -1
    for row in rows:
        score = 0
        candidate_signature = _address_street_signature(row.get("address"))
        if street_signature and candidate_signature and street_signature == candidate_signature:
            score += 3
        if zipcode and row.get("zipcode") and coerce_zipcode(row.get("zipcode")) == zipcode:
            score += 1
        try:
            if lat is not None and lng is not None and row.get("lat") is not None and row.get("lng") is not None:
                if abs(float(row.get("lat")) - float(lat)) <= 0.0002 and abs(float(row.get("lng")) - float(lng)) <= 0.0002:
                    score += 4
        except Exception:
            pass
        if score > best_score:
            best_score = score
            best_row = row

    return best_row if best_score >= 4 else None


def _lead_status_rank(value):
    order = {
        "New": 0,
        "Attempting Contact": 1,
        "Connected": 2,
        "Nurture": 3,
        "Appointment Set": 4,
        "Qualified": 5,
        "Closed Won": 6,
        "Closed Lost": 6,
        "Do Not Contact": 7,
    }
    return order.get(str(value or "").strip(), -1)


def _legacy_status_rank(value):
    order = {
        "open": 0,
        "assigned": 1,
        "in_progress": 2,
        "completed": 3,
        "disqualified": 4,
        "skipped": -1,
    }
    return order.get(str(value or "").strip().lower(), -1)


def _combine_unique_text(*values):
    parts = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        lowered = text.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        parts.append(text)
    return "\n\n".join(parts) if parts else None


def _pick_better_address(primary, secondary):
    primary_text = str(primary or "").strip()
    secondary_text = str(secondary or "").strip()
    if not primary_text:
        return secondary_text or None
    if not secondary_text:
        return primary_text
    if _address_street_signature(primary_text) != _address_street_signature(secondary_text):
        return primary_text
    return secondary_text if len(secondary_text) > len(primary_text) else primary_text


def _pick_datetime(value_a, value_b, *, prefer="max", future_only=False):
    dt_a = _parse_iso_datetime(value_a)
    dt_b = _parse_iso_datetime(value_b)
    if future_only:
        now = datetime.now(timezone.utc)
        if dt_a and dt_a < now:
            dt_a = None
        if dt_b and dt_b < now:
            dt_b = None
    candidates = [dt for dt in [dt_a, dt_b] if dt is not None]
    if not candidates:
        return None
    if prefer == "min":
        return min(candidates).isoformat()
    return max(candidates).isoformat()


def _merge_lead_rows(canonical, duplicate):
    merged = dict(canonical or {})
    duplicate = dict(duplicate or {})

    merged_address = _pick_better_address(merged.get("address"), duplicate.get("address"))
    merged["address"] = merged_address or merged.get("address")
    merged["normalized_address"] = _normalize_address(merged.get("address"))
    merged["zipcode"] = coerce_zipcode(merged.get("zipcode")) or coerce_zipcode(duplicate.get("zipcode"))

    for field in ["lat", "lng", "first_name", "last_name", "phone", "email", "listing_agent", "source", "assigned_to", "created_by"]:
        if merged.get(field) in (None, "") and duplicate.get(field) not in (None, ""):
            merged[field] = duplicate.get(field)

    merged["owner_name"] = _combine_name(merged.get("first_name"), merged.get("last_name")) or merged.get("owner_name")
    merged["notes"] = _combine_unique_text(merged.get("notes"), duplicate.get("notes"))
    merged["unqualified_reason"] = _combine_unique_text(merged.get("unqualified_reason"), duplicate.get("unqualified_reason"))

    if _lead_status_rank(duplicate.get("lead_status")) > _lead_status_rank(merged.get("lead_status")):
        merged["lead_status"] = duplicate.get("lead_status")
    if _legacy_status_rank(duplicate.get("status")) > _legacy_status_rank(merged.get("status")):
        merged["status"] = duplicate.get("status")

    if str(merged.get("assignment_status") or "").lower() == "unassigned" and str(duplicate.get("assignment_status") or "").lower() != "unassigned":
        merged["assignment_status"] = duplicate.get("assignment_status")
        if duplicate.get("assigned_to"):
            merged["assigned_to"] = duplicate.get("assigned_to")

    if merged.get("unqualified") is None and duplicate.get("unqualified") is not None:
        merged["unqualified"] = duplicate.get("unqualified")
    if not merged.get("nurture_reason") and duplicate.get("nurture_reason"):
        merged["nurture_reason"] = duplicate.get("nurture_reason")
    if not merged.get("next_recommended_step") and duplicate.get("next_recommended_step"):
        merged["next_recommended_step"] = duplicate.get("next_recommended_step")

    merged["follow_up_flags"] = _valid_json_flag_list((merged.get("follow_up_flags") or []) + (duplicate.get("follow_up_flags") or []))
    merged["first_outreach_at"] = _pick_datetime(merged.get("first_outreach_at"), duplicate.get("first_outreach_at"), prefer="min")
    merged["first_meaningful_contact_at"] = _pick_datetime(merged.get("first_meaningful_contact_at"), duplicate.get("first_meaningful_contact_at"), prefer="min")
    merged["last_outreach_at"] = _pick_datetime(merged.get("last_outreach_at"), duplicate.get("last_outreach_at"), prefer="max")
    merged["last_inbound_at"] = _pick_datetime(merged.get("last_inbound_at"), duplicate.get("last_inbound_at"), prefer="max")
    merged["last_meaningful_contact_at"] = _pick_datetime(merged.get("last_meaningful_contact_at"), duplicate.get("last_meaningful_contact_at"), prefer="max")
    merged["last_activity_at"] = _pick_datetime(merged.get("last_activity_at"), duplicate.get("last_activity_at"), prefer="max")
    merged["next_follow_up_at"] = _pick_datetime(merged.get("next_follow_up_at"), duplicate.get("next_follow_up_at"), prefer="min", future_only=True)
    merged["appointment_at"] = _pick_datetime(merged.get("appointment_at"), duplicate.get("appointment_at"), prefer="min", future_only=True)

    canonical_last = _parse_iso_datetime(canonical.get("last_activity_at"))
    duplicate_last = _parse_iso_datetime(duplicate.get("last_activity_at"))
    if duplicate_last and (canonical_last is None or duplicate_last >= canonical_last):
        if duplicate.get("last_activity_type"):
            merged["last_activity_type"] = duplicate.get("last_activity_type")
        if duplicate.get("last_activity_outcome"):
            merged["last_activity_outcome"] = duplicate.get("last_activity_outcome")

    return merged


def _analysis_row_rank(row):
    try:
        priority_score = int(row.get("priority_score") or 0)
    except Exception:
        priority_score = 0
    try:
        doors_to_knock = int(row.get("doors_to_knock") or 0)
    except Exception:
        doors_to_knock = 0
    return (
        priority_score,
        doors_to_knock,
        1 if row.get("sun_hours") is not None else 0,
        1 if row.get("sale_price") is not None else 0,
        1 if row.get("sqft") is not None else 0,
        len(str(row.get("analysis_error") or "")) * -1,
        str(row.get("updated_at") or row.get("created_at") or ""),
    )


def _analysis_copy_payload(row):
    payload = {}
    for field in [
        "cache_key",
        "sale_price",
        "price_display",
        "value_badge",
        "sqft",
        "sqft_display",
        "beds",
        "baths",
        "sold_date",
        "permit_pulled",
        "sun_hours",
        "sun_hours_display",
        "category",
        "solar_details",
        "priority_score",
        "priority_label",
        "parking_address",
        "parking_ease",
        "doors_to_knock",
        "ideal_count",
        "good_count",
        "walkable_count",
        "street_view_link",
        "value_score",
        "sqft_score",
        "analysis_error",
        "source_hash",
    ]:
        payload[field] = row.get(field)
    return payload


def _upsert_or_merge_lead(organization_id, current_user_id, result, auth_context=None):
    lead_payload = {
        **_lead_payload(result),
        "organization_id": organization_id,
        "created_by": current_user_id,
    }
    normalized_address = lead_payload.get("normalized_address")

    existing_lead = _find_existing_lead_by_normalized_address(
        organization_id,
        normalized_address,
        auth_context=auth_context,
    )
    if existing_lead is None:
        existing_lead = _find_high_confidence_duplicate_lead(
            organization_id,
            result,
            auth_context=auth_context,
        )

    if existing_lead:
        lead_rows = _request(
            "PATCH",
            "leads",
            params={
                "id": f"eq.{existing_lead['id']}",
                "select": "id,address,normalized_address,zipcode,lat,lng",
            },
            json_body=lead_payload,
            prefer="return=representation",
            auth_context=auth_context,
        ) or []
        return (lead_rows or [existing_lead])[0]

    lead_rows = _request(
        "POST",
        "leads",
        params={"on_conflict": "organization_id,normalized_address"},
        json_body=lead_payload,
        prefer="resolution=merge-duplicates,return=representation",
        auth_context=auth_context,
    ) or []
    return (lead_rows or [None])[0]


def _upsert_or_merge_lead_for_ingest(
    organization_id,
    current_user_id,
    row_data,
    *,
    import_batch_id=None,
    auth_context=None,
):
    normalized_address = _normalize_address(row_data.get("address"))
    lead_payload = {
        "organization_id": organization_id,
        "created_by": current_user_id,
        "import_batch_id": import_batch_id,
        "last_import_batch_id": import_batch_id,
        "normalized_address": normalized_address,
        "address": row_data.get("address"),
        "city": str(row_data.get("city") or "").strip() or None,
        "state": str(row_data.get("state") or "").strip() or None,
        "zipcode": coerce_zipcode(row_data.get("zipcode")),
        "lat": _safe_float(row_data.get("source_latitude")),
        "lng": _safe_float(row_data.get("source_longitude")),
        "owner_name": _combine_name(row_data.get("first_name"), row_data.get("last_name")),
        "first_name": row_data.get("first_name"),
        "last_name": row_data.get("last_name"),
        "phone": row_data.get("phone"),
        "email": row_data.get("email"),
        "notes": row_data.get("notes"),
        "unqualified": _coerce_bool(row_data.get("unqualified")),
        "unqualified_reason": row_data.get("unqualified_reason"),
        "listing_agent": row_data.get("listing_agent"),
        "status": "open",
        "lead_status": "New",
        "assignment_status": "unassigned",
        "analysis_status": "pending",
        "last_analysis_requested_at": datetime.now(timezone.utc).isoformat(),
        "last_analysis_error": None,
        "needs_reanalysis": False,
        "source": row_data.get("source") or "imported",
    }

    existing_lead = _find_existing_lead_by_normalized_address(
        organization_id,
        normalized_address,
        auth_context=auth_context,
    )
    match_type = "exact_address" if existing_lead else None
    if existing_lead is None:
        existing_lead = _find_high_confidence_duplicate_lead(
            organization_id,
            lead_payload,
            auth_context=auth_context,
        )
        if existing_lead:
            match_type = "high_confidence"

    if existing_lead:
        existing_rows = _request(
            "GET",
            "leads",
            params={
                "id": f"eq.{existing_lead['id']}",
                "select": (
                    "id,address,normalized_address,zipcode,lat,lng,city,state,first_name,last_name,phone,email,"
                    "notes,listing_agent,analysis_status,analysis_attempt_count,needs_reanalysis"
                ),
                "limit": "1",
            },
            auth_context=auth_context,
        ) or []
        existing_full = (existing_rows or [existing_lead])[0]
        changed_fields = False
        for field in ["address", "city", "state", "zipcode", "lat", "lng", "first_name", "last_name", "phone", "email", "notes", "listing_agent"]:
            new_value = lead_payload.get(field)
            old_value = existing_full.get(field)
            if field in {"lat", "lng"}:
                try:
                    changed_fields = changed_fields or (
                        new_value is not None and old_value is not None and abs(float(new_value) - float(old_value)) > 0.000001
                    ) or (new_value is not None and old_value is None)
                except Exception:
                    changed_fields = changed_fields or (new_value not in (None, "") and old_value != new_value)
            elif new_value not in (None, "") and str(new_value).strip() != str(old_value or "").strip():
                changed_fields = True
        lead_payload["needs_reanalysis"] = bool(changed_fields or existing_full.get("needs_reanalysis"))
        updated_rows = _request(
            "PATCH",
            "leads",
            params={
                "id": f"eq.{existing_lead['id']}",
                "select": "id,address,normalized_address,zipcode,analysis_status,needs_reanalysis,last_import_batch_id",
            },
            json_body=lead_payload,
            prefer="return=representation",
            auth_context=auth_context,
        ) or []
        return {
            "lead": (updated_rows or [existing_lead])[0],
            "action": "updated",
            "match_type": match_type or "matched_existing",
        }

    created_rows = _request(
        "POST",
        "leads",
        params={"on_conflict": "organization_id,normalized_address"},
        json_body=lead_payload,
        prefer="resolution=merge-duplicates,return=representation",
        auth_context=auth_context,
    ) or []
    return {
        "lead": (created_rows or [None])[0],
        "action": "inserted",
        "match_type": "new_lead",
    }


def _build_ingest_lead_payload(
    organization_id,
    current_user_id,
    row_data,
    *,
    import_batch_id=None,
    existing_row=None,
):
    normalized_address = _normalize_address(row_data.get("address"))
    payload = {
        "organization_id": organization_id,
        "created_by": current_user_id,
        "import_batch_id": import_batch_id,
        "last_import_batch_id": import_batch_id,
        "normalized_address": normalized_address,
        "address": row_data.get("address"),
        "city": str(row_data.get("city") or "").strip() or None,
        "state": str(row_data.get("state") or "").strip() or None,
        "zipcode": coerce_zipcode(row_data.get("zipcode")),
        "lat": _safe_float(row_data.get("source_latitude")),
        "lng": _safe_float(row_data.get("source_longitude")),
        "owner_name": _combine_name(row_data.get("first_name"), row_data.get("last_name")),
        "first_name": row_data.get("first_name"),
        "last_name": row_data.get("last_name"),
        "phone": row_data.get("phone"),
        "email": row_data.get("email"),
        "notes": row_data.get("notes"),
        "unqualified": _coerce_bool(row_data.get("unqualified")),
        "unqualified_reason": row_data.get("unqualified_reason"),
        "listing_agent": row_data.get("listing_agent"),
        "status": "open",
        "lead_status": "New",
        "assignment_status": "unassigned",
        "analysis_status": "pending",
        "last_analysis_requested_at": datetime.now(timezone.utc).isoformat(),
        "last_analysis_error": None,
        "needs_reanalysis": False,
        "source": row_data.get("source") or "imported",
    }
    if existing_row:
        changed_fields = False
        for field in ["address", "city", "state", "zipcode", "lat", "lng", "first_name", "last_name", "phone", "email", "notes", "listing_agent"]:
            new_value = payload.get(field)
            old_value = existing_row.get(field)
            if field in {"lat", "lng"}:
                try:
                    changed_fields = changed_fields or (
                        new_value is not None and old_value is not None and abs(float(new_value) - float(old_value)) > 0.000001
                    ) or (new_value is not None and old_value is None)
                except Exception:
                    changed_fields = changed_fields or (new_value not in (None, "") and old_value != new_value)
            elif new_value not in (None, "") and str(new_value).strip() != str(old_value or "").strip():
                changed_fields = True
        payload["needs_reanalysis"] = bool(changed_fields or existing_row.get("needs_reanalysis"))
    return payload


def _prefetch_existing_leads_for_ingest(organization_id, row_payloads, auth_context=None):
    if not organization_id or not row_payloads:
        return {}

    normalized_addresses = sorted(
        {
            _normalize_address(row.get("address"))
            for row in row_payloads
            if _normalize_address(row.get("address"))
        }
    )
    zipcode_values = sorted(
        {
            coerce_zipcode(row.get("zipcode"))
            for row in row_payloads
            if coerce_zipcode(row.get("zipcode"))
        }
    )
    candidate_rows = []
    for address_chunk in _chunked(normalized_addresses, 150):
        try:
            candidate_rows.extend(
                _request(
                    "GET",
                    "leads",
                    params={
                        "organization_id": f"eq.{organization_id}",
                        "normalized_address": f"in.({','.join(_quoted(value) for value in address_chunk)})",
                        "select": (
                            "id,address,normalized_address,zipcode,lat,lng,city,state,first_name,last_name,phone,email,"
                            "notes,listing_agent,analysis_status,analysis_attempt_count,needs_reanalysis,updated_at,created_at"
                        ),
                    },
                    auth_context=auth_context,
                ) or []
            )
        except Exception:
            pass

    for zipcode_chunk in _chunked(zipcode_values, 150):
        try:
            candidate_rows.extend(
                _request(
                    "GET",
                    "leads",
                    params={
                        "organization_id": f"eq.{organization_id}",
                        "zipcode": f"in.({','.join(_quoted(value) for value in zipcode_chunk)})",
                        "select": (
                            "id,address,normalized_address,zipcode,lat,lng,city,state,first_name,last_name,phone,email,"
                            "notes,listing_agent,analysis_status,analysis_attempt_count,needs_reanalysis,updated_at,created_at"
                        ),
                        "order": "updated_at.desc",
                        "limit": "1000",
                    },
                    auth_context=auth_context,
                ) or []
            )
        except Exception:
            pass

    unique_rows = {}
    for row in candidate_rows:
        if row.get("id"):
            unique_rows[row["id"]] = row
    return unique_rows


def create_import_batch(*, filename, total_rows, detected_rows, skipped_rows, auth_context=None):
    if not supabase_enabled() or not can_access_manager_workspace(auth_context=auth_context):
        return None
    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id or not current_user_id:
        return None
    rows = _request(
        "POST",
        "import_batches",
        json_body={
            "organization_id": organization_id,
            "created_by": current_user_id,
            "source_name": filename,
            "filename": filename,
            "original_filename": filename,
            "source_type": "csv",
            "status": "ingesting",
            "row_count": total_rows,
            "valid_row_count": detected_rows,
            "skipped_row_count": skipped_rows,
            "total_rows": total_rows,
            "detected_rows": detected_rows,
            "started_at": datetime.now(timezone.utc).isoformat(),
        },
        prefer="return=representation",
        auth_context=auth_context,
    ) or []
    return (rows or [None])[0]


def ingest_uploaded_rows(batch_id, row_payloads, auth_context=None):
    if not supabase_enabled() or not can_access_manager_workspace(auth_context=auth_context):
        return {"ok": False, "error": "Lead ingest is only available to managers."}

    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id or not current_user_id or not batch_id:
        return {"ok": False, "error": "Missing organization, user, or batch context."}

    inserted_count = 0
    updated_count = 0
    duplicate_matched_count = 0
    failed_count = 0
    created_item_rows = 0
    errors = []
    batch_row = get_import_batch_by_id(batch_id, auth_context=auth_context) or {"id": batch_id}

    prefetched_rows = list(_prefetch_existing_leads_for_ingest(organization_id, row_payloads, auth_context=auth_context).values())
    exact_lookup = {
        row.get("normalized_address"): row
        for row in prefetched_rows
        if row.get("normalized_address")
    }

    processed_rows = []
    inserted_payloads = []
    inserted_meta = []
    update_chunks = []

    for row_payload in row_payloads:
        source_row_number = row_payload.get("source_row_number")
        raw_address = row_payload.get("raw_address")
        normalized_address = _normalize_address(raw_address)
        existing_row = exact_lookup.get(normalized_address)
        match_type = "exact_address" if existing_row else None

        if existing_row is None:
            best_row = None
            best_score = -1
            street_signature = _address_street_signature(row_payload.get("address"))
            zipcode = coerce_zipcode(row_payload.get("zipcode"))
            lat = _safe_float(row_payload.get("source_latitude"))
            lng = _safe_float(row_payload.get("source_longitude"))
            for candidate in prefetched_rows:
                score = 0
                candidate_signature = _address_street_signature(candidate.get("address"))
                if street_signature and candidate_signature and street_signature == candidate_signature:
                    score += 3
                if zipcode and candidate.get("zipcode") and coerce_zipcode(candidate.get("zipcode")) == zipcode:
                    score += 1
                try:
                    if lat is not None and lng is not None and candidate.get("lat") is not None and candidate.get("lng") is not None:
                        if abs(float(candidate.get("lat")) - float(lat)) <= 0.0002 and abs(float(candidate.get("lng")) - float(lng)) <= 0.0002:
                            score += 4
                except Exception:
                    pass
                if score > best_score:
                    best_score = score
                    best_row = candidate
            if best_score >= 4:
                existing_row = best_row
                match_type = "high_confidence"

        item_payload = {
            "import_batch_id": batch_id,
            "organization_id": organization_id,
            "source_row_number": source_row_number,
            "raw_address": raw_address,
            "normalized_address": normalized_address,
            "source_payload": _json_safe(row_payload),
            "ingest_status": "pending",
            "analysis_status": "pending",
        }

        try:
            lead_payload = _build_ingest_lead_payload(
                organization_id,
                current_user_id,
                row_payload,
                import_batch_id=batch_id,
                existing_row=existing_row,
            )
            if existing_row:
                update_chunks.append((existing_row["id"], lead_payload, item_payload, match_type))
            else:
                inserted_payloads.append(lead_payload)
                inserted_meta.append((item_payload, normalized_address))
        except Exception as err:
            failed_count += 1
            errors.append(str(err))
            item_payload.update(
                {
                    "ingest_status": "failed",
                    "analysis_status": "failed",
                    "analysis_error": str(err),
                }
            )
            processed_rows.append(item_payload)

    for lead_id, lead_payload, item_payload, match_type in update_chunks:
        try:
            updated_rows = _request(
                "PATCH",
                "leads",
                params={
                    "id": f"eq.{lead_id}",
                    "select": "id,property_id,address,normalized_address,zipcode,city,state,lat,lng",
                },
                json_body=lead_payload,
                prefer="return=representation",
                auth_context=auth_context,
            ) or []
            lead_row = (updated_rows or [{"id": lead_id}])[0]
            property_row = _upsert_property_record(
                organization_id=organization_id,
                lead_row=lead_row,
                source_payload=item_payload.get("source_payload"),
                auth_context=auth_context,
            )
            _insert_property_source_record(
                organization_id=organization_id,
                property_id=(property_row or {}).get("id"),
                current_user_id=current_user_id,
                batch_row=batch_row,
                source_payload=item_payload.get("source_payload"),
                source_row_number=item_payload.get("source_row_number"),
                auth_context=auth_context,
            )
            item_payload.update(
                {
                    "lead_id": lead_row.get("id"),
                    "ingest_status": "matched_existing" if match_type in {"exact_address", "high_confidence"} else "updated",
                    "analysis_status": "pending",
                    "dedupe_match_type": match_type,
                    "analysis_error": None,
                }
            )
            updated_count += 1
            if match_type in {"exact_address", "high_confidence"}:
                duplicate_matched_count += 1
            processed_rows.append(item_payload)
        except Exception as err:
            failed_count += 1
            errors.append(str(err))
            item_payload.update(
                {
                    "ingest_status": "failed",
                    "analysis_status": "failed",
                    "analysis_error": str(err),
                }
            )
            processed_rows.append(item_payload)

    for payload_chunk, meta_chunk in zip(_chunked(inserted_payloads, 100), _chunked(inserted_meta, 100)):
        try:
            created_rows = _request(
                "POST",
                "leads",
                params={"on_conflict": "organization_id,normalized_address"},
                json_body=payload_chunk,
                prefer="resolution=merge-duplicates,return=representation",
                auth_context=auth_context,
            ) or []
            created_lookup = {
                row.get("normalized_address"): row
                for row in created_rows
                if row.get("normalized_address")
            }
            for item_payload, normalized_address in meta_chunk:
                created_row = created_lookup.get(normalized_address)
                property_row = _upsert_property_record(
                    organization_id=organization_id,
                    lead_row=created_row,
                    source_payload=item_payload.get("source_payload"),
                    auth_context=auth_context,
                )
                _insert_property_source_record(
                    organization_id=organization_id,
                    property_id=(property_row or {}).get("id"),
                    current_user_id=current_user_id,
                    batch_row=batch_row,
                    source_payload=item_payload.get("source_payload"),
                    source_row_number=item_payload.get("source_row_number"),
                    auth_context=auth_context,
                )
                item_payload.update(
                    {
                        "lead_id": (created_row or {}).get("id"),
                        "ingest_status": "inserted",
                        "analysis_status": "pending",
                        "dedupe_match_type": "new_lead",
                        "analysis_error": None,
                    }
                )
                inserted_count += 1
                processed_rows.append(item_payload)
        except Exception as err:
            errors.append(str(err))
            for item_payload, _normalized_address in meta_chunk:
                failed_count += 1
                item_payload.update(
                    {
                        "ingest_status": "failed",
                        "analysis_status": "failed",
                        "analysis_error": str(err),
                    }
                )
                processed_rows.append(item_payload)

    for item_chunk in _chunked(processed_rows, 200):
        try:
            _request(
                "POST",
                "import_batch_items",
                json_body=item_chunk,
                prefer="return=minimal",
                auth_context=auth_context,
            )
            created_item_rows += len(item_chunk)
        except Exception as err:
            if _missing_import_batch_source_payload_column(err):
                try:
                    _request(
                        "POST",
                        "import_batch_items",
                        json_body=[{k: v for k, v in item.items() if k != "source_payload"} for item in item_chunk],
                        prefer="return=minimal",
                        auth_context=auth_context,
                    )
                    created_item_rows += len(item_chunk)
                    errors.append("import_batch_items.source_payload column is missing; analysis will use best-effort fallback data until the latest migration is applied.")
                    continue
                except Exception as retry_err:
                    err = retry_err
            failed_count += len(item_chunk)
            errors.append(str(err))

    pending_analysis_count = max(created_item_rows - failed_count, 0)
    batch_status = "ready_for_analysis" if pending_analysis_count > 0 else ("failed" if failed_count else "uploaded")
    _request(
        "PATCH",
        "import_batches",
        params={"id": f"eq.{batch_id}"},
        json_body={
            "status": batch_status,
            "inserted_count": inserted_count,
            "updated_count": updated_count,
            "duplicate_matched_count": duplicate_matched_count,
            "pending_analysis_count": pending_analysis_count,
            "failed_count": failed_count,
            "last_error": "\n".join(errors[:3]) if errors else None,
        },
        prefer="return=minimal",
        auth_context=auth_context,
    )
    return {
        "ok": failed_count == 0,
        "batch_id": batch_id,
        "inserted_count": inserted_count,
        "updated_count": updated_count,
        "duplicate_matched_count": duplicate_matched_count,
        "pending_analysis_count": pending_analysis_count,
        "failed_count": failed_count,
        "errors": errors,
        "status": batch_status,
    }


def get_recent_import_batches(limit=10, auth_context=None):
    if not supabase_enabled():
        return []
    organization_id = (auth_context or {}).get("organization_id")
    if not organization_id:
        return []
    try:
        return _request(
            "GET",
            "import_batches",
            params={
                "organization_id": f"eq.{organization_id}",
                "select": (
                    "id,filename,status,total_rows,detected_rows,inserted_count,updated_count,"
                    "duplicate_matched_count,pending_analysis_count,analyzing_count,analyzed_count,failed_count,"
                    "started_at,completed_at,created_at,last_error"
                ),
                "order": "created_at.desc",
                "limit": str(limit),
            },
            auth_context=auth_context,
        ) or []
    except Exception:
        return []


def get_next_pending_import_batch(auth_context=None):
    if not supabase_enabled():
        return None
    try:
        rows = _request(
            "GET",
            "import_batches",
            params={
                "status": "in.(ready_for_analysis,analyzing)",
                "pending_analysis_count": "gt.0",
                "select": (
                    "id,organization_id,created_by,filename,status,total_rows,detected_rows,"
                    "pending_analysis_count,analyzing_count,analyzed_count,failed_count,started_at,created_at"
                ),
                "order": "started_at.asc.nullsfirst,created_at.asc",
                "limit": "1",
            },
            auth_context=auth_context,
        ) or []
        return (rows or [None])[0]
    except Exception:
        return None


def get_import_batch_by_id(batch_id, auth_context=None):
    if not supabase_enabled() or not batch_id:
        return None
    try:
        rows = _request(
            "GET",
            "import_batches",
            params={
                "id": f"eq.{batch_id}",
                "select": (
                    "id,organization_id,created_by,filename,source_name,source_type,status,total_rows,detected_rows,"
                    "pending_analysis_count,analyzing_count,analyzed_count,failed_count,started_at,created_at"
                ),
                "limit": "1",
            },
            auth_context=auth_context,
        ) or []
        return (rows or [None])[0]
    except Exception:
        return None


def get_next_import_batch_items(batch_id, *, limit=5, auth_context=None):
    if not supabase_enabled() or not batch_id:
        return []
    try:
        return _request(
            "GET",
            "import_batch_items",
            params={
                "import_batch_id": f"eq.{batch_id}",
                "analysis_status": "eq.pending",
                "select": (
                    "id,lead_id,source_row_number,raw_address,normalized_address,"
                    "source_payload,analysis_status,analysis_error"
                ),
                "order": "source_row_number.asc",
                "limit": str(limit),
            },
            auth_context=auth_context,
        ) or []
    except Exception as err:
        if not _missing_import_batch_source_payload_column(err):
            return []
        try:
            rows = _request(
                "GET",
                "import_batch_items",
                params={
                    "import_batch_id": f"eq.{batch_id}",
                    "analysis_status": "eq.pending",
                    "select": (
                        "id,lead_id,source_row_number,raw_address,normalized_address,"
                        "analysis_status,analysis_error"
                    ),
                    "order": "source_row_number.asc",
                    "limit": str(limit),
                },
                auth_context=auth_context,
            ) or []
            for row in rows:
                row.setdefault("source_payload", None)
            return rows
        except Exception:
            return []


def get_leads_for_analysis(lead_ids, auth_context=None):
    unique_ids = [lead_id for lead_id in dict.fromkeys(lead_ids or []) if lead_id]
    if not supabase_enabled() or not unique_ids:
        return {}
    rows = []
    for lead_id_chunk in _chunked(unique_ids, 150):
        try:
            rows.extend(
                _request(
                    "GET",
                    "leads",
                    params={
                        "id": f"in.({','.join(_quoted(value) for value in lead_id_chunk)})",
                        "select": (
                            "id,address,normalized_address,zipcode,city,state,lat,lng,first_name,last_name,"
                            "phone,email,notes,listing_agent,source,analysis_status,analysis_attempt_count"
                        ),
                    },
                    auth_context=auth_context,
                ) or []
            )
        except Exception:
            pass
    return {row.get("id"): row for row in rows if row.get("id")}


def mark_import_batch_items_analyzing(batch_id, item_ids, lead_ids, auth_context=None):
    if not supabase_enabled() or not batch_id or not item_ids:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    _request(
        "PATCH",
        "import_batch_items",
        params={"id": f"in.({','.join(_quoted(value) for value in item_ids)})"},
        json_body={
            "analysis_status": "analyzing",
            "analysis_error": None,
        },
        prefer="return=minimal",
        auth_context=auth_context,
    )
    if lead_ids:
        _request(
            "PATCH",
            "leads",
            params={"id": f"in.({','.join(_quoted(value) for value in lead_ids)})"},
            json_body={
                "analysis_status": "analyzing",
                "last_analysis_requested_at": now_iso,
                "last_analysis_error": None,
            },
            prefer="return=minimal",
            auth_context=auth_context,
        )
    _request(
        "PATCH",
        "import_batches",
        params={"id": f"eq.{batch_id}"},
        json_body={"status": "analyzing"},
        prefer="return=minimal",
        auth_context=auth_context,
    )


def complete_import_batch_item_analysis(
    batch_id,
    *,
    item_id,
    lead_id,
    analysis_status,
    analysis_error=None,
    analysis_attempt_count=None,
    auth_context=None,
):
    if not supabase_enabled() or not batch_id or not item_id:
        return
    now_iso = datetime.now(timezone.utc).isoformat()
    _request(
        "PATCH",
        "import_batch_items",
        params={"id": f"eq.{item_id}"},
        json_body={
            "lead_id": lead_id,
            "analysis_status": analysis_status,
            "analysis_error": analysis_error,
        },
        prefer="return=minimal",
        auth_context=auth_context,
    )
    if lead_id:
        lead_payload = {
            "analysis_status": analysis_status,
            "analysis_attempt_count": max(1, int(analysis_attempt_count or 0)),
            "last_analysis_error": analysis_error,
            "last_import_batch_id": batch_id,
        }
        if analysis_status == "analyzed":
            lead_payload["last_analysis_completed_at"] = now_iso
            lead_payload["needs_reanalysis"] = False
        _request(
            "PATCH",
            "leads",
            params={"id": f"eq.{lead_id}"},
            json_body=lead_payload,
            prefer="return=minimal",
            auth_context=auth_context,
        )


def refresh_import_batch_progress(batch_id, auth_context=None):
    if not supabase_enabled() or not batch_id:
        return None

    def _status_count(status):
        return _count_rows(
            "import_batch_items",
            params={
                "import_batch_id": f"eq.{batch_id}",
                "analysis_status": f"eq.{status}",
            },
            auth_context=auth_context,
        ) or 0

    pending_count = _status_count("pending")
    analyzing_count = _status_count("analyzing")
    analyzed_count = _status_count("analyzed")
    failed_count = _status_count("failed")

    if pending_count > 0 or analyzing_count > 0:
        batch_status = "analyzing"
        completed_at = None
    elif failed_count > 0:
        batch_status = "completed_with_errors"
        completed_at = datetime.now(timezone.utc).isoformat()
    else:
        batch_status = "completed"
        completed_at = datetime.now(timezone.utc).isoformat()

    _request(
        "PATCH",
        "import_batches",
        params={"id": f"eq.{batch_id}"},
        json_body={
            "status": batch_status,
            "pending_analysis_count": pending_count,
            "analyzing_count": analyzing_count,
            "analyzed_count": analyzed_count,
            "failed_count": failed_count,
            "completed_at": completed_at,
        },
        prefer="return=minimal",
        auth_context=auth_context,
    )
    return {
        "batch_id": batch_id,
        "status": batch_status,
        "pending_analysis_count": pending_count,
        "analyzing_count": analyzing_count,
        "analyzed_count": analyzed_count,
        "failed_count": failed_count,
    }


def _get_open_lead_pool_direct(limit=5000, auth_context=None):
    organization_id = (auth_context or {}).get("organization_id")
    if not organization_id:
        return []

    lead_rows = _request_paged_get(
        "leads",
        params={
            "organization_id": f"eq.{organization_id}",
            "status": "eq.open",
            "assignment_status": "eq.unassigned",
            "select": (
                "id,address,zipcode,lat,lng,first_name,last_name,phone,email,notes,"
                "unqualified,unqualified_reason,listing_agent,lead_status,appointment_at,updated_at"
            ),
            "order": "updated_at.desc,address.asc",
        },
        auth_context=auth_context,
        desired_limit=limit,
    ) or []
    if not lead_rows:
        return []

    lead_lookup = {row["id"]: row for row in lead_rows if row.get("id")}
    lead_ids = list(lead_lookup.keys())
    analysis_rows = []
    for lead_id_chunk in _chunked(lead_ids, 200):
        analysis_rows.extend(
            _request_paged_get(
                "lead_analysis",
                params={
                    "lead_id": f"in.({','.join(_quoted(lead_id) for lead_id in lead_id_chunk)})",
                    "select": "*",
                    "order": "updated_at.desc,created_at.desc,id.desc",
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
        neighbor_rows = _request_paged_get(
            "lead_neighbors",
            params={
                "lead_analysis_id": f"in.({','.join(_quoted(analysis_id) for analysis_id in analysis_id_chunk)})",
                "select": "lead_analysis_id,address,zipcode,lat,lng,sun_hours,sun_hours_display,category,priority_score",
                "order": "address.asc",
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
        rows = _request_paged_get(
            "open_lead_pool",
            params=params,
            auth_context=auth_context,
            desired_limit=limit,
        )
    except Exception as err:
        if not (_missing_solar_details_column(err) or _missing_open_lead_pool_column(err)):
            return []
        try:
            rows = _request_paged_get(
                "open_lead_pool",
                params={
                    "organization_id": f"eq.{organization_id}",
                    "select": (
                        "id,address,zipcode,lat,lng,first_name,last_name,phone,email,notes,"
                        "unqualified,unqualified_reason,listing_agent,sale_price,price_display,sqft,sqft_display,"
                        "beds,baths,sold_date,permit_pulled,priority_score,priority_label,category,sun_hours,doors_to_knock"
                    ),
                    "order": "priority_score.desc,doors_to_knock.desc,address.asc",
                },
                auth_context=auth_context,
                desired_limit=limit,
            )
        except Exception as fallback_err:
            if not (_missing_solar_details_column(fallback_err) or _missing_open_lead_pool_column(fallback_err)):
                return []
            try:
                rows = _request_paged_get(
                    "open_lead_pool",
                    params={
                        "organization_id": f"eq.{organization_id}",
                    "select": (
                        "id,address,zipcode,lat,lng,first_name,last_name,phone,email,notes,"
                        "unqualified,unqualified_reason,listing_agent,lead_status,appointment_at,"
                        "priority_score,priority_label,category,sun_hours,doors_to_knock"
                    ),
                        "order": "priority_score.desc,doors_to_knock.desc,address.asc",
                    },
                    auth_context=auth_context,
                    desired_limit=limit,
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
            "listing_agent,lead_status,follow_up_flags,first_outreach_at,first_meaningful_contact_at,"
            "last_outreach_at,last_inbound_at,last_meaningful_contact_at,next_follow_up_at,"
            "last_activity_at,last_activity_type,last_activity_outcome,next_recommended_step,"
            "nurture_reason,appointment_at,created_at,updated_at"
        ),
        "order": "updated_at.desc,address.asc",
        "limit": str(limit),
    }

    if auth_context and not can_access_manager_workspace(auth_context=auth_context):
        if not current_user_id:
            return []
        params["or"] = f"(created_by.eq.{current_user_id},assigned_to.eq.{current_user_id})"

    try:
        rows = _request_paged_get(
            "leads",
            params=params,
            auth_context=auth_context,
            desired_limit=limit,
        )
        rows = rows or []
        if not rows:
            return rows
        return _enrich_rows_with_analysis(rows, auth_context=auth_context)
    except Exception as err:
        if not _missing_lead_followup_column(err):
            return []
        try:
            legacy_rows = _request_paged_get(
                "leads",
                params={
                    **{k: v for k, v in params.items() if k != "select"},
                    "select": (
                        "id,address,zipcode,status,assignment_status,assigned_to,created_by,"
                        "first_name,last_name,phone,email,notes,unqualified,unqualified_reason,"
                        "listing_agent,created_at,updated_at"
                    ),
                },
                auth_context=auth_context,
                desired_limit=limit,
            ) or []
            for row in legacy_rows:
                row.setdefault("lead_status", None)
                row.setdefault("follow_up_flags", [])
                row.setdefault("first_outreach_at", None)
                row.setdefault("first_meaningful_contact_at", None)
                row.setdefault("last_outreach_at", None)
                row.setdefault("last_inbound_at", None)
                row.setdefault("last_meaningful_contact_at", None)
                row.setdefault("next_follow_up_at", None)
                row.setdefault("last_activity_at", None)
                row.setdefault("last_activity_type", None)
                row.setdefault("last_activity_outcome", None)
                row.setdefault("next_recommended_step", None)
                row.setdefault("nurture_reason", None)
                row.setdefault("appointment_at", None)
            return _enrich_rows_with_analysis(legacy_rows, auth_context=auth_context)
        except Exception:
            return []


def get_visible_lead_summaries(limit=1000, auth_context=None):
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
            "listing_agent,lead_status,follow_up_flags,next_follow_up_at,last_activity_at,"
            "last_activity_type,last_activity_outcome,next_recommended_step,nurture_reason,"
            "appointment_at,created_at,updated_at"
        ),
        "order": "updated_at.desc,address.asc",
        "limit": str(limit),
    }

    if auth_context and not can_access_manager_workspace(auth_context=auth_context):
        if not current_user_id:
            return []
        params["or"] = f"(created_by.eq.{current_user_id},assigned_to.eq.{current_user_id})"

    try:
        return _request_paged_get(
            "leads",
            params=params,
            auth_context=auth_context,
            desired_limit=limit,
        ) or []
    except Exception as err:
        if not _missing_lead_followup_column(err):
            return []
        try:
            legacy_rows = _request_paged_get(
                "leads",
                params={
                    **{k: v for k, v in params.items() if k != "select"},
                    "select": (
                        "id,address,zipcode,status,assignment_status,assigned_to,created_by,"
                        "first_name,last_name,phone,email,notes,unqualified,unqualified_reason,"
                        "listing_agent,created_at,updated_at"
                    ),
                },
                auth_context=auth_context,
                desired_limit=limit,
            ) or []
            for row in legacy_rows:
                row.setdefault("lead_status", None)
                row.setdefault("follow_up_flags", [])
                row.setdefault("next_follow_up_at", None)
                row.setdefault("last_activity_at", None)
                row.setdefault("last_activity_type", None)
                row.setdefault("last_activity_outcome", None)
                row.setdefault("next_recommended_step", None)
                row.setdefault("nurture_reason", None)
                row.setdefault("appointment_at", None)
            return legacy_rows
        except Exception:
            return []


def get_visible_lead_appointments(limit=5000, auth_context=None):
    if not supabase_enabled():
        return []

    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id:
        return []

    params = {
        "organization_id": f"eq.{organization_id}",
        "appointment_at": "not.is.null",
        "select": (
            "id,address,zipcode,assigned_to,created_by,first_name,last_name,phone,email,"
            "appointment_at,lead_status,status,updated_at,created_at"
        ),
        "order": "appointment_at.asc,updated_at.desc,address.asc",
        "limit": str(limit),
    }
    if auth_context and not can_access_manager_workspace(auth_context=auth_context):
        if not current_user_id:
            return []
        params["or"] = f"(created_by.eq.{current_user_id},assigned_to.eq.{current_user_id})"

    try:
        rows = _request_paged_get(
            "leads",
            params=params,
            auth_context=auth_context,
            desired_limit=limit,
        ) or []
    except Exception as err:
        if not _missing_lead_followup_column(err):
            return []
        legacy_params = dict(params)
        legacy_params["select"] = (
            "id,address,zipcode,assigned_to,created_by,first_name,last_name,phone,email,"
            "appointment_at,status,updated_at,created_at"
        )
        try:
            rows = _request_paged_get(
                "leads",
                params=legacy_params,
                auth_context=auth_context,
                desired_limit=limit,
            ) or []
        except Exception:
            return []
        for row in rows:
            row.setdefault("lead_status", None)

    rep_lookup = {}
    for rep in get_rep_options(auth_context=auth_context):
        rep_lookup[rep.get("id")] = rep.get("full_name") or rep.get("email") or rep.get("id")

    visible_rows = []
    now = datetime.now(timezone.utc)
    for row in rows:
        appointment_dt = _parse_iso_datetime(row.get("appointment_at"))
        if not appointment_dt or appointment_dt < now:
            continue
        lead_status = str(row.get("lead_status") or "").strip()
        if lead_status in {"Closed Won", "Closed Lost", "Do Not Contact"}:
            continue
        rep_id = row.get("assigned_to") or row.get("created_by")
        visible_rows.append(
            {
                "lead_id": row.get("id"),
                "rep_id": rep_id,
                "rep_name": rep_lookup.get(rep_id) or ("Unassigned" if not rep_id else rep_id),
                "address": row.get("address") or "",
                "zipcode": row.get("zipcode") or "",
                "first_name": row.get("first_name") or "",
                "last_name": row.get("last_name") or "",
                "phone": row.get("phone") or "",
                "email": row.get("email") or "",
                "appointment_at": appointment_dt.isoformat(),
                "lead_status": lead_status or None,
                "legacy_status": row.get("status"),
                "logged_at": row.get("updated_at") or row.get("created_at") or row.get("appointment_at"),
            }
        )
    return visible_rows


def get_duplicate_lead_groups(limit=5000, auth_context=None):
    if not supabase_enabled() or not can_access_manager_workspace(auth_context=auth_context):
        return []

    organization_id = (auth_context or {}).get("organization_id")
    if not organization_id:
        return []

    rows = _request_paged_get(
        "leads",
        params={
            "organization_id": f"eq.{organization_id}",
            "select": (
                "id,address,normalized_address,zipcode,lat,lng,status,lead_status,assignment_status,assigned_to,"
                "created_by,first_name,last_name,phone,email,notes,follow_up_flags,appointment_at,"
                "updated_at,created_at,last_activity_at"
            ),
            "order": "updated_at.desc,address.asc",
            "limit": str(limit),
        },
        auth_context=auth_context,
        desired_limit=limit,
    ) or []

    groups = {}
    for row in rows:
        group_key = _duplicate_group_key(row)
        if not group_key:
            continue
        groups.setdefault(group_key, []).append(row)

    duplicate_groups = []
    for group_key, group_rows in groups.items():
        if len(group_rows) < 2:
            continue
        confidence_score = max(
            _duplicate_confidence(group_rows[0], row)
            for row in group_rows[1:]
        )
        sorted_rows = sorted(
            group_rows,
            key=lambda row: (
                _lead_status_rank(row.get("lead_status")),
                1 if row.get("appointment_at") else 0,
                len(str(row.get("notes") or "")),
                str(row.get("updated_at") or row.get("created_at") or ""),
            ),
            reverse=True,
        )
        duplicate_groups.append(
            {
                "group_key": group_key,
                "size": len(sorted_rows),
                "lead_ids": [row.get("id") for row in sorted_rows],
                "display_address": sorted_rows[0].get("address") or "Duplicate Group",
                "zipcode": coerce_zipcode(sorted_rows[0].get("zipcode")) or "",
                "confidence_score": confidence_score,
                "confidence_label": _duplicate_confidence_label(confidence_score),
                "rows": sorted_rows,
            }
        )

    duplicate_groups.sort(
        key=lambda group: (
            {"Exact": 0, "High": 1, "Review": 2}.get(group.get("confidence_label"), 9),
            -group.get("size", 0),
            group.get("display_address", "").lower(),
        )
    )
    return duplicate_groups


def merge_duplicate_leads(canonical_lead_id, duplicate_lead_ids, auth_context=None):
    if not supabase_enabled() or not can_access_manager_workspace(auth_context=auth_context):
        return {"ok": False, "error": "Duplicate merging is only available to managers."}
    organization_id = (auth_context or {}).get("organization_id")
    if not organization_id or not canonical_lead_id or not duplicate_lead_ids:
        return {"ok": False, "error": "A canonical lead and at least one duplicate are required."}

    cleaned_duplicate_ids = [lead_id for lead_id in duplicate_lead_ids if lead_id and lead_id != canonical_lead_id]
    if not cleaned_duplicate_ids:
        return {"ok": False, "error": "No duplicate leads were selected to merge."}

    try:
        rpc_result = _request_rpc(
            "merge_duplicate_lead_group",
            payload={
                "p_organization_id": organization_id,
                "p_canonical_lead_id": canonical_lead_id,
                "p_duplicate_lead_ids": cleaned_duplicate_ids,
            },
            auth_context=auth_context,
        ) or {}
        if isinstance(rpc_result, dict):
            return {
                "ok": bool(rpc_result.get("ok")),
                "canonical_lead_id": rpc_result.get("canonical_lead_id") or canonical_lead_id,
                "merged_count": int(rpc_result.get("merged_count") or len(cleaned_duplicate_ids)),
                "error": rpc_result.get("error"),
            }
        return {
            "ok": True,
            "canonical_lead_id": canonical_lead_id,
            "merged_count": len(cleaned_duplicate_ids),
        }
    except Exception as err:
        return {"ok": False, "error": str(err)}


def bulk_merge_duplicate_groups(group_keys=None, confidence_labels=None, auth_context=None):
    if not supabase_enabled() or not can_access_manager_workspace(auth_context=auth_context):
        return {"ok": False, "error": "Duplicate merging is only available to managers."}

    organization_id = (auth_context or {}).get("organization_id")
    if not organization_id:
        return {"ok": False, "error": "No active organization is selected."}

    groups = get_duplicate_lead_groups(auth_context=auth_context)
    if group_keys:
        selected = [group for group in groups if group.get("group_key") in set(group_keys)]
    elif confidence_labels:
        selected = [group for group in groups if group.get("confidence_label") in set(confidence_labels)]
    else:
        selected = groups

    selected_group_keys = [group.get("group_key") for group in selected if group.get("group_key")]
    if not selected_group_keys:
        return {"ok": True, "merged_groups": 0, "merged_leads": 0, "errors": []}

    try:
        rpc_result = _request_rpc(
            "merge_duplicate_groups_by_key",
            payload={
                "p_organization_id": organization_id,
                "p_group_keys": selected_group_keys,
            },
            auth_context=auth_context,
        ) or {}
        if isinstance(rpc_result, dict):
            return {
                "ok": bool(rpc_result.get("ok", True)),
                "merged_groups": int(rpc_result.get("merged_groups") or 0),
                "merged_leads": int(rpc_result.get("merged_leads") or 0),
                "skipped_groups": int(rpc_result.get("skipped_groups") or 0),
                "errors": rpc_result.get("errors") or [],
            }
        return {"ok": True, "merged_groups": 0, "merged_leads": 0, "errors": []}
    except Exception as err:
        return {"ok": False, "error": str(err), "merged_groups": 0, "merged_leads": 0, "errors": []}


def get_org_lead_count(auth_context=None):
    if not supabase_enabled():
        return 0
    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id:
        return 0
    params = {
        "organization_id": f"eq.{organization_id}",
        "select": "id",
    }
    if auth_context and not can_access_manager_workspace(auth_context=auth_context):
        if not current_user_id:
            return 0
        params["or"] = f"(created_by.eq.{current_user_id},assigned_to.eq.{current_user_id})"
    return _count_rows("leads", params=params, auth_context=auth_context) or 0


def get_lead_analysis_snapshot(lead_id, auth_context=None):
    if not supabase_enabled() or not lead_id:
        return None
    try:
        rows = _request_lead_analysis_get_with_fallback(
            params={
                "lead_id": f"eq.{lead_id}",
                "select": (
                    "id,sale_price,price_display,value_badge,sqft,sqft_display,beds,baths,sold_date,permit_pulled,"
                    "sun_hours,sun_hours_display,category,solar_details,priority_score,priority_label,parking_address,"
                    "parking_ease,doors_to_knock,ideal_count,good_count,walkable_count,street_view_link,value_score,"
                    "sqft_score,analysis_error,created_at,updated_at"
                ),
                "order": "updated_at.desc,created_at.desc,id.desc",
                "limit": "1",
            },
            auth_context=auth_context,
            paged=False,
        ) or []
        if not rows:
            return None
        return _merge_solar_details(dict(rows[0]), rows[0].get("solar_details"))
    except Exception:
        return None


def get_visible_lead_by_id(lead_id, auth_context=None):
    if not supabase_enabled() or not lead_id:
        return None

    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id:
        return None

    params = {
        "id": f"eq.{lead_id}",
        "organization_id": f"eq.{organization_id}",
        "select": (
            "id,address,zipcode,status,assignment_status,assigned_to,created_by,"
            "first_name,last_name,phone,email,notes,unqualified,unqualified_reason,"
            "listing_agent,lead_status,follow_up_flags,first_outreach_at,first_meaningful_contact_at,"
            "last_outreach_at,last_inbound_at,last_meaningful_contact_at,next_follow_up_at,"
            "last_activity_at,last_activity_type,last_activity_outcome,next_recommended_step,"
            "nurture_reason,appointment_at,created_at,updated_at"
        ),
        "limit": "1",
    }

    if auth_context and not can_access_manager_workspace(auth_context=auth_context):
        if not current_user_id:
            return None
        params["or"] = f"(created_by.eq.{current_user_id},assigned_to.eq.{current_user_id})"

    try:
        rows = _request("GET", "leads", params=params, auth_context=auth_context) or []
    except Exception as err:
        if not _missing_lead_followup_column(err):
            return None
        legacy_params = dict(params)
        legacy_params["select"] = (
            "id,address,zipcode,status,assignment_status,assigned_to,created_by,"
            "first_name,last_name,phone,email,notes,unqualified,unqualified_reason,"
            "listing_agent,created_at,updated_at"
        )
        rows = _request("GET", "leads", params=legacy_params, auth_context=auth_context) or []
        for row in rows:
            row.setdefault("lead_status", None)
            row.setdefault("follow_up_flags", [])
            row.setdefault("first_outreach_at", None)
            row.setdefault("first_meaningful_contact_at", None)
            row.setdefault("last_outreach_at", None)
            row.setdefault("last_inbound_at", None)
            row.setdefault("last_meaningful_contact_at", None)
            row.setdefault("next_follow_up_at", None)
            row.setdefault("last_activity_at", None)
            row.setdefault("last_activity_type", None)
            row.setdefault("last_activity_outcome", None)
            row.setdefault("next_recommended_step", None)
            row.setdefault("nurture_reason", None)
            row.setdefault("appointment_at", None)

    if not rows:
        return None
    enriched_rows = _enrich_rows_with_analysis(rows, auth_context=auth_context)
    return (enriched_rows or [None])[0]


def get_lead_activity_rows(lead_id, auth_context=None):
    if not supabase_enabled() or not lead_id:
        return []
    try:
        rows = _request(
            "GET",
            "lead_activities",
            params={
                "lead_id": f"eq.{lead_id}",
                "select": "id,activity_type,outcome,note_body,activity_at,requested_callback_at,appointment_at,nurture_reason,event_metadata,created_by,created_at",
                "order": "activity_at.desc,created_at.desc",
                "limit": "200",
            },
            auth_context=auth_context,
        )
        return rows or []
    except Exception:
        return []


def _sync_lead_follow_up(lead_row, auth_context=None):
    lead_id = lead_row.get("id")
    if not lead_id:
        return False
    activity_rows = get_lead_activity_rows(lead_id, auth_context=auth_context)
    derived = derive_lead_follow_up(lead_row, activity_rows)
    payload = {
        "lead_status": derived["lead_status"] if derived["lead_status"] in LEAD_STATUS_OPTIONS else "New",
        "follow_up_flags": _valid_json_flag_list(derived["follow_up_flags"]),
        "first_outreach_at": _iso_or_none(derived["first_outreach_at"]),
        "first_meaningful_contact_at": _iso_or_none(derived["first_meaningful_contact_at"]),
        "last_outreach_at": _iso_or_none(derived["last_outreach_at"]),
        "last_inbound_at": _iso_or_none(derived["last_inbound_at"]),
        "last_meaningful_contact_at": _iso_or_none(derived["last_meaningful_contact_at"]),
        "next_follow_up_at": _iso_or_none(derived["next_follow_up_at"]),
        "last_activity_at": _iso_or_none(derived["last_activity_at"]),
        "last_activity_type": derived["last_activity_type"] if derived["last_activity_type"] in ACTIVITY_TYPE_OPTIONS else None,
        "last_activity_outcome": derived["last_activity_outcome"] if derived["last_activity_outcome"] in OUTCOME_OPTIONS else None,
        "next_recommended_step": derived["next_recommended_step"],
        "appointment_at": _iso_or_none(derived["appointment_at"]),
        "nurture_reason": derived["nurture_reason"],
    }
    try:
        _request_leads_with_fallback(
            "PATCH",
            params={"id": f"eq.{lead_id}"},
            prefer="return=minimal",
            payload=payload,
            auth_context=auth_context,
        )
        return True
    except Exception:
        return False


def _get_lead_for_activity(lead_id, auth_context=None):
    if not lead_id:
        return None
    try:
        lead_rows = _request(
            "GET",
            "leads",
            params={
                "id": f"eq.{lead_id}",
                "select": "id",
                "limit": "1",
            },
            auth_context=auth_context,
        ) or []
    except Exception:
        return None
    return (lead_rows or [None])[0]


def update_lead_core_details(lead_id, details, auth_context=None):
    if not supabase_enabled() or not lead_id:
        return False
    payload = {
        "first_name": details.get("first_name") or None,
        "last_name": details.get("last_name") or None,
        "phone": details.get("phone") or None,
        "email": details.get("email") or None,
        "unqualified": details.get("unqualified"),
        "unqualified_reason": details.get("unqualified_reason") or None,
    }
    if "lead_status" in details and details.get("lead_status") in LEAD_STATUS_OPTIONS:
        payload["lead_status"] = details.get("lead_status")
    if "nurture_reason" in details:
        payload["nurture_reason"] = details.get("nurture_reason") or None
    try:
        _request_leads_with_fallback(
            "PATCH",
            params={"id": f"eq.{lead_id}"},
            prefer="return=minimal",
            payload=payload,
            auth_context=auth_context,
        )
        return True
    except Exception:
        return False


def create_manual_lead(details, auth_context=None):
    if not supabase_enabled():
        return {"ok": False, "error": "Supabase is not configured."}

    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    raw_address = str((details or {}).get("address") or "").strip()
    city = _string_or_none((details or {}).get("city"))
    state = _string_or_none((details or {}).get("state"))
    zipcode = coerce_zipcode((details or {}).get("zipcode"))
    locality_parts = [part for part in [city, state] if part]
    locality = ", ".join(locality_parts) if locality_parts else ""
    if zipcode:
        locality = f"{locality} {zipcode}".strip() if locality else zipcode
    address = raw_address
    if raw_address and locality and locality.lower() not in raw_address.lower():
        address = f"{raw_address}, {locality}"
    elif not raw_address:
        address = locality or ""
    if not organization_id or not current_user_id:
        return {"ok": False, "error": "No active signed-in user or organization."}
    if not address:
        return {"ok": False, "error": "Address is required."}

    normalized_address = _normalize_address(address)
    first_name = _string_or_none((details or {}).get("first_name"))
    last_name = _string_or_none((details or {}).get("last_name"))
    phone = _string_or_none((details or {}).get("phone"))
    email = _string_or_none((details or {}).get("email"))
    notes = _string_or_none((details or {}).get("notes"))

    try:
        existing_rows = _request(
            "GET",
            "leads",
            params={
                "organization_id": f"eq.{organization_id}",
                "normalized_address": f"eq.{normalized_address}",
                "select": "id,assigned_to,assignment_status,created_by,address",
                "limit": "1",
            },
            auth_context=auth_context,
        ) or []
        existing = (existing_rows or [None])[0]

        if existing:
            payload = {
                "address": address,
                "zipcode": zipcode,
                "first_name": first_name,
                "last_name": last_name,
                "phone": phone,
                "email": email,
                "notes": notes,
                "source": "field",
            }
            if not existing.get("assigned_to"):
                payload["assigned_to"] = current_user_id
                payload["assignment_status"] = "assigned"
            updated_rows = _request_leads_with_fallback(
                "PATCH",
                params={
                    "id": f"eq.{existing['id']}",
                    "select": "id,assigned_to,assignment_status,address",
                },
                prefer="return=representation",
                payload=payload,
                auth_context=auth_context,
            ) or []
            lead_row = (updated_rows or [existing])[0]
            return {
                "ok": True,
                "lead_id": lead_row.get("id"),
                "created": False,
                "assigned_to_current_user": lead_row.get("assigned_to") == current_user_id,
            }

        created_rows = _request_leads_with_fallback(
            "POST",
            params=None,
            payload={
                "organization_id": organization_id,
                "normalized_address": normalized_address,
                "address": address,
                "zipcode": zipcode,
                "owner_name": _combine_name(first_name, last_name),
                "first_name": first_name,
                "last_name": last_name,
                "phone": phone,
                "email": email,
                "notes": notes,
                "status": "open",
                "lead_status": "New",
                "assignment_status": "assigned",
                "assigned_to": current_user_id,
                "created_by": current_user_id,
                "source": "field",
            },
            prefer="return=representation",
            auth_context=auth_context,
        ) or []
        if not created_rows:
            return {"ok": False, "error": "Could not create lead."}
        lead_row = created_rows[0]
        return {
            "ok": True,
            "lead_id": lead_row.get("id"),
            "created": True,
            "assigned_to_current_user": True,
        }
    except Exception as err:
        return {"ok": False, "error": str(err)}


def log_property_visit(
    *,
    property_id=None,
    address=None,
    outcome,
    notes=None,
    interest_level=None,
    lat=None,
    lng=None,
    captured_at=None,
    route_run_id=None,
    follow_up_at=None,
    auth_context=None,
):
    if not supabase_enabled():
        return {"ok": False, "error": "Supabase is not configured."}

    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id or not current_user_id:
        return {"ok": False, "error": "No active signed-in user or organization."}

    normalized_address = _normalize_address(address) if address else None
    property_row = _get_property_by_lookup(
        organization_id=organization_id,
        property_id=property_id,
        normalized_address=normalized_address,
        auth_context=auth_context,
    )
    if not property_row:
        return {"ok": False, "error": "Property not found in the active organization."}

    try:
        visit_id = _request_rpc(
            "log_property_visit",
            payload={
                "p_organization_id": organization_id,
                "p_property_id": property_row.get("id"),
                "p_user_id": current_user_id,
                "p_outcome": outcome,
                "p_notes": _string_or_none(notes),
                "p_interest_level": _visit_interest_level(interest_level),
                "p_lat": _safe_float(lat),
                "p_lng": _safe_float(lng),
                "p_captured_at": _iso_or_none(captured_at),
                "p_route_run_id": route_run_id,
                "p_follow_up_at": _iso_or_none(follow_up_at),
            },
            auth_context=auth_context,
        )
        return {
            "ok": True,
            "visit_id": visit_id,
            "property_id": property_row.get("id"),
        }
    except Exception as err:
        return {"ok": False, "error": str(err)}


def add_lead_activity(
    lead_id,
    *,
    activity_type,
    outcome=None,
    note_body=None,
    activity_at=None,
    requested_callback_at=None,
    appointment_at=None,
    nurture_reason=None,
    event_metadata=None,
    auth_context=None,
):
    if not supabase_enabled() or not lead_id or activity_type not in ACTIVITY_TYPE_OPTIONS:
        return {"ok": False, "error": "Activity logging is not available."}
    if outcome and outcome not in allowed_outcomes_for_activity(activity_type):
        return {"ok": False, "error": "That outcome is not valid for the selected activity type."}
    organization_id = (auth_context or {}).get("organization_id")
    current_user_id = (auth_context or {}).get("app_user_id")
    if not organization_id:
        return {"ok": False, "error": "No active organization selected."}

    lead_row = _get_lead_for_activity(lead_id, auth_context=auth_context)
    if not lead_row:
        return {"ok": False, "error": "Lead not found or not visible in the active organization."}

    payload = {
        "organization_id": organization_id,
        "lead_id": lead_id,
        "activity_type": activity_type,
        "outcome": outcome if outcome in OUTCOME_OPTIONS else None,
        "note_body": note_body or None,
        "activity_at": datetime.now(timezone.utc).isoformat(),
        "requested_callback_at": _iso_or_none(requested_callback_at),
        "appointment_at": _iso_or_none(appointment_at),
        "nurture_reason": nurture_reason or None,
        "event_metadata": event_metadata or {},
        "created_by": current_user_id,
    }
    try:
        _request(
            "POST",
            "lead_activities",
            json_body=payload,
            prefer="return=minimal",
            auth_context=auth_context,
        )
    except Exception as err:
        return {"ok": False, "error": str(err)}
    _sync_lead_follow_up({"id": lead_id}, auth_context=auth_context)
    return {"ok": True}


def delete_lead_activity(activity_id, lead_id, auth_context=None):
    if not supabase_enabled() or not activity_id or not lead_id:
        return False
    try:
        _request(
            "DELETE",
            "lead_activities",
            params={"id": f"eq.{activity_id}"},
            auth_context=auth_context,
        )
    except Exception:
        return False
    lead_row = _get_lead_for_activity(lead_id, auth_context=auth_context)
    if not lead_row:
        return True
    _sync_lead_follow_up({"id": lead_id}, auth_context=auth_context)
    return True


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
        lead_row = _upsert_or_merge_lead(
            organization_id,
            current_user_id,
            result,
            auth_context=auth_context,
        )
        if not lead_row:
            return None
        lead_id = lead_row["id"]

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
                updated_rows = _request_lead_analysis_with_fallback(
                    "PATCH",
                    params={
                        "id": f"eq.{analysis_id}",
                        "select": "id",
                    },
                    prefer="return=representation",
                    payload=analysis_payload,
                    auth_context=auth_context,
                )
            except Exception as err:
                if not _missing_solar_details_column(err):
                    raise
                updated_rows = _request_lead_analysis_with_fallback(
                    "PATCH",
                    params={
                        "id": f"eq.{analysis_id}",
                        "select": "id",
                    },
                    prefer="return=representation",
                    payload=legacy_analysis_payload,
                    auth_context=auth_context,
                )
            if not updated_rows:
                return None
            analysis_id = updated_rows[0]["id"]
        else:
            try:
                created_rows = _request_lead_analysis_with_fallback(
                    "POST",
                    params=None,
                    payload=analysis_payload,
                    prefer="return=representation",
                    auth_context=auth_context,
                )
            except Exception as err:
                if not _missing_solar_details_column(err):
                    raise
                created_rows = _request_lead_analysis_with_fallback(
                    "POST",
                    params=None,
                    payload=legacy_analysis_payload,
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
        property_row = _upsert_property_record(
            organization_id=organization_id,
            lead_row=lead_row,
            source_payload=row_data,
            analysis_result=result,
            auth_context=auth_context,
        )
        _sync_property_solar_enrichment(
            organization_id=organization_id,
            property_id=(property_row or {}).get("id"),
            analysis_result=result,
            auth_context=auth_context,
        )
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
        "permit_pulled": analysis_row.get("permit_pulled"),
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
        "appointment_at": lead_row.get("appointment_at"),
        "lead_status": lead_row.get("lead_status"),
    }
    return _apply_display_priority(_merge_solar_details(result, analysis_row.get("solar_details")))
