import { useEffect, useState } from "react";

type Props = {
  access: { locked: boolean; joinExpiresAt: number } | null;
  onLock: (locked: boolean) => void;
  onRenew: () => void;
  onEnd: () => void;
};

/** Server-acknowledged admission controls. Locking gates NEW memberships;
 * it does not remove an already admitted student or stop an active lesson. */
export function RoomAccessControls({ access, onLock, onRenew, onEnd }: Props) {
  const [now, setNow] = useState(Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!access) return null;
  const expired = now >= access.joinExpiresAt;
  return <fieldset className="room-access-controls">
    <legend>Room access</legend>
    <p role="status">{access.locked ? "New joins are locked." : expired ? "The invitation has expired." : "New joins are open."}</p>
    <p>Invitation expires at {new Date(access.joinExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Existing participants can continue and re-enter from this browser session.</p>
    <button type="button" className="meeting-permission-button" onClick={() => onLock(!access.locked)}>{access.locked ? "Unlock new joins" : "Lock new joins"}</button>
    <button type="button" className="meeting-permission-button" onClick={onRenew}>Renew invitation (30 minutes)</button>
    <p>Renewal reopens the same link's time window. A lock stays in place until you unlock it.</p>
    {confirmEnd ? <div role="group" aria-label="Confirm ending lesson">
      <p>End for everyone? This link will stop working and both participants will leave.</p>
      <button type="button" className="meeting-permission-button" onClick={onEnd}>End lesson now</button>
      <button type="button" className="meeting-permission-button" onClick={() => setConfirmEnd(false)}>Keep lesson open</button>
    </div> : <button type="button" className="meeting-permission-button" onClick={() => setConfirmEnd(true)}>End lesson for everyone</button>}
  </fieldset>;
}
