alter table public.leads
add column if not exists lead_status text not null default 'New'
  check (lead_status in ('New', 'Attempting Contact', 'Connected', 'Nurture', 'Appointment Set', 'Qualified', 'Closed Won', 'Closed Lost', 'Do Not Contact'));

alter table public.leads
add column if not exists follow_up_flags jsonb not null default '[]'::jsonb;

alter table public.leads
add column if not exists first_outreach_at timestamptz;

alter table public.leads
add column if not exists first_meaningful_contact_at timestamptz;

alter table public.leads
add column if not exists last_outreach_at timestamptz;

alter table public.leads
add column if not exists last_inbound_at timestamptz;

alter table public.leads
add column if not exists last_meaningful_contact_at timestamptz;

alter table public.leads
add column if not exists next_follow_up_at timestamptz;

alter table public.leads
add column if not exists last_activity_at timestamptz;

alter table public.leads
add column if not exists last_activity_type text;

alter table public.leads
add column if not exists last_activity_outcome text;

alter table public.leads
add column if not exists next_recommended_step text;

alter table public.leads
add column if not exists nurture_reason text;

alter table public.leads
add column if not exists appointment_at timestamptz;

update public.leads
set lead_status = 'New'
where lead_status is null
  and status in ('open', 'assigned', 'in_progress');

alter table public.route_run_stops
drop constraint if exists route_run_stops_outcome_check;

update public.route_run_stops
set outcome = case outcome
  when 'interested' then 'Interested'
  when 'callback' then 'Requested Callback'
  when 'not_interested' then 'Not Interested'
  when 'not_home' then 'No Answer'
  when 'bad_address' then 'Bad Contact Info'
  when 'duplicate' then 'Disqualified'
  else outcome
end
where outcome in ('interested', 'callback', 'not_interested', 'not_home', 'bad_address', 'duplicate');

update public.route_run_stops
set outcome = null
where outcome is not null
  and outcome not in (
    'Connected', 'No Answer', 'Left Voicemail', 'Wrong Number', 'Bad Contact Info',
    'Requested Callback', 'Interested', 'Not Interested', 'Needs Nurture',
    'Booked Appointment', 'Rescheduled', 'Canceled', 'Qualified',
    'Disqualified', 'Do Not Contact'
  );

alter table public.route_run_stops
add constraint route_run_stops_outcome_check
check (outcome in (
  'Connected', 'No Answer', 'Left Voicemail', 'Wrong Number', 'Bad Contact Info',
  'Requested Callback', 'Interested', 'Not Interested', 'Needs Nurture',
  'Booked Appointment', 'Rescheduled', 'Canceled', 'Qualified',
  'Disqualified', 'Do Not Contact'
) or outcome is null);

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  activity_type text not null
    check (activity_type in (
      'Call Outbound', 'Text Outbound', 'Email Outbound', 'Door Knock',
      'Call Inbound', 'Text Inbound', 'Email Inbound',
      'Conversation', 'Note',
      'Appointment Set', 'Appointment Rescheduled', 'Appointment Completed', 'Appointment Canceled',
      'Lead Qualified', 'Lead Disqualified', 'Status Changed'
    )),
  outcome text
    check (outcome in (
      'Connected', 'No Answer', 'Left Voicemail', 'Wrong Number', 'Bad Contact Info',
      'Requested Callback', 'Interested', 'Not Interested', 'Needs Nurture',
      'Booked Appointment', 'Rescheduled', 'Canceled', 'Qualified',
      'Disqualified', 'Do Not Contact'
    ) or outcome is null),
  note_body text,
  activity_at timestamptz not null default now(),
  requested_callback_at timestamptz,
  appointment_at timestamptz,
  nurture_reason text,
  event_metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lead_activities_org_id on public.lead_activities(organization_id);
create index if not exists idx_lead_activities_lead_id on public.lead_activities(lead_id);
create index if not exists idx_lead_activities_activity_at on public.lead_activities(activity_at desc);
create index if not exists idx_leads_lead_status on public.leads(lead_status);
create index if not exists idx_leads_next_follow_up_at on public.leads(next_follow_up_at);

drop trigger if exists set_lead_activities_updated_at on public.lead_activities;
create trigger set_lead_activities_updated_at
before update on public.lead_activities
for each row execute function public.set_updated_at();

alter table public.lead_activities enable row level security;

drop policy if exists "org members view lead activities" on public.lead_activities;
create policy "org members view lead activities"
on public.lead_activities
for select
using (
  exists (
    select 1
    from public.leads l
    where l.id = public.lead_activities.lead_id
      and (
        public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
        or (
          public.has_org_role(l.organization_id, array['rep'])
          and (
            l.assigned_to = public.current_app_user_id()
            or l.created_by = public.current_app_user_id()
          )
        )
      )
  )
);

drop policy if exists "org members insert lead activities" on public.lead_activities;
create policy "org members insert lead activities"
on public.lead_activities
for insert
with check (
  exists (
    select 1
    from public.leads l
    where l.id = public.lead_activities.lead_id
      and l.organization_id = public.lead_activities.organization_id
      and (
        public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
        or (
          public.has_org_role(l.organization_id, array['rep'])
          and (
            l.assigned_to = public.current_app_user_id()
            or l.created_by = public.current_app_user_id()
          )
        )
      )
  )
);

drop policy if exists "org managers delete lead activities" on public.lead_activities;
create policy "org managers delete lead activities"
on public.lead_activities
for delete
using (
  exists (
    select 1
    from public.leads l
    where l.id = public.lead_activities.lead_id
      and public.has_org_role(l.organization_id, array['owner', 'admin', 'manager'])
  )
  and public.lead_activities.activity_type = 'Note'
);

drop policy if exists "org members update own visible leads" on public.leads;
create policy "org members update own visible leads"
on public.leads
for update
using (
  public.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  or (
    public.has_org_role(organization_id, array['rep'])
    and (
      assigned_to = public.current_app_user_id()
      or created_by = public.current_app_user_id()
    )
  )
)
with check (
  public.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  or (
    public.has_org_role(organization_id, array['rep'])
    and (
      assigned_to = public.current_app_user_id()
      or created_by = public.current_app_user_id()
    )
  )
);

insert into public.lead_activities (
  organization_id,
  lead_id,
  activity_type,
  note_body,
  activity_at,
  created_by,
  event_metadata
)
select
  l.organization_id,
  l.id,
  'Note',
  l.notes,
  coalesce(l.updated_at, l.created_at, now()),
  l.created_by,
  jsonb_build_object('legacy_source', 'leads.notes')
from public.leads l
where l.organization_id is not null
  and coalesce(nullif(trim(l.notes), ''), '') <> ''
  and not exists (
    select 1
    from public.lead_activities la
    where la.lead_id = l.id
      and la.activity_type = 'Note'
      and la.note_body = l.notes
  );

-- Legacy mapping notes:
-- first_contacted_at, last_contacted_at, and other route-execution-only fields are not persisted on leads today.
-- The app should treat historical notes imported above as legacy activity and compute the new follow-up fields going forward.
