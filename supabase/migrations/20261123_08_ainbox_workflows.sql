-- User workflows remain server-guarded; all browser table grants stay revoked.
begin;
create or replace function public.ainbox_get_exception_detail(p_tenant uuid,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.ainbox_exceptions; result jsonb;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Access denied' using errcode='42501'; end if;
 select * into e from public.ainbox_exceptions where tenant_id=p_tenant and id=p_id;
 if not found then raise exception 'Not found'; end if;
 if e.assignee_id is distinct from auth.uid() and not public.ainbox_authorized(p_tenant,true) then raise exception 'Access denied' using errcode='42501'; end if;
 if not public.ainbox_source_visible(p_tenant,e.source_type,e.source_parent_id,e.source_id) then raise exception 'Source access denied' using errcode='42501'; end if;
 select jsonb_build_object('id',e.id,'status',e.status,'revision',e.revision,
 'remediation',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,'revision',p.revision,'steps',
 coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'description',s.description,'sequence',s.sequence,'completed_at',s.completed_at) order by s.sequence) from public.ainbox_remediation_steps s where s.tenant_id=p_tenant and s.plan_id=p.id),'[]'::jsonb))) from public.ainbox_remediation_plans p where p.tenant_id=p_tenant and p.exception_id=e.id),'[]'::jsonb),
 'communication',coalesce((select jsonb_build_object('id',c.id,'recipient',c.recipient,'subject',c.subject,'body',c.body,'status',c.status,'version',c.current_version,'delivery_record',c.delivery_record) from public.ainbox_communications c where c.tenant_id=p_tenant and c.exception_id=e.id order by c.updated_at desc limit 1),'null'::jsonb),
 'activity',coalesce((select jsonb_agg(jsonb_build_object('event_type',a.event_type,'occurred_at',a.occurred_at,'actor_id',a.actor_id) order by a.occurred_at desc) from public.ainbox_activity_events a where a.tenant_id=p_tenant and a.exception_id=e.id),'[]'::jsonb))
 into result;
 return result;
end $$;
revoke all on function public.ainbox_get_exception_detail(uuid,uuid) from public,anon;
grant execute on function public.ainbox_get_exception_detail(uuid,uuid) to authenticated;
create or replace function public.ainbox_save_communication(p_tenant uuid,p_exception uuid,p_recipient text,p_subject text,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ainbox_exceptions; c public.ainbox_communications;
begin
 if not public.ainbox_authorized(p_tenant,false) then raise exception 'Access denied' using errcode='42501'; end if;
 select * into e from public.ainbox_exceptions where tenant_id=p_tenant and id=p_exception;
 if not found or (e.assignee_id is distinct from auth.uid() and not public.ainbox_authorized(p_tenant,true)) then raise exception 'Access denied' using errcode='42501'; end if;
 if not public.ainbox_source_visible(p_tenant,e.source_type,e.source_parent_id,e.source_id) then raise exception 'Source access denied' using errcode='42501'; end if;
 if length(coalesce(p_recipient,''))>500 or length(coalesce(p_subject,''))>300 or length(coalesce(p_body,''))>20000 then raise exception 'Communication too long'; end if;
 select * into c from public.ainbox_communications where tenant_id=p_tenant and exception_id=p_exception for update;
 if not found then
  insert into public.ainbox_communications(tenant_id,exception_id,recipient,subject,body)
  values(p_tenant,p_exception,p_recipient,p_subject,p_body) returning * into c;
 else
  update public.ainbox_communications set recipient=p_recipient,subject=p_subject,body=p_body,status='draft',current_version=current_version+1,updated_at=now()
  where id=c.id returning * into c;
 end if;
 insert into public.ainbox_activity_events(tenant_id,exception_id,actor_id,event_type,after_state)
 values(p_tenant,p_exception,auth.uid(),'communication_saved',jsonb_build_object('version',c.current_version));
 return jsonb_build_object('id',c.id,'version',c.current_version,'status',c.status);
end $$;
revoke all on function public.ainbox_save_communication(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.ainbox_save_communication(uuid,uuid,text,text,text) to authenticated;
create or replace function public.ainbox_approve_communication(p_tenant uuid,p_communication uuid,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.ainbox_communications;e public.ainbox_exceptions;
begin
 select * into c from public.ainbox_communications where tenant_id=p_tenant and id=p_communication for update;
 if not found then raise exception 'Not found';end if;
 select * into e from public.ainbox_exceptions where tenant_id=p_tenant and id=c.exception_id;
 if not public.ainbox_authorized(p_tenant,true) or not public.ainbox_source_visible(p_tenant,e.source_type,e.source_parent_id,e.source_id) then raise exception 'Access denied' using errcode='42501';end if;
 if c.current_version<>p_version or c.status<>'draft' then raise exception 'Stale or invalid draft';end if;
 insert into public.ainbox_communication_versions(tenant_id,communication_id,version_number,recipient,subject,body,approved_by)
 values(p_tenant,c.id,c.current_version,c.recipient,c.subject,c.body,auth.uid());
 update public.ainbox_communications set status='approved',updated_at=now() where id=c.id;
 insert into public.ainbox_activity_events(tenant_id,exception_id,actor_id,event_type,after_state)
 values(p_tenant,c.exception_id,auth.uid(),'communication_approved',jsonb_build_object('version',c.current_version));
 return jsonb_build_object('id',c.id,'version',c.current_version,'status','approved');
end $$;
revoke all on function public.ainbox_approve_communication(uuid,uuid,integer) from public,anon;
grant execute on function public.ainbox_approve_communication(uuid,uuid,integer) to authenticated;
create or replace function public.ainbox_record_communication(p_tenant uuid,p_communication uuid,p_version integer,p_channel text,p_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.ainbox_communications;e public.ainbox_exceptions;
begin
 select * into c from public.ainbox_communications where tenant_id=p_tenant and id=p_communication for update;
 if not found then raise exception 'Not found';end if;
 select * into e from public.ainbox_exceptions where tenant_id=p_tenant and id=c.exception_id;
 if not public.ainbox_authorized(p_tenant,false) or (e.assignee_id is distinct from auth.uid() and not public.ainbox_authorized(p_tenant,true)) or not public.ainbox_source_visible(p_tenant,e.source_type,e.source_parent_id,e.source_id) then raise exception 'Access denied' using errcode='42501';end if;
 if c.current_version<>p_version or c.status<>'approved' then raise exception 'Communication must be approved at current version';end if;
 if p_channel not in ('email','chat','phone','meeting','other') or length(coalesce(p_reference,''))>1000 then raise exception 'Invalid delivery record';end if;
 update public.ainbox_communications set status='sent',delivery_record=jsonb_build_object('channel',p_channel,'reference',p_reference,'recorded_by',auth.uid(),'recorded_at',now()),updated_at=now() where id=c.id;
 insert into public.ainbox_activity_events(tenant_id,exception_id,actor_id,event_type,after_state)
 values(p_tenant,c.exception_id,auth.uid(),'communication_delivery_recorded',jsonb_build_object('channel',p_channel));
 return jsonb_build_object('id',c.id,'status','sent');
end $$;
revoke all on function public.ainbox_record_communication(uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.ainbox_record_communication(uuid,uuid,integer,text,text) to authenticated;
commit;