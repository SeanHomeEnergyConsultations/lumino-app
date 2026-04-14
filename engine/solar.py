import requests


def get_solar_hours(lat, lng, key):
    if not lat or not lng:
        return None

    params = {"location.latitude": lat, "location.longitude": lng, "key": key}
    try:
        response = requests.get(
            "https://solar.googleapis.com/v1/buildingInsights:findClosest",
            params=params,
            timeout=10,
        )
        if response.status_code == 200:
            return response.json().get("solarPotential", {}).get("maxSunshineHoursPerYear")
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

