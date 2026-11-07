import { getIdentityToken } from "../auth/identity";
export type RecordingInfo = { id: string; roomId: string; state: string; createdAt: number; expiresAt: number; teacherConsent: boolean; studentConsent: boolean; bytes?: number; canDelete?: boolean };
export const recordingConfigured = Boolean(import.meta.env.VITE_RECORDINGS_API_URL);
export async function recordingApi(input: Record<string, unknown>): Promise<{ recording?: RecordingInfo | null; recordings?: RecordingInfo[]; url?: string; ok?: boolean }> {
  const token = await getIdentityToken();
  if (!token) throw new Error("Sign in with a verified email to use recordings.");
  const response = await fetch(import.meta.env.VITE_RECORDINGS_API_URL, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Recording service unavailable.");
  return data;
}
