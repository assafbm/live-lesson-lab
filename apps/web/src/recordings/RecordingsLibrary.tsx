import { useState } from "react";
import { useAccount } from "../auth/AuthGate";
import { recordingApi, recordingConfigured, type RecordingInfo } from "./api";
export function RecordingsLibrary() {
  const account = useAccount();
  const [records, setRecords] = useState<RecordingInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!account || !recordingConfigured) return null;
  async function load() {
    setBusy(true); setError("");
    try { setRecords((await recordingApi({ action: "list" })).recordings ?? []); setLoaded(true); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function download(id: string) {
    setError("");
    try { const { url } = await recordingApi({ action: "download", id }); const link = document.createElement("a"); link.href = url!; link.rel = "noreferrer"; link.click(); }
    catch (cause) { setError((cause as Error).message); }
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this recording for both participants? This cannot be undone.")) return;
    try { await recordingApi({ action: "delete", id }); await load(); }
    catch (cause) { setError((cause as Error).message); }
  }
  return <section className="recordings-library" aria-label="My recordings">
    <h2>My recordings</h2><p>Private lesson recordings are available for 30 days. Downloads require your verified account. Email notifications are not enabled yet.</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "Load my recordings"}</button>
    {loaded && !records.length && <p>No saved recordings available.</p>}
    <ul>{records.map(record => <li key={record.id}><span>{new Date(record.createdAt).toLocaleString()} · Expires {new Date(record.expiresAt).toLocaleDateString()}</span> <button type="button" onClick={() => void download(record.id)}>Download lesson</button>{record.canDelete && <button type="button" onClick={() => void remove(record.id)}>Delete recording</button>}</li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </section>;
}
