-- Accounts, companies, invites, crew folders and jobs saved online (Zach 2026-11-10).
-- One account per company; the owner invites people by email, with no cap on how many.
-- Each company sees only its own folders and jobs; every table is locked by row level security.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  owner_id uuid not null references auth.users (id) on delete restrict,
  -- company-wide settings, like their own backflow and filter setups
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  email text not null,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index members_user_id_idx on public.members (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email = lower(email)),
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (company_id, email)
);
create index invites_email_idx on public.invites (email);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create index folders_company_id_idx on public.folders (company_id);

-- A job is the same object the app already keeps on the phone, stored whole as JSON.
-- id is the app's own job id, so a job made offline keeps its id when it reaches the server.
create table public.jobs (
  -- the app's ids are short letters and digits; anything else is refused (a job id reaches the page)
  id text primary key check (id ~ '^[A-Za-z0-9_-]{4,40}$'),
  company_id uuid not null references public.companies (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete set null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
create index jobs_company_updated_idx on public.jobs (company_id, updated_at);

-- Is the signed-in user in this company? security definer so policies can call it without
-- recursing through the members table's own policies.
create function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where company_id = cid and user_id = auth.uid());
$$;

create function public.is_owner(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where company_id = cid and user_id = auth.uid() and role = 'owner');
$$;

alter table public.companies enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.folders enable row level security;
alter table public.jobs enable row level security;

-- companies: members read; the owner renames and changes settings. Created only through create_company().
create policy companies_read on public.companies for select using (public.is_member(id));
create policy companies_owner_update on public.companies for update using (public.is_owner(id)) with check (public.is_owner(id));
-- direct updates may only touch the name; ownership and settings go through functions
revoke update on public.companies from authenticated;
grant update (name) on public.companies to authenticated;

-- members: everyone in the company sees who's on it; the owner removes people (not themselves);
-- anyone but the owner can leave on their own.
create policy members_read on public.members for select using (public.is_member(company_id));
create policy members_owner_delete on public.members for delete using (public.is_owner(company_id) and role <> 'owner');
create policy members_leave on public.members for delete using (user_id = auth.uid() and role <> 'owner');

-- invites: the owner sees, sends and cancels them; the person invited sees their own.
create policy invites_owner_read on public.invites for select using (public.is_owner(company_id) or email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy invites_owner_insert on public.invites for insert with check (public.is_owner(company_id) and invited_by = auth.uid());
create policy invites_owner_delete on public.invites for delete using (public.is_owner(company_id));

-- folders and jobs: anyone in the company reads and writes them.
create policy folders_member_all on public.folders for all using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy jobs_member_all on public.jobs for all using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Start a company with the signed-in user as owner.
create function public.create_company(company_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.companies (name, owner_id) values (company_name, auth.uid()) returning id into cid;
  insert into public.members (company_id, user_id, role, email)
    values (cid, auth.uid(), 'owner', lower(coalesce(auth.jwt() ->> 'email', '')));
  return cid;
end;
$$;

-- Invites wait for the person to say yes. Joining automatically on sign-in would let anyone who
-- knows your email pull you into their company, where your saved jobs would go to them (security
-- review 2026-11-10).
create function public.my_invites() returns table (id uuid, company_name text, invited_by_email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, c.name, coalesce(m.email, ''), i.created_at
  from public.invites i
  join public.companies c on c.id = i.company_id
  left join public.members m on m.company_id = i.company_id and m.user_id = i.invited_by
  where i.email = lower(coalesce(auth.jwt() ->> 'email', '')) and i.accepted_at is null
  order by i.created_at;
$$;

create function public.accept_invite(invite_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
declare r record;
begin
  if auth.uid() is null or me = '' then raise exception 'not signed in'; end if;
  select * into r from public.invites where id = invite_id and email = me and accepted_at is null;
  if not found then raise exception 'no such invite'; end if;
  insert into public.members (company_id, user_id, role, email)
    values (r.company_id, auth.uid(), 'member', me)
    on conflict (company_id, user_id) do nothing;
  update public.invites set accepted_at = now() where id = r.id;
  return r.company_id;
end;
$$;

create function public.decline_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.invites where id = invite_id and email = lower(coalesce(auth.jwt() ->> 'email', '')) and accepted_at is null;
end;
$$;

-- Settings like the backflow setup are shared, so any member may save them, but only them:
-- a member updating the companies row directly could otherwise rename it or change owner_id.
create function public.save_company_settings(cid uuid, new_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(cid) then raise exception 'not in this company'; end if;
  if jsonb_typeof(new_settings) <> 'object' then raise exception 'settings must be an object'; end if;
  update public.companies set settings = new_settings where id = cid;
end;
$$;

revoke all on function public.save_company_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_company_settings(uuid, jsonb) to authenticated;
revoke all on function public.create_company(text) from public, anon;
revoke all on function public.my_invites() from public, anon;
revoke all on function public.accept_invite(uuid) from public, anon;
revoke all on function public.decline_invite(uuid) from public, anon;
grant execute on function public.create_company(text) to authenticated;
grant execute on function public.my_invites() to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.decline_invite(uuid) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_owner(uuid) to authenticated;

-- The server stamps who saved a job and when, so a phone's clock or a bad client can't fake it.
-- Syncing reads jobs newer than the last pull by this column.
create function public.stamp_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger jobs_stamp before insert or update on public.jobs
  for each row execute function public.stamp_job();
