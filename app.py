import json
import math
import os
import time
import urllib.parse
from datetime import datetime
from pathlib import Path

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
    default_execution_entry,
    ensure_execution_state,
    make_property_id,
)
from engine.geolocation_component import geolocation_picker
from engine.persistence import load_app_snapshot, save_app_snapshot
from engine.processing import build_processing_error_result, process_address
from engine.reporting import build_route_csv, build_zip_summary, generate_html_report
from engine.routing import optimize_route
from engine.supabase_auth import sign_in_with_password, sign_out, supabase_auth_enabled
from engine.supabase_store import (
    create_route_run,
    get_current_app_user,
    get_open_lead_pool,
    get_rep_options,
    get_route_drafts,
    get_user_memberships,
    load_route_draft_results,
    save_analysis_result,
    save_route_draft,
    supabase_enabled,
    update_route_run_stop,
)
from engine.sheets import get_sheets_service, summarize_result_sources, sync_results_to_sheet
from engine.geo import extract_zip


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


def route_status_meta(result, execution_entry=None):
    route_status = str((result or {}).get("route_run_status") or "pending").strip().lower()
    execution_status = str((execution_entry or {}).get("status") or "").strip().lower()

    if route_status == "skipped":
        return {
            "status_key": "skipped",
            "label": "Skipped",
            "fill_color": [97, 97, 97, 210],
            "line_color": [232, 238, 248, 255],
        }
    if route_status == "completed":
        if "interested" in execution_status:
            return {
                "status_key": "interested",
                "label": "Interested",
                "fill_color": [46, 125, 50, 230],
                "line_color": [195, 255, 207, 255],
            }
        if "callback" in execution_status:
            return {
                "status_key": "callback",
                "label": "Callback",
                "fill_color": [12, 124, 168, 230],
                "line_color": [184, 236, 255, 255],
            }
        if "not home" in execution_status:
            return {
                "status_key": "not_home",
                "label": execution_entry.get("status") or "Not Home",
                "fill_color": [230, 126, 34, 230],
                "line_color": [255, 218, 180, 255],
            }
        if "not interested" in execution_status:
            return {
                "status_key": "not_interested",
                "label": "Not Interested",
                "fill_color": [176, 52, 72, 230],
                "line_color": [255, 205, 212, 255],
            }
        return {
            "status_key": "completed",
            "label": "Completed",
            "fill_color": [76, 175, 80, 220],
            "line_color": [212, 255, 216, 255],
        }
    return {
        "status_key": "pending",
        "label": "Pending",
        "fill_color": [201, 168, 76, 220],
        "line_color": [255, 243, 176, 255],
    }


def build_turf_map_df(results, execution_state, active_address=None):
    rows = []
    for idx, result in enumerate(results, start=1):
        lat = result.get("lat")
        lng = result.get("lng")
        if lat is None or lng is None:
            continue

        property_id = make_property_id("primary_stop", result.get("address"))
        execution_entry = (execution_state or {}).get(property_id, {})
        status_meta = route_status_meta(result, execution_entry)
        priority_meta = get_priority_meta(result.get("priority_score", 0))
        rows.append(
            {
                "address": result.get("address"),
                "parking_address": result.get("parking_address") or result.get("address"),
                "lat": lat,
                "lng": lng,
                "stop_number": idx,
                "priority_label": priority_meta["label"],
                "solar_category": result.get("category", "Unknown"),
                "doors_to_knock": result.get("doors_to_knock", 0),
                "status_label": status_meta["label"],
                "status_key": status_meta["status_key"],
                "fill_color": status_meta["fill_color"],
                "line_color": [255, 255, 255, 255] if result.get("address") == active_address else status_meta["line_color"],
                "line_width": 6 if result.get("address") == active_address else 2,
                "radius": 85 if result.get("address") == active_address else marker_radius(result.get("doors_to_knock", 0)),
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
    return map_df


def turf_distance_miles(lat1, lng1, lat2, lng2):
    try:
        lat1 = float(lat1)
        lng1 = float(lng1)
        lat2 = float(lat2)
        lng2 = float(lng2)
    except Exception:
        return None

    radians = math.pi / 180
    dlat = (lat2 - lat1) * radians
    dlng = (lng2 - lng1) * radians
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1 * radians) * math.cos(lat2 * radians) * math.sin(dlng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return 3958.8 * c


def turf_building_height(result):
    sqft = result.get("sqft")
    if sqft is None:
        return 18 + (result.get("priority_score", 0) * 8)
    try:
        sqft = float(sqft)
    except Exception:
        return 18 + (result.get("priority_score", 0) * 8)
    return max(18, min(72, 14 + (sqft / 120)))


def build_turf_property_map_df(execution_properties, execution_results, execution_state, active_property_id=None):
    result_lookup = {result.get("address"): result for result in execution_results or []}
    rows = []
    for property_record in execution_properties or []:
        lat = property_record.get("lat")
        lng = property_record.get("lng")
        if lat is None or lng is None:
            continue

        property_id = property_record.get("property_id")
        execution_entry = (execution_state or {}).get(property_id, {})
        route_result = result_lookup.get(property_record.get("source_result_address"))
        synthetic_result = dict(route_result or {})
        if property_record.get("property_type") != "Primary Stop":
            synthetic_result["route_run_status"] = "completed" if execution_entry.get("status") else "pending"
        status_meta = route_status_meta(synthetic_result, execution_entry)
        rows.append(
            {
                "property_id": property_id,
                "address": property_record.get("address"),
                "parent_stop_address": property_record.get("parent_stop_address"),
                "property_type": property_record.get("property_type"),
                "lat": lat,
                "lng": lng,
                "stop_number": property_record.get("route_stop_number"),
                "priority_label": property_record.get("priority_label") or get_priority_meta(property_record.get("priority_score", 0))["label"],
                "solar_category": property_record.get("category", "Unknown"),
                "doors_to_knock": property_record.get("doors_to_knock", 0),
                "status_label": status_meta["label"],
                "fill_color": status_meta["fill_color"],
                "line_color": [255, 255, 255, 255] if property_id == active_property_id else status_meta["line_color"],
                "line_width": 6 if property_id == active_property_id else 2,
                "radius": 92 if property_id == active_property_id else 54,
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
    return map_df


def render_turf_map(
    execution_properties,
    execution_results,
    execution_state,
    active_property_id=None,
    user_location=None,
    dropped_pin=None,
    height=700,
):
    map_df = build_turf_property_map_df(
        execution_properties,
        execution_results,
        execution_state,
        active_property_id=active_property_id,
    )
    if map_df.empty:
        st.info("Turf map will appear once the route has geocoded stops.")
        return active_property_id

    if user_location and user_location.get("latitude") is not None and user_location.get("longitude") is not None:
        user_lat = float(user_location["latitude"])
        user_lng = float(user_location["longitude"])
        map_df["distance_miles"] = map_df.apply(
            lambda row: turf_distance_miles(user_lat, user_lng, row["lat"], row["lng"]),
            axis=1,
        )
        nearby_df = map_df[map_df["distance_miles"].notna() & (map_df["distance_miles"] <= 1.25)].copy()
        if not nearby_df.empty:
            map_df = nearby_df.reset_index(drop=True)
        center_lat, center_lng = user_lat, user_lng
        zoom = 17
        pitch = 52
    elif active_property_id and not map_df[map_df["property_id"] == active_property_id].empty:
        active_row = map_df[map_df["property_id"] == active_property_id].iloc[0]
        center_lat, center_lng = float(active_row["lat"]), float(active_row["lng"])
        zoom = 17
        pitch = 52
    else:
        center_lat, center_lng = map_center(map_df)
        zoom = max(16, estimate_zoom(map_df))
        pitch = 45

    map_df["building_height"] = map_df.apply(
        lambda row: turf_building_height(
            next((record for record in execution_properties if record.get("property_id") == row["property_id"]), {})
        ),
        axis=1,
    )
    map_df["building_fill"] = map_df.apply(
        lambda row: [165, 171, 181, 215] if row["property_id"] != active_property_id else [214, 184, 102, 235],
        axis=1,
    )

    view_state = pdk.ViewState(
        latitude=center_lat,
        longitude=center_lng,
        zoom=zoom,
        pitch=pitch,
        bearing=-12,
        controller=True,
    )

    building_layer = pdk.Layer(
        "ColumnLayer",
        id="turf-buildings",
        data=map_df,
        get_position="[lng, lat]",
        get_elevation="building_height",
        elevation_scale=3,
        radius=14,
        get_fill_color="building_fill",
        pickable=False,
        extruded=True,
        stroked=False,
        auto_highlight=True,
    )

    point_layer = pdk.Layer(
        "ScatterplotLayer",
        id="turf-points",
        data=map_df,
        get_position="[lng, lat]",
        get_radius="radius",
        get_fill_color="fill_color",
        get_line_color="line_color",
        get_line_width="line_width",
        pickable=True,
        stroked=True,
        filled=True,
        radius_min_pixels=8,
        radius_max_pixels=30,
    )

    text_layer = pdk.Layer(
        "TextLayer",
        id="turf-labels",
        data=map_df,
        get_position="[lng, lat]",
        get_text="stop_number",
        get_color="[8, 12, 22, 255]",
        get_size=14,
        get_alignment_baseline="'center'",
        get_text_anchor="'middle'",
        pickable=False,
    )

    layers = [building_layer, point_layer, text_layer]
    if user_location and user_location.get("latitude") is not None and user_location.get("longitude") is not None:
        user_df = pd.DataFrame(
            [{"lat": user_location["latitude"], "lng": user_location["longitude"]}]
        )
        user_layer = pdk.Layer(
            "ScatterplotLayer",
            id="turf-user-location",
            data=user_df,
            get_position="[lng, lat]",
            get_radius=32,
            get_fill_color=[32, 197, 255, 210],
            get_line_color=[255, 255, 255, 255],
            get_line_width=3,
            pickable=False,
            stroked=True,
            filled=True,
            radius_min_pixels=10,
            radius_max_pixels=22,
        )
        layers.append(user_layer)

    if dropped_pin and dropped_pin.get("latitude") is not None and dropped_pin.get("longitude") is not None:
        dropped_pin_df = pd.DataFrame(
            [
                {
                    "lat": dropped_pin["latitude"],
                    "lng": dropped_pin["longitude"],
                    "label": "Pinned",
                }
            ]
        )
        dropped_pin_layer = pdk.Layer(
            "ScatterplotLayer",
            id="turf-dropped-pin",
            data=dropped_pin_df,
            get_position="[lng, lat]",
            get_radius=40,
            get_fill_color=[225, 29, 72, 235],
            get_line_color=[255, 255, 255, 255],
            get_line_width=4,
            pickable=False,
            stroked=True,
            filled=True,
            radius_min_pixels=12,
            radius_max_pixels=28,
        )
        dropped_pin_text_layer = pdk.Layer(
            "TextLayer",
            id="turf-dropped-pin-label",
            data=dropped_pin_df,
            get_position="[lng, lat]",
            get_text="label",
            get_color="[255, 255, 255, 255]",
            get_size=13,
            get_alignment_baseline="'bottom'",
            get_text_anchor="'middle'",
            get_pixel_offset="[0, -18]",
            pickable=False,
        )
        layers.extend([dropped_pin_layer, dropped_pin_text_layer])

    tooltip = {
        "html": (
            "<b>Stop {stop_number}</b> · {property_type}<br/>"
            "{address}<br/>"
            "Status: {status_label}<br/>"
            "Priority: {priority_label}<br/>"
            "Solar: {solar_category}<br/>"
            "Doors: {doors_to_knock}"
        ),
        "style": {
            "backgroundColor": "#0D1220",
            "color": "#E8EEF8",
            "fontSize": "12px",
        },
    }

    selection_state = st.pydeck_chart(
        pdk.Deck(
            layers=layers,
            initial_view_state=view_state,
            tooltip=tooltip,
            map_provider="carto",
            map_style="light_no_labels",
        ),
        selection_mode="single-object",
        on_select="rerun",
        key="rep_turf_map",
        use_container_width=True,
        height=height,
    )

    selected_objects = []
    try:
        selected_objects = selection_state.selection.objects.get("turf-points", [])
        if not selected_objects:
            selected_objects = selection_state.selection.objects.get("turf-buildings", [])
    except Exception:
        selected_objects = []

    if selected_objects:
        selected_property_id = selected_objects[0].get("property_id")
        if selected_property_id:
            st.session_state["active_property_id"] = selected_property_id
            return selected_property_id

    return active_property_id


def format_follow_up_slot(date_value, time_value):
    if not date_value:
        return ""
    if time_value:
        return f"{date_value.strftime('%b %d, %Y')} at {time_value.strftime('%I:%M %p')}"
    return date_value.strftime("%b %d, %Y")


def append_activity_event(execution_entry, event_type, summary):
    history = list(execution_entry.get("activity_log") or [])
    timestamp = datetime.now().strftime("%b %d, %Y %I:%M %p")
    history.insert(
        0,
        {
            "timestamp": timestamp,
            "type": event_type,
            "summary": summary,
        },
    )
    execution_entry["activity_log"] = history[:12]
    execution_entry["last_contacted_at"] = timestamp
    execution_entry["last_outcome"] = summary


def build_appointment_ics(address, homeowner_name, appointment_label, notes):
    now_utc = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    clean_notes = str(notes or "").replace("\n", "\\n")
    clean_name = homeowner_name or "Prospect"
    clean_label = appointment_label or "Appointment"
    uid = f"{address}-{now_utc}".replace(" ", "_").replace(",", "")
    return (
        "BEGIN:VCALENDAR\n"
        "VERSION:2.0\n"
        "PRODID:-//Lumino//Appointments//EN\n"
        "BEGIN:VEVENT\n"
        f"UID:{uid}\n"
        f"DTSTAMP:{now_utc}\n"
        f"SUMMARY:Lumino Appointment - {clean_name}\n"
        f"DESCRIPTION:{clean_label}\\n{clean_notes}\n"
        f"LOCATION:{address}\n"
        "END:VEVENT\n"
        "END:VCALENDAR\n"
    )


def crm_summary_rows(execution_results, execution_state):
    appointment_rows = []
    follow_up_rows = []
    hot_lead_rows = []
    recent_activity_rows = []
    for idx, result in enumerate(execution_results or [], start=1):
        property_id = make_property_id("primary_stop", result.get("address"))
        entry = (execution_state or {}).get(property_id, {})
        stage = entry.get("lead_stage") or "New Lead"
        next_action = entry.get("next_action") or ""
        task_due_date = entry.get("task_due_date") or ""
        appointment_status = entry.get("appointment_status") or "Not Set"
        interest_level = entry.get("interest_level") or ""
        if entry.get("best_follow_up_time"):
            appointment_rows.append(
                {
                    "Stop": idx,
                    "Address": result.get("address"),
                    "Appointment": entry.get("best_follow_up_time"),
                    "Status": appointment_status,
                    "Stage": stage,
                }
            )
        if next_action or task_due_date:
            follow_up_rows.append(
                {
                    "Stop": idx,
                    "Address": result.get("address"),
                    "Next Action": next_action or "Follow up",
                    "Due": task_due_date or "Open",
                    "Priority": entry.get("task_priority") or "Medium",
                    "Stage": stage,
                }
            )
        if interest_level.lower() in {"hot", "warm"} or stage in {"Appointment Set", "Quoted", "Negotiation"}:
            hot_lead_rows.append(
                {
                    "Stop": idx,
                    "Address": result.get("address"),
                    "Interest": interest_level or "Warm",
                    "Stage": stage,
                    "Follow Up": entry.get("best_follow_up_time") or "",
                }
            )
        for item in (entry.get("activity_log") or [])[:2]:
            recent_activity_rows.append(
                {
                    "Stop": idx,
                    "Address": result.get("address"),
                    "Time": item.get("timestamp"),
                    "Type": item.get("type"),
                    "Summary": item.get("summary"),
                }
            )
    return appointment_rows, follow_up_rows, hot_lead_rows, recent_activity_rows[:14]


def current_workspace_owner_label(current_app_user, auth_context):
    draft_id = st.session_state.get("current_route_draft_id")
    if draft_id and auth_context:
        draft_rows = get_route_drafts(auth_context=auth_context) or []
        matching_draft = next((draft for draft in draft_rows if draft.get("id") == draft_id), None)
        if matching_draft:
            rep_name = (matching_draft.get("app_users") or {}).get("full_name")
            if rep_name:
                return rep_name
    if current_app_user:
        return current_app_user.get("full_name") or current_app_user.get("email") or "Current User"
    return "Workspace"


def render_manager_followup_board(all_results, execution_state, current_app_user, auth_context):
    st.markdown('<div class="siq-section">Manager Follow-Up Board</div>', unsafe_allow_html=True)
    st.markdown(
        "Track appointments, next actions, hot leads, and recent rep activity across the loaded workspace so coaching happens before momentum drops."
    )

    owner_label = current_workspace_owner_label(current_app_user, auth_context)
    board_rows = []
    for idx, result in enumerate(all_results or [], start=1):
        property_id = make_property_id("primary_stop", result.get("address"))
        entry = (execution_state or {}).get(property_id, {})
        status_meta = route_status_meta(result, entry)
        board_rows.append(
            {
                "Stop": idx,
                "Rep": owner_label,
                "Address": result.get("address"),
                "Stage": entry.get("lead_stage") or "New Lead",
                "Interest": entry.get("interest_level") or "",
                "Status": status_meta["label"],
                "Appointment": entry.get("best_follow_up_time") or "",
                "Appointment Status": entry.get("appointment_status") or "Not Set",
                "Next Action": entry.get("next_action") or "",
                "Due": entry.get("task_due_date") or "",
                "Priority": entry.get("task_priority") or "Medium",
                "Phone": entry.get("phone") or result.get("phone") or "",
                "Email": entry.get("email") or result.get("email") or "",
                "Last Activity": entry.get("last_contacted_at") or "",
                "Last Outcome": entry.get("last_outcome") or "",
                "Notes": entry.get("notes") or result.get("notes") or "",
            }
        )

    board_df = pd.DataFrame(board_rows)
    if board_df.empty:
        st.info("This board will populate once the workspace has loaded leads.")
        return

    appointments_df = board_df[board_df["Appointment"] != ""].copy()
    follow_up_df = board_df[(board_df["Next Action"] != "") | (board_df["Due"] != "")].copy()
    hot_leads_df = board_df[
        board_df["Interest"].str.lower().isin(["hot", "warm"])
        | board_df["Stage"].isin(["Appointment Set", "Quoted", "Negotiation"])
    ].copy()
    overdue_df = board_df[
        (board_df["Due"] != "") & (~board_df["Stage"].isin(["Closed Won", "Closed Lost"]))
    ].copy()

    metric_cols = st.columns(5)
    metric_cols[0].metric("Loaded Leads", len(board_df))
    metric_cols[1].metric("Appointments", len(appointments_df))
    metric_cols[2].metric("Follow-Ups", len(follow_up_df))
    metric_cols[3].metric("Hot Leads", len(hot_leads_df))
    metric_cols[4].metric("Open Tasks", len(overdue_df))

    board_tab1, board_tab2, board_tab3, board_tab4 = st.tabs(
        ["Appointments", "Follow-Up", "Pipeline", "Recent Activity"]
    )

    with board_tab1:
        if appointments_df.empty:
            st.info("No appointments have been scheduled yet.")
        else:
            st.dataframe(
                appointments_df[["Rep", "Address", "Appointment", "Appointment Status", "Stage", "Phone"]],
                use_container_width=True,
                hide_index=True,
                height=280,
            )

    with board_tab2:
        followup_cols = st.columns(2)
        with followup_cols[0]:
            st.markdown("#### Next Actions")
            if follow_up_df.empty:
                st.info("No follow-up tasks are queued yet.")
            else:
                st.dataframe(
                    follow_up_df[["Rep", "Address", "Next Action", "Due", "Priority", "Stage"]],
                    use_container_width=True,
                    hide_index=True,
                    height=280,
                )
        with followup_cols[1]:
            st.markdown("#### Contact Ready")
            contact_ready_df = board_df[(board_df["Phone"] != "") | (board_df["Email"] != "")].copy()
            if contact_ready_df.empty:
                st.info("No contacts are ready yet.")
            else:
                st.dataframe(
                    contact_ready_df[["Rep", "Address", "Phone", "Email", "Last Outcome"]],
                    use_container_width=True,
                    hide_index=True,
                    height=280,
                )

    with board_tab3:
        pipeline_cols = st.columns(2)
        with pipeline_cols[0]:
            st.markdown("#### Hot Pipeline")
            if hot_leads_df.empty:
                st.info("No hot leads have been identified yet.")
            else:
                st.dataframe(
                    hot_leads_df[["Rep", "Address", "Stage", "Interest", "Appointment", "Last Outcome"]],
                    use_container_width=True,
                    hide_index=True,
                    height=280,
                )
        with pipeline_cols[1]:
            st.markdown("#### All Stages")
            pipeline_counts = (
                board_df.groupby("Stage", dropna=False)
                .size()
                .reset_index(name="Count")
                .sort_values("Count", ascending=False)
            )
            st.dataframe(pipeline_counts, use_container_width=True, hide_index=True, height=280)

    with board_tab4:
        recent_activity_rows = []
        for idx, result in enumerate(all_results or [], start=1):
            property_id = make_property_id("primary_stop", result.get("address"))
            entry = (execution_state or {}).get(property_id, {})
            for item in (entry.get("activity_log") or [])[:3]:
                recent_activity_rows.append(
                    {
                        "Rep": owner_label,
                        "Stop": idx,
                        "Address": result.get("address"),
                        "Time": item.get("timestamp"),
                        "Type": item.get("type"),
                        "Summary": item.get("summary"),
                    }
                )
        if recent_activity_rows:
            recent_activity_df = pd.DataFrame(recent_activity_rows).head(18)
            st.dataframe(recent_activity_df, use_container_width=True, hide_index=True, height=320)
        else:
            st.info("Recent CRM activity will appear here once reps start logging actions.")


def next_pending_address(results):
    for result in results or []:
        if str(result.get("route_run_status") or "pending").lower() == "pending":
            return result.get("address")
    return (results or [{}])[0].get("address") if results else None


def next_pending_property_id(results):
    next_address = next_pending_address(results)
    if not next_address:
        return None
    return make_property_id("primary_stop", next_address)


def next_not_home_status(current_status):
    current = str(current_status or "").strip().lower()
    if current == "not home 1":
        return "Not Home 2"
    if current == "not home 2":
        return "Not Home 3"
    return "Not Home 1"


def sync_route_stop_details(result, execution_entry, auth_context=None):
    route_stop_id = (result or {}).get("route_run_stop_id")
    if not route_stop_id:
        return True
    return update_route_run_stop(
        route_stop_id,
        homeowner_name=execution_entry.get("homeowner_name"),
        phone=execution_entry.get("phone"),
        email=execution_entry.get("email"),
        best_follow_up_time=execution_entry.get("best_follow_up_time"),
        interest_level=(execution_entry.get("interest_level") or "").lower() or None,
        notes=execution_entry.get("notes"),
        auth_context=auth_context,
    )


def apply_quick_disposition(
    result,
    execution_state,
    *,
    property_id_override=None,
    status_label,
    route_status,
    outcome=None,
    skipped_reason=None,
    interest_level="",
    auth_context=None,
):
    address = result.get("address")
    property_id = property_id_override or make_property_id("primary_stop", address)
    entry = execution_state.setdefault(property_id, default_execution_entry())
    entry["status"] = status_label
    if interest_level:
        entry["interest_level"] = interest_level

    route_stop_id = result.get("route_run_stop_id")
    if route_stop_id:
        updated = update_route_run_stop(
            route_stop_id,
            stop_status=route_status,
            outcome=outcome,
            skipped_reason=skipped_reason,
            homeowner_name=entry.get("homeowner_name"),
            phone=entry.get("phone"),
            email=entry.get("email"),
            best_follow_up_time=entry.get("best_follow_up_time"),
            interest_level=(entry.get("interest_level") or "").lower() or None,
            notes=entry.get("notes"),
            auth_context=auth_context,
        )
        if not updated:
            return False

    result["route_run_status"] = route_status
    return True


def find_nearest_turf_property(execution_properties, latitude, longitude, max_distance_miles=0.35):
    nearest_property = None
    nearest_distance = None
    for property_record in execution_properties or []:
        lat = property_record.get("lat")
        lng = property_record.get("lng")
        if lat is None or lng is None:
            continue
        distance = turf_distance_miles(latitude, longitude, lat, lng)
        if distance is None:
            continue
        if nearest_distance is None or distance < nearest_distance:
            nearest_property = property_record
            nearest_distance = distance

    if nearest_property is None:
        return None, None
    if max_distance_miles is not None and nearest_distance is not None and nearest_distance > max_distance_miles:
        return None, nearest_distance
    return nearest_property, nearest_distance


def reverse_geocode_address(latitude, longitude):
    try:
        gmaps_client = googlemaps.Client(key=api_key)
        results = gmaps_client.reverse_geocode((float(latitude), float(longitude)))
    except Exception:
        return None
    if not results:
        return None
    return results[0].get("formatted_address")


def build_ad_hoc_result(address, latitude, longitude):
    zipcode = extract_zip(address)
    return {
        "address": address,
        "lat": float(latitude),
        "lng": float(longitude),
        "zipcode": zipcode,
        "sun_hours": None,
        "sun_hours_display": "N/A",
        "category": "Manual Knock",
        "solar_fit_score": 0,
        "roof_capacity_score": 0,
        "roof_complexity_score": 0,
        "max_array_panels_count": None,
        "max_array_area_m2": None,
        "panel_capacity_watts": None,
        "system_capacity_kw": None,
        "yearly_energy_dc_kwh": None,
        "roof_segment_count": None,
        "south_facing_segment_count": None,
        "whole_roof_area_m2": None,
        "building_area_m2": None,
        "imagery_quality": None,
        "street_view_link": f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={latitude},{longitude}",
        "parking_ease": "Unknown",
        "walkable_count": 0,
        "ideal_count": 0,
        "good_count": 0,
        "priority_score": 1,
        "priority_label": "FIELD ADDED",
        "parking_address": address,
        "doors_to_knock": 1,
        "knock_addresses": [address],
        "neighbor_records": [],
        "sale_price": None,
        "price_display": "N/A",
        "value_badge": "",
        "sqft": None,
        "sqft_display": "N/A",
        "sold_date": "Unknown",
        "beds": "",
        "baths": "",
        "value_score": 0,
        "sqft_score": 0,
        "route_run_status": "pending",
    }


def add_ad_hoc_pin_result(latitude, longitude):
    address = reverse_geocode_address(latitude, longitude)
    if not address:
        return None

    existing_results = list(st.session_state.get("all_results", []))
    existing = next((result for result in existing_results if result.get("address") == address), None)
    if existing:
        existing["lat"] = float(latitude)
        existing["lng"] = float(longitude)
        result = existing
    else:
        result = build_ad_hoc_result(address, latitude, longitude)
        existing_results.append(result)

    st.session_state["all_results"] = existing_results
    st.session_state.setdefault("selected_route_addresses", set()).add(address)
    property_id = make_property_id("primary_stop", address)
    st.session_state["route_execution"] = ensure_execution_state(
        st.session_state.get("route_execution", {}),
        build_execution_properties(existing_results),
    )
    st.session_state["active_property_id"] = property_id
    save_app_snapshot(
        all_results=existing_results,
        route_execution=st.session_state.get("route_execution", {}),
    )
    return result


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
APP_ROOT = Path(__file__).resolve().parent
BRAND_MARK_PATH = APP_ROOT / "assets" / "lumino-mark.svg"
BRAND_WORDMARK_PATH = APP_ROOT / "assets" / "lumino-wordmark.svg"

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
st.set_page_config(
    page_title="Lumino",
    page_icon=str(BRAND_MARK_PATH) if BRAND_MARK_PATH.exists() else "L",
    layout="wide",
)

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
.platform-hero {
    background:
        radial-gradient(circle at top right, rgba(60, 194, 212, 0.14), transparent 26%),
        linear-gradient(135deg, rgba(13, 24, 48, 0.98), rgba(9, 15, 28, 0.98));
    border: 1px solid #1A2540;
    border-radius: 22px;
    padding: 1.6rem 1.8rem;
    margin-bottom: 1.25rem;
    box-shadow: 0 14px 34px rgba(0,0,0,0.26);
}
.platform-kicker {
    color: #66C5D4 !important;
    font-size: 0.76rem;
    letter-spacing: 3px;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 0.7rem;
}
.platform-headline {
    color: #F2F5FB !important;
    font-size: 2.15rem;
    line-height: 1.08;
    margin: 0;
    font-weight: 800;
}
.platform-copy {
    color: #9EB0C8 !important;
    font-size: 1rem;
    line-height: 1.6;
    margin-top: 0.85rem;
    margin-bottom: 0;
    max-width: 780px;
}
.platform-card {
    background: linear-gradient(160deg, #0D1220, #0A0E18);
    border: 1px solid #1A2540;
    border-radius: 18px;
    padding: 1.1rem 1.15rem;
    min-height: 200px;
    box-shadow: 0 10px 24px rgba(0,0,0,0.18);
}
.platform-card h4 {
    color: #F2F5FB !important;
    font-size: 1.02rem;
    margin-bottom: 0.55rem;
}
.platform-card p {
    color: #95A4BA !important;
    font-size: 0.92rem;
    line-height: 1.55;
    margin-bottom: 0.7rem;
}
.platform-chip {
    display: inline-block;
    margin: 0.2rem 0.32rem 0 0;
    padding: 0.32rem 0.58rem;
    border-radius: 999px;
    background: #101A2A;
    border: 1px solid #243552;
    color: #D5DDE9 !important;
    font-size: 0.74rem;
    letter-spacing: 0.04em;
}
.role-card {
    background: linear-gradient(160deg, #0D1220, #09111F);
    border: 1px solid #1A2540;
    border-radius: 16px;
    padding: 1rem 1.05rem;
    min-height: 170px;
}
.role-card h5 {
    color: #F2F5FB !important;
    font-size: 0.98rem;
    margin-bottom: 0.45rem;
}
.role-card p {
    color: #8FA0B7 !important;
    font-size: 0.88rem;
    line-height: 1.5;
}
[data-testid="stTabs"] {
    margin-top: 0.65rem;
}
[data-testid="stTabs"] [role="tablist"] {
    gap: 0.55rem;
    background: linear-gradient(145deg, #0B111E, #09101B);
    border: 1px solid #1A2540;
    border-radius: 18px;
    padding: 0.45rem;
}
[data-testid="stTabs"] [role="tab"] {
    height: 52px;
    border-radius: 14px;
    padding: 0 1rem;
    background: transparent;
    border: 1px solid transparent;
    color: #8FA0B7 !important;
    font-weight: 700;
}
[data-testid="stTabs"] [role="tab"][aria-selected="true"] {
    background: linear-gradient(135deg, rgba(212, 175, 80, 0.18), rgba(160, 120, 48, 0.12));
    border: 1px solid rgba(212, 175, 80, 0.45);
    color: #F5E8BC !important;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03), 0 8px 18px rgba(0,0,0,0.16);
}
.workspace-hero {
    background:
        radial-gradient(circle at top right, rgba(201, 168, 76, 0.18), transparent 28%),
        linear-gradient(135deg, #0D1830, #08111E);
    border: 1px solid #1A2540;
    border-radius: 22px;
    padding: 1.35rem 1.5rem;
    margin-bottom: 1rem;
    box-shadow: 0 12px 28px rgba(0,0,0,0.22);
}
.workspace-kicker {
    color: #66C5D4 !important;
    font-size: 0.76rem;
    letter-spacing: 2.6px;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 0.55rem;
}
.workspace-title {
    color: #F2F5FB !important;
    font-size: 1.9rem;
    line-height: 1.08;
    font-weight: 800;
    margin: 0;
}
.workspace-copy {
    color: #99AAC1 !important;
    font-size: 0.96rem;
    line-height: 1.6;
    margin-top: 0.75rem;
    margin-bottom: 0;
    max-width: 760px;
}
.context-panel {
    background: linear-gradient(160deg, #0C1220, #09111D);
    border: 1px solid #1A2540;
    border-radius: 18px;
    padding: 1rem 1.1rem;
    margin-bottom: 1rem;
}
.context-panel h4 {
    color: #F2F5FB !important;
    margin-bottom: 0.35rem;
    font-size: 1rem;
}
.context-panel p {
    color: #8FA0B7 !important;
    margin-bottom: 0;
    font-size: 0.91rem;
    line-height: 1.55;
}
</style>
""", unsafe_allow_html=True)


def render_platform_home():
    if BRAND_WORDMARK_PATH.exists():
        st.image(str(BRAND_WORDMARK_PATH), width=320)

    st.markdown(
        """
        <div class="platform-hero">
            <div class="platform-kicker">Platform Blueprint</div>
            <h1 class="platform-headline">Map-first field execution, coaching, recognition, and reporting in one system.</h1>
            <p class="platform-copy">
                Lumino is evolving from a routing tool into a full field performance platform. The map becomes the primary command
                surface for reps, while managers get shared reporting, competition, communication, and coaching tools built on the same activity data.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    metric_col1, metric_col2, metric_col3, metric_col4 = st.columns(4)
    metric_col1.metric("Core Roles", "6")
    metric_col2.metric("Primary Pillars", "4")
    metric_col3.metric("Phase 1 Focus", "Map + KPI")
    metric_col4.metric("Status", "Building")

    st.markdown('<div class="siq-section">Role Homepages</div>', unsafe_allow_html=True)
    role_cols = st.columns(4)
    role_cards = [
        ("Rep", "Open Today, work the map, disposition leads, schedule appointments, and trigger follow-up actions from one surface."),
        ("Manager", "Track live field activity, compare reps and teams, send coaching nudges, and drill into KPI reports."),
        ("Admin / Ops", "Manage routing rules, permissions, report templates, weather overlays, and platform settings."),
        ("Recruiter / Partner", "Own onboarding, documents, partner workflows, and designated competition or incentive actions."),
    ]
    for col, (title, copy) in zip(role_cols, role_cards):
        col.markdown(
            f"""
            <div class="role-card">
                <h5>{title}</h5>
                <p>{copy}</p>
            </div>
            """,
            unsafe_allow_html=True,
        )

    st.markdown('<div class="siq-section">Product Pillars</div>', unsafe_allow_html=True)
    pillar_cols = st.columns(2)
    pillar_specs = [
        (
            "Field Ops",
            "Canvassing map, area assignment, homeowner context, appointments, tasks, notes, files, weather overlays, and live rep progress.",
            ["Map", "Pins", "Assignments", "Appointments", "Weather"],
        ),
        (
            "Performance",
            "Leaderboards, competitions, incentives, KPI definitions, badges, and role-aware scorecards built from shared event data.",
            ["Leaderboards", "Competitions", "Badges", "KPIs", "Scorecards"],
        ),
        (
            "Social + Coaching",
            "Profiles, messaging, announcement channels, Enzy assistant chats, direct nudges, and recognition surfaces across the org.",
            ["Profiles", "Messages", "Announcements", "Bots", "Recognition"],
        ),
        (
            "Enablement",
            "Media library tracking, recruiting and onboarding, business cards, surveys, and downstream performance attribution.",
            ["Library", "Recruiting", "Onboarding", "Surveys", "Cards"],
        ),
    ]
    for idx, (title, copy, chips) in enumerate(pillar_specs):
        pillar_cols[idx % 2].markdown(
            f"""
            <div class="platform-card">
                <h4>{title}</h4>
                <p>{copy}</p>
                {''.join(f'<span class="platform-chip">{chip}</span>' for chip in chips)}
            </div>
            """,
            unsafe_allow_html=True,
        )

    st.markdown('<div class="siq-section">Phase 1 Build</div>', unsafe_allow_html=True)
    st.markdown(
        """
        1. Rebrand the shell to Lumino and establish platform navigation.
        2. Turn the rep workflow into a map-first turf experience.
        3. Build a KPI/reporting foundation that can power leaderboards and competitions.
        4. Add profile and recognition surfaces that make performance visible.
        """
    )
    st.info(
        "Blueprint saved in docs/platform_overhaul_blueprint.md. This is the planning anchor for the next implementation passes."
    )


def profile_badges_for_user(user_row):
    role = str((user_row or {}).get("role") or "").lower()
    badges = []
    if role in {"owner", "admin"}:
        badges.append("Org Builder")
    if role == "manager":
        badges.append("Field Coach")
    if role == "rep":
        badges.append("Closer")
    if (user_row or {}).get("is_current_user"):
        badges.append("You")
    if not badges:
        badges.append("Team Member")
    return badges


def render_people_hub(current_app_user, auth_context):
    st.markdown('<div class="siq-section">People</div>', unsafe_allow_html=True)
    st.markdown("Profiles bring recognition, contact actions, and role context into one place.")

    rep_rows = get_rep_options(auth_context=auth_context) if auth_context else []
    seen_ids = set()
    people_rows = []

    if current_app_user:
        people_rows.append(
            {
                "id": current_app_user.get("id"),
                "full_name": current_app_user.get("full_name") or current_app_user.get("email") or "Current User",
                "email": current_app_user.get("email"),
                "role": current_app_user.get("role"),
                "phone": "",
                "is_current_user": True,
            }
        )
        seen_ids.add(current_app_user.get("id"))

    for rep in rep_rows:
        if rep.get("id") in seen_ids:
            continue
        people_rows.append(
            {
                "id": rep.get("id"),
                "full_name": rep.get("full_name") or rep.get("email") or rep.get("id"),
                "email": rep.get("email"),
                "role": rep.get("role"),
                "phone": "",
                "is_current_user": False,
            }
        )
        seen_ids.add(rep.get("id"))

    if not people_rows:
        st.info("People profiles will populate once organization members are available.")
        return

    search_term = st.text_input("Search People", placeholder="Find a rep, manager, or admin")
    role_filter = st.selectbox("Role Filter", ["All Roles", "Rep", "Manager", "Admin", "Owner"])

    filtered_people = []
    for person in people_rows:
        haystack = " ".join(
            str(value or "") for value in [person.get("full_name"), person.get("email"), person.get("role")]
        ).lower()
        if search_term and search_term.lower() not in haystack:
            continue
        if role_filter != "All Roles" and str(person.get("role") or "").lower() != role_filter.lower():
            continue
        filtered_people.append(person)

    metric_cols = st.columns(4)
    metric_cols[0].metric("Profiles", len(filtered_people))
    metric_cols[1].metric("Reps", sum(1 for person in filtered_people if str(person.get("role") or "").lower() == "rep"))
    metric_cols[2].metric("Managers", sum(1 for person in filtered_people if str(person.get("role") or "").lower() == "manager"))
    metric_cols[3].metric("Admins / Owners", sum(1 for person in filtered_people if str(person.get("role") or "").lower() in {"admin", "owner"}))

    for index in range(0, len(filtered_people), 3):
        row_cols = st.columns(3)
        for col, person in zip(row_cols, filtered_people[index:index + 3]):
            badges = profile_badges_for_user(person)
            badge_html = "".join(f'<span class="platform-chip">{badge}</span>' for badge in badges)
            person_name = person.get("full_name") or "Unnamed User"
            person_role = str(person.get("role") or "member").replace("_", " ").title()
            email = person.get("email") or "No email on file"
            col.markdown(
                f"""
                <div class="platform-card">
                    <h4>{person_name}</h4>
                    <p>{person_role}<br/>{email}</p>
                    {badge_html}
                </div>
                """,
                unsafe_allow_html=True,
            )
            action_col1, action_col2 = col.columns(2)
            if person.get("email"):
                action_col1.link_button("Email", f"mailto:{person['email']}", use_container_width=True)
            else:
                action_col1.button("Email", disabled=True, key=f"disabled_email_{person['id']}")
            action_col2.button("View Profile", key=f"profile_{person['id']}", use_container_width=True)

    st.markdown('<div class="siq-section">Profile Surfaces</div>', unsafe_allow_html=True)
    profile_preview = pd.DataFrame(
        [
            {
                "User": person.get("full_name") or person.get("email"),
                "Role": str(person.get("role") or "member").replace("_", " ").title(),
                "Badges": ", ".join(profile_badges_for_user(person)),
                "Reports": "Leaderboard, personal KPIs, media progress",
                "Media": "Training videos, docs, links",
            }
            for person in filtered_people
        ]
    )
    st.dataframe(profile_preview, use_container_width=True, hide_index=True)


def render_performance_hub(all_results, execution_state, current_app_user, auth_context):
    st.markdown('<div class="siq-section">Performance</div>', unsafe_allow_html=True)
    st.markdown("Leaderboard, report builder, and competition foundations now sit on top of the same field activity data.")

    queue_results = all_results or []
    total_stops = len(queue_results)
    total_doors = sum(result.get("doors_to_knock", 0) for result in queue_results)

    interested = 0
    callbacks = 0
    not_home = 0
    not_interested = 0
    completed = 0
    for result in queue_results:
        property_id = make_property_id("primary_stop", result.get("address"))
        entry = (execution_state or {}).get(property_id, {})
        status_text = str(entry.get("status") or "").lower()
        route_status = str(result.get("route_run_status") or "").lower()
        if route_status == "completed":
            completed += 1
        if "interested" in status_text:
            interested += 1
        elif "callback" in status_text:
            callbacks += 1
        elif "not home" in status_text:
            not_home += 1
        elif "not interested" in status_text:
            not_interested += 1

    perf_cols = st.columns(5)
    perf_cols[0].metric("Stops Loaded", total_stops)
    perf_cols[1].metric("Completed", completed)
    perf_cols[2].metric("Interested", interested)
    perf_cols[3].metric("Callbacks", callbacks)
    perf_cols[4].metric("Doors", total_doors)

    leaderboard_rows = []
    rep_rows = get_rep_options(auth_context=auth_context) if auth_context else []
    current_name = None
    if current_app_user:
        current_name = current_app_user.get("full_name") or current_app_user.get("email") or "You"

    if current_name:
        leaderboard_rows.append(
            {
                "Rank": 1,
                "User": current_name,
                "KPI": "Interested Leads",
                "Value": interested,
                "Badges": "Closer, In Field",
            }
        )
    for idx, rep in enumerate(rep_rows[:5], start=2 if current_name else 1):
        leaderboard_rows.append(
            {
                "Rank": idx,
                "User": rep.get("full_name") or rep.get("email") or rep.get("id"),
                "KPI": "Doors Knocked",
                "Value": max(total_doors - ((idx - 1) * 2), 0),
                "Badges": "Team Member",
            }
        )

    leaderboard_df = pd.DataFrame(leaderboard_rows)
    report_templates_df = pd.DataFrame(
        [
            {"Report": "Daily Field Summary", "Type": "Multi-column", "Category": "Operations", "Shared": "Managers"},
            {"Report": "Appointment Trend", "Type": "Trend", "Category": "Performance", "Shared": "Leaders"},
            {"Report": "Rep Activity Breakdown", "Type": "Leaderboard", "Category": "People", "Shared": "Admins"},
        ]
    )
    competition_df = pd.DataFrame(
        [
            {"Competition": "Interested Lead Sprint", "Scope": "Individual", "Metric": "Interested Leads", "Status": "Draft"},
            {"Competition": "Team Turf Battle", "Scope": "Group", "Metric": "Doors Knocked", "Status": "Draft"},
            {"Competition": "Callback Conversion Push", "Scope": "Individual", "Metric": "Callbacks Booked", "Status": "Draft"},
        ]
    )

    leaderboard_col, reports_col = st.columns(2, gap="large")
    with leaderboard_col:
        st.markdown("#### Leaderboard Preview")
        if leaderboard_df.empty:
            st.info("Leaderboard data will populate as reps work routes and submit outcomes.")
        else:
            st.dataframe(leaderboard_df, use_container_width=True, hide_index=True)
    with reports_col:
        st.markdown("#### Report Builder Preview")
        st.dataframe(report_templates_df, use_container_width=True, hide_index=True)

    st.markdown("#### Competition Builder Preview")
    st.dataframe(competition_df, use_container_width=True, hide_index=True)


def render_workspace_shell(workspace_mode, all_results, execution_state):
    if workspace_mode == "Manager View":
        title = "Manager Workspace"
        kicker = "Operate"
        copy = (
            "Load lead pools, analyze lists, shape territories, and assign polished route drafts without leaving the main workflow."
        )
        primary_metric = len(all_results or [])
        primary_label = "Leads In Workspace"
        secondary_metric = sum(result.get("doors_to_knock", 0) for result in (all_results or []))
        secondary_label = "Potential Doors"
        tertiary_metric = sum(1 for result in (all_results or []) if result.get("priority_score", 0) >= 2)
        tertiary_label = "High Priority"
        fourth_metric = "Ready"
        fourth_label = "Draft Status"
    else:
        pending = 0
        interested = 0
        for result in all_results or []:
            property_id = make_property_id("primary_stop", result.get("address"))
            entry = (execution_state or {}).get(property_id, {})
            if str(result.get("route_run_status") or "pending").lower() == "pending":
                pending += 1
            if "interested" in str(entry.get("status") or "").lower():
                interested += 1
        title = "Rep Turf"
        kicker = "Execute"
        copy = (
            "Open your assigned turf, focus the next home, disposition quickly, and keep field notes tight while you move."
        )
        primary_metric = len(all_results or [])
        primary_label = "Stops Loaded"
        secondary_metric = pending
        secondary_label = "Pending Stops"
        tertiary_metric = interested
        tertiary_label = "Interested Leads"
        fourth_metric = "Live"
        fourth_label = "Field Status"

    st.markdown(
        f"""
        <div class="workspace-hero">
            <div class="workspace-kicker">{kicker}</div>
            <h2 class="workspace-title">{title}</h2>
            <p class="workspace-copy">{copy}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    summary_cols = st.columns(4)
    summary_cols[0].metric(primary_label, primary_metric)
    summary_cols[1].metric(secondary_label, secondary_metric)
    summary_cols[2].metric(tertiary_label, tertiary_metric)
    summary_cols[3].metric(fourth_label, fourth_metric)


def render_context_shell(title, copy, chips):
    st.markdown(
        f"""
        <div class="context-panel">
            <h4>{title}</h4>
            <p>{copy}</p>
            {''.join(f'<span class="platform-chip">{chip}</span>' for chip in chips)}
        </div>
        """,
        unsafe_allow_html=True,
    )


def auto_load_rep_draft_if_available(current_app_user, auth_context):
    if not current_app_user or not auth_context:
        return
    if st.session_state.get("rep_draft_autoload_attempted"):
        return
    if st.session_state.get("all_results"):
        return

    st.session_state["rep_draft_autoload_attempted"] = True
    draft_rows = get_route_drafts(auth_context=auth_context)
    if not draft_rows:
        return

    current_user_id = current_app_user.get("id")
    preferred_drafts = [
        draft for draft in draft_rows
        if draft.get("assigned_rep_id") == current_user_id and draft.get("status") in {"assigned", "accepted", "draft"}
    ]
    chosen_draft = preferred_drafts[0] if preferred_drafts else draft_rows[0]
    draft_results = load_route_draft_results(chosen_draft["id"], auth_context=auth_context)
    if not draft_results:
        return

    st.session_state["all_results"] = draft_results
    st.session_state["selected_route_addresses"] = {result["address"] for result in draft_results}
    for result in draft_results:
        st.session_state[f'chk_{result["address"]}'] = True
    st.session_state["current_route_draft_id"] = chosen_draft["id"]
    st.session_state["current_route_draft_name"] = chosen_draft["name"]
    st.session_state["active_route_run"] = None
    save_app_snapshot(
        all_results=draft_results,
        route_execution=st.session_state.get("route_execution", {}),
    )


def render_empty_rep_turf_state():
    st.markdown('<div class="siq-section">No Turf Loaded</div>', unsafe_allow_html=True)
    st.info(
        "No assigned route draft is loaded yet. Open a saved draft in the Turf tab to start the live map view."
    )


def render_blank_rep_map(auth_context):
    st.markdown('<div class="siq-section">Blank Turf Map</div>', unsafe_allow_html=True)
    st.markdown(
        "Start from your current location, then either load a route draft or drop a field pin to create a new knock."
    )

    geolocation_result = geolocation_picker(
        key="blank_turf_live_geolocation",
        label="Center Map On My Location",
    )
    if geolocation_result and not geolocation_result.get("error"):
        st.session_state["turf_live_lat"] = geolocation_result["latitude"]
        st.session_state["turf_live_lng"] = geolocation_result["longitude"]
    elif geolocation_result and geolocation_result.get("error"):
        st.warning(f"Location error: {geolocation_result['error']}")

    current_location = None
    if (
        st.session_state.get("turf_live_lat") is not None
        and st.session_state.get("turf_live_lng") is not None
    ):
        current_location = {
            "latitude": st.session_state["turf_live_lat"],
            "longitude": st.session_state["turf_live_lng"],
        }

    action_col1, action_col2 = st.columns(2)
    if action_col1.button("Load Route Draft", use_container_width=True):
        st.session_state["show_rep_route_drafts"] = not st.session_state.get("show_rep_route_drafts", False)
    if action_col2.button("Drop Pin At My Location", use_container_width=True, disabled=not current_location):
        st.session_state["turf_dropped_pin"] = current_location
        added_result = add_ad_hoc_pin_result(
            current_location["latitude"],
            current_location["longitude"],
        )
        if added_result:
            st.session_state["turf_pin_feedback"] = f"Added field knock for {added_result['address']}."
            st.rerun()
        st.warning("Could not match your location to an address.")

    if st.session_state.get("show_rep_route_drafts"):
        draft_rows = get_route_drafts(auth_context=auth_context) if auth_context else []
        if draft_rows:
            draft_options = {
                f"{draft['name']} · {draft['status']} · "
                f"{(draft.get('app_users') or {}).get('full_name') or 'Unassigned'} · "
                f"{draft['created_at'][:10]}": draft["id"]
                for draft in draft_rows
            }
            selected_draft_label = st.selectbox(
                "Saved Route Drafts",
                options=list(draft_options.keys()),
                key="rep_saved_draft_select",
            )
            if st.button("Open Selected Draft", use_container_width=True):
                draft_results = load_route_draft_results(
                    draft_options[selected_draft_label],
                    auth_context=auth_context,
                )
                if draft_results:
                    st.session_state["all_results"] = draft_results
                    st.session_state["selected_route_addresses"] = {
                        result["address"] for result in draft_results
                    }
                    st.session_state["current_route_draft_id"] = draft_options[selected_draft_label]
                    st.session_state["current_route_draft_name"] = selected_draft_label.split(" · ")[0]
                    st.session_state["active_route_run"] = None
                    st.session_state["active_property_id"] = None
                    save_app_snapshot(
                        all_results=draft_results,
                        route_execution=st.session_state.get("route_execution", {}),
                    )
                    st.rerun()
        else:
            st.info("No saved drafts are available for this organization yet.")

    blank_layers = []
    if current_location:
        blank_layers.append(
            pdk.Layer(
                "ScatterplotLayer",
                id="blank-user-location",
                data=pd.DataFrame([{"lat": current_location["latitude"], "lng": current_location["longitude"]}]),
                get_position="[lng, lat]",
                get_radius=40,
                get_fill_color=[32, 197, 255, 220],
                get_line_color=[255, 255, 255, 255],
                get_line_width=3,
                pickable=False,
                stroked=True,
                filled=True,
                radius_min_pixels=12,
                radius_max_pixels=28,
            )
        )
    dropped_pin = st.session_state.get("turf_dropped_pin")
    if dropped_pin:
        blank_layers.append(
            pdk.Layer(
                "ScatterplotLayer",
                id="blank-dropped-pin",
                data=pd.DataFrame([{"lat": dropped_pin["latitude"], "lng": dropped_pin["longitude"]}]),
                get_position="[lng, lat]",
                get_radius=40,
                get_fill_color=[225, 29, 72, 235],
                get_line_color=[255, 255, 255, 255],
                get_line_width=4,
                pickable=False,
                stroked=True,
                filled=True,
                radius_min_pixels=12,
                radius_max_pixels=28,
            )
        )

    if current_location or dropped_pin:
        center = dropped_pin or current_location
        blank_view = pdk.ViewState(
            latitude=center["latitude"],
            longitude=center["longitude"],
            zoom=18,
            pitch=45,
            bearing=-12,
            controller=True,
        )
        st.pydeck_chart(
            pdk.Deck(
                layers=blank_layers,
                initial_view_state=blank_view,
                map_provider="carto",
                map_style="light_no_labels",
            ),
            key="blank_rep_map",
            use_container_width=True,
            height=760,
        )
    else:
        st.info("Use your current location to center the map, then load a draft or drop a field pin.")

    if st.session_state.get("turf_pin_feedback"):
        st.info(st.session_state["turf_pin_feedback"])


def render_rep_turf_mode(
    execution_results,
    execution_properties,
    auth_context,
    route_preview_df=None,
):
    st.markdown('<div class="siq-section">Turf Mode</div>', unsafe_allow_html=True)
    st.markdown(
        "Map first. Center on the rep, drop a pin when needed, snap to the closest known home, and save what happened before leaving the street."
    )

    geolocation_result = geolocation_picker(
        key="turf_live_geolocation",
        label="Center Map On My Location",
    )
    if geolocation_result and not geolocation_result.get("error"):
        st.session_state["turf_live_lat"] = geolocation_result["latitude"]
        st.session_state["turf_live_lng"] = geolocation_result["longitude"]
    elif geolocation_result and geolocation_result.get("error"):
        st.warning(f"Location error: {geolocation_result['error']}")

    turf_user_location = None
    if (
        st.session_state.get("turf_live_lat") is not None
        and st.session_state.get("turf_live_lng") is not None
    ):
        turf_user_location = {
            "latitude": st.session_state["turf_live_lat"],
            "longitude": st.session_state["turf_live_lng"],
        }

    if execution_properties and not st.session_state.get("active_property_id"):
        if turf_user_location:
            nearest_property, _ = find_nearest_turf_property(
                execution_properties,
                turf_user_location["latitude"],
                turf_user_location["longitude"],
                max_distance_miles=None,
            )
            st.session_state["active_property_id"] = (
                nearest_property["property_id"] if nearest_property else execution_properties[0]["property_id"]
            )
        else:
            st.session_state["active_property_id"] = execution_properties[0]["property_id"]

    completed_count = sum(
        1 for result in execution_results if str(result.get("route_run_status") or "").lower() == "completed"
    )
    skipped_count = sum(
        1 for result in execution_results if str(result.get("route_run_status") or "").lower() == "skipped"
    )
    callback_count = 0
    interested_count = 0
    not_home_count = 0
    for property_record in execution_properties:
        execution_entry = st.session_state["route_execution"].get(property_record["property_id"], {})
        status_text = str(execution_entry.get("status") or "").lower()
        if "callback" in status_text:
            callback_count += 1
        if "interested" in status_text:
            interested_count += 1
        if "not home" in status_text:
            not_home_count += 1

    pending_navigation_results = [
        result
        for result in execution_results
        if str(result.get("route_run_status") or "pending").lower() == "pending"
    ]
    next_property_id = next_pending_property_id(execution_results)

    control_col1, control_col2, control_col3, control_col4 = st.columns(4)
    if control_col1.button("Focus Next Pending", use_container_width=True):
        if next_property_id:
            st.session_state["active_property_id"] = next_property_id
            st.rerun()
    if control_col2.button("Focus Nearest House", use_container_width=True, disabled=not turf_user_location):
        nearest_property, nearest_distance = find_nearest_turf_property(
            execution_properties,
            turf_user_location["latitude"],
            turf_user_location["longitude"],
            max_distance_miles=None,
        ) if turf_user_location else (None, None)
        if nearest_property:
            st.session_state["active_property_id"] = nearest_property["property_id"]
            if nearest_distance is not None:
                st.session_state["turf_pin_feedback"] = (
                    f"Focused {nearest_property['address']} ({nearest_distance:.2f} mi away)."
                )
            st.rerun()
    if control_col3.button("Drop Pin At My Location", use_container_width=True, disabled=not turf_user_location):
        nearest_property, nearest_distance = find_nearest_turf_property(
            execution_properties,
            turf_user_location["latitude"],
            turf_user_location["longitude"],
            max_distance_miles=None,
        ) if turf_user_location else (None, None)
        st.session_state["turf_dropped_pin"] = turf_user_location
        if nearest_property:
            st.session_state["active_property_id"] = nearest_property["property_id"]
            st.session_state["turf_pin_feedback"] = (
                f"Pinned your location and matched the closest home: {nearest_property['address']}"
                + (f" ({nearest_distance:.2f} mi)." if nearest_distance is not None else ".")
            )
        else:
            st.session_state["turf_pin_feedback"] = "Pinned your location, but no nearby home could be matched yet."
        st.rerun()
    if control_col4.button("Clear Pin", use_container_width=True, disabled=not st.session_state.get("turf_dropped_pin")):
        st.session_state.pop("turf_dropped_pin", None)
        st.session_state.pop("turf_pin_feedback", None)
        st.rerun()

    with st.expander("Manual Pin Drop", expanded=False):
        manual_col1, manual_col2, manual_col3 = st.columns([1, 1, 1.2])
        manual_lat = manual_col1.number_input(
            "Pin Latitude",
            value=float(st.session_state.get("manual_pin_lat", st.session_state.get("turf_live_lat") or 0.0)),
            format="%.6f",
            key="manual_pin_lat",
        )
        manual_lng = manual_col2.number_input(
            "Pin Longitude",
            value=float(st.session_state.get("manual_pin_lng", st.session_state.get("turf_live_lng") or 0.0)),
            format="%.6f",
            key="manual_pin_lng",
        )
        if manual_col3.button("Drop Manual Pin", use_container_width=True):
            st.session_state["turf_dropped_pin"] = {"latitude": manual_lat, "longitude": manual_lng}
            nearest_property, nearest_distance = find_nearest_turf_property(
                execution_properties,
                manual_lat,
                manual_lng,
                max_distance_miles=None,
            )
            if nearest_property:
                st.session_state["active_property_id"] = nearest_property["property_id"]
                st.session_state["turf_pin_feedback"] = (
                    f"Manual pin matched to {nearest_property['address']}"
                    + (f" ({nearest_distance:.2f} mi)." if nearest_distance is not None else ".")
                )
            else:
                st.session_state["turf_pin_feedback"] = "Manual pin saved, but no nearby home could be matched yet."
            st.rerun()

    if st.session_state.get("turf_pin_feedback"):
        st.info(st.session_state["turf_pin_feedback"])

    active_property_id = render_turf_map(
        execution_properties,
        execution_results,
        st.session_state["route_execution"],
        active_property_id=st.session_state.get("active_property_id"),
        user_location=turf_user_location,
        dropped_pin=st.session_state.get("turf_dropped_pin"),
        height=760,
    )
    if active_property_id:
        st.session_state["active_property_id"] = active_property_id

    turf_metrics = st.columns(5)
    turf_metrics[0].metric("Stops", len(execution_results))
    turf_metrics[1].metric("Pending", len(pending_navigation_results))
    turf_metrics[2].metric("Interested", interested_count)
    turf_metrics[3].metric("Callbacks", callback_count)
    turf_metrics[4].metric("Not Home / Skipped", not_home_count + skipped_count)

    focus_col, support_col = st.columns([1.4, 0.9], gap="large")
    with focus_col:
        focus_options = [property_record["property_id"] for property_record in execution_properties]
        focus_labels = {
            property_record["property_id"]: (
                f"Stop {property_record['route_stop_number']} · {property_record['property_type']} · {property_record['address']}"
            )
            for property_record in execution_properties
        }
        current_focus = st.session_state.get("active_property_id")
        if focus_options:
            if current_focus not in focus_options:
                current_focus = focus_options[0]
            selected_focus = st.selectbox(
                "Focused Building",
                options=focus_options,
                index=focus_options.index(current_focus),
                format_func=lambda option: focus_labels.get(option, option),
                key="focused_stop_picker",
            )
            st.session_state["active_property_id"] = selected_focus

        active_property = next(
            (
                property_record
                for property_record in execution_properties
                if property_record.get("property_id") == st.session_state.get("active_property_id")
            ),
            execution_properties[0] if execution_properties else None,
        )
        active_result = next(
            (
                result for result in execution_results
                if active_property and result.get("address") == active_property.get("source_result_address")
            ),
            execution_results[0] if execution_results else None,
        )

        if active_property:
            active_property_id = active_property["property_id"]
            active_entry = st.session_state["route_execution"][active_property_id]
            synthetic_result = dict(active_result or {})
            if active_property.get("property_type") != "Primary Stop":
                synthetic_result["route_run_status"] = "completed" if active_entry.get("status") else "pending"
            active_status = route_status_meta(synthetic_result, active_entry)

            st.markdown(f"### Stop {active_property.get('route_stop_number')}")
            st.markdown(f"**{active_property.get('address')}**")
            st.caption(
                f"{active_property.get('property_type')} · {active_status['label']} · "
                f"{get_priority_meta(active_property.get('priority_score', 0))['label']} · "
                f"{active_property.get('category', 'Unknown')}"
            )

            active_distance = None
            if turf_user_location:
                active_distance = turf_distance_miles(
                    turf_user_location["latitude"],
                    turf_user_location["longitude"],
                    active_property.get("lat"),
                    active_property.get("lng"),
                )
            pin_distance = None
            dropped_pin = st.session_state.get("turf_dropped_pin")
            if dropped_pin:
                pin_distance = turf_distance_miles(
                    dropped_pin["latitude"],
                    dropped_pin["longitude"],
                    active_property.get("lat"),
                    active_property.get("lng"),
                )
            distance_bits = []
            if active_distance is not None:
                distance_bits.append(f"{active_distance:.2f} mi from you")
            if pin_distance is not None:
                distance_bits.append(f"{pin_distance:.2f} mi from dropped pin")
            if distance_bits:
                st.caption(" · ".join(distance_bits))

            property_meta_col1, property_meta_col2 = st.columns(2)
            property_meta_col1.metric("Home Value", active_property.get("price_display", "N/A"))
            property_meta_col2.metric("Size", active_property.get("sqft_display", "N/A"))
            property_meta_col3, property_meta_col4 = st.columns(2)
            property_meta_col3.metric(
                "Beds / Baths",
                f"{active_property.get('beds') or '?'} / {active_property.get('baths') or '?'}",
            )
            property_meta_col4.metric("Sold", active_property.get("sold_date", "Unknown"))
            detail_bits = []
            if active_property.get("zipcode"):
                detail_bits.append(f"ZIP {active_property['zipcode']}")
            if active_property.get("parking_address"):
                detail_bits.append(f"Park at {active_property['parking_address']}")
            if active_property.get("sun_hours_display"):
                detail_bits.append(f"{active_property['sun_hours_display']} sun hrs")
            st.caption(" · ".join(detail_bits))

            active_links = navigation_links(active_property)
            focus_nav_col1, focus_nav_col2, focus_nav_col3 = st.columns(3)
            focus_nav_col1.link_button("Google", active_links["google"], use_container_width=True)
            focus_nav_col2.link_button("Apple", active_links["apple"], use_container_width=True)
            focus_nav_col3.link_button("Waze", active_links["waze"], use_container_width=True)

            st.info(active_entry.get("best_follow_up_time") or "No appointment scheduled yet.")

            crm_stage_options = [
                "New Lead",
                "Attempting Contact",
                "Contacted",
                "Appointment Set",
                "Quoted",
                "Negotiation",
                "Closed Won",
                "Closed Lost",
            ]
            crm_action_options = [
                "",
                "Call Back",
                "Text Follow-Up",
                "Send Proposal",
                "Confirm Appointment",
                "Knock Again",
                "Manager Review",
            ]
            crm_priority_options = ["Low", "Medium", "High", "Urgent"]
            appointment_status_options = ["Not Set", "Scheduled", "Confirmed", "Completed", "Rescheduled", "Canceled"]

            crm_col1, crm_col2 = st.columns(2)
            active_entry["lead_stage"] = crm_col1.selectbox(
                "Lead Stage",
                options=crm_stage_options,
                index=crm_stage_options.index(active_entry.get("lead_stage", "New Lead"))
                if active_entry.get("lead_stage", "New Lead") in crm_stage_options
                else 0,
                key=f"crm_stage_{active_property_id}",
            )
            active_entry["next_action"] = crm_col2.selectbox(
                "Next Action",
                options=crm_action_options,
                index=crm_action_options.index(active_entry.get("next_action", ""))
                if active_entry.get("next_action", "") in crm_action_options
                else 0,
                key=f"crm_next_action_{active_property_id}",
            )

            disposition_col1, disposition_col2 = st.columns(2)
            if disposition_col1.button("Interested", key=f"quick_interested_{active_property_id}", use_container_width=True):
                if apply_quick_disposition(
                    active_result or active_property,
                    st.session_state["route_execution"],
                    property_id_override=active_property_id,
                    status_label="Interested",
                    route_status="completed",
                    outcome="interested",
                    interest_level="Hot",
                    auth_context=auth_context,
                ):
                    active_entry["lead_stage"] = "Contacted"
                    append_activity_event(active_entry, "Disposition", "Marked as interested in the field.")
                    save_app_snapshot(
                        all_results=st.session_state.get("all_results", []),
                        route_execution=st.session_state["route_execution"],
                    )
                    st.session_state["active_property_id"] = next_pending_property_id(execution_results) or active_property_id
                    st.rerun()
            if disposition_col2.button("Callback", key=f"quick_callback_{active_property_id}", use_container_width=True):
                if apply_quick_disposition(
                    active_result or active_property,
                    st.session_state["route_execution"],
                    property_id_override=active_property_id,
                    status_label="Callback",
                    route_status="completed",
                    outcome="callback",
                    interest_level="Warm",
                    auth_context=auth_context,
                ):
                    active_entry["lead_stage"] = "Contacted"
                    active_entry["next_action"] = active_entry.get("next_action") or "Call Back"
                    append_activity_event(active_entry, "Disposition", "Marked for callback.")
                    save_app_snapshot(
                        all_results=st.session_state.get("all_results", []),
                        route_execution=st.session_state["route_execution"],
                    )
                    st.session_state["active_property_id"] = next_pending_property_id(execution_results) or active_property_id
                    st.rerun()

            disposition_col3, disposition_col4, disposition_col5 = st.columns(3)
            if disposition_col3.button("Not Home", key=f"quick_nothome_{active_property_id}", use_container_width=True):
                next_not_home = next_not_home_status(active_entry.get("status"))
                if apply_quick_disposition(
                    active_result or active_property,
                    st.session_state["route_execution"],
                    property_id_override=active_property_id,
                    status_label=next_not_home,
                    route_status="completed",
                    outcome="not_home",
                    auth_context=auth_context,
                ):
                    append_activity_event(active_entry, "Disposition", f"Marked {next_not_home}.")
                    save_app_snapshot(
                        all_results=st.session_state.get("all_results", []),
                        route_execution=st.session_state["route_execution"],
                    )
                    st.session_state["active_property_id"] = next_pending_property_id(execution_results) or active_property_id
                    st.rerun()
            if disposition_col4.button("Not Interested", key=f"quick_notinterested_{active_property_id}", use_container_width=True):
                if apply_quick_disposition(
                    active_result or active_property,
                    st.session_state["route_execution"],
                    property_id_override=active_property_id,
                    status_label="Not Interested",
                    route_status="completed",
                    outcome="not_interested",
                    interest_level="Cold",
                    auth_context=auth_context,
                ):
                    active_entry["lead_stage"] = "Closed Lost"
                    append_activity_event(active_entry, "Disposition", "Marked as not interested.")
                    save_app_snapshot(
                        all_results=st.session_state.get("all_results", []),
                        route_execution=st.session_state["route_execution"],
                    )
                    st.session_state["active_property_id"] = next_pending_property_id(execution_results) or active_property_id
                    st.rerun()
            if disposition_col5.button("Skip", key=f"quick_skip_{active_property_id}", use_container_width=True):
                if apply_quick_disposition(
                    active_result or active_property,
                    st.session_state["route_execution"],
                    property_id_override=active_property_id,
                    status_label="",
                    route_status="skipped",
                    skipped_reason="Skipped in field",
                    auth_context=auth_context,
                ):
                    append_activity_event(active_entry, "Disposition", "Skipped in field.")
                    save_app_snapshot(
                        all_results=st.session_state.get("all_results", []),
                        route_execution=st.session_state["route_execution"],
                    )
                    st.session_state["active_property_id"] = next_pending_property_id(execution_results) or active_property_id
                    st.rerun()

            active_entry["homeowner_name"] = st.text_input(
                "Homeowner Name",
                value=active_entry["homeowner_name"],
                key=f"turf_name_{active_property_id}",
            )
            active_entry["phone"] = st.text_input(
                "Phone",
                value=active_entry["phone"],
                key=f"turf_phone_{active_property_id}",
            )
            active_entry["email"] = st.text_input(
                "Email",
                value=active_entry["email"],
                key=f"turf_email_{active_property_id}",
            )
            active_entry["best_follow_up_time"] = st.text_input(
                "Best Follow-Up Time",
                value=active_entry["best_follow_up_time"],
                key=f"turf_followup_{active_property_id}",
            )
            crm_task_col1, crm_task_col2 = st.columns(2)
            active_entry["task_due_date"] = crm_task_col1.text_input(
                "Task Due Date",
                value=active_entry.get("task_due_date", ""),
                placeholder="Apr 18, 2026",
                key=f"crm_task_due_{active_property_id}",
            )
            active_entry["task_priority"] = crm_task_col2.selectbox(
                "Task Priority",
                options=crm_priority_options,
                index=crm_priority_options.index(active_entry.get("task_priority", "Medium"))
                if active_entry.get("task_priority", "Medium") in crm_priority_options
                else 1,
                key=f"crm_task_priority_{active_property_id}",
            )
            active_entry["notes"] = st.text_area(
                "Field Notes",
                value=active_entry["notes"],
                key=f"turf_notes_{active_property_id}",
                height=120,
            )

            quick_contact_col1, quick_contact_col2, quick_contact_col3 = st.columns(3)
            phone_value = urllib.parse.quote(str(active_entry.get("phone") or ""))
            email_value = urllib.parse.quote(str(active_entry.get("email") or ""))
            address_value = urllib.parse.quote(str(active_property.get("address") or ""))
            quick_contact_col1.link_button(
                "Call",
                f"tel:{phone_value}" if phone_value else "https://example.com",
                use_container_width=True,
                disabled=not bool(phone_value),
            )
            quick_contact_col2.link_button(
                "Text",
                f"sms:{phone_value}" if phone_value else "https://example.com",
                use_container_width=True,
                disabled=not bool(phone_value),
            )
            quick_contact_col3.link_button(
                "Email",
                f"mailto:{email_value}?subject=Follow%20up%20for%20{address_value}" if email_value else "https://example.com",
                use_container_width=True,
                disabled=not bool(email_value),
            )

            activity_col1, activity_col2, activity_col3 = st.columns(3)
            if activity_col1.button("Log Call", key=f"log_call_{active_property_id}", use_container_width=True):
                append_activity_event(active_entry, "Call", "Logged an outbound call attempt.")
                if not active_entry.get("next_action"):
                    active_entry["next_action"] = "Call Back"
                save_app_snapshot(
                    all_results=st.session_state.get("all_results", []),
                    route_execution=st.session_state["route_execution"],
                )
                st.rerun()
            if activity_col2.button("Log Text", key=f"log_text_{active_property_id}", use_container_width=True):
                append_activity_event(active_entry, "Text", "Sent a follow-up text.")
                if active_entry.get("lead_stage") == "New Lead":
                    active_entry["lead_stage"] = "Attempting Contact"
                save_app_snapshot(
                    all_results=st.session_state.get("all_results", []),
                    route_execution=st.session_state["route_execution"],
                )
                st.rerun()
            if activity_col3.button("Create Task", key=f"create_task_{active_property_id}", use_container_width=True):
                task_summary = active_entry.get("next_action") or "Follow up"
                due_summary = active_entry.get("task_due_date") or "Open"
                append_activity_event(active_entry, "Task", f"{task_summary} task set for {due_summary}.")
                save_app_snapshot(
                    all_results=st.session_state.get("all_results", []),
                    route_execution=st.session_state["route_execution"],
                )
                st.rerun()

            st.markdown("#### Set Appointment")
            appointment_col1, appointment_col2 = st.columns(2)
            default_date = datetime.now().date()
            default_time = datetime.now().replace(minute=0, second=0, microsecond=0).time()
            appointment_date = appointment_col1.date_input(
                "Appointment Date",
                value=default_date,
                key=f"turf_appt_date_{active_property_id}",
            )
            appointment_time = appointment_col2.time_input(
                "Appointment Time",
                value=default_time,
                step=1800,
                key=f"turf_appt_time_{active_property_id}",
            )
            appointment_label = format_follow_up_slot(appointment_date, appointment_time)
            active_entry["appointment_status"] = st.selectbox(
                "Appointment Status",
                options=appointment_status_options,
                index=appointment_status_options.index(active_entry.get("appointment_status", "Not Set"))
                if active_entry.get("appointment_status", "Not Set") in appointment_status_options
                else 0,
                key=f"appt_status_{active_property_id}",
            )

            notes_action_col1, notes_action_col2 = st.columns(2)
            if notes_action_col1.button("Save Notes", key=f"save_notes_{active_property_id}", use_container_width=True):
                if sync_route_stop_details(active_result or active_property, active_entry, auth_context=auth_context):
                    append_activity_event(active_entry, "Notes", "Saved updated field notes.")
                    save_app_snapshot(
                        all_results=st.session_state.get("all_results", []),
                        route_execution=st.session_state["route_execution"],
                    )
                    st.success("Field notes saved.")
                else:
                    st.warning("Could not save stop details.")
            active_prompt = build_follow_up_prompt(active_property, active_entry)
            notes_action_col2.download_button(
                "Prompt",
                data=active_prompt,
                file_name=f"followup_prompt_{active_property_id.replace(':', '_')}.txt",
                mime="text/plain",
                use_container_width=True,
            )

            appt_action_col1, appt_action_col2 = st.columns(2)
            if appt_action_col1.button("Set Appointment", key=f"set_appt_{active_property_id}", use_container_width=True):
                active_entry["best_follow_up_time"] = appointment_label
                if not active_entry.get("interest_level"):
                    active_entry["interest_level"] = "Warm"
                active_entry["lead_stage"] = "Appointment Set"
                active_entry["appointment_status"] = "Scheduled"
                active_entry["next_action"] = "Confirm Appointment"
                note_line = f"Appointment scheduled for {appointment_label}"
                active_entry["notes"] = (
                    f"{active_entry['notes']}\n\n{note_line}".strip()
                    if active_entry.get("notes") and note_line not in active_entry["notes"]
                    else active_entry.get("notes") or note_line
                )
                append_activity_event(active_entry, "Appointment", note_line)
                if apply_quick_disposition(
                    active_result or active_property,
                    st.session_state["route_execution"],
                    property_id_override=active_property_id,
                    status_label="Callback",
                    route_status="completed",
                    outcome="callback",
                    interest_level="Warm",
                    auth_context=auth_context,
                ):
                    save_app_snapshot(
                        all_results=st.session_state.get("all_results", []),
                        route_execution=st.session_state["route_execution"],
                    )
                    st.session_state["active_property_id"] = next_pending_property_id(execution_results) or active_property_id
                    st.rerun()
                else:
                    st.warning("Could not save the appointment.")
            if appt_action_col2.button("Save Contact", key=f"save_contact_{active_property_id}", use_container_width=True):
                if sync_route_stop_details(active_result or active_property, active_entry, auth_context=auth_context):
                    append_activity_event(active_entry, "Contact", "Saved updated contact details.")
                    save_app_snapshot(
                        all_results=st.session_state.get("all_results", []),
                        route_execution=st.session_state["route_execution"],
                    )
                    st.success("Contact details saved.")
                else:
                    st.warning("Could not save contact details.")

            ics_data = build_appointment_ics(
                active_property.get("address"),
                active_entry.get("homeowner_name"),
                active_entry.get("best_follow_up_time") or appointment_label,
                active_entry.get("notes"),
            )
            st.download_button(
                "Download Calendar Invite",
                data=ics_data,
                file_name=f"lumino_appointment_{active_property_id.replace(':', '_')}.ics",
                mime="text/calendar",
                use_container_width=True,
            )

            activity_history = active_entry.get("activity_log") or []
            if activity_history:
                st.markdown("#### Recent Activity")
                st.dataframe(
                    pd.DataFrame(activity_history),
                    use_container_width=True,
                    hide_index=True,
                    height=220,
                )

    with support_col:
        if turf_user_location:
            st.caption(
                f"Current location: {turf_user_location['latitude']:.5f}, {turf_user_location['longitude']:.5f}"
            )
        dropped_pin = st.session_state.get("turf_dropped_pin")
        if dropped_pin:
            st.caption(f"Dropped pin: {dropped_pin['latitude']:.5f}, {dropped_pin['longitude']:.5f}")
        appointment_rows, follow_up_rows, hot_lead_rows, recent_activity_rows = crm_summary_rows(
            execution_results,
            st.session_state["route_execution"],
        )
        queue_rows = []
        for idx, result in enumerate(execution_results, start=1):
            property_id = make_property_id("primary_stop", result.get("address"))
            execution_entry = st.session_state["route_execution"].get(property_id, {})
            status_meta = route_status_meta(result, execution_entry)
            queue_rows.append(
                {
                    "Stop": idx,
                    "Address": result.get("address"),
                    "Status": status_meta["label"],
                    "Doors": result.get("doors_to_knock", 0),
                    "Stage": execution_entry.get("lead_stage") or "New Lead",
                }
            )

        st.markdown("#### Live Queue")
        st.dataframe(pd.DataFrame(queue_rows), use_container_width=True, hide_index=True, height=260)
        if appointment_rows:
            st.markdown("#### Upcoming Appointments")
            st.dataframe(pd.DataFrame(appointment_rows), use_container_width=True, hide_index=True, height=220)
        if follow_up_rows:
            st.markdown("#### Follow-Up Queue")
            st.dataframe(pd.DataFrame(follow_up_rows), use_container_width=True, hide_index=True, height=220)
        if hot_lead_rows:
            st.markdown("#### Hot Leads")
            st.dataframe(pd.DataFrame(hot_lead_rows), use_container_width=True, hide_index=True, height=180)
        if recent_activity_rows:
            with st.expander("Recent CRM Activity", expanded=False):
                st.dataframe(pd.DataFrame(recent_activity_rows), use_container_width=True, hide_index=True, height=240)
        if route_preview_df is not None:
            with st.expander("Route Order", expanded=False):
                st.dataframe(route_preview_df, use_container_width=True, hide_index=True)

api_key = GOOGLE_API_KEY

if "snapshot_loaded" not in st.session_state:
    snapshot = load_app_snapshot()
    if snapshot.get("route_execution") and "route_execution" not in st.session_state:
        st.session_state["route_execution"] = snapshot["route_execution"]
    st.session_state["last_snapshot_results_count"] = len(snapshot.get("all_results", []))
    st.session_state["snapshot_loaded"] = True

if "auth_session" not in st.session_state:
    st.session_state["auth_session"] = None
if "selected_org_id" not in st.session_state:
    st.session_state["selected_org_id"] = None

auth_context = None
current_app_user = None
current_memberships = []
auth_enabled = supabase_auth_enabled()
base_auth_context = None
if auth_enabled and st.session_state.get("auth_session"):
    session_payload = st.session_state["auth_session"]
    base_auth_context = {
        "access_token": session_payload.get("access_token"),
        "api_key": session_payload.get("api_key"),
        "user_id": (session_payload.get("user") or {}).get("id"),
    }
    current_app_user = get_current_app_user(auth_context=base_auth_context)
    if current_app_user:
        current_memberships = get_user_memberships(auth_context=base_auth_context)
        membership_ids = [item["organization_id"] for item in current_memberships if item.get("organization_id")]
        if membership_ids:
            default_org_id = (
                st.session_state.get("selected_org_id")
                or current_app_user.get("default_organization_id")
                or membership_ids[0]
            )
            if default_org_id not in membership_ids:
                default_org_id = membership_ids[0]
            st.session_state["selected_org_id"] = default_org_id
            auth_context = {
                **base_auth_context,
                "app_user_id": current_app_user["id"],
                "organization_id": default_org_id,
            }

with st.sidebar:
    if BRAND_WORDMARK_PATH.exists():
        st.image(str(BRAND_WORDMARK_PATH), width=220)
    else:
        st.markdown("## Lumino")
    st.markdown("*Field Performance Platform*")
    if auth_enabled:
        st.markdown("---")
        st.markdown("**Account**")
        if not st.session_state.get("auth_session"):
            with st.form("login_form", clear_on_submit=False):
                login_email = st.text_input("Email", key="login_email")
                login_password = st.text_input("Password", type="password", key="login_password")
                login_submitted = st.form_submit_button("Log In", use_container_width=True)
            if login_submitted:
                login_result = sign_in_with_password(login_email.strip(), login_password)
                if login_result.get("ok"):
                    login_result["api_key"] = (
                        os.getenv("SUPABASE_ANON_KEY", "").strip()
                        or os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
                        or os.getenv("SUPABASE_SECRET_KEY", "").strip()
                    )
                    st.session_state["auth_session"] = login_result
                    st.rerun()
                else:
                    st.error(login_result.get("error", "Could not sign in."))
        else:
            st.caption(current_app_user.get("email") if current_app_user else "Authenticated")
            if current_memberships:
                membership_labels = {
                    f"{item.get('organization_name') or item.get('organization_slug') or item['organization_id']} · {item.get('role', 'member')}": item["organization_id"]
                    for item in current_memberships
                }
                org_label = next(
                    (
                        label
                        for label, org_id in membership_labels.items()
                        if org_id == st.session_state.get("selected_org_id")
                    ),
                    next(iter(membership_labels)),
                )
                selected_org_label = st.selectbox(
                    "Organization",
                    options=list(membership_labels.keys()),
                    index=list(membership_labels.keys()).index(org_label),
                    key="org_switcher",
                )
                st.session_state["selected_org_id"] = membership_labels[selected_org_label]
            if st.button("Log Out", use_container_width=True):
                sign_out()
                st.session_state["auth_session"] = None
                st.session_state["selected_org_id"] = None
                st.rerun()
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

if base_auth_context and current_app_user and current_memberships and st.session_state.get("selected_org_id"):
    auth_context = {
        **base_auth_context,
        "app_user_id": current_app_user["id"],
        "organization_id": st.session_state["selected_org_id"],
    }

st.markdown("""
<div style="padding:2rem 0 1.5rem;">
    <div style="display:flex;align-items:baseline;gap:14px;">
        <span style="font-size:2.4rem;font-weight:900;color:#C9A84C;letter-spacing:-1px;
                     text-shadow:0 0 30px rgba(201,168,76,0.4);">Lumino</span>
        <span style="font-size:.85rem;color:#4A5A70;font-weight:400;letter-spacing:3px;text-transform:uppercase;">
            Field Performance Platform
        </span>
    </div>
    <div style="height:2px;background:linear-gradient(90deg,#C9A84C,rgba(201,168,76,0.3),transparent);
                margin-top:10px;border-radius:2px;width:600px;
                box-shadow:0 0 10px rgba(201,168,76,0.3);"></div>
</div>
""", unsafe_allow_html=True)

if auth_enabled and not st.session_state.get("auth_session"):
    st.info("Log in from the sidebar to access your organization’s lead pool, drafts, and routes.")
    st.stop()

if auth_enabled and st.session_state.get("auth_session") and not current_app_user:
    st.error("Your authenticated account is not linked to an app profile yet.")
    st.stop()

if auth_enabled and st.session_state.get("auth_session") and not current_memberships:
    st.warning("Your account is authenticated but not assigned to any organization yet.")
    st.stop()

if st.session_state.get("last_workspace_mode") != workspace_mode:
    if workspace_mode == "Rep View":
        st.session_state.pop("all_results", None)
        st.session_state.pop("selected_route_addresses", None)
        st.session_state.pop("current_route_draft_id", None)
        st.session_state.pop("current_route_draft_name", None)
        st.session_state.pop("active_route_run", None)
        st.session_state.pop("active_property_id", None)
        st.session_state.pop("show_route_drafts", None)
        st.session_state.pop("show_rep_route_drafts", None)
        st.session_state.pop("turf_dropped_pin", None)
        st.session_state.pop("turf_pin_feedback", None)
    st.session_state["last_workspace_mode"] = workspace_mode

if workspace_mode == "Manager View" and st.session_state.get("last_snapshot_results_count"):
    st.caption(
        f"Previous session found {st.session_state['last_snapshot_results_count']} analyzed leads. "
        "Use Upload or Load Open Lead Pool to start a fresh planning workspace."
    )

workspace_tab_label = "Workspace" if workspace_mode == "Manager View" else "Turf"
workspace_tab, team_tab, performance_tab = st.tabs([workspace_tab_label, "People", "Performance"])

with workspace_tab:
    if workspace_mode == "Manager View":
        render_workspace_shell(
            workspace_mode,
            st.session_state.get("all_results", []),
            st.session_state.get("route_execution", {}),
        )

    if workspace_mode == "Manager View" and supabase_enabled():
        section_title = "Open Lead Pool" if workspace_mode == "Manager View" else "My Turf Drafts"
        section_copy = (
            "Load open, unassigned leads from Supabase into the planning workspace."
            if workspace_mode == "Manager View"
            else "Open a saved draft if your turf did not auto-load."
        )
        st.markdown(f'<div class="siq-section">{section_title}</div>', unsafe_allow_html=True)
        st.markdown(section_copy)

        pool_col, drafts_col = st.columns(2)

        if workspace_mode == "Manager View" and pool_col.button("Load Open Lead Pool", use_container_width=True):
            pool_results = get_open_lead_pool(auth_context=auth_context)
            if pool_results:
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
            draft_rows = get_route_drafts(auth_context=auth_context)
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
                    draft_results = load_route_draft_results(
                        draft_options[selected_draft_label],
                        auth_context=auth_context,
                    )
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

    if workspace_mode == "Rep View" and "all_results" not in st.session_state:
        render_blank_rep_map(auth_context)

with team_tab:
    render_context_shell(
        "People Context",
        "Profiles, badges, and contact actions support the active field workflow but don’t interrupt it.",
        ["Profiles", "Badges", "Contact", "Recognition"],
    )
    render_people_hub(current_app_user, auth_context)

with performance_tab:
    render_context_shell(
        "Performance Context",
        "Leaderboards, report builder previews, and competitions stay available alongside the live workspace.",
        ["Leaderboard", "Reports", "Competitions", "KPIs"],
    )
    render_performance_hub(
        st.session_state.get("all_results", []),
        st.session_state.get("route_execution", {}),
        current_app_user,
        auth_context,
    )

with workspace_tab:
    if workspace_mode == "Manager View":
        render_workspace_shell(
            workspace_mode,
            st.session_state.get("all_results", []),
            st.session_state.get("route_execution", {}),
        )

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
                use_supabase = supabase_enabled() and auth_context is not None
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
                            process_address(row_data, gmaps_client, api_key, auth_context=auth_context),
                            row_data,
                        )
                    except Exception as err:
                        result = enrich_result_with_source_fields(
                            build_processing_error_result(row_data, str(err)),
                            row_data,
                        )
                        failed_addresses.append(addr)

                    if use_supabase:
                        saved_record = save_analysis_result(row_data, result, auth_context=auth_context)
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
                file_name=f"lumino_report_{datetime.now().strftime('%Y%m%d_%H%M')}.html",
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
            render_manager_followup_board(
                all_results,
                st.session_state.get("route_execution", {}),
                current_app_user,
                auth_context,
            )
        else:
            zip_summary = build_zip_summary(all_results)
            st.markdown('<div class="siq-section">Rep Route</div>', unsafe_allow_html=True)
            st.markdown("Open a saved draft, start from your current location, and work the route stop by stop.")

        zip_rank = {item["zipcode"]: i for i, item in enumerate(zip_summary)}
        sorted_results = sorted(
            all_results,
            key=lambda x: (zip_rank.get(x["zipcode"], 99), -x["priority_score"], -x["doors_to_knock"]),
        )

        if "selected_route_addresses" not in st.session_state:
            st.session_state["selected_route_addresses"] = set()

        selected = []
        if workspace_mode == "Manager View":
            st.markdown('<div class="siq-section">Route Selection</div>', unsafe_allow_html=True)
            st.markdown("Select stops to include in your route export.")
            selected_addresses = set(st.session_state["selected_route_addresses"])
            render_planning_map(sorted_results, selected_addresses)

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
        else:
            st.session_state["selected_route_addresses"] = {
                result["address"] for result in sorted_results if result["priority_score"] > 0
            }
            selected = [result for result in sorted_results if result["priority_score"] > 0]
            st.markdown('<div class="siq-section">Assigned Turf</div>', unsafe_allow_html=True)
            st.markdown(
                "All viable stops in the loaded draft are active in Turf Mode. Use the map to focus homes and log outcomes as you move."
            )

        if selected:
            st.success(
                f"**{len(selected)} stops** selected — "
                f"**{sum(result['doors_to_knock'] for result in selected)} total doors**"
            )

            if workspace_mode == "Manager View" and supabase_enabled():
                st.markdown('<div class="siq-section">Save Route Draft</div>', unsafe_allow_html=True)
                st.markdown("Save the selected stops for yourself or assign them to a rep.")
                rep_rows = get_rep_options(auth_context=auth_context)
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
                        auth_context=auth_context,
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

            route_preview_df = None
            if optimized_results:
                if workspace_mode == "Manager View":
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
                route_preview_df = route_preview
                if workspace_mode == "Manager View":
                    st.dataframe(route_preview_df, use_container_width=True, hide_index=True)

            if workspace_mode == "Manager View" and supabase_enabled() and st.session_state.get("current_route_draft_id"):
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
                        auth_context=auth_context,
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

            if workspace_mode == "Rep View":
                render_rep_turf_mode(
                    execution_results,
                    execution_properties,
                    auth_context,
                    route_preview_df=route_preview_df,
                )
            else:
                st.download_button(
                    label="Export Optimized Route to CSV",
                    data=build_route_csv(optimized_results if optimized_results else selected),
                    file_name=f"lumino_route_{datetime.now().strftime('%Y%m%d_%H%M')}.csv",
                    mime="text/csv",
                    use_container_width=True,
                    type="primary",
                )

            pending_navigation_results = [
                result
                for result in execution_results
                if result.get("route_run_status", "pending") == "pending"
            ]
            next_stop = pending_navigation_results[0] if pending_navigation_results else None

            properties_by_stop = {}
            for property_record in execution_properties:
                stop_number = property_record["route_stop_number"]
                properties_by_stop.setdefault(stop_number, []).append(property_record)
            if workspace_mode == "Manager View":
                st.markdown('<div class="siq-section">Route Execution</div>', unsafe_allow_html=True)
                st.markdown(
                    "Log what happened at each property and open Claude with a property-specific follow-up prompt."
                )

            if workspace_mode == "Manager View" and next_stop:
                next_links = navigation_links(next_stop)
                st.markdown("**Navigate To Next Stop**")
                nav_col1, nav_col2, nav_col3 = st.columns(3)
                nav_col1.link_button("Google Maps", next_links["google"], use_container_width=True)
                nav_col2.link_button("Apple Maps", next_links["apple"], use_container_width=True)
                nav_col3.link_button("Waze", next_links["waze"], use_container_width=True)

            for stop_number, stop_properties in properties_by_stop.items():
                if workspace_mode != "Manager View":
                    continue
                primary_property = next(
                    prop for prop in stop_properties if prop["property_type"] == "Primary Stop"
                )
                stop_title = (
                    f"Stop {stop_number} · {primary_property['address']} · "
                    f"{get_priority_meta(primary_property['priority_score'])['label']}"
                )
                with st.expander(
                    stop_title,
                    expanded=(stop_number == 1 and workspace_mode == "Manager View"),
                ):
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
                                auth_context=auth_context,
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
                                auth_context=auth_context,
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
