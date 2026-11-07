import { useEffect, useState } from "react";
import type { LessonTiming } from "@live-lesson-lab/shared";

export function LessonClock({ timing, onExtend }: { timing: (LessonTiming & { clockOffset: number }) | null; onExtend?: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { setPending(false); setError(""); }, [timing?.serverNow]);
  useEffect(() => {
    if (!pending) return;
    const timeout = window.setTimeout(() => { setPending(false); setError("No confirmation yet. You can retry adding time."); }, 10000);
    return () => clearTimeout(timeout);
  }, [pending]);
  if (!timing?.endsAt) return null;
  // Use the acknowledged server clock offset, not the user's system clock.
  // Invitation expiry still gates NEW joins; this clock never cuts off media.
  const seconds = Math.ceil((timing.endsAt - now - timing.clockOffset) / 1000);
  const remaining = `${Math.floor(Math.abs(seconds) / 60)}:${String(Math.abs(seconds) % 60).padStart(2, "0")}`;
  const warning = seconds <= 300 && dismissed !== timing.endsAt;
  function extend() { setError(""); setPending(true); onExtend?.(); }
  return <div className={`lesson-clock ${seconds <= 300 ? "lesson-clock-warning" : ""}`}>
    <span aria-label="Lesson time remaining" title={seconds > 0 ? "Planned lesson time remaining" : "Overtime — the call stays open"}>
      {seconds > 0 ? remaining : `+${remaining}`}
    </span>
    {onExtend && <button type="button" className="clock-extend" onClick={extend} disabled={pending || timing.durationMinutes >= 480} aria-label="Add 15 minutes" title="Add 15 minutes">+15</button>}
    {warning && <aside className="lesson-time-notice" aria-label="Lesson time reminder">
      <div role="status"><strong>{seconds > 0 ? "About five minutes left" : "Your planned lesson time has ended"}</strong>
        <p>{onExtend ? "Would you like to add more time? The call stays open." : "The teacher can extend the lesson. Your call stays open."}</p></div>
      {onExtend && <button type="button" className="primary-button" onClick={extend} disabled={pending || timing.durationMinutes >= 480}>{pending ? "Adding time…" : "Add 15 minutes to lesson"}</button>}
      <button type="button" className="text-button" onClick={() => setDismissed(timing.endsAt)}>Dismiss reminder</button>
      {timing.durationMinutes >= 480 && <p>Eight-hour planned duration reached. You can still finish the call.</p>}
    </aside>}
    {error && <span className="clock-error" role="alert">{error}</span>}
  </div>;
}
