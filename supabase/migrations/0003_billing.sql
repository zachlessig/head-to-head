-- Contractor plans paid through Stripe (Zach picked Stripe 2026-11-16). One row per company.
-- Only the server writes here: the stripe-webhook function, with the service key, after Stripe
-- says a subscription changed. Anyone in the company can read it, so the app can show the plan.
create table public.billing (
  company_id uuid primary key references public.companies (id) on delete cascade,
  stripe_customer_id text,
  subscription_id text,
  -- Stripe's own subscription status: active, trialing, past_due, canceled, unpaid, incomplete...
  status text,
  -- which price they're on: founding ($20 a month, locked in) or standard ($35 a month)
  plan text check (plan in ('founding', 'standard')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.billing enable row level security;
create policy billing_member_read on public.billing for select using (public.is_member(company_id));

-- no one but the server writes billing; signed-out visitors can't see it at all
revoke all on public.billing from anon, authenticated;
grant select on public.billing to authenticated;
