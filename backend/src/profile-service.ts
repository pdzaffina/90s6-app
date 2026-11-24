import type { IdentityProvider, Persistence, Profile } from "./contracts.ts";
export class AccessDenied extends Error {}
export async function currentProfile(identity: IdentityProvider, persistence: Persistence, token: string): Promise<Profile> {
  if (!token) throw new AccessDenied("Authentication required");
  const actor = await identity.verify(token);
  if (!actor) throw new AccessDenied("Authentication required");
  const profile = await persistence.profiles.getOwn(actor);
  if (!profile || profile.disabled || profile.id !== actor.id) throw new AccessDenied("Account unavailable");
  return profile;
}
