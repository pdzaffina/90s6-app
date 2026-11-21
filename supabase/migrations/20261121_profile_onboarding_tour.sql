-- Tracks completion of the optional first-login introduction per account.
alter table public.profiles add column if not exists tour_completed_at timestamptz;
