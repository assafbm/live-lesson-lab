import { useState } from "react";
import { useAccount } from "./AuthGate";

/** Display names are untrusted presentation text, never authorization claims. */
export function useParticipantName(role: "teacher" | "student") {
  const user = useAccount();
  const key = `lesson-display-name:${user?.profile.sub ?? `guest-${role}`}`;
  const storage = user ? localStorage : sessionStorage;
  const fallback = role === "teacher" ? "Teacher" : "Student";
  const [name, setName] = useState(() => {
    try { return storage.getItem(key) || String(user?.profile.name || fallback); }
    catch { return fallback; }
  });
  function updateName(value: string) {
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) || fallback;
    setName(clean);
    try { storage.setItem(key, clean); } catch { /* Storage may be disabled. The live name still works. */ }
  }
  return { name, updateName };
}
