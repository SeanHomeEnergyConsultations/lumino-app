import streamlit as st
import pandas as pd
import requests
import googlemaps
import time
import urllib.parse
import re
import json
from datetime import datetime
from pathlib import Path

# ─── API Key & Credentials ────────────────────────────────────────────────────
GOOGLE_API_KEY = "AIzaSyBOcNdCelTyfKkFOHvE8aeFNmURnLEG6X4"
SPREADSHEET_ID = "1qpx34ySHm5XPYpkNQxVx33KWS_971K2X1aBwmKerGGs"
SERVICE_ACCOUNT_FILE = Path(__file__).parent / "do-it-right-solar-9371f414cff6.json"

# ─── Priority config ──────────────────────────────────────────────────────────
PRIORITY = {
    4: {"label": "PREMIUM",  "color": "#C9A84C", "bg": "#FBF5E6", "text": "#7A5C00", "border": "#C9A84C"},
    3: {"label": "HIGHEST",  "color": "#1B5E20", "bg": "#E8F5E9", "text": "#1B5E20", "border": "#2E7D32"},
    2: {"label": "HIGH",     "color": "#2E7D32", "bg": "#F1F8E9", "text": "#33691E", "border": "#558B2F"},
    1: {"label": "MEDIUM",   "color": "#E65100", "bg": "#FFF3E0", "text": "#BF360C", "border": "#F57C00"},
    0: {"label": "LOW",      "color": "#757575", "bg": "#F5F5F5", "text": "#616161", "border": "#9E9E9E"},
}

# ─── Google Sheets ────────────────────────────────────────────────────────────
def get_sheets_service():
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        creds = service_account.Credentials.from_service_account_file(
            str(SERVICE_ACCOUNT_FILE),
            scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )
        return build("sheets", "v4", credentials=creds)
    except Exception as e:
        st.warning(f"Could not connect to Google Sheets: {e}")
        return None


HEADERS = ["Address","Priority","Sale Price","Sq Ft","Beds","Baths",
           "Sun Hours","Solar Category","Sold Date","Doors in Cluster",
           "Zip","Latitude","Longitude","First Analyzed","Last Updated","Knocked","Notes"]

COL_LAT            = 11
COL_LNG            = 12
COL_FIRST_ANALYZED = 13
COL_LAST_UPDATED   = 14
COL_KNOCKED        = 15
COL_NOTES          = 16


def round_coord(val, places=5):
    try:
        return round(float(val), places)
    except:
        return None


def ensure_sheet_tab(service, tab_name):
    try:
        sheet_meta = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
        existing = [s['properties']['title'] for s in sheet_meta['sheets']]
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
        st.warning(f"Could not create sheet tab {tab_name}: {e}")


def get_existing_rows(service, tab_name):
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{tab_name}'!A1:Q"
        ).execute()
        rows = result.get('values', [])
        existing = {}
        for i, row in enumerate(rows[1:], start=2):
            try:
                lat = round_coord(row[COL_LAT])
                lng = round_coord(row[COL_LNG])
                if lat and lng:
                    existing[(lat, lng)] = {
                        'row_index':      i,
                        'knocked':        row[COL_KNOCKED] if len(row) > COL_KNOCKED else 'No',
                        'notes':          row[COL_NOTES]   if len(row) > COL_NOTES   else '',
                        'first_analyzed': row[COL_FIRST_ANALYZED] if len(row) > COL_FIRST_ANALYZED else ''
                    }
            except:
                continue
        return existing
    except:
        return {}


def build_row(r, first_analyzed, last_updated, knocked='No', notes=''):
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
        first_analyzed,
        last_updated,
        knocked,
        notes
    ]


def sync_results_to_sheet(service, all_results):
    from collections import defaultdict
    by_zip = defaultdict(list)
    for r in all_results:
        by_zip[r['zipcode']].append(r)

    total_inserted = 0
    total_updated  = 0
    today = datetime.now().strftime("%Y-%m-%d")

    for zipcode, results in by_zip.items():
        tab_name = f"Zip {zipcode}"
        ensure_sheet_tab(service, tab_name)
        existing = get_existing_rows(service, tab_name)

        to_append = []
        to_update = []

        for r in results:
            if not r['lat'] or not r['lng']:
                to_append.append(build_row(r, today, today))
                continue
            key = (round_coord(r['lat']), round_coord(r['lng']))
            if key in existing:
                prev = existing[key]
                to_update.append((prev['row_index'], build_row(
                    r,
                    first_analyzed=prev['first_analyzed'] or today,
                    last_updated=today,
                    knocked=prev['knocked'],
                    notes=prev['notes']
                )))
            else:
                to_append.append(build_row(r, today, today))

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


# ─── Page config & custom CSS ─────────────────────────────────────────────────
st.set_page_config(page_title="SolarIQ", page_icon="◈", layout="wide")

st.markdown("""
<style>
/* ── Global ── */
html, body, [class*="css"] {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
[data-testid="stAppViewContainer"] {
    background: #0A0E1A;
}
[data-testid="stHeader"] { background: #0A0E1A; }
[data-testid="stSidebar"] {
    background: #0D1220;
    border-right: 1px solid #1E2A40;
}
[data-testid="stSidebar"] * { color: #A0ABBE !important; }
[data-testid="stSidebar"] a { color: #C9A84C !important; }

/* ── Main content text ── */
.main .block-container { padding-top: 2rem; padding-bottom: 4rem; }
h1, h2, h3 { color: #F0F4FF !important; }
p, li, label { color: #A0ABBE !important; }

/* ── Metric cards ── */
[data-testid="metric-container"] {
    background: #0D1220;
    border: 1px solid #1E2A40;
    border-radius: 10px;
    padding: 1rem;
}
[data-testid="metric-container"] label { color: #6B7A99 !important; font-size: 12px !important; text-transform: uppercase; letter-spacing: 1px; }
[data-testid="metric-container"] [data-testid="stMetricValue"] { color: #C9A84C !important; font-size: 2rem !important; font-weight: 700 !important; }

/* ── Buttons ── */
.stButton > button, .stDownloadButton > button {
    background: linear-gradient(135deg, #C9A84C, #A07830) !important;
    color: #0A0E1A !important;
    border: none !important;
    border-radius: 6px !important;
    font-weight: 600 !important;
    letter-spacing: 0.5px !important;
}
.stButton > button:hover, .stDownloadButton > button:hover {
    background: linear-gradient(135deg, #E0C060, #C9A84C) !important;
}

/* ── File uploader ── */
[data-testid="stFileUploader"] {
    background: #0D1220;
    border: 1px dashed #2A3A55;
    border-radius: 10px;
    padding: 1rem;
}

/* ── Dataframe ── */
[data-testid="stDataFrame"] { border-radius: 8px; overflow: hidden; }

/* ── Progress bar ── */
[data-testid="stProgressBar"] > div > div { background: #C9A84C !important; }

/* ── Success/warning messages ── */
[data-testid="stAlert"] { border-radius: 8px; }

/* ── Expander ── */
details { background: #0D1220 !important; border: 1px solid #1E2A40 !important; border-radius: 8px !important; }
details summary { color: #A0ABBE !important; }

/* ── Checkboxes ── */
[data-testid="stCheckbox"] label { color: #C8D0E0 !important; font-size: 13px !important; }

/* ── Divider ── */
hr { border-color: #1E2A40 !important; }

/* ── Section headers ── */
.siq-section {
    background: linear-gradient(90deg, #0D1220, #111827);
    border-left: 3px solid #C9A84C;
    padding: 10px 16px;
    border-radius: 0 8px 8px 0;
    margin: 24px 0 12px;
    color: #C9A84C !important;
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 1px;
    text-transform: uppercase;
}

/* ── Zip group header in checkboxes ── */
.siq-zip-header {
    border-top: 1px solid #1E2A40;
    padding-top: 16px;
    margin-top: 8px;
    color: #6B7A99 !important;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
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
<div style="padding: 2rem 0 1rem;">
    <div style="display:flex; align-items:baseline; gap:12px;">
        <span style="font-size:2.2rem; font-weight:800; color:#C9A84C; letter-spacing:-1px;">SolarIQ</span>
        <span style="font-size:1rem; color:#4A5568; font-weight:400; letter-spacing:2px; text-transform:uppercase;">Intelligent Solar Prospecting</span>
    </div>
    <div style="height:2px; background:linear-gradient(90deg,#C9A84C,transparent); margin-top:8px; border-radius:2px;"></div>
</div>
""", unsafe_allow_html=True)

# ─── Helper functions ─────────────────────────────────────────────────────────

def get_coordinates(address, gmaps_client):
    try:
        result = gmaps_client.geocode(address)
        if not result:
            return None, None
        loc = result[0]['geometry']['location']
        return loc['lat'], loc['lng']
    except:
        return None, None


def get_solar_hours(lat, lng, key):
    if not lat or not lng:
        return None
    params = {'location.latitude': lat, 'location.longitude': lng, 'key': key}
    try:
        r = requests.get("https://solar.googleapis.com/v1/buildingInsights:findClosest", params=params, timeout=10)
        if r.status_code == 200:
            return r.json().get('solarPotential', {}).get('maxSunshineHoursPerYear', None)
    except:
        pass
    return None


def get_street_view_link(lat, lng, address):
    if lat and lng:
        return f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lng}"
    return f"https://www.google.com/maps/@?api=1&map_action=pano&query={urllib.parse.quote(address)}"


def get_parking_ease(address):
    a = address.lower()
    if any(w in a for w in ['drive', 'court', 'circle', 'lane', 'way']):
        return 'Good — suburban street'
    elif any(w in a for w in ['avenue', 'boulevard']):
        return 'Fair — may have street parking'
    elif 'street' in a:
        return 'Check first — could be tight'
    return 'Scout first'


def get_nearby_addresses(lat, lng, key, radius=200, max_results=15):
    url = "https://places.googleapis.com/v1/places:searchNearby"
    headers = {"Content-Type": "application/json", "X-Goog-Api-Key": key,
               "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.types"}
    body = {"maxResultCount": min(max_results + 5, 20),
            "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": radius}}}
    try:
        r = requests.post(url, headers=headers, json=body, timeout=10)
        if r.status_code == 200:
            neighbors = []
            for place in r.json().get('places', []):
                addr = place.get('formattedAddress', '')
                types = place.get('types', [])
                is_res = any(t in ['residential', 'neighborhood', 'premise'] for t in types)
                has_num = any(c.isdigit() for c in addr) if addr else False
                if addr and (is_res or has_num):
                    neighbors.append(addr)
            return neighbors
    except:
        pass
    return []


def classify_sun_hours(hours):
    if not hours:       return "Unknown",  0
    if hours >= 1400:   return "Ideal",     3
    if hours >= 1200:   return "Good",      2
    if hours >= 1000:   return "Marginal",  1
    return "Poor", 0


def score_home_value(price):
    if not price or price <= 0:  return 0, "Unknown",          "Unknown"
    if price >= 1500000:         return 3, f"${price:,.0f}",   "Ultra High"
    if price >= 1000000:         return 3, f"${price:,.0f}",   "High Value"
    if price >= 750000:          return 2, f"${price:,.0f}",   "Upper Mid"
    if price >= 500000:          return 2, f"${price:,.0f}",   "Mid Value"
    if price >= 300000:          return 1, f"${price:,.0f}",   "Standard"
    return 0, f"${price:,.0f}", "Lower Value"


def score_sqft(sqft):
    if not sqft or sqft <= 0:   return 0, "Unknown"
    if sqft >= 3000:             return 3, f"{sqft:,.0f} sq ft"
    if sqft >= 2500:             return 2, f"{sqft:,.0f} sq ft"
    if sqft >= 2000:             return 2, f"{sqft:,.0f} sq ft"
    if sqft >= 1500:             return 1, f"{sqft:,.0f} sq ft"
    return 0, f"{sqft:,.0f} sq ft"


def combined_priority(sun_score, value_score, sqft_score, doors_to_knock):
    if sun_score == 0:
        return 0, "LOW — Poor solar potential"
    total = sun_score + value_score + sqft_score
    if doors_to_knock >= 3:
        total += 1
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
        thousands = float(str(price_thousands).replace(',', '').strip()) if pd.notna(price_thousands) else 0
        remainder = str(price_remainder).replace(',', '').strip() if pd.notna(price_remainder) else '0'
        remainder_val = float(remainder) if remainder not in ['', 'nan', '0'] else 0
        full_price = (thousands * 1000) + remainder_val
        return full_price if full_price > 0 else None
    except:
        return None


def format_date(date_val):
    if pd.isna(date_val) or not date_val:
        return "Unknown"
    try:
        return pd.to_datetime(date_val).strftime("%b %Y")
    except:
        return str(date_val)


def process_address(row_data, gmaps_client, key):
    address    = str(row_data.get('address', ''))
    sale_price = parse_sale_price(row_data.get('price'), row_data.get('price_remainder'))
    sqft       = row_data.get('sqft')
    sold_date  = format_date(row_data.get('sold_date'))
    beds       = row_data.get('beds')
    baths      = row_data.get('baths')

    try:
        sqft_val = float(str(sqft).replace(',', '')) if pd.notna(sqft) else None
    except:
        sqft_val = None

    zipcode     = extract_zip(address)
    lat, lng    = get_coordinates(address, gmaps_client)
    value_score, price_display, value_badge = score_home_value(sale_price)
    sqft_score,  sqft_display               = score_sqft(sqft_val)

    if not lat:
        return {
            'address': address, 'lat': None, 'lng': None, 'zipcode': zipcode,
            'sun_hours': None, 'sun_hours_display': 'N/A', 'category': 'Unknown',
            'street_view_link': get_street_view_link(None, None, address),
            'parking_ease': get_parking_ease(address),
            'walkable_count': 0, 'ideal_count': 0, 'good_count': 0,
            'priority_score': 0, 'priority_label': 'LOW — Could not geocode',
            'parking_address': address, 'doors_to_knock': 0, 'knock_addresses': [],
            'sale_price': sale_price, 'price_display': price_display, 'value_badge': value_badge,
            'sqft': sqft_val, 'sqft_display': sqft_display, 'sold_date': sold_date,
            'beds': beds, 'baths': baths, 'value_score': value_score, 'sqft_score': sqft_score
        }

    sun_hours         = get_solar_hours(lat, lng, key)
    category, sun_score = classify_sun_hours(sun_hours)
    sun_hours_display = f"{sun_hours:.0f}" if sun_hours else "N/A"

    neighbors     = get_nearby_addresses(lat, lng, key)
    neighbor_data = []
    for neighbor in neighbors:
        n_lat, n_lng = get_coordinates(neighbor, gmaps_client)
        if n_lat:
            n_sun = get_solar_hours(n_lat, n_lng, key)
            if n_sun:
                n_cat, n_score = classify_sun_hours(n_sun)
                neighbor_data.append({'address': neighbor, 'sun_hours': n_sun,
                                       'category': n_cat, 'score': n_score,
                                       'lat': n_lat, 'lng': n_lng})
        time.sleep(0.15)

    cluster     = [{'address': address, 'sun_hours': sun_hours, 'score': sun_score,
                    'category': category, 'lat': lat, 'lng': lng}] + neighbor_data
    ideal_count = sum(1 for h in cluster if h.get('score', 0) >= 3)
    good_count  = sum(1 for h in cluster if h.get('score', 0) >= 2)
    knock_doors = [h['address'] for h in cluster if h.get('score', 0) >= 2]

    priority_score, priority_label = combined_priority(sun_score, value_score, sqft_score, len(knock_doors))

    best_home, best_score = address, sun_score
    for h in cluster:
        if h.get('score', 0) > best_score:
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
        'sale_price': sale_price, 'price_display': price_display, 'value_badge': value_badge,
        'sqft': sqft_val, 'sqft_display': sqft_display, 'sold_date': sold_date,
        'beds': beds, 'baths': baths, 'value_score': value_score, 'sqft_score': sqft_score
    }


# ─── Zip summary ──────────────────────────────────────────────────────────────

def build_zip_summary(all_results):
    from collections import defaultdict
    zips = defaultdict(lambda: {'count': 0, 'high': 0, 'sun_hours': [], 'doors': 0, 'prices': []})
    for r in all_results:
        z = r['zipcode']
        zips[z]['count'] += 1
        if r['priority_score'] >= 2:
            zips[z]['high'] += 1
        if r['sun_hours']:
            zips[z]['sun_hours'].append(r['sun_hours'])
        if r['sale_price']:
            zips[z]['prices'].append(r['sale_price'])
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
    return f'<span style="background:{p["bg"]};color:{p["text"]};border:1px solid {p["border"]};padding:3px 12px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">{p["label"]}</span>'


def generate_html_report(all_results):
    zip_summary = build_zip_summary(all_results)
    zip_rank    = {z['zipcode']: i for i, z in enumerate(zip_summary)}
    results     = sorted(all_results,
                         key=lambda x: (zip_rank.get(x['zipcode'], 99), -x['priority_score'], -x['doors_to_knock']))
    total        = len(results)
    high_count   = sum(1 for r in results if r['priority_score'] >= 2)
    medium_count = sum(1 for r in results if r['priority_score'] == 1)
    total_knocks = sum(r['doors_to_knock'] for r in results)

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SolarIQ Report</title>
    <style>
        * {{ margin:0; padding:0; box-sizing:border-box; }}
        body {{ font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#0A0E1A; color:#C8D0E0; padding:24px; }}
        .container {{ max-width:1000px; margin:0 auto; }}

        /* Header */
        .header {{ padding:32px 0 24px; border-bottom:1px solid #1E2A40; margin-bottom:32px; }}
        .header-logo {{ font-size:2rem; font-weight:800; color:#C9A84C; letter-spacing:-1px; }}
        .header-tagline {{ font-size:12px; color:#4A5568; letter-spacing:3px; text-transform:uppercase; margin-top:4px; }}
        .header-meta {{ font-size:12px; color:#4A5568; margin-top:12px; }}
        .gold-line {{ height:2px; background:linear-gradient(90deg,#C9A84C,transparent); margin-top:8px; border-radius:2px; width:200px; }}

        /* Stats */
        .stats {{ display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:32px; }}
        .stat-card {{ background:#0D1220; border:1px solid #1E2A40; border-radius:10px; padding:20px; text-align:center; }}
        .stat-number {{ font-size:2rem; font-weight:800; color:#C9A84C; }}
        .stat-label {{ font-size:11px; color:#4A5568; text-transform:uppercase; letter-spacing:1px; margin-top:6px; }}

        /* Section headers */
        .section-header {{ border-left:3px solid #C9A84C; padding:10px 16px; margin:28px 0 16px;
                           background:linear-gradient(90deg,#0D1220,transparent);
                           font-size:11px; font-weight:700; color:#C9A84C;
                           letter-spacing:2px; text-transform:uppercase; border-radius:0 6px 6px 0; }}

        /* Zip table */
        .zip-table {{ width:100%; border-collapse:collapse; margin-bottom:32px; border-radius:10px; overflow:hidden; border:1px solid #1E2A40; }}
        .zip-table th {{ background:#0D1220; color:#6B7A99; padding:10px 14px; text-align:left;
                         font-size:10px; text-transform:uppercase; letter-spacing:1px; border-bottom:1px solid #1E2A40; }}
        .zip-table td {{ padding:12px 14px; border-bottom:1px solid #131B2E; font-size:13px; color:#C8D0E0; }}
        .zip-table tr:last-child td {{ border-bottom:none; }}
        .zip-table tr:hover td {{ background:#0D1220; }}
        .score-cell {{ color:#C9A84C; font-weight:700; }}

        /* Cards */
        .card {{ background:#0D1220; border:1px solid #1E2A40; border-radius:10px;
                 margin-bottom:16px; padding:20px; }}
        .card-priority-4 {{ border-left:4px solid #C9A84C; }}
        .card-priority-3 {{ border-left:4px solid #2E7D32; }}
        .card-priority-2 {{ border-left:4px solid #558B2F; }}
        .card-priority-1 {{ border-left:4px solid #F57C00; }}
        .card-priority-0 {{ border-left:4px solid #424242; opacity:0.6; }}

        .card-header {{ display:flex; align-items:center; gap:12px; margin-bottom:14px; }}
        .card-address {{ font-size:15px; font-weight:600; color:#E8EEF8; }}

        /* Home detail strip */
        .home-strip {{ background:#080C16; border:1px solid #131B2E; border-radius:6px;
                       padding:12px 16px; margin:12px 0; display:flex; gap:28px; flex-wrap:wrap; }}
        .home-detail-label {{ font-size:10px; color:#4A5568; text-transform:uppercase; letter-spacing:1px; }}
        .home-detail-value {{ font-size:13px; font-weight:600; color:#C8D0E0; margin-top:3px; }}

        /* Info rows */
        .info-row {{ display:flex; align-items:baseline; gap:8px; margin:6px 0; font-size:13px; }}
        .info-label {{ color:#4A5568; min-width:110px; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; }}
        .info-value {{ color:#C8D0E0; }}

        /* Inline badges */
        .tag {{ display:inline-block; padding:2px 10px; border-radius:4px; font-size:11px;
                font-weight:600; letter-spacing:0.5px; margin-left:6px; }}
        .tag-solar-ideal   {{ background:#0A2A14; color:#66BB6A; border:1px solid #2E7D32; }}
        .tag-solar-good    {{ background:#0A2A14; color:#81C784; border:1px solid #388E3C; }}
        .tag-solar-marginal{{ background:#1A1400; color:#FFA726; border:1px solid #F57C00; }}
        .tag-solar-poor    {{ background:#1A0A0A; color:#EF5350; border:1px solid #C62828; }}
        .tag-value-high    {{ background:#0A1A2A; color:#C9A84C; border:1px solid #7A5C00; }}
        .tag-value-mid     {{ background:#0A1220; color:#64B5F6; border:1px solid #1565C0; }}
        .tag-size          {{ background:#1A0A1A; color:#CE93D8; border:1px solid #6A1B9A; }}

        /* Knock list */
        .knock-list {{ background:#080C16; border:1px solid #131B2E; border-radius:6px;
                       padding:12px 16px; margin-top:10px; font-size:12px; }}
        .knock-list-title {{ color:#C9A84C; font-size:10px; text-transform:uppercase;
                             letter-spacing:1px; font-weight:700; margin-bottom:8px; }}
        .knock-item {{ color:#A0ABBE; padding:3px 0; border-bottom:1px solid #131B2E; }}
        .knock-item:last-child {{ border-bottom:none; }}

        /* Buttons */
        .btn-group {{ display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }}
        .btn {{ display:inline-block; padding:8px 18px; text-decoration:none; border-radius:6px;
                font-size:12px; font-weight:600; letter-spacing:0.5px; text-transform:uppercase; }}
        .btn-sv {{ background:transparent; color:#C9A84C; border:1px solid #C9A84C; }}
        .btn-dir {{ background:transparent; color:#64B5F6; border:1px solid #1565C0; }}

        /* Footer */
        .footer {{ margin-top:40px; padding-top:20px; border-top:1px solid #1E2A40;
                   text-align:center; color:#2A3A55; font-size:11px; letter-spacing:1px;
                   text-transform:uppercase; padding-bottom:40px; }}
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

        ps       = r['priority_score']
        sun_text = f"{r['sun_hours_display']} hrs" if r['sun_hours'] else "N/A"
        park_sh  = (r['parking_address'][:70] + "...") if len(r['parking_address']) > 70 else r['parking_address']

        solar_tag_class = {'Ideal':'tag-solar-ideal','Good':'tag-solar-good','Marginal':'tag-solar-marginal'}.get(r['category'],'tag-solar-poor')
        value_tag_class = 'tag-value-high' if r.get('value_score',0) >= 2 else 'tag-value-mid'
        size_label      = 'Large' if (r['sqft'] or 0) >= 3000 else 'Mid-Size' if (r['sqft'] or 0) >= 2000 else 'Compact'

        html += f'''<div class="card card-priority-{ps}">
    <div class="card-header">
        {priority_badge_html(ps)}
        <span class="card-address">{r['address']}</span>
    </div>
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

        html += f'''    <div class="btn-group">
        <a href="{r['street_view_link']}" target="_blank" class="btn btn-sv">Street View</a>
        <a href="https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(r['parking_address'])}" target="_blank" class="btn btn-dir">Get Directions</a>
    </div>
</div>
'''

    html += f'<div class="footer">SolarIQ &nbsp;·&nbsp; Intelligent Solar Prospecting &nbsp;·&nbsp; {datetime.now().strftime("%Y")}</div></div></body></html>'
    return html


# ─── Route optimizer CSV ──────────────────────────────────────────────────────

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
    def safe_col(idx):
        return cols[idx] if idx < len(cols) else None

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
                st.success(f"Sheets updated — **{inserted}** new addresses added · **{updated}** existing records refreshed")

            st.session_state['all_results'] = all_results

# ── Results ───────────────────────────────────────────────────────────────────
if 'all_results' in st.session_state:
    all_results = st.session_state['all_results']

    st.markdown("---")
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Properties Analyzed",  len(all_results))
    col2.metric("Premium + Highest",    sum(1 for r in all_results if r['priority_score'] >= 3))
    col3.metric("High + Medium",        sum(1 for r in all_results if r['priority_score'] in [1, 2]))
    col4.metric("Total Doors",          sum(r['doors_to_knock'] for r in all_results))

    html_report = generate_html_report(all_results)
    st.download_button(
        label="Download Intelligence Report",
        data=html_report,
        file_name=f"solariq_report_{datetime.now().strftime('%Y%m%d_%H%M')}.html",
        mime="text/html", use_container_width=True, type="primary"
    )

    # Zip summary
    st.markdown('<div class="siq-section">Area Intelligence</div>', unsafe_allow_html=True)
    zip_summary = build_zip_summary(all_results)
    st.dataframe(pd.DataFrame(zip_summary).rename(columns={
        'zipcode': 'Zip', 'total': 'Properties', 'high_priority': 'High Priority',
        'avg_sun_hours': 'Avg Sun Hrs', 'avg_home_value': 'Avg Home Value',
        'total_doors': 'Total Doors', 'zip_score': 'Area Score'
    }), use_container_width=True, hide_index=True)

    # Route selection
    st.markdown('<div class="siq-section">Route Selection</div>', unsafe_allow_html=True)
    st.markdown("Select stops to include in your route export.")

    zip_rank = {z['zipcode']: i for i, z in enumerate(zip_summary)}
    sorted_results = sorted(
        all_results,
        key=lambda x: (zip_rank.get(x['zipcode'], 99), -x['priority_score'], -x['doors_to_knock'])
    )

    selected    = []
    current_zip = None
    for r in sorted_results:
        if r['priority_score'] == 0:
            continue
        if r['zipcode'] != current_zip:
            current_zip = r['zipcode']
            z_data = next((z for z in zip_summary if z['zipcode'] == current_zip), {})
            st.markdown(
                f'<div class="siq-zip-header">Zip {current_zip} &nbsp;·&nbsp; Score {z_data.get("zip_score","?")} &nbsp;·&nbsp; Avg {z_data.get("avg_home_value","N/A")} &nbsp;·&nbsp; {z_data.get("total_doors","?")} doors</div>',
                unsafe_allow_html=True
            )

        p     = PRIORITY[r['priority_score']]
        label = (f"[{p['label']}]  {r['address'][:50]}  —  {r['price_display']}  |  "
                 f"{r['sqft_display']}  |  {r['sun_hours_display']} sun hrs  |  {r['doors_to_knock']} doors")
        if st.checkbox(label, key=f"chk_{r['address']}"):
            selected.append(r)

    if selected:
        st.success(f"**{len(selected)} stops** selected — **{sum(r['doors_to_knock'] for r in selected)} total doors**")
        st.download_button(
            label="Export Route to CSV",
            data=build_route_csv(selected),
            file_name=f"solariq_route_{datetime.now().strftime('%Y%m%d_%H%M')}.csv",
            mime="text/csv", use_container_width=True, type="primary"
        )
