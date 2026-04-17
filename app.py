import calendar
import base64
import json
import math
import os
import time
import urllib.parse
from datetime import datetime, timedelta
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
from engine.normalization import coerce_zipcode
try:
    from engine.lead_workflow import (
        ACTIVITY_TYPE_OPTIONS,
        FLAG_OPTIONS,
        LEAD_STATUS_OPTIONS,
        NURTURE_REASON_OPTIONS,
        OPEN_LEAD_STATUSES,
        OUTCOME_OPTIONS,
        QUICK_ACTIONS,
        allowed_outcomes_for_activity,
    )
except ModuleNotFoundError:
    # Deployment safety net: these CRM workflow helpers also live in engine.constants.
    from engine.constants import (
        ACTIVITY_TYPE_OPTIONS,
        FLAG_OPTIONS,
        LEAD_STATUS_OPTIONS,
        NURTURE_REASON_OPTIONS,
        OPEN_LEAD_STATUSES,
        OUTCOME_OPTIONS,
        QUICK_ACTIONS,
        allowed_outcomes_for_activity,
    )
from engine.persistence import load_app_snapshot, save_app_snapshot
from engine.processing import build_processing_error_result, process_address
from engine.reporting import build_route_csv, build_zip_summary, generate_html_report
from engine.routing import optimize_route
from engine.supabase_auth import (
    refresh_session,
    send_password_reset_email,
    sign_in_with_password,
    sign_out,
    supabase_auth_enabled,
    update_user_password,
    verify_otp_token,
)
from engine.supabase_store import (
    add_lead_activity,
    create_manual_lead,
    create_onboarding_user,
    create_route_run,
    delete_lead_activity,
    get_current_app_user,
    get_lead_analysis_snapshot,
    get_lead_activity_rows,
    get_org_lead_count,
    get_open_lead_pool,
    get_team_route_activity,
    get_visible_lead_by_id,
    get_visible_leads,
    get_rep_options,
    get_route_drafts,
    get_user_memberships,
    load_route_draft_results,
    save_analysis_result,
    save_route_draft,
    supabase_enabled,
    update_lead_core_details,
    update_lead_assignment,
    update_route_run_stop,
)
from engine.sheets import get_sheets_service, summarize_result_sources, sync_results_to_sheet
from engine.geo import extract_zip


AUTH_COOKIE_NAME = "lumino_auth_session"
ORG_COOKIE_NAME = "lumino_selected_org"


def _cookie_expiry(days=30):
    return (datetime.utcnow() + timedelta(days=days)).strftime("%a, %d %b %Y %H:%M:%S GMT")


def _encode_cookie_payload(payload):
    try:
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("utf-8")
    except Exception:
        return ""


def _decode_cookie_payload(value):
    try:
        raw = base64.urlsafe_b64decode(str(value or "").encode("utf-8"))
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def persist_browser_cookie(name, value, days=30):
    expires = _cookie_expiry(days=days)
    st.components.v1.html(
        f"""
        <script>
        document.cookie = "{name}={value}; expires={expires}; path=/; SameSite=Lax";
        </script>
        """,
        height=0,
    )


def clear_browser_cookie(name):
    st.components.v1.html(
        f"""
        <script>
        document.cookie = "{name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax";
        </script>
        """,
        height=0,
    )


def sync_auth_cookies_from_session():
    session_payload = st.session_state.get("auth_session")
    if session_payload:
        persist_browser_cookie(
            AUTH_COOKIE_NAME,
            _encode_cookie_payload(
                {
                    "access_token": session_payload.get("access_token"),
                    "refresh_token": session_payload.get("refresh_token"),
                    "api_key": session_payload.get("api_key"),
                    "user": session_payload.get("user") or {},
                }
            ),
        )
    else:
        clear_browser_cookie(AUTH_COOKIE_NAME)

    selected_org_id = st.session_state.get("selected_org_id")
    if selected_org_id:
        persist_browser_cookie(ORG_COOKIE_NAME, selected_org_id)
    else:
        clear_browser_cookie(ORG_COOKIE_NAME)


def restore_auth_session_from_cookies():
    if st.session_state.get("auth_session"):
        return
    cookie_store = getattr(getattr(st, "context", None), "cookies", {}) or {}
    auth_cookie = cookie_store.get(AUTH_COOKIE_NAME)
    restored = _decode_cookie_payload(auth_cookie) if auth_cookie else None
    if restored and restored.get("access_token"):
        st.session_state["auth_session"] = restored
    if not st.session_state.get("selected_org_id"):
        selected_org_cookie = cookie_store.get(ORG_COOKIE_NAME)
        if selected_org_cookie:
            st.session_state["selected_org_id"] = selected_org_cookie


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


def public_app_url():
    for env_name in ["APP_URL", "PUBLIC_APP_URL", "RAILWAY_STATIC_URL", "RAILWAY_PUBLIC_DOMAIN"]:
        value = str(os.getenv(env_name, "")).strip()
        if not value:
            continue
        if value.startswith("http://") or value.startswith("https://"):
            return value.rstrip("/")
        return f"https://{value}".rstrip("/")
    return None


def password_setup_redirect_url():
    base_url = public_app_url()
    if not base_url:
        return None
    return f"{base_url}/?mode=set-password"


def render_password_setup_screen():
    st.markdown("## Set Your Password")
    st.markdown("Choose a password for your Lumino account to finish setup.")

    query_params = st.query_params
    token_hash = str(query_params.get("token_hash", "")).strip()
    otp_type = str(query_params.get("type", "recovery")).strip() or "recovery"
    recovery_error = str(query_params.get("error_description") or query_params.get("error") or "").strip()

    if recovery_error:
        st.error(urllib.parse.unquote(recovery_error))

    recovery_session = st.session_state.get("recovery_session")
    if token_hash and (
        not recovery_session
        or recovery_session.get("token_hash") != token_hash
        or recovery_session.get("type") != otp_type
    ):
        verify_result = verify_otp_token(token_hash, otp_type=otp_type)
        if verify_result.get("ok"):
            st.session_state["recovery_session"] = {
                "token_hash": token_hash,
                "type": otp_type,
                "access_token": verify_result.get("access_token"),
                "refresh_token": verify_result.get("refresh_token"),
                "user": verify_result.get("user") or {},
            }
            recovery_session = st.session_state.get("recovery_session")
        else:
            st.error(verify_result.get("error", "This password setup link is invalid or expired."))

    if not recovery_session:
        st.info("Open the password setup link from your email to continue.")
        st.stop()

    user_email = (recovery_session.get("user") or {}).get("email")
    if user_email:
        st.caption(f"Setting password for {user_email}")

    with st.form("password_setup_form"):
        new_password = st.text_input("New Password", type="password")
        confirm_password = st.text_input("Confirm Password", type="password")
        submitted = st.form_submit_button("Save Password", use_container_width=True)

    if submitted:
        if len(new_password) < 8:
            st.error("Use a password with at least 8 characters.")
        elif new_password != confirm_password:
            st.error("Passwords do not match.")
        else:
            update_result = update_user_password(
                recovery_session.get("access_token"),
                new_password,
            )
            if update_result.get("ok"):
                st.session_state["auth_session"] = {
                    "access_token": recovery_session.get("access_token"),
                    "refresh_token": recovery_session.get("refresh_token"),
                    "user": update_result.get("user") or recovery_session.get("user") or {},
                    "api_key": (
                        os.getenv("SUPABASE_ANON_KEY", "").strip()
                        or os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
                        or os.getenv("SUPABASE_SECRET_KEY", "").strip()
                    ),
                }
                st.session_state["recovery_session"] = None
                st.success("Password saved. You can return to Lumino and sign in.")
                if public_app_url():
                    st.link_button("Open Lumino", public_app_url(), use_container_width=True)
            else:
                st.error(update_result.get("error", "Could not update your password."))
    st.stop()


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
    # TODO(lead-workflow-v1): This route-execution state still uses the legacy in-memory
    # status model ("Interested", "Callback", "Appt Set", etc.). Keep isolated from the
    # structured lead activity engine until route execution is migrated onto lead_activities.
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
        if "closed" in execution_status:
            return {
                "status_key": "closed",
                "label": "Closed",
                "fill_color": [88, 28, 135, 235],
                "line_color": [230, 214, 255, 255],
            }
        if "appt set" in execution_status:
            return {
                "status_key": "appt_set",
                "label": "Appt Set",
                "fill_color": [124, 58, 237, 235],
                "line_color": [221, 214, 254, 255],
            }
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


def parse_activity_timestamp(timestamp_value):
    if not timestamp_value:
        return None
    try:
        return datetime.strptime(str(timestamp_value), "%b %d, %Y %I:%M %p")
    except Exception:
        return None


def performance_activity_df(all_results, execution_state):
    # TODO(lead-workflow-v1): This powers legacy performance views from route_execution
    # activity_log events only. It does not read structured lead_activities yet.
    rows = []
    for result in all_results or []:
        property_id = make_property_id("primary_stop", result.get("address"))
        entry = (execution_state or {}).get(property_id, {})
        for item in entry.get("activity_log") or []:
            parsed_time = parse_activity_timestamp(item.get("timestamp"))
            if not parsed_time:
                continue
            rows.append(
                {
                    "address": result.get("address"),
                    "timestamp": parsed_time,
                    "type": item.get("type"),
                    "summary": item.get("summary") or "",
                    "doors": 1 if item.get("type") == "Disposition" else 0,
                    "appointments": 1 if item.get("type") == "Appointment" else 0,
                    "calls": 1 if item.get("type") == "Call" else 0,
                    "texts": 1 if item.get("type") == "Text" else 0,
                    "tasks": 1 if item.get("type") == "Task" else 0,
                }
            )
    if not rows:
        return pd.DataFrame(columns=["address", "timestamp", "type", "summary", "doors", "appointments", "calls", "texts", "tasks"])
    df = pd.DataFrame(rows).sort_values("timestamp")
    df["day"] = df["timestamp"].dt.strftime("%Y-%m-%d")
    df["week"] = df["timestamp"].dt.strftime("%G-W%V")
    df["month"] = df["timestamp"].dt.strftime("%Y-%m")
    df["year"] = df["timestamp"].dt.strftime("%Y")
    return df


def grouped_kpi(activity_df, period_key, metric_key):
    if activity_df.empty:
        return pd.DataFrame(columns=[period_key, metric_key])
    grouped = (
        activity_df.groupby(period_key, dropna=False)[metric_key]
        .sum()
        .reset_index()
        .rename(columns={period_key: "Period", metric_key: "Value"})
    )
    return grouped


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


def build_rep_kpi_frames(all_results, execution_state, current_app_user, auth_context):
    owner_label = current_workspace_owner_label(current_app_user, auth_context)
    rep_rows = get_rep_options(auth_context=auth_context) if auth_context else []
    rep_names = [rep.get("full_name") or rep.get("email") or rep.get("id") for rep in rep_rows]
    if owner_label not in rep_names:
        rep_names.insert(0, owner_label)
    if not rep_names:
        rep_names = ["Current Workspace"]

    rep_summary = {
        rep_name: {
            "Rep": rep_name,
            "Doors Knocked": 0,
            "Conversations": 0,
            "Appointments Set": 0,
            "Closed": 0,
        }
        for rep_name in rep_names
    }

    trend_rows = []
    for result in all_results or []:
        property_id = make_property_id("primary_stop", result.get("address"))
        entry = (execution_state or {}).get(property_id, {})
        status_text = str(entry.get("status") or "").strip().lower()
        if status_text:
            rep_summary[owner_label]["Doors Knocked"] += 1
        if status_text in {"interested", "callback", "not interested", "appt set"}:
            rep_summary[owner_label]["Conversations"] += 1
        if status_text == "appt set":
            rep_summary[owner_label]["Appointments Set"] += 1
        if status_text == "closed":
            rep_summary[owner_label]["Closed"] += 1

        for item in entry.get("activity_log") or []:
            parsed_time = parse_activity_timestamp(item.get("timestamp"))
            if not parsed_time:
                continue
            row = {
                "Rep": owner_label,
                "Period": parsed_time.strftime("%Y-%m-%d"),
                "Doors Knocked": 1 if item.get("type") == "Disposition" else 0,
                "Conversations": 1 if status_text in {"interested", "callback", "not interested", "appt set"} and item.get("type") == "Disposition" else 0,
                "Appointments Set": 1 if (
                    (item.get("type") == "Appointment")
                    or ("appointment set" in str(item.get("summary") or "").lower())
                    or status_text == "appt set"
                ) else 0,
                "Closed": 1 if ("closed" in str(item.get("summary") or "").lower() or status_text == "closed") and item.get("type") == "Disposition" else 0,
            }
            trend_rows.append(row)

    rep_kpi_df = pd.DataFrame(rep_summary.values())
    rep_trend_df = pd.DataFrame(trend_rows)
    if not rep_trend_df.empty:
        rep_trend_df = (
            rep_trend_df.groupby(["Rep", "Period"], dropna=False)[["Doors Knocked", "Conversations", "Appointments Set", "Closed"]]
            .sum()
            .reset_index()
            .sort_values(["Rep", "Period"])
        )
    return rep_kpi_df, rep_trend_df


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


def route_attempt_number_from_status(status_value):
    normalized = str(status_value or "").strip().lower()
    if normalized == "not home 1":
        return 1
    if normalized == "not home 2":
        return 2
    if normalized == "not home 3":
        return 3
    return None


def sync_route_stop_details(result, execution_entry, auth_context=None):
    route_stop_id = (result or {}).get("route_run_stop_id")
    if not route_stop_id:
        return True
    return update_route_run_stop(
        route_stop_id,
        disposition=execution_entry.get("status"),
        homeowner_name=execution_entry.get("homeowner_name"),
        phone=execution_entry.get("phone"),
        email=execution_entry.get("email"),
        best_follow_up_time=execution_entry.get("best_follow_up_time"),
        interest_level=(execution_entry.get("interest_level") or "").lower() or None,
        notes=execution_entry.get("notes"),
        auth_context=auth_context,
    )


def persist_rep_stop_update(result, execution_entry, auth_context=None):
    # TODO(lead-workflow-v1): Route stop persistence still translates the legacy field-status
    # model into route_run_stops outcomes. This path is intentionally left isolated until
    # route execution logging is migrated to the structured lead activity model.
    status_value = str(execution_entry.get("status") or "").strip()
    normalized_status = status_value.lower()
    stop_status = "pending"
    outcome = None
    skipped_reason = None

    if normalized_status:
        stop_status = "completed"
        if normalized_status == "interested":
            outcome = "Interested"
            if execution_entry.get("lead_stage") in {"", "New Lead", "Attempting Contact"}:
                execution_entry["lead_stage"] = "Contacted"
            execution_entry["interest_level"] = execution_entry.get("interest_level") or "Hot"
        elif normalized_status == "callback":
            outcome = "Requested Callback"
            if execution_entry.get("lead_stage") in {"", "New Lead", "Attempting Contact"}:
                execution_entry["lead_stage"] = "Contacted"
            execution_entry["next_action"] = execution_entry.get("next_action") or "Call Back"
            execution_entry["interest_level"] = execution_entry.get("interest_level") or "Warm"
        elif normalized_status == "appt set":
            outcome = "Booked Appointment"
            execution_entry["lead_stage"] = "Appointment Set"
            execution_entry["next_action"] = execution_entry.get("next_action") or "Confirm Appointment"
            if execution_entry.get("appointment_status") in {"", "Not Set"}:
                execution_entry["appointment_status"] = "Scheduled"
            execution_entry["interest_level"] = execution_entry.get("interest_level") or "Warm"
        elif normalized_status == "closed":
            outcome = "Qualified"
            execution_entry["lead_stage"] = "Closed Won"
        elif normalized_status == "not interested":
            outcome = "Not Interested"
            execution_entry["lead_stage"] = "Closed Lost"
            execution_entry["interest_level"] = execution_entry.get("interest_level") or "Cold"
        elif normalized_status.startswith("not home"):
            outcome = "No Answer"

    route_stop_id = (result or {}).get("route_run_stop_id")
    if route_stop_id:
        updated = update_route_run_stop(
            route_stop_id,
            stop_status=stop_status,
            outcome=outcome,
            disposition=status_value or None,
            skipped_reason=skipped_reason,
            homeowner_name=execution_entry.get("homeowner_name"),
            phone=execution_entry.get("phone"),
            email=execution_entry.get("email"),
            best_follow_up_time=execution_entry.get("best_follow_up_time"),
            interest_level=(execution_entry.get("interest_level") or "").lower() or None,
            notes=execution_entry.get("notes"),
            auth_context=auth_context,
        )
        if not updated:
            return False

    if result is not None:
        result["route_run_status"] = stop_status
        lead_id = result.get("lead_id")
        attempt_number = route_attempt_number_from_status(status_value)
        # Route status != CRM status. Preserve Not Home 1/2/3 for field attempt tracking,
        # but mirror the attempt into structured CRM history as Door Knock + No Answer.
        if lead_id and attempt_number is not None:
            add_lead_activity(
                lead_id,
                activity_type="Door Knock",
                outcome="No Answer",
                note_body=f"Door attempt marked as {status_value}.",
                event_metadata={
                    "source": "route_execution",
                    "route_attempt_status": status_value,
                    "attempt_number": attempt_number,
                },
                auth_context=auth_context,
            )
    return True


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
            disposition=status_label or None,
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
    "zipcode": [
        "zipcode",
        "zip",
        "postalcode",
        "postal",
        "ziporpostalcode",
        "zipcodeorpostalcode",
        "zippostalcode",
    ],
    "city": ["city", "town", "municipality"],
    "state": ["state", "stateorprovince", "province", "region"],
    "beds": ["beds", "bedrooms", "bed"],
    "baths": ["baths", "bathrooms", "bath"],
    "sqft": ["sqft", "squarefeet", "livingarea", "livingsqft", "area"],
    "sold_date": ["solddate", "date", "closedate", "datesold"],
    "permit_pulled": ["permitpulled", "permitdate", "datepermitpulled", "permitissued", "permitissue"],
    "property_type": ["propertytype", "type", "hometype", "residentialtype"],
    "lot_size": ["lotsize", "lotsqft", "lotsquarefeet", "lotarea"],
    "year_built": ["yearbuilt", "built", "year"],
    "latitude": ["latitude", "lat", "ycoord", "ycoordinate"],
    "longitude": ["longitude", "lng", "lon", "xcoord", "xcoordinate"],
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


def compose_import_address(row, column_mapping):
    street = str(get_row_value(row, column_mapping.get("address")) or "").strip()
    city = str(get_row_value(row, column_mapping.get("city")) or "").strip()
    state = str(get_row_value(row, column_mapping.get("state")) or "").strip()
    zipcode = coerce_zipcode(get_row_value(row, column_mapping.get("zipcode"))) or ""

    locality_parts = [part for part in [city, state] if part]
    locality = ", ".join(locality_parts) if locality_parts else ""
    if zipcode:
        locality = f"{locality} {zipcode}".strip() if locality else zipcode

    if street and locality:
        return f"{street}, {locality}"
    return street or locality


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


def _extract_address_component(components, desired_types):
    for component in components or []:
        component_types = component.get("types") or []
        if any(component_type in component_types for component_type in desired_types):
            return component.get("long_name") or component.get("short_name") or ""
    return ""


def fetch_address_suggestions(query, api_key, limit=5):
    query_text = str(query or "").strip()
    if len(query_text) < 4 or not api_key:
        return []
    try:
        client = googlemaps.Client(key=api_key)
        predictions = client.places_autocomplete(query_text)
    except Exception:
        return []

    suggestions = []
    seen = set()
    for item in predictions or []:
        description = str(item.get("description") or "").strip()
        if not description or description in seen:
            continue
        seen.add(description)
        place_id = item.get("place_id")
        suggestion = {
            "label": description,
            "address": description,
            "city": "",
            "state": "",
            "zipcode": coerce_zipcode(extract_zip(description)),
        }
        if place_id:
            try:
                place_result = client.place(
                    place_id,
                    fields=["formatted_address", "address_component"],
                ).get("result", {})
                formatted_address = str(place_result.get("formatted_address") or description).strip()
                components = place_result.get("address_components") or []
                street_number = _extract_address_component(components, {"street_number"})
                route = _extract_address_component(components, {"route"})
                street = " ".join(part for part in [street_number, route] if part).strip() or formatted_address
                suggestion = {
                    "label": formatted_address,
                    "address": street,
                    "city": _extract_address_component(components, {"locality", "postal_town"}),
                    "state": _extract_address_component(components, {"administrative_area_level_1"}),
                    "zipcode": coerce_zipcode(_extract_address_component(components, {"postal_code"})),
                }
            except Exception:
                pass
        suggestions.append(suggestion)
        if len(suggestions) >= limit:
            break
    return suggestions


def normalize_manual_address_fields():
    st.session_state["manual_lead_zip"] = coerce_zipcode(st.session_state.get("manual_lead_zip")) or ""


def format_phone_value(raw_value):
    digits = "".join(char for char in str(raw_value or "") if char.isdigit())
    if not digits:
        return ""
    if len(digits) <= 3:
        return digits
    if len(digits) <= 6:
        return f"{digits[:3]}-{digits[3:]}"
    formatted = f"{digits[:3]}-{digits[3:6]}-{digits[6:10]}"
    if len(digits) > 10:
        formatted = f"{formatted} x{digits[10:]}"
    return formatted


def format_phone_state_value(session_key):
    st.session_state[session_key] = format_phone_value(st.session_state.get(session_key, ""))


def enrich_result_with_source_fields(result, row_data):
    enriched = dict(result)
    for key in [
        "zipcode",
        "city",
        "state",
        "first_name",
        "last_name",
        "phone",
        "email",
        "notes",
        "unqualified",
        "unqualified_reason",
        "unqualified_reason_notes",
        "listing_agent",
        "permit_pulled",
        "property_type",
        "lot_size",
        "year_built",
        "source_latitude",
        "source_longitude",
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

if "auth_session" not in st.session_state:
    st.session_state["auth_session"] = None
if "recovery_session" not in st.session_state:
    st.session_state["recovery_session"] = None
restore_auth_session_from_cookies()

password_setup_mode = str(st.query_params.get("mode", "")).strip().lower() == "set-password" or bool(
    str(st.query_params.get("token_hash", "")).strip()
)
if password_setup_mode:
    render_password_setup_screen()


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


def get_active_org_role(current_memberships, selected_org_id, fallback_role=None):
    for membership in current_memberships or []:
        if membership.get("organization_id") == selected_org_id:
            return str(membership.get("role") or fallback_role or "").strip().lower()
    return str(fallback_role or "").strip().lower()


def can_access_manager_workspace(role):
    return str(role or "").strip().lower() in {"owner", "admin", "manager"}


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

def format_follow_up_datetime(value):
    if not value:
        return "Not set"
    try:
        return pd.to_datetime(value).strftime("%b %d, %Y %I:%M %p")
    except Exception:
        return str(value)


def lead_flag_badges(flags):
    badges = [flag for flag in (flags or []) if flag in FLAG_OPTIONS]
    return " · ".join(badges) if badges else "None"


LEAD_CARD_QUICK_ACTIONS = [
    {
        "label": "Call",
        "icon": "📞",
        "help": "Log an outbound call.",
        "activity_type": "Call Outbound",
        "outcome": "No Answer",
    },
    {
        "label": "Text",
        "icon": "💬",
        "help": "Log an outbound text.",
        "activity_type": "Text Outbound",
        "outcome": "Connected",
    },
    {
        "label": "Conversation",
        "icon": "🗣️",
        "help": "Log a meaningful conversation.",
        "activity_type": "Conversation",
        "outcome": "Interested",
    },
    {
        "label": "Appointment",
        "icon": "📅",
        "help": "Book an appointment.",
        "activity_type": "Appointment Set",
        "outcome": "Booked Appointment",
    },
    {
        "label": "Not Home",
        "icon": "🚪",
        "help": "Log a door attempt with no answer.",
        "activity_type": "Door Knock",
        "outcome": "No Answer",
    },
    {
        "label": "Nurture",
        "icon": "🌱",
        "help": "Move this lead into nurture.",
        "activity_type": "Conversation",
        "outcome": "Needs Nurture",
    },
    {
        "label": "Follow-Up / Snooze",
        "icon": "⏰",
        "help": "Schedule the next follow-up.",
        "activity_type": "Status Changed",
        "outcome": None,
    },
    {
        "label": "Closed Lost",
        "icon": "⛔",
        "help": "Mark this lead as closed lost.",
        "activity_type": "Status Changed",
        "outcome": None,
        "manual_status": "Closed Lost",
        "requires_confirm": True,
    },
    {
        "label": "Do Not Contact",
        "icon": "🚫",
        "help": "Apply a do-not-contact state.",
        "activity_type": "Status Changed",
        "outcome": "Do Not Contact",
        "manual_status": "Do Not Contact",
        "requires_confirm": True,
    },
]

LEAD_CARD_QUICK_ACTION_LOOKUP = {item["label"]: item for item in LEAD_CARD_QUICK_ACTIONS}


def lead_activity_form_keys(lead_id):
    return {
        "selected_action": f"lead_activity_quick_action_{lead_id}",
        "activity_type": f"lead_activity_type_{lead_id}",
        "outcome": f"lead_activity_outcome_{lead_id}",
        "date": f"lead_activity_date_{lead_id}",
        "time": f"lead_activity_time_{lead_id}",
        "note": f"lead_activity_note_{lead_id}",
        "callback_date": f"lead_callback_date_{lead_id}",
        "callback_time": f"lead_callback_time_{lead_id}",
        "appointment_date": f"lead_card_appt_date_{lead_id}",
        "appointment_time": f"lead_card_appt_time_{lead_id}",
        "follow_up_date": f"lead_followup_date_{lead_id}",
        "follow_up_time": f"lead_followup_time_{lead_id}",
        "nurture_reason": f"lead_activity_nurture_{lead_id}",
        "manual_status": f"lead_activity_manual_status_{lead_id}",
        "confirm": f"lead_activity_confirm_{lead_id}",
    }


def default_form_time():
    return datetime.now().replace(second=0, microsecond=0).time()


def parse_datetime_value(value):
    if not value:
        return None
    try:
        return pd.to_datetime(value).to_pydatetime()
    except Exception:
        return None


def initialize_lead_activity_form_state(lead_id, selected_lead):
    keys = lead_activity_form_keys(lead_id)
    now = datetime.now()
    next_follow_up_dt = parse_datetime_value(selected_lead.get("Next Follow-Up")) or now
    appointment_dt = parse_datetime_value(selected_lead.get("Appointment At")) or now
    defaults = {
        keys["selected_action"]: "",
        keys["activity_type"]: "Note",
        keys["outcome"]: "",
        keys["date"]: now.date(),
        keys["time"]: default_form_time(),
        keys["note"]: "",
        keys["callback_date"]: next_follow_up_dt.date(),
        keys["callback_time"]: next_follow_up_dt.time().replace(second=0, microsecond=0),
        keys["appointment_date"]: appointment_dt.date(),
        keys["appointment_time"]: appointment_dt.time().replace(second=0, microsecond=0),
        keys["follow_up_date"]: next_follow_up_dt.date(),
        keys["follow_up_time"]: next_follow_up_dt.time().replace(second=0, microsecond=0),
        keys["nurture_reason"]: selected_lead.get("Nurture Reason") or "",
        keys["manual_status"]: "",
        keys["confirm"]: False,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
    return keys


def count_not_home_attempts(activity_rows):
    highest_attempt = 0
    for item in activity_rows or []:
        metadata = item.get("event_metadata") or {}
        if metadata.get("route_attempt_status") in {"Not Home 1", "Not Home 2", "Not Home 3"}:
            try:
                highest_attempt = max(highest_attempt, int(metadata.get("attempt_number") or 0))
            except Exception:
                pass
            continue
        if item.get("activity_type") == "Door Knock" and item.get("outcome") == "No Answer":
            highest_attempt += 1
    return max(0, min(highest_attempt, 3))


def apply_lead_quick_action(lead_id, selected_lead, activity_rows, action_label):
    keys = lead_activity_form_keys(lead_id)
    config = LEAD_CARD_QUICK_ACTION_LOOKUP[action_label]
    now = datetime.now()
    st.session_state[keys["selected_action"]] = action_label
    st.session_state[keys["activity_type"]] = config["activity_type"]
    st.session_state[keys["outcome"]] = config.get("outcome") or ""
    st.session_state[keys["manual_status"]] = config.get("manual_status") or ""
    st.session_state[keys["confirm"]] = False

    if action_label == "Appointment":
        appointment_dt = parse_datetime_value(selected_lead.get("Appointment At")) or (now + timedelta(days=1))
        st.session_state[keys["appointment_date"]] = appointment_dt.date()
        st.session_state[keys["appointment_time"]] = appointment_dt.time().replace(second=0, microsecond=0)
        st.session_state[keys["note"]] = "Appointment booked."
    elif action_label == "Not Home":
        next_attempt = min(count_not_home_attempts(activity_rows) + 1, 3)
        st.session_state[keys["note"]] = f"Door attempt marked as Not Home {next_attempt}."
    elif action_label == "Nurture":
        st.session_state[keys["note"]] = "Lead moved into nurture."
    elif action_label == "Follow-Up / Snooze":
        follow_up_dt = parse_datetime_value(selected_lead.get("Next Follow-Up")) or (now + timedelta(days=1))
        st.session_state[keys["follow_up_date"]] = follow_up_dt.date()
        st.session_state[keys["follow_up_time"]] = follow_up_dt.time().replace(second=0, microsecond=0)
        st.session_state[keys["note"]] = "Follow-up rescheduled."
    elif action_label == "Closed Lost":
        st.session_state[keys["note"]] = "Lead marked closed lost."
    elif action_label == "Do Not Contact":
        st.session_state[keys["note"]] = "Lead marked do not contact."
    else:
        st.session_state[keys["note"]] = ""


def format_home_info_value(key, value, snapshot):
    if value in (None, "", "Unknown", "N/A"):
        return None
    if key == "sale_price":
        try:
            return f"${float(value):,.0f}"
        except Exception:
            return str(value)
    if key == "sun_hours":
        return snapshot.get("sun_hours_display") or f"{float(value):.1f} hrs"
    if key == "sqft":
        return snapshot.get("sqft_display") or f"{float(value):,.0f} sq ft"
    if key in {"max_array_area_m2", "whole_roof_area_m2", "building_area_m2"}:
        try:
            return f"{float(value):,.1f} m²"
        except Exception:
            return str(value)
    if key == "system_capacity_kw":
        try:
            return f"{float(value):,.1f} kW"
        except Exception:
            return str(value)
    if key == "yearly_energy_dc_kwh":
        try:
            return f"{float(value):,.0f} kWh"
        except Exception:
            return str(value)
    return str(value)


def home_info_entries(snapshot):
    if not snapshot:
        return []
    labels = [
        ("sun_hours", "Sun Hours"),
        ("sqft", "Square Footage"),
        ("sale_price", "Price"),
        ("beds", "Beds"),
        ("baths", "Baths"),
        ("sold_date", "Sold Date"),
        ("permit_pulled", "Permit Pulled"),
        ("priority_label", "Priority"),
        ("category", "Lead Category"),
        ("doors_to_knock", "Doors To Knock"),
        ("parking_ease", "Parking Ease"),
        ("roof_capacity_score", "Roof Capacity Score"),
        ("roof_complexity_score", "Roof Complexity Score"),
        ("roof_segment_count", "Roof Segments"),
        ("south_facing_segment_count", "South-Facing Segments"),
        ("whole_roof_area_m2", "Whole Roof Area"),
        ("building_area_m2", "Building Area"),
        ("max_array_panels_count", "Max Array Panels"),
        ("max_array_area_m2", "Max Array Area"),
        ("panel_capacity_watts", "Panel Capacity Watts"),
        ("system_capacity_kw", "System Capacity"),
        ("yearly_energy_dc_kwh", "Yearly Energy"),
        ("imagery_quality", "Imagery Quality"),
        ("street_view_link", "Street View"),
    ]
    entries = []
    for key, label in labels:
        raw_value = snapshot.get(key)
        if key == "street_view_link" and raw_value:
            entries.append((label, f"[Open Street View]({raw_value})"))
            continue
        rendered = format_home_info_value(key, raw_value, snapshot)
        if rendered:
            entries.append((label, rendered))
    return entries


def is_open_crm_lead_row(row):
    # Route / execution status is a separate field-operations concept.
    # Leads tab visibility is driven by CRM lead_status, with a legacy-open fallback
    # during transition for rows that do not yet have the new follow-up fields.
    crm_status = str(row.get("Lead Status") or "").strip()
    legacy_status = str(row.get("Legacy Lead Record Status") or "").strip().lower()
    if crm_status:
        return crm_status in OPEN_LEAD_STATUSES
    return legacy_status in {"open", "assigned", "in_progress"}


def build_prepared_lead_row(row, people_lookup):
    homeowner_name = " ".join(
        part.strip()
        for part in [row.get("first_name") or "", row.get("last_name") or ""]
        if part and str(part).strip()
    ).strip()
    assigned_to_label = people_lookup.get(row.get("assigned_to")) or (
        "Unassigned" if not row.get("assigned_to") else row.get("assigned_to")
    )
    created_by_label = people_lookup.get(row.get("created_by")) or (
        "Unknown" if not row.get("created_by") else row.get("created_by")
    )
    return {
        "Lead ID": row.get("id"),
        "Address": row.get("address") or "",
        "Homeowner": homeowner_name,
        "Phone": row.get("phone") or "",
        "Email": row.get("email") or "",
        "Status": row.get("lead_status") or "New",
        "Legacy Lead Record Status": str(row.get("status") or "open").replace("_", " ").title(),
        "Assignment": str(row.get("assignment_status") or "unassigned").replace("_", " ").title(),
        "Assigned To": assigned_to_label,
        "Created By": created_by_label,
        "ZIP": row.get("zipcode") or "",
        "Lead Status": row.get("lead_status") or "New",
        "Flags": row.get("follow_up_flags") or [],
        "Next Follow-Up": row.get("next_follow_up_at"),
        "Next Recommended Step": row.get("next_recommended_step") or "",
        "Appointment At": row.get("appointment_at"),
        "Last Activity": row.get("last_activity_at"),
        "Last Activity Type": row.get("last_activity_type") or "",
        "Last Activity Outcome": row.get("last_activity_outcome") or "",
        "First Outreach": row.get("first_outreach_at"),
        "First Meaningful Contact": row.get("first_meaningful_contact_at"),
        "Last Meaningful Contact": row.get("last_meaningful_contact_at"),
        "Nurture Reason": row.get("nurture_reason") or "",
        "Qualified": "No" if row.get("unqualified") else "Yes",
        "Updated": (row.get("updated_at") or row.get("created_at") or "")[:10],
        "Notes": row.get("notes") or "",
        "Unqualified Reason": row.get("unqualified_reason") or "",
        "Sold Date": row.get("sold_date") or "",
        "Permit Pulled": row.get("permit_pulled") or "",
        "Sale Price": row.get("sale_price"),
        "Sun Hours": row.get("sun_hours"),
        "City": infer_city_from_address(row.get("address")),
        "Assigned To ID": row.get("assigned_to"),
        "Created By ID": row.get("created_by"),
        "_search_blob": " ".join(
            str(value or "")
            for value in [
                row.get("address"),
                homeowner_name,
                row.get("phone"),
                row.get("email"),
                assigned_to_label,
                created_by_label,
            ]
        ).lower(),
    }


def parse_filterable_month(value):
    text = str(value or "").strip()
    if not text:
        return None
    for pattern in ["%b %Y", "%B %Y", "%Y-%m-%d", "%m/%d/%Y"]:
        try:
            return datetime.strptime(text, pattern).date()
        except Exception:
            continue
    try:
        return pd.to_datetime(text).date()
    except Exception:
        return None


def render_leads_hub(current_app_user, auth_context, active_org_role):
    st.markdown('<div class="siq-section">Leads</div>', unsafe_allow_html=True)
    st.markdown("Review every saved lead in one place, with visibility scoped to the signed-in role.")

    if not auth_context or not supabase_enabled():
        st.info("Lead storage becomes available once Supabase auth and data access are active.")
        return

    with st.expander("Add Lead", expanded=False):
        st.caption("Create a single lead manually. New leads are assigned to you automatically when they are unassigned.")
        add_col1, add_col2 = st.columns(2)
        manual_address = add_col1.text_input(
            "Address",
            key="manual_lead_address",
            placeholder="Start typing an address",
        )
        address_suggestions = fetch_address_suggestions(manual_address, api_key)
        if address_suggestions:
            suggestion_labels = [item["label"] for item in address_suggestions]
            selected_suggestion = st.selectbox(
                "Suggestions",
                options=[""] + [item for item in suggestion_labels if item != manual_address],
                key="manual_lead_address_suggestion",
            )
            if selected_suggestion and selected_suggestion != manual_address:
                selected_payload = next(
                    (item for item in address_suggestions if item["label"] == selected_suggestion),
                    None,
                )
                if selected_payload:
                    st.session_state["manual_lead_address"] = selected_payload.get("address") or selected_suggestion
                    st.session_state["manual_lead_city"] = selected_payload.get("city") or ""
                    st.session_state["manual_lead_state"] = selected_payload.get("state") or ""
                    st.session_state["manual_lead_zip"] = selected_payload.get("zipcode") or ""
                st.rerun()
        manual_city = add_col2.text_input("City", key="manual_lead_city")
        add_col3, add_col4 = st.columns(2)
        manual_state = add_col3.text_input("State", key="manual_lead_state")
        manual_zip = add_col4.text_input(
            "ZIP",
            key="manual_lead_zip",
            on_change=normalize_manual_address_fields,
        )
        add_col5, add_col6 = st.columns(2)
        manual_first_name = add_col5.text_input("First Name", key="manual_lead_first_name")
        manual_last_name = add_col6.text_input("Last Name", key="manual_lead_last_name")
        add_col7, add_col8 = st.columns(2)
        manual_phone = add_col7.text_input(
            "Phone",
            key="manual_lead_phone",
            on_change=format_phone_state_value,
            args=("manual_lead_phone",),
        )
        manual_email = add_col8.text_input("Email", key="manual_lead_email")
        manual_notes = st.text_area(
            "Notes",
            key="manual_lead_notes",
            height=90,
            placeholder="Anything the rep learned in the field.",
        )
        if st.button("Save Lead", key="manual_lead_save", use_container_width=True):
            create_result = create_manual_lead(
                {
                    "address": manual_address,
                    "city": manual_city,
                    "state": manual_state,
                    "zipcode": manual_zip,
                    "first_name": manual_first_name,
                    "last_name": manual_last_name,
                    "phone": manual_phone,
                    "email": manual_email,
                    "notes": manual_notes,
                },
                auth_context=auth_context,
            )
            if create_result.get("ok"):
                if create_result.get("assigned_to_current_user"):
                    st.success("Lead saved and assigned to you.")
                else:
                    st.success("Lead already existed. Details were refreshed without changing the current assignment.")
                if create_result.get("lead_id"):
                    st.session_state["selected_lead_id"] = create_result["lead_id"]
                st.rerun()
            else:
                st.warning(create_result.get("error") or "Could not save lead.")

    people_lookup = {}
    if current_app_user and current_app_user.get("id"):
        people_lookup[current_app_user["id"]] = (
            current_app_user.get("full_name") or current_app_user.get("email") or current_app_user["id"]
        )
    for person in get_rep_options(auth_context=auth_context):
        if person.get("id"):
            people_lookup[person["id"]] = person.get("full_name") or person.get("email") or person["id"]

    rep_options = get_rep_options(auth_context=auth_context)
    rep_lookup = {
        (person.get("full_name") or person.get("email") or person.get("id")): person.get("id")
        for person in rep_options
        if person.get("id")
    }
    selected_lead_id = st.session_state.get("selected_lead_id")
    selected_lead = None
    if selected_lead_id:
        selected_lead_row = get_visible_lead_by_id(selected_lead_id, auth_context=auth_context)
        if not selected_lead_row:
            st.session_state.pop("selected_lead_id", None)
            st.rerun()
        selected_lead = build_prepared_lead_row(selected_lead_row, people_lookup)

    prepared_rows = []
    total_leads_in_scope = 0
    filtered_rows = []
    if not selected_lead:
        lead_rows = get_visible_leads(auth_context=auth_context)
        total_leads_in_scope = get_org_lead_count(auth_context=auth_context)
        if not lead_rows:
            if can_access_manager_workspace(active_org_role):
                st.info("No leads are stored for this organization yet.")
            else:
                st.info("No leads assigned to you or created by you are stored yet.")
            return

        prepared_rows = [build_prepared_lead_row(row, people_lookup) for row in lead_rows]
        prepared_rows = [row for row in prepared_rows if is_open_crm_lead_row(row)]
        if not prepared_rows:
            st.info("No CRM-open leads are available in this view yet.")
            return

    if not selected_lead:
        search_col, status_col, assignment_col, owner_col = st.columns([1.35, 0.8, 0.8, 1.0])
        search_term = search_col.text_input(
            "Search Leads",
            placeholder="Address, homeowner, phone, email, or owner",
            key="leads_search",
        ).strip().lower()
        status_filter = status_col.selectbox(
            "Status",
            options=["All"] + sorted({row["Status"] for row in prepared_rows}),
            key="leads_status_filter",
        )
        assignment_filter = assignment_col.selectbox(
            "Assignment",
            options=["All"] + sorted({row["Assignment"] for row in prepared_rows}),
            key="leads_assignment_filter",
        )
        assigned_to_filter = owner_col.selectbox(
            "Assigned To",
            options=["All"] + sorted({row["Assigned To"] for row in prepared_rows}),
            key="leads_assigned_to_filter",
        )
        extra_filter_cols = st.columns(6)
        zip_filter = extra_filter_cols[0].multiselect(
            "ZIP Codes",
            options=sorted({row["ZIP"] for row in prepared_rows if row["ZIP"]}),
            key="leads_zipcodes_filter",
        )
        city_filter = extra_filter_cols[1].multiselect(
            "Cities",
            options=sorted({row["City"] for row in prepared_rows if row["City"] and row["City"] != "Unknown"}),
            key="leads_cities_filter",
        )
        date_field_filter = extra_filter_cols[2].selectbox(
            "Date Field",
            options=["Sold Date", "Permit Pulled"],
            key="leads_date_field_filter",
        )
        min_price_filter = extra_filter_cols[3].number_input(
            "Min Price",
            min_value=0,
            value=0,
            step=50000,
            key="leads_min_price_filter",
        )
        min_sun_filter = extra_filter_cols[4].number_input(
            "Min Sun Hrs",
            min_value=0.0,
            value=0.0,
            step=50.0,
            key="leads_min_sun_filter",
        )
        from_date_filter = extra_filter_cols[5].date_input(
            "From Date",
            value=None,
            key="leads_from_date_filter",
        )

        selected_date_field = "Sold Date" if date_field_filter == "Sold Date" else "Permit Pulled"
        filtered_rows = [
            row
            for row in prepared_rows
            if (not search_term or search_term in row["_search_blob"])
            and (status_filter == "All" or row["Status"] == status_filter)
            and (assignment_filter == "All" or row["Assignment"] == assignment_filter)
            and (assigned_to_filter == "All" or row["Assigned To"] == assigned_to_filter)
            and (not zip_filter or row["ZIP"] in zip_filter)
            and (not city_filter or row["City"] in city_filter)
            and (min_price_filter <= 0 or row["Sale Price"] is None or row["Sale Price"] >= float(min_price_filter))
            and (min_sun_filter <= 0 or row["Sun Hours"] is None or row["Sun Hours"] >= float(min_sun_filter))
            and (
                not from_date_filter
                or (
                    parse_filterable_month(row.get(selected_date_field))
                    and parse_filterable_month(row.get(selected_date_field)) >= from_date_filter
                )
            )
        ]

        metric_cols = st.columns(4)
        metric_cols[0].metric("Total Leads In Org", total_leads_in_scope)
        metric_cols[1].metric("Loaded In Tab", len(prepared_rows))
        metric_cols[2].metric("Filtered Results", len(filtered_rows))
        metric_cols[3].metric("Qualified", sum(1 for row in filtered_rows if row["Qualified"] == "Yes"))

        if not filtered_rows:
            st.info("No leads matched the current filters.")
            return

    if selected_lead:
        back_col, title_col = st.columns([0.22, 0.78])
        if back_col.button("Back", key="lead_detail_back", use_container_width=True):
            st.session_state.pop("selected_lead_id", None)
            st.rerun()
        title_col.markdown(f"### {selected_lead['Address']}")

        lead_form_keys = initialize_lead_activity_form_state(selected_lead["Lead ID"], selected_lead)
        activity_rows = get_lead_activity_rows(selected_lead["Lead ID"], auth_context=auth_context)
        analysis_snapshot = get_lead_analysis_snapshot(selected_lead["Lead ID"], auth_context=auth_context)
        top_cols = st.columns(5)
        top_cols[0].metric("Follow-Up Status", selected_lead["Lead Status"])
        top_cols[1].metric("Next Follow-Up Due", format_follow_up_datetime(selected_lead["Next Follow-Up"]))
        top_cols[2].metric("Last Activity", selected_lead["Last Activity Type"] or "None")
        top_cols[3].metric("Last Outcome", selected_lead["Last Activity Outcome"] or "None")
        top_cols[4].metric("Appointment", format_follow_up_datetime(selected_lead["Appointment At"]))
        st.caption(
            f"Flags: {lead_flag_badges(selected_lead['Flags'])} · "
            f"Next recommended step: {selected_lead['Next Recommended Step'] or 'Call first, then text if no answer'}"
        )

        secondary_col1, secondary_col2 = st.columns(2)
        secondary_col1.markdown(f"**First Outreach:** {format_follow_up_datetime(selected_lead['First Outreach'])}")
        secondary_col1.markdown(f"**First Meaningful Contact:** {format_follow_up_datetime(selected_lead['First Meaningful Contact'])}")
        secondary_col1.markdown(f"**Last Meaningful Contact:** {format_follow_up_datetime(selected_lead['Last Meaningful Contact'])}")
        secondary_col2.markdown(f"**Qualification State:** {selected_lead['Qualified']}")
        secondary_col2.markdown(f"**Assignment:** {selected_lead['Assignment']}")
        secondary_col2.markdown(f"**Assigned To:** {selected_lead['Assigned To']}")
        secondary_col2.markdown(f"**Created By:** {selected_lead['Created By']}")
        if selected_lead["Unqualified Reason"]:
            st.markdown(f"**Unqualified Reason:** {selected_lead['Unqualified Reason']}")

        with st.expander("Home Info", expanded=False):
            info_entries = home_info_entries(analysis_snapshot)
            if info_entries:
                info_col1, info_col2 = st.columns(2)
                midpoint = math.ceil(len(info_entries) / 2)
                for col, entries in zip([info_col1, info_col2], [info_entries[:midpoint], info_entries[midpoint:]]):
                    for label, value in entries:
                        col.markdown(f"**{label}:** {value}")
            else:
                st.caption("No property details are stored for this lead yet.")

        st.markdown("#### Lead Details")
        detail_col1, detail_col2 = st.columns(2)
        edit_first_name = detail_col1.text_input(
            "First Name",
            value=(selected_lead["Homeowner"].split(" ", 1)[0] if selected_lead["Homeowner"] else ""),
            key=f"lead_detail_first_{selected_lead['Lead ID']}",
        )
        edit_last_name = detail_col2.text_input(
            "Last Name",
            value=(selected_lead["Homeowner"].split(" ", 1)[1] if selected_lead["Homeowner"] and " " in selected_lead["Homeowner"] else ""),
            key=f"lead_detail_last_{selected_lead['Lead ID']}",
        )
        detail_col3, detail_col4 = st.columns(2)
        edit_phone_key = f"lead_detail_phone_{selected_lead['Lead ID']}"
        edit_phone = detail_col3.text_input(
            "Phone",
            value=selected_lead["Phone"],
            key=edit_phone_key,
            on_change=format_phone_state_value,
            args=(edit_phone_key,),
        )
        edit_email = detail_col4.text_input("Email", value=selected_lead["Email"], key=f"lead_detail_email_{selected_lead['Lead ID']}")
        detail_col5, detail_col6 = st.columns(2)
        edit_lead_status = detail_col5.selectbox(
            "Follow-Up Status",
            options=LEAD_STATUS_OPTIONS,
            index=LEAD_STATUS_OPTIONS.index(selected_lead["Lead Status"]) if selected_lead["Lead Status"] in LEAD_STATUS_OPTIONS else 0,
            key=f"lead_detail_status_{selected_lead['Lead ID']}",
        )
        edit_nurture_reason = detail_col6.selectbox(
            "Nurture Reason",
            options=[""] + NURTURE_REASON_OPTIONS,
            index=([""] + NURTURE_REASON_OPTIONS).index(selected_lead["Nurture Reason"]) if selected_lead["Nurture Reason"] in ([""] + NURTURE_REASON_OPTIONS) else 0,
            key=f"lead_detail_nurture_{selected_lead['Lead ID']}",
        )
        if st.button("Save Lead Details", key=f"lead_detail_save_{selected_lead['Lead ID']}", use_container_width=True):
            if update_lead_core_details(
                selected_lead["Lead ID"],
                {
                    "first_name": edit_first_name.strip(),
                    "last_name": edit_last_name.strip(),
                    "phone": edit_phone.strip(),
                    "email": edit_email.strip(),
                    "lead_status": edit_lead_status,
                    "nurture_reason": edit_nurture_reason,
                    "unqualified": selected_lead["Qualified"] == "No",
                    "unqualified_reason": selected_lead["Unqualified Reason"],
                },
                auth_context=auth_context,
            ):
                if edit_lead_status != selected_lead["Lead Status"]:
                    add_lead_activity(
                        selected_lead["Lead ID"],
                        activity_type="Status Changed",
                        outcome="Do Not Contact" if edit_lead_status == "Do Not Contact" else None,
                        note_body=f"Lead status changed from {selected_lead['Lead Status']} to {edit_lead_status}.",
                        event_metadata={"source": "lead_detail_edit", "manual_status": edit_lead_status},
                        auth_context=auth_context,
                    )
                st.success("Lead details updated.")
                st.rerun()
            st.warning("Could not update lead details.")

        if can_access_manager_workspace(active_org_role):
            assignment_labels = ["Unassigned"] + sorted(rep_lookup.keys())
            current_assignment_label = selected_lead["Assigned To"] if selected_lead["Assigned To"] in assignment_labels else "Unassigned"
            assign_col1, assign_col2 = st.columns([1.3, 0.8])
            selected_assignment = assign_col1.selectbox(
                "Assign To Rep",
                options=assignment_labels,
                index=assignment_labels.index(current_assignment_label),
                key=f"lead_assign_select_{selected_lead['Lead ID']}",
            )
            if assign_col2.button("Save Assignment", key=f"lead_assign_save_{selected_lead['Lead ID']}", use_container_width=True):
                selected_rep_id = rep_lookup.get(selected_assignment)
                if update_lead_assignment(selected_lead["Lead ID"], assigned_to=selected_rep_id, auth_context=auth_context):
                    st.success("Lead assignment updated.")
                    st.rerun()
                st.warning("Could not update lead assignment.")

        st.markdown("#### Quick Actions")
        quick_action_cols = st.columns(len(LEAD_CARD_QUICK_ACTIONS))
        selected_action = st.session_state.get(lead_form_keys["selected_action"], "")
        for index, action_config in enumerate(LEAD_CARD_QUICK_ACTIONS):
            is_selected_action = selected_action == action_config["label"]
            if quick_action_cols[index].button(
                action_config["icon"],
                key=f"lead_quick_{selected_lead['Lead ID']}_{action_config['label']}",
                help=action_config["help"],
                type="primary" if is_selected_action else "secondary",
                use_container_width=True,
            ):
                apply_lead_quick_action(selected_lead["Lead ID"], selected_lead, activity_rows, action_config["label"])
                st.rerun()
        if selected_action:
            st.caption(f"Selected action: {selected_action}")
            if selected_action == "Not Home":
                next_attempt = min(count_not_home_attempts(activity_rows) + 1, 3)
                st.caption(f"This will preserve the operational attempt marker as Not Home {next_attempt}.")

        st.markdown("#### Log Activity")
        activity_type = st.session_state.get(lead_form_keys["activity_type"], "Note")
        if activity_type not in ACTIVITY_TYPE_OPTIONS:
            st.session_state[lead_form_keys["activity_type"]] = "Note"
            activity_type = "Note"
        activity_type = st.selectbox("Activity Type", options=ACTIVITY_TYPE_OPTIONS, key=lead_form_keys["activity_type"])
        allowed_outcomes = [""] + allowed_outcomes_for_activity(activity_type)
        if st.session_state.get(lead_form_keys["outcome"], "") not in allowed_outcomes:
            st.session_state[lead_form_keys["outcome"]] = ""
        activity_outcome = st.selectbox("Outcome", options=allowed_outcomes, key=lead_form_keys["outcome"])
        activity_col1, activity_col2 = st.columns(2)
        activity_date = activity_col1.date_input("Activity Date", key=lead_form_keys["date"])
        activity_time = activity_col2.time_input("Activity Time", step=1800, key=lead_form_keys["time"])
        note_body = st.text_area(
            "History Note",
            placeholder="What happened, what you learned, and what should happen next.",
            key=lead_form_keys["note"],
            height=120,
        )
        requested_callback_date = None
        requested_callback_time = None
        if activity_outcome == "Requested Callback":
            callback_col1, callback_col2 = st.columns(2)
            requested_callback_date = callback_col1.date_input("Requested Callback Date", key=lead_form_keys["callback_date"])
            requested_callback_time = callback_col2.time_input("Requested Callback Time", step=1800, key=lead_form_keys["callback_time"])

        appointment_date = None
        appointment_time = None
        if activity_type in {"Appointment Set", "Appointment Rescheduled"}:
            appointment_col1, appointment_col2 = st.columns(2)
            appointment_date = appointment_col1.date_input("Appointment Date", key=lead_form_keys["appointment_date"])
            appointment_time = appointment_col2.time_input("Appointment Time", step=1800, key=lead_form_keys["appointment_time"])

        nurture_reason = ""
        if activity_outcome == "Needs Nurture":
            nurture_reason = st.selectbox("Nurture Reason", options=[""] + NURTURE_REASON_OPTIONS, key=lead_form_keys["nurture_reason"])

        scheduled_follow_up_date = None
        scheduled_follow_up_time = None
        if st.session_state.get(lead_form_keys["selected_action"]) == "Follow-Up / Snooze":
            follow_up_col1, follow_up_col2 = st.columns(2)
            scheduled_follow_up_date = follow_up_col1.date_input("Next Follow-Up Date", key=lead_form_keys["follow_up_date"])
            scheduled_follow_up_time = follow_up_col2.time_input("Next Follow-Up Time", step=1800, key=lead_form_keys["follow_up_time"])

        manual_status = st.session_state.get(lead_form_keys["manual_status"], "")
        requires_confirm = bool(LEAD_CARD_QUICK_ACTION_LOOKUP.get(selected_action, {}).get("requires_confirm"))
        confirm_action = True
        if requires_confirm:
            confirm_action = st.checkbox(
                f"Confirm {manual_status or selected_action}",
                key=lead_form_keys["confirm"],
            )

        activity_timestamp = datetime.combine(activity_date, activity_time).isoformat()
        callback_timestamp = (
            datetime.combine(requested_callback_date, requested_callback_time).isoformat()
            if requested_callback_date and requested_callback_time
            else None
        )
        appointment_timestamp = (
            datetime.combine(appointment_date, appointment_time).isoformat()
            if appointment_date and appointment_time
            else None
        )
        follow_up_timestamp = (
            datetime.combine(scheduled_follow_up_date, scheduled_follow_up_time).isoformat()
            if scheduled_follow_up_date and scheduled_follow_up_time
            else None
        )
        if st.button("Save Activity", key=f"lead_activity_save_{selected_lead['Lead ID']}", use_container_width=True):
            if requires_confirm and not confirm_action:
                st.warning(f"Please confirm before marking this lead as {manual_status or selected_action}.")
                st.stop()
            event_metadata = {"source": "lead_card"}
            if manual_status:
                event_metadata["manual_status"] = manual_status
            if selected_action == "Follow-Up / Snooze" and follow_up_timestamp:
                event_metadata["scheduled_follow_up_at"] = follow_up_timestamp
            if selected_action == "Not Home":
                attempt_number = min(count_not_home_attempts(activity_rows) + 1, 3)
                event_metadata["attempt_number"] = attempt_number
                event_metadata["route_attempt_status"] = f"Not Home {attempt_number}"
            if add_lead_activity(
                selected_lead["Lead ID"],
                activity_type=activity_type,
                outcome=activity_outcome or None,
                note_body=note_body.strip(),
                activity_at=activity_timestamp,
                requested_callback_at=callback_timestamp if activity_outcome == "Requested Callback" else None,
                appointment_at=appointment_timestamp if activity_type in {"Appointment Set", "Appointment Rescheduled"} else None,
                nurture_reason=nurture_reason or None,
                event_metadata=event_metadata,
                auth_context=auth_context,
            ):
                for key, value in {
                    lead_form_keys["selected_action"]: "",
                    lead_form_keys["activity_type"]: "Note",
                    lead_form_keys["outcome"]: "",
                    lead_form_keys["note"]: "",
                    lead_form_keys["manual_status"]: "",
                    lead_form_keys["confirm"]: False,
                }.items():
                    st.session_state[key] = value
                st.success("Activity saved.")
                st.rerun()
            st.warning("Could not save activity.")

        st.markdown("#### Activity History")
        if selected_lead["Notes"]:
            st.caption(f"Imported note: {selected_lead['Notes']}")
        if activity_rows:
            for item in activity_rows:
                activity_header_cols = st.columns([1.6, 1.1, 0.9, 0.8])
                activity_header_cols[0].markdown(f"**{item.get('activity_type')}**  \n{item.get('note_body') or 'No note'}")
                activity_header_cols[1].write(item.get("outcome") or "No outcome")
                activity_header_cols[2].write(format_follow_up_datetime(item.get("activity_at")))
                if can_access_manager_workspace(active_org_role) and item.get("activity_type") == "Note":
                    if activity_header_cols[3].button("Delete", key=f"delete_activity_{item['id']}", use_container_width=True):
                        if delete_lead_activity(item["id"], selected_lead["Lead ID"], auth_context=auth_context):
                            st.success("Activity deleted.")
                            st.rerun()
                        st.warning("Could not delete activity.")
                else:
                    activity_header_cols[3].write("")
        else:
            st.info("No lead activity has been logged yet.")
        return

    page_control_col1, page_control_col2, page_control_col3 = st.columns([0.8, 0.8, 1.4])
    page_size = page_control_col1.selectbox("Leads Per Page", options=[25, 50, 75, 100], index=0, key="leads_page_size")
    total_pages = max(1, math.ceil(len(filtered_rows) / page_size))
    current_page = min(st.session_state.get("leads_page_number", 1), total_pages)
    current_page = page_control_col2.number_input("Page", min_value=1, max_value=total_pages, value=current_page, step=1, key="leads_page_number")
    page_control_col3.caption(f"Showing page {current_page} of {total_pages} · {len(filtered_rows)} matching leads")

    start_index = (current_page - 1) * page_size
    end_index = start_index + page_size
    paged_rows = filtered_rows[start_index:end_index]

    st.markdown("#### Leads")
    list_header_cols = st.columns([1.8, 1.1, 1.0, 0.9, 0.8])
    list_header_cols[0].caption("Lead")
    list_header_cols[1].caption("Assigned To")
    list_header_cols[2].caption("Status")
    list_header_cols[3].caption("Updated")
    list_header_cols[4].caption("")

    for row in paged_rows:
        row_cols = st.columns([1.8, 1.1, 1.0, 0.9, 0.8])
        lead_label = row["Homeowner"] or row["Address"]
        row_cols[0].markdown(f"**{lead_label}**  \n{row['Address']}")
        row_cols[1].write(row["Assigned To"])
        row_cols[2].write(row["Status"])
        row_cols[3].write(row["Updated"])
        if row_cols[4].button("Open", key=f"lead_open_{row['Lead ID']}", use_container_width=True):
            st.session_state["selected_lead_id"] = row["Lead ID"]
            st.rerun()


def build_team_activity_frames(auth_context):
    activity_rows = get_team_route_activity(auth_context=auth_context) if auth_context else []
    if not activity_rows:
        empty_scoreboard = pd.DataFrame(
            columns=["Rep", "rep_id", "Doors Knocked", "Appointments Set", "Marketing Qualified Leads", "Closed Customers"]
        )
        empty_calendar = pd.DataFrame(columns=["rep_id", "Rep", "Address", "Appointment", "Phone", "Email", "Status"])
        empty_activity = pd.DataFrame(
            columns=["rep_id", "Rep", "Address", "Disposition", "Interest Level", "Stop Status", "Completed At"]
        )
        return empty_scoreboard, empty_calendar, empty_activity

    scoreboard = {}
    calendar_rows = []
    activity_frame_rows = []
    for row in activity_rows:
        rep_id = row.get("rep_id") or row.get("rep_name")
        rep_name = row.get("rep_name") or "Unknown Rep"
        record = scoreboard.setdefault(
            rep_id,
            {
                "Rep": rep_name,
                "rep_id": rep_id,
                "Doors Knocked": 0,
                "Appointments Set": 0,
                "Marketing Qualified Leads": 0,
                "Closed Customers": 0,
            },
        )
        outcome_value = str(row.get("outcome") or "").strip()
        outcome = outcome_value.lower()
        disposition_value = str(row.get("disposition") or outcome_value or "").strip()
        disposition = disposition_value.lower()
        interest_level = str(row.get("interest_level") or "").strip().lower()
        if str(row.get("stop_status") or "").lower() == "completed":
            record["Doors Knocked"] += 1
        if row.get("best_follow_up_time"):
            record["Appointments Set"] += 1
            calendar_rows.append(
                {
                    "rep_id": rep_id,
                    "Rep": rep_name,
                    "Address": row.get("address") or "",
                    "Appointment": row.get("best_follow_up_time") or "",
                    "Phone": row.get("phone") or "",
                    "Email": row.get("email") or "",
                    "Status": disposition_value or "Scheduled",
                }
            )
        if interest_level in {"hot", "warm"} or outcome in {"interested", "requested callback", "booked appointment", "qualified"}:
            record["Marketing Qualified Leads"] += 1
        if disposition in {"closed", "closed won"} or outcome == "qualified":
            record["Closed Customers"] += 1
        activity_frame_rows.append(
            {
                "rep_id": rep_id,
                "Rep": rep_name,
                "Address": row.get("address") or "",
                "Disposition": disposition_value,
                "Outcome": outcome_value,
                "Interest Level": interest_level.title() if interest_level else "",
                "Stop Status": str(row.get("stop_status") or "").title(),
                "Completed At": row.get("completed_at") or row.get("started_at") or "",
            }
        )

    scoreboard_df = pd.DataFrame(scoreboard.values()).sort_values(
        ["Doors Knocked", "Appointments Set", "Marketing Qualified Leads", "Closed Customers", "Rep"],
        ascending=[False, False, False, False, True],
    ).reset_index(drop=True)
    calendar_df = pd.DataFrame(calendar_rows)
    activity_df = pd.DataFrame(activity_frame_rows)
    if not activity_df.empty:
        activity_df["Completed At"] = pd.to_datetime(activity_df["Completed At"], errors="coerce")
        activity_df["Day"] = activity_df["Completed At"].dt.strftime("%Y-%m-%d")
    return scoreboard_df, calendar_df, activity_df


def filter_leaderboard_activity(activity_df, date_filter):
    if activity_df.empty or "Completed At" not in activity_df.columns:
        return activity_df

    filtered_df = activity_df.dropna(subset=["Completed At"]).copy()
    if filtered_df.empty:
        return filtered_df

    now = datetime.now()
    today_start = datetime(now.year, now.month, now.day)

    if date_filter == "Today":
        return filtered_df[filtered_df["Completed At"] >= today_start]
    if date_filter == "This Week":
        week_start = today_start - timedelta(days=today_start.weekday())
        return filtered_df[filtered_df["Completed At"] >= week_start]
    if date_filter == "This Month":
        month_start = datetime(now.year, now.month, 1)
        return filtered_df[filtered_df["Completed At"] >= month_start]
    if date_filter == "YTD":
        year_start = datetime(now.year, 1, 1)
        return filtered_df[filtered_df["Completed At"] >= year_start]
    return filtered_df


def build_leaderboard_frame_from_activity(activity_df):
    if activity_df.empty:
        return pd.DataFrame(
            columns=["Rep", "rep_id", "Doors Knocked", "Appointments Set", "Marketing Qualified Leads", "Closed Customers"]
        )

    leaderboard_rows = []
    for (rep_id, rep_name), rep_df in activity_df.groupby(["rep_id", "Rep"], dropna=False):
        dispositions = rep_df["Disposition"].fillna("").str.lower()
        outcomes = rep_df["Outcome"].fillna("").str.lower() if "Outcome" in rep_df.columns else dispositions
        interest_levels = rep_df["Interest Level"].fillna("").str.lower()
        stop_statuses = rep_df["Stop Status"].fillna("").str.lower()
        leaderboard_rows.append(
            {
                "Rep": rep_name,
                "rep_id": rep_id,
                "Doors Knocked": int((stop_statuses == "completed").sum()),
                "Appointments Set": int(((dispositions == "appt set") | (outcomes == "booked appointment")).sum()),
                "Marketing Qualified Leads": int(
                    ((interest_levels.isin(["hot", "warm"])) | (outcomes.isin(["interested", "requested callback", "booked appointment", "qualified"]))).sum()
                ),
                "Closed Customers": int(((dispositions == "closed") | (outcomes == "qualified")).sum()),
            }
        )

    return pd.DataFrame(leaderboard_rows).sort_values(
        ["Doors Knocked", "Appointments Set", "Marketing Qualified Leads", "Closed Customers", "Rep"],
        ascending=[False, False, False, False, True],
    ).reset_index(drop=True)


def parse_appointment_label(appointment_label):
    appointment_text = str(appointment_label or "").strip()
    if not appointment_text:
        return None
    for pattern in ["%b %d, %Y at %I:%M %p", "%b %d, %Y"]:
        try:
            return datetime.strptime(appointment_text, pattern)
        except Exception:
            continue
    return None


def build_calendar_schedule_frame(calendar_df):
    if calendar_df.empty:
        return pd.DataFrame(columns=["rep_id", "Rep", "Address", "Appointment", "Phone", "Email", "Status", "appointment_dt", "day_key"])

    schedule_df = calendar_df.copy()
    schedule_df["appointment_dt"] = schedule_df["Appointment"].apply(parse_appointment_label)
    schedule_df = schedule_df.dropna(subset=["appointment_dt"]).sort_values("appointment_dt").reset_index(drop=True)
    if schedule_df.empty:
        return schedule_df
    schedule_df["day_key"] = schedule_df["appointment_dt"].dt.strftime("%Y-%m-%d")
    return schedule_df


def appointment_slot_options():
    slots = []
    start_of_day = datetime.now().replace(hour=9, minute=0, second=0, microsecond=0)
    for step in range(18):
        slot_time = (start_of_day + timedelta(minutes=30 * step)).time()
        slots.append(slot_time.strftime("%I:%M %p"))
    return slots


def render_calendar_month_selector(calendar_df, selected_date, key_prefix):
    today = datetime.now().date()
    visible_month = st.session_state.get(f"{key_prefix}_visible_month", today.replace(day=1))
    if isinstance(visible_month, datetime):
        visible_month = visible_month.date().replace(day=1)

    nav_col1, nav_col2, nav_col3 = st.columns([0.9, 1.6, 0.9])
    if nav_col1.button("Previous", key=f"{key_prefix}_prev_month", use_container_width=True):
        previous_month = (visible_month.replace(day=1) - timedelta(days=1)).replace(day=1)
        st.session_state[f"{key_prefix}_visible_month"] = previous_month
        st.rerun()
    nav_col2.markdown(
        f"<div style='text-align:center;font-weight:700;padding-top:0.4rem;'>{visible_month.strftime('%B %Y')}</div>",
        unsafe_allow_html=True,
    )
    if nav_col3.button("Next", key=f"{key_prefix}_next_month", use_container_width=True):
        next_month = (visible_month.replace(day=28) + timedelta(days=4)).replace(day=1)
        st.session_state[f"{key_prefix}_visible_month"] = next_month
        st.rerun()

    weekday_cols = st.columns(7)
    for col, weekday in zip(weekday_cols, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]):
        col.caption(weekday)

    appointment_counts = {}
    if not calendar_df.empty and "day_key" in calendar_df.columns:
        appointment_counts = calendar_df.groupby("day_key").size().to_dict()

    month_matrix = calendar.Calendar(firstweekday=0).monthdatescalendar(visible_month.year, visible_month.month)
    for week_index, week in enumerate(month_matrix):
        week_cols = st.columns(7)
        for day_col, day_value in zip(week_cols, week):
            in_visible_month = day_value.month == visible_month.month
            is_past = day_value < today
            day_key = day_value.strftime("%Y-%m-%d")
            appt_count = int(appointment_counts.get(day_key, 0))
            is_selected = selected_date == day_value
            label = f"{day_value.day}"
            if appt_count:
                label = f"{label}\n{appt_count} appt"
            if not in_visible_month:
                day_col.markdown(
                    f"<div style='padding:0.9rem 0.2rem;border:1px solid #1b2335;border-radius:0.7rem;"
                    f"opacity:0.35;text-align:center;'>{day_value.day}</div>",
                    unsafe_allow_html=True,
                )
                continue
            button_help = "Past days cannot be selected." if is_past else "Click to view times."
            if day_col.button(
                label,
                key=f"{key_prefix}_day_{week_index}_{day_value.isoformat()}",
                use_container_width=True,
                disabled=is_past,
                help=button_help,
                type="primary" if is_selected else "secondary",
            ):
                st.session_state[f"{key_prefix}_selected_date"] = day_value
                st.rerun()


def render_calendar_hub(current_app_user, auth_context, active_org_role):
    st.markdown('<div class="siq-section">Calendar</div>', unsafe_allow_html=True)
    st.markdown("Use the live calendar to review booked appointments, click a future day, and schedule an open time.")

    scoreboard_df, calendar_df, _activity_df = build_team_activity_frames(auth_context)
    if not can_access_manager_workspace(active_org_role) and current_app_user:
        current_rep_id = current_app_user.get("id")
        if not calendar_df.empty and current_rep_id:
            calendar_df = calendar_df[calendar_df["rep_id"] == current_rep_id]
        if not scoreboard_df.empty and current_rep_id:
            scoreboard_df = scoreboard_df[scoreboard_df["rep_id"] == current_rep_id]

    schedule_df = build_calendar_schedule_frame(calendar_df)

    metric_cols = st.columns(3)
    metric_cols[0].metric("Upcoming Appointments", len(schedule_df))
    metric_cols[1].metric("Reps With Appointments", schedule_df["Rep"].nunique() if not schedule_df.empty else 0)
    metric_cols[2].metric("Loaded Route Stops", len(st.session_state.get("all_results", [])))

    availability_mode = st.radio(
        "Conflict Source",
        options=["Lumino appointments", "Google Calendar (coming soon)"],
        horizontal=True,
        key="calendar_conflict_source",
    )
    if availability_mode == "Google Calendar (coming soon)":
        st.caption("Google Calendar conflict checking is not connected yet, so available times below are currently based on appointments already scheduled in Lumino.")

    today = datetime.now().date()
    if f"calendar_view_selected_date" not in st.session_state:
        st.session_state["calendar_view_selected_date"] = today
    if "calendar_view_visible_month" not in st.session_state:
        st.session_state["calendar_view_visible_month"] = today.replace(day=1)

    calendar_col, detail_col = st.columns([1.25, 0.95], gap="large")
    with calendar_col:
        st.markdown("#### Appointment Calendar")
        render_calendar_month_selector(
            schedule_df,
            st.session_state.get("calendar_view_selected_date"),
            "calendar_view",
        )

    with detail_col:
        selected_date = st.session_state.get("calendar_view_selected_date", today)
        if isinstance(selected_date, datetime):
            selected_date = selected_date.date()
        selected_day_key = selected_date.strftime("%Y-%m-%d")
        day_schedule_df = schedule_df[schedule_df["day_key"] == selected_day_key].copy() if not schedule_df.empty else schedule_df
        st.markdown(f"#### {selected_date.strftime('%A, %b %d')}")
        if day_schedule_df.empty:
            st.info("No appointments scheduled for this day yet.")
        else:
            day_schedule_df["Time"] = day_schedule_df["appointment_dt"].dt.strftime("%I:%M %p")
            st.dataframe(
                day_schedule_df[["Time", "Rep", "Address", "Phone", "Status"]],
                use_container_width=True,
                hide_index=True,
                height=220,
            )

    visible_lead_rows = get_visible_leads(auth_context=auth_context) if auth_context else []
    route_results = st.session_state.get("all_results", [])
    route_execution = st.session_state.get("route_execution", {})

    lead_options = {}
    for row in visible_lead_rows:
        address = row.get("address")
        if not address:
            continue
        lead_options[address] = {
            "lead_id": row.get("id"),
            "address": address,
            "lat": row.get("lat"),
            "lng": row.get("lng"),
            "zipcode": row.get("zipcode"),
            "phone": row.get("phone"),
            "email": row.get("email"),
            "first_name": row.get("first_name"),
            "last_name": row.get("last_name"),
            "notes": row.get("notes"),
            "route_run_stop_id": None,
            "route_run_status": str(row.get("status") or "pending").lower(),
        }
    for result in route_results:
        if result.get("address"):
            lead_options[result["address"]] = result

    if not lead_options:
        st.caption("No visible leads are available to schedule yet.")
        return
    st.markdown("#### Set Appointment")
    if selected_date < today:
        st.caption("Choose today or a future day on the calendar to schedule a new appointment.")
        return

    appointment_address = st.selectbox("Lead", options=list(lead_options.keys()), key="calendar_lead_select")
    selected_result = lead_options[appointment_address]
    selected_property_id = make_property_id("primary_stop", appointment_address)
    active_entry = route_execution.setdefault(selected_property_id, default_execution_entry())
    if not active_entry.get("homeowner_name"):
        active_entry["homeowner_name"] = " ".join(
            part.strip()
            for part in [selected_result.get("first_name") or "", selected_result.get("last_name") or ""]
            if part and str(part).strip()
        ).strip()
    if not active_entry.get("phone"):
        active_entry["phone"] = selected_result.get("phone") or ""
    if not active_entry.get("email"):
        active_entry["email"] = selected_result.get("email") or ""
    if not active_entry.get("notes"):
        active_entry["notes"] = selected_result.get("notes") or ""

    booked_slots = set()
    if not day_schedule_df.empty:
        booked_slots = set(day_schedule_df["appointment_dt"].dt.strftime("%I:%M %p").tolist())
    available_slots = [slot for slot in appointment_slot_options() if slot not in booked_slots]
    slot_col1, slot_col2 = st.columns([1.1, 0.9])
    selected_slot = slot_col1.selectbox(
        "Available Time",
        options=available_slots if available_slots else ["No open times"],
        key="calendar_time_slot",
        disabled=not bool(available_slots),
    )
    slot_col2.metric("Booked Times", len(booked_slots))
    if booked_slots:
        st.caption("Reserved: " + ", ".join(sorted(booked_slots)))

    appointment_time = None
    if available_slots:
        appointment_time = datetime.strptime(selected_slot, "%I:%M %p").time()
    appointment_label = format_follow_up_slot(selected_date, appointment_time) if appointment_time else ""
    if st.button("Save Appointment", use_container_width=True):
        if not appointment_time:
            st.warning("No available time is open on the selected day.")
        else:
            active_entry["best_follow_up_time"] = appointment_label
            active_entry["appointment_status"] = "Scheduled"
            active_entry["status"] = "Appt Set"
            active_entry["lead_stage"] = "Appointment Set"
            active_entry["next_action"] = "Confirm Appointment"
            append_activity_event(active_entry, "Appointment", f"Appointment scheduled for {appointment_label}")
            if persist_rep_stop_update(selected_result, active_entry, auth_context=auth_context):
                save_app_snapshot(all_results=route_results, route_execution=route_execution)
                st.success("Appointment saved.")
                st.rerun()
            st.warning("Could not save the appointment.")


def render_leaderboard_hub(current_app_user, auth_context):
    st.markdown('<div class="siq-section">Leaderboard</div>', unsafe_allow_html=True)
    st.markdown("Compare rep output across the team using logged field activity.")

    _scoreboard_df, _calendar_df, activity_df = build_team_activity_frames(auth_context)
    metric_options = ["Doors Knocked", "Appointments Set", "Marketing Qualified Leads", "Closed Customers"]
    filter_options = ["Today", "This Week", "This Month", "YTD", "All Time"]
    filter_col1, filter_col2 = st.columns([1.1, 1.4])
    date_filter = filter_col1.selectbox("Date Filter", options=filter_options, key="leaderboard_date_filter")
    selected_metric = filter_col2.selectbox("Leaderboard Metric", options=metric_options, key="leaderboard_metric")
    filtered_activity_df = filter_leaderboard_activity(activity_df, date_filter)
    scoreboard_df = build_leaderboard_frame_from_activity(filtered_activity_df)
    if scoreboard_df.empty:
        st.info(f"No leaderboard activity found for `{date_filter}` yet.")
        return

    leaderboard_df = scoreboard_df.copy()
    leaderboard_df["Rank"] = leaderboard_df[selected_metric].rank(method="dense", ascending=False).astype(int)
    leaderboard_df = leaderboard_df.sort_values(["Rank", "Rep"]).reset_index(drop=True)
    current_name = current_app_user.get("full_name") or current_app_user.get("email") if current_app_user else None
    leaderboard_df["You"] = leaderboard_df["Rep"].apply(lambda rep: "You" if current_name and rep == current_name else "")

    lead_cols = st.columns([1.1, 0.9])
    with lead_cols[0]:
        st.bar_chart(leaderboard_df.set_index("Rep")[selected_metric], use_container_width=True)
    with lead_cols[1]:
        top_row = leaderboard_df.iloc[0]
        st.metric("Top Rep", top_row["Rep"])
        st.metric(selected_metric, int(top_row[selected_metric]))
        st.caption(f"Window: {date_filter}")

    st.dataframe(
        leaderboard_df[["Rank", "Rep", "You", "Doors Knocked", "Appointments Set", "Marketing Qualified Leads", "Closed Customers"]],
        use_container_width=True,
        hide_index=True,
        height=320,
    )


def render_reports_hub(current_app_user, auth_context, active_org_role):
    st.markdown('<div class="siq-section">Reports</div>', unsafe_allow_html=True)
    st.markdown("Review KPI summaries and recent trend lines for one rep or the whole team.")

    scoreboard_df, calendar_df, activity_df = build_team_activity_frames(auth_context)
    if scoreboard_df.empty:
        st.info("Reports will populate once route activity is logged.")
        return

    selected_rep_id = None
    if can_access_manager_workspace(active_org_role):
        rep_options = {row["Rep"]: row["rep_id"] for _, row in scoreboard_df.iterrows()}
        selected_rep_name = st.selectbox("Report Scope", options=["Team Total"] + list(rep_options.keys()), key="reports_scope")
        if selected_rep_name != "Team Total":
            selected_rep_id = rep_options[selected_rep_name]
    elif current_app_user:
        selected_rep_id = current_app_user.get("id")

    if selected_rep_id:
        filtered_scores = scoreboard_df[scoreboard_df["rep_id"] == selected_rep_id]
        filtered_activity = activity_df[activity_df["rep_id"] == selected_rep_id] if not activity_df.empty else activity_df
        filtered_calendar = calendar_df[calendar_df["rep_id"] == selected_rep_id] if not calendar_df.empty and not filtered_scores.empty else calendar_df.iloc[0:0]
        report_title = filtered_scores.iloc[0]["Rep"] if not filtered_scores.empty else "Selected Rep"
    else:
        filtered_scores = pd.DataFrame(
            [
                {
                    "Rep": "Team Total",
                    "rep_id": "team",
                    "Doors Knocked": int(scoreboard_df["Doors Knocked"].sum()),
                    "Appointments Set": int(scoreboard_df["Appointments Set"].sum()),
                    "Marketing Qualified Leads": int(scoreboard_df["Marketing Qualified Leads"].sum()),
                    "Closed Customers": int(scoreboard_df["Closed Customers"].sum()),
                }
            ]
        )
        filtered_activity = activity_df
        filtered_calendar = calendar_df
        report_title = "Team Total"

    summary = filtered_scores.iloc[0]
    metric_cols = st.columns(4)
    metric_cols[0].metric("Doors Knocked", int(summary["Doors Knocked"]))
    metric_cols[1].metric("Appointments Set", int(summary["Appointments Set"]))
    metric_cols[2].metric("Marketing Qualified Leads", int(summary["Marketing Qualified Leads"]))
    metric_cols[3].metric("Closed Customers", int(summary["Closed Customers"]))

    st.caption(f"Report scope: {report_title}")
    if not filtered_activity.empty and "Day" in filtered_activity.columns:
        trend_df = (
            filtered_activity.dropna(subset=["Day"])
            .groupby("Day", dropna=False)
            .size()
            .reset_index(name="Activity")
        )
        if not trend_df.empty:
            st.line_chart(trend_df.set_index("Day")["Activity"], use_container_width=True)

    detail_col1, detail_col2 = st.columns(2)
    with detail_col1:
        st.markdown("#### KPI Table")
        st.dataframe(filtered_scores.drop(columns=["rep_id"]), use_container_width=True, hide_index=True)
    with detail_col2:
        st.markdown("#### Upcoming Appointments")
        if filtered_calendar.empty:
            st.info("No appointments scheduled in this scope.")
        else:
            st.dataframe(filtered_calendar.drop(columns=["rep_id"]), use_container_width=True, hide_index=True, height=240)


def render_onboarding_hub(current_app_user, auth_context):
    st.markdown('<div class="siq-section">Onboarding</div>', unsafe_allow_html=True)
    st.markdown("Bring new reps into the system with a simple intake flow, readiness checklist, and onboarding pipeline.")

    if "onboarding_queue" not in st.session_state:
        st.session_state["onboarding_queue"] = [
            {
                "name": "Jordan Lee",
                "role": "Rep",
                "manager": current_app_user.get("full_name") if current_app_user else "Manager",
                "start_date": datetime.now().strftime("%Y-%m-%d"),
                "status": "Paperwork",
                "phone": "",
                "email": "",
                "territory": "South Team",
                "training": False,
                "app_access": False,
                "ride_along": False,
                "payroll": False,
                "notes": "Waiting on tax forms.",
                "app_user_id": "",
                "temporary_password": "",
                "password_setup_sent_at": "",
            }
        ]

    onboarding_rows = st.session_state["onboarding_queue"]

    metric_cols = st.columns(4)
    metric_cols[0].metric("New Hires", len(onboarding_rows))
    metric_cols[1].metric("Ready To Field", sum(1 for row in onboarding_rows if row.get("status") == "Ready"))
    metric_cols[2].metric("Training In Progress", sum(1 for row in onboarding_rows if row.get("status") == "Training"))
    metric_cols[3].metric("Needs Manager Action", sum(1 for row in onboarding_rows if row.get("status") in {"Paperwork", "Setup Blocked"}))

    intake_col, pipeline_col = st.columns([0.9, 1.1], gap="large")
    with intake_col:
        st.markdown("#### Add New User")
        with st.form("new_onboarding_user"):
            new_name = st.text_input("Full Name")
            new_role = st.selectbox("Role", ["Rep", "Manager", "Admin"])
            new_email = st.text_input("Email")
            new_phone = st.text_input("Phone")
            new_manager = st.text_input(
                "Manager",
                value=current_app_user.get("full_name") if current_app_user else "",
            )
            new_start = st.date_input("Start Date", value=datetime.now().date())
            new_territory = st.text_input("Team / Territory", placeholder="North Team")
            new_notes = st.text_area("Notes", placeholder="Background, prior experience, special setup needs")
            create_now = st.checkbox(
                "Create real app user immediately",
                value=True,
                help="Creates the Supabase login and organization membership right away.",
            )
            submitted = st.form_submit_button("Save New User", use_container_width=True)
        if submitted and new_name.strip():
            new_record = {
                "name": new_name.strip(),
                "role": new_role,
                "manager": new_manager.strip() or "Manager",
                "start_date": new_start.strftime("%Y-%m-%d"),
                "status": "Paperwork",
                "phone": new_phone.strip(),
                "email": new_email.strip(),
                "territory": new_territory.strip(),
                "training": False,
                "app_access": False,
                "ride_along": False,
                "payroll": False,
                "notes": new_notes.strip(),
                "app_user_id": "",
                "temporary_password": "",
                "password_setup_sent_at": "",
            }

            if create_now and new_email.strip() and supabase_enabled() and auth_context and auth_context.get("organization_id"):
                result = create_onboarding_user(
                    full_name=new_record["name"],
                    email=new_record["email"],
                    role=str(new_record["role"] or "Rep").lower(),
                    organization_id=auth_context.get("organization_id"),
                    invited_by=(auth_context or {}).get("app_user_id"),
                )
                if result.get("ok"):
                    new_record["app_user_id"] = result.get("app_user_id")
                    new_record["temporary_password"] = result.get("temporary_password")
                    new_record["app_access"] = True
                    st.success(f"{new_name.strip()} added and created as a real app user.")
                else:
                    st.warning(result.get("error", "Could not create the app user. Added to onboarding only."))
            else:
                st.success(f"{new_name.strip()} added to onboarding.")

            onboarding_rows.append(new_record)
            st.rerun()

        st.markdown("#### Onboarding Checklist")
        checklist_df = pd.DataFrame(
            [
                {"Step": "Profile created", "Owner": "Manager / Admin", "Purpose": "Gets the user into Lumino and assigns role"},
                {"Step": "App access granted", "Owner": "Admin", "Purpose": "Lets the rep log in and use Turf Mode"},
                {"Step": "Paperwork complete", "Owner": "Recruiting / Ops", "Purpose": "Tax, pay, contractor setup, IDs"},
                {"Step": "Training complete", "Owner": "Manager", "Purpose": "Pitch, workflow, disposition standards"},
                {"Step": "Ride-along complete", "Owner": "Manager", "Purpose": "Field readiness and coaching"},
                {"Step": "Territory assigned", "Owner": "Manager", "Purpose": "Rep can start working live turf"},
            ]
        )
        st.dataframe(checklist_df, use_container_width=True, hide_index=True, height=260)

    with pipeline_col:
        st.markdown("#### Onboarding Pipeline")
        if not onboarding_rows:
            st.info("No users in onboarding yet.")
        else:
            pipeline_df = pd.DataFrame(
                [
                    {
                        "Name": row.get("name"),
                        "Role": row.get("role"),
                        "Manager": row.get("manager"),
                        "Start Date": row.get("start_date"),
                        "Status": row.get("status"),
                        "Territory": row.get("territory"),
                        "Training": "Yes" if row.get("training") else "No",
                        "App Access": "Yes" if row.get("app_access") else "No",
                        "Ride Along": "Yes" if row.get("ride_along") else "No",
                        "Payroll": "Yes" if row.get("payroll") else "No",
                        "App User": "Created" if row.get("app_user_id") else "Pending",
                        "Password Setup": row.get("password_setup_sent_at") or "Not Sent",
                        "Notes": row.get("notes") or "",
                    }
                    for row in onboarding_rows
                ]
            )
            st.dataframe(pipeline_df, use_container_width=True, hide_index=True, height=300)

            selected_name = st.selectbox(
                "Review Onboarding Record",
                options=[row["name"] for row in onboarding_rows],
                key="selected_onboarding_user",
            )
            active_record = next(row for row in onboarding_rows if row["name"] == selected_name)
            detail_col1, detail_col2 = st.columns(2)
            active_record["status"] = detail_col1.selectbox(
                "Onboarding Status",
                options=["Paperwork", "Setup Blocked", "Training", "Shadowing", "Ready"],
                index=["Paperwork", "Setup Blocked", "Training", "Shadowing", "Ready"].index(active_record.get("status", "Paperwork")),
                key=f"onboarding_status_{selected_name}",
            )
            active_record["territory"] = detail_col2.text_input(
                "Assigned Team / Territory",
                value=active_record.get("territory", ""),
                key=f"onboarding_territory_{selected_name}",
            )
            flag_col1, flag_col2, flag_col3, flag_col4 = st.columns(4)
            active_record["app_access"] = flag_col1.checkbox("App Access", value=active_record.get("app_access", False), key=f"onboarding_access_{selected_name}")
            active_record["training"] = flag_col2.checkbox("Training", value=active_record.get("training", False), key=f"onboarding_training_{selected_name}")
            active_record["ride_along"] = flag_col3.checkbox("Ride Along", value=active_record.get("ride_along", False), key=f"onboarding_ride_{selected_name}")
            active_record["payroll"] = flag_col4.checkbox("Payroll", value=active_record.get("payroll", False), key=f"onboarding_payroll_{selected_name}")
            active_record["notes"] = st.text_area(
                "Manager Notes",
                value=active_record.get("notes", ""),
                key=f"onboarding_notes_{selected_name}",
                height=120,
            )

            action_col1, action_col2 = st.columns(2)
            if active_record.get("email"):
                action_col1.link_button(
                    "Email User",
                    f"mailto:{active_record['email']}",
                    use_container_width=True,
                )
            else:
                action_col1.button("Email User", disabled=True, use_container_width=True)
            if action_col2.button("Save Onboarding Updates", use_container_width=True):
                st.success(f"Updated onboarding record for {selected_name}.")

            create_col1, create_col2 = st.columns(2)
            can_create = bool(
                supabase_enabled()
                and auth_context
                and auth_context.get("organization_id")
                and active_record.get("email")
            )
            if create_col1.button(
                "Create Real App User",
                use_container_width=True,
                disabled=(not can_create or bool(active_record.get("app_user_id"))),
            ):
                result = create_onboarding_user(
                    full_name=active_record.get("name"),
                    email=active_record.get("email"),
                    role=str(active_record.get("role") or "Rep").lower(),
                    organization_id=auth_context.get("organization_id"),
                    invited_by=(auth_context or {}).get("app_user_id"),
                )
                if result.get("ok"):
                    active_record["app_user_id"] = result.get("app_user_id")
                    active_record["temporary_password"] = result.get("temporary_password")
                    active_record["app_access"] = True
                    active_record["status"] = "Training" if active_record.get("training") else "Paperwork"
                    st.success(f"Created real app user for {selected_name}.")
                else:
                    st.warning(result.get("error", "Could not create the app user."))

            if active_record.get("temporary_password"):
                create_col2.code(
                    f"Email: {active_record.get('email')}\nTemp password: {active_record.get('temporary_password')}",
                    language="text",
                )
            elif not active_record.get("app_user_id"):
                create_col2.caption("Create the app user to generate login credentials.")

            reset_col1, reset_col2 = st.columns(2)
            reset_redirect_url = password_setup_redirect_url()
            can_send_password_setup = bool(
                active_record.get("app_user_id")
                and active_record.get("email")
                and reset_redirect_url
            )
            if reset_col1.button(
                "Send Set Password Email",
                use_container_width=True,
                disabled=not can_send_password_setup,
            ):
                reset_result = send_password_reset_email(
                    active_record.get("email"),
                    redirect_to=reset_redirect_url,
                )
                if reset_result.get("ok"):
                    active_record["password_setup_sent_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
                    st.success(f"Sent password setup email to {active_record.get('email')}.")
                else:
                    st.warning(reset_result.get("error", "Could not send the password setup email."))

            if active_record.get("password_setup_sent_at"):
                reset_col2.caption(f"Password setup email sent {active_record['password_setup_sent_at']}.")
            elif active_record.get("app_user_id") and not reset_redirect_url:
                reset_col2.caption("Set `APP_URL` or `PUBLIC_APP_URL` so Lumino can build the password setup link.")
            elif active_record.get("app_user_id"):
                reset_col2.caption("Sends a self-serve password setup email through Supabase.")


def render_performance_hub(all_results, execution_state, current_app_user, auth_context):
    st.markdown('<div class="siq-section">Performance</div>', unsafe_allow_html=True)
    st.markdown("Leaderboard, KPI trends, and coaching analytics now sit on top of the same field activity data.")

    queue_results = all_results or []
    total_stops = len(queue_results)
    total_doors = sum(result.get("doors_to_knock", 0) for result in queue_results)
    activity_df = performance_activity_df(queue_results, execution_state)
    rep_kpi_df, rep_trend_df = build_rep_kpi_frames(queue_results, execution_state, current_app_user, auth_context)

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

    trend_cols = st.columns(4)
    today_key = datetime.now().strftime("%Y-%m-%d")
    week_key = datetime.now().strftime("%G-W%V")
    month_key = datetime.now().strftime("%Y-%m")
    year_key = datetime.now().strftime("%Y")
    daily_doors = int(activity_df.loc[activity_df["day"] == today_key, "doors"].sum()) if not activity_df.empty else 0
    weekly_doors = int(activity_df.loc[activity_df["week"] == week_key, "doors"].sum()) if not activity_df.empty else 0
    monthly_doors = int(activity_df.loc[activity_df["month"] == month_key, "doors"].sum()) if not activity_df.empty else 0
    yearly_doors = int(activity_df.loc[activity_df["year"] == year_key, "doors"].sum()) if not activity_df.empty else 0
    trend_cols[0].metric("Doors Today", daily_doors)
    trend_cols[1].metric("Doors This Week", weekly_doors)
    trend_cols[2].metric("Doors This Month", monthly_doors)
    trend_cols[3].metric("Doors This Year", yearly_doors)

    manager_kpi_cols = st.columns(4)
    manager_kpi_cols[0].metric("Contact Rate", f"{(completed / total_stops * 100):.0f}%" if total_stops else "0%")
    manager_kpi_cols[1].metric("Interest Rate", f"{(interested / completed * 100):.0f}%" if completed else "0%")
    manager_kpi_cols[2].metric("Appointment Count", int(activity_df["appointments"].sum()) if not activity_df.empty else 0)
    manager_kpi_cols[3].metric("Avg Doors / Stop", f"{(total_doors / total_stops):.1f}" if total_stops else "0.0")

    chart_tab1, chart_tab2 = st.tabs(["Door Trends", "Coaching Charts"])
    with chart_tab1:
        door_chart_cols = st.columns(2)
        daily_chart_df = grouped_kpi(activity_df, "day", "doors")
        weekly_chart_df = grouped_kpi(activity_df, "week", "doors")
        monthly_chart_df = grouped_kpi(activity_df, "month", "doors")
        yearly_chart_df = grouped_kpi(activity_df, "year", "doors")
        with door_chart_cols[0]:
            st.markdown("#### Doors Knocked by Day")
            if daily_chart_df.empty:
                st.info("Door trend data appears once reps log dispositions.")
            else:
                st.bar_chart(daily_chart_df.set_index("Period")["Value"], use_container_width=True)
            st.markdown("#### Doors Knocked by Week")
            if weekly_chart_df.empty:
                st.info("Weekly door data not available yet.")
            else:
                st.line_chart(weekly_chart_df.set_index("Period")["Value"], use_container_width=True)
        with door_chart_cols[1]:
            st.markdown("#### Doors Knocked by Month")
            if monthly_chart_df.empty:
                st.info("Monthly door data not available yet.")
            else:
                st.bar_chart(monthly_chart_df.set_index("Period")["Value"], use_container_width=True)
            st.markdown("#### Doors Knocked by Year")
            if yearly_chart_df.empty:
                st.info("Yearly door data not available yet.")
            else:
                st.line_chart(yearly_chart_df.set_index("Period")["Value"], use_container_width=True)

    with chart_tab2:
        coaching_cols = st.columns(2)
        with coaching_cols[0]:
            stage_rows = []
            for result in queue_results:
                property_id = make_property_id("primary_stop", result.get("address"))
                entry = (execution_state or {}).get(property_id, {})
                stage_rows.append(entry.get("lead_stage") or "New Lead")
            if stage_rows:
                stage_df = pd.Series(stage_rows).value_counts().rename_axis("Stage").reset_index(name="Count")
                st.markdown("#### Pipeline Stage Mix")
                st.bar_chart(stage_df.set_index("Stage")["Count"], use_container_width=True)
            else:
                st.info("Pipeline stage mix appears once leads are loaded.")
        with coaching_cols[1]:
            activity_mix = pd.DataFrame(
                [
                    {"Activity": "Calls", "Count": int(activity_df["calls"].sum()) if not activity_df.empty else 0},
                    {"Activity": "Texts", "Count": int(activity_df["texts"].sum()) if not activity_df.empty else 0},
                    {"Activity": "Appointments", "Count": int(activity_df["appointments"].sum()) if not activity_df.empty else 0},
                    {"Activity": "Tasks", "Count": int(activity_df["tasks"].sum()) if not activity_df.empty else 0},
                ]
            )
            st.markdown("#### Follow-Up Activity Mix")
            if activity_mix["Count"].sum() == 0:
                st.info("Follow-up charts appear once reps log calls, texts, tasks, or appointments.")
            else:
                st.bar_chart(activity_mix.set_index("Activity")["Count"], use_container_width=True)

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
        st.markdown("#### KPI Snapshot")
        kpi_snapshot = pd.DataFrame(
            [
                {"Metric": "Completed Stops", "Value": completed},
                {"Metric": "Interested Leads", "Value": interested},
                {"Metric": "Callbacks", "Value": callbacks},
                {"Metric": "Not Home", "Value": not_home},
                {"Metric": "Not Interested", "Value": not_interested},
                {"Metric": "Appointments Logged", "Value": int(activity_df["appointments"].sum()) if not activity_df.empty else 0},
            ]
        )
        st.dataframe(kpi_snapshot, use_container_width=True, hide_index=True)

    st.markdown("#### Report Builder Preview")
    st.dataframe(report_templates_df, use_container_width=True, hide_index=True)

    st.markdown("#### Competition Builder Preview")
    st.dataframe(competition_df, use_container_width=True, hide_index=True)

    st.markdown("#### Rep KPI Comparison")
    rep_chart_col1, rep_chart_col2 = st.columns([1.1, 0.9], gap="large")
    with rep_chart_col1:
        rep_kpi_options = ["Doors Knocked", "Conversations", "Appointments Set", "Closed"]
        selected_rep_kpi = st.selectbox(
            "Bar Chart KPI",
            options=rep_kpi_options,
            key="rep_kpi_bar_metric",
        )
        if rep_kpi_df.empty:
            st.info("Rep comparison data will appear as reps start working leads.")
        else:
            st.bar_chart(rep_kpi_df.set_index("Rep")[selected_rep_kpi], use_container_width=True)
            st.dataframe(rep_kpi_df, use_container_width=True, hide_index=True, height=220)

    with rep_chart_col2:
        if rep_kpi_df.empty:
            st.info("Rep trend data will appear once activity is logged.")
        else:
            selected_rep = st.selectbox(
                "Rep Trend",
                options=rep_kpi_df["Rep"].tolist(),
                key="rep_kpi_trend_rep",
            )
            selected_trend_kpi = st.selectbox(
                "Trend KPI",
                options=["Doors Knocked", "Conversations", "Appointments Set", "Closed"],
                key="rep_kpi_trend_metric",
            )
            rep_history = rep_trend_df[rep_trend_df["Rep"] == selected_rep].copy() if not rep_trend_df.empty else pd.DataFrame()
            if rep_history.empty:
                st.info("No time-series data for this rep yet. Once they log status updates, the line graph will appear here.")
            else:
                st.line_chart(rep_history.set_index("Period")[selected_trend_kpi], use_container_width=True)


def render_workspace_shell(workspace_mode, all_results, execution_state):
    if workspace_mode == "Manager View":
        title = "Manager Workspace"
        kicker = "Operate"
        copy = (
            "Track field execution, coach follow-up, and watch the pipeline move from knocked doors to closed and installed deals."
        )
        doors_knocked = 0
        conversations = 0
        appointments_set = 0
        deals_closed = 0
        for result in all_results or []:
            property_id = make_property_id("primary_stop", result.get("address"))
            entry = (execution_state or {}).get(property_id, {})
            status_text = str(entry.get("status") or "").lower()
            if status_text:
                doors_knocked += 1
            if status_text in {"interested", "callback", "not interested", "appt set"}:
                conversations += 1
            if status_text == "appt set":
                appointments_set += 1
            if status_text == "closed":
                deals_closed += 1
        primary_metric = doors_knocked
        primary_label = "Doors Knocked"
        secondary_metric = conversations
        secondary_label = "Conversations"
        tertiary_metric = appointments_set
        tertiary_label = "Appointments Set"
        fourth_metric = deals_closed
        fourth_label = "Closed"
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


def infer_city_from_address(address):
    parts = [part.strip() for part in str(address or "").split(",") if part and str(part).strip()]
    if len(parts) >= 3:
        return parts[-2]
    if len(parts) >= 2:
        trailing = parts[-1].split()
        if trailing:
            return " ".join(trailing[:-1]) or parts[-1]
        return parts[-1]
    return "Unknown"


def filter_open_lead_pool_results(
    results,
    sold_date_query="",
    min_price=None,
    max_price=None,
    min_sun_hours=None,
    max_sun_hours=None,
    selected_zipcodes=None,
    selected_cities=None,
):
    filtered = []
    sold_date_query = str(sold_date_query or "").strip().lower()
    zipcode_filter = {str(value).strip() for value in (selected_zipcodes or []) if str(value).strip()}
    city_filter = {str(value).strip().lower() for value in (selected_cities or []) if str(value).strip()}
    for result in results or []:
        sale_price = result.get("sale_price")
        sun_hours = result.get("sun_hours")
        sold_date = str(result.get("sold_date") or "").lower()
        zipcode = str(result.get("zipcode") or "").strip()
        city = infer_city_from_address(result.get("address"))

        if sold_date_query and sold_date_query not in sold_date:
            continue
        if zipcode_filter and zipcode not in zipcode_filter:
            continue
        if city_filter and str(city).strip().lower() not in city_filter:
            continue
        if min_price is not None and sale_price is not None and sale_price < min_price:
            continue
        if max_price is not None and sale_price is not None and sale_price > max_price:
            continue
        if min_sun_hours is not None and sun_hours is not None and sun_hours < min_sun_hours:
            continue
        if max_sun_hours is not None and sun_hours is not None and sun_hours > max_sun_hours:
            continue
        filtered.append(result)
    return filtered


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
        auto_request=True,
        show_button=False,
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
        blank_view = pdk.ViewState(
            latitude=39.8283,
            longitude=-98.5795,
            zoom=4.2,
            pitch=0,
            bearing=0,
            controller=True,
        )
        st.pydeck_chart(
            pdk.Deck(
                layers=[],
                initial_view_state=blank_view,
                map_provider="carto",
                map_style="light_no_labels",
            ),
            key="blank_rep_map_empty",
            use_container_width=True,
            height=760,
        )
        st.info("Allow location once and the map will center on the rep automatically from then on.")

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
        auto_request=True,
        show_button=False,
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

    route_tab, leads_tab = st.tabs(["Route", "Leads"])

    with route_tab:
        focus_col, support_col = st.columns([1.4, 0.9], gap="large")
        with focus_col:
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
                st.link_button("Directions", active_links["google"], use_container_width=True)
                if active_property.get("street_view_link"):
                    st.caption(f"[Street View]({active_property['street_view_link']})")

                status_col, interest_col = st.columns(2)
                active_entry["status"] = status_col.selectbox(
                    "Status",
                    STATUS_OPTIONS,
                    index=STATUS_OPTIONS.index(active_entry["status"]) if active_entry["status"] in STATUS_OPTIONS else 0,
                    key=f"turf_status_{active_property_id}",
                )
                active_entry["interest_level"] = interest_col.selectbox(
                    "Interest Level",
                    INTEREST_LEVEL_OPTIONS,
                    index=INTEREST_LEVEL_OPTIONS.index(active_entry["interest_level"])
                    if active_entry["interest_level"] in INTEREST_LEVEL_OPTIONS
                    else 0,
                    key=f"turf_interest_{active_property_id}",
                )

                contact_bits = []
                if active_entry.get("homeowner_name"):
                    contact_bits.append(active_entry["homeowner_name"])
                if active_entry.get("phone"):
                    contact_bits.append(active_entry["phone"])
                if active_entry.get("email"):
                    contact_bits.append(active_entry["email"])
                if contact_bits:
                    st.caption(" · ".join(contact_bits))

                route_action_col1, route_action_col2 = st.columns(2)
                if route_action_col1.button("Save Stop", key=f"save_stop_{active_property_id}", use_container_width=True):
                    if persist_rep_stop_update(active_result or active_property, active_entry, auth_context=auth_context):
                        status_suffix = f" as {active_entry.get('status')}" if active_entry.get("status") else ""
                        append_activity_event(
                            active_entry,
                            "Disposition" if active_entry.get("status") else "Notes",
                            f"Saved stop update{status_suffix}.",
                        )
                        save_app_snapshot(
                            all_results=st.session_state.get("all_results", []),
                            route_execution=st.session_state["route_execution"],
                        )
                        st.success("Stop details saved.")
                    else:
                        st.warning("Could not save stop details.")
                if route_action_col2.button("Mark Skipped", key=f"route_skip_{active_property_id}", use_container_width=True):
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
                        st.success("Stop marked skipped.")
                        st.rerun()

        with support_col:
            if turf_user_location:
                st.caption(
                    f"Current location: {turf_user_location['latitude']:.5f}, {turf_user_location['longitude']:.5f}"
                )
            dropped_pin = st.session_state.get("turf_dropped_pin")
            if dropped_pin:
                st.caption(f"Dropped pin: {dropped_pin['latitude']:.5f}, {dropped_pin['longitude']:.5f}")
            st.markdown("#### Live Queue")
            st.dataframe(pd.DataFrame(queue_rows), use_container_width=True, hide_index=True, height=260)
            if route_preview_df is not None:
                with st.expander("Route Order", expanded=False):
                    st.dataframe(route_preview_df, use_container_width=True, hide_index=True)

    with leads_tab:
        leads_focus_col, leads_support_col = st.columns([1.4, 0.9], gap="large")
        with leads_focus_col:
            if active_property:
                active_property_id = active_property["property_id"]
                active_entry = st.session_state["route_execution"][active_property_id]
                crm_stage_options = [
                    "New Lead",
                    "Attempting Contact",
                    "Contacted",
                    "Appointment Set",
                    "Quoted",
                    "Negotiation",
                    "Closed Won",
                    "Installed",
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

                st.markdown(f"### Lead Follow-Up")
                st.markdown(f"**{active_property.get('address')}**")
                st.caption(
                    f"Status: {active_entry.get('status') or 'Not set'} · "
                    f"Stage: {active_entry.get('lead_stage') or 'New Lead'}"
                )

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

                leads_contact_col1, leads_contact_col2 = st.columns(2)
                active_entry["homeowner_name"] = leads_contact_col1.text_input(
                    "Homeowner Name",
                    value=active_entry["homeowner_name"],
                    key=f"lead_name_{active_property_id}",
                )
                active_entry["phone"] = leads_contact_col2.text_input(
                    "Phone",
                    value=active_entry["phone"],
                    key=f"lead_phone_{active_property_id}",
                )
                leads_contact_col3, leads_contact_col4 = st.columns(2)
                active_entry["email"] = leads_contact_col3.text_input(
                    "Email",
                    value=active_entry["email"],
                    key=f"lead_email_{active_property_id}",
                )
                active_entry["best_follow_up_time"] = leads_contact_col4.text_input(
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
                    "Lead Notes",
                    value=active_entry["notes"],
                    key=f"lead_notes_{active_property_id}",
                    height=140,
                )

                phone_value = urllib.parse.quote(str(active_entry.get("phone") or ""))
                email_value = urllib.parse.quote(str(active_entry.get("email") or ""))
                address_value = urllib.parse.quote(str(active_property.get("address") or ""))
                quick_contact_col1, quick_contact_col2, quick_contact_col3 = st.columns(3)
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

                st.markdown("#### Appointment")
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
                if notes_action_col1.button("Save Lead", key=f"save_lead_{active_property_id}", use_container_width=True):
                    if persist_rep_stop_update(active_result or active_property, active_entry, auth_context=auth_context):
                        append_activity_event(active_entry, "Notes", "Saved lead follow-up details.")
                        save_app_snapshot(
                            all_results=st.session_state.get("all_results", []),
                            route_execution=st.session_state["route_execution"],
                        )
                        st.success("Lead details saved.")
                    else:
                        st.warning("Could not save lead details.")
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
                    active_entry["status"] = "Appt Set"
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
                    if persist_rep_stop_update(active_result or active_property, active_entry, auth_context=auth_context):
                        save_app_snapshot(
                            all_results=st.session_state.get("all_results", []),
                            route_execution=st.session_state["route_execution"],
                        )
                        st.success("Appointment saved.")
                        st.rerun()
                    else:
                        st.warning("Could not save the appointment.")
                ics_data = build_appointment_ics(
                    active_property.get("address"),
                    active_entry.get("homeowner_name"),
                    active_entry.get("best_follow_up_time") or appointment_label,
                    active_entry.get("notes"),
                )
                appt_action_col2.download_button(
                    "Calendar Invite",
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

        with leads_support_col:
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
    if not current_app_user and session_payload.get("refresh_token"):
        refreshed_session = refresh_session(session_payload.get("refresh_token"))
        if refreshed_session.get("ok"):
            refreshed_session["api_key"] = (
                session_payload.get("api_key")
                or os.getenv("SUPABASE_ANON_KEY", "").strip()
                or os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
                or os.getenv("SUPABASE_SECRET_KEY", "").strip()
            )
            st.session_state["auth_session"] = refreshed_session
            sync_auth_cookies_from_session()
            session_payload = refreshed_session
            base_auth_context = {
                "access_token": session_payload.get("access_token"),
                "api_key": session_payload.get("api_key"),
                "user_id": (session_payload.get("user") or {}).get("id"),
            }
            current_app_user = get_current_app_user(auth_context=base_auth_context)
        else:
            st.session_state["auth_session"] = None
            sync_auth_cookies_from_session()
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
            sync_auth_cookies_from_session()
            auth_context = {
                **base_auth_context,
                "app_user_id": current_app_user["id"],
                "organization_id": default_org_id,
            }

active_org_role = get_active_org_role(
    current_memberships,
    st.session_state.get("selected_org_id"),
    current_app_user.get("role") if current_app_user else None,
)
manager_workspace_enabled = can_access_manager_workspace(active_org_role)

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
                    sync_auth_cookies_from_session()
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
                sync_auth_cookies_from_session()
            if st.button("Log Out", use_container_width=True):
                sign_out()
                st.session_state["auth_session"] = None
                st.session_state["selected_org_id"] = None
                sync_auth_cookies_from_session()
                st.rerun()
    workspace_options = ["Manager View", "Rep View"] if manager_workspace_enabled else ["Rep View"]
    if not manager_workspace_enabled and st.session_state.get("workspace_mode") != "Rep View":
        st.session_state["workspace_mode"] = "Rep View"
    workspace_mode = st.radio(
        "Workspace",
        options=workspace_options,
        key="workspace_mode",
    )
    if current_app_user and not manager_workspace_enabled:
        st.caption(
            f"Your role in this organization is `{active_org_role or 'rep'}`. Manager view is disabled for this account."
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

if not manager_workspace_enabled and workspace_mode != "Rep View":
    workspace_mode = "Rep View"
    st.session_state["workspace_mode"] = "Rep View"

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

workspace_tab_label = "Maps"
main_view_options = [workspace_tab_label]
if manager_workspace_enabled:
    main_view_options.extend(["Manager Workspace", "Leads", "Calendar", "Leaderboard", "Reports", "People", "Onboarding"])
else:
    main_view_options.extend(["Leads", "Calendar", "Leaderboard", "Reports"])
if st.session_state.get("main_workspace_view") not in main_view_options:
    st.session_state["main_workspace_view"] = workspace_tab_label
selected_main_view = st.radio(
    "Workspace Views",
    options=main_view_options,
    key="main_workspace_view",
    horizontal=True,
    label_visibility="collapsed",
)

if selected_main_view == workspace_tab_label:
    render_context_shell(
        "Maps Context",
        "Live route maps, current location, and field navigation stay here while manager planning and intelligence live in their own workspace tab.",
        ["Map", "Route", "Location", "Navigation"],
    )
    if workspace_mode == "Manager View":
        st.caption("Planning, upload, open lead pool, and intelligence reporting live in `Manager Workspace`.")
        manager_map_results = st.session_state.get("all_results", [])
        if not manager_map_results:
            render_blank_rep_map(auth_context)
        else:
            zip_summary = build_zip_summary(manager_map_results)
            zip_rank = {item["zipcode"]: i for i, item in enumerate(zip_summary)}
            sorted_manager_results = sorted(
                manager_map_results,
                key=lambda x: (zip_rank.get(x["zipcode"], 99), -x["priority_score"], -x["doors_to_knock"]),
            )
            active_route = st.session_state.get("active_route_run")
            execution_results = active_route.get("results", []) if active_route else sorted_manager_results
            if execution_results:
                execution_properties = build_execution_properties(execution_results)
                st.session_state["route_execution"] = ensure_execution_state(
                    st.session_state.get("route_execution", {}),
                    execution_properties,
                )
                save_app_snapshot(
                    all_results=st.session_state.get("all_results", []),
                    route_execution=st.session_state["route_execution"],
                )
                render_rep_turf_mode(
                    execution_results,
                    execution_properties,
                    auth_context,
                    route_preview_df=None,
                )
            else:
                render_blank_rep_map(auth_context)
    elif "all_results" not in st.session_state:
        render_blank_rep_map(auth_context)

if selected_main_view == "Leads":
    render_context_shell(
        "Leads Context",
        "Browse the organization lead book in one place, with rep visibility limited to their own created or assigned leads.",
        ["Search", "Ownership", "Status", "Follow-up"],
    )
    render_leads_hub(current_app_user, auth_context, active_org_role)

if selected_main_view == "Calendar":
    render_context_shell(
        "Calendar Context",
        "Schedule, review, and track appointments for the current rep scope.",
        ["Appointments", "Schedule", "Follow-up", "Pipeline"],
    )
    render_calendar_hub(current_app_user, auth_context, active_org_role)

if selected_main_view == "Leaderboard":
    render_context_shell(
        "Leaderboard Context",
        "Rep ranking updates from saved field activity so everyone can see how they stack up.",
        ["Doors", "Appointments", "MQLs", "Closed"],
    )
    render_leaderboard_hub(current_app_user, auth_context)

if selected_main_view == "Reports":
    render_context_shell(
        "Reports Context",
        "Personal KPI reporting for reps and team-wide drilldowns for managers.",
        ["KPIs", "Trends", "Appointments", "Summary"],
    )
    render_reports_hub(current_app_user, auth_context, active_org_role)

if selected_main_view == "People" and manager_workspace_enabled:
    render_context_shell(
        "People Context",
        "Profiles, badges, and contact actions support the active field workflow but don’t interrupt it.",
        ["Profiles", "Badges", "Contact", "Recognition"],
    )
    render_people_hub(current_app_user, auth_context)

if selected_main_view == "Onboarding" and manager_workspace_enabled:
    render_context_shell(
        "Onboarding Context",
        "Bring new reps into the platform with structured setup, readiness tracking, and manager-owned onboarding notes.",
        ["New Hires", "Checklist", "Readiness", "Setup"],
    )
    render_onboarding_hub(current_app_user, auth_context)

if selected_main_view == "Manager Workspace" and manager_workspace_enabled:
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
        col_permit_pulled = column_mapping.get("permit_pulled")

        if not col_address:
            st.error("Could not find an address column. Include a header like Address or Property Address.")
        else:
            address_series = df.apply(lambda row: compose_import_address(row, column_mapping), axis=1)
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

            analysis_mode = st.selectbox(
                "Analysis Mode",
                options=["Fast", "Full"],
                index=0,
                help=(
                    "Fast analyzes the primary home only. Full also checks nearby walkable homes and cluster potential, "
                    "which is much slower."
                ),
                key="analysis_mode",
            )

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
                    addr = compose_import_address(row, column_mapping).strip()
                    status_text.markdown(f"Analyzing **{i + 1} of {total}** — {str(addr)[:60]}")
                    row_data = {
                        "address": addr,
                        "zipcode": coerce_zipcode(get_row_value(row, column_mapping.get("zipcode"))),
                        "city": get_row_value(row, column_mapping.get("city")),
                        "state": get_row_value(row, column_mapping.get("state")),
                        "price": get_row_value(row, col_price),
                        "price_remainder": get_row_value(row, col_remainder),
                        "beds": get_row_value(row, col_beds),
                        "baths": get_row_value(row, col_baths),
                        "sqft": get_row_value(row, col_sqft),
                        "sold_date": get_row_value(row, col_sold),
                        "permit_pulled": get_row_value(row, col_permit_pulled),
                        "property_type": get_row_value(row, column_mapping.get("property_type")),
                        "lot_size": get_row_value(row, column_mapping.get("lot_size")),
                        "year_built": get_row_value(row, column_mapping.get("year_built")),
                        "source_latitude": get_row_value(row, column_mapping.get("latitude")),
                        "source_longitude": get_row_value(row, column_mapping.get("longitude")),
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
                            process_address(
                                row_data,
                                gmaps_client,
                                api_key,
                                auth_context=auth_context,
                                analysis_mode=analysis_mode.lower(),
                            ),
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
                    if (i + 1) % 10 == 0 or (i + 1) == total:
                        save_app_snapshot(
                            all_results=all_results,
                            route_execution=st.session_state.get("route_execution", {}),
                        )

                    progress_bar.progress((i + 1) / total)

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

    if workspace_mode == "Manager View" and supabase_enabled():
        st.markdown("---")
        st.markdown('<div class="siq-section">Open Lead Pool</div>', unsafe_allow_html=True)
        st.markdown("Load open, unassigned leads from Supabase into the planning workspace.")

        open_pool_seed_results = st.session_state.get("open_pool_filter_seed_results", [])
        open_pool_zip_options = sorted(
            {
                str(result.get("zipcode") or "").strip()
                for result in open_pool_seed_results
                if str(result.get("zipcode") or "").strip()
            }
        )
        open_pool_city_options = sorted(
            {
                infer_city_from_address(result.get("address"))
                for result in open_pool_seed_results
                if infer_city_from_address(result.get("address")) and infer_city_from_address(result.get("address")) != "Unknown"
            }
        )
        if not open_pool_seed_results:
            st.caption("ZIP and city filter options appear after the first open-pool load so the workspace doesn’t prefetch thousands of leads on every rerun.")

        pool_filter_col1, pool_filter_col2, pool_filter_col3 = st.columns(3)
        open_pool_limit = pool_filter_col1.selectbox(
            "Lead Fetch Limit",
            options=[500, 1000, 2500, 5000],
            index=3,
            key="open_pool_limit",
        )
        open_pool_min_price = pool_filter_col2.number_input(
            "Min Price",
            min_value=0,
            value=0,
            step=50000,
            key="open_pool_min_price",
        )
        open_pool_max_price = pool_filter_col3.number_input(
            "Max Price",
            min_value=0,
            value=0,
            step=50000,
            key="open_pool_max_price",
        )
        pool_filter_col4, pool_filter_col5, pool_filter_col6 = st.columns(3)
        open_pool_min_sun = pool_filter_col4.number_input(
            "Min Sun Hours",
            min_value=0.0,
            value=0.0,
            step=50.0,
            key="open_pool_min_sun",
        )
        open_pool_max_sun = pool_filter_col5.number_input(
            "Max Sun Hours",
            min_value=0.0,
            value=0.0,
            step=50.0,
            key="open_pool_max_sun",
        )
        open_pool_sold_date = pool_filter_col6.text_input(
            "Sold Date Contains",
            placeholder="e.g. 2024 or Apr 2024",
            key="open_pool_sold_date",
        )
        pool_filter_col7, pool_filter_col8 = st.columns(2)
        open_pool_zipcodes = pool_filter_col7.multiselect(
            "ZIP Codes",
            options=open_pool_zip_options,
            key="open_pool_zipcodes",
            placeholder="Select one or more ZIPs",
        )
        open_pool_cities = pool_filter_col8.multiselect(
            "Cities",
            options=open_pool_city_options,
            key="open_pool_cities",
            placeholder="Select one or more cities",
        )

        pool_col, drafts_col = st.columns(2)

        if pool_col.button("Load Open Lead Pool", use_container_width=True):
            pool_results = get_open_lead_pool(limit=int(open_pool_limit), auth_context=auth_context)
            st.session_state["open_pool_filter_seed_results"] = pool_results
            pool_results = filter_open_lead_pool_results(
                pool_results,
                sold_date_query=open_pool_sold_date,
                min_price=(float(open_pool_min_price) if open_pool_min_price > 0 else None),
                max_price=(float(open_pool_max_price) if open_pool_max_price > 0 else None),
                min_sun_hours=(float(open_pool_min_sun) if open_pool_min_sun > 0 else None),
                max_sun_hours=(float(open_pool_max_sun) if open_pool_max_sun > 0 else None),
                selected_zipcodes=open_pool_zipcodes,
                selected_cities=open_pool_cities,
            )
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
