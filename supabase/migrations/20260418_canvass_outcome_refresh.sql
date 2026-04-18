alter table public.visits
  drop constraint if exists visits_outcome_check;

alter table public.visits
  add constraint visits_outcome_check
  check (outcome in (
    'no_answer',
    'not_home',
    'left_doorhanger',
    'contact_made',
    'opportunity',
    'interested',
    'callback_requested',
    'not_interested',
    'disqualified',
    'appointment_set',
    'tenant_not_owner',
    'already_customer',
    'competitor_customer',
    'vacant',
    'do_not_knock',
    'bad_address',
    'gate_no_access'
  ));
