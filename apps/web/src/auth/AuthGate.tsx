import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AuthDialog } from "./AuthDialog";
import type { AccountIdentity as User } from "./identity";
import { anonymousDevelopment, identityConfigured, initializeIdentity, signIn, signOut } from "./identity";

const Account = createContext<User | null>(null);
export function useAccount() { return useContext(Account); }
export function AccountControls() {
  const user = useContext(Account);
  const [logoutError, setLogoutError] = useState("");
  if (!user) return null;
  return <div className="account-controls"><span>Signed in as {String(user.profile.email)}</span>
    <button type="button" className="text-button" onClick={() => void signOut().catch(() => setLogoutError("Sign-out could not complete. Please try again."))}>Sign out</button>{logoutError && <span role="alert">{logoutError}</span>}</div>;
}
export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!anonymousDevelopment);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;

    // Restore the tab session before mounting the lesson. Authentication stays
    // on this page, so invitation parameters are never lost in a redirect.
    void initializeIdentity().then((result) => { if (active) setUser(result); })
      .catch(() => { if (active) setError("Sign-in could not be completed. Please try again."); })
      .finally(() => { if (active) setLoading(false); });
    const expired = () => { setUser(null); setError("Your session needs to be verified again. Sign in to continue."); };

    const changed = () => { void initializeIdentity().then((next) => { if (active) setUser(next); }).catch(expired); };
    const open = () => setDialogOpen(true);
    window.addEventListener("lesson-auth-changed", changed);
    window.addEventListener("lesson-auth-open", open);
    window.addEventListener("lesson-auth-expired", expired);
    return () => {
      active = false;
      window.removeEventListener("lesson-auth-changed", changed);
      window.removeEventListener("lesson-auth-open", open);
      window.removeEventListener("lesson-auth-expired", expired);
    };
  }, []);
  const wrap = (content: ReactNode) => <>{content}{dialogOpen && <AuthDialog onClose={() => setDialogOpen(false)} />}</>;
  if (anonymousDevelopment) return wrap(<>{children}</>);
  const params = new URLSearchParams(location.search);
  const studentInvitation = Boolean(params.get("room")) && (!params.get("role") || params.get("role") === "student");
  if (!loading && studentInvitation && params.get("guest") === "1") return wrap(<>{children}</>);
  if (user && !user.expired && user.profile.email_verified === true) return wrap(<Account.Provider value={user}>{children}</Account.Provider>);
  // A student invitation is an intentional bearer capability. The server still
  // checks expiry, lock and room capacity; this UI exception grants no teacher rights.
  if (!loading && studentInvitation) return wrap(<>{children}</>);
  return wrap(<main className="page-shell"><section className="hero lesson-page">
    <div className="eyebrow">LIVE LESSON LAB</div>
    <h1>Your next<br /><em>lesson starts here.</em></h1>
    <p className="intro">Sign in or register to create a lesson. Students can join directly with an invitation link.</p>
    <p>Recording requires both participants to sign in and consent. Saved recordings are private to those two accounts.</p>
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Checking your account…</p> : identityConfigured ? <button className="primary-button" type="button" onClick={() => {
      void signIn()?.catch(() => setError("Sign-in could not be started. Try again."));
    }}>Sign in or register</button> : <p role="alert">Account sign-in is not configured for this deployment.</p>}
    <p className="lesson-note">Registration and email verification are handled by Amazon Cognito. Sign in here without leaving your lesson page.</p>
  </section></main>);
}
