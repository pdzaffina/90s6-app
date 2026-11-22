// Admin user management. The ONLY place the service role key is used.
// Deploy: supabase functions deploy admin-users
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ORIGIN = Deno.env.get('APP_ORIGIN') ?? 'https://app.90s6.com';

const cors = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

  // Who is calling, and are they an active admin?
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ error: 'Not signed in' }, 401);
  const { data: me } = await db.from('profiles').select('is_admin, disabled').eq('id', user.id).maybeSingle();
  if (!me?.is_admin || me.disabled) return json({ error: 'Admins only' }, 403);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  const id = String(b.id ?? '');
  const fail = (e: { message: string }) => json({ error: e.message }, 400);
  const log = (action: string, target: string, detail: Record<string, unknown> = {}) =>
    db.from('audit_log').insert({ actor_id: user.id, actor_email: user.email, action, target, detail });
  const emailOf = async (uid: string) =>
    (await db.from('profiles').select('email').eq('id', uid).maybeSingle()).data?.email ?? uid;
  const needOther = () => (id && id !== user.id) ? null : json({ error: "You can't change your own account here." }, 400);

  switch (b.action) {
    case 'list': {
      const [p, boards, members] = await Promise.all([
        db.from('profiles').select('id,email,full_name,is_admin,is_superuser,disabled,created_at,last_seen_at').order('email'),
        db.from('boards').select('owner_id'),
        db.from('board_members').select('user_id'),
      ]);
      if (p.error) return fail(p.error);
      const tally = (rows: Record<string, string>[] | null, key: string) => {
        const m = new Map<string, number>();
        (rows ?? []).forEach((r) => m.set(r[key], (m.get(r[key]) ?? 0) + 1));
        return m;
      };
      const owned = tally(boards.data, 'owner_id'), shared = tally(members.data, 'user_id');
      return json({ users: (p.data ?? []).map((u) => ({ ...u, owned: owned.get(u.id) ?? 0, shared: shared.get(u.id) ?? 0 })) });
    }
    case 'invite': {
      const email = String(b.email ?? '').trim().toLowerCase();
      if (!EMAIL.test(email)) return json({ error: 'Enter a valid email.' }, 400);
      const { error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: ORIGIN + '/' });
      if (error) return fail(error);
      await log('admin.invite_user', email);
      return json({ ok: true });
    }
    case 'bulk_create': {
      if (!Array.isArray(b.users) || b.users.length < 1 || b.users.length > 100)
        return json({ error: 'Submit 1 to 100 users.' }, 400);
      const seen = new Set<string>();
      const entries = [];
      const { data: orgs, error: orgError } = await db.from('tenants').select('id,slug,status');
      if (orgError) return fail(orgError);
      const tenantBySlug = new Map((orgs ?? []).filter(t => t.status === 'active').map(t => [t.slug, t.id]));
      for (const item of b.users) {
        if (!item || typeof item !== 'object') return json({ error: 'Invalid user entry.' }, 400);
        const v = item as Record<string, unknown>;
        const email = String(v.email ?? '').trim().toLowerCase();
        const full_name = String(v.full_name ?? '').trim();
        const password = String(v.password ?? '');
        const role = String(v.role ?? '').trim().toLowerCase();
        const active = String(v.active ?? '').trim().toUpperCase();
        const organization = String(v.organization ?? '').trim().toLowerCase();
        if (organization !== 'global' && !tenantBySlug.has(organization)) return json({ error: 'Unknown or inactive organization: ' + organization }, 400);
        if (organization === 'global' && role !== 'admin') return json({ error: 'Global rows must use the admin role.' }, 400);
        if (organization !== 'global' && role === 'admin') return json({ error: 'Global admin role cannot be granted within an organization.' }, 400);
        if (!EMAIL.test(email) || email.length > 254 || !full_name || full_name.length > 200 ||
            password.length > 128 || (password.length > 0 && password.length < 12) || !['Y', 'N'].includes(active) || !['user', 'superuser', 'tenant_admin', 'admin'].includes(role) || seen.has(email + ':' + organization))
          return json({ error: 'Invalid or duplicate CSV entry. Each user needs a unique email, name, role, and active Y/N. Supplied passwords must be 12 to 128 characters.' }, 400);
        seen.add(email + ':' + organization); entries.push({ email, full_name, password, role, active, organization });
      }
      const { data: existing, error: existingError } = await db.from('profiles').select('id,email,disabled').in('email', entries.map(v => v.email));
      if (existingError) return fail(existingError);
      const known = new Map((existing ?? []).map(v => [String(v.email).toLowerCase(), v]));
      const results = [];
      for (const entry of entries) {
        const { email, full_name, password, role, active, organization } = entry;
        const tenantId = tenantBySlug.get(organization);
        const applyMembership = async (uid: string) => {
          if (!tenantId) return null;
          const { error } = await db.from('tenant_members').upsert({ tenant_id: tenantId, user_id: uid, role, status: active === 'Y' ? 'active' : 'inactive' }, { onConflict: 'tenant_id,user_id' });
          return error;
        };
        const found = known.get(email);
        if (found) {
          if (tenantId) {
            const memberError = await applyMembership(found.id);
            if (memberError) { results.push({ email, organization, status: 'failed', error: memberError.message }); continue; }
            await log('admin.bulk_tenant_membership', email, { organization, role, active });
            results.push({ email, organization, status: 'updated' }); continue;
          }
          if (found.id === user.id) { results.push({ email, status: 'skipped', error: 'Cannot change your own account.' }); continue; }
          const disabled = active === 'N';
          if (found.disabled === disabled) { results.push({ email, status: 'skipped' }); continue; }
          const { error: banError } = await db.auth.admin.updateUserById(found.id, { ban_duration: disabled ? '876000h' : 'none' });
          if (banError) { results.push({ email, status: 'failed', error: banError.message }); continue; }
          const { error: statusError } = await db.from('profiles').update({ disabled }).eq('id', found.id);
          if (statusError) {
            await db.auth.admin.updateUserById(found.id, { ban_duration: found.disabled ? '876000h' : 'none' });
            results.push({ email, status: 'failed', error: statusError.message }); continue;
          }
          await log('admin.set_disabled', email, { disabled, source: 'bulk_csv' });
          results.push({ email, status: 'updated' });
          continue;
        }
        if (password.length < 12) { results.push({ email, status: 'failed', error: 'New accounts require a password of at least 12 characters.' }); continue; }
        const { data, error } = await db.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name }
        });
        if (error) {
          results.push({ email, status: /already (registered|exists)|duplicate/i.test(error.message) ? 'skipped' : 'failed', error: error.message });
          continue;
        }
        const uid = data.user?.id;
        if (!uid) { results.push({ email, status: 'failed', error: 'No user ID returned.' }); continue; }
        const { error: profileError } = await db.from('profiles').upsert({
          id: uid, email, full_name, is_admin: role === 'admin', is_superuser: false, disabled: organization === 'global' && active === 'N'
        }, { onConflict: 'id' });
        if (profileError) {
          results.push({ email, status: 'failed', error: 'Profile provisioning failed; account may need admin review.' });
          continue;
        }
        const membershipError = await applyMembership(uid);
        if (membershipError) { results.push({ email, organization, status: 'failed', error: 'Account created but organization membership failed: ' + membershipError.message }); continue; }
        if (organization === 'global' && active === 'N') {
          const { error: banError } = await db.auth.admin.updateUserById(uid, { ban_duration: '876000h' });
          if (banError) { results.push({ email, status: 'failed', error: 'Account is inactive, but authentication ban failed.' }); continue; }
        }
        await log('admin.bulk_create_user', email, { role, active, organization });
        known.set(email, { id: uid, email, disabled: active === 'N' });
        results.push({ email, status: 'created' });
      }
      return json({ results });
    }
    case 'reset_onboarding': {
      if (!id) return json({ error: 'User ID required.' }, 400);
      const kind = String(b.kind ?? '');
      if (kind !== 'tour' && kind !== 'intro') return json({ error: 'Invalid onboarding type.' }, 400);
      const column = kind === 'tour' ? 'tour_completed_at' : 'intro_presentation_completed_at';
      const { data: target, error: lookupError } = await db.from('profiles').select('id,email').eq('id', id).maybeSingle();
      if (lookupError) return fail(lookupError);
      if (!target) return json({ error: 'User not found.' }, 404);
      const { error } = await db.from('profiles').update({ [column]: null }).eq('id', id);
      if (error) return fail(error);
      await log('admin.reset_onboarding', target.email ?? id, { kind });
      return json({ ok: true });
    }
    case 'set_admin': {
      const bad = needOther(); if (bad) return bad;
      const { error } = await db.from('profiles').update({ is_admin: b.is_admin === true }).eq('id', id);
      if (error) return fail(error);
      await log('admin.set_admin', await emailOf(id), { is_admin: b.is_admin === true });
      return json({ ok: true });
    }
    case 'set_superuser': {
      const bad = needOther(); if (bad) return bad;
      const is_superuser = b.is_superuser === true;
      const { error } = await db.from('profiles').update({ is_superuser }).eq('id', id);
      if (error) return fail(error);
      await log('admin.set_superuser', await emailOf(id), { is_superuser });
      return json({ ok: true });
    }
    case 'set_disabled': {
      const bad = needOther(); if (bad) return bad;
      const disabled = b.disabled === true;
      const r1 = await db.from('profiles').update({ disabled }).eq('id', id);
      if (r1.error) return fail(r1.error);
      // The ban stops new sign ins and token refreshes; the disabled flag cuts data access immediately via RLS.
      const r2 = await db.auth.admin.updateUserById(id, { ban_duration: disabled ? '876000h' : 'none' });
      if (r2.error) return fail(r2.error);
      await log('admin.set_disabled', await emailOf(id), { disabled });
      return json({ ok: true });
    }
    case 'delete_user': {
      const bad = needOther(); if (bad) return bad;
      const { count } = await db.from('boards').select('id', { count: 'exact', head: true }).eq('owner_id', id);
      if (count) return json({ error: `This user owns ${count} board(s). Disable the account instead.` }, 409);
      const who = await emailOf(id);
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) return fail(error);
      await log('admin.delete_user', who);
      return json({ ok: true });
    }
    case 'audit': {
      // Task titles and file names are board content, so admins get who/what/when only.
      const limit = Math.min(Number(b.limit) || 100, 200);
      let q = db.from('audit_log').select('id,at,actor_email,action,board_id,target,detail')
        .order('id', { ascending: false }).limit(limit + 1);
      if (b.before) q = q.lt('id', Number(b.before));
      if (typeof b.prefix === 'string' && b.prefix) q = q.like('action', b.prefix.replace(/[%_]/g, '') + '%');
      if (typeof b.actor === 'string' && b.actor) q = q.ilike('actor_email', '%' + b.actor.replace(/[%_]/g, '') + '%');
      const { data, error } = await q;
      if (error) return fail(error);
      const rows = (data ?? []).slice(0, limit).map((r) =>
        r.action.startsWith('task.') || r.action.startsWith('file.') ? { ...r, detail: {}, target: '' } : r);
      return json({ rows, more: (data ?? []).length > limit });
    }
    default:
      return json({ error: 'Unknown action' }, 400);
  }
});
