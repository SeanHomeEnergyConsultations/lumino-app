import time

import requests

from engine.geo import extract_zip, get_coordinates
from engine.solar import classify_sun_hours, get_solar_hours


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
        "maxResultCount": 20,
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
                        }
                    )
    except Exception:
        pass

    if not candidates:
        return []

    walkable = []
    routes_url = "https://routes.googleapis.com/directions/v2:computeRoutes"
    routes_headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration",
    }

    for candidate in candidates:
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
                        walkable.append(candidate["address"])
        except Exception:
            pass
        time.sleep(0.1)

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


def build_neighbor_analysis(addresses, gmaps_client, key, parent_zip):
    neighbor_data = []
    neighbor_records = []

    for neighbor in addresses:
        n_lat, n_lng = get_coordinates(neighbor, gmaps_client)
        if n_lat:
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
        time.sleep(0.1)

    return neighbor_data, neighbor_records

