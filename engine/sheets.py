import json
import os
from collections import defaultdict
from datetime import datetime

import streamlit as st

from engine.constants import get_priority_meta

SPREADSHEET_ID = "1qpx34ySHm5XPYpkNQxVx33KWS_971K2X1aBwmKerGGs"

HEADERS = [
    "Address",
    "Priority",
    "Sale Price",
    "Sq Ft",
    "Beds",
    "Baths",
    "Sun Hours",
    "Solar Category",
    "Sold Date",
    "Doors in Cluster",
    "Zip",
    "Latitude",
    "Longitude",
    "Source",
    "First Analyzed",
    "Last Updated",
    "Knocked",
    "Lead Status",
    "Notes",
]

COL_LAT = 11
COL_LNG = 12
COL_SOURCE = 13
COL_FIRST_ANALYZED = 14
COL_LAST_UPDATED = 15
COL_KNOCKED = 16
COL_LEAD_STATUS = 17
COL_NOTES = 18


def get_sheets_service():
    try:
        raw_service_account = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")
        if not raw_service_account:
            st.warning("Missing GOOGLE_SERVICE_ACCOUNT_JSON.")
            return None

        service_account_info = json.loads(raw_service_account)

        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        creds = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        return build("sheets", "v4", credentials=creds)
    except json.JSONDecodeError as err:
        st.warning(f"GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: {err}")
        return None
    except Exception as err:
        st.warning(f"Could not connect to Google Sheets: {err}")
        return None


def round_coord(val, places=5):
    try:
        return round(float(val), places)
    except Exception:
        return None


def ensure_sheet_tab(service, tab_name):
    try:
        meta = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
        existing = [sheet["properties"]["title"] for sheet in meta["sheets"]]
        if tab_name not in existing:
            service.spreadsheets().batchUpdate(
                spreadsheetId=SPREADSHEET_ID,
                body={"requests": [{"addSheet": {"properties": {"title": tab_name}}}]},
            ).execute()
            service.spreadsheets().values().update(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{tab_name}'!A1",
                valueInputOption="RAW",
                body={"values": [HEADERS]},
            ).execute()
    except Exception as err:
        st.warning(f"Could not create tab {tab_name}: {err}")


def get_existing_rows(service, tab_name):
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{tab_name}'!A1:S",
        ).execute()
        rows = result.get("values", [])
        existing = {}
        for i, row in enumerate(rows[1:], start=2):
            try:
                lat = round_coord(row[COL_LAT])
                lng = round_coord(row[COL_LNG])
                if lat and lng:
                    existing[(lat, lng)] = {
                        "row_index": i,
                        "first_analyzed": row[COL_FIRST_ANALYZED] if len(row) > COL_FIRST_ANALYZED else "",
                        "knocked": row[COL_KNOCKED] if len(row) > COL_KNOCKED else "0",
                        "lead_status": row[COL_LEAD_STATUS] if len(row) > COL_LEAD_STATUS else "",
                        "notes": row[COL_NOTES] if len(row) > COL_NOTES else "",
                    }
            except Exception:
                continue
        return existing
    except Exception:
        return {}


def build_row(r, source, first_analyzed, last_updated, knocked="0", lead_status="", notes=""):
    return [
        r["address"],
        get_priority_meta(r.get("priority_score"))["label"],
        r["price_display"],
        r["sqft_display"],
        str(r.get("beds", "")),
        str(r.get("baths", "")),
        r["sun_hours_display"],
        r["category"],
        r["sold_date"],
        r["doors_to_knock"],
        r["zipcode"],
        r["lat"] or "",
        r["lng"] or "",
        source,
        first_analyzed,
        last_updated,
        knocked,
        lead_status,
        notes,
    ]


def summarize_result_sources(all_results):
    original_count = len(all_results)
    neighbor_count = sum(len(result.get("neighbor_records", [])) for result in all_results)
    return {
        "original_count": original_count,
        "neighbor_count": neighbor_count,
    }


def sync_results_to_sheet(service, all_results):
    flat = []
    for result in all_results:
        flat.append({**result, "source": "Original List"})
        for neighbor in result.get("neighbor_records", []):
            flat.append({**neighbor, "source": "Cluster Neighbor"})

    by_zip = defaultdict(list)
    for result in flat:
        by_zip[result["zipcode"]].append(result)

    total_inserted = 0
    total_updated = 0
    inserted_original = 0
    inserted_neighbors = 0
    updated_original = 0
    updated_neighbors = 0
    today = datetime.now().strftime("%Y-%m-%d")

    for zipcode, results in by_zip.items():
        tab_name = f"Zip {zipcode}"
        ensure_sheet_tab(service, tab_name)
        existing = get_existing_rows(service, tab_name)

        to_append = []
        to_update = []

        for result in results:
            source = result.get("source", "")
            if not result.get("lat") or not result.get("lng"):
                to_append.append((build_row(result, source, today, today), source))
                continue

            key = (round_coord(result["lat"]), round_coord(result["lng"]))
            if key in existing:
                prev = existing[key]
                to_update.append(
                    (
                        prev["row_index"],
                        build_row(
                            result,
                            source,
                            first_analyzed=prev["first_analyzed"] or today,
                            last_updated=today,
                            knocked=prev["knocked"],
                            lead_status=prev["lead_status"],
                            notes=prev["notes"],
                        ),
                        source,
                    )
                )
            else:
                to_append.append((build_row(result, source, today, today), source))

        if to_append:
            try:
                service.spreadsheets().values().append(
                    spreadsheetId=SPREADSHEET_ID,
                    range=f"'{tab_name}'!A1",
                    valueInputOption="RAW",
                    insertDataOption="INSERT_ROWS",
                    body={"values": [row for row, _source in to_append]},
                ).execute()
                total_inserted += len(to_append)
                inserted_original += sum(1 for _row, source in to_append if source == "Original List")
                inserted_neighbors += sum(1 for _row, source in to_append if source == "Cluster Neighbor")
            except Exception as err:
                st.warning(f"Could not append to {tab_name}: {err}")

        for row_index, row_vals, source in to_update:
            try:
                service.spreadsheets().values().update(
                    spreadsheetId=SPREADSHEET_ID,
                    range=f"'{tab_name}'!A{row_index}",
                    valueInputOption="RAW",
                    body={"values": [row_vals]},
                ).execute()
                total_updated += 1
                if source == "Original List":
                    updated_original += 1
                elif source == "Cluster Neighbor":
                    updated_neighbors += 1
            except Exception as err:
                st.warning(f"Could not update row {row_index} in {tab_name}: {err}")

    return {
        "inserted_total": total_inserted,
        "updated_total": total_updated,
        "inserted_original": inserted_original,
        "inserted_neighbors": inserted_neighbors,
        "updated_original": updated_original,
        "updated_neighbors": updated_neighbors,
    }
