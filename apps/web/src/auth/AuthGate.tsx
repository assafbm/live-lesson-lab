import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "oidc-client-ts";
import { anonymousDevelopment, identityConfigured, identityManager, initializeIdentity, signIn, signOut } from "./identity";

const Account = createContext<User | null>(null);
export function useAccount() { return useContext(Account); }
export function AccountControls() {
  const user = useContext(Account);
  if (!user) return null;
  return <div className="account-controls"><span>Signed in as {String(user.profile.email)}</span>
    <button type="button" className="text-button" onClick={() => void signOut()}>Sign out</button></div>;
}
export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!anonymousDevelopment);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let initialized = false;
    // The callback must restore the invitation URL before mounting App, whose
    // role is derived from that URL. Ignore early library callback notifications.
    void initializeIdentity().then((result) => { initialized = true; if (active) setUser(result); })
      .catch(() => { if (active) setError("Sign-in could not be completed. Please try again."); })
      .finally(() => { if (active) setLoading(false); });
    const expired = () => { setUser(null); setError("Your session needs to be verified again. Sign in to continue."); };
    const renewed = (next: User) => { if (active && initialized) setUser(next); };
    identityManager?.events.addUserLoaded(renewed);
    window.addEventListener("lesson-auth-expired", expired);
    return () => {
      active = false;
      identityManager?.events.removeUserLoaded(renewed);
      window.removeEventListener("lesson-auth-expired", expired);
    };
  }, []);
  if (anonymousDevelopment) return <>{children}</>;
  const params = new URLSearchParams(location.search);
  const studentInvitation = Boolean(params.get("room")) && (!params.get("role") || params.get("role") === "student");
  if (!loading && studentInvitation && params.get("guest") === "1") return <>{children}</>;
  if (user && !user.expired && user.profile.email_verified === true) return <Account.Provider value={user}>{children}</Account.Provider>;
  // A student invitation is an intentional bearer capability. The server still
  // checks expiry, lock and room capacity; this UI exception grants no teacher rights.
  if (!loading && studentInvitation) return <>{children}</>;
  return <main className="page-shell"><section className="hero lesson-page">
    <div className="eyebrow">LIVE LESSON LAB</div>
    <h1>Your next<br /><em>lesson starts here.</em></h1>
    <p className="intro">Sign in or register to create a lesson. Students can join directly with an invitation link.</p>
    <p>Recording requires both participants to sign in and consent. Saved recordings are private to those two accounts.</p>
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Checking your account…</p> : identityConfigured ? <button className="primary-button" type="button" onClick={() => {
      void signIn()?.catch(() => setError("Sign-in could not be started. Try again."));
    }}>Sign in or register</button> : <p role="alert">Account sign-in is not configured for this deployment.</p>}
    <p className="lesson-note">Registration and email verification are handled by Amazon Cognito. Your password is never sent to the lesson app.</p>
  </section></main>;
}
