-- The billing function (server only, service key) checks who owns a company before opening plan
-- checkout, and deletes an account's company and memberships on "Delete account" (Zach
-- 2026-11-17). service_role had no SELECT or DELETE on these tables (found 2026-11-17: the owner
-- check would have failed with permission denied). Just what those two jobs need; jobs, folders
-- and invites go by the companies foreign keys' cascade.
grant select, delete on public.companies to service_role;
grant select, delete on public.members to service_role;
