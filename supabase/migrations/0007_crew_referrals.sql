-- Crew and referrals (Zach 2026-11-17).
-- Crew: "lets just say you can have 5 crew members on the app before you need $5 more a month".
-- The billing function counts members itself; nothing here stores a count the app could fake.
-- Referrals: every company gets a code to hand another contractor. The new contractor gets $5 off
-- their first month; the company that shared it gets one free month once the new contractor's
-- second payment goes through (changed from first the same day). Free months stack (they're credit on the Stripe customer).

-- 8 letters and digits with no 0/O or 1/I, so it reads back over the phone
create function public.new_referral_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text;
begin
  loop
    out := '';
    for i in 1..8 loop
      out := out || substr(abc, 1 + floor(random() * length(abc))::int, 1);
    end loop;
    exit when not exists (select 1 from public.companies where referral_code = out);
  end loop;
  return out;
end;
$$;

alter table public.companies add column referral_code text unique;
update public.companies set referral_code = public.new_referral_code() where referral_code is null;
alter table public.companies alter column referral_code set default public.new_referral_code();
alter table public.companies alter column referral_code set not null;

-- One row per company that signed up with someone's code. Only the server writes or reads it.
create table public.referrals (
  company_id uuid primary key references public.companies (id) on delete cascade,
  referrer_id uuid not null references public.companies (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- set when the referrer's free month was credited, after the new company's first payment
  rewarded_at timestamptz,
  check (company_id <> referrer_id)
);
create index referrals_referrer_id_idx on public.referrals (referrer_id);
alter table public.referrals enable row level security;
revoke all on public.referrals from anon, authenticated;
grant select, insert, update, delete on public.referrals to service_role;
revoke all on function public.new_referral_code() from public, anon, authenticated;
