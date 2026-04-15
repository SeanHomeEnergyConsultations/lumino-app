import json
from pathlib import Path

from engine.cache_keys import make_analysis_cache_key
from engine.supabase_store import get_cached_analysis as get_supabase_cached_analysis
from engine.supabase_store import save_analysis_result as save_supabase_analysis_result


CACHE_VERSION = 1
CACHE_DIR = Path(__file__).resolve().parents[1] / ".lumino_state"
CACHE_FILE = CACHE_DIR / "analysis_cache.json"


def _load_cache():
    try:
        if not CACHE_FILE.exists():
            return {}
        payload = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        if payload.get("version") != CACHE_VERSION:
            return {}
        return payload.get("entries", {})
    except Exception:
        return {}


def _save_cache(entries):
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        payload = {"version": CACHE_VERSION, "entries": entries}
        tmp_file = CACHE_FILE.with_suffix(".tmp")
        tmp_file.write_text(json.dumps(payload), encoding="utf-8")
        tmp_file.replace(CACHE_FILE)
    except Exception:
        pass

def get_cached_analysis(row_data):
    entries = _load_cache()
    cached = entries.get(make_analysis_cache_key(row_data))
    if cached:
        return cached

    remote_cached = get_supabase_cached_analysis(row_data)
    if remote_cached:
        save_cached_analysis(row_data, remote_cached, remote=False)
        return remote_cached
    return None


def save_cached_analysis(row_data, result, remote=True):
    entries = _load_cache()
    entries[make_analysis_cache_key(row_data)] = result
    _save_cache(entries)
    if remote:
        save_supabase_analysis_result(row_data, result)
