-- Extend existing administrative allowlists without changing their authorization logic.
do $$
declare fn regprocedure; definition text;
begin
 foreach fn in array array[
  'public.set_user_features(uuid[],text[],boolean)'::regprocedure,
  'public.manage_tenant_features(uuid,uuid[],text[],boolean)'::regprocedure,
  'public.global_manage_organization_features(uuid,text[],boolean)'::regprocedure
 ] loop
  definition:=pg_get_functiondef(fn);
  definition:=replace(definition,'''use_case_curator''))','''use_case_curator'',''action_inbox''))');
  definition:=replace(definition,'''studio_knowledge''))','''studio_knowledge'',''action_inbox''))');
  definition:=replace(definition,'between 1 and 10','between 1 and 11');
  definition:=replace(definition,'cardinality(p_features)>10','cardinality(p_features)>11');
  execute definition;
 end loop;
end $$;
