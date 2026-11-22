-- Action Inbox source compatibility, additive only.
-- Unknown historical draft ages remain NULL until an authoritative transition.
begin;
alter table public.knowledge_articles add column if not exists draft_entered_at timestamptz;
create or replace function public.ainbox_track_draft_entry() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
   if new.status='draft' then new.draft_entered_at:=coalesce(new.draft_entered_at,now()); end if;
 elsif new.status is distinct from old.status then
   if new.status='draft' then new.draft_entered_at:=now();
   else new.draft_entered_at:=null; end if;
 else
   -- Edits while Draft must never reset the authoritative entry timestamp.
   new.draft_entered_at:=old.draft_entered_at;
 end if;
 return new;
end $$;
revoke all on function public.ainbox_track_draft_entry() from public,anon,authenticated;
create trigger ainbox_kb_draft_entry before insert or update on public.knowledge_articles
 for each row execute function public.ainbox_track_draft_entry();

alter table public.pm_initiatives add column if not exists assessment_completed_at timestamptz;
alter table public.pm_initiatives add column if not exists assessment_completed_by uuid references public.profiles(id);
create or replace function public.ainbox_audit_assessment() returns trigger language plpgsql set search_path='' as $$
begin
 if new.assessment_completed_at is distinct from old.assessment_completed_at then
   insert into public.audit_log(actor_id,action,target,detail) values(auth.uid(),'portfolio_assessment_status',new.id::text,jsonb_build_object('portfolio_id',new.portfolio_id,'completed',new.assessment_completed_at is not null));
 end if;
 return new;
end $$;
revoke all on function public.ainbox_audit_assessment() from public,anon,authenticated;
create trigger ainbox_portfolio_assessment_audit after update on public.pm_initiatives
 for each row execute function public.ainbox_audit_assessment();
commit;
