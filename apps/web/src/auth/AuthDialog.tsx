import { useEffect, useRef, useState, type FormEvent } from "react";
import { signIn, signUp, confirmSignUp, resendSignUpCode, resetPassword, confirmResetPassword } from "aws-amplify/auth";

type Step = "login" | "register" | "verify" | "forgot" | "reset";
const titles: Record<Step, string> = { login: "Welcome back", register: "Create your account", verify: "Check your email", forgot: "Reset your password", reset: "Choose a new password" };
export function AuthDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Native modal semantics trap focus, make the background inert and restore
  // focus to the opener. No browser window or external page is opened.
  useEffect(() => { dialog.current?.showModal(); }, []);
  const move = (next: Step) => { setStep(next); setPassword(""); setCode(""); setMessage(""); };
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const username = email.trim();
    try {
      if (step === "login") {
        const result = await signIn({ username, password });
        if (result.isSignedIn) { window.dispatchEvent(new Event("lesson-auth-changed")); onClose(); }
        else if (result.nextStep.signInStep === "CONFIRM_SIGN_UP") move("verify");
        else if (result.nextStep.signInStep === "RESET_PASSWORD") move("forgot");
        else setMessage("This account requires an additional sign-in step. Please contact support.");
      } else if (step === "register") {
        await signUp({ username, password, options: { userAttributes: { email: username } } });
        move("verify");
      } else if (step === "verify") {
        await confirmSignUp({ username, confirmationCode: code.trim() });
        move("login"); setMessage("Email verified. You can now sign in.");
      } else if (step === "forgot") {
        await resetPassword({ username }); move("reset");
      } else {
        await confirmResetPassword({ username, confirmationCode: code.trim(), newPassword: password });
        move("login"); setMessage("Password updated. Sign in with your new password.");
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "UserNotConfirmedException") move("verify");
      else setMessage(name === "NotAuthorizedException" || name === "UserNotFoundException" ? "The email or password is incorrect."
        : name === "CodeMismatchException" ? "That code is incorrect. Please try again."
        : name === "ExpiredCodeException" ? "That code has expired. Request a new code."
        : name === "UsernameExistsException" ? "Try signing in or resetting your password for this email."
        : name === "InvalidPasswordException" ? "Use a password with at least 8 characters."
        : name === "LimitExceededException" || name === "TooManyRequestsException" ? "Too many attempts. Please wait and try again."
        : "We could not complete this request. Check your connection and try again.");
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="auth-dialog" aria-labelledby="auth-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <button className="auth-close text-button" aria-label="Close sign-in" disabled={busy} onClick={onClose}>×</button>
    <div className="eyebrow">LIVE LESSON LAB</div><h2 id="auth-title">{titles[step]}</h2>
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy}>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} /></label>
        {(step === "verify" || step === "reset") && <label>Email verification code<input autoComplete="one-time-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required /></label>}
        {(step === "login" || step === "register" || step === "reset") && <label>Password<input type="password" autoComplete={step === "login" ? "current-password" : "new-password"} minLength={step === "login" ? undefined : 8} maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>}
        {(step === "register" || step === "reset") && <p className="lesson-note">At least 8 characters. No uppercase, number or symbol requirement.</p>}
        <p role="status" aria-live="polite">{message}</p>
        <button className="primary-button" type="submit">{busy ? "Please wait…" : step === "login" ? "Sign in" : step === "register" ? "Create account" : step === "verify" ? "Verify email" : step === "forgot" ? "Send reset code" : "Save password"}</button>
        <div className="auth-links">
          {step === "login" && <><button type="button" className="text-button" onClick={() => move("register")}>Create account</button><button type="button" className="text-button" onClick={() => move("forgot")}>Forgot password?</button></>}
          {step !== "login" && <button type="button" className="text-button" onClick={() => move("login")}>Back to sign in</button>}
          {(step === "verify" || step === "reset") && <button type="button" className="text-button" onClick={async () => {
            setBusy(true);
            try { if (step === "verify") await resendSignUpCode({ username: email.trim() }); else await resetPassword({ username: email.trim() }); setMessage("A new code has been requested. Check your email."); }
            catch { setMessage("Could not resend the code. Please wait and try again."); }
            finally { setBusy(false); }
          }}>Resend code</button>}
        </div>
      </fieldset>
    </form>
    <p className="lesson-note">Your account is managed securely by Amazon Cognito. Email verification is required.</p>
  </dialog>;
}
