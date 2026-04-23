from math import asin, cos, radians, sin, sqrt

import requests

from engine.geo import extract_zip
from engine.solar import classify_sun_hours, get_solar_hours

MAX_NEARBY_CANDIDATES = 20
MAX_ROUTE_CHECKS = 12


def crow_fly_distance_meters(lat1, lng1, lat2, lng2):
    lat1_rad, lng1_rad = radians(lat1), radians(lng1)
    lat2_rad, lng2_rad = radians(lat2), radians(lng2)
    d_lat = lat2_rad - lat1_rad
    d_lng = lng2_rad - lng1_rad
    a = sin(d_lat / 2) ** 2 + cos(lat1_rad) * cos(lat2_rad) * sin(d_lng / 2) ** 2
    return 2 * 6371000 * asin(sqrt(a))


def get_walking_neighbors(lat, lng, key, walk_seconds=150):
    """
    Find nearby addresses then filter to those within walk_seconds walking time
    using the Routes API. Default 150s = 2.5 min walk.
    """
    url = "https://places.googleapis.com/v1/places:searchNearby"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.types,places.location",
    }
    body = {
        "maxResultCount": MAX_NEARBY_CANDIDATES,
        "locationRestriction": {
            "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 250}
        },
    }

    candidates = []
    try:
        response = requests.post(url, headers=headers, json=body, timeout=10)
        if response.status_code == 200:
            for place in response.json().get("places", []):
                address = place.get("formattedAddress", "")
                types = place.get("types", [])
                loc = place.get("location", {})
                is_residential = any(t in ["residential", "neighborhood", "premise"] for t in types)
                has_number = any(char.isdigit() for char in address) if address else False
                if address and (is_residential or has_number) and loc:
                    candidates.append(
                        {
                            "address": address,
                            "lat": loc.get("latitude"),
                            "lng": loc.get("longitude"),
                            "distance_meters": crow_fly_distance_meters(
                                lat,
                                lng,
                                loc.get("latitude"),
                                loc.get("longitude"),
                            ),
                        }
                    )
    except Exception:
        pass

    if not candidates:
        return []

    deduped = []
    seen_addresses = set()
    for candidate in sorted(candidates, key=lambda item: item.get("distance_meters") or float("inf")):
        address_key = candidate["address"].strip().lower()
        if address_key in seen_addresses:
            continue
        seen_addresses.add(address_key)
        deduped.append(candidate)

    route_candidates = deduped[:MAX_ROUTE_CHECKS]

    walkable = []
    routes_url = "https://routes.googleapis.com/directions/v2:computeRoutes"
    routes_headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration",
    }

    for candidate in route_candidates:
        if not candidate["lat"] or not candidate["lng"]:
            continue

        body = {
            "origin": {"location": {"latLng": {"latitude": lat, "longitude": lng}}},
            "destination": {
                "location": {
                    "latLng": {
                        "latitude": candidate["lat"],
                        "longitude": candidate["lng"],
                    }
                }
            },
            "travelMode": "WALK",
        }
        try:
            response = requests.post(routes_url, headers=routes_headers, json=body, timeout=8)
            if response.status_code == 200:
                routes = response.json().get("routes", [])
                if routes:
                    duration_str = routes[0].get("duration", "999s")
                    duration_sec = int(duration_str.replace("s", ""))
                    if duration_sec <= walk_seconds:
                        walkable.append(
                            {
                                "address": candidate["address"],
                                "lat": candidate["lat"],
                                "lng": candidate["lng"],
                                "walk_duration_sec": duration_sec,
                            }
                        )
        except Exception:
            pass

    return walkable


def make_neighbor_record(address, lat, lng, sun_hours, category, sun_score, parent_zip):
    return {
        "address": address,
        "lat": lat,
        "lng": lng,
        "zipcode": extract_zip(address) or parent_zip,
        "sun_hours": sun_hours,
        "sun_hours_display": f"{sun_hours:.0f}" if sun_hours else "N/A",
        "category": category,
        "priority_score": sun_score if sun_score > 0 else 0,
        "price_display": "N/A",
        "sqft_display": "N/A",
        "beds": "",
        "baths": "",
        "sold_date": "N/A",
        "doors_to_knock": 0,
        "source": "Cluster Neighbor",
    }


def build_neighbor_analysis(candidates, key, parent_zip):
    neighbor_data = []
    neighbor_records = []

    for candidate in candidates:
        n_lat = candidate.get("lat")
        n_lng = candidate.get("lng")
        neighbor = candidate.get("address", "")
        if not n_lat or not n_lng:
            continue

        n_sun = get_solar_hours(n_lat, n_lng, key)
        if n_sun:
            n_cat, n_score = classify_sun_hours(n_sun)
            neighbor_data.append(
                {
                    "address": neighbor,
                    "sun_hours": n_sun,
                    "category": n_cat,
                    "score": n_score,
                    "lat": n_lat,
                    "lng": n_lng,
                }
            )
            neighbor_records.append(
                make_neighbor_record(neighbor, n_lat, n_lng, n_sun, n_cat, n_score, parent_zip)
            )

    return neighbor_data, neighbor_records
