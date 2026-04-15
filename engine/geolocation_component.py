from pathlib import Path

import streamlit.components.v1 as components


_COMPONENT_PATH = Path(__file__).resolve().parents[1] / "streamlit_components" / "geolocation"
_geolocation_component = components.declare_component(
    "lumino_geolocation",
    path=str(_COMPONENT_PATH),
)


def geolocation_picker(key, label="Use My Current Location"):
    return _geolocation_component(label=label, key=key, default=None)
