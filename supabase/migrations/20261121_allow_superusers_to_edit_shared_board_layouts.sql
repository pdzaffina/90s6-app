create or replace function public.guard_board_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    if new.owner_id is distinct from old.owner_id or new.id is distinct from old.id then
      raise exception 'Board ownership cannot be changed' using errcode = '42501';
    end if;
    if new.name is distinct from old.name and not public.can_manage_board(old.id) then
      raise exception 'Only an admin or superuser who owns this board can rename it' using errcode = '42501';
    end if;
    if new.config is distinct from old.config
      and not (public.is_board_manager() and public.can_edit(old.id)) then
      raise exception 'Only an admin or superuser with edit access can change the board layout' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
