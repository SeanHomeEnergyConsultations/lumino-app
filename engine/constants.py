PRIORITY = {
    4: {"label": "PREMIUM", "color": "#C9A84C", "bg": "#2A1F00", "text": "#F0C060", "border": "#C9A84C", "dot": "#C9A84C"},
    3: {"label": "HIGHEST", "color": "#2E7D32", "bg": "#0A2010", "text": "#66BB6A", "border": "#2E7D32", "dot": "#43A047"},
    2: {"label": "HIGH", "color": "#00695C", "bg": "#071A17", "text": "#4DB6AC", "border": "#00897B", "dot": "#26A69A"},
    1: {"label": "MEDIUM", "color": "#BF5A00", "bg": "#1D1100", "text": "#FFB74D", "border": "#E67E22", "dot": "#E67E22"},
    0: {"label": "LOW", "color": "#424242", "bg": "#111111", "text": "#757575", "border": "#424242", "dot": "#616161"},
}

DEFAULT_PRIORITY = PRIORITY[0]


def get_priority_meta(score):
    return PRIORITY.get(score, DEFAULT_PRIORITY)


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
    text = str(value or "").strip()
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
        activity_type = activity.get("activity_type")
        outcome = activity.get("outcome")
        activity_at = _to_datetime(activity.get("activity_at")) or now
        metadata = activity.get("event_metadata") or {}

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

        if activity_type == "Status Changed":
            manual_status = str(metadata.get("manual_status") or "").strip()
            if manual_status in LEAD_STATUS_OPTIONS:
                latest_status_override = manual_status

        if activity_type == "Appointment Set":
            appointment_at = _to_datetime(metadata.get("appointment_at") or activity.get("appointment_at"))
            if appointment_at and appointment_at > now:
                future_appointment_at = appointment_at
        elif activity_type == "Appointment Rescheduled":
            appointment_at = _to_datetime(metadata.get("appointment_at") or activity.get("appointment_at"))
            if appointment_at and appointment_at > now:
                future_appointment_at = appointment_at
        elif activity_type == "Appointment Canceled":
            future_appointment_at = None

        if outcome == "Requested Callback":
            requested_at = _to_datetime(
                metadata.get("requested_callback_at") or activity.get("requested_callback_at")
            )
            derived["lead_status"] = "Connected"
            derived["next_follow_up_at"] = _dt_iso(requested_at or (activity_at + timedelta(days=1)))
            derived["next_recommended_step"] = "Call back at the requested time"
        elif outcome == "Needs Nurture":
            derived["lead_status"] = "Nurture"
            derived["nurture_reason"] = metadata.get("nurture_reason") or derived["nurture_reason"]
            derived["next_follow_up_at"] = _dt_iso(activity_at + timedelta(days=10))
            derived["next_recommended_step"] = "Check back in with this nurture lead"
        elif outcome == "Booked Appointment":
            derived["lead_status"] = "Appointment Set"
            derived["next_recommended_step"] = "Send appointment confirmation"
        elif outcome == "Qualified":
            derived["lead_status"] = "Qualified"
            derived["next_follow_up_at"] = _dt_iso(activity_at + timedelta(days=1))
            derived["next_recommended_step"] = "Follow up within 1 business day"
        elif outcome == "Disqualified":
            derived["lead_status"] = "Closed Lost"
            derived["next_follow_up_at"] = None
            derived["next_recommended_step"] = "No further outreach scheduled"
        elif outcome == "Do Not Contact":
            derived["lead_status"] = "Do Not Contact"
            derived["next_follow_up_at"] = None
            derived["next_recommended_step"] = "Suppress all outreach"

    if latest_status_override:
        derived["lead_status"] = latest_status_override

    if not activities:
        derived["lead_status"] = lead_row.get("lead_status") or "New"
        derived["next_follow_up_at"] = _dt_iso(now)
        derived["next_recommended_step"] = "Call first, then text if no answer"
    else:
        last_activity_type = derived["last_activity_type"]
        last_outcome = derived["last_activity_outcome"]

        if future_appointment_at:
            derived["lead_status"] = "Appointment Set"
            derived["appointment_at"] = _dt_iso(future_appointment_at)
            derived["next_follow_up_at"] = _dt_iso(future_appointment_at)
            derived["next_recommended_step"] = "Appointment scheduled. Send reminders at confirmation, 24 hours, and 2 hours before."
        elif derived["lead_status"] not in {"Connected", "Qualified", "Closed Lost", "Do Not Contact", "Nurture"}:
            if (
                last_activity_type == "Conversation"
                or is_inbound_activity(last_activity_type)
                or last_outcome == "Connected"
            ):
                derived["lead_status"] = "Connected"
                if not derived["next_follow_up_at"]:
                    derived["next_follow_up_at"] = _dt_iso((_to_datetime(derived["last_meaningful_contact_at"]) or now) + timedelta(days=1))
                derived["next_recommended_step"] = "Follow up within 24 hours"
            elif is_outbound_activity(last_activity_type):
                derived["lead_status"] = "Attempting Contact"
                if not derived["next_follow_up_at"]:
                    derived["next_follow_up_at"] = _dt_iso((_to_datetime(derived["last_outreach_at"]) or now) + timedelta(days=1))
                derived["next_recommended_step"] = _rotate_channel(outreach_count + 1)

        if last_activity_type == "Appointment Completed":
            if derived["lead_status"] == "Appointment Set":
                derived["lead_status"] = "Connected"
            if not derived["next_follow_up_at"]:
                derived["next_follow_up_at"] = _dt_iso((_to_datetime(derived["last_activity_at"]) or now) + timedelta(days=1))
            derived["next_recommended_step"] = "Log post-appointment disposition within 24 hours"

    flags = []
    lead_status = derived["lead_status"]
    next_follow_up_at = _to_datetime(derived["next_follow_up_at"])
    last_activity_at = _to_datetime(derived["last_activity_at"])

    if lead_status == "Do Not Contact":
        flags.append("DNC Flag")

    last_outcome = derived["last_activity_outcome"]
    if last_outcome in {"Wrong Number", "Bad Contact Info"}:
        flags.append("Invalid Contact Info")

    if lead_status in ACTIVE_LEAD_STATUSES:
        if next_follow_up_at and next_follow_up_at < now:
            flags.append("Overdue")
        if last_activity_at:
            days_idle = (now - last_activity_at).total_seconds() / 86400
            if days_idle >= 14:
                flags.append("Critical Stale")
            elif days_idle >= 7:
                flags.append("Stale Warning")

    derived["follow_up_flags"] = _clean_flag_list(flags)

    if lead_status in {"Closed Lost", "Do Not Contact", "Closed Won"}:
        derived["next_follow_up_at"] = None

    return derived
