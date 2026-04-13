import streamlit as st
import pandas as pd
import requests
import googlemaps
import time
import urllib.parse
import re
import json
import os
from datetime import datetime
from pathlib import Path
from collections import defaultdict

# ─── API Key & Credentials ────────────────────────────────────────────────────
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
SPREADSHEET_ID = "1qpx34ySHm5XPYpkNQxVx33KWS_971K2X1aBwmKerGGs"

raw_service_account  = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
service_account_info = None

if raw_service_account:
    try:
        service_account_info = json.loads(raw_service_account)
    except json.JSONDecodeError as e:
        st.error(f"GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: {e}")
        st.stop()

if not GOOGLE_API_KEY:
    st.error("Missing GOOGLE_API_KEY in Railway variables.")
    st.stop()

# ─── Priority config ──────────────────────────────────────────────────────────
PRIORITY = {
    4: {"label": "PREMIUM",  "color": "#C9A84C", "bg": "#2A1F00", "text": "#F0C060", "border": "#C9A84C", "dot": "#C9A84C"},
    3: {"label": "HIGHEST",  "color": "#2E7D32", "bg": "#0A2010", "text": "#66BB6A", "border": "#2E7D32", "dot": "#43A047"},
    2: {"label": "HIGH",     "color": "#558B2F", "bg": "#0D1A08", "text": "#9CCC65", "border": "#558B2F", "dot": "#7CB342"},
    1: {"label": "MEDIUM",   "color": "#E65100", "bg": "#1A0E00", "text": "#FFA726", "border": "#F57C00", "dot": "#FF7043"},
    0: {"label": "LOW",      "color": "#424242", "bg": "#111111", "text": "#757575", "border": "#424242", "dot": "#616161"},
}

# ─── Sheet column layout ──────────────────────────────────────────────────────
# A=Address B=Priority C=Sale Price D=Sq Ft E=Beds F=Baths G=Sun Hours
# H=Solar Category I=Sold Date J=Doors in Cluster K=Zip L=Latitude M=Longitude
# N=Source O=First Analyzed P=Last Updated Q=Knocked R=Lead Status S=Notes
HEADERS = [
    "Address","Priority","Sale Price","Sq Ft","Beds","Baths",
    "Sun Hours","Solar Category","Sold Date","Doors in Cluster",
    "Zip","Latitude","Longitude","Source",
    "First Analyzed","Last Updated","Knocked","Lead Status","Notes"
]
COL_LAT            = 11   # L
COL_LNG            = 12   # M
COL_FIRST_ANALYZED = 14   # O
COL_LAST_UPDATED   = 15   # P
COL_KNOCKED        = 16   # Q
COL_LEAD_STATUS    = 17   # R
COL_NOTES          = 18   # S

# ─── Google Sheets helpers ────────────────────────────────────────────────────
def get_sheets_service():
    try:
        if not service_account_info:
            st.warning("Missing GOOGLE_SERVICE_ACCOUNT_JSON.")
            return None
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        creds = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )
        return build("sheets", "v4", credentials=creds)
    except Exception as e:
        st.warning(f"Could not connect to Google Sheets: {e}")
        return None


def round_coord(val, places=5):
    try:
        return round(float(val), places)
    except:
        return None


def ensure_sheet_tab(service, tab_name):
    try:
        meta     = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
        existing = [s['properties']['title'] for s in meta['sheets']]
        if tab_name not in existing:
            service.spreadsheets().batchUpdate(
                spreadsheetId=SPREADSHEET_ID,
                body={"requests": [{"addSheet": {"properties": {"title": tab_name}}}]}
            ).execute()
            service.spreadsheets().values().update(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{tab_name}'!A1",
                valueInputOption="RAW",
                body={"values": [HEADERS]}
            ).execute()
    except Exception as e:
        st.warning(f"Could not create tab {tab_name}: {e}")


def get_existing_rows(service, tab_name):
    """Returns dict keyed by (rounded_lat, rounded_lng) with row info."""
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{tab_name}'!A1:S"
        ).execute()
        rows     = result.get('values', [])
        existing = {}
        for i, row in enumerate(rows[1:], start=2):
            try:
                lat = round_coord(row[COL_LAT])
                lng = round_coord(row[COL_LNG])
                if lat and lng:
                    existing[(lat, lng)] = {
                        'row_index':      i,
                        'knocked':        row[COL_KNOCKED]     if len(row) > COL_KNOCKED     else 'No',
                        'lead_status':    row[COL_LEAD_STATUS] if len(row) > COL_LEAD_STATUS else '',
                        'notes':          row[COL_NOTES]       if len(row) > COL_NOTES       else '',
                        'first_analyzed': row[COL_FIRST_ANALYZED] if len(row) > COL_FIRST_ANALYZED else ''
                    }
            except:
                continue
        return existing
    except:
        return {}


def build_row(r, source, first_analyzed, last_updated, knocked='No', lead_status='', notes=''):
    return [
        r['address'],
        PRIORITY[r['priority_score']]['label'],
        r['price_display'],
        r['sqft_display'],
        str(r.get('beds', '')),
        str(r.get('baths', '')),
        r['sun_hours_display'],
        r['category'],
        r['sold_date'],
        r['doors_to_knock'],
        r['zipcode'],
        r['lat'] or '',
        r['lng'] or '',
        source,           # "Original List" or "Cluster Neighbor"
        first_analyzed,
        last_updated,
        knocked,          # preserved
        lead_status,      # preserved
        notes             # preserved
    ]


def sync_results_to_sheet(service, all_results):
    """
    Writes both original list addresses AND cluster neighbors to the sheet.
    - Detects duplicates by lat/lng
    - Updates analysis fields for existing rows, preserves Knocked/Lead Status/Notes
    - Flags source as 'Original List' or 'Cluster Neighbor'
    Returns (inserted, updated) counts.
    """
    # Flatten: original results + their neighbors as separate records
    flat = []
    for r in all_results:
        flat.append({**r, 'source': 'Original List'})
        for n in r.get('neighbor_records', []):
            flat.append({**n, 'source': 'Cluster Neighbor'})

    by_zip = defaultdict(list)
    for r in flat:
        by_zip[r['zipcode']].append(r)

    total_inserted = 0
    total_updated  = 0
    today          = datetime.now().strftime("%Y-%m-%d")

    for zipcode, results in by_zip.items():
        tab_name = f"Zip {zipcode}"
        ensure_sheet_tab(service, tab_name)
        existing = get_existing_rows(service, tab_name)

        to_append = []
        to_update = []

        for r in results:
            if not r.get('lat') or not r.get('lng'):
                to_append.append(build_row(r, r.get('source',''), today, today))
                continue
            key = (round_coord(r['lat']), round_coord(r['lng']))
            if key in existing:
                prev = existing[key]
                to_update.append((prev['row_index'], build_row(
                    r, r.get('source', ''),
                    first_analyzed=prev['first_analyzed'] or today,
                    last_updated=today,
                    knocked=prev['knocked'],
                    lead_status=prev['lead_status'],
                    notes=prev['notes']
                )))
            else:
                to_append.append(build_row(r, r.get('source',''), today, today))

        if to_append:
            try:
                service.spreadsheets().values().append(
                    spreadsheetId=SPREADSHEET_ID,
                    range=f"'{tab_name}'!A1",
                    valueInputOption="RAW",
                    insertDataOption="INSERT_ROWS",
                    body={"values": to_append}
                ).execute()
                total_inserted += len(to_append)
            except Exception as e:
                st.warning(f"Could not append to {tab_name}: {e}")

        for row_index, row_vals in to_update:
            try:
                service.spreadsheets().values().update(
                    spreadsheetId=SPREADSHEET_ID,
                    range=f"'{tab_name}'!A{row_index}",
                    valueInputOption="RAW",
                    body={"values": [row_vals]}
                ).execute()
                total_updated += 1
            except Exception as e:
                st.warning(f"Could not update row {row_index} in {tab_name}: {e}")

    return total_inserted, total_updated


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

/* Metric cards */
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

/* Buttons — gold with dark text */
.stButton > button, .stDownloadButton > button {
    background: linear-gradient(135deg, #D4AF50, #A07830) !important;
    color: #0A0810 !important;
    border: none !important;
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

/* File uploader */
[data-testid="stFileUploader"] {
    background: linear-gradient(145deg, #0D1220, #0A0E18);
    border: 1px dashed #2A3A55;
    border-radius: 12px;
    padding: 1rem;
}

/* Dataframe */
[data-testid="stDataFrame"] { border-radius: 10px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }

/* Progress */
[data-testid="stProgressBar"] > div > div {
    background: linear-gradient(90deg, #C9A84C, #E8C860) !important;
    box-shadow: 0 0 8px rgba(201,168,76,0.5);
}

/* Alerts */
[data-testid="stAlert"] { border-radius: 8px; }

/* Expander */
details {
    background: linear-gradient(145deg, #0D1220, #0A0E18) !important;
    border: 1px solid #1A2540 !important;
    border-radius: 10px !important;
    box-shadow: 2px 2px 8px rgba(0,0,0,0.3) !important;
}
details summary { color: #8A95AA !important; }

/* Checkboxes */
[data-testid="stCheckbox"] label { color: #C0CAD8 !important; font-size: 13px !important; }

/* Divider */
hr { border-color: #1A2540 !important; }

/* Priority dots for checkboxes */
.dot-4 { display:inline-block; width:10px; height:10px; border-radius:50%; background:#C9A84C; margin-right:8px; box-shadow:0 0 6px rgba(201,168,76,0.6); vertical-align:middle; }
.dot-3 { display:inline-block; width:10px; height:10px; border-radius:50%; background:#43A047; margin-right:8px; box-shadow:0 0 6px rgba(67,160,71,0.6);  vertical-align:middle; }
.dot-2 { display:inline-block; width:10px; height:10px; border-radius:50%; background:#7CB342; margin-right:8px; box-shadow:0 0 6px rgba(124,179,66,0.5);  vertical-align:middle; }
.dot-1 { display:inline-block; width:10px; height:10px; border-radius:50%; background:#FF7043; margin-right:8px; box-shadow:0 0 6px rgba(255,112,67,0.5);  vertical-align:middle; }
.dot-0 { display:inline-block; width:10px; height:10px; border-radius:50%; background:#616161; margin-right:8px; vertical-align:middle; }

/* Section headers */
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

/* Zip group header */
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

# ─── Sidebar ──────────────────────────────────────────────────────────────────
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

# ─── Header ───────────────────────────────────────────────────────────────────
st.markdown("""
<div style="padding:2rem 0 1.5rem;">
    <div style="display:flex;align-items:baseline;gap:14px;">
        <span style="font-size:2.4rem;font-weight:900;color:#C9A84C;letter-spacing:-1px;
                     text-shadow:0 0 30px rgba(201,168,76,0.4);">SolarIQ</span>
        <span style="font-size:.85rem;color:#3A4A60;font-weight:400;letter-spacing:3px;text-transform:uppercase;">
            Intelligent Solar Prospecting
        </span>
    </div>
    <div style="height:2px;background:linear-gradient(90deg,#C9A84C,rgba(201,168,76,0.2),transparent);
                margin-top:10px;border-radius:2px;width:320px;
                box-shadow:0 0 8px rgba(201,168,76,0.3);"></div>
</div>
""", unsafe_allow_html=True)

# ─── Core functions ───────────────────────────────────────────────────────────

def get_coordinates(address, gmaps_client):
    try:
        result = gmaps_client.geocode(address)
        if not result: return None, None
        loc = result[0]['geometry']['location']
        return loc['lat'], loc['lng']
    except:
        return None, None


def get_solar_hours(lat, lng, key):
    if not lat or not lng: return None
    params = {'location.latitude': lat, 'location.longitude': lng, 'key': key}
    try:
        r = requests.get("https://solar.googleapis.com/v1/buildingInsights:findClosest", params=params, timeout=10)
        if r.status_code == 200:
            return r.json().get('solarPotential', {}).get('maxSunshineHoursPerYear', None)
    except:
        pass
    return None


def get_walking_neighbors(lat, lng, key, walk_seconds=150):
    """
    Find nearby addresses then filter to those within walk_seconds walking time
    using the Routes API. Default 150s = 2.5 min walk.
    """
    # Step 1: Get candidate addresses within a rough bounding circle
    url = "https://places.googleapis.com/v1/places:searchNearby"
    headers = {"Content-Type": "application/json", "X-Goog-Api-Key": key,
               "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.types,places.location"}
    body = {"maxResultCount": 20,
            "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 250}}}
    candidates = []
    try:
        r = requests.post(url, headers=headers, json=body, timeout=10)
        if r.status_code == 200:
            for place in r.json().get('places', []):
                addr  = place.get('formattedAddress', '')
                types = place.get('types', [])
                loc   = place.get('location', {})
                is_res  = any(t in ['residential', 'neighborhood', 'premise'] for t in types)
                has_num = any(c.isdigit() for c in addr) if addr else False
                if addr and (is_res or has_num) and loc:
                    candidates.append({'address': addr, 'lat': loc.get('latitude'), 'lng': loc.get('longitude')})
    except:
        pass

    if not candidates:
        return []

    # Step 2: Batch walking distance check via Routes API
    walkable = []
    routes_url = "https://routes.googleapis.com/directions/v2:computeRoutes"
    routes_headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration"
    }

    for c in candidates:
        if not c['lat'] or not c['lng']:
            continue
        body = {
            "origin":      {"location": {"latLng": {"latitude": lat,       "longitude": lng}}},
            "destination": {"location": {"latLng": {"latitude": c['lat'],  "longitude": c['lng']}}},
            "travelMode":  "WALK"
        }
        try:
            resp = requests.post(routes_url, headers=routes_headers, json=body, timeout=8)
            if resp.status_code == 200:
                routes = resp.json().get('routes', [])
                if routes:
                    duration_str = routes[0].get('duration', '999s')
                    duration_sec = int(duration_str.replace('s', ''))
                    if duration_sec <= walk_seconds:
                        walkable.append(c['address'])
        except:
            pass
        time.sleep(0.1)

    return walkable


def get_street_view_link(lat, lng, address):
    if lat and lng:
        return f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lng}"
    return f"https://www.google.com/maps/@?api=1&map_action=pano&query={urllib.parse.quote(address)}"


def get_parking_ease(address):
    a = address.lower()
    if any(w in a for w in ['drive', 'court', 'circle', 'lane', 'way']): return 'Good — suburban street'
    elif any(w in a for w in ['avenue', 'boulevard']):                    return 'Fair — may have street parking'
    elif 'street' in a:                                                    return 'Check first — could be tight'
    return 'Scout first'


def classify_sun_hours(hours):
    if not hours:      return "Unknown",  0
    if hours >= 1400:  return "Ideal",    3
    if hours >= 1200:  return "Good",     2
    if hours >= 1000:  return "Marginal", 1
    return "Poor", 0


def score_home_value(price):
    if not price or price <= 0: return 0, "Unknown",        "Unknown"
    if price >= 1500000:        return 3, f"${price:,.0f}", "Ultra High"
    if price >= 1000000:        return 3, f"${price:,.0f}", "High Value"
    if price >= 750000:         return 2, f"${price:,.0f}", "Upper Mid"
    if price >= 500000:         return 2, f"${price:,.0f}", "Mid Value"
    if price >= 300000:         return 1, f"${price:,.0f}", "Standard"
    return 0, f"${price:,.0f}", "Lower Value"


def score_sqft(sqft):
    if not sqft or sqft <= 0: return 0, "Unknown"
    if sqft >= 3000:           return 3, f"{sqft:,.0f} sq ft"
    if sqft >= 2500:           return 2, f"{sqft:,.0f} sq ft"
    if sqft >= 2000:           return 2, f"{sqft:,.0f} sq ft"
    if sqft >= 1500:           return 1, f"{sqft:,.0f} sq ft"
    return 0, f"{sqft:,.0f} sq ft"


def combined_priority(sun_score, value_score, sqft_score, doors_to_knock):
    if sun_score == 0: return 0, "LOW — Poor solar potential"
    total = sun_score + value_score + sqft_score
    if doors_to_knock >= 3: total += 1
    if total >= 8:  return 4, "PREMIUM — High value + great solar"
    if total >= 6:  return 3, "HIGHEST — Park and knock multiple"
    if total >= 4:  return 2, "HIGH — Worth stopping"
    if total >= 2:  return 1, "MEDIUM — Quick stop"
    return 0, "LOW — Skip"


def extract_zip(address):
    m = re.search(r'\b(\d{5})\b', str(address))
    return m.group(1) if m else 'Unknown'


def parse_sale_price(price_thousands, price_remainder):
    try:
        thousands     = float(str(price_thousands).replace(',','').strip()) if pd.notna(price_thousands) else 0
        remainder     = str(price_remainder).replace(',','').strip() if pd.notna(price_remainder) else '0'
        remainder_val = float(remainder) if remainder not in ['','nan','0'] else 0
        full_price    = (thousands * 1000) + remainder_val
        return full_price if full_price > 0 else None
    except:
        return None


def format_date(date_val):
    if pd.isna(date_val) or not date_val: return "Unknown"
    try:
        return pd.to_datetime(date_val).strftime("%b %Y")
    except:
        return str(date_val)


def make_neighbor_record(address, lat, lng, sun_hours, category, sun_score, parent_zip):
    """Build a minimal result dict for a cluster neighbor to save to Sheets."""
    return {
        'address':          address,
        'lat':              lat,
        'lng':              lng,
        'zipcode':          extract_zip(address) or parent_zip,
        'sun_hours':        sun_hours,
        'sun_hours_display': f"{sun_hours:.0f}" if sun_hours else "N/A",
        'category':         category,
        'priority_score':   sun_score if sun_score > 0 else 0,
        'price_display':    'N/A',
        'sqft_display':     'N/A',
        'beds':             '',
        'baths':            '',
        'sold_date':        'N/A',
        'doors_to_knock':   0,
        'source':           'Cluster Neighbor',
    }


def process_address(row_data, gmaps_client, key):
    address    = str(row_data.get('address', ''))
    sale_price = parse_sale_price(row_data.get('price'), row_data.get('price_remainder'))
    sqft       = row_data.get('sqft')
    sold_date  = format_date(row_data.get('sold_date'))
    beds       = row_data.get('beds')
    baths      = row_data.get('baths')

    try:
        sqft_val = float(str(sqft).replace(',','')) if pd.notna(sqft) else None
    except:
        sqft_val = None

    zipcode    = extract_zip(address)
    lat, lng   = get_coordinates(address, gmaps_client)
    value_score, price_display, value_badge = score_home_value(sale_price)
    sqft_score, sqft_display                = score_sqft(sqft_val)

    if not lat:
        return {
            'address': address, 'lat': None, 'lng': None, 'zipcode': zipcode,
            'sun_hours': None, 'sun_hours_display': 'N/A', 'category': 'Unknown',
            'street_view_link': get_street_view_link(None, None, address),
            'parking_ease': get_parking_ease(address),
            'walkable_count': 0, 'ideal_count': 0, 'good_count': 0,
            'priority_score': 0, 'priority_label': 'LOW — Could not geocode',
            'parking_address': address, 'doors_to_knock': 0,
            'knock_addresses': [], 'neighbor_records': [],
            'sale_price': sale_price, 'price_display': price_display, 'value_badge': value_badge,
            'sqft': sqft_val, 'sqft_display': sqft_display, 'sold_date': sold_date,
            'beds': beds, 'baths': baths, 'value_score': value_score, 'sqft_score': sqft_score
        }

    sun_hours           = get_solar_hours(lat, lng, key)
    category, sun_score = classify_sun_hours(sun_hours)
    sun_hours_display   = f"{sun_hours:.0f}" if sun_hours else "N/A"

    # Walking distance neighbors
    walkable_addresses = get_walking_neighbors(lat, lng, key, walk_seconds=150)

    neighbor_data    = []
    neighbor_records = []  # for Sheets
    for neighbor in walkable_addresses:
        n_lat, n_lng = get_coordinates(neighbor, gmaps_client)
        if n_lat:
            n_sun = get_solar_hours(n_lat, n_lng, key)
            if n_sun:
                n_cat, n_score = classify_sun_hours(n_sun)
                neighbor_data.append({'address': neighbor, 'sun_hours': n_sun,
                                       'category': n_cat, 'score': n_score,
                                       'lat': n_lat, 'lng': n_lng})
                neighbor_records.append(
                    make_neighbor_record(neighbor, n_lat, n_lng, n_sun, n_cat, n_score, zipcode)
                )
        time.sleep(0.1)

    cluster     = [{'address': address, 'sun_hours': sun_hours, 'score': sun_score,
                    'category': category, 'lat': lat, 'lng': lng}] + neighbor_data
    ideal_count = sum(1 for h in cluster if h.get('score',0) >= 3)
    good_count  = sum(1 for h in cluster if h.get('score',0) >= 2)
    knock_doors = [h['address'] for h in cluster if h.get('score',0) >= 2]

    priority_score, priority_label = combined_priority(sun_score, value_score, sqft_score, len(knock_doors))

    best_home, best_score = address, sun_score
    for h in cluster:
        if h.get('score',0) > best_score:
            best_score = h['score']
            best_home  = h['address']

    return {
        'address': address, 'lat': lat, 'lng': lng, 'zipcode': zipcode,
        'sun_hours': sun_hours, 'sun_hours_display': sun_hours_display,
        'category': category, 'street_view_link': get_street_view_link(lat, lng, address),
        'parking_ease': get_parking_ease(address),
        'walkable_count': len(neighbor_data),
        'ideal_count': ideal_count, 'good_count': good_count - ideal_count,
        'priority_score': priority_score, 'priority_label': priority_label,
        'parking_address': best_home,
        'doors_to_knock': len(knock_doors), 'knock_addresses': knock_doors,
        'neighbor_records': neighbor_records,
        'sale_price': sale_price, 'price_display': price_display, 'value_badge': value_badge,
        'sqft': sqft_val, 'sqft_display': sqft_display, 'sold_date': sold_date,
        'beds': beds, 'baths': baths, 'value_score': value_score, 'sqft_score': sqft_score
    }


# ─── Zip summary ──────────────────────────────────────────────────────────────

def build_zip_summary(all_results):
    zips = defaultdict(lambda: {'count':0,'high':0,'sun_hours':[],'doors':0,'prices':[]})
    for r in all_results:
        z = r['zipcode']
        zips[z]['count'] += 1
        if r['priority_score'] >= 2: zips[z]['high'] += 1
        if r['sun_hours']:           zips[z]['sun_hours'].append(r['sun_hours'])
        if r['sale_price']:          zips[z]['prices'].append(r['sale_price'])
        zips[z]['doors'] += r['doors_to_knock']

    summary = []
    for z, d in zips.items():
        avg_sun   = sum(d['sun_hours']) / len(d['sun_hours']) if d['sun_hours'] else 0
        avg_price = sum(d['prices'])    / len(d['prices'])    if d['prices']    else 0
        zip_score = (d['high'] * 2) + (avg_sun / 500) + (d['doors'] * 0.5) + (avg_price / 250000)
        summary.append({
            'zipcode': z, 'total': d['count'], 'high_priority': d['high'],
            'avg_sun_hours': round(avg_sun), 'total_doors': d['doors'],
            'avg_home_value': f"${avg_price:,.0f}" if avg_price else 'N/A',
            'zip_score': round(zip_score, 1)
        })
    return sorted(summary, key=lambda x: x['zip_score'], reverse=True)


# ─── HTML report ──────────────────────────────────────────────────────────────

def priority_badge_html(score):
    p = PRIORITY[score]
    return (f'<span style="background:{p["bg"]};color:{p["text"]};border:1px solid {p["border"]};'
            f'padding:4px 14px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:1.5px;'
            f'text-transform:uppercase;box-shadow:0 2px 6px rgba(0,0,0,0.4);">{p["label"]}</span>')


def generate_html_report(all_results):
    zip_summary = build_zip_summary(all_results)
    zip_rank    = {z['zipcode']: i for i, z in enumerate(zip_summary)}
    results     = sorted(all_results,
                         key=lambda x: (zip_rank.get(x['zipcode'],99), -x['priority_score'], -x['doors_to_knock']))
    total        = len(results)
    high_count   = sum(1 for r in results if r['priority_score'] >= 2)
    medium_count = sum(1 for r in results if r['priority_score'] == 1)
    total_knocks = sum(r['doors_to_knock'] for r in results)

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>SolarIQ Report</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box;}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#060A14;color:#C0CAD8;padding:28px;}}
.container{{max-width:1040px;margin:0 auto;}}

/* Header */
.header{{padding:36px 0 28px;border-bottom:1px solid #141E30;margin-bottom:36px;}}
.header-logo{{font-size:2.2rem;font-weight:900;color:#C9A84C;letter-spacing:-1px;
              text-shadow:0 0 40px rgba(201,168,76,0.5);}}
.header-tagline{{font-size:11px;color:#2A3A50;letter-spacing:4px;text-transform:uppercase;margin-top:5px;}}
.gold-line{{height:2px;background:linear-gradient(90deg,#C9A84C,rgba(201,168,76,0.3),transparent);
            margin-top:10px;border-radius:2px;width:260px;box-shadow:0 0 10px rgba(201,168,76,0.3);}}
.header-meta{{font-size:12px;color:#2A3A50;margin-top:14px;}}

/* Stats */
.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:36px;}}
.stat-card{{background:linear-gradient(145deg,#0D1220,#080C18);border:1px solid #141E30;
            border-radius:12px;padding:22px;text-align:center;
            box-shadow:5px 5px 15px rgba(0,0,0,0.6),-1px -1px 5px rgba(255,255,255,0.02);}}
.stat-number{{font-size:2.2rem;font-weight:900;color:#C9A84C;
              text-shadow:0 0 20px rgba(201,168,76,0.35);}}
.stat-label{{font-size:10px;color:#2A3A50;text-transform:uppercase;letter-spacing:1.5px;margin-top:8px;}}

/* Section headers */
.section-header{{border-left:3px solid #C9A84C;padding:10px 18px;margin:32px 0 18px;
                 background:linear-gradient(90deg,#0C1528,transparent);
                 font-size:10px;font-weight:700;color:#C9A84C;
                 letter-spacing:2.5px;text-transform:uppercase;border-radius:0 6px 6px 0;
                 box-shadow:inset 0 0 20px rgba(0,0,0,0.2);}}

/* Zip table */
.zip-table{{width:100%;border-collapse:collapse;margin-bottom:36px;
            border-radius:10px;overflow:hidden;border:1px solid #141E30;
            box-shadow:4px 4px 16px rgba(0,0,0,0.5);}}
.zip-table th{{background:#0A0E18;color:#4A5A70;padding:11px 16px;text-align:left;
               font-size:10px;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid #141E30;}}
.zip-table td{{padding:12px 16px;border-bottom:1px solid #0D1220;font-size:13px;color:#C0CAD8;}}
.zip-table tr:last-child td{{border-bottom:none;}}
.zip-table tr:hover td{{background:#0A0E18;}}
.score-cell{{color:#C9A84C;font-weight:800;text-shadow:0 0 10px rgba(201,168,76,0.3);}}

/* Cards */
.card{{background:linear-gradient(145deg,#0D1220,#090D19);border:1px solid #141E30;
       border-radius:12px;margin-bottom:18px;padding:22px;
       box-shadow:5px 5px 18px rgba(0,0,0,0.6),-1px -1px 4px rgba(255,255,255,0.02);}}
.card-priority-4{{border-left:4px solid #C9A84C;box-shadow:5px 5px 18px rgba(0,0,0,0.6),-4px 0 12px rgba(201,168,76,0.15);}}
.card-priority-3{{border-left:4px solid #2E7D32;box-shadow:5px 5px 18px rgba(0,0,0,0.6),-4px 0 12px rgba(46,125,50,0.15);}}
.card-priority-2{{border-left:4px solid #558B2F;box-shadow:5px 5px 18px rgba(0,0,0,0.6),-4px 0 10px rgba(85,139,47,0.12);}}
.card-priority-1{{border-left:4px solid #E65100;box-shadow:5px 5px 18px rgba(0,0,0,0.6),-4px 0 10px rgba(230,81,0,0.1);}}
.card-priority-0{{border-left:4px solid #2A2A2A;opacity:0.55;}}

.card-header{{display:flex;align-items:center;gap:14px;margin-bottom:16px;}}
.card-address{{font-size:15px;font-weight:700;color:#E0E8F4;}}

/* Home strip */
.home-strip{{background:#060A14;border:1px solid #0D1420;border-radius:8px;
             padding:13px 18px;margin:14px 0;display:flex;gap:28px;flex-wrap:wrap;
             box-shadow:inset 0 1px 4px rgba(0,0,0,0.4);}}
.home-detail-label{{font-size:10px;color:#2A3A50;text-transform:uppercase;letter-spacing:1px;}}
.home-detail-value{{font-size:13px;font-weight:700;color:#C0CAD8;margin-top:4px;}}

/* Info rows */
.info-row{{display:flex;align-items:baseline;gap:10px;margin:7px 0;font-size:13px;}}
.info-label{{color:#2A3A50;min-width:110px;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;}}
.info-value{{color:#C0CAD8;}}

/* Tags */
.tag{{display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;
      font-weight:600;letter-spacing:0.5px;margin-left:8px;}}
.tag-solar-ideal   {{background:#061A0A;color:#66BB6A;border:1px solid #1B5E20;}}
.tag-solar-good    {{background:#061A0A;color:#81C784;border:1px solid #2E7D32;}}
.tag-solar-marginal{{background:#1A1000;color:#FFA726;border:1px solid #E65100;}}
.tag-solar-poor    {{background:#1A0606;color:#EF5350;border:1px solid #B71C1C;}}
.tag-value-high    {{background:#150E00;color:#C9A84C;border:1px solid #7A5C00;}}
.tag-value-mid     {{background:#060E1A;color:#64B5F6;border:1px solid #0D47A1;}}
.tag-size          {{background:#100618;color:#CE93D8;border:1px solid #4A148C;}}

/* Knock list */
.knock-list{{background:#060A14;border:1px solid #0D1420;border-radius:8px;
             padding:14px 18px;margin-top:12px;font-size:12px;
             box-shadow:inset 0 1px 4px rgba(0,0,0,0.4);}}
.knock-list-title{{color:#C9A84C;font-size:10px;text-transform:uppercase;
                   letter-spacing:1.5px;font-weight:700;margin-bottom:10px;}}
.knock-item{{color:#8A95AA;padding:4px 0;border-bottom:1px solid #0D1420;}}
.knock-item:last-child{{border-bottom:none;}}

/* Buttons */
.btn-group{{display:flex;gap:12px;margin-top:18px;flex-wrap:wrap;}}
.btn{{display:inline-block;padding:9px 20px;text-decoration:none;border-radius:6px;
      font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;
      box-shadow:0 2px 8px rgba(0,0,0,0.4);}}
.btn-sv {{background:transparent;color:#C9A84C;border:1px solid #7A5C00;}}
.btn-sv:hover {{background:#150E00;}}
.btn-dir{{background:transparent;color:#64B5F6;border:1px solid #0D47A1;}}
.btn-dir:hover {{background:#060E1A;}}

/* Footer */
.footer{{margin-top:48px;padding-top:24px;border-top:1px solid #141E30;
         text-align:center;color:#1A2A40;font-size:10px;letter-spacing:2px;
         text-transform:uppercase;padding-bottom:48px;}}
</style>
</head>
<body>
<div class="container">
<div class="header">
    <div class="header-logo">SolarIQ</div>
    <div class="header-tagline">Intelligent Solar Prospecting</div>
    <div class="gold-line"></div>
    <div class="header-meta">Report generated {datetime.now().strftime("%B %d, %Y at %I:%M %p")}</div>
</div>
<div class="stats">
    <div class="stat-card"><div class="stat-number">{total}</div><div class="stat-label">Properties Analyzed</div></div>
    <div class="stat-card"><div class="stat-number">{high_count}</div><div class="stat-label">High Priority</div></div>
    <div class="stat-card"><div class="stat-number">{medium_count}</div><div class="stat-label">Medium Priority</div></div>
    <div class="stat-card"><div class="stat-number">{total_knocks}</div><div class="stat-label">Doors to Knock</div></div>
</div>
<div class="section-header">Area Intelligence — Zip Code Ranking</div>
<table class="zip-table">
<tr><th>Zip</th><th>Properties</th><th>High Priority</th><th>Avg Sun Hrs</th><th>Avg Home Value</th><th>Total Doors</th><th>Area Score</th></tr>
'''
    for z in zip_summary:
        html += f'<tr><td><strong>{z["zipcode"]}</strong></td><td>{z["total"]}</td><td>{z["high_priority"]}</td><td>{z["avg_sun_hours"]}</td><td>{z["avg_home_value"]}</td><td>{z["total_doors"]}</td><td class="score-cell">{z["zip_score"]}</td></tr>\n'
    html += '</table>\n'

    current_zip = None
    for r in results:
        if r['zipcode'] != current_zip:
            current_zip = r['zipcode']
            z_data = next((z for z in zip_summary if z['zipcode'] == current_zip), {})
            html += f'<div class="section-header">Zip {current_zip} &nbsp;·&nbsp; Score {z_data.get("zip_score","?")} &nbsp;·&nbsp; {z_data.get("high_priority","?")} High Priority &nbsp;·&nbsp; Avg {z_data.get("avg_home_value","N/A")}</div>\n'

        ps              = r['priority_score']
        sun_text        = f"{r['sun_hours_display']} hrs" if r['sun_hours'] else "N/A"
        park_sh         = (r['parking_address'][:70]+"...") if len(r['parking_address'])>70 else r['parking_address']
        solar_tag_class = {'Ideal':'tag-solar-ideal','Good':'tag-solar-good','Marginal':'tag-solar-marginal'}.get(r['category'],'tag-solar-poor')
        value_tag_class = 'tag-value-high' if r.get('value_score',0) >= 2 else 'tag-value-mid'
        size_label      = 'Large' if (r['sqft'] or 0)>=3000 else 'Mid-Size' if (r['sqft'] or 0)>=2000 else 'Compact'

        html += f'''<div class="card card-priority-{ps}">
<div class="card-header">{priority_badge_html(ps)}<span class="card-address">{r['address']}</span></div>
<div class="home-strip">
    <div><div class="home-detail-label">Sale Price</div><div class="home-detail-value">{r['price_display']}</div></div>
    <div><div class="home-detail-label">Size</div><div class="home-detail-value">{r['sqft_display']}</div></div>
    <div><div class="home-detail-label">Beds / Baths</div><div class="home-detail-value">{r.get("beds","?")} bd / {r.get("baths","?")} ba</div></div>
    <div><div class="home-detail-label">Sold</div><div class="home-detail-value">{r['sold_date']}</div></div>
</div>
<div class="info-row"><span class="info-label">Solar</span><span class="info-value">{sun_text}<span class="tag {solar_tag_class}">{r['category']}</span></span></div>
<div class="info-row"><span class="info-label">Home Value</span><span class="info-value">{r['price_display']}<span class="tag {value_tag_class}">{r['value_badge']}</span></span></div>
<div class="info-row"><span class="info-label">Size</span><span class="info-value">{r['sqft_display']}<span class="tag tag-size">{size_label}</span></span></div>
<div class="info-row"><span class="info-label">Park At</span><span class="info-value">{park_sh}</span></div>
<div class="info-row"><span class="info-label">Knock</span><span class="info-value">{r['doors_to_knock']} doors ({r['ideal_count']} ideal, {r['good_count']} good)</span></div>
<div class="info-row"><span class="info-label">Parking</span><span class="info-value">{r['parking_ease']}</span></div>
'''
        if r['knock_addresses']:
            html += '<div class="knock-list"><div class="knock-list-title">Addresses to Knock</div>'
            for addr in r['knock_addresses']:
                html += f'<div class="knock-item">{addr}</div>'
            html += '</div>'

        html += f'''<div class="btn-group">
    <a href="{r['street_view_link']}" target="_blank" class="btn btn-sv">Street View</a>
    <a href="https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(r['parking_address'])}" target="_blank" class="btn btn-dir">Get Directions</a>
</div></div>
'''

    html += f'<div class="footer">SolarIQ &nbsp;·&nbsp; Intelligent Solar Prospecting &nbsp;·&nbsp; {datetime.now().strftime("%Y")}</div></div></body></html>'
    return html


# ─── Route CSV ────────────────────────────────────────────────────────────────

def build_route_csv(selected_results):
    rows = []
    for r in selected_results:
        addrs = r['knock_addresses'] if r['knock_addresses'] else [r['address']]
        for addr in addrs:
            rows.append({
                'address':          addr,
                'priority':         PRIORITY[r['priority_score']]['label'],
                'sale_price':       r['price_display'],
                'sqft':             r['sqft_display'],
                'sold_date':        r['sold_date'],
                'sun_hours':        r['sun_hours_display'],
                'solar_category':   r['category'],
                'doors_in_cluster': r['doors_to_knock'],
                'zipcode':          r['zipcode']
            })
    return pd.DataFrame(rows).to_csv(index=False)


# ─── Main UI ──────────────────────────────────────────────────────────────────

uploaded_file = st.file_uploader(
    "Upload your address list",
    type=["csv"],
    help="Columns: price (A), remainder (B), address (C), beds (D), baths (E), sqft (F), Sold Date (G)"
)

if uploaded_file:
    df   = pd.read_csv(uploaded_file, header=0)
    cols = df.columns.tolist()
    def safe_col(idx): return cols[idx] if idx < len(cols) else None

    col_price     = safe_col(0)
    col_remainder = safe_col(1)
    col_address   = safe_col(2)
    col_beds      = safe_col(3)
    col_baths     = safe_col(4)
    col_sqft      = safe_col(5)
    col_sold      = safe_col(6)

    if not col_address:
        st.error("Could not find address column. Make sure address is in column C.")
    else:
        raw_addresses = (
            df[col_address].dropna().astype(str).str.strip()
            .replace('', float('nan')).dropna()
        )
        valid_idx = raw_addresses.index
        st.success(f"**{len(valid_idx)} addresses** loaded and ready for analysis")

        with st.expander("Preview data"):
            st.dataframe(df.head(10), use_container_width=True)

        if st.button("Run Analysis", type="primary", use_container_width=True):
            gmaps_client = googlemaps.Client(key=api_key)
            all_results  = []
            progress_bar = st.progress(0)
            status_text  = st.empty()
            total        = len(valid_idx)

            for i, (idx, row) in enumerate(df.loc[valid_idx].iterrows()):
                addr = str(row[col_address]).strip()
                status_text.markdown(f"Analyzing **{i+1} of {total}** — {str(addr)[:60]}")
                row_data = {
                    'address':         addr,
                    'price':           row[col_price]     if col_price     else None,
                    'price_remainder': row[col_remainder] if col_remainder else None,
                    'beds':            row[col_beds]      if col_beds      else None,
                    'baths':           row[col_baths]     if col_baths     else None,
                    'sqft':            row[col_sqft]      if col_sqft      else None,
                    'sold_date':       row[col_sold]      if col_sold      else None,
                }
                result = process_address(row_data, gmaps_client, api_key)
                all_results.append(result)
                progress_bar.progress((i + 1) / total)
                time.sleep(0.2)

            status_text.markdown("Analysis complete — syncing to Google Sheets...")
            sheets_service = get_sheets_service()
            if sheets_service:
                inserted, updated = sync_results_to_sheet(sheets_service, all_results)
                neighbor_count = sum(len(r.get('neighbor_records',[])) for r in all_results)
                st.success(
                    f"Sheets updated — **{inserted}** new records added "
                    f"({inserted - neighbor_count} original + {neighbor_count} cluster neighbors) · "
                    f"**{updated}** existing records refreshed"
                )

            st.session_state['all_results'] = all_results

# ── Results ───────────────────────────────────────────────────────────────────
if 'all_results' in st.session_state:
    all_results = st.session_state['all_results']

    st.markdown("---")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Properties Analyzed", len(all_results))
    c2.metric("Premium + Highest",   sum(1 for r in all_results if r['priority_score'] >= 3))
    c3.metric("High + Medium",       sum(1 for r in all_results if r['priority_score'] in [1,2]))
    c4.metric("Total Doors",         sum(r['doors_to_knock'] for r in all_results))

    html_report = generate_html_report(all_results)
    st.download_button(
        label="Download Intelligence Report",
        data=html_report,
        file_name=f"solariq_report_{datetime.now().strftime('%Y%m%d_%H%M')}.html",
        mime="text/html", use_container_width=True, type="primary"
    )

    st.markdown('<div class="siq-section">Area Intelligence</div>', unsafe_allow_html=True)
    zip_summary = build_zip_summary(all_results)
    st.dataframe(pd.DataFrame(zip_summary).rename(columns={
        'zipcode':'Zip','total':'Properties','high_priority':'High Priority',
        'avg_sun_hours':'Avg Sun Hrs','avg_home_value':'Avg Home Value',
        'total_doors':'Total Doors','zip_score':'Area Score'
    }), use_container_width=True, hide_index=True)

    st.markdown('<div class="siq-section">Route Selection</div>', unsafe_allow_html=True)
    st.markdown("Select stops to include in your route export.")

    zip_rank = {z['zipcode']: i for i, z in enumerate(zip_summary)}
    sorted_results = sorted(
        all_results,
        key=lambda x: (zip_rank.get(x['zipcode'],99), -x['priority_score'], -x['doors_to_knock'])
    )

    selected    = []
    current_zip = None
    for r in sorted_results:
        if r['priority_score'] == 0: continue
        if r['zipcode'] != current_zip:
            current_zip = r['zipcode']
            z_data = next((z for z in zip_summary if z['zipcode'] == current_zip), {})
            st.markdown(
                f'<div class="siq-zip-header">Zip {current_zip} &nbsp;·&nbsp; '
                f'Score {z_data.get("zip_score","?")} &nbsp;·&nbsp; '
                f'Avg {z_data.get("avg_home_value","N/A")} &nbsp;·&nbsp; '
                f'{z_data.get("total_doors","?")} doors</div>',
                unsafe_allow_html=True
            )

        ps    = r['priority_score']
        dot   = f'<span class="dot-{ps}"></span>'
        label = (f"{PRIORITY[ps]['label']}  {r['address'][:50]}  —  "
                 f"{r['price_display']}  |  {r['sqft_display']}  |  "
                 f"{r['sun_hours_display']} sun hrs  |  {r['doors_to_knock']} doors")
        if st.checkbox(label, key=f"chk_{r['address']}"):
            selected.append(r)

    if selected:
        st.success(
            f"**{len(selected)} stops** selected — "
            f"**{sum(r['doors_to_knock'] for r in selected)} total doors**"
        )
        st.download_button(
            label="Export Route to CSV",
            data=build_route_csv(selected),
            file_name=f"solariq_route_{datetime.now().strftime('%Y%m%d_%H%M')}.csv",
            mime="text/csv", use_container_width=True, type="primary"
        )
