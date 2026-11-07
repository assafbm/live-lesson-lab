import { identityConfigured, signIn } from "../auth/identity";
import { RecordingsLibrary } from "../recordings/RecordingsLibrary";
import { MicrophoneSettings } from "./MicrophoneSettings";
import { AccountControls, useAccount } from "../auth/AuthGate";
import { DisplayNameInput } from "./DisplayNameInput";
import { useEffect, useState } from "react";
import type { MediaRole } from "@live-lesson-lab/shared";
import { CameraPreview } from "./CameraPreview";
import { MeetingRoom } from "./MeetingRoom";
import { useCameraPreviews } from "../media/useCameraPreviews";
import { defaultAudioProcessingSettings, useLessonSession, type AudioProcessingSettings, type OutgoingVideoTransforms } from "../media/useLessonSession";
import { useAudioInputDevices } from "../media/useAudioInputDevices";

type StudentLessonProps = {
  roomId: string;
};

type CameraDevice = {
  deviceId: string;
  label: string;
};

type ViewTransform = {
  rotation: 0 | 90 | 180 | 270;
  mirrored: boolean;
};

const defaultTransform: ViewTransform = { rotation: 0, mirrored: false };

async function listCameras(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput").map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label || `Camera ${index + 1}`
  }));
}

/** The student lobby owns setup; the connected state renders a separate full-screen meeting. */
export function StudentLesson({ roomId }: StudentLessonProps) {
  const account = useAccount();
  const [studentCameraId, setStudentCameraId] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);
  const [cameraPermissionReady, setCameraPermissionReady] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const [viewTransforms, setViewTransforms] = useState<Record<MediaRole, ViewTransform>>({ face: defaultTransform, document: defaultTransform });
  const [outgoingTransforms, setOutgoingTransforms] = useState<OutgoingVideoTransforms>({ face: defaultTransform, document: defaultTransform });
  const [audioProcessing, setAudioProcessing] = useState<AudioProcessingSettings>(defaultAudioProcessingSettings);
  const [applySharedTransform, setApplySharedTransform] = useState(true);
  const [documentZoom, setDocumentZoom] = useState(1);
  const [inMeeting, setInMeeting] = useState(false);

  // Preview and sender leases point to one manager-owned capture for the selected device.
  const studentPreview = useCameraPreviews({ face: studentCameraId, document: null });
  const audioInputs = useAudioInputDevices();
  const lesson = useLessonSession("student", undefined, studentCameraId, outgoingTransforms, audioInputs.selectedDeviceId, audioProcessing);
  useEffect(() => {
    if (lesson.status === "closed") {
      setInMeeting(false);
      setStudentCameraId(null);
    } else if (lesson.status === "failed" && !lesson.roomId) {
      setInMeeting(false);
    }
  }, [lesson.status, lesson.roomId]);

  async function refreshCameraDevices() {
    try {
      const devices = await listCameras();
      setCameraDevices(devices);
      setCameraMessage(devices.length === 0 ? "No camera is available. You can still join and watch the lesson." : "");
      return devices;
    } catch {
      setCameraMessage("The camera list could not be loaded. Try again.");
      return [];
    }
  }

  async function enableStudentCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage("This browser does not support camera access.");
      return;
    }

    try {
      // Request access from a button click. This temporary stream only reveals
      // device labels; the shared source manager opens the actual chosen camera.
      const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      permissionStream.getTracks().forEach((track) => track.stop());
      setCameraPermissionReady(true);
      const devices = await refreshCameraDevices();
      if (devices[0]) setStudentCameraId(devices[0].deviceId);
    } catch (error) {
      setCameraMessage(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Camera permission was denied. Allow access in the browser, then try again."
        : "The camera could not be opened. Check that it is connected and available.");
    }
  }

  useEffect(() => {
    if (!cameraPermissionReady || !navigator.mediaDevices) return;
    const onDeviceChange = () => void refreshCameraDevices();
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
  }, [cameraPermissionReady]);

  function enterLesson() {
    setInMeeting(true);
    if (lesson.roomId) lesson.enterRoom();
    else lesson.joinRoom(roomId);
  }

  function exitLesson() {
    setInMeeting(false);
    setStudentCameraId(null);
    lesson.exitRoom();
  }

  const faceMid = lesson.videoRoleState.face;
  const documentMid = lesson.videoRoleState.document;
  const rolesShareTrack = Boolean(faceMid && faceMid === documentMid);
  const faceStream = faceMid ? lesson.remoteVideoStreams[faceMid] ?? null : null;
  const documentStream = documentMid ? lesson.remoteVideoStreams[documentMid] ?? null : null;
  const localCamera = studentCameraId ? studentPreview.sources[studentCameraId] : undefined;

  function updateTransform(role: MediaRole, patch: Partial<ViewTransform>) {
    setViewTransforms((current) => {
      const updated = { ...current[role], ...patch };
      const next = { ...current, [role]: updated };
      const pairedRole: MediaRole = role === "face" ? "document" : "face";
      // Both views may point at one received MID. Linking settings keeps the
      // same shared camera readable in both places without transforming media.
      if (applySharedTransform && rolesShareTrack) next[pairedRole] = updated;
      return next;
    });
  }

  function updateOutgoingTransform(patch: Partial<ViewTransform>) {
    setOutgoingTransforms((current) => ({ face: { ...current.face, ...patch }, document: current.document }));
  }

  const viewSettings = (
    <div className="meeting-view-settings">
      <fieldset>
        <legend>Your camera</legend>
        {cameraPermissionReady && cameraDevices.length > 0 ? (
          <label>
            Camera
            <select aria-label="Camera to share with the teacher" value={studentCameraId ?? ""} onChange={(event) => setStudentCameraId(event.target.value || null)}>
              <option value="">Off</option>
              {cameraDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
            </select>
          </label>
        ) : (
          <button className="meeting-permission-button" type="button" onClick={() => void enableStudentCamera()}>
            Enable my camera
          </button>
        )}
        <label>
          Rotate what you send
          <select value={outgoingTransforms.face.rotation} onChange={(event) => updateOutgoingTransform({ rotation: Number(event.target.value) as ViewTransform["rotation"] })}>
            <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
          </select>
        </label>
        <label className="meeting-settings-check">
          <input type="checkbox" checked={outgoingTransforms.face.mirrored} onChange={(event) => updateOutgoingTransform({ mirrored: event.target.checked })} />
          Mirror what you send
        </label>
        <p className="settings-help-copy">These changes are baked into the video sent to your teacher. Your camera preview shows the same outgoing image.</p>
      </fieldset>
      {(["document", "face"] as const).map((role) => (
        <fieldset key={role}>
          <legend>{role === "document" ? "Document view" : "Teacher face view"}</legend>
          <label>
            Rotate
            <select
              value={viewTransforms[role].rotation}
              onChange={(event) => updateTransform(role, { rotation: Number(event.target.value) as ViewTransform["rotation"] })}
            >
              <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
            </select>
          </label>
          <label className="meeting-settings-check">
            <input type="checkbox" checked={viewTransforms[role].mirrored} onChange={(event) => updateTransform(role, { mirrored: event.target.checked })} />
            Mirror
          </label>
          {role === "document" && (
            <label>
              Zoom
              <select value={documentZoom} onChange={(event) => setDocumentZoom(Number(event.target.value))}>
                <option value={1}>100%</option><option value={1.2}>120%</option><option value={1.4}>140%</option>
              </select>
            </label>
          )}
        </fieldset>
      ))}
      {rolesShareTrack && (
        <label className="meeting-settings-check shared-transform-toggle">
          <input type="checkbox" checked={applySharedTransform} onChange={(event) => setApplySharedTransform(event.target.checked)} />
          Apply rotation and mirroring to both views when they share one camera
        </label>
      )}
    </div>
  );

  if (inMeeting) {
    return (
      <MeetingRoom
        role="student"
        getLocalAudioTracks={lesson.getLocalAudioTracks}
        lessonTiming={lesson.lessonTiming}
        roomId={roomId}
        connectionState={lesson.status}
        connectionStatus={lesson.statusMessage}
        mainVideo={documentStream}
        localFaceVideo={studentCameraId ? lesson.outgoingVideoStreams[studentCameraId] ?? localCamera?.stream ?? null : null}
        remoteFaceVideo={faceStream}
        remoteAudio={lesson.remoteStream}
        microphoneEnabled={lesson.audioEnabled}
        remoteMicrophoneEnabled={lesson.remoteAudioEnabled}
        qualitySamples={lesson.qualitySamples}
        audioError={lesson.audioError}
        videoError={lesson.videoError}
        mainRotation={viewTransforms.document.rotation}
        mainMirrored={viewTransforms.document.mirrored}
        mainZoom={documentZoom}
        remoteFaceRotation={viewTransforms.face.rotation}
        remoteFaceMirrored={viewTransforms.face.mirrored}
        viewSettings={viewSettings}
        participantName={lesson.participantName}
        remoteParticipantName={lesson.remoteParticipantName}
        onNameChange={lesson.setParticipantName}
        generalSettings={<div className="meeting-view-settings"><MicrophoneSettings inputs={audioInputs} enabled={lesson.audioEnabled} processing={audioProcessing} onChange={setAudioProcessing} /></div>}
        onToggleMicrophone={() => lesson.setAudioEnabled(!lesson.audioEnabled)}
        onDisconnect={exitLesson}
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
          <span className={`status-dot ${lesson.signalingReady ? "status-ready" : ""}`} />
          {lesson.signalingReady ? "Lesson service ready" : "Connecting…"}
        </span>
      </header>

      <section className="hero lesson-page student-lobby" aria-labelledby="student-title">
        <div className="eyebrow"><span /> STUDENT LOBBY</div>
        <h1 id="student-title">Join your<br /><em>lesson.</em></h1>
        <p className="intro">Check your camera, then connect to your teacher.</p>
        <AccountControls />
        {!account && identityConfigured && <button className="secondary-button" type="button" onClick={() => {
          const target = new URL(location.href); target.searchParams.delete("guest");
          history.replaceState(null, "", target.pathname + target.search);
          void signIn()?.catch(() => setCameraMessage("Sign-in could not be started. Please try again."));
        }}>Sign in for recordings</button>}
        {account && <button className="text-button" type="button" onClick={() => {
          const target = new URL(location.href); target.searchParams.set("guest", "1"); location.assign(target.href);
        }}>Continue as guest</button>}
        <RecordingsLibrary />
        <DisplayNameInput name={lesson.participantName} onChange={lesson.setParticipantName} />

        <section className="lesson-card student-lobby-card" aria-live="polite">
          <span className="camera-role-label">ROOM {roomId.slice(0, 8).toUpperCase()}</span>
          <h2>{lesson.status === "joining" ? "Connecting…" : "Ready to join?"}</h2>
          <p>{lesson.statusMessage}</p>

          <section className="student-self-view" aria-labelledby="student-self-view-title">
            <div className="student-self-heading">
              <div>
                <span className="camera-role-label">YOUR CAMERA</span>
                <h3 id="student-self-view-title">Share one face view with your teacher</h3>
              </div>
              {cameraPermissionReady && cameraDevices.length > 0 && (
                <select aria-label="Camera to share with the teacher" value={studentCameraId ?? ""} onChange={(event) => setStudentCameraId(event.target.value || null)}>
                  <option value="">Video off</option>
                  {cameraDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
                </select>
              )}
            </div>
            <CameraPreview
              square
              label="Your camera"
              stream={localCamera?.stream ?? null}
              message={studentCameraId ? localCamera?.error ?? "Starting camera…" : "Your camera is off. You can still join and watch."}
              active={Boolean(studentCameraId && localCamera?.stream && !localCamera.error)}
            />
            {!cameraPermissionReady && <button className="secondary-button student-camera-enable" type="button" onClick={() => void enableStudentCamera()}>Enable my camera</button>}
            {cameraMessage && <p className="error-copy" role="status">{cameraMessage}</p>}
            {lesson.videoError && <p className="error-copy" role="alert">{lesson.videoError}</p>}
          </section>

          {(lesson.status === "ready" || lesson.status === "failed" || lesson.roomId) && lesson.status !== "closed" && (
            <button className="primary-button lesson-action" type="button" onClick={enterLesson} disabled={!lesson.signalingReady}>Join lesson</button>
          )}
          {(lesson.status === "failed" || lesson.status === "closed") && <a className="text-button leave-button" href="/">Back to Live Lesson Lab</a>}
        </section>
        <p className="privacy-note">Your camera and microphone stay off until you turn them on.</p>
      </section>

      <footer className="footer">
        <span>Made for learning, conversation, and curiosity.</span>
        <span className="footer-mark">LIVE LESSON LAB <span>·</span> 2026</span>
      </footer>
    </main>
  );
}
