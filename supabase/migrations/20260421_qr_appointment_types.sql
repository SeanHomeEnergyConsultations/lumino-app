alter table if exists public.appointments
  add column if not exists appointment_type text
    check (appointment_type in ('phone_call', 'in_person_consult'));
