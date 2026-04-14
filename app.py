import json
import os
import time
import urllib.parse
from datetime import datetime

import googlemaps
import pandas as pd
import pydeck as pdk
import streamlit as st

from engine.constants import PRIORITY
from engine.execution import (
    STATUS_OPTIONS,
    INTEREST_LEVEL_OPTIONS,
    build_claude_url,
    build_execution_properties,
    build_follow_up_prompt,
    ensure_execution_state,
)
from engine.processing import process_address
from engine.reporting import build_route_csv, build_zip_summary, generate_html_report
from engine.routing import optimize_route
from engine.sheets import get_sheets_service, sync_results_to_sheet


def priority_color(score):
    colors = {
        4: [201, 168, 76, 220],
        3: [67, 160, 71, 220],
        2: [124, 179, 66, 220],
        1: [255, 112, 67, 220],
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
    for result in results:
        if result.get("lat") is None or result.get("lng") is None:
            continue

        priority_score = result.get("priority_score", 0)
        rows.append(
            {
                "address": result["address"],
                "lat": result["lat"],
                "lng": result["lng"],
                "priority_label": PRIORITY[priority_score]["label"],
                "priority_score": priority_score,
                "solar_category": result.get("category", "Unknown"),
                "sun_hours_display": result.get("sun_hours_display", "N/A"),
                "doors_to_knock": result.get("doors_to_knock", 0),
                "price_display": result.get("price_display", "N/A"),
                "radius": marker_radius(result.get("doors_to_knock", 0)),
                "fill_color": priority_color(priority_score),
                "line_color": [232, 238, 248, 255]
                if result["address"] in selected_addresses
                else [26, 37, 64, 160],
                "line_width": 5 if result["address"] in selected_addresses else 1,
            }
        )

    return pd.DataFrame(rows)


def render_planning_map(results, selected_addresses):
    map_df = build_planning_map_df(results, selected_addresses)
    if map_df.empty:
        st.info("Planning map will appear once results with coordinates are available.")
        return

    layer = pdk.Layer(
        "ScatterplotLayer",
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

    view_state = pdk.ViewState(
        latitude=float(map_df["lat"].mean()),
        longitude=float(map_df["lng"].mean()),
        zoom=10.5,
        pitch=0,
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

    st.pydeck_chart(
        pdk.Deck(
            layers=[layer],
            initial_view_state=view_state,
            tooltip=tooltip,
            map_provider="carto",
            map_style="light",
        ),
        use_container_width=True,
    )

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
with st.sidebar:
    st.markdown("## SolarIQ")
    st.markdown("*Intelligent Solar Prospecting*")
    st.markdown("---")
    st.markdown("**Workflow**")
    st.markdown("1. Upload your CSV")
    st.markdown("2. Run analysis")
    st.markdown("3. Results sync to Sheets")
    st.markdown("4. Select stops for routing")
    st.markdown("5. Download HTML report")
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

uploaded_file = st.file_uploader(
    "Upload your address list",
    type=["csv"],
    help="Columns: price (A), remainder (B), address (C), beds (D), baths (E), sqft (F), Sold Date (G)",
)

if uploaded_file:
    df = pd.read_csv(uploaded_file, header=0)
    cols = df.columns.tolist()

    def safe_col(idx):
        return cols[idx] if idx < len(cols) else None

    col_price = safe_col(0)
    col_remainder = safe_col(1)
    col_address = safe_col(2)
    col_beds = safe_col(3)
    col_baths = safe_col(4)
    col_sqft = safe_col(5)
    col_sold = safe_col(6)

    if not col_address:
        st.error("Could not find address column. Make sure address is in column C.")
    else:
        raw_addresses = df[col_address].dropna().astype(str).str.strip().replace("", float("nan")).dropna()
        valid_idx = raw_addresses.index
        st.success(f"**{len(valid_idx)} addresses** loaded and ready for analysis")

        with st.expander("Preview data"):
            st.dataframe(df.head(10), use_container_width=True)

        if st.button("Run Analysis", type="primary", use_container_width=True):
            gmaps_client = googlemaps.Client(key=api_key)
            all_results = []
            progress_bar = st.progress(0)
            status_text = st.empty()
            total = len(valid_idx)

            for i, (idx, row) in enumerate(df.loc[valid_idx].iterrows()):
                addr = str(row[col_address]).strip()
                status_text.markdown(f"Analyzing **{i + 1} of {total}** — {str(addr)[:60]}")
                row_data = {
                    "address": addr,
                    "price": row[col_price] if col_price else None,
                    "price_remainder": row[col_remainder] if col_remainder else None,
                    "beds": row[col_beds] if col_beds else None,
                    "baths": row[col_baths] if col_baths else None,
                    "sqft": row[col_sqft] if col_sqft else None,
                    "sold_date": row[col_sold] if col_sold else None,
                }
                all_results.append(process_address(row_data, gmaps_client, api_key))
                progress_bar.progress((i + 1) / total)
                time.sleep(0.2)

            status_text.markdown("Analysis complete — syncing to Google Sheets...")
            sheets_service = get_sheets_service()
            if sheets_service:
                inserted, updated = sync_results_to_sheet(sheets_service, all_results)
                neighbor_count = sum(len(result.get("neighbor_records", [])) for result in all_results)
                st.success(
                    f"Sheets updated — **{inserted}** new records added "
                    f"({inserted - neighbor_count} original + {neighbor_count} cluster neighbors) · "
                    f"**{updated}** existing records refreshed"
                )

            st.session_state["all_results"] = all_results

if "all_results" in st.session_state:
    all_results = st.session_state["all_results"]

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

    st.markdown('<div class="siq-section">Route Selection</div>', unsafe_allow_html=True)
    st.markdown("Select stops to include in your route export.")

    zip_rank = {item["zipcode"]: i for i, item in enumerate(zip_summary)}
    sorted_results = sorted(
        all_results,
        key=lambda x: (zip_rank.get(x["zipcode"], 99), -x["priority_score"], -x["doors_to_knock"]),
    )

    selected_addresses = {
        result["address"]
        for result in sorted_results
        if st.session_state.get(f'chk_{result["address"]}')
    }
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
        label = (
            f'{PRIORITY[priority_score]["label"]}  {result["address"][:50]}  —  '
            f'{result["price_display"]}  |  {result["sqft_display"]}  |  '
            f'{result["sun_hours_display"]} sun hrs  |  {result["doors_to_knock"]} doors'
        )
        if st.checkbox(label, key=f'chk_{result["address"]}'):
            selected.append(result)

    if selected:
        st.success(
            f"**{len(selected)} stops** selected — "
            f"**{sum(result['doors_to_knock'] for result in selected)} total doors**"
        )
        route_candidates = [
            {
                "address": result["parking_address"],
                "latitude": result["lat"],
                "longitude": result["lng"],
                "priority": result["priority_score"],
                "source_result": result,
            }
            for result in selected
            if result.get("lat") is not None and result.get("lng") is not None
        ]
        ungeocoded_results = [
            result for result in selected if result.get("lat") is None or result.get("lng") is None
        ]
        optimized_stops = optimize_route(route_candidates)
        optimized_results = [stop["source_result"] for stop in optimized_stops] + ungeocoded_results

        if optimized_results:
            st.markdown("**Optimized Route Order**")
            route_preview = pd.DataFrame(
                [
                    {
                        "Stop": idx + 1,
                        "Park At": stop["address"],
                        "Priority": PRIORITY[stop["priority"]]["label"],
                        "Knock Doors": stop["source_result"]["doors_to_knock"],
                        "Zip": stop["source_result"]["zipcode"],
                    }
                    for idx, stop in enumerate(optimized_stops)
                ]
            )
            st.dataframe(route_preview, use_container_width=True, hide_index=True)

        execution_results = optimized_results if optimized_results else selected
        execution_properties = build_execution_properties(execution_results)
        st.session_state["route_execution"] = ensure_execution_state(
            st.session_state.get("route_execution", {}),
            execution_properties,
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
                f"{PRIORITY[primary_property['priority_score']]['label']}"
            )
            with st.expander(stop_title, expanded=(stop_number == 1)):
                summary_cols = st.columns(4)
                summary_cols[0].metric("Property", primary_property["address"])
                summary_cols[1].metric("Doors", primary_property["doors_to_knock"])
                summary_cols[2].metric("Solar", primary_property["category"])
                summary_cols[3].metric("Sun Hours", primary_property["sun_hours_display"])

                if primary_property.get("street_view_link"):
                    st.markdown(
                        f"[Street View]({primary_property['street_view_link']}) · "
                        f"[Directions](https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(primary_property['parking_address'])})"
                    )

                for property_record in stop_properties:
                    property_id = property_record["property_id"]
                    entry = st.session_state["route_execution"][property_id]
                    property_header = (
                        f"{property_record['property_type']} · {property_record['address']}"
                    )
                    st.markdown(f"**{property_header}**")

                    info_cols = st.columns(4)
                    info_cols[0].caption(f"Priority: {property_record.get('priority_label') or PRIORITY[property_record['priority_score']]['label']}")
                    info_cols[1].caption(f"Solar: {property_record.get('category', 'Unknown')}")
                    info_cols[2].caption(f"Sun: {property_record.get('sun_hours_display', 'N/A')}")
                    info_cols[3].caption(f"Zip: {property_record.get('zipcode', 'Unknown')}")

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
                    st.markdown("---")
