-- Tracks completion of the optional first-login introduction per account.
alter table public.profiles add column if not exists tour_completed_at timestamptz;

-- Allow each signed-in user to save their own tour state (RLS restricts rows).
grant update (tour_completed_at) on table public.profiles to authenticated;
