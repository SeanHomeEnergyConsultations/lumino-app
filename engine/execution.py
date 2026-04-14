import urllib.parse


STATUS_OPTIONS = [
    "",
    "Interested",
    "Callback",
    "Not Interested",
    "Not Home 1",
    "Not Home 2",
    "Not Home 3",
]

INTEREST_LEVEL_OPTIONS = [
    "",
    "Hot",
    "Warm",
    "Cold",
]


def make_property_id(property_type, address, parent_address=""):
    normalized_type = str(property_type or "").strip().lower().replace(" ", "_")
    normalized_address = str(address or "").strip().lower()
    normalized_parent = str(parent_address or "").strip().lower()
    return f"{normalized_type}::{normalized_parent}::{normalized_address}"


def default_execution_entry():
    return {
        "status": "",
        "homeowner_name": "",
        "phone": "",
        "email": "",
        "best_follow_up_time": "",
        "interest_level": "",
        "notes": "",
    }


def build_execution_properties(selected_results):
    properties = []

    for stop_index, result in enumerate(selected_results, start=1):
        parent_address = result["address"]
        properties.append(
            {
                "property_id": make_property_id("primary_stop", parent_address),
                "address": parent_address,
                "property_type": "Primary Stop",
                "parent_stop_address": parent_address,
                "route_stop_number": stop_index,
                "lat": result.get("lat"),
                "lng": result.get("lng"),
                "street_view_link": result.get("street_view_link", ""),
                "priority_score": result.get("priority_score", 0),
                "priority_label": result.get("priority_label", ""),
                "sun_hours": result.get("sun_hours"),
                "sun_hours_display": result.get("sun_hours_display", "N/A"),
                "category": result.get("category", "Unknown"),
                "price_display": result.get("price_display", "N/A"),
                "sqft_display": result.get("sqft_display", "N/A"),
                "beds": result.get("beds", ""),
                "baths": result.get("baths", ""),
                "sold_date": result.get("sold_date", "Unknown"),
                "zipcode": result.get("zipcode", "Unknown"),
                "parking_address": result.get("parking_address", parent_address),
                "doors_to_knock": result.get("doors_to_knock", 0),
                "source_result_address": parent_address,
            }
        )

        for neighbor_index, neighbor in enumerate(result.get("neighbor_records", []), start=1):
            neighbor_address = neighbor["address"]
            properties.append(
                {
                    "property_id": make_property_id("cluster_neighbor", neighbor_address, parent_address),
                    "address": neighbor_address,
                    "property_type": "Cluster Neighbor",
                    "parent_stop_address": parent_address,
                    "route_stop_number": stop_index,
                    "neighbor_number": neighbor_index,
                    "lat": neighbor.get("lat"),
                    "lng": neighbor.get("lng"),
                    "street_view_link": "",
                    "priority_score": neighbor.get("priority_score", 0),
                    "priority_label": "",
                    "sun_hours": neighbor.get("sun_hours"),
                    "sun_hours_display": neighbor.get("sun_hours_display", "N/A"),
                    "category": neighbor.get("category", "Unknown"),
                    "price_display": neighbor.get("price_display", "N/A"),
                    "sqft_display": neighbor.get("sqft_display", "N/A"),
                    "beds": neighbor.get("beds", ""),
                    "baths": neighbor.get("baths", ""),
                    "sold_date": neighbor.get("sold_date", "N/A"),
                    "zipcode": neighbor.get("zipcode", result.get("zipcode", "Unknown")),
                    "parking_address": result.get("parking_address", parent_address),
                    "doors_to_knock": neighbor.get("doors_to_knock", 0),
                    "source_result_address": parent_address,
                }
            )

    return properties


def ensure_execution_state(existing_state, properties):
    state = dict(existing_state or {})
    for property_record in properties:
        property_id = property_record["property_id"]
        if property_id not in state:
            state[property_id] = default_execution_entry()
        else:
            merged = default_execution_entry()
            merged.update(state[property_id] or {})
            state[property_id] = merged
    return state


def build_follow_up_prompt(property_record, execution_entry):
    execution_entry = execution_entry or default_execution_entry()
    lines = ["help me follow up with this solar prospect.", ""]

    ordered_fields = [
        ("Address", property_record.get("address")),
        ("Property type", property_record.get("property_type")),
        ("Route stop", property_record.get("route_stop_number")),
        ("Priority", property_record.get("priority_label")),
        ("Solar category", property_record.get("category")),
        ("Sun hours", property_record.get("sun_hours_display")),
        ("Home value", property_record.get("price_display")),
        ("Square footage", property_record.get("sqft_display")),
        ("Beds/Baths", _format_beds_baths(property_record)),
        ("Sold date", property_record.get("sold_date")),
        ("Zip", property_record.get("zipcode")),
        ("Parking address", property_record.get("parking_address")),
        ("Visit status", execution_entry.get("status")),
        ("Homeowner name", execution_entry.get("homeowner_name")),
        ("Phone", execution_entry.get("phone")),
        ("Email", execution_entry.get("email")),
        ("Best follow-up time", execution_entry.get("best_follow_up_time")),
        ("Interest level", execution_entry.get("interest_level")),
        ("Visit notes", execution_entry.get("notes")),
    ]

    for label, value in ordered_fields:
        cleaned = _clean_value(value)
        if cleaned:
            lines.append(f"{label}: {cleaned}")

    lines.extend(
        [
            "",
            "Use this information to help me with the best next follow-up.",
        ]
    )
    return "\n".join(lines)


def build_claude_url(property_record, execution_entry):
    prompt = build_follow_up_prompt(property_record, execution_entry)
    return f"https://claude.ai/new?q={urllib.parse.quote(prompt)}"


def _format_beds_baths(property_record):
    beds = _clean_value(property_record.get("beds"))
    baths = _clean_value(property_record.get("baths"))
    if beds and baths:
        return f"{beds} / {baths}"
    return beds or baths


def _clean_value(value):
    if value is None:
        return ""
    if isinstance(value, str):
        stripped = value.strip()
        return "" if stripped in {"", "N/A", "Unknown"} else stripped
    return str(value)
