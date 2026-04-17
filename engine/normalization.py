def coerce_zipcode(value):
    text = str(value or "").strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    if text.endswith(".0"):
        text = text[:-2]
    digits = "".join(char for char in text if char.isdigit())
    if not digits:
        return None
    if len(digits) == 4:
        return f"0{digits}"
    if len(digits) == 5:
        return digits
    if len(digits) == 9:
        return f"{digits[:5]}-{digits[5:]}"
    return digits
