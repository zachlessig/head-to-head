-- The server's own role (used only by the stripe-webhook and billing functions) had no rights on
-- billing: new tables on this project don't hand service_role privileges by default, so the first
-- sandbox subscription on 2026-11-17 failed with "permission denied for table billing".
grant select, insert, update, delete on public.billing to service_role;
