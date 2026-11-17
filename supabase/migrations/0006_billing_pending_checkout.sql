-- The newest plan checkout a company opened. Opening another one expires this one first, so two
-- tabs or a double tap can't end in two live subscriptions (review 2026-11-17).
alter table public.billing add column pending_checkout text;
