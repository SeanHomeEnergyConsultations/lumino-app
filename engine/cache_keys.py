import hashlib
import json


def normalize_row_data(row_data):
    return {
        "address": str(row_data.get("address", "")).strip(),
        "price": row_data.get("price"),
        "price_remainder": row_data.get("price_remainder"),
        "beds": row_data.get("beds"),
        "baths": row_data.get("baths"),
        "sqft": row_data.get("sqft"),
        "sold_date": row_data.get("sold_date"),
    }


def make_analysis_cache_key(row_data):
    normalized = normalize_row_data(row_data)
    raw = json.dumps(normalized, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
