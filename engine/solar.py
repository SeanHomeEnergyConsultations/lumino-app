import requests


def get_solar_hours(lat, lng, key):
    if lat is None or lng is None:
        return None

    base_params = {"location.latitude": lat, "location.longitude": lng, "key": key}
    attempts = [
        {},
        {"requiredQuality": "MEDIUM", "exactQualityRequired": "false"},
    ]

    for extra_params in attempts:
        try:
            response = requests.get(
                "https://solar.googleapis.com/v1/buildingInsights:findClosest",
                params={**base_params, **extra_params},
                timeout=10,
            )
            if response.status_code == 200:
                solar_hours = response.json().get("solarPotential", {}).get("maxSunshineHoursPerYear")
                if solar_hours is not None:
                    return solar_hours
        except Exception:
            pass
    return None


def classify_sun_hours(hours):
    if not hours:
        return "Unknown", 0
    if hours >= 1400:
        return "Ideal", 3
    if hours >= 1200:
        return "Good", 2
    if hours >= 1000:
        return "Marginal", 1
    return "Poor", 0
