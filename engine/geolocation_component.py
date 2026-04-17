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


def _consume_address_payload(prefix):
    query_params = _get_query_params()
    address_key = f"{prefix}_address"
    postal_key = f"{prefix}_postal"
    city_key = f"{prefix}_city"
    state_key = f"{prefix}_state"

    payload = None
    if address_key in query_params:
        payload = {
            "address": query_params[address_key][0],
            "postal_code": query_params.get(postal_key, [""])[0],
            "city": query_params.get(city_key, [""])[0],
            "state": query_params.get(state_key, [""])[0],
        }
        for key in [address_key, postal_key, city_key, state_key]:
            query_params.pop(key, None)
        _set_query_params(query_params)
    return payload


def address_autocomplete_input(key, api_key, label="Search address"):
    prefix = f"lumino_addr_{key}"
    payload = _consume_address_payload(prefix)
    escaped_label = html.escape(label, quote=True)
    encoded_prefix = json.dumps(prefix)
    encoded_api_key = json.dumps(api_key or "")

    components.html(
        f"""
        <div style="display:flex;flex-direction:column;gap:0.35rem;min-height:82px;">
          <label for="{prefix}_input" style="font-size:0.92rem;font-weight:600;color:#d6deec;">{escaped_label}</label>
          <input id="{prefix}_input" type="text" placeholder="Start typing an address"
            style="
              width:100%;
              padding:0.75rem 0.9rem;
              border:1px solid #2a3654;
              border-radius:0.65rem;
              background:#0d1423;
              color:#eef3ff;
              font-size:0.95rem;
            " />
          <div id="{prefix}_status" style="font-size:0.8rem;color:#8a95aa;">Choose a suggested address to fill the form.</div>
        </div>
        <script>
          const prefix = {encoded_prefix};
          const apiKey = {encoded_api_key};
          const input = document.getElementById("{prefix}_input");
          const status = document.getElementById("{prefix}_status");

          function updateParentUrl(payload) {{
            const rootWindow = window.parent || window.top || window;
            const nextUrl = new URL(rootWindow.location.href);
            const params = nextUrl.searchParams;
            params.set(`${{prefix}}_address`, payload.address || "");
            params.set(`${{prefix}}_postal`, payload.postal_code || "");
            params.set(`${{prefix}}_city`, payload.city || "");
            params.set(`${{prefix}}_state`, payload.state || "");
            rootWindow.location.href = nextUrl.toString();
          }}

          function loadPlacesScript(callback) {{
            if (window.google && window.google.maps && window.google.maps.places) {{
              callback();
              return;
            }}
            const existing = document.getElementById(`${{prefix}}_places_script`);
            if (existing) {{
              existing.addEventListener("load", callback, {{ once: true }});
              return;
            }}
            const script = document.createElement("script");
            script.id = `${{prefix}}_places_script`;
            script.src = `https://maps.googleapis.com/maps/api/js?key=${{apiKey}}&libraries=places`;
            script.async = true;
            script.defer = true;
            script.addEventListener("load", callback, {{ once: true }});
            script.addEventListener("error", () => {{
              status.textContent = "Address autocomplete could not load.";
            }});
            document.head.appendChild(script);
          }}

          function componentValue(components, type) {{
            const match = (components || []).find((item) => (item.types || []).includes(type));
            return match ? match.long_name : "";
          }}

          function initAutocomplete() {{
            if (!(window.google && window.google.maps && window.google.maps.places)) {{
              status.textContent = "Address autocomplete unavailable.";
              return;
            }}
            const autocomplete = new google.maps.places.Autocomplete(input, {{
              types: ["address"],
              fields: ["formatted_address", "address_components"],
            }});
            autocomplete.addListener("place_changed", () => {{
              const place = autocomplete.getPlace();
              const components = place.address_components || [];
              const payload = {{
                address: place.formatted_address || input.value || "",
                postal_code: componentValue(components, "postal_code"),
                city: componentValue(components, "locality") || componentValue(components, "postal_town"),
                state: componentValue(components, "administrative_area_level_1"),
              }};
              status.textContent = payload.address ? "Address selected." : "Choose a suggested address.";
              if (payload.address) {{
                updateParentUrl(payload);
              }}
            }});
          }}

          if (!apiKey) {{
            status.textContent = "Google API key missing.";
          }} else {{
            loadPlacesScript(initAutocomplete);
          }}
        </script>
        """,
        height=96,
    )
    return payload
