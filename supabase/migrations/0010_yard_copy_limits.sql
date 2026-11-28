-- Security check 2026-11-27: unpaid yard copies are written before anyone pays, so a script could
-- fill the database by changing the email each time. The billing function now keeps a hash of the
-- asker's network address (never the address itself) and caps unpaid copies per address and overall.
alter table public.yard_copies add column if not exists ip_hash text;
create index if not exists yard_copies_ip_hash_created_at_idx
  on public.yard_copies (ip_hash, created_at) where paid = false;
create index if not exists yard_copies_created_at_idx
  on public.yard_copies (created_at) where paid = false;
