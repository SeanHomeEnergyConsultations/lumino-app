import html
import json

import streamlit as st
import streamlit.components.v1 as components


def _get_query_params():
    try:
        return {key: list(value) for key, value in st.query_params.items()}
    except Exception:
        return st.experimental_get_query_params()


def _set_query_params(params):
    cleaned = {key: value for key, value in params.items() if value}
    try:
        st.query_params.clear()
        for key, value in cleaned.items():
            st.query_params[key] = value
    except Exception:
        st.experimental_set_query_params(**cleaned)


def _consume_query_payload(prefix):
    query_params = _get_query_params()
    lat_key = f"{prefix}_lat"
    lng_key = f"{prefix}_lng"
    error_key = f"{prefix}_error"
    accuracy_key = f"{prefix}_accuracy"
    timestamp_key = f"{prefix}_timestamp"

    payload = None
    if lat_key in query_params and lng_key in query_params:
        try:
            payload = {
                "latitude": float(query_params[lat_key][0]),
                "longitude": float(query_params[lng_key][0]),
            }
            if accuracy_key in query_params:
                payload["accuracy"] = float(query_params[accuracy_key][0])
            if timestamp_key in query_params:
                payload["timestamp"] = float(query_params[timestamp_key][0])
        except Exception:
            payload = {"error": "Could not parse browser location."}
    elif error_key in query_params:
        payload = {"error": query_params[error_key][0]}

    if payload is not None:
        for key in [lat_key, lng_key, error_key, accuracy_key, timestamp_key]:
            query_params.pop(key, None)
        _set_query_params(query_params)

    return payload


def geolocation_picker(key, label="Use My Current Location", auto_request=False, show_button=True):
    prefix = f"lumino_geo_{key}"
    payload = _consume_query_payload(prefix)
    escaped_label = html.escape(label, quote=True)
    encoded_prefix = json.dumps(prefix)
    encoded_auto_request = json.dumps(bool(auto_request))
    button_display = "flex" if show_button else "none"
    status_min_height = "32px" if show_button else "20px"

    components.html(
        f"""
        <div style="display:flex;align-items:center;gap:0.75rem;min-height:{status_min_height};">
          <button id="{prefix}_button" style="
            display:{button_display};
            width:100%;
            padding:0.75rem 1rem;
            border:none;
            border-radius:0.5rem;
            font-weight:700;
            cursor:pointer;
            background:linear-gradient(135deg, #d4af50, #a07830);
            color:#080608;
          ">{escaped_label}</button>
          <div id="{prefix}_status" style="font-size:0.875rem;color:#8a95aa;">GPS idle</div>
        </div>
        <script>
          const prefix = {encoded_prefix};
          const autoRequest = {encoded_auto_request};
          const button = document.getElementById("{prefix}_button");
          const status = document.getElementById("{prefix}_status");
          const storageKey = `${{prefix}}_last_location`;
          const requestedKey = `${{prefix}}_requested_once`;

          function updateParentUrl(mutator) {{
            const rootWindow = window.parent || window.top || window;
            const nextUrl = new URL(rootWindow.location.href);
            mutator(nextUrl.searchParams);
            rootWindow.location.href = nextUrl.toString();
          }}

          function requestLocation() {{
            if (!navigator.geolocation) {{
              status.textContent = "Geolocation unavailable";
              updateParentUrl((params) => {{
                params.set(`${{prefix}}_error`, "Geolocation unavailable");
              }});
              return;
            }}

            status.textContent = "Requesting location...";
            navigator.geolocation.getCurrentPosition(
              (position) => {{
                status.textContent = "Location captured";
                try {{
                  localStorage.setItem(storageKey, JSON.stringify({{
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: position.timestamp
                  }}));
                  sessionStorage.setItem(requestedKey, "1");
                }} catch (e) {{}}
                updateParentUrl((params) => {{
                  params.set(`${{prefix}}_lat`, String(position.coords.latitude));
                  params.set(`${{prefix}}_lng`, String(position.coords.longitude));
                  params.set(`${{prefix}}_accuracy`, String(position.coords.accuracy));
                  params.set(`${{prefix}}_timestamp`, String(position.timestamp));
                  params.delete(`${{prefix}}_error`);
                }});
              }},
              (error) => {{
                status.textContent = error.message || "Location failed";
                try {{
                  sessionStorage.setItem(requestedKey, "1");
                }} catch (e) {{}}
                updateParentUrl((params) => {{
                  params.set(`${{prefix}}_error`, error.message || "Location failed");
                }});
              }},
              {{
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 60000,
              }}
            );
          }}

          button.addEventListener("click", requestLocation);

          try {{
            const cached = localStorage.getItem(storageKey);
            const requested = sessionStorage.getItem(requestedKey);
            if (cached && !requested) {{
              const parsed = JSON.parse(cached);
              updateParentUrl((params) => {{
                params.set(`${{prefix}}_lat`, String(parsed.latitude));
                params.set(`${{prefix}}_lng`, String(parsed.longitude));
                if (parsed.accuracy !== undefined) params.set(`${{prefix}}_accuracy`, String(parsed.accuracy));
                if (parsed.timestamp !== undefined) params.set(`${{prefix}}_timestamp`, String(parsed.timestamp));
                params.delete(`${{prefix}}_error`);
              }});
            }} else if (autoRequest && !requested) {{
              requestLocation();
            }}
          }} catch (e) {{
            if (autoRequest) {{
              requestLocation();
            }}
          }}
        </script>
        """,
        height=74 if show_button else 28,
    )
    return payload
