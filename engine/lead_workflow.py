from datetime import datetime, timedelta


OUTREACH_ACTIVITY_TYPES = [
    "Call Outbound",
    "Text Outbound",
    "Email Outbound",
    "Door Knock",
]

RESPONSE_ACTIVITY_TYPES = [
    "Call Inbound",
    "Text Inbound",
    "Email Inbound",
]

INTERACTION_ACTIVITY_TYPES = [
    "Conversation",
    "Note",
]

APPOINTMENT_ACTIVITY_TYPES = [
    "Appointment Set",
    "Appointment Rescheduled",
    "Appointment Completed",
    "Appointment Canceled",
]

PIPELINE_ACTIVITY_TYPES = [
    "Lead Qualified",
    "Lead Disqualified",
    "Status Changed",
]

ACTIVITY_TYPE_OPTIONS = (
    OUTREACH_ACTIVITY_TYPES
    + RESPONSE_ACTIVITY_TYPES
    + INTERACTION_ACTIVITY_TYPES
    + APPOINTMENT_ACTIVITY_TYPES
    + PIPELINE_ACTIVITY_TYPES
)

OUTCOME_OPTIONS = [
    "Connected",
    "No Answer",
    "Left Voicemail",
    "Wrong Number",
    "Bad Contact Info",
    "Requested Callback",
    "Interested",
    "Not Interested",
    "Needs Nurture",
    "Booked Appointment",
    "Rescheduled",
    "Canceled",
    "Qualified",
    "Disqualified",
    "Do Not Contact",
]

LEAD_STATUS_OPTIONS = [
    "New",
    "Attempting Contact",
    "Connected",
    "Nurture",
    "Appointment Set",
    "Qualified",
    "Closed Won",
    "Closed Lost",
    "Do Not Contact",
]

OPEN_LEAD_STATUSES = [
    "New",
    "Attempting Contact",
    "Connected",
    "Nurture",
    "Appointment Set",
    "Qualified",
]

FLAG_OPTIONS = [
    "Overdue",
    "Stale Warning",
    "Critical Stale",
    "DNC Flag",
    "Invalid Contact Info",
]

ACTIVE_LEAD_STATUSES = {
    *OPEN_LEAD_STATUSES[1:],
}

OUTCOME_COMPATIBILITY = {
    "Call Outbound": ["Connected", "No Answer", "Left Voicemail", "Wrong Number", "Requested Callback"],
    "Text Outbound": ["Connected", "Interested", "Not Interested", "Needs Nurture", "Booked Appointment", "Do Not Contact"],
    "Email Outbound": ["Connected", "Interested", "Not Interested", "Needs Nurture", "Booked Appointment"],
    "Door Knock": ["Connected", "No Answer", "Interested", "Not Interested", "Needs Nurture", "Booked Appointment"],
    "Conversation": ["Interested", "Not Interested", "Needs Nurture", "Booked Appointment", "Qualified", "Disqualified", "Requested Callback"],
    "Appointment Rescheduled": ["Rescheduled"],
    "Appointment Canceled": ["Canceled"],
    "Lead Qualified": ["Qualified"],
    "Lead Disqualified": ["Disqualified"],
}

NURTURE_REASON_OPTIONS = [
    "timing",
    "spouse decision",
    "financing",
    "seasonal",
    "comparing bids",
    "other",
]

QUICK_ACTIONS = [
    "Log Call",
    "Log Text",
    "Log Conversation",
    "Book Appointment",
    "Snooze / Reschedule Follow-Up",
    "Mark Nurture",
    "Mark Closed Lost",
    "Mark Do Not Contact",
]


def allowed_outcomes_for_activity(activity_type):
    if not activity_type:
        return OUTCOME_OPTIONS
    allowed = OUTCOME_COMPATIBILITY.get(activity_type)
    return allowed or OUTCOME_OPTIONS


def is_outbound_activity(activity_type):
    return activity_type in OUTREACH_ACTIVITY_TYPES


def is_inbound_activity(activity_type):
    return activity_type in RESPONSE_ACTIVITY_TYPES


def is_meaningful_activity(activity_type, outcome):
    return (
        activity_type == "Conversation"
        or is_inbound_activity(activity_type)
        or outcome == "Connected"
    )


def _to_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except Exception:
        return None


def _dt_iso(value):
    if not value:
        return None
    return value.isoformat()


def _clean_flag_list(flags):
    cleaned = []
    for flag in flags or []:
        if flag in FLAG_OPTIONS and flag not in cleaned:
            cleaned.append(flag)
    return cleaned


def _rotate_channel(next_attempt_count):
    sequence = [
        "Call first, then text if no answer",
        "Text next",
        "Call next",
        "Door knock or text next",
        "Call next",
        "Email or text next",
        "Manager review or nurture path",
    ]
    index = max(0, min(next_attempt_count - 1, len(sequence) - 1))
    return sequence[index]


def derive_lead_follow_up(lead_row, activity_rows, now=None):
    now = now or datetime.now()
    activities = sorted(
        [row for row in (activity_rows or []) if row.get("activity_type") in ACTIVITY_TYPE_OPTIONS],
        key=lambda row: _to_datetime(row.get("activity_at")) or now,
    )

    derived = {
        "lead_status": lead_row.get("lead_status") or "New",
        "follow_up_flags": [],
        "first_outreach_at": None,
        "first_meaningful_contact_at": lead_row.get("first_meaningful_contact_at"),
        "last_outreach_at": None,
        "last_inbound_at": None,
        "last_meaningful_contact_at": lead_row.get("last_meaningful_contact_at"),
        "next_follow_up_at": None,
        "last_activity_at": None,
        "last_activity_type": None,
        "last_activity_outcome": None,
        "next_recommended_step": "Call first, then text if no answer",
        "appointment_at": None,
        "nurture_reason": lead_row.get("nurture_reason"),
    }

    outreach_count = 0
    future_appointment_at = None
    latest_status_override = None

    for activity in activities:
        activity_at = _to_datetime(activity.get("activity_at")) or now
        activity_type = activity.get("activity_type")
        outcome = activity.get("outcome")
        derived["last_activity_at"] = _dt_iso(activity_at)
        derived["last_activity_type"] = activity_type
        derived["last_activity_outcome"] = outcome

        if is_outbound_activity(activity_type):
            outreach_count += 1
            if not derived["first_outreach_at"]:
                derived["first_outreach_at"] = _dt_iso(activity_at)
            derived["last_outreach_at"] = _dt_iso(activity_at)

        if is_inbound_activity(activity_type):
            derived["last_inbound_at"] = _dt_iso(activity_at)

        if is_meaningful_activity(activity_type, outcome):
            if not derived["first_meaningful_contact_at"]:
                derived["first_meaningful_contact_at"] = _dt_iso(activity_at)
            derived["last_meaningful_contact_at"] = _dt_iso(activity_at)

        if activity_type in {"Appointment Set", "Appointment Rescheduled"}:
            future_appointment_at = _to_datetime(activity.get("appointment_at")) or activity_at
            derived["appointment_at"] = _dt_iso(future_appointment_at)
            derived["next_follow_up_at"] = _dt_iso(future_appointment_at)
            derived["next_recommended_step"] = "Appointment reminders are active"
            latest_status_override = "Appointment Set"

        if activity_type == "Appointment Completed":
            derived["next_follow_up_at"] = _dt_iso(activity_at + timedelta(hours=24))
            derived["next_recommended_step"] = "Log post-appointment disposition within 24 hours"

        if activity_type == "Status Changed":
            manual_status = str((activity.get("event_metadata") or {}).get("manual_status") or "").strip()
            if manual_status in LEAD_STATUS_OPTIONS:
                latest_status_override = manual_status
                if manual_status == "Do Not Contact":
                    derived["next_follow_up_at"] = None
                    derived["next_recommended_step"] = "Do not contact"
                elif manual_status == "Closed Lost":
                    derived["next_follow_up_at"] = None
                    derived["next_recommended_step"] = "Closed lost"

        if outcome == "Requested Callback":
            callback_at = _to_datetime(activity.get("requested_callback_at")) or (activity_at + timedelta(days=1))
            derived["next_follow_up_at"] = _dt_iso(callback_at)
            derived["next_recommended_step"] = "Requested callback follow-up"
            latest_status_override = "Connected"

        if outcome == "Needs Nurture":
            derived["next_follow_up_at"] = _dt_iso(activity_at + timedelta(days=10))
            derived["next_recommended_step"] = "Nurture follow-up in 7-14 days"
            derived["nurture_reason"] = activity.get("nurture_reason") or derived["nurture_reason"]
            latest_status_override = "Nurture"

        if activity_type == "Lead Qualified" or outcome == "Qualified":
            derived["next_follow_up_at"] = _dt_iso(activity_at + timedelta(days=1))
            derived["next_recommended_step"] = "Qualified lead follow-up within 1 business day"
            latest_status_override = "Qualified"

        if activity_type == "Lead Disqualified" or outcome == "Disqualified":
            derived["next_recommended_step"] = "Lead disqualified"
            latest_status_override = "Closed Lost"

        if outcome == "Do Not Contact":
            latest_status_override = "Do Not Contact"
            derived["next_follow_up_at"] = None
            derived["next_recommended_step"] = "Do not contact"

        if outcome == "Not Interested":
            latest_status_override = "Closed Lost"
            derived["next_follow_up_at"] = None
            derived["next_recommended_step"] = "Closed lost"

        if outcome == "Bad Contact Info":
            derived["follow_up_flags"].append("Invalid Contact Info")

        if outcome == "Wrong Number":
            derived["follow_up_flags"].append("Invalid Contact Info")

    if not activities:
        derived["lead_status"] = "New"
        derived["next_follow_up_at"] = _dt_iso(now)
        derived["next_recommended_step"] = "Call first, then text if no answer"
    elif latest_status_override:
        derived["lead_status"] = latest_status_override
    elif future_appointment_at and future_appointment_at >= now:
        derived["lead_status"] = "Appointment Set"
    elif derived["last_meaningful_contact_at"]:
        derived["lead_status"] = "Connected"
        if not derived["next_follow_up_at"]:
            derived["next_follow_up_at"] = _dt_iso((_to_datetime(derived["last_meaningful_contact_at"]) or now) + timedelta(days=1))
            derived["next_recommended_step"] = "Follow up within 24 hours"
    elif derived["last_outreach_at"] and not derived["last_inbound_at"]:
        derived["lead_status"] = "Attempting Contact"
        if not derived["next_follow_up_at"]:
            derived["next_follow_up_at"] = _dt_iso((_to_datetime(derived["last_outreach_at"]) or now) + timedelta(days=1))
        derived["next_recommended_step"] = _rotate_channel(outreach_count + 1)

    if derived["lead_status"] == "Do Not Contact":
        derived["follow_up_flags"].append("DNC Flag")

    last_activity_dt = _to_datetime(derived["last_activity_at"])
    next_follow_up_dt = _to_datetime(derived["next_follow_up_at"])

    if derived["lead_status"] in ACTIVE_LEAD_STATUSES and next_follow_up_dt and next_follow_up_dt < now:
        derived["follow_up_flags"].append("Overdue")
    if derived["lead_status"] in ACTIVE_LEAD_STATUSES and last_activity_dt:
        inactive_days = (now - last_activity_dt).days
        if inactive_days >= 14:
            derived["follow_up_flags"].append("Critical Stale")
        elif inactive_days >= 7:
            derived["follow_up_flags"].append("Stale Warning")

    derived["follow_up_flags"] = _clean_flag_list(derived["follow_up_flags"])
    return derived
