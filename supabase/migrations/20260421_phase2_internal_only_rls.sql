alter table if exists public.security_rate_limits enable row level security;
alter table if exists public.security_events enable row level security;
alter table if exists public.organization_upload_consents enable row level security;
alter table if exists public.organization_features enable row level security;
alter table if exists public.app_branding_settings enable row level security;
alter table if exists public.platform_datasets enable row level security;
alter table if exists public.organization_dataset_access enable row level security;
alter table if exists public.organization_dataset_targets enable row level security;
alter table if exists public.platform_dataset_records enable row level security;
alter table if exists public.organization_dataset_entitlements enable row level security;
alter table if exists public.user_google_calendar_connections enable row level security;
alter table if exists public.google_calendar_oauth_states enable row level security;
alter table if exists public.appointment_calendar_syncs enable row level security;
alter table if exists public.task_calendar_syncs enable row level security;

comment on table public.security_rate_limits is
  'Internal-only abuse protection counters. Access should be limited to service-role workflows.';

comment on table public.security_events is
  'Internal-only security event log. Access should be limited to service-role workflows and curated admin APIs.';

comment on table public.user_google_calendar_connections is
  'Internal-only encrypted Google Calendar OAuth connections.';

comment on table public.google_calendar_oauth_states is
  'Internal-only temporary OAuth state values for Google Calendar connect.';

comment on table public.appointment_calendar_syncs is
  'Internal-only external calendar sync state for appointments.';

comment on table public.task_calendar_syncs is
  'Internal-only external calendar sync state for tasks.';
