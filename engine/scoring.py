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


def combined_priority(sun_score, value_score, sqft_score, doors_to_knock):
    if sun_score == 0:
        return 0, "LOW — Poor solar potential"

    total = sun_score + value_score + sqft_score
    if doors_to_knock >= 3:
        total += 1

    if total >= 8:
        return 4, "PREMIUM — High value + great solar"
    if total >= 6:
        return 3, "HIGHEST — Park and knock multiple"
    if total >= 4:
        return 2, "HIGH — Worth stopping"
    if total >= 2:
        return 1, "MEDIUM — Quick stop"
    return 0, "LOW — Skip"

