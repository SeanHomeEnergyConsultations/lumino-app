import json
from pathlib import Path


SNAPSHOT_DIR = Path(__file__).resolve().parents[1] / ".lumino_state"
SNAPSHOT_FILE = SNAPSHOT_DIR / "app_snapshot.json"


def load_app_snapshot():
    try:
        if not SNAPSHOT_FILE.exists():
            return {}
        return json.loads(SNAPSHOT_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_app_snapshot(all_results=None, route_execution=None):
    try:
        SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
        payload = load_app_snapshot()
        if all_results is not None:
            payload["all_results"] = all_results
        if route_execution is not None:
            payload["route_execution"] = route_execution

        tmp_file = SNAPSHOT_FILE.with_suffix(".tmp")
        tmp_file.write_text(json.dumps(payload), encoding="utf-8")
        tmp_file.replace(SNAPSHOT_FILE)
    except Exception:
        pass
