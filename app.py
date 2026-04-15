import json
import os
import time
import urllib.parse
from datetime import datetime

import googlemaps
import pandas as pd
import pydeck as pdk
import streamlit as st

from engine.constants import PRIORITY, get_priority_meta
from engine.execution import (
    STATUS_OPTIONS,
    INTEREST_LEVEL_OPTIONS,
    build_claude_url,
    build_execution_properties,
    build_follow_up_prompt,
    ensure_execution_state,
)
from engine.geolocation_component import geolocation_picker
from engine.persistence import load_app_snapshot, save_app_snapshot
from engine.processing import build_processing_error_result, process_address
from engine.reporting import build_route_csv, build_zip_summary, generate_html_report
from engine.routing import optimize_route
from engine.supabase_store import (
    create_route_run,
    get_open_lead_pool,
    get_rep_options,
    get_route_drafts,
    load_route_draft_results,
    save_analysis_result,
    save_route_draft,
    supabase_enabled,
    update_route_run_stop,
)
from engine.sheets import get_sheets_service, summarize_result_sources, sync_results_to_sheet


def priority_color(score):
    colors = {
        4: [201, 168, 76, 220],
        3: [67, 160, 71, 220],
        2: [38, 166, 154, 220],
        1: [230, 126, 34, 220],
        0: [97, 97, 97, 180],
    }
    return colors.get(score, [97, 97, 97, 180])


def marker_radius(doors_to_knock):
    try:
        doors = max(int(doors_to_knock or 0), 0)
    except Exception:
        doors = 0
    return 60 + min(doors * 18, 180)


def build_planning_map_df(results, selected_addresses):
    rows = []
    for idx, result in enumerate(results):
        if result.get("lat") is None or result.get("lng") is None:
            continue

        priority_score = result.get("priority_score", 0)
        priority_meta = get_priority_meta(priority_score)
        rows.append(
            {
                "address": result["address"],
                "lat": result["lat"],
                "lng": result["lng"],
                "priority_label": priority_meta["label"],
                "priority_score": priority_score,
                "solar_category": result.get("category", "Unknown"),
                "sun_hours_display": result.get("sun_hours_display", "N/A"),
                "doors_to_knock": result.get("doors_to_knock", 0),
                "price_display": result.get("price_display", "N/A"),
                "row_index": idx,
                "is_selected": result["address"] in selected_addresses,
                "radius": marker_radius(result.get("doors_to_knock", 0)),
                "fill_color": priority_color(priority_score),
                "line_color": [232, 238, 248, 255]
                if result["address"] in selected_addresses
                else [26, 37, 64, 160],
                "line_width": 5 if result["address"] in selected_addresses else 1,
            }
        )

    map_df = pd.DataFrame(rows)
    if map_df.empty:
        return map_df

    map_df["lat"] = pd.to_numeric(map_df["lat"], errors="coerce")
    map_df["lng"] = pd.to_numeric(map_df["lng"], errors="coerce")
    map_df = map_df.dropna(subset=["lat", "lng"])
    map_df = map_df[
        map_df["lat"].between(-90, 90) & map_df["lng"].between(-180, 180)
    ].reset_index(drop=True)

    if map_df.empty:
        return map_df

    map_df = map_df[~((map_df["lat"].abs() < 0.01) & (map_df["lng"].abs() < 0.01))].reset_index(drop=True)
    if map_df.empty:
        return map_df

    median_lat = float(map_df["lat"].median())
    median_lng = float(map_df["lng"].median())
    clustered = map_df[
        ((map_df["lat"] - median_lat).abs() <= 3)
        & ((map_df["lng"] - median_lng).abs() <= 3)
    ].reset_index(drop=True)
    if not clustered.empty:
        map_df = clustered
    return map_df


def estimate_zoom(map_df):
    if map_df.empty:
        return 10.5

    lat_span = float(map_df["lat"].max() - map_df["lat"].min())
    lng_span = float(map_df["lng"].max() - map_df["lng"].min())
    span = max(lat_span, lng_span)

    if span < 0.02:
        return 13
    if span < 0.05:
        return 12
    if span < 0.12:
        return 11
    if span < 0.3:
        return 10
    if span < 0.7:
        return 9
    return 8


def map_center(map_df):
    if map_df.empty:
        return 42.3601, -71.0589

    lat = float(map_df["lat"].median())
    lng = float(map_df["lng"].median())
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return 42.3601, -71.0589
    return lat, lng


def render_planning_map(results, selected_addresses):
    map_df = build_planning_map_df(results, selected_addresses)
    if map_df.empty:
        st.info("Planning map will appear once results with coordinates are available.")
        return

    center_lat, center_lng = map_center(map_df)
    layer = pdk.Layer(
        "ScatterplotLayer",
        id="planning-points",
        data=map_df,
        get_position="[lng, lat]",
        get_radius="radius",
        get_fill_color="fill_color",
        get_line_color="line_color",
        get_line_width="line_width",
        pickable=True,
        stroked=True,
        filled=True,
        radius_min_pixels=6,
        radius_max_pixels=28,
    )

    selected_layer = pdk.Layer(
        "ScatterplotLayer",
        id="planning-selected-points",
        data=map_df[map_df["is_selected"]],
        get_position="[lng, lat]",
        get_radius="radius * 1.25",
        get_fill_color="[255, 243, 176, 90]",
        get_line_color="[255, 243, 176, 255]",
        get_line_width=7,
        pickable=False,
        stroked=True,
        filled=True,
        radius_min_pixels=10,
        radius_max_pixels=34,
    )

    view_state = pdk.ViewState(
        latitude=center_lat,
        longitude=center_lng,
        zoom=estimate_zoom(map_df),
        pitch=0,
        controller=True,
    )

    tooltip = {
        "html": (
            "<b>{address}</b><br/>"
            "Priority: {priority_label}<br/>"
            "Solar: {solar_category}<br/>"
            "Sun Hours: {sun_hours_display}<br/>"
            "Doors: {doors_to_knock}<br/>"
            "Price: {price_display}"
        ),
        "style": {
            "backgroundColor": "#0D1220",
            "color": "#E8EEF8",
            "fontSize": "12px",
        },
    }

    if "planning_map_version" not in st.session_state:
        st.session_state["planning_map_version"] = 0

    selection_state = st.pydeck_chart(
        pdk.Deck(
            layers=[layer, selected_layer],
            initial_view_state=view_state,
            tooltip=tooltip,
            map_provider="carto",
            map_style="light",
        ),
        selection_mode="multi-object",
        on_select="rerun",
        key=f"planning_map_{st.session_state['planning_map_version']}",
        use_container_width=True,
    )

    try:
        selected_objects = selection_state.selection.objects.get("planning-points", [])
    except Exception:
        selected_objects = []

    if selected_objects:
        selected_from_map = {
            item.get("address")
            for item in selected_objects
            if item.get("address")
        }
        existing = set(st.session_state.setdefault("selected_route_addresses", set()))
        st.session_state["selected_route_addresses"] = existing.union(selected_from_map)
        for address in selected_from_map:
            st.session_state[f"chk_{address}"] = True
        st.session_state["planning_map_version"] += 1
        st.rerun()

    if selected_addresses:
        st.caption(f"{len(selected_addresses)} stops selected on the map/list. Selected clusters stay highlighted in gold.")


def normalize_column_name(name):
    return "".join(char.lower() for char in str(name or "") if char.isalnum())


COLUMN_ALIASES = {
    "address": [
        "address",
        "propertyaddress",
        "streetaddress",
        "serviceaddress",
        "siteaddress",
        "fulladdress",
        "owneraddress",
        "mailingaddress",
    ],
    "price": [
        "price",
        "saleprice",
        "listprice",
        "listingprice",
        "homeprice",
    ],
    "price_remainder": [
        "priceremainder",
        "remainder",
        "price2",
        "priceextra",
    ],
    "beds": ["beds", "bedrooms", "bed"],
    "baths": ["baths", "bathrooms", "bath"],
    "sqft": ["sqft", "squarefeet", "livingarea", "livingsqft", "area"],
    "sold_date": ["solddate", "date", "closedate", "datesold"],
    "listing_agent": ["listingagent", "agent", "agentname"],
    "first_name": ["firstname", "first"],
    "last_name": ["lastname", "last"],
    "phone": ["phone", "phonenumber", "mobile", "cell"],
    "email": ["email", "emailaddress"],
    "notes": ["notes", "note", "comments", "comment"],
    "unqualified": ["unqualified", "disqualified"],
    "unqualified_reason": ["unqualifiedreason", "disqualifiedreason", "reason"],
    "unqualified_reason_notes": [
        "unqualifiedreasonnotes",
        "disqualifiedreasonnotes",
        "reasonnotes",
    ],
}


def detect_column_mapping(columns):
    normalized = {column: normalize_column_name(column) for column in columns}
    mapping = {}

    for field, aliases in COLUMN_ALIASES.items():
        for column, normalized_name in normalized.items():
            if normalized_name in aliases:
                mapping[field] = column
                break

    if "address" not in mapping:
        for column, normalized_name in normalized.items():
            if "address" in normalized_name:
                mapping["address"] = column
                break

    return mapping


def get_row_value(row, column_name):
    if not column_name:
        return None
    return row[column_name]


def is_blank_value(value):
    if value is None:
        return True
    if pd.isna(value):
        return True
    return str(value).strip() == ""


INVALID_ADDRESS_VALUES = {
    "",
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "facebook",
    "fb",
    "instagram",
    "ig",
    "tiktok",
}

ADDRESS_HINTS = {
    "st",
    "street",
    "rd",
    "road",
    "ave",
    "avenue",
    "blvd",
    "boulevard",
    "dr",
    "drive",
    "ln",
    "lane",
    "ct",
    "court",
    "cir",
    "circle",
    "way",
    "pkwy",
    "parkway",
    "pl",
    "place",
    "trl",
    "trail",
    "ter",
    "terrace",
}


def combine_notes(*values):
    parts = []
    for value in values:
        if is_blank_value(value):
            continue
        text = str(value).strip()
        if text not in parts:
            parts.append(text)
    return "\n\n".join(parts) if parts else None


def is_probable_address(value):
    if is_blank_value(value):
        return False

    text = str(value).strip()
    normalized = text.lower()
    if normalized in INVALID_ADDRESS_VALUES:
        return False

    parts = [part.strip(".,#").lower() for part in text.split()]
    has_digit = any(char.isdigit() for char in text)
    has_address_hint = any(part in ADDRESS_HINTS for part in parts)
    has_multiple_words = len(parts) >= 2
    return has_digit or (has_address_hint and has_multiple_words)


def enrich_result_with_source_fields(result, row_data):
    enriched = dict(result)
    for key in [
        "first_name",
        "last_name",
        "phone",
        "email",
        "notes",
        "unqualified",
        "unqualified_reason",
        "unqualified_reason_notes",
        "listing_agent",
    ]:
        enriched[key] = row_data.get(key)
    return enriched


def navigation_links(result):
    address = result.get("parking_address") or result.get("address", "")
    lat = result.get("lat")
    lng = result.get("lng")

    if lat is not None and lng is not None:
        destination = f"{lat},{lng}"
        apple_destination = f"{lat},{lng}"
        waze_destination = f"{lat},{lng}"
    else:
        destination = urllib.parse.quote(address)
        apple_destination = urllib.parse.quote(address)
        waze_destination = urllib.parse.quote(address)

    google_url = f"https://www.google.com/maps/dir/?api=1&destination={destination}&travelmode=driving"
    apple_url = f"https://maps.apple.com/?daddr={apple_destination}&dirflg=d"
    waze_url = f"https://waze.com/ul?ll={waze_destination}&navigate=yes"
    return {
        "google": google_url,
        "apple": apple_url,
        "waze": waze_url,
    }


def display_kw(value):
    if value is None:
        return "N/A"
    return f"{value:,.1f} kW"


def display_kwh(value):
    if value is None:
        return "N/A"
    return f"{value:,.0f} kWh/yr"


def display_area(value):
    if value is None:
        return "N/A"
    return f"{value:,.1f} m²"


def default_start_location(results):
    coords = [
        (result.get("lat"), result.get("lng"))
        for result in results
        if result.get("lat") is not None and result.get("lng") is not None
    ]
    if not coords:
        return 42.3601, -71.0589
    lat = sum(item[0] for item in coords) / len(coords)
    lng = sum(item[1] for item in coords) / len(coords)
    return round(lat, 6), round(lng, 6)


def build_route_candidates(results):
    return [
        {
            "address": result["parking_address"],
            "latitude": result["lat"],
            "longitude": result["lng"],
            "priority": result["priority_score"],
            "source_result": result,
        }
        for result in results
        if result.get("lat") is not None and result.get("lng") is not None
    ]


def optimize_selected_results(selected_results, start_location=None):
    route_candidates = build_route_candidates(selected_results)
    ungeocoded_results = [
        result for result in selected_results if result.get("lat") is None or result.get("lng") is None
    ]
    optimized_stops = optimize_route(route_candidates, start_location=start_location)
    optimized_results = [stop["source_result"] for stop in optimized_stops] + ungeocoded_results
    return route_candidates, optimized_stops, optimized_results

# ─── API Key & Credentials ────────────────────────────────────────────────────
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")

raw_service_account = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
if raw_service_account:
    try:
        json.loads(raw_service_account)
    except json.JSONDecodeError as err:
        st.error(f"GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: {err}")
        st.stop()

if not GOOGLE_API_KEY:
    st.error("Missing GOOGLE_API_KEY in Railway variables.")
    st.stop()

# ─── Page config & CSS ────────────────────────────────────────────────────────
st.set_page_config(page_title="SolarIQ", page_icon="◈", layout="wide")

st.markdown("""
<style>
html, body, [class*="css"] {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
[data-testid="stAppViewContainer"] { background: #080C16; }
[data-testid="stHeader"]           { background: #080C16; }
[data-testid="stSidebar"] {
    background: #0A0E1A;
    border-right: 1px solid #1A2540;
}
[data-testid="stSidebar"] * { color: #8A95AA !important; }
[data-testid="stSidebar"] a { color: #C9A84C !important; }
.main .block-container { padding-top: 1.5rem; padding-bottom: 4rem; }
h1, h2, h3 { color: #E8EEF8 !important; }
p, li       { color: #8A95AA !important; }
[data-testid="metric-container"] {
    background: linear-gradient(145deg, #0D1220, #0A0E18);
    border: 1px solid #1A2540;
    border-radius: 12px;
    padding: 1.2rem;
    box-shadow: 4px 4px 12px rgba(0,0,0,0.5), -1px -1px 4px rgba(255,255,255,0.03);
}
[data-testid="metric-container"] label {
    color: #4A5A70 !important;
    font-size: 11px !important;
    text-transform: uppercase;
    letter-spacing: 1.5px;
}
[data-testid="metric-container"] [data-testid="stMetricValue"] {
    color: #C9A84C !important;
    font-size: 2.2rem !important;
    font-weight: 800 !important;
    text-shadow: 0 0 20px rgba(201,168,76,0.3);
}
.stButton > button, .stDownloadButton > button {
    background: linear-gradient(135deg, #D4AF50, #A07830) !important;
    color: #080608 !important;
    border: none !important;
    outline: none !important;
    border-radius: 6px !important;
    font-weight: 700 !important;
    letter-spacing: 0.8px !important;
    box-shadow: 0 4px 12px rgba(201,168,76,0.25), 0 1px 3px rgba(0,0,0,0.4) !important;
    text-shadow: none !important;
}
.stButton > button:hover, .stDownloadButton > button:hover {
    background: linear-gradient(135deg, #E8C860, #C9A84C) !important;
    box-shadow: 0 6px 16px rgba(201,168,76,0.4), 0 2px 4px rgba(0,0,0,0.4) !important;
    transform: translateY(-1px) !important;
}
.stButton > button p, .stDownloadButton > button p,
.stButton > button span, .stDownloadButton > button span {
    color: #080608 !important;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    text-shadow: none !important;
}
[data-testid="stFileUploader"] {
    background: linear-gradient(145deg, #0D1220, #0A0E18);
    border: 1px dashed #2A3A55;
    border-radius: 12px;
    padding: 1rem;
}
[data-testid="stDataFrame"] { border-radius: 10px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
[data-testid="stProgressBar"] > div > div {
    background: linear-gradient(90deg, #C9A84C, #E8C860) !important;
    box-shadow: 0 0 8px rgba(201,168,76,0.5);
}
[data-testid="stAlert"] { border-radius: 8px; }
details {
    background: linear-gradient(145deg, #0D1220, #0A0E18) !important;
    border: 1px solid #1A2540 !important;
    border-radius: 10px !important;
    box-shadow: 2px 2px 8px rgba(0,0,0,0.3) !important;
}
details summary { color: #8A95AA !important; }
[data-testid="stCheckbox"] label { color: #C0CAD8 !important; font-size: 13px !important; }
hr { border-color: #1A2540 !important; }
.dot-4 { display:inline-block; width:10px; height:10px; border-radius:50%; background:#C9A84C; margin-right:8px; box-shadow:0 0 6px rgba(201,168,76,0.6); vertical-align:middle; }
.dot-3 { display:inline-block; width:10px; height:10px; border-radius:50%; background:#43A047; margin-right:8px; box-shadow:0 0 6px rgba(67,160,71,0.6);  vertical-align:middle; }
.dot-2 { display:inline-block; width:10px; height:10px; border-radius:50%; background:#7CB342; margin-right:8px; box-shadow:0 0 6px rgba(124,179,66,0.5);  vertical-align:middle; }
.dot-1 { display:inline-block; width:10px; height:10px; border-radius:50%; background:#FF7043; margin-right:8px; box-shadow:0 0 6px rgba(255,112,67,0.5);  vertical-align:middle; }
.dot-0 { display:inline-block; width:10px; height:10px; border-radius:50%; background:#616161; margin-right:8px; vertical-align:middle; }
.siq-section {
    background: linear-gradient(90deg, #0D1830, transparent);
    border-left: 3px solid #C9A84C;
    padding: 10px 16px;
    border-radius: 0 8px 8px 0;
    margin: 28px 0 14px;
    color: #C9A84C !important;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
}
.siq-zip-header {
    border-top: 1px solid #1A2540;
    padding-top: 16px;
    margin-top: 10px;
    color: #4A5A70 !important;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
}
</style>
""", unsafe_allow_html=True)

api_key = GOOGLE_API_KEY

if "snapshot_loaded" not in st.session_state:
    snapshot = load_app_snapshot()
    if snapshot.get("route_execution") and "route_execution" not in st.session_state:
        st.session_state["route_execution"] = snapshot["route_execution"]
    st.session_state["last_snapshot_results_count"] = len(snapshot.get("all_results", []))
    st.session_state["snapshot_loaded"] = True

with st.sidebar:
    st.markdown("## SolarIQ")
    st.markdown("*Intelligent Solar Prospecting*")
    workspace_mode = st.radio(
        "Workspace",
        options=["Manager View", "Rep View"],
        key="workspace_mode",
    )
    st.markdown("---")
    st.markdown("**Workflow**")
    if workspace_mode == "Manager View":
        st.markdown("1. Upload your CSV")
        st.markdown("2. Run analysis")
        st.markdown("3. Select stops")
        st.markdown("4. Save route drafts")
        st.markdown("5. Assign routes")
    else:
        st.markdown("1. Open a saved draft")
        st.markdown("2. Start from current location")
        st.markdown("3. Navigate stop to stop")
        st.markdown("4. Complete or skip stops")
        st.markdown("5. Reoptimize as needed")
    st.markdown("---")
    st.markdown("**Scoring**")
    st.markdown("Solar hours gate all results. Value + sq ft amplify when solar is viable.")
    st.markdown("---")
    st.markdown("[Open Google Sheet](https://docs.google.com/spreadsheets/d/1qpx34ySHm5XPYpkNQxVx33KWS_971K2X1aBwmKerGGs)")

st.markdown("""
<div style="padding:2rem 0 1.5rem;">
    <div style="display:flex;align-items:baseline;gap:14px;">
        <span style="font-size:2.4rem;font-weight:900;color:#C9A84C;letter-spacing:-1px;
                     text-shadow:0 0 30px rgba(201,168,76,0.4);">SolarIQ</span>
        <span style="font-size:.85rem;color:#4A5A70;font-weight:400;letter-spacing:3px;text-transform:uppercase;">
            Intelligent Solar Prospecting
        </span>
    </div>
    <div style="height:2px;background:linear-gradient(90deg,#C9A84C,rgba(201,168,76,0.3),transparent);
                margin-top:10px;border-radius:2px;width:600px;
                box-shadow:0 0 10px rgba(201,168,76,0.3);"></div>
</div>
""", unsafe_allow_html=True)

if st.session_state.get("last_snapshot_results_count"):
    st.caption(
        f"Previous session found {st.session_state['last_snapshot_results_count']} analyzed leads. "
        "Use Upload or Load Open Lead Pool to start a fresh planning workspace."
    )

if supabase_enabled():
    st.markdown('<div class="siq-section">Open Lead Pool</div>', unsafe_allow_html=True)
    st.markdown("Load open, unassigned leads from Supabase into the planning workspace.")

    pool_col, drafts_col = st.columns(2)

    if workspace_mode == "Manager View" and pool_col.button("Load Open Lead Pool", use_container_width=True):
        pool_rows = get_open_lead_pool()
        if pool_rows:
            pool_results = []
            for row in pool_rows:
                pool_results.append(
                    {
                        "lead_id": row.get("id"),
                        "address": row.get("address", ""),
                        "lat": row.get("lat"),
                        "lng": row.get("lng"),
                        "zipcode": row.get("zipcode", "Unknown"),
                        "sun_hours": row.get("sun_hours"),
                        "sun_hours_display": f"{row['sun_hours']:.0f}" if row.get("sun_hours") else "N/A",
                        "category": row.get("category", "Unknown"),
                        "street_view_link": "",
                        "parking_ease": "",
                        "walkable_count": 0,
                        "ideal_count": 0,
                        "good_count": 0,
                        "priority_score": row.get("priority_score", 0),
                        "priority_label": row.get("priority_label", ""),
                        "parking_address": row.get("address", ""),
                        "doors_to_knock": row.get("doors_to_knock", 0),
                        "knock_addresses": [row.get("address")] if row.get("address") else [],
                        "neighbor_records": [],
                        "sale_price": None,
                        "price_display": "N/A",
                        "value_badge": "Unknown",
                        "sqft": None,
                        "sqft_display": "N/A",
                        "sold_date": "Unknown",
                        "beds": "",
                        "baths": "",
                        "value_score": 0,
                        "sqft_score": 0,
                        "first_name": row.get("first_name"),
                        "last_name": row.get("last_name"),
                        "phone": row.get("phone"),
                        "email": row.get("email"),
                        "notes": row.get("notes"),
                        "unqualified": row.get("unqualified"),
                        "unqualified_reason": row.get("unqualified_reason"),
                        "listing_agent": row.get("listing_agent"),
                    }
                )

            st.session_state["all_results"] = pool_results
            save_app_snapshot(
                all_results=pool_results,
                route_execution=st.session_state.get("route_execution", {}),
            )
            st.session_state["selected_route_addresses"] = set()
            st.session_state["current_route_draft_id"] = None
            st.session_state["current_route_draft_name"] = None
            st.session_state["active_route_run"] = None
            st.success(f"Loaded **{len(pool_results)}** open leads from Supabase.")
        else:
            st.info("No open leads were returned from Supabase.")

    if drafts_col.button("Load Saved Draft", use_container_width=True):
        st.session_state["show_route_drafts"] = True

    if st.session_state.get("show_route_drafts"):
        draft_rows = get_route_drafts()
        if draft_rows:
            draft_options = {
                f"{draft['name']} · {draft['status']} · "
                f"{(draft.get('app_users') or {}).get('full_name') or 'Unassigned'} · "
                f"{draft['created_at'][:10]}": draft["id"]
                for draft in draft_rows
            }
            selected_draft_label = st.selectbox(
                "Saved Drafts",
                options=list(draft_options.keys()),
                key="saved_draft_select",
            )
            if st.button("Open Draft", use_container_width=True):
                draft_results = load_route_draft_results(draft_options[selected_draft_label])
                if draft_results:
                    st.session_state["all_results"] = draft_results
                    st.session_state["selected_route_addresses"] = {
                        result["address"] for result in draft_results
                    }
                    for result in draft_results:
                        st.session_state[f'chk_{result["address"]}'] = True
                    save_app_snapshot(
                        all_results=draft_results,
                        route_execution=st.session_state.get("route_execution", {}),
                    )
                    st.session_state["current_route_draft_id"] = draft_options[selected_draft_label]
                    st.session_state["current_route_draft_name"] = selected_draft_label.split(" · ")[0]
                    st.session_state["active_route_run"] = None
                    st.success(f"Loaded **{len(draft_results)}** stops from the saved draft.")
                else:
                    st.info("That draft did not return any loadable stops.")
        else:
            st.info("No saved drafts found yet.")

uploaded_file = None
if workspace_mode == "Manager View":
    uploaded_file = st.file_uploader(
        "Upload your address list",
        type=["csv"],
        help="Address column is required. Pricing, home details, dates, agent info, and lead fields are optional and detected by header name.",
    )

if uploaded_file:
    df = pd.read_csv(uploaded_file, header=0)
    cols = df.columns.tolist()

    column_mapping = detect_column_mapping(cols)
    col_price = column_mapping.get("price")
    col_remainder = column_mapping.get("price_remainder")
    col_address = column_mapping.get("address")
    col_beds = column_mapping.get("beds")
    col_baths = column_mapping.get("baths")
    col_sqft = column_mapping.get("sqft")
    col_sold = column_mapping.get("sold_date")

    if not col_address:
        st.error("Could not find an address column. Include a header like Address or Property Address.")
    else:
        address_series = df[col_address].astype(str).where(df[col_address].notna(), "")
        stripped_addresses = address_series.str.strip()
        missing_address_mask = stripped_addresses == ""
        invalid_address_mask = ~missing_address_mask & ~stripped_addresses.apply(is_probable_address)
        valid_idx = df.index[~missing_address_mask & ~invalid_address_mask]
        missing_address_df = df.loc[missing_address_mask].copy()
        invalid_address_df = df.loc[invalid_address_mask].copy()
        st.success(f"**{len(valid_idx)} addresses** loaded and ready for analysis")
        if not missing_address_df.empty:
            st.warning(
                f"**{len(missing_address_df)} rows** are missing an address and will be skipped from analysis."
            )
        if not invalid_address_df.empty:
            st.warning(
                f"**{len(invalid_address_df)} rows** have placeholder or invalid address values and will be skipped from analysis."
            )

        with st.expander("Detected columns", expanded=False):
            mapping_preview = pd.DataFrame(
                [
                    {"Field": field.replace("_", " ").title(), "Column": column}
                    for field, column in column_mapping.items()
                ]
            )
            st.dataframe(mapping_preview, use_container_width=True, hide_index=True)

        with st.expander("Preview data"):
            st.dataframe(df.head(10), use_container_width=True)

        if not missing_address_df.empty:
            with st.expander("Rows Missing Address", expanded=False):
                st.dataframe(missing_address_df, use_container_width=True, hide_index=True)

        if not invalid_address_df.empty:
            with st.expander("Rows With Invalid Address Values", expanded=False):
                st.dataframe(invalid_address_df, use_container_width=True, hide_index=True)

        if st.button("Run Analysis", type="primary", use_container_width=True):
            gmaps_client = googlemaps.Client(key=api_key)
            all_results = []
            progress_bar = st.progress(0)
            status_text = st.empty()
            total = len(valid_idx)
            use_supabase = supabase_enabled()
            sheets_service = None if use_supabase else get_sheets_service()
            failed_addresses = []
            supabase_saved = 0
            supabase_failed = 0
            supabase_errors = []

            for i, (idx, row) in enumerate(df.loc[valid_idx].iterrows()):
                addr = str(row[col_address]).strip()
                status_text.markdown(f"Analyzing **{i + 1} of {total}** — {str(addr)[:60]}")
                row_data = {
                    "address": addr,
                    "price": get_row_value(row, col_price),
                    "price_remainder": get_row_value(row, col_remainder),
                    "beds": get_row_value(row, col_beds),
                    "baths": get_row_value(row, col_baths),
                    "sqft": get_row_value(row, col_sqft),
                    "sold_date": get_row_value(row, col_sold),
                    "listing_agent": get_row_value(row, column_mapping.get("listing_agent")),
                    "first_name": get_row_value(row, column_mapping.get("first_name")),
                    "last_name": get_row_value(row, column_mapping.get("last_name")),
                    "phone": get_row_value(row, column_mapping.get("phone")),
                    "email": get_row_value(row, column_mapping.get("email")),
                    "notes": combine_notes(
                        get_row_value(row, column_mapping.get("notes")),
                        get_row_value(row, column_mapping.get("unqualified_reason_notes")),
                    ),
                    "unqualified": get_row_value(row, column_mapping.get("unqualified")),
                    "unqualified_reason": get_row_value(row, column_mapping.get("unqualified_reason")),
                    "unqualified_reason_notes": get_row_value(
                        row,
                        column_mapping.get("unqualified_reason_notes"),
                    ),
                }
                try:
                    result = enrich_result_with_source_fields(
                        process_address(row_data, gmaps_client, api_key),
                        row_data,
                    )
                except Exception as err:
                    result = enrich_result_with_source_fields(
                        build_processing_error_result(row_data, str(err)),
                        row_data,
                    )
                    failed_addresses.append(addr)

                if use_supabase:
                    saved_record = save_analysis_result(row_data, result)
                    if saved_record and saved_record.get("ok"):
                        result["lead_id"] = saved_record["lead_id"]
                        supabase_saved += 1
                    else:
                        supabase_failed += 1
                        if saved_record and saved_record.get("error"):
                            supabase_errors.append(saved_record["error"])

                all_results.append(result)
                st.session_state["all_results"] = all_results
                st.session_state["current_route_draft_id"] = None
                st.session_state["current_route_draft_name"] = None
                st.session_state["active_route_run"] = None
                save_app_snapshot(
                    all_results=all_results,
                    route_execution=st.session_state.get("route_execution", {}),
                )

                progress_bar.progress((i + 1) / total)
                time.sleep(0.2)

            status_text.markdown("Analysis complete.")
            if use_supabase:
                source_counts = summarize_result_sources(all_results)
                if supabase_failed == 0:
                    st.success(
                        "Supabase updated — "
                        f"{source_counts['original_count']} original addresses and "
                        f"{source_counts['neighbor_count']} cluster neighbors are now available in the shared analysis store. "
                        f"({supabase_saved} lead records synced successfully.)"
                    )
                else:
                    st.warning(
                        "Supabase sync was partial — "
                        f"{supabase_saved} saved, {supabase_failed} failed. "
                        "Lead pool and draft actions may be incomplete for this run."
                    )
                    if supabase_errors:
                        st.code("\n\n".join(supabase_errors[:3]), language="text")
            elif sheets_service:
                status_text.markdown("Analysis complete — syncing to Google Sheets...")
                sheet_counts = sync_results_to_sheet(sheets_service, all_results)
                source_counts = summarize_result_sources(all_results)
                st.success(
                    f"Sheets updated — **{sheet_counts['inserted_total']}** new records added "
                    f"({sheet_counts['inserted_original']} original + {sheet_counts['inserted_neighbors']} cluster neighbors) · "
                    f"**{sheet_counts['updated_total']}** existing records refreshed "
                    f"({sheet_counts['updated_original']} original + {sheet_counts['updated_neighbors']} cluster neighbors) "
                    f"out of {source_counts['original_count']} original addresses and {source_counts['neighbor_count']} cluster neighbors analyzed"
                )

            if failed_addresses:
                st.warning(
                    f"Completed with **{len(failed_addresses)}** analysis errors. "
                    "Those addresses were kept in the results with a low-priority fallback instead of crashing the batch."
                )

if "all_results" in st.session_state:
    all_results = st.session_state["all_results"]

    if workspace_mode == "Manager View":
        st.markdown("---")
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Properties Analyzed", len(all_results))
        c2.metric("Premium + Highest", sum(1 for result in all_results if result["priority_score"] >= 3))
        c3.metric("High + Medium", sum(1 for result in all_results if result["priority_score"] in [1, 2]))
        c4.metric("Total Doors", sum(result["doors_to_knock"] for result in all_results))

        html_report = generate_html_report(all_results)
        st.download_button(
            label="Download Intelligence Report",
            data=html_report,
            file_name=f"solariq_report_{datetime.now().strftime('%Y%m%d_%H%M')}.html",
            mime="text/html",
            use_container_width=True,
            type="primary",
        )

        st.markdown('<div class="siq-section">Area Intelligence</div>', unsafe_allow_html=True)
        zip_summary = build_zip_summary(all_results)
        st.dataframe(
            pd.DataFrame(zip_summary).rename(
                columns={
                    "zipcode": "Zip",
                    "total": "Properties",
                    "high_priority": "High Priority",
                    "avg_sun_hours": "Avg Sun Hrs",
                    "avg_home_value": "Avg Home Value",
                    "total_doors": "Total Doors",
                    "zip_score": "Area Score",
                }
            ),
            use_container_width=True,
            hide_index=True,
        )
    else:
        zip_summary = build_zip_summary(all_results)
        st.markdown('<div class="siq-section">Rep Route</div>', unsafe_allow_html=True)
        st.markdown("Open a saved draft, start from your current location, and work the route stop by stop.")

    st.markdown('<div class="siq-section">Route Selection</div>', unsafe_allow_html=True)
    st.markdown(
        "Select stops to include in your route export."
        if workspace_mode == "Manager View"
        else "Review the stops currently in this route."
    )

    zip_rank = {item["zipcode"]: i for i, item in enumerate(zip_summary)}
    sorted_results = sorted(
        all_results,
        key=lambda x: (zip_rank.get(x["zipcode"], 99), -x["priority_score"], -x["doors_to_knock"]),
    )

    if "selected_route_addresses" not in st.session_state:
        st.session_state["selected_route_addresses"] = set()

    selected_addresses = set(st.session_state["selected_route_addresses"])
    render_planning_map(sorted_results, selected_addresses)

    selected = []
    current_zip = None
    for result in sorted_results:
        if result["priority_score"] == 0:
            continue
        if result["zipcode"] != current_zip:
            current_zip = result["zipcode"]
            z_data = next((item for item in zip_summary if item["zipcode"] == current_zip), {})
            st.markdown(
                f'<div class="siq-zip-header">Zip {current_zip} &nbsp;·&nbsp; '
                f'Score {z_data.get("zip_score", "?")} &nbsp;·&nbsp; '
                f'Avg {z_data.get("avg_home_value", "N/A")} &nbsp;·&nbsp; '
                f'{z_data.get("total_doors", "?")} doors</div>',
                unsafe_allow_html=True,
            )

        priority_score = result["priority_score"]
        priority_meta = get_priority_meta(priority_score)
        label = (
            f'{priority_meta["label"]}  {result["address"][:50]}  —  '
            f'{result["price_display"]}  |  {result["sqft_display"]}  |  '
            f'{result["sun_hours_display"]} sun hrs  |  {result["doors_to_knock"]} doors'
        )
        checked = st.checkbox(
            label,
            key=f'chk_{result["address"]}',
            value=result["address"] in selected_addresses,
        )
        if checked:
            st.session_state["selected_route_addresses"].add(result["address"])
            selected.append(result)
        else:
            st.session_state["selected_route_addresses"].discard(result["address"])

    if selected:
        st.success(
            f"**{len(selected)} stops** selected — "
            f"**{sum(result['doors_to_knock'] for result in selected)} total doors**"
        )

        if supabase_enabled():
            st.markdown('<div class="siq-section">Save Route Draft</div>', unsafe_allow_html=True)
            st.markdown("Save the selected stops for yourself or assign them to a rep.")
            rep_rows = get_rep_options()
            rep_labels = ["Unassigned"] + [
                f"{rep.get('full_name') or rep.get('email') or rep['id']} · {rep.get('role', 'rep')}"
                for rep in rep_rows
            ]
            rep_lookup = {
                f"{rep.get('full_name') or rep.get('email') or rep['id']} · {rep.get('role', 'rep')}": rep["id"]
                for rep in rep_rows
            }

            draft_name = st.text_input(
                "Draft Name",
                value=f"Route Draft {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                key="route_draft_name",
            )
            assigned_rep_label = st.selectbox(
                "Assign To Rep",
                options=rep_labels,
                key="route_draft_rep",
            )
            if st.button("Save Selected Stops as Draft", use_container_width=True):
                draft = save_route_draft(
                    draft_name.strip() or f"Route Draft {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                    selected,
                    assigned_rep_id=rep_lookup.get(assigned_rep_label),
                )
                if draft:
                    st.session_state["current_route_draft_id"] = draft["id"]
                    st.session_state["current_route_draft_name"] = draft["name"]
                    st.success("Route draft saved to Supabase.")
                else:
                    st.warning("Could not save the route draft to Supabase.")

        optimized_stops = []
        active_route = st.session_state.get("active_route_run")
        if active_route:
            execution_results = active_route.get("results", [])
            optimized_results = execution_results
            route_candidates = build_route_candidates(execution_results)
            optimized_stops = [
                {
                    "address": result["parking_address"],
                    "priority": result["priority_score"],
                    "source_result": result,
                }
                for result in execution_results
                if result.get("lat") is not None and result.get("lng") is not None
            ]
        else:
            route_candidates, optimized_stops, optimized_results = optimize_selected_results(selected)

        if optimized_results:
            st.markdown("**Optimized Route Order**")
            route_preview = pd.DataFrame(
                [
                    {
                        "Stop": idx + 1,
                        "Park At": stop["address"],
                        "Priority": get_priority_meta(stop["priority"])["label"],
                        "Knock Doors": stop["source_result"]["doors_to_knock"],
                        "Zip": stop["source_result"]["zipcode"],
                    }
                    for idx, stop in enumerate(optimized_stops)
                ]
            )
            st.dataframe(route_preview, use_container_width=True, hide_index=True)

        if supabase_enabled() and st.session_state.get("current_route_draft_id"):
            st.markdown('<div class="siq-section">Active Route Run</div>', unsafe_allow_html=True)
            start_lat_default, start_lng_default = default_start_location(selected)
            geolocation_result = geolocation_picker(
                key="route_geolocation",
                label="Use My Current Location",
            )
            if geolocation_result and not geolocation_result.get("error"):
                st.session_state["route_start_lat"] = geolocation_result["latitude"]
                st.session_state["route_start_lng"] = geolocation_result["longitude"]
                st.success(
                    f"Current location captured ({geolocation_result['latitude']:.5f}, {geolocation_result['longitude']:.5f})."
                )
            elif geolocation_result and geolocation_result.get("error"):
                st.warning(f"Location error: {geolocation_result['error']}")

            with st.expander("Manual Start Location Fallback", expanded=workspace_mode == "Manager View"):
                start_col1, start_col2 = st.columns(2)
                start_lat = start_col1.number_input(
                    "Start Latitude",
                    value=float(st.session_state.get("route_start_lat", start_lat_default)),
                    format="%.6f",
                    key="route_start_lat",
                )
                start_lng = start_col2.number_input(
                    "Start Longitude",
                    value=float(st.session_state.get("route_start_lng", start_lng_default)),
                    format="%.6f",
                    key="route_start_lng",
                )

            start_location = {"latitude": start_lat, "longitude": start_lng}
            if st.button("Start Route From Current Location", use_container_width=True):
                _route_candidates, _optimized_stops, started_results = optimize_selected_results(
                    selected,
                    start_location=start_location,
                )
                route_run = create_route_run(
                    st.session_state.get("current_route_draft_id"),
                    started_results,
                    start_lat=start_lat,
                    start_lng=start_lng,
                    start_label="Current location",
                )
                if route_run:
                    stop_map = {
                        stop["address"]: stop["id"]
                        for stop in route_run.get("route_run_stops", [])
                    }
                    for result in started_results:
                        result["route_run_stop_id"] = stop_map.get(result["address"])
                        result["route_run_status"] = "pending"
                    st.session_state["active_route_run"] = {
                        "id": route_run["route_run"]["id"],
                        "draft_id": st.session_state.get("current_route_draft_id"),
                        "results": started_results,
                        "start_location": start_location,
                    }
                    optimized_results = started_results
                    st.success("Active route run started.")
                else:
                    st.warning("Could not start a route run in Supabase.")

            if st.session_state.get("active_route_run"):
                run_col1, run_col2 = st.columns(2)
                if run_col1.button("Reoptimize Remaining Stops", use_container_width=True):
                    active_results = st.session_state["active_route_run"]["results"]
                    pending_results = [
                        result
                        for result in active_results
                        if result.get("route_run_status", "pending") == "pending"
                    ]
                    completed_results = [
                        result
                        for result in active_results
                        if result.get("route_run_status") != "pending"
                    ]
                    _candidates, _stops, reordered_pending = optimize_selected_results(
                        pending_results,
                        start_location=st.session_state["active_route_run"]["start_location"],
                    )
                    st.session_state["active_route_run"]["results"] = reordered_pending + completed_results
                    optimized_results = st.session_state["active_route_run"]["results"]
                    st.success("Remaining stops reoptimized.")

        execution_results = optimized_results if optimized_results else selected
        execution_properties = build_execution_properties(execution_results)
        st.session_state["route_execution"] = ensure_execution_state(
            st.session_state.get("route_execution", {}),
            execution_properties,
        )
        save_app_snapshot(
            all_results=st.session_state.get("all_results", []),
            route_execution=st.session_state["route_execution"],
        )

        st.download_button(
            label="Export Optimized Route to CSV",
            data=build_route_csv(optimized_results if optimized_results else selected),
            file_name=f"solariq_route_{datetime.now().strftime('%Y%m%d_%H%M')}.csv",
            mime="text/csv",
            use_container_width=True,
            type="primary",
        )

        st.markdown('<div class="siq-section">Route Execution</div>', unsafe_allow_html=True)
        st.markdown("Log what happened at each property and open Claude with a property-specific follow-up prompt.")

        pending_navigation_results = [
            result
            for result in execution_results
            if result.get("route_run_status", "pending") == "pending"
        ]
        if pending_navigation_results:
            next_stop = pending_navigation_results[0]
            next_links = navigation_links(next_stop)
            st.markdown("**Navigate To Next Stop**")
            nav_col1, nav_col2, nav_col3 = st.columns(3)
            nav_col1.link_button("Google Maps", next_links["google"], use_container_width=True)
            nav_col2.link_button("Apple Maps", next_links["apple"], use_container_width=True)
            nav_col3.link_button("Waze", next_links["waze"], use_container_width=True)

        properties_by_stop = {}
        for property_record in execution_properties:
            stop_number = property_record["route_stop_number"]
            properties_by_stop.setdefault(stop_number, []).append(property_record)

        for stop_number, stop_properties in properties_by_stop.items():
            primary_property = next(
                prop for prop in stop_properties if prop["property_type"] == "Primary Stop"
            )
            stop_title = (
                f"Stop {stop_number} · {primary_property['address']} · "
                f"{get_priority_meta(primary_property['priority_score'])['label']}"
            )
            with st.expander(stop_title, expanded=(stop_number == 1)):
                summary_cols = st.columns(4)
                summary_cols[0].metric("Property", primary_property["address"])
                summary_cols[1].metric("Doors", primary_property["doors_to_knock"])
                summary_cols[2].metric("Solar", primary_property["category"])
                active_result = next(
                    (result for result in execution_results if result["address"] == primary_property["address"]),
                    None,
                )
                summary_cols[3].metric(
                    "Run Status",
                    (active_result or {}).get("route_run_status", "pending").replace("_", " ").title(),
                )

                if primary_property.get("street_view_link"):
                    st.markdown(
                        f"[Street View]({primary_property['street_view_link']}) · "
                        f"[Directions](https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(primary_property['parking_address'])})"
                    )

                stop_links = navigation_links(active_result or primary_property)
                stop_nav_col1, stop_nav_col2, stop_nav_col3 = st.columns(3)
                stop_nav_col1.link_button(
                    f"Google Maps Stop {stop_number}",
                    stop_links["google"],
                    use_container_width=True,
                )
                stop_nav_col2.link_button(
                    f"Apple Maps Stop {stop_number}",
                    stop_links["apple"],
                    use_container_width=True,
                )
                stop_nav_col3.link_button(
                    f"Waze Stop {stop_number}",
                    stop_links["waze"],
                    use_container_width=True,
                )

                if active_result and active_result.get("route_run_stop_id"):
                    run_action_col1, run_action_col2 = st.columns(2)
                    if run_action_col1.button(
                        f"Complete Stop {stop_number}",
                        key=f"complete_stop_{stop_number}",
                        use_container_width=True,
                    ):
                        if update_route_run_stop(
                            active_result["route_run_stop_id"],
                            stop_status="completed",
                            outcome="callback",
                        ):
                            active_result["route_run_status"] = "completed"
                            st.success("Stop marked complete.")
                            st.rerun()
                    if run_action_col2.button(
                        f"Skip Stop {stop_number}",
                        key=f"skip_stop_{stop_number}",
                        use_container_width=True,
                    ):
                        if update_route_run_stop(
                            active_result["route_run_stop_id"],
                            stop_status="skipped",
                            skipped_reason="Skipped in field",
                        ):
                            active_result["route_run_status"] = "skipped"
                            st.success("Stop marked skipped.")
                            st.rerun()

                for property_record in stop_properties:
                    property_id = property_record["property_id"]
                    entry = st.session_state["route_execution"][property_id]
                    property_header = (
                        f"{property_record['property_type']} · {property_record['address']}"
                    )
                    st.markdown(f"**{property_header}**")

                    info_cols = st.columns(4)
                    info_cols[0].caption(
                        f"Priority: {property_record.get('priority_label') or get_priority_meta(property_record['priority_score'])['label']}"
                    )
                    info_cols[1].caption(f"Solar: {property_record.get('category', 'Unknown')}")
                    info_cols[2].caption(f"Sun: {property_record.get('sun_hours_display', 'N/A')}")
                    info_cols[3].caption(f"Zip: {property_record.get('zipcode', 'Unknown')}")

                    if property_record["property_type"] == "Primary Stop":
                        solar_metric_cols = st.columns(4)
                        solar_metric_cols[0].metric(
                            "Solar Fit",
                            str(property_record.get("solar_fit_score", 0)),
                        )
                        solar_metric_cols[1].metric(
                            "System Size",
                            display_kw(property_record.get("system_capacity_kw")),
                        )
                        solar_metric_cols[2].metric(
                            "Annual Output",
                            display_kwh(property_record.get("yearly_energy_dc_kwh")),
                        )
                        solar_metric_cols[3].metric(
                            "Max Panels",
                            property_record.get("max_array_panels_count") or "N/A",
                        )

                        solar_detail_cols = st.columns(4)
                        solar_detail_cols[0].caption(
                            f"Usable Array Area: {display_area(property_record.get('max_array_area_m2'))}"
                        )
                        solar_detail_cols[1].caption(
                            f"Roof Segments: {property_record.get('roof_segment_count') or 'N/A'}"
                        )
                        solar_detail_cols[2].caption(
                            f"South-Facing Segments: {property_record.get('south_facing_segment_count') or 'N/A'}"
                        )
                        solar_detail_cols[3].caption(
                            f"Imagery Quality: {property_record.get('imagery_quality') or 'N/A'}"
                        )

                        if property_record.get("whole_roof_area_m2") is not None or property_record.get("panel_capacity_watts") is not None:
                            solar_note_parts = []
                            if property_record.get("whole_roof_area_m2") is not None:
                                solar_note_parts.append(
                                    f"Whole roof area: {display_area(property_record.get('whole_roof_area_m2'))}"
                                )
                            if property_record.get("building_area_m2") is not None:
                                solar_note_parts.append(
                                    f"Building area: {display_area(property_record.get('building_area_m2'))}"
                                )
                            if property_record.get("panel_capacity_watts") is not None:
                                solar_note_parts.append(
                                    f"Panel model: {property_record.get('panel_capacity_watts'):,.0f} W"
                                )
                            st.caption(" · ".join(solar_note_parts))

                    status_col, interest_col = st.columns(2)
                    entry["status"] = status_col.selectbox(
                        "Status",
                        STATUS_OPTIONS,
                        index=STATUS_OPTIONS.index(entry["status"]) if entry["status"] in STATUS_OPTIONS else 0,
                        key=f"status_{property_id}",
                    )
                    entry["interest_level"] = interest_col.selectbox(
                        "Interest Level",
                        INTEREST_LEVEL_OPTIONS,
                        index=INTEREST_LEVEL_OPTIONS.index(entry["interest_level"])
                        if entry["interest_level"] in INTEREST_LEVEL_OPTIONS
                        else 0,
                        key=f"interest_{property_id}",
                    )

                    contact_col1, contact_col2 = st.columns(2)
                    entry["homeowner_name"] = contact_col1.text_input(
                        "Homeowner Name",
                        value=entry["homeowner_name"],
                        key=f"name_{property_id}",
                    )
                    entry["phone"] = contact_col2.text_input(
                        "Phone",
                        value=entry["phone"],
                        key=f"phone_{property_id}",
                    )

                    contact_col3, contact_col4 = st.columns(2)
                    entry["email"] = contact_col3.text_input(
                        "Email",
                        value=entry["email"],
                        key=f"email_{property_id}",
                    )
                    entry["best_follow_up_time"] = contact_col4.text_input(
                        "Best Follow-Up Time",
                        value=entry["best_follow_up_time"],
                        key=f"followup_{property_id}",
                    )

                    entry["notes"] = st.text_area(
                        "Visit Notes",
                        value=entry["notes"],
                        key=f"notes_{property_id}",
                        height=100,
                    )

                    prompt = build_follow_up_prompt(property_record, entry)
                    claude_url = build_claude_url(property_record, entry)

                    action_col1, action_col2 = st.columns(2)
                    action_col1.link_button(
                        "Open In Claude",
                        claude_url,
                        use_container_width=True,
                    )
                    action_col2.download_button(
                        "Download Prompt",
                        data=prompt,
                        file_name=f"followup_prompt_{property_id.replace(':', '_')}.txt",
                        mime="text/plain",
                        use_container_width=True,
                    )

                    with st.expander("Prompt Preview", expanded=False):
                        st.code(prompt, language="text")

                    st.session_state["route_execution"][property_id] = entry
                    save_app_snapshot(
                        all_results=st.session_state.get("all_results", []),
                        route_execution=st.session_state["route_execution"],
                    )
                    st.markdown("---")
