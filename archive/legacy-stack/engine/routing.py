from math import asin, cos, radians, sin, sqrt


def haversine_distance(a, b):
    lat1 = radians(a["latitude"])
    lng1 = radians(a["longitude"])
    lat2 = radians(b["latitude"])
    lng2 = radians(b["longitude"])
    d_lat = lat2 - lat1
    d_lng = lng2 - lng1
    h = sin(d_lat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(d_lng / 2) ** 2
    return 2 * 6371 * asin(sqrt(h))


def route_distance(route):
    if len(route) < 2:
        return 0
    return sum(haversine_distance(route[i], route[i + 1]) for i in range(len(route) - 1))


def nearest_neighbor_route(locations, start_index=None, start_location=None):
    if start_location is not None:
        remaining = locations[:]
        route = []
        last = start_location
    else:
        route = [locations[start_index]]
        remaining = locations[:start_index] + locations[start_index + 1 :]
        last = route[-1]

    while remaining:
        next_stop = min(remaining, key=lambda location: haversine_distance(last, location))
        route.append(next_stop)
        remaining.remove(next_stop)
        last = next_stop

    return route


def two_opt(route):
    best_route = route[:]
    best_distance = route_distance(best_route)
    improved = True

    while improved:
        improved = False
        for i in range(1, len(best_route) - 2):
            for j in range(i + 1, len(best_route)):
                if j - i == 1:
                    continue
                candidate = best_route[:]
                candidate[i:j] = reversed(candidate[i:j])
                candidate_distance = route_distance(candidate)
                if candidate_distance + 1e-9 < best_distance:
                    best_route = candidate
                    best_distance = candidate_distance
                    improved = True
        route = best_route

    return best_route


def optimize_route(locations, start_location=None):
    valid_locations = [
        location
        for location in locations
        if location.get("latitude") is not None and location.get("longitude") is not None
    ]
    if not valid_locations:
        return []
    if len(valid_locations) <= 2:
        if start_location:
            return nearest_neighbor_route(valid_locations, start_location=start_location)
        return valid_locations

    best_route = None
    best_distance = None

    if start_location:
        candidate = nearest_neighbor_route(valid_locations, start_location=start_location)
        return two_opt(candidate)
    else:
        # Try multiple starting points so we do not anchor the route to priority.
        for start_index in range(len(valid_locations)):
            candidate = nearest_neighbor_route(valid_locations, start_index)
            candidate = two_opt(candidate)
            candidate_distance = route_distance(candidate)
            if best_route is None or candidate_distance < best_distance:
                best_route = candidate
                best_distance = candidate_distance

    return best_route
