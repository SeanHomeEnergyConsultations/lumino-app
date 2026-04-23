import googlemaps

from engine.processing import build_processing_error_result, process_address
from engine.supabase_store import (
    complete_import_batch_item_analysis,
    get_leads_for_analysis,
    get_next_import_batch_items,
    mark_import_batch_items_analyzing,
    refresh_import_batch_progress,
    save_analysis_result,
)


def _merged_source_payload(item_row, lead_row):
    payload = dict(item_row.get("source_payload") or {})
    payload["address"] = payload.get("address") or lead_row.get("address") or item_row.get("raw_address")
    payload["raw_address"] = payload.get("raw_address") or item_row.get("raw_address")
    payload["zipcode"] = payload.get("zipcode") or lead_row.get("zipcode")
    payload["city"] = payload.get("city") or lead_row.get("city")
    payload["state"] = payload.get("state") or lead_row.get("state")
    payload["source_latitude"] = payload.get("source_latitude") or lead_row.get("lat")
    payload["source_longitude"] = payload.get("source_longitude") or lead_row.get("lng")
    payload["first_name"] = payload.get("first_name") or lead_row.get("first_name")
    payload["last_name"] = payload.get("last_name") or lead_row.get("last_name")
    payload["phone"] = payload.get("phone") or lead_row.get("phone")
    payload["email"] = payload.get("email") or lead_row.get("email")
    payload["notes"] = payload.get("notes") or lead_row.get("notes")
    payload["listing_agent"] = payload.get("listing_agent") or lead_row.get("listing_agent")
    payload["source"] = payload.get("source") or lead_row.get("source") or "imported"
    return payload


def _attach_lead_context(result, row_data):
    enriched = dict(result or {})
    for field in [
        "first_name",
        "last_name",
        "phone",
        "email",
        "notes",
        "listing_agent",
        "unqualified",
        "unqualified_reason",
        "source",
    ]:
        if field not in enriched or enriched.get(field) in (None, ""):
            enriched[field] = row_data.get(field)
    return enriched


def run_import_batch_chunk(batch_id, *, api_key, auth_context=None, chunk_size=5):
    if not api_key:
        return {"ok": False, "error": "Missing GOOGLE_API_KEY.", "batch_id": batch_id}

    items = get_next_import_batch_items(batch_id, limit=chunk_size, auth_context=auth_context)
    if not items:
        progress = refresh_import_batch_progress(batch_id, auth_context=auth_context) or {}
        return {
            "ok": True,
            "batch_id": batch_id,
            "processed_count": 0,
            "succeeded_count": 0,
            "failed_count": 0,
            "continued": False,
            **progress,
        }

    lead_rows = get_leads_for_analysis([item.get("lead_id") for item in items], auth_context=auth_context)
    mark_import_batch_items_analyzing(
        batch_id,
        [item["id"] for item in items if item.get("id")],
        [item.get("lead_id") for item in items if item.get("lead_id")],
        auth_context=auth_context,
    )

    gmaps_client = googlemaps.Client(key=api_key)
    succeeded_count = 0
    failed_count = 0
    errors = []

    for item in items:
        lead_row = lead_rows.get(item.get("lead_id")) or {}
        row_data = _merged_source_payload(item, lead_row)
        try:
            result = process_address(row_data, gmaps_client, api_key, auth_context=auth_context, analysis_mode="full")
        except Exception as err:
            result = build_processing_error_result(row_data, str(err))

        result = _attach_lead_context(result, row_data)
        save_result = save_analysis_result(row_data, result, auth_context=auth_context)

        if save_result and save_result.get("ok"):
            succeeded_count += 1
            complete_import_batch_item_analysis(
                batch_id,
                item_id=item["id"],
                lead_id=save_result.get("lead_id") or item.get("lead_id"),
                analysis_status="analyzed",
                analysis_error=None,
                analysis_attempt_count=int(lead_row.get("analysis_attempt_count") or 0) + 1,
                auth_context=auth_context,
            )
        else:
            failed_count += 1
            error_text = (save_result or {}).get("error") or result.get("analysis_error") or "Could not save analysis result."
            errors.append(error_text)
            complete_import_batch_item_analysis(
                batch_id,
                item_id=item["id"],
                lead_id=item.get("lead_id"),
                analysis_status="failed",
                analysis_error=error_text,
                analysis_attempt_count=int(lead_row.get("analysis_attempt_count") or 0) + 1,
                auth_context=auth_context,
            )

    progress = refresh_import_batch_progress(batch_id, auth_context=auth_context) or {}
    return {
        "ok": failed_count == 0,
        "batch_id": batch_id,
        "processed_count": len(items),
        "succeeded_count": succeeded_count,
        "failed_count": failed_count,
        "continued": (progress.get("pending_analysis_count", 0) or 0) > 0,
        "errors": errors[:3],
        **progress,
    }
