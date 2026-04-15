def score_home_value(price):
    if not price or price <= 0:
        return 0, "Unknown", "Unknown"
    if price >= 1500000:
        return 3, f"${price:,.0f}", "Ultra High"
    if price >= 1000000:
        return 3, f"${price:,.0f}", "High Value"
    if price >= 750000:
        return 2, f"${price:,.0f}", "Upper Mid"
    if price >= 500000:
        return 2, f"${price:,.0f}", "Mid Value"
    if price >= 300000:
        return 1, f"${price:,.0f}", "Standard"
    return 0, f"${price:,.0f}", "Lower Value"


def score_sqft(sqft):
    if not sqft or sqft <= 0:
        return 0, "Unknown"
    if sqft >= 3000:
        return 3, f"{sqft:,.0f} sq ft"
    if sqft >= 2500:
        return 2, f"{sqft:,.0f} sq ft"
    if sqft >= 2000:
        return 2, f"{sqft:,.0f} sq ft"
    if sqft >= 1500:
        return 1, f"{sqft:,.0f} sq ft"
    return 0, f"{sqft:,.0f} sq ft"


def score_roof_capacity(max_panels_count, max_array_area_m2, yearly_energy_dc_kwh):
    panels = max_panels_count or 0
    area = max_array_area_m2 or 0
    energy = yearly_energy_dc_kwh or 0
    if panels >= 24 or area >= 45 or energy >= 12000:
        return 2
    if panels >= 14 or area >= 26 or energy >= 7000:
        return 1
    return 0


def score_roof_complexity(roof_segment_count, south_facing_segment_count):
    segments = roof_segment_count or 0
    south_segments = south_facing_segment_count or 0
    if not segments:
        return 0
    if segments <= 4 or south_segments >= max(1, round(segments * 0.5)):
        return 1
    return 0


def score_solar_fit(sun_score, roof_capacity_score, roof_complexity_score):
    if sun_score == 0:
        return 0
    return sun_score + roof_capacity_score + roof_complexity_score


def combined_priority(solar_fit_score, value_score, sqft_score, doors_to_knock):
    if solar_fit_score == 0:
        return 0, "LOW — Poor solar potential"

    total = solar_fit_score + value_score + sqft_score
    if doors_to_knock >= 8:
        total += 2
    elif doors_to_knock >= 3:
        total += 1

    if solar_fit_score >= 6 and total >= 10:
        return 4, "PREMIUM — High value + great solar"
    if solar_fit_score >= 4 and total >= 7:
        return 3, "HIGHEST — Park and knock multiple"
    if solar_fit_score >= 3 and total >= 5:
        return 2, "HIGH — Worth stopping"
    if solar_fit_score >= 2 and total >= 3:
        return 1, "MEDIUM — Quick stop"
    return 0, "LOW — Skip"
