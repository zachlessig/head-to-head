-- A homeowner's paid yard, kept so it can be emailed to them and opened again from the link in that
-- email (Zach 2026-11-18: "once the yard is paid for they automatically get the map sent to them in
-- case they exit the page its not lost"). Written before checkout, marked paid and emailed by the
-- stripe-webhook function. Only the server's own role can touch it; the token in the link is the key.
create table if not exists public.yard_copies (
  token text primary key,
  job_id text not null,
  job jsonb not null,
  email text not null,
  plan_png text,
  parts_text text,
  session_id text,
  paid boolean not null default false,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.yard_copies enable row level security;
revoke all on public.yard_copies from anon, authenticated;
grant select, insert, update, delete on public.yard_copies to service_role;
