import type { Actor, IdentityProvider, Persistence, Profile } from "../contracts.ts";
// Request-scoped adapter. Never use a service-role key here; preserve existing RLS.
export function supabaseRequest(url: string, publicKey: string, token: string, request: typeof fetch = fetch): { identity: IdentityProvider; persistence: Persistence } {
  const base = new URL(url);
  if (base.protocol !== "https:") throw new Error("HTTPS required");
  const headers = { apikey: publicKey, Authorization: "Bearer " + token };
  let verifiedId: string | null = null;
  return {
    identity: { async verify(candidate) {
      verifiedId = null;
      if (!token || candidate !== token) return null;
      const response = await request(new URL("/auth/v1/user", base), { headers });
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new Error("Identity provider unavailable");
      const user = await response.json();
      if (typeof user.id !== "string" || !user.id) return null;
      verifiedId = user.id;
      return { id: user.id };
    }},
    persistence: { profiles: { async getOwn(actor: Actor): Promise<Profile | null> {
      if (!verifiedId || actor.id !== verifiedId) throw new Error("Unverified actor");
      const endpoint = new URL("/rest/v1/profiles", base);
      endpoint.searchParams.set("id", "eq." + verifiedId);
      endpoint.searchParams.set("select", "id,email,full_name,is_admin,is_superuser,is_content_creator,disabled,tour_completed_at,intro_presentation_completed_at");
      const response = await request(endpoint, { headers });
      if (!response.ok) throw new Error("Profile repository unavailable");
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > 1) throw new Error("Invalid profile response");
      return rows[0] ?? null;
    }}}
  };
}
