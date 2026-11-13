-- Supabase's default privileges gave anon and authenticated TRUNCATE, REFERENCES and TRIGGER on
-- every new table. TRUNCATE skips row level security, so take all three away; the app never uses them.
revoke truncate, references, trigger on public.companies, public.members, public.invites, public.folders, public.jobs from anon, authenticated;
revoke all on public.companies, public.members, public.invites, public.folders, public.jobs from anon;
-- functions are executable by everyone unless revoked; signed-out visitors get none of them
revoke all on function public.is_member(uuid), public.is_owner(uuid), public.stamp_job() from public, anon;
grant execute on function public.is_member(uuid), public.is_owner(uuid) to authenticated;
