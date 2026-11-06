import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

const authority = import.meta.env.VITE_AUTH_AUTHORITY?.trim();
const clientId = import.meta.env.VITE_AUTH_CLIENT_ID?.trim();
const domain = import.meta.env.VITE_AUTH_DOMAIN?.trim();
export const identityConfigured = Boolean(authority && clientId && domain);
export const anonymousDevelopment = import.meta.env.DEV && !authority && !clientId && !domain;
// Public client: no client secret. The library implements state/nonce and PKCE.
// Session storage is tab-scoped; tokens are never put in invitation URLs.
export const identityManager = identityConfigured ? new UserManager({
  authority, client_id: clientId, redirect_uri: `${location.origin}/`,
  response_type: "code", scope: "openid email", automaticSilentRenew: false,
  loadUserInfo: false, revokeTokenTypes: ["refresh_token"],
  userStore: new WebStorageStateStore({ store: sessionStorage }),
  stateStore: new WebStorageStateStore({ store: sessionStorage })
}) : null;

let initialization: Promise<User | null> | undefined;
export function initializeIdentity() {
  // StrictMode must not redeem the same one-use authorization code twice.
  return initialization ??= (async () => {
    if (!identityManager) return null;
    const query = new URLSearchParams(location.search);
    if (query.has("state") && (query.has("code") || query.has("error"))) {
      let user: User;
      try { user = await identityManager.signinRedirectCallback(); }
      catch (error) {
        // Never preserve a failed authorization code as the next return URL.
        history.replaceState(null, "", "/");
        throw error;
      }
      const path = (user.state as { returnTo?: string } | undefined)?.returnTo ?? "/";
      const destination = new URL(path, location.origin);
      history.replaceState(null, "", destination.origin === location.origin ? destination.pathname + destination.search : "/");
      return user;
    }
    const user = await identityManager.getUser();
    return user && !user.expired ? user : null;
  })();
}
export function signIn() {
  return identityManager?.signinRedirect({ state: { returnTo: location.pathname + location.search } });
}
export async function signOut() {
  if (!identityManager || !domain || !clientId) return;
  // Revocation is best effort: local logout must still work if the network fails.
  try { await identityManager.revokeTokens(["refresh_token"]); } catch { /* Continue logout. */ }
  await identityManager.removeUser();
  const url = new URL("/logout", domain);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("logout_uri", `${location.origin}/`);
  location.assign(url);
}
let refresh: Promise<User | null> | null = null;
export async function getIdentityToken(): Promise<string | null> {
  if (!identityManager) {
    if (anonymousDevelopment) return null;
    throw new Error("Identity configuration is required");
  }
  let user = await identityManager.getUser();
  if (user && (user.expires_in ?? 0) < 60 && user.refresh_token) {
    refresh ??= identityManager.signinSilent().finally(() => { refresh = null; });
    user = await refresh;
  }
  if (!user?.id_token || user.expired || user.profile.email_verified !== true) throw new Error("Verified sign-in required");
  return user.id_token;
}
