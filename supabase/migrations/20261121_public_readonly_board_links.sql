create table if not exists public.board_public_links (
 board_id uuid primary key references public.boards(id) on delete cascade,
 token uuid not null unique default gen_random_uuid(),
 created_at timestamptz not null default now()
);
alter table public.board_public_links enable row level security;
revoke all on public.board_public_links from anon, authenticated;
grant select,insert,update,delete on public.board_public_links to authenticated;
create policy "owners_manage_public_links" on public.board_public_links for all to authenticated
 using (public.can_manage_board(board_id)) with check (public.can_manage_board(board_id));
create or replace function public.get_public_board(p_token uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
 select jsonb_build_object('name',b.name,'data',
 coalesce((select jsonb_agg(item - 'attachments' order by ord)
 from jsonb_array_elements(case when jsonb_typeof(b.data)='array' then b.data else '[]'::jsonb end) with ordinality as x(item,ord)), '[]'::jsonb),
 'config',b.config,'updated_at',b.updated_at)
 from public.board_public_links l join public.boards b on b.id=l.board_id
 where l.token=p_token
$$;
revoke all on function public.get_public_board(uuid) from public;
grant execute on function public.get_public_board(uuid) to anon,authenticated;
