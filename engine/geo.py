import re
import urllib.parse


def get_coordinates(address, gmaps_client):
    try:
        result = gmaps_client.geocode(address)
        if not result:
            return None, None
        loc = result[0]["geometry"]["location"]
        return loc["lat"], loc["lng"]
    except Exception:
        return None, None


def get_street_view_link(lat, lng, address):
    if lat and lng:
        return f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lng}"
    return f"https://www.google.com/maps/@?api=1&map_action=pano&query={urllib.parse.quote(address)}"


def get_parking_ease(address):
    lowered = address.lower()
    if any(word in lowered for word in ["drive", "court", "circle", "lane", "way"]):
        return "Good — suburban street"
    if any(word in lowered for word in ["avenue", "boulevard"]):
        return "Fair — may have street parking"
    if "street" in lowered:
        return "Check first — could be tight"
    return "Scout first"


def extract_zip(address):
    match = re.search(r"\b(\d{5})\b", str(address))
    return match.group(1) if match else "Unknown"

