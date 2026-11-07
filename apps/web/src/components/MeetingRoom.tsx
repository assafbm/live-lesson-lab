import { RecordingControls } from "../recordings/RecordingControls";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ParticipantRole, LessonTiming } from "@live-lesson-lab/shared";
import { LessonClock } from "./LessonClock";
import { SharedTabControls } from "./SharedTabControls";
import type { CapturedTabController } from "../media/CapturedTabController";
import { MeetingVideoTile } from "./MeetingVideoTile";
import { AccountControls } from "../auth/AuthGate";
import { MediaDiagnostics } from "./MediaDiagnostics";
import type { MediaQualitySample } from "../media/MediaQuality";
import { DisplayNameInput } from "./DisplayNameInput";
import { ToolbarIcon } from "./ToolbarIcon";

type MeetingRoomProps = {
  getLocalAudioTracks: () => MediaStreamTrack[];
  lessonTiming?: (LessonTiming & { clockOffset: number }) | null;
  onExtendLesson?: () => void;
  sharedTabController?: CapturedTabController | null;
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
  qualitySamples: MediaQualitySample[];
  videoError?: string;
  sharingScreen?: boolean;
  onStopScreenShare?: () => void;
  mainRotation?: 0 | 90 | 180 | 270;
  mainMirrored?: boolean;
  mainZoom?: number;
  localFaceRotation?: 0 | 90 | 180 | 270;
  localFaceMirrored?: boolean;
  remoteFaceRotation?: 0 | 90 | 180 | 270;
  remoteFaceMirrored?: boolean;
  viewSettings?: ReactNode;
  generalSettings?: ReactNode;
  participantName: string;
  remoteParticipantName: string;
  onNameChange: (name: string) => void;
  onStartScreenShare?: () => void;
  screenSharePending?: boolean;
  onToggleMicrophone: () => void;
  onDisconnect: () => void;
};

/** Full-viewport lesson surface shared by teacher and student after connection. */
export function MeetingRoom({
  getLocalAudioTracks,
  lessonTiming = null,
  onExtendLesson,
  sharedTabController = null,
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
  qualitySamples,
  videoError = "",
  sharingScreen = false,
  onStopScreenShare,
  mainRotation = 0,
  mainMirrored = false,
  mainZoom = 1,
  localFaceRotation = 0,
  localFaceMirrored = false,
  remoteFaceRotation = 0,
  remoteFaceMirrored = false,
  viewSettings,
  generalSettings,
  participantName,
  remoteParticipantName,
  onNameChange,
  onStartScreenShare,
  screenSharePending = false,
  onToggleMicrophone,
  onDisconnect
}: MeetingRoomProps) {
  const beforeLeaveRef = useRef<(() => Promise<void>) | null>(null);
  const [leaving, setLeaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const localFaceRef = useRef<HTMLVideoElement>(null);
  const remoteFaceRef = useRef<HTMLVideoElement>(null);
  const mainPreviewRef = useRef<HTMLVideoElement>(null);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<"general" | "video" | null>(null);
  const showViewSettings = settingsPanel !== null;
  const settingsButton = useRef<HTMLButtonElement>(null);
  const closeSettingsButton = useRef<HTMLButtonElement>(null);
  const peerName = remoteParticipantName;
  const videoSettingsButton = useRef<HTMLButtonElement>(null);
  const returnFocus = () => (settingsPanel === "video" ? videoSettingsButton : settingsButton).current?.focus();

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = remoteAudio;
    if (remoteAudio) {
      // Browsers may block sound until a user gesture; keep a visible recovery action.
      void audio.play().then(() => setAudioPlaybackBlocked(false)).catch(() => setAudioPlaybackBlocked(true));
    } else setAudioPlaybackBlocked(false);
    return () => {
      audio.srcObject = null;
    };
  }, [remoteAudio]);

  useEffect(() => {
    if (!showViewSettings) return;
    closeSettingsButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSettingsPanel(null); returnFocus(); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [settingsPanel]);

  return (
    <main className="meeting-screen">
      <header className="meeting-header">
        <a className="meeting-brand" href="/" aria-label="Live Lesson Lab home">
          <span className="wordmark-icon" aria-hidden="true">L</span>
          <span>Live Lesson <strong>Lab</strong></span>
        </a>
        <div className="meeting-room-label">
          <LessonClock timing={lessonTiming} onExtend={onExtendLesson} />
          <span className={`meeting-connection-dot ${connectionState === "connected" ? "meeting-dot-connected" : "meeting-dot-waiting"}`} />
          <span className="meeting-connection-status">{connectionStatus}</span>
          <span className="meeting-room-code">{roomId.slice(0, 8).toUpperCase()}</span>
        </div>
      </header>

      <div className="meeting-layout">
        <MeetingVideoTile
          label="Shared content"
          accessibleLabel="Shared content"
          previewRef={mainPreviewRef}
          stream={mainVideo}
          main
          detail={sharingScreen ? "You are sharing your screen" : undefined}
          rotation={mainRotation}
          mirrored={mainMirrored}
          zoom={mainZoom}
          placeholder={role === "teacher" ? "Choose a camera in Video settings or share your screen." : "Waiting for the teacher to share content."}
        >
          {sharingScreen && <SharedTabControls key={mainVideo?.id} controller={sharedTabController} preview={mainPreviewRef} />}
        </MeetingVideoTile>
        <aside className="meeting-side-rail" aria-label="Participant cameras">
          <MeetingVideoTile
            previewRef={localFaceRef}
            label={participantName}
            accessibleLabel="Your camera"
            stream={localFaceVideo}
            rotation={localFaceRotation}
            mirrored={localFaceMirrored}
            placeholder="Your face camera is off."
          />
          <MeetingVideoTile
            previewRef={remoteFaceRef}
            label={peerName}
            accessibleLabel={role === "teacher" ? "Student camera" : "Teacher camera"}
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
          {audioPlaybackBlocked && <button type="button" onClick={() => {
            void audioRef.current?.play().then(() => setAudioPlaybackBlocked(false)).catch(() => setAudioPlaybackBlocked(true));
          }}>Play audio</button>}
        </div>
      )}
      <audio ref={audioRef} autoPlay playsInline />

      {/* Role-specific controls are injected here while the room layout stays shared. */}
      {showViewSettings && (
        <section id="media-settings" className="meeting-settings-panel" aria-label={settingsPanel === "video" ? "Video settings" : "Settings"}>
          <div className="meeting-settings-heading">
            <strong>{settingsPanel === "video" ? "Video settings" : "Settings"}</strong>
            <button ref={closeSettingsButton} type="button" onClick={() => { setSettingsPanel(null); returnFocus(); }} aria-label="Close settings">×</button>
          </div>
          {settingsPanel === "video" ? viewSettings : <>
            <DisplayNameInput name={participantName} onChange={onNameChange} />
            {generalSettings}
            <AccountControls />
            <MediaDiagnostics samples={qualitySamples} />
          </>}
        </section>
      )}

      <footer className="meeting-toolbar">
        <span className="meeting-role-caption">{participantName}</span>
        <div className="meeting-actions">
          <RecordingControls beforeLeaveRef={beforeLeaveRef} roomId={roomId} role={role} connected={connectionState === "connected"} sources={() => {
            const local = { video: localFaceRef.current, rotation: localFaceRotation, mirrored: localFaceMirrored, name: participantName };
            const remote = { video: remoteFaceRef.current, rotation: remoteFaceRotation, mirrored: remoteFaceMirrored, name: remoteParticipantName };
            return { document: { video: mainPreviewRef.current, rotation: mainRotation, mirrored: mainMirrored, zoom: mainZoom, name: "" },
              teacher: role === "teacher" ? local : remote, student: role === "student" ? local : remote,
              audio: [...(microphoneEnabled ? getLocalAudioTracks() : []), ...(remoteMicrophoneEnabled ? remoteAudio?.getAudioTracks() ?? [] : [])] };
          }} />
          {(onStartScreenShare || sharingScreen) && <button className="meeting-action-button meeting-icon-button" type="button"
            aria-label={sharingScreen ? "Stop sharing" : "Share screen"} data-tooltip={sharingScreen ? "Stop sharing" : "Share screen"}
            disabled={screenSharePending} aria-pressed={sharingScreen} onClick={sharingScreen ? onStopScreenShare : onStartScreenShare}>
            <ToolbarIcon icon={sharingScreen ? "stop" : "share"} /></button>}
          {viewSettings && <button ref={videoSettingsButton} className="meeting-action-button meeting-icon-button" type="button"
            onClick={() => setSettingsPanel((current) => current === "video" ? null : "video")} aria-label="Video settings" data-tooltip="Video settings"
            aria-expanded={settingsPanel === "video"} aria-controls="media-settings"><ToolbarIcon icon="video" /></button>}
          <button ref={settingsButton} className="meeting-action-button meeting-icon-button" type="button"
            onClick={() => setSettingsPanel((current) => current === "general" ? null : "general")} aria-label="Settings" data-tooltip="Settings"
            aria-expanded={settingsPanel === "general"} aria-controls="media-settings"><ToolbarIcon icon="settings" /></button>
          <button
            className={`meeting-action-button meeting-icon-button ${microphoneEnabled ? "" : "meeting-action-muted"}`}
            aria-label={microphoneEnabled ? "Mute" : "Unmute"}
            data-tooltip={microphoneEnabled ? "Mute" : "Unmute"}
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
          </button>
          <button className="meeting-action-button meeting-icon-button meeting-disconnect-button" type="button" disabled={leaving} onClick={() => { setLeaving(true); void (async () => { try { await beforeLeaveRef.current?.(); onDisconnect(); } finally { setLeaving(false); } })(); }} aria-label="Disconnect" data-tooltip="Disconnect">
            <span className="meeting-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 10.5a13 13 0 0 1 16 0l-2.2 3.1a9.2 9.2 0 0 0-11.6 0L4 10.5Z" /><path d="m8.2 15.1-1.5 3.3m9.1-3.3 1.5 3.3M12 15v5" /></svg></span>
          </button>
        </div>
        <span className="meeting-role-caption meeting-peer-caption">{peerName}</span>
      </footer>
    </main>
  );
}
