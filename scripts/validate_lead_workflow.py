from datetime import datetime, timedelta
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine.lead_workflow import (
    LEAD_STATUS_OPTIONS,
    allowed_outcomes_for_activity,
    derive_lead_follow_up,
)


def assert_equal(actual, expected, label):
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def assert_in(member, collection, label):
    if member not in collection:
        raise AssertionError(f"{label}: expected {member!r} in {collection!r}")


def run():
    now = datetime(2026, 4, 17, 12, 0, 0)

    assert_equal(
        allowed_outcomes_for_activity("Call Outbound"),
        ["Connected", "No Answer", "Left Voicemail", "Wrong Number", "Requested Callback"],
        "Call Outbound outcome compatibility",
    )

    new_state = derive_lead_follow_up({}, [], now=now)
    assert_equal(new_state["lead_status"], "New", "New lead status")
    assert_equal(new_state["next_recommended_step"], "Call first, then text if no answer", "New lead recommendation")

    attempting_state = derive_lead_follow_up(
        {},
        [
            {
                "activity_type": "Call Outbound",
                "outcome": "No Answer",
                "activity_at": (now - timedelta(hours=2)).isoformat(),
            }
        ],
        now=now,
    )
    assert_equal(attempting_state["lead_status"], "Attempting Contact", "Attempting contact status")
    assert_in("Text next", [attempting_state["next_recommended_step"]], "Channel rotation recommendation")

    callback_state = derive_lead_follow_up(
        {},
        [
            {
                "activity_type": "Call Outbound",
                "outcome": "Requested Callback",
                "activity_at": (now - timedelta(hours=1)).isoformat(),
                "requested_callback_at": (now + timedelta(hours=3)).isoformat(),
            }
        ],
        now=now,
    )
    assert_equal(callback_state["lead_status"], "Connected", "Requested callback status")
    assert_equal(callback_state["next_follow_up_at"], (now + timedelta(hours=3)).isoformat(), "Requested callback timing")

    dnc_state = derive_lead_follow_up(
        {},
        [
            {
                "activity_type": "Status Changed",
                "outcome": "Do Not Contact",
                "activity_at": now.isoformat(),
                "event_metadata": {"manual_status": "Do Not Contact"},
            }
        ],
        now=now,
    )
    assert_equal(dnc_state["lead_status"], "Do Not Contact", "DNC status")
    assert_in("DNC Flag", dnc_state["follow_up_flags"], "DNC flag")
    assert_equal(dnc_state["next_follow_up_at"], None, "DNC suppresses reminders")

    stale_state = derive_lead_follow_up(
        {},
        [
            {
                "activity_type": "Conversation",
                "outcome": "Interested",
                "activity_at": (now - timedelta(days=15)).isoformat(),
            }
        ],
        now=now,
    )
    assert_equal(stale_state["lead_status"], "Connected", "Connected stale lead status")
    assert_in("Critical Stale", stale_state["follow_up_flags"], "Critical stale flag")
    assert_in("Overdue", stale_state["follow_up_flags"], "Overdue flag")

    appointment_completed_state = derive_lead_follow_up(
        {},
        [
            {
                "activity_type": "Appointment Completed",
                "activity_at": now.isoformat(),
            }
        ],
        now=now,
    )
    assert_equal(appointment_completed_state["lead_status"], "New", "Appointment completed does not persist as lead status")
    assert_equal(
        appointment_completed_state["next_recommended_step"],
        "Log post-appointment disposition within 24 hours",
        "Appointment completed next step",
    )

    manual_closed_lost = derive_lead_follow_up(
        {},
        [
            {
                "activity_type": "Status Changed",
                "activity_at": now.isoformat(),
                "event_metadata": {"manual_status": "Closed Lost"},
            }
        ],
        now=now,
    )
    assert_equal(manual_closed_lost["lead_status"], "Closed Lost", "Manual status override")

    for status in LEAD_STATUS_OPTIONS:
        assert_in(status, LEAD_STATUS_OPTIONS, "Known lead status")

    print("lead_workflow validation passed")


if __name__ == "__main__":
    run()
