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
        db.from('profiles').select('id,email,full_name,is_admin,disabled,created_at,last_seen_at').order('email'),
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
    case 'set_admin': {
      const bad = needOther(); if (bad) return bad;
      const { error } = await db.from('profiles').update({ is_admin: b.is_admin === true }).eq('id', id);
      if (error) return fail(error);
      await log('admin.set_admin', await emailOf(id), { is_admin: b.is_admin === true });
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
