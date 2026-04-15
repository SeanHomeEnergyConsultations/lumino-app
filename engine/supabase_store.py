import os
from datetime import datetime, timezone

import requests

from engine.cache_keys import make_analysis_cache_key


TIMEOUT_SECONDS = 15


def supabase_enabled():
    return bool(os.getenv("SUPABASE_URL", "").strip() and os.getenv("SUPABASE_SECRET_KEY", "").strip())


def _base_url():
    return os.getenv("SUPABASE_URL", "").rstrip("/")


def _headers(prefer=None):
    key = os.getenv("SUPABASE_SECRET_KEY", "").strip()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _request(method, path, *, params=None, json_body=None, prefer=None):
    response = requests.request(
        method,
        f"{_base_url()}/rest/v1/{path.lstrip('/')}",
        headers=_headers(prefer=prefer),
        params=params,
        json=json_body,
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
        "sun_hours": result.get("sun_hours"),
        "sun_hours_display": result.get("sun_hours_display"),
        "category": result.get("category"),
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
    return {
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


def _knock_addresses(primary_address, neighbor_rows, category):
    knock_list = [primary_address] if category in {"Ideal", "Good"} and primary_address else []
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


def get_cached_analysis(row_data):
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
        )
        if rows:
            return _result_from_supabase_row(rows[0])
    except Exception:
        return None
    return None


def get_open_lead_pool(limit=500):
    if not supabase_enabled():
        return []

    try:
        rows = _request(
            "GET",
            "open_lead_pool",
            params={
                "select": (
                    "id,address,zipcode,lat,lng,first_name,last_name,phone,email,notes,"
                    "unqualified,unqualified_reason,listing_agent,priority_score,priority_label,"
                    "category,sun_hours,doors_to_knock"
                ),
                "order": "priority_score.desc,doors_to_knock.desc,address.asc",
                "limit": str(limit),
            },
        )
        return rows or []
    except Exception:
        return []


def get_rep_options():
    if not supabase_enabled():
        return []

    try:
        rows = _request(
            "GET",
            "app_users",
            params={
                "select": "id,full_name,email,role",
                "is_active": "eq.true",
                "order": "full_name.asc",
            },
        )
        return rows or []
    except Exception:
        return []


def save_route_draft(name, selected_results, assigned_rep_id=None):
    if not supabase_enabled() or not selected_results:
        return None

    try:
        draft_rows = _request(
            "POST",
            "route_drafts",
            json_body={
                "name": name,
                "assigned_rep_id": assigned_rep_id or None,
                "status": "assigned" if assigned_rep_id else "draft",
                "selection_mode": "manual",
            },
            prefer="return=representation",
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
            )

        return draft_rows[0]
    except Exception:
        return None


def get_route_drafts(limit=100):
    if not supabase_enabled():
        return []

    try:
        rows = _request(
            "GET",
            "route_drafts",
            params={
                "select": "id,name,status,assigned_rep_id,created_at,app_users!route_drafts_assigned_rep_id_fkey(full_name,email)",
                "order": "created_at.desc",
                "limit": str(limit),
            },
        )
        return rows or []
    except Exception:
        return []


def load_route_draft_results(route_draft_id):
    if not supabase_enabled():
        return []

    try:
        stop_rows = _request(
            "GET",
            "route_draft_stops",
            params={
                "route_draft_id": f"eq.{route_draft_id}",
                "select": "lead_id,sort_order",
                "order": "sort_order.asc",
            },
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
        ) or []
        lead_lookup = {row["id"]: row for row in lead_rows}

        analysis_rows = _request(
            "GET",
            "lead_analysis",
            params={
                "lead_id": f"in.({','.join(_quoted(lead_id) for lead_id in lead_ids)})",
                "select": "*",
            },
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


def create_route_run(route_draft_id, selected_results, start_lat=None, start_lng=None, start_label=None):
    if not supabase_enabled() or not selected_results:
        return None

    try:
        route_run_rows = _request(
            "POST",
            "route_runs",
            json_body={
                "route_draft_id": route_draft_id,
                "status": "active",
                "optimization_mode": "drive_time",
                "started_from_lat": start_lat,
                "started_from_lng": start_lng,
                "started_from_label": start_label or "Current location placeholder",
            },
            prefer="return=representation",
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
            },
            prefer="return=minimal",
        )

        return {"route_run": route_run, "route_run_stops": route_run_stops}
    except Exception:
        return None


def update_route_run_stop(route_run_stop_id, *, stop_status=None, outcome=None, skipped_reason=None):
    if not supabase_enabled():
        return False

    payload = {}
    if stop_status is not None:
        payload["stop_status"] = stop_status
    if outcome is not None:
        payload["outcome"] = outcome
    if skipped_reason is not None:
        payload["skipped_reason"] = skipped_reason
    if stop_status == "completed":
        payload["completed_at"] = datetime.now(timezone.utc).isoformat()

    try:
        _request(
            "PATCH",
            "route_run_stops",
            params={"id": f"eq.{route_run_stop_id}"},
            json_body=payload,
            prefer="return=minimal",
        )
        return True
    except Exception:
        return False


def save_analysis_result(row_data, result):
    if not supabase_enabled():
        return None

    cache_key = make_analysis_cache_key(row_data)
    try:
        lead_rows = _request(
            "POST",
            "leads",
            params={"on_conflict": "normalized_address"},
            json_body=_lead_payload(result),
            prefer="resolution=merge-duplicates,return=representation",
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
        )

        analysis_payload = _analysis_payload(cache_key, lead_id, result)
        if existing_analysis:
            analysis_id = existing_analysis[0]["id"]
            updated_rows = _request(
                "PATCH",
                "lead_analysis",
                params={
                    "id": f"eq.{analysis_id}",
                    "select": "id",
                },
                json_body=analysis_payload,
                prefer="return=representation",
            )
            if not updated_rows:
                return None
            analysis_id = updated_rows[0]["id"]
        else:
            created_rows = _request(
                "POST",
                "lead_analysis",
                json_body=analysis_payload,
                prefer="return=representation",
            )
            if not created_rows:
                return None
            analysis_id = created_rows[0]["id"]

        _request(
            "DELETE",
            "lead_neighbors",
            params={"lead_analysis_id": f"eq.{analysis_id}"},
        )
        neighbor_payloads = _neighbor_payloads(analysis_id, result)
        if neighbor_payloads:
            _request(
                "POST",
                "lead_neighbors",
                json_body=neighbor_payloads,
                prefer="return=minimal",
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
    return result
