import requests


def get_solar_insights(lat, lng, key):
    if lat is None or lng is None:
        return {}

    base_params = {"location.latitude": lat, "location.longitude": lng, "key": key}
    attempts = [
        {},
        {"requiredQuality": "MEDIUM", "exactQualityRequired": "false"},
    ]

    for extra_params in attempts:
        try:
            response = requests.get(
                "https://solar.googleapis.com/v1/buildingInsights:findClosest",
                params={**base_params, **extra_params},
                timeout=10,
            )
            if response.status_code != 200:
                continue

            payload = response.json()
            solar_potential = payload.get("solarPotential", {})
            best_config = _best_config(solar_potential.get("solarPanelConfigs", []))
            roof_segments = solar_potential.get("roofSegmentStats", []) or []
            south_facing_segments = sum(
                1 for segment in roof_segments if _is_south_facing(segment.get("azimuthDegrees"))
            )
            imagery_quality = payload.get("imageryQuality")

            return {
                "sun_hours": solar_potential.get("maxSunshineHoursPerYear"),
                "max_array_panels_count": solar_potential.get("maxArrayPanelsCount"),
                "panel_capacity_watts": solar_potential.get("panelCapacityWatts"),
                "panel_height_meters": solar_potential.get("panelHeightMeters"),
                "panel_width_meters": solar_potential.get("panelWidthMeters"),
                "panel_lifetime_years": solar_potential.get("panelLifetimeYears"),
                "max_array_area_m2": solar_potential.get("maxArrayAreaMeters2"),
                "carbon_offset_factor_kg_per_mwh": solar_potential.get("carbonOffsetFactorKgPerMwh"),
                "whole_roof_area_m2": (solar_potential.get("wholeRoofStats") or {}).get("areaMeters2"),
                "building_area_m2": (solar_potential.get("buildingStats") or {}).get("areaMeters2"),
                "roof_segment_count": len(roof_segments),
                "south_facing_segment_count": south_facing_segments,
                "imagery_quality": imagery_quality,
                "yearly_energy_dc_kwh": best_config.get("yearlyEnergyDcKwh"),
                "configured_panel_count": best_config.get("panelsCount"),
                "system_capacity_kw": _system_capacity_kw(
                    best_config.get("panelsCount"),
                    solar_potential.get("panelCapacityWatts"),
                ),
            }
        except Exception:
            pass
    return {}


def get_solar_hours(lat, lng, key):
    return get_solar_insights(lat, lng, key).get("sun_hours")


def classify_sun_hours(hours):
    if hours is None:
        return "Unknown", 0
    if hours > 1600:
        return "Best", 4
    if hours >= 1400:
        return "Better", 3
    if hours >= 1200:
        return "Good", 2
    if hours >= 1000:
        return "Low", 1
    return "Too Low", 0


def format_solar_detail(value, suffix="", precision=0):
    if value is None:
        return "N/A"
    if isinstance(value, (int, float)):
        return f"{value:,.{precision}f}{suffix}"
    return f"{value}{suffix}"


def _best_config(configs):
    if not configs:
        return {}
    return max(
        configs,
        key=lambda item: (
            item.get("yearlyEnergyDcKwh") or 0,
            item.get("panelsCount") or 0,
        ),
    )


def _system_capacity_kw(panel_count, panel_capacity_watts):
    if not panel_count or not panel_capacity_watts:
        return None
    return (panel_count * panel_capacity_watts) / 1000


def _is_south_facing(azimuth_degrees):
    if azimuth_degrees is None:
        return False
    return 90 <= azimuth_degrees <= 270
