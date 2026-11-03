import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ParticipantRole } from "@live-lesson-lab/shared";
import { MeetingVideoTile } from "./MeetingVideoTile";

type MeetingRoomProps = {
  role: ParticipantRole;
  roomId: string;
  connectionState: string;
  connectionStatus: string;
  mainVideo: MediaStream | null;
  localFaceVideo: MediaStream | null;
  remoteFaceVideo: MediaStream | null;
  remoteAudio: MediaStream | null;
  microphoneEnabled: boolean;
  remoteMicrophoneEnabled: boolean;
  audioError: string;
  videoError?: string;
  mainRotation?: 0 | 90 | 180 | 270;
  mainMirrored?: boolean;
  mainZoom?: number;
  localFaceRotation?: 0 | 90 | 180 | 270;
  localFaceMirrored?: boolean;
  remoteFaceRotation?: 0 | 90 | 180 | 270;
  remoteFaceMirrored?: boolean;
  viewSettings?: ReactNode;
  onToggleMicrophone: () => void;
  onDisconnect: () => void;
};

/** Full-viewport lesson surface shared by teacher and student after connection. */
export function MeetingRoom({
  role,
  roomId,
  connectionState,
  connectionStatus,
  mainVideo,
  localFaceVideo,
  remoteFaceVideo,
  remoteAudio,
  microphoneEnabled,
  remoteMicrophoneEnabled,
  audioError,
  videoError = "",
  mainRotation = 0,
  mainMirrored = false,
  mainZoom = 1,
  localFaceRotation = 0,
  localFaceMirrored = false,
  remoteFaceRotation = 0,
  remoteFaceMirrored = false,
  viewSettings,
  onToggleMicrophone,
  onDisconnect
}: MeetingRoomProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [showViewSettings, setShowViewSettings] = useState(false);
  const peerName = role === "teacher" ? "Student" : "Teacher";

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = remoteAudio;
    if (remoteAudio) {
      // Browsers may block sound until a user gesture; keep a visible recovery action.
      void audio.play().then(() => setAudioPlaybackBlocked(false)).catch(() => setAudioPlaybackBlocked(true));
    }
    return () => {
      audio.srcObject = null;
    };
  }, [remoteAudio]);

  return (
    <main className="meeting-screen">
      <header className="meeting-header">
        <a className="meeting-brand" href="/" aria-label="Live Lesson Lab home">
          <span className="wordmark-icon" aria-hidden="true">L</span>
          <span>Live Lesson <strong>Lab</strong></span>
        </a>
        <div className="meeting-room-label">
          <span className={`meeting-connection-dot ${connectionState === "connected" ? "meeting-dot-connected" : "meeting-dot-waiting"}`} />
          <span className="meeting-connection-status">{connectionStatus}</span>
          <span className="meeting-room-code">{roomId.slice(0, 8).toUpperCase()}</span>
        </div>
      </header>

      <div className="meeting-layout">
        <MeetingVideoTile
          label="Document"
          stream={mainVideo}
          main
          rotation={mainRotation}
          mirrored={mainMirrored}
          zoom={mainZoom}
          placeholder={role === "teacher" ? "Choose a document camera before the lesson to share your desk here." : "Waiting for the teacher to share the document camera."}
        />
        <aside className="meeting-side-rail" aria-label="Participant cameras">
          <MeetingVideoTile
            label="You · Face"
            stream={localFaceVideo}
            local
            rotation={localFaceRotation}
            mirrored={localFaceMirrored}
            placeholder="Your face camera is off."
          />
          <MeetingVideoTile
            label={`${peerName} · Face`}
            stream={remoteFaceVideo}
            placeholder={`${peerName} face video will appear here.`}
            detail={remoteMicrophoneEnabled ? "Microphone on" : "Microphone muted"}
            rotation={remoteFaceRotation}
            mirrored={remoteFaceMirrored}
          />
        </aside>
      </div>

      {(audioError || videoError || audioPlaybackBlocked) && (
        <div className="meeting-notice" role="status">
          {audioError || videoError || "Your browser blocked audio playback."}
          {audioPlaybackBlocked && <button type="button" onClick={() => void audioRef.current?.play()}>Play audio</button>}
        </div>
      )}
      <audio ref={audioRef} autoPlay playsInline />

      {/* Role-specific controls are injected here while the room layout stays shared. */}
      {showViewSettings && viewSettings && (
        <section className="meeting-settings-panel" aria-label="View settings">
          <div className="meeting-settings-heading">
            <strong>View settings</strong>
            <button type="button" onClick={() => setShowViewSettings(false)} aria-label="Close view settings">×</button>
          </div>
          {viewSettings}
        </section>
      )}

      <footer className="meeting-toolbar">
        <span className="meeting-role-caption">{role === "teacher" ? "Teacher" : "Student"}</span>
        <div className="meeting-actions">
          {viewSettings && <button className="meeting-action-button" type="button" onClick={() => setShowViewSettings((current) => !current)} aria-pressed={showViewSettings}>View</button>}
          <button
            className={`meeting-action-button ${microphoneEnabled ? "" : "meeting-action-muted"}`}
            type="button"
            onClick={onToggleMicrophone}
            aria-pressed={microphoneEnabled}
          >
            <span className="meeting-action-icon" aria-hidden="true">
              {microphoneEnabled ? (
                <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21m-4 0h8" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21m-4 0h8M4 4l16 16" /></svg>
              )}
            </span>
            {microphoneEnabled ? "Mute" : "Unmute"}
          </button>
          <button className="meeting-action-button meeting-disconnect-button" type="button" onClick={onDisconnect}>
            <span className="meeting-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 10.5a13 13 0 0 1 16 0l-2.2 3.1a9.2 9.2 0 0 0-11.6 0L4 10.5Z" /><path d="m8.2 15.1-1.5 3.3m9.1-3.3 1.5 3.3M12 15v5" /></svg></span>
            Disconnect
          </button>
        </div>
        <span className="meeting-role-caption meeting-peer-caption">Talking with {peerName.toLowerCase()}</span>
      </footer>
    </main>
  );
}
