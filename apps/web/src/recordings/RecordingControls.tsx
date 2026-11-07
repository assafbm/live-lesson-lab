import { useEffect, useRef, useState, type RefObject } from "react";
import { useAccount } from "../auth/AuthGate";
import { recordingApi, recordingConfigured, type RecordingInfo } from "./api";
import { LessonRecorder, type RecordingSources } from "./LessonRecorder";

type ControlsProps = { beforeLeaveRef?: RefObject<(() => Promise<void>) | null>; roomId: string; role: "teacher" | "student"; connected: boolean; sources: () => RecordingSources };
export function RecordingControls(props: ControlsProps) {
  const account = useAccount();
  return <RecordingControlsSession {...props} authenticated={!!account} />;
}
/** Separate the view/session from authentication and HTTP adapters for tests. */
export function RecordingControlsSession({ beforeLeaveRef, roomId, role, connected, sources, authenticated, configured = recordingConfigured, api = recordingApi }: ControlsProps & { authenticated: boolean; configured?: boolean; api?: typeof recordingApi }) {
  const [record, setRecord] = useState<RecordingInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = useRef<LessonRecorder | null>(null);
  const alive = useRef(true);
  const sourceRef = useRef(sources); sourceRef.current = sources;
  const recordRef = useRef(record); recordRef.current = record;
  const activeRequest = useRef(false);
  const finish = async () => {
    const recorder = current.current; if (!recorder) return;
    current.current = null; if (alive.current) setSaving(true);
    try {
      // Stop capture synchronously, even if notifying the server is slow.
      await Promise.all([recorder.finish(), recordRef.current
        ? api({ action: "stop", id: recordRef.current.id }).catch(() => undefined) : Promise.resolve()]);
    }
    catch (cause) { if (alive.current) setError((cause as Error).message + " The recording was not saved."); }
    finally { if (alive.current) setSaving(false); }
  };
  const finishRef = useRef(finish); finishRef.current = finish;
  useEffect(() => {
    if (beforeLeaveRef) beforeLeaveRef.current = () => finishRef.current();
    return () => { if (beforeLeaveRef) beforeLeaveRef.current = null; };
  }, [beforeLeaveRef]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; void finishRef.current(); };
  }, []);
  useEffect(() => {
    if (!authenticated || !configured) return;
    let disposed = false; let pending = false;
    const poll = async () => {
      if (pending) return; pending = true;
      try {
        const previous = recordRef.current;
        const result = await api(previous && !["ready", "failed", "cancelled", "deleted"].includes(previous.state)
          ? { action: "status", id: previous.id } : { action: "room", roomId });
        if (disposed) return;
        const next = result.recording ?? null;
        if (next?.id !== previous?.id && next?.state === "pending") setOpen(true);
        setRecord(next);
        if (current.current && !activeRequest.current) {
          if (next?.state !== "recording") await finishRef.current();
          else await api({ action: "pulse", id: next.id });
        }
      } catch (cause) {
        if (!disposed) setError((cause as Error).message);
        // Loss of authorization/connection ends capture; it cannot silently
        // continue while the other participant has lost the recording indicator.
        if (current.current) await finishRef.current();
      } finally { pending = false; }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, [roomId, authenticated, configured, api]);
  useEffect(() => { if (!connected && current.current) void finishRef.current(); }, [connected]);
  useEffect(() => {
    const hidden = () => { if (document.hidden && current.current) { setError("Recording stopped because the student tab was hidden. Keep this tab visible while recording."); void finishRef.current(); } };
    const unload = (event: BeforeUnloadEvent) => { if (current.current || saving || activeRequest.current) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("beforeunload", unload); };
  }, [saving]);
  async function action(action: string) {
    setError(""); setBusy(true);
    try {
      if (action === "stop" && current.current) { await finishRef.current(); return; }
      const result = await api({ action, roomId, id: record?.id });
      if (result.recording) setRecord(result.recording);
      if (action === "stop") await finishRef.current();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  async function start() {
    if (!record || activeRequest.current) return;
    setBusy(true); setError(""); activeRequest.current = true;
    const recorder = new LessonRecorder(record.id, () => sourceRef.current(), message => { if (alive.current) setError(message); }, api);
    current.current = recorder;
    try {
      await recorder.start();
      if (!alive.current || document.hidden) { await finishRef.current(); return; }
      setRecord({ ...record, state: "recording" }); setOpen(false);
    } catch (cause) {
      current.current = null; recorder.dispose();
      await api({ action: "abort", id: record.id }).catch(() => undefined);
      if (alive.current) setError((cause as Error).message);
    } finally { activeRequest.current = false; if (alive.current) setBusy(false); }
  }
  const active = record && ["pending", "approved", "initializing", "recording", "stopping"].includes(record.state);
  const consented = role === "teacher" ? record?.teacherConsent : record?.studentConsent;
  return <>
    <button className={`meeting-action-button meeting-icon-button ${record?.state === "recording" ? "recording-active" : ""}`} type="button" aria-label="Record lesson" data-tooltip="Record lesson" onClick={() => setOpen(!open)} aria-expanded={open}><span aria-hidden="true">●</span></button>
    {(record?.state === "recording" || saving || record?.state === "stopping") && <div className="recording-banner" role="status">
      {saving || record?.state === "stopping" ? "Saving recording — keep the student tab open" : "● Recording lesson · private · 30-day retention"}
      {record?.state === "recording" && <button type="button" onClick={() => void action("stop")} disabled={busy}>Stop recording</button>}
    </div>}
    {open && <section className="recording-panel" aria-label="Lesson recording">
      <header><strong>Lesson recording</strong><button type="button" aria-label="Close recording panel" onClick={() => setOpen(false)}>×</button></header>
      <p>Records the student’s study view: shared content, teacher above student, and both voices. Stored privately for 30 days. Only these two consenting accounts can download it.</p>
      <p>The student browser records and uploads. Keep its lesson tab visible and open until saving finishes. Either participant can stop recording.</p>
      {!authenticated ? <p>Guests can attend, but both participants must sign in with verified email before joining a recorded lesson.</p>
        : !configured ? <p>Cloud recording is not configured in this environment.</p>
        : <>
          {!active && <button type="button" className="primary-button" disabled={busy || saving || !connected} onClick={() => void action("request")}>Request recording</button>}
          {record?.state === "pending" && <>
            <p>Teacher: {record.teacherConsent ? "Consented" : "Waiting for consent"} · Student: {record.studentConsent ? "Consented" : "Waiting for consent"}</p>
            {!consented && <button type="button" className="primary-button" disabled={busy} onClick={() => void action("consent")}>I consent to this recording</button>}
          </>}
          {record?.state === "approved" && (role === "student"
            ? <button type="button" className="primary-button" disabled={busy || !connected || !LessonRecorder.supported()} onClick={() => void start()}>Start recording and upload</button>
            : <p>Both participants consented. The student can now start recording.</p>)}
          {role === "student" && !LessonRecorder.supported() && <p>This browser cannot record this format. Use desktop Chrome or Edge.</p>}
          {active && <button type="button" className="text-button" disabled={busy || record?.state === "initializing"} onClick={() => void action("stop")}>{record.state === "recording" ? "Stop recording" : "Cancel recording"}</button>}
          {record?.state === "ready" && <p role="status">Recording saved. Find it in My recordings after the lesson.</p>}
          {record?.state === "failed" && <p>The recording was not saved. You can request a new recording.</p>}
        </>}
      {error && <p role="alert">{error}</p>}
    </section>}
    {error && !open && <button type="button" className="recording-error" onClick={() => setOpen(true)}>Recording needs attention</button>}
  </>;
}
