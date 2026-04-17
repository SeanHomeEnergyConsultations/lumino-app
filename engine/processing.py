import pandas as pd

from engine.analysis_cache import get_cached_analysis, save_cached_analysis
from engine.clustering import build_neighbor_analysis, get_walking_neighbors
from engine.geo import extract_zip, get_coordinates, get_parking_ease, get_street_view_link
from engine.scoring import (
    combined_priority,
    score_home_value,
    score_roof_capacity,
    score_roof_complexity,
    score_solar_fit,
    score_sqft,
)
from engine.solar import classify_sun_hours, get_solar_insights


def parse_sale_price(price_thousands, price_remainder):
    try:
        primary_raw = str(price_thousands).replace(",", "").strip() if pd.notna(price_thousands) else ""
        remainder_raw = str(price_remainder).replace(",", "").strip() if pd.notna(price_remainder) else ""

        primary_val = float(primary_raw) if primary_raw not in ["", "nan"] else 0
        remainder_val = float(remainder_raw) if remainder_raw not in ["", "nan", "0"] else 0

        # Support both legacy "price in thousands" sheets and normal full-dollar price columns.
        # If a remainder column is present, treat the primary value as thousands.
        # Otherwise, large values are assumed to already be full-dollar prices.
        if remainder_val > 0:
            full_price = (primary_val * 1000) + remainder_val
        elif primary_val >= 10000:
            full_price = primary_val
        else:
            full_price = primary_val * 1000

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


def coerce_coordinate(value):
    try:
        if pd.isna(value):
            return None
        numeric = float(str(value).replace(",", "").strip())
        return numeric
    except Exception:
        return None


def coerce_zipcode(value):
    text = str(value or "").strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    return text


def process_address(row_data, gmaps_client, key, auth_context=None, analysis_mode="full"):
    cached_result = get_cached_analysis(row_data, auth_context=auth_context)
    if cached_result:
        has_modern_solar_fields = (
            "solar_fit_score" in cached_result
            and "max_array_panels_count" in cached_result
            and "roof_capacity_score" in cached_result
        )
        if has_modern_solar_fields and (
            cached_result.get("sun_hours") is not None
            or cached_result.get("lat") is None
            or cached_result.get("lng") is None
        ):
            return cached_result

    address = str(row_data.get("address", ""))
    sale_price = parse_sale_price(row_data.get("price"), row_data.get("price_remainder"))
    sqft = row_data.get("sqft")
    sold_date = format_date(row_data.get("sold_date"))
    permit_pulled = format_date(row_data.get("permit_pulled"))
    beds = row_data.get("beds")
    baths = row_data.get("baths")
    property_type = row_data.get("property_type")
    lot_size = row_data.get("lot_size")
    year_built = row_data.get("year_built")

    try:
        sqft_val = float(str(sqft).replace(",", "")) if pd.notna(sqft) else None
    except Exception:
        sqft_val = None

    zipcode = coerce_zipcode(row_data.get("zipcode")) or extract_zip(address)
    source_lat = coerce_coordinate(row_data.get("source_latitude"))
    source_lng = coerce_coordinate(row_data.get("source_longitude"))
    if source_lat is not None and source_lng is not None:
        lat, lng = source_lat, source_lng
    else:
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
            "permit_pulled": permit_pulled,
            "beds": beds,
            "baths": baths,
            "property_type": property_type,
            "lot_size": lot_size,
            "year_built": year_built,
            "source_latitude": source_lat,
            "source_longitude": source_lng,
            "value_score": value_score,
            "sqft_score": sqft_score,
        }

    solar_insights = get_solar_insights(lat, lng, key)
    sun_hours = solar_insights.get("sun_hours")
    category, sun_score = classify_sun_hours(sun_hours)
    sun_hours_display = f"{sun_hours:.0f}" if sun_hours else "N/A"
    roof_capacity_score = score_roof_capacity(
        solar_insights.get("max_array_panels_count"),
        solar_insights.get("max_array_area_m2"),
        solar_insights.get("yearly_energy_dc_kwh"),
    )
    roof_complexity_score = score_roof_complexity(
        solar_insights.get("roof_segment_count"),
        solar_insights.get("south_facing_segment_count"),
    )
    solar_fit_score = score_solar_fit(sun_score, roof_capacity_score, roof_complexity_score)

    if str(analysis_mode or "full").strip().lower() == "fast":
        neighbor_data = []
        neighbor_records = []
    else:
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
        solar_fit_score,
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
        "solar_fit_score": solar_fit_score,
        "roof_capacity_score": roof_capacity_score,
        "roof_complexity_score": roof_complexity_score,
        "max_array_panels_count": solar_insights.get("max_array_panels_count"),
        "max_array_area_m2": solar_insights.get("max_array_area_m2"),
        "panel_capacity_watts": solar_insights.get("panel_capacity_watts"),
        "system_capacity_kw": solar_insights.get("system_capacity_kw"),
        "yearly_energy_dc_kwh": solar_insights.get("yearly_energy_dc_kwh"),
        "roof_segment_count": solar_insights.get("roof_segment_count"),
        "south_facing_segment_count": solar_insights.get("south_facing_segment_count"),
        "whole_roof_area_m2": solar_insights.get("whole_roof_area_m2"),
        "building_area_m2": solar_insights.get("building_area_m2"),
        "imagery_quality": solar_insights.get("imagery_quality"),
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
        "permit_pulled": permit_pulled,
        "beds": beds,
        "baths": baths,
        "property_type": property_type,
        "lot_size": lot_size,
        "year_built": year_built,
        "source_latitude": source_lat,
        "source_longitude": source_lng,
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
    permit_pulled = format_date(row_data.get("permit_pulled"))
    beds = row_data.get("beds")
    baths = row_data.get("baths")
    property_type = row_data.get("property_type")
    lot_size = row_data.get("lot_size")
    year_built = row_data.get("year_built")
    source_lat = coerce_coordinate(row_data.get("source_latitude"))
    source_lng = coerce_coordinate(row_data.get("source_longitude"))

    try:
        sqft_val = float(str(sqft).replace(",", "")) if pd.notna(sqft) else None
    except Exception:
        sqft_val = None

    value_score, price_display, value_badge = score_home_value(sale_price)
    sqft_score, sqft_display = score_sqft(sqft_val)

    zipcode = coerce_zipcode(row_data.get("zipcode")) or extract_zip(address)

    return {
        "address": address,
        "lat": None,
        "lng": None,
        "zipcode": zipcode,
        "sun_hours": None,
        "sun_hours_display": "N/A",
        "category": "Unknown",
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
        "permit_pulled": permit_pulled,
        "beds": beds,
        "baths": baths,
        "property_type": property_type,
        "lot_size": lot_size,
        "year_built": year_built,
        "source_latitude": source_lat,
        "source_longitude": source_lng,
        "value_score": value_score,
        "sqft_score": sqft_score,
        "analysis_error": error_message,
    }
