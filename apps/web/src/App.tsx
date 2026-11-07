import { RecordingsLibrary } from "./recordings/RecordingsLibrary";
import { MicrophoneSettings } from "./components/MicrophoneSettings";
import { useEffect, useState } from "react";
import { CameraPreview } from "./components/CameraPreview";
import { StudentLesson } from "./components/StudentLesson";
import { MeetingRoom } from "./components/MeetingRoom";
import { defaultAudioProcessingSettings, useLessonSession, type AudioProcessingSettings } from "./media/useLessonSession";
import { useCameraPreviews } from "./media/useCameraPreviews";
import { useAudioInputDevices } from "./media/useAudioInputDevices";
import { useScreenShare } from "./media/useScreenShare";
import { RoomAccessControls } from "./components/RoomAccessControls";
import { AccountControls } from "./auth/AuthGate";
import { DisplayNameInput } from "./components/DisplayNameInput";

type CameraDevice = {
  deviceId: string;
  label: string;
};

type PermissionState = "idle" | "requesting" | "ready" | "denied" | "unsupported";
type VideoRole = "face" | "document";
type ViewTransform = { rotation: 0 | 90 | 180 | 270; mirrored: boolean };

const defaultTransform: ViewTransform = { rotation: 0, mirrored: false };

const roleLabels: Record<VideoRole, string> = {
  face: "Face camera",
  document: "Document camera"
};

async function listVideoDevices(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`
    }));
}

async function refreshCameraList(): Promise<CameraDevice[]> {
  return listVideoDevices();
}

function getPermissionError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Camera access was denied. Allow camera access in your browser settings, then try again.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No camera was found. You can continue without video or connect a camera and refresh the device list.";
  }
  return "The camera could not be opened. Check that it is connected and not being used by another app.";
}

export function App() {
  const params = new URLSearchParams(location.search);
  const roomId = params.get("room");
  const requestedRole = params.get("role");

  // The role is visible in the URL so a shared link is self-explanatory.
  // Keep accepting the old ?room=... form so previously copied local links work.
  if (requestedRole === "student" || (!requestedRole && roomId)) {
    return roomId ? <StudentLesson roomId={roomId} /> : <MissingStudentRoom />;
  }
  return <TeacherSetup />;
}

function MissingStudentRoom() {
  return (
    <main className="page-shell">
      <section className="hero lesson-page">
        <div className="eyebrow"><span /> STUDENT LINK</div>
        <h1>This lesson<br /><em>link is incomplete.</em></h1>
        <p className="intro">Ask your teacher to copy and send the student invitation link again.</p>
        <a className="text-button" href="?role=teacher">Open teacher setup</a>
      </section>
    </main>
  );
}

function TeacherSetup() {
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [permission, setPermission] = useState<PermissionState>("idle");
  const [permissionMessage, setPermissionMessage] = useState("");
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<Record<VideoRole, string | null>>({
    face: null,
    document: null
  });
  const [viewTransforms, setViewTransforms] = useState<Record<VideoRole, ViewTransform>>({ face: defaultTransform, document: defaultTransform });
  const [audioProcessing, setAudioProcessing] = useState<AudioProcessingSettings>(defaultAudioProcessingSettings);

  const screenShare = useScreenShare();
  // Remember the document camera choice while its capture is temporarily
  // replaced. A shared face camera stays leased once; a document-only camera
  // can be released until the user stops sharing their screen.
  const activeDevices = { ...selectedDevices, document: screenShare.stream ? null : selectedDevices.document };
  const previews = useCameraPreviews(activeDevices);
  const audioInputs = useAudioInputDevices();
  // The lesson sender leases the same manager-owned streams used by previews.
  // That keeps camera capture single even while local preview and WebRTC both use it.
  const lesson = useLessonSession("teacher", activeDevices, null, viewTransforms, audioInputs.selectedDeviceId, audioProcessing,
    screenShare.stream ? { stream: screenShare.stream, onFailure: screenShare.fail } : null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [inMeeting, setInMeeting] = useState(false);
  useEffect(() => {
    if (lesson.status !== "closed") return;
    screenShare.stop();
    setSelectedDevices({ face: null, document: null });
    setInMeeting(false);
  }, [lesson.status, screenShare.stop]);
  const accessControls = <RoomAccessControls access={lesson.roomAccess} onLock={lesson.setRoomLocked} onRenew={lesson.renewInvitation} onEnd={lesson.endRoom} />;

  const joinUrl = lesson.roomId
    ? `${location.origin}${location.pathname}?role=student&room=${encodeURIComponent(lesson.roomId)}`
    : "";

  async function refreshDevices() {
    try {
      setDevices(await refreshCameraList());
      setPermissionMessage("");
    } catch {
      setPermissionMessage("The camera list could not be refreshed. Try again in a moment.");
    }
  }

  async function requestCameraAccess() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
      setPermissionMessage("This browser does not support camera access. Try a recent version of Chrome, Edge, Firefox, or Safari.");
      return;
    }

    setPermission("requesting");
    setPermissionMessage("");

    try {
      // A temporary stream reveals device labels. Stop it immediately so the
      // permission check does not leave an extra camera capture running.
      const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      permissionStream.getTracks().forEach((track) => track.stop());
      setDevices(await listVideoDevices());
      setPermission("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        setDevices(await listVideoDevices().catch(() => []));
        setPermission("ready");
      } else {
        setPermission("denied");
      }
      setPermissionMessage(getPermissionError(error));
    }
  }

  useEffect(() => {
    if (permission !== "ready" || !navigator.mediaDevices) return;

    // Refresh the picker when a camera is plugged in or removed. The currently
    // selected source is kept so the preview can explain if it was disconnected.
    const handleDeviceChange = () => void refreshDevices();

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [permission]);

  function selectDevice(role: VideoRole, deviceId: string) {
    const pairedRole = role === "face" ? "document" : "face";
    if (deviceId && deviceId === selectedDevices[pairedRole]) {
      setViewTransforms((current) => ({ ...current, [role]: current[pairedRole] }));
    }
    setSelectedDevices((current) => ({
      ...current,
      [role]: deviceId || null
    }));
  }

  function updateViewTransform(role: VideoRole, patch: Partial<ViewTransform>) {
    setViewTransforms((current) => {
      const updated = { ...current[role], ...patch };
      const next = { ...current, [role]: updated };
      const pairedRole: VideoRole = role === "face" ? "document" : "face";
      const rolesShareCamera = Boolean(selectedDevices.face && selectedDevices.face === selectedDevices.document);
      // One physical camera creates one outgoing track, so its sender transform
      // is necessarily shared by both logical views.
      if (rolesShareCamera) next[pairedRole] = updated;
      return next;
    });
  }

  async function copyJoinLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      setCopiedLink(false);
    }
  }

  function exitMeeting() {
    screenShare.stop();
    setInMeeting(false);
    setSelectedDevices({ face: null, document: null });
    lesson.exitRoom();
  }

  const selectedCount = Object.values(selectedDevices).filter(Boolean).length;
  const uniqueSelectedCount = new Set(Object.values(selectedDevices).filter(Boolean)).size;
  const rolesShareCamera = !screenShare.stream && Boolean(selectedDevices.face && selectedDevices.face === selectedDevices.document);
  const meetingCameraSettings = (
    <div className="meeting-view-settings">
      {(["face", "document"] as const).map((role) => (
        <fieldset key={role} disabled={role === "document" && Boolean(screenShare.stream)}>
          <legend>{roleLabels[role]}</legend>
          {role === "document" && screenShare.stream && <p className="settings-help-copy">Screen sharing is active. Stop sharing to restore this camera and its orientation.</p>}
          <label>
            Camera
            <select value={selectedDevices[role] ?? ""} onChange={(event) => selectDevice(role, event.target.value)}>
              <option value="">Off</option>
              {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
            </select>
          </label>
          <label>
            Rotate before sending
            <select
              value={viewTransforms[role].rotation}
              onChange={(event) => updateViewTransform(role, { rotation: Number(event.target.value) as ViewTransform["rotation"] })}
            >
              <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
            </select>
          </label>
          <label className="meeting-settings-check">
            <input type="checkbox" checked={viewTransforms[role].mirrored} onChange={(event) => updateViewTransform(role, { mirrored: event.target.checked })} />
            Mirror before sending
          </label>
          {permission !== "ready" && (
            <button className="meeting-permission-button" type="button" onClick={() => void requestCameraAccess()}>
              Enable cameras
            </button>
          )}
        </fieldset>
      ))}
      {rolesShareCamera && <p className="shared-source-note">One camera is shared by both views, so its outgoing rotation and mirror settings apply to both.</p>}
      <p className="settings-help-copy">Rotation and mirroring are applied to the outgoing camera frames before WebRTC sends them. Your student can still make separate adjustments on their screen.</p>
    </div>
  );

  if (inMeeting) {
    return (
      <MeetingRoom
        role="teacher"
        getLocalAudioTracks={lesson.getLocalAudioTracks}
        lessonTiming={lesson.lessonTiming}
        onExtendLesson={lesson.extendLesson}
        roomId={lesson.roomId ?? ""}
        connectionState={lesson.status}
        connectionStatus={lesson.statusMessage}
        mainVideo={screenShare.stream ?? (selectedDevices.document ? lesson.outgoingVideoStreams[selectedDevices.document] ?? previews.sources[selectedDevices.document]?.stream ?? null : null)}
        localFaceVideo={selectedDevices.face ? lesson.outgoingVideoStreams[selectedDevices.face] ?? previews.sources[selectedDevices.face]?.stream ?? null : null}
        remoteFaceVideo={lesson.remoteStudentVideoStream}
        remoteAudio={lesson.remoteStream}
        microphoneEnabled={lesson.audioEnabled}
        remoteMicrophoneEnabled={lesson.remoteAudioEnabled}
        qualitySamples={lesson.qualitySamples}
        audioError={lesson.audioError}
        videoError={screenShare.error || lesson.videoError}
        sharingScreen={Boolean(screenShare.stream)}
        sharedTabController={screenShare.controller}
        onStopScreenShare={screenShare.stop}
        onStartScreenShare={() => void screenShare.start()}
        screenSharePending={screenShare.pending}
        participantName={lesson.participantName}
        remoteParticipantName={lesson.remoteParticipantName}
        onNameChange={lesson.setParticipantName}
        generalSettings={<div className="meeting-view-settings">{accessControls}<MicrophoneSettings inputs={audioInputs} enabled={lesson.audioEnabled} processing={audioProcessing} onChange={setAudioProcessing} /></div>}
        mainRotation={0}
        mainMirrored={false}
        localFaceRotation={0}
        localFaceMirrored={false}
        viewSettings={meetingCameraSettings}
        onToggleMicrophone={() => lesson.setAudioEnabled(!lesson.audioEnabled)}
        onDisconnect={exitMeeting}
      />
    );
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Live Lesson Lab — Home">
          <span className="wordmark-icon" aria-hidden="true">L</span>
          <span>Live Lesson <strong>Lab</strong></span>
        </a>
        <span className="connection-pill">
          <span className={`status-dot ${permission === "ready" ? "status-ready" : ""}`} />
          {permission === "ready" ? "Camera setup" : "Local setup"}
        </span>
      </header>

      <section className="hero camera-setup" aria-labelledby="welcome-title">
        <div className="eyebrow"><span /> TEACHER LOBBY · PRIVATE LESSON</div>
        <h1 id="welcome-title">Prepare your<br /><em>lesson.</em></h1>
        <p className="intro">
          Choose a camera for each view. You can use one camera for both, or leave either view off.
        </p>
        <AccountControls />
        <RecordingsLibrary />
        <DisplayNameInput name={lesson.participantName} onChange={lesson.setParticipantName} />

        <section className="lesson-controls" aria-labelledby="lesson-controls-title">
          <div className="lesson-controls-heading">
            <div>
              <span className="camera-role-label">TEACHER CONTROLS</span>
              <h2 id="lesson-controls-title">Start a private lesson</h2>
            </div>
            <span className={`role-indicator ${lesson.signalingReady ? "role-active" : ""}`} aria-label={lesson.signalingReady ? "Lesson service connected" : "Connecting to lesson service"} />
          </div>

          {lesson.audioError && <p className="error-copy" role="alert">{lesson.audioError}</p>}
          {lesson.videoError && <p className="error-copy" role="alert">{lesson.videoError}</p>}

          {!lesson.roomId ? (
            <div className="lesson-create-row">
              <label className="duration-picker">Lesson length
                <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}>
                  {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                </select>
                <small>The clock starts when you enter.</small>
              </label>
              <span className="lesson-status-copy">{lesson.statusMessage}</span>
              <button className="primary-button" type="button" onClick={() => lesson.createRoom(durationMinutes)} disabled={!lesson.signalingReady || lesson.status === "joining"}>
                {lesson.status === "joining" ? "Creating link…" : lesson.signalingReady ? "Create lesson link" : "Connecting…"}
              </button>
            </div>
          ) : (
            <>
              <div className="lesson-room-status">
                <span className={`status-dot ${lesson.status === "waiting" || lesson.status === "connecting-peer" ? "status-ready" : ""}`} />
                <span>{lesson.statusMessage}</span>
              </div>
              <label className="select-label" htmlFor="student-link">Student join link</label>
              <div className="share-link-row">
                <input id="student-link" value={joinUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
                <button className="secondary-button" type="button" onClick={() => void copyJoinLink()}>
                  {copiedLink ? "Copied" : "Copy link"}
                </button>
              </div>
              <button className="primary-button lesson-action" type="button" onClick={() => { setInMeeting(true); lesson.enterRoom(); }}>Join lesson</button>
              {accessControls}
            </>
          )}
          <p className="lesson-note">Selected cameras are shared with your student while they are connected.</p>
        </section>

        {permission !== "ready" && (
          <section className="permission-card" aria-labelledby="permission-title">
            <div className="permission-copy">
              <strong id="permission-title">Allow camera access to list your devices</strong>
              <span>We will ask your browser for permission, then stop the temporary preview stream.</span>
              {permissionMessage && <span className="error-copy" role="alert">{permissionMessage}</span>}
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => void requestCameraAccess()}
              disabled={permission === "requesting"}
            >
              {permission === "requesting" ? "Requesting access…" : "Enable cameras"}
            </button>
          </section>
        )}

        {permission === "ready" && (
          <>
            <div className="setup-summary" role="status">
              <span>{devices.length === 0 ? "No cameras available" : `${devices.length} camera${devices.length === 1 ? "" : "s"} available`}</span>
              <span>{selectedCount === 0 ? "No sources selected" : `${selectedCount} role${selectedCount === 1 ? "" : "s"} selected · ${uniqueSelectedCount} physical source${uniqueSelectedCount === 1 ? "" : "s"} captured`}</span>
            </div>

            {permissionMessage && <p className="error-copy permission-notice" role="alert">{permissionMessage}</p>}

            <div className="camera-grid">
              {(["face", "document"] as const).map((role) => {
                const selectedId = selectedDevices[role];
                const preview = selectedId ? previews.sources[selectedId] : undefined;
                const cameraWasRemoved = selectedId && !devices.some((device) => device.deviceId === selectedId);

                return (
                  <section className="camera-card" key={role} aria-labelledby={`${role}-heading`}>
                    <div className="camera-card-heading">
                      <div>
                        <span className="camera-role-label">{role === "face" ? "ROLE 01" : "ROLE 02"}</span>
                        <h2 id={`${role}-heading`}>{roleLabels[role]}</h2>
                      </div>
                      <span className={`role-indicator ${selectedId ? "role-active" : ""}`} aria-label={selectedId ? "Source selected" : "No source selected"} />
                    </div>

                    <label className="select-label" htmlFor={`${role}-device`}>Video source</label>
                    <select
                      id={`${role}-device`}
                      value={selectedId ?? ""}
                      onChange={(event) => selectDevice(role, event.target.value)}
                    >
                      <option value="">None</option>
                      {cameraWasRemoved && <option value={selectedId} disabled>Disconnected camera</option>}
                      {devices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                      ))}
                    </select>

                    <CameraPreview
                      square={role === "face"}
                      label={roleLabels[role]}
                      stream={preview?.stream ?? null}
                      message={selectedId
                        ? preview?.error ?? (cameraWasRemoved ? "This camera was disconnected. Choose another source." : "Starting camera…")
                        : "This view is turned off. Choose a camera above to preview it."}
                      active={Boolean(selectedId && preview?.stream && !preview.error)}
                    />

                    {selectedId && selectedDevices.face === selectedDevices.document && role === "document" && (
                      <p className="shared-source-note">This role shares the face camera. The camera is captured once.</p>
                    )}
                  </section>
                );
              })}
            </div>

            <div className="permission-footer">
              <span>Camera access stays in this browser. Selected video is sent only while a student is connected.</span>
              <button className="text-button" type="button" onClick={() => void refreshDevices()}>
                Refresh camera list
              </button>
            </div>
          </>
        )}
      </section>

      <footer className="footer">
        <span>Made for learning, conversation, and curiosity.</span>
        <span className="footer-mark">LIVE LESSON LAB <span>·</span> 2026</span>
      </footer>
    </main>
  );
}
