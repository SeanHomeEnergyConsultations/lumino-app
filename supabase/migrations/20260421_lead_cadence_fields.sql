alter table public.leads
add column if not exists decision_maker_status text
  check (decision_maker_status in ('all_present', 'spouse_missing', 'other_missing')),
add column if not exists preferred_channel text
  check (preferred_channel in ('text', 'call', 'door')),
add column if not exists best_contact_time text,
add column if not exists text_consent boolean,
add column if not exists objection_type text
  check (objection_type in ('price', 'timing', 'trust', 'roof', 'needs_numbers', 'spouse', 'none')),
add column if not exists bill_received boolean,
add column if not exists proposal_presented boolean,
add column if not exists appointment_outcome text
  check (appointment_outcome in ('sat_not_closed', 'moved', 'canceled', 'no_show', 'closed')),
add column if not exists reschedule_reason text,
add column if not exists cancellation_reason text,
add column if not exists engagement_score integer
  check (engagement_score between 1 and 5),
add column if not exists cadence_track text
  check (
    cadence_track in (
      'warm_no_contact',
      'warm_with_contact',
      'appointment_active',
      'post_appt_spouse',
      'post_appt_numbers',
      'post_appt_price',
      'post_appt_timing',
      'post_appt_trust',
      'rebook_recovery',
      'customer_onboarding'
    )
  );

comment on column public.leads.decision_maker_status is 'Whether all decision-makers were present during the latest meaningful conversation.';
comment on column public.leads.preferred_channel is 'Best next outreach channel for this lead.';
comment on column public.leads.best_contact_time is 'Rep-entered hint such as evenings, weekends, or after Tuesday.';
comment on column public.leads.text_consent is 'Whether the homeowner has given permission for text follow-up.';
comment on column public.leads.objection_type is 'Primary blocker that should shape post-appointment follow-up.';
comment on column public.leads.bill_received is 'Whether the rep has received the homeowner bill or usage context.';
comment on column public.leads.proposal_presented is 'Whether proposal/numbers have already been shown.';
comment on column public.leads.appointment_outcome is 'Outcome of the most recent appointment when it did not simply stay scheduled.';
comment on column public.leads.reschedule_reason is 'Freeform reason why an appointment was moved.';
comment on column public.leads.cancellation_reason is 'Freeform reason why an appointment was canceled.';
comment on column public.leads.engagement_score is 'Simple 1-5 rep-entered engagement score used to tune cadence intensity.';
comment on column public.leads.cadence_track is 'Current automation track driving follow-up task generation.';
