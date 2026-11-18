-- Security review 2026-11-17: a referrer with no plan and no card on file can't be checked for
-- paying both sides with one card, so their free month waits (held) until their own plan's first
-- payment. Then the cards that paid the referred company are compared with the referrer's cards.
alter table public.referrals add column held boolean not null default false;
alter table public.referrals add column referred_cards text[] not null default '{}';
create index referrals_held_idx on public.referrals (referrer_id) where held;
