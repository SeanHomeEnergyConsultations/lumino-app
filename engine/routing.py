from math import sqrt


def distance(a, b):
    return sqrt((a["latitude"] - b["latitude"]) ** 2 + (a["longitude"] - b["longitude"]) ** 2)


def optimize_route(locations):
    valid_locations = [
        location
        for location in locations
        if location.get("latitude") is not None and location.get("longitude") is not None
    ]
    if not valid_locations:
        return []

    ordered = sorted(valid_locations, key=lambda x: -x["priority"])
    route = [ordered[0]]
    remaining = ordered[1:]

    while remaining:
        last = route[-1]
        next_stop = min(remaining, key=lambda x: distance(last, x))
        route.append(next_stop)
        remaining.remove(next_stop)

    return route
