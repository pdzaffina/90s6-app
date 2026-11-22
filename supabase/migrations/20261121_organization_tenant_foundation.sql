-- Phase 1: additive organization foundation. Do not deploy alone as tenant isolation.
-- Existing resources remain unchanged until backfill and RLS cutover are verified.
create table if not exists public.tenants (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 150),
 slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 status text not null default 'active' check (status in ('active','suspended')),
 created_at timestamptz not null default now()
);
create table if not exists public.tenant_members (
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 role text not null check (role in ('tenant_admin','superuser','user')),
 status text not null default 'active' check (status in ('active','inactive')),
 created_at timestamptz not null default now(),
 primary key (tenant_id,user_id)
);
create index if not exists tenant_members_user_idx on public.tenant_members(user_id);
alter table public.boards add column if not exists tenant_id uuid references public.tenants(id);
alter table public.pm_portfolios add column if not exists tenant_id uuid references public.tenants(id);
create index if not exists boards_tenant_idx on public.boards(tenant_id);
create index if not exists pm_portfolios_tenant_idx on public.pm_portfolios(tenant_id);
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
-- No permissive policies yet. Subsequent migration adds scoped access
-- after existing users/resources are mapped and all application paths are updated.
