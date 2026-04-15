import pandas as pd

from engine.analysis_cache import get_cached_analysis, save_cached_analysis
from engine.clustering import build_neighbor_analysis, get_walking_neighbors
from engine.geo import extract_zip, get_coordinates, get_parking_ease, get_street_view_link
from engine.scoring import combined_priority, score_home_value, score_sqft
from engine.solar import classify_sun_hours, get_solar_hours


def parse_sale_price(price_thousands, price_remainder):
    try:
        thousands = (
            float(str(price_thousands).replace(",", "").strip())
            if pd.notna(price_thousands)
            else 0
        )
        remainder = (
            str(price_remainder).replace(",", "").strip()
            if pd.notna(price_remainder)
            else "0"
        )
        remainder_val = float(remainder) if remainder not in ["", "nan", "0"] else 0
        full_price = (thousands * 1000) + remainder_val
        return full_price if full_price > 0 else None
    except Exception:
        return None


def format_date(date_val):
    if pd.isna(date_val) or not date_val:
        return "Unknown"
    try:
        return pd.to_datetime(date_val).strftime("%b %Y")
    except Exception:
        return str(date_val)


def process_address(row_data, gmaps_client, key):
    cached_result = get_cached_analysis(row_data)
    if cached_result and (
        cached_result.get("sun_hours") is not None
        or cached_result.get("lat") is None
        or cached_result.get("lng") is None
    ):
        return cached_result

    address = str(row_data.get("address", ""))
    sale_price = parse_sale_price(row_data.get("price"), row_data.get("price_remainder"))
    sqft = row_data.get("sqft")
    sold_date = format_date(row_data.get("sold_date"))
    beds = row_data.get("beds")
    baths = row_data.get("baths")

    try:
        sqft_val = float(str(sqft).replace(",", "")) if pd.notna(sqft) else None
    except Exception:
        sqft_val = None

    zipcode = extract_zip(address)
    lat, lng = get_coordinates(address, gmaps_client)
    value_score, price_display, value_badge = score_home_value(sale_price)
    sqft_score, sqft_display = score_sqft(sqft_val)

    if not lat:
        return {
            "address": address,
            "lat": None,
            "lng": None,
            "zipcode": zipcode,
            "sun_hours": None,
            "sun_hours_display": "N/A",
            "category": "Unknown",
            "street_view_link": get_street_view_link(None, None, address),
            "parking_ease": get_parking_ease(address),
            "walkable_count": 0,
            "ideal_count": 0,
            "good_count": 0,
            "priority_score": 0,
            "priority_label": "LOW — Could not geocode",
            "parking_address": address,
            "doors_to_knock": 0,
            "knock_addresses": [],
            "neighbor_records": [],
            "sale_price": sale_price,
            "price_display": price_display,
            "value_badge": value_badge,
            "sqft": sqft_val,
            "sqft_display": sqft_display,
            "sold_date": sold_date,
            "beds": beds,
            "baths": baths,
            "value_score": value_score,
            "sqft_score": sqft_score,
        }

    sun_hours = get_solar_hours(lat, lng, key)
    category, sun_score = classify_sun_hours(sun_hours)
    sun_hours_display = f"{sun_hours:.0f}" if sun_hours else "N/A"

    walkable_addresses = get_walking_neighbors(lat, lng, key, walk_seconds=150)
    neighbor_data, neighbor_records = build_neighbor_analysis(
        walkable_addresses,
        key,
        zipcode,
    )

    cluster = [
        {
            "address": address,
            "sun_hours": sun_hours,
            "score": sun_score,
            "category": category,
            "lat": lat,
            "lng": lng,
        }
    ] + neighbor_data
    ideal_count = sum(1 for home in cluster if home.get("score", 0) >= 3)
    good_count = sum(1 for home in cluster if home.get("score", 0) >= 2)
    knock_doors = [home["address"] for home in cluster if home.get("score", 0) >= 2]

    priority_score, priority_label = combined_priority(
        sun_score,
        value_score,
        sqft_score,
        len(knock_doors),
    )

    best_home, best_score = address, sun_score
    for home in cluster:
        if home.get("score", 0) > best_score:
            best_score = home["score"]
            best_home = home["address"]

    result = {
        "address": address,
        "lat": lat,
        "lng": lng,
        "zipcode": zipcode,
        "sun_hours": sun_hours,
        "sun_hours_display": sun_hours_display,
        "category": category,
        "street_view_link": get_street_view_link(lat, lng, address),
        "parking_ease": get_parking_ease(address),
        "walkable_count": len(neighbor_data),
        "ideal_count": ideal_count,
        "good_count": good_count - ideal_count,
        "priority_score": priority_score,
        "priority_label": priority_label,
        "parking_address": best_home,
        "doors_to_knock": len(knock_doors),
        "knock_addresses": knock_doors,
        "neighbor_records": neighbor_records,
        "sale_price": sale_price,
        "price_display": price_display,
        "value_badge": value_badge,
        "sqft": sqft_val,
        "sqft_display": sqft_display,
        "sold_date": sold_date,
        "beds": beds,
        "baths": baths,
        "value_score": value_score,
        "sqft_score": sqft_score,
    }
    save_cached_analysis(row_data, result)
    return result


def build_processing_error_result(row_data, error_message):
    address = str(row_data.get("address", ""))
    sale_price = parse_sale_price(row_data.get("price"), row_data.get("price_remainder"))
    sqft = row_data.get("sqft")
    sold_date = format_date(row_data.get("sold_date"))
    beds = row_data.get("beds")
    baths = row_data.get("baths")

    try:
        sqft_val = float(str(sqft).replace(",", "")) if pd.notna(sqft) else None
    except Exception:
        sqft_val = None

    value_score, price_display, value_badge = score_home_value(sale_price)
    sqft_score, sqft_display = score_sqft(sqft_val)

    return {
        "address": address,
        "lat": None,
        "lng": None,
        "zipcode": extract_zip(address),
        "sun_hours": None,
        "sun_hours_display": "N/A",
        "category": "Unknown",
        "street_view_link": get_street_view_link(None, None, address),
        "parking_ease": get_parking_ease(address),
        "walkable_count": 0,
        "ideal_count": 0,
        "good_count": 0,
        "priority_score": 0,
        "priority_label": "LOW — Analysis error",
        "parking_address": address,
        "doors_to_knock": 0,
        "knock_addresses": [],
        "neighbor_records": [],
        "sale_price": sale_price,
        "price_display": price_display,
        "value_badge": value_badge,
        "sqft": sqft_val,
        "sqft_display": sqft_display,
        "sold_date": sold_date,
        "beds": beds,
        "baths": baths,
        "value_score": value_score,
        "sqft_score": sqft_score,
        "analysis_error": error_message,
    }
