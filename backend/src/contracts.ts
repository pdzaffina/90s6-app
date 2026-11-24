// Provider-independent contracts. Identity must be verified server-side.
export interface Actor { readonly id: string }
export interface Profile {
  id: string; email: string | null; full_name: string | null;
  is_admin: boolean; is_superuser: boolean; is_content_creator: boolean;
  disabled: boolean; tour_completed_at: string | null;
  intro_presentation_completed_at: string | null;
}
export interface ProfileRepository {
  getOwn(actor: Actor): Promise<Profile | null>;
}
export interface Persistence {
  readonly profiles: ProfileRepository;
}
export interface IdentityProvider {
  verify(accessToken: string): Promise<Actor | null>;
}
