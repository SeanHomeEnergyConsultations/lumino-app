import os
import sys
import time
from datetime import datetime

from engine.import_runner import run_import_batch_chunk
from engine.supabase_store import (
    get_import_batch_by_id,
    get_next_pending_import_batch,
    supabase_enabled,
)


def _now_label():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _log(message):
    print(f"[{_now_label()}] {message}", flush=True)


def _batch_auth_context(batch_row):
    return {
        "organization_id": batch_row.get("organization_id"),
        "app_user_id": batch_row.get("created_by"),
    }


def process_one_batch_chunk(batch_row, *, api_key, chunk_size=5):
    auth_context = _batch_auth_context(batch_row)
    result = run_import_batch_chunk(
        batch_row["id"],
        api_key=api_key,
        auth_context=auth_context,
        chunk_size=chunk_size,
    )
    return result


def run_import_worker_loop(*, api_key, batch_id=None, chunk_size=5, idle_sleep_seconds=3):
    if not supabase_enabled():
        raise RuntimeError("Supabase is not configured for this environment.")
    if not api_key:
        raise RuntimeError("Missing GOOGLE_API_KEY.")

    _log("Import worker started.")
    while True:
        batch_row = get_import_batch_by_id(batch_id) if batch_id else get_next_pending_import_batch()
        if not batch_row:
            _log(f"No pending import batches found. Sleeping for {idle_sleep_seconds}s.")
            time.sleep(idle_sleep_seconds)
            continue

        _log(
            f"Processing batch {batch_row.get('id')} "
            f"({batch_row.get('filename') or 'upload'}) with "
            f"{batch_row.get('pending_analysis_count') or 0} pending."
        )
        result = process_one_batch_chunk(
            batch_row,
            api_key=api_key,
            chunk_size=chunk_size,
        )
        if result.get("error"):
            _log(f"Batch {batch_row.get('id')} error: {result.get('error')}")
        else:
            _log(
                f"Batch {batch_row.get('id')} chunk complete: "
                f"processed={result.get('processed_count', 0)} "
                f"saved={result.get('succeeded_count', 0)} "
                f"failed={result.get('failed_count', 0)} "
                f"pending={result.get('pending_analysis_count', 0)} "
                f"status={result.get('status') or 'unknown'}"
            )

        if batch_id:
            refreshed = get_import_batch_by_id(batch_id)
            if not refreshed or (refreshed.get("pending_analysis_count") or 0) <= 0:
                _log(f"Requested batch {batch_id} has no more pending analysis work. Worker exiting.")
                return

        time.sleep(0.5)


def main(argv=None):
    argv = list(argv or sys.argv[1:])
    batch_id = argv[0] if argv else None
    api_key = os.getenv("GOOGLE_API_KEY", "").strip()
    chunk_size = max(1, int(os.getenv("IMPORT_WORKER_CHUNK_SIZE", "5")))
    idle_sleep_seconds = max(1, int(os.getenv("IMPORT_WORKER_IDLE_SECONDS", "3")))
    run_import_worker_loop(
        api_key=api_key,
        batch_id=batch_id,
        chunk_size=chunk_size,
        idle_sleep_seconds=idle_sleep_seconds,
    )


if __name__ == "__main__":
    main()
