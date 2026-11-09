import { Amplify } from "aws-amplify";
import { fetchAuthSession, signOut as endSession } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { sessionStorage as tabStorage } from "aws-amplify/utils";

const authority = import.meta.env.VITE_AUTH_AUTHORITY?.trim();
const clientId = import.meta.env.VITE_AUTH_CLIENT_ID?.trim();
export const identityConfigured = Boolean(authority && clientId);
export const anonymousDevelopment = import.meta.env.DEV && !authority && !clientId;
export interface AccountIdentity {
  profile: { sub: string; email?: string; name?: string; email_verified?: boolean };
  id_token: string;
  expired: boolean;
}
if (identityConfigured) {
  // Use the existing pool, not a new Amplify backend. SRP and token refresh are
  // implemented by AWS's SDK; no password or token goes into a lesson URL.
  Amplify.configure({ Auth: { Cognito: {
    userPoolId: new URL(authority!).pathname.slice(1), userPoolClientId: clientId!
  } } });
  cognitoUserPoolsTokenProvider.setKeyValueStorage(tabStorage);
}
export async function initializeIdentity(): Promise<AccountIdentity | null> {
  if (!identityConfigured) return null;
  const { tokens } = await fetchAuthSession();
  const token = tokens?.idToken;
  if (!token) return null;
  return { profile: token.payload as unknown as AccountIdentity["profile"],
    id_token: token.toString(), expired: Number(token.payload.exp) <= Date.now() / 1000 };
}
export async function signIn() { window.dispatchEvent(new Event("lesson-auth-open")); }
export async function signOut() {
  await endSession();
  window.dispatchEvent(new Event("lesson-auth-changed"));
}
export async function getIdentityToken(allowGuest = false): Promise<string | null> {
  if (allowGuest && new URLSearchParams(location.search).get("guest") === "1") return null;
  if (!identityConfigured && (anonymousDevelopment || allowGuest)) return null;
  // fetchAuthSession renews expired tokens using the tab's refresh token. The
  // server still independently verifies signature, issuer, client and email.
  const user = await initializeIdentity();
  if (!user && allowGuest) return null;
  if (!user || user.expired || user.profile.email_verified !== true) throw new Error("Verified sign-in required");
  return user.id_token;
}
