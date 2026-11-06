import { useCallback, useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION } from "@live-lesson-lab/shared";
import type { ClientMessage, IceCandidatePayload, MediaRole, ParticipantRole, ServerMessage, VideoRoleState } from "@live-lesson-lab/shared";
import { summarizeMediaQuality, type MediaQualitySample, type PreviousMediaStats } from "./MediaQuality";
import { cameraSourceManager } from "./CameraSourceManager";
import { OutgoingVideoTransform, type VideoTransform } from "./OutgoingVideoTransform";
import { getIdentityToken } from "../auth/identity";

export type VideoSelections = Record<MediaRole, string | null>;
export type OutgoingVideoTransforms = Record<MediaRole, VideoTransform>;
export type DocumentScreenSource = {
  stream: MediaStream;
  onFailure: (message: string) => void;
};
export type AudioProcessingSettings = {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
};

export const defaultAudioProcessingSettings: AudioProcessingSettings = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};

export type LessonStatus = "connecting" | "ready" | "joining" | "waiting" | "connecting-peer" | "connected" | "disconnected" | "closed" | "failed";

function parseServerMessage(payload: string): ServerMessage | null {
  try {
    const message: unknown = JSON.parse(payload);
    if (typeof message !== "object" || message === null || !("type" in message)) return null;
    const candidate = message as Record<string, unknown>;

    switch (candidate.type) {
      case "authenticated": return { type: "authenticated" };
      case "authentication-error": return typeof candidate.message === "string" ? { type: "authentication-error", message: candidate.message } : null;
      case "room-access":
        return typeof candidate.roomId === "string" && typeof candidate.locked === "boolean"
          && typeof candidate.joinExpiresAt === "number" && Number.isFinite(candidate.joinExpiresAt)
          ? { type: "room-access", roomId: candidate.roomId, locked: candidate.locked, joinExpiresAt: candidate.joinExpiresAt } : null;
      case "server-ready":
        return typeof candidate.protocolVersion === "number"
          ? { type: "server-ready", protocolVersion: candidate.protocolVersion as typeof PROTOCOL_VERSION, authenticationRequired: candidate.authenticationRequired === true }
          : null;
      case "room-created":
      case "room-joined":
      case "room-entered":
      case "room-exited":
      case "peer-joined":
      case "peer-left":
        return typeof candidate.roomId === "string" ? { type: candidate.type, roomId: candidate.roomId } : null;
      case "room-closed":
        return typeof candidate.roomId === "string" && typeof candidate.reason === "string"
          ? { type: candidate.type, roomId: candidate.roomId, reason: candidate.reason }
          : null;
      case "room-error":
        return typeof candidate.message === "string" ? { type: candidate.type, message: candidate.message } : null;
      case "offer":
      case "answer":
        return typeof candidate.roomId === "string" && typeof candidate.sdp === "string"
          ? { type: candidate.type, roomId: candidate.roomId, sdp: candidate.sdp }
          : null;
      case "ice-candidate": {
        const ice = candidate.candidate;
        if (typeof candidate.roomId !== "string" || typeof ice !== "object" || ice === null) return null;
        const item = ice as Record<string, unknown>;
        if (typeof item.candidate !== "string") return null;
        return {
          type: candidate.type,
          roomId: candidate.roomId,
          candidate: {
            candidate: item.candidate,
            sdpMid: typeof item.sdpMid === "string" ? item.sdpMid : null,
            sdpMLineIndex: typeof item.sdpMLineIndex === "number" ? item.sdpMLineIndex : null,
            ...(typeof item.usernameFragment === "string" ? { usernameFragment: item.usernameFragment } : {})
          }
        };
      }
      case "audio-state":
        return typeof candidate.roomId === "string" && typeof candidate.enabled === "boolean"
          ? { type: candidate.type, roomId: candidate.roomId, enabled: candidate.enabled }
          : null;
      case "video-role-state": {
        const roles = candidate.roles;
        if (typeof candidate.roomId !== "string" || typeof roles !== "object" || roles === null) return null;
        const mapping = roles as Record<string, unknown>;
        if ((typeof mapping.face !== "string" && mapping.face !== null)
          || (typeof mapping.document !== "string" && mapping.document !== null)) return null;
        return {
          type: candidate.type,
          roomId: candidate.roomId,
          roles: { face: mapping.face, document: mapping.document } as VideoRoleState
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function describeTransceivers(peerConnection: RTCPeerConnection) {
  return peerConnection.getTransceivers().map((transceiver) => ({
    mid: transceiver.mid,
    kind: transceiver.receiver.track.kind,
    direction: transceiver.direction,
    currentDirection: transceiver.currentDirection,
    senderTrackState: transceiver.sender.track?.readyState ?? "no sender track"
  }));
}

/** Owns one lesson's signaling socket, WebRTC peer, and local microphone. */
export function useLessonSession(
  role: ParticipantRole,
  videoSelections: VideoSelections = { face: null, document: null },
  studentVideoDeviceId: string | null = null,
  outgoingTransforms: OutgoingVideoTransforms = {
    face: { rotation: 0, mirrored: false },
    document: { rotation: 0, mirrored: false }
  },
  microphoneDeviceId = "",
  audioProcessing = defaultAudioProcessingSettings,
  documentScreen: DocumentScreenSource | null = null
) {
  const [qualitySamples, setQualitySamples] = useState<MediaQualitySample[]>([]);
  const [signalingReady, setSignalingReady] = useState(false);
  const [status, setStatus] = useState<LessonStatus>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to the lesson service…");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomAccess, setRoomAccess] = useState<{ locked: boolean; joinExpiresAt: number } | null>(null);
  const membershipConfirmedRef = useRef(false);
  const [audioEnabled, setAudioEnabledState] = useState(false);
  const [remoteAudioEnabled, setRemoteAudioEnabled] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Record<string, MediaStream>>({});
  const [videoRoleState, setVideoRoleState] = useState<VideoRoleState>({ face: null, document: null });
  const [remoteStudentVideoStream, setRemoteStudentVideoStream] = useState<MediaStream | null>(null);
  const [videoError, setVideoError] = useState("");
  const [outgoingVideoStreams, setOutgoingVideoStreams] = useState<Record<string, MediaStream>>({});

  const socketRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const audioTransceiverRef = useRef<RTCRtpTransceiver | null>(null);
  const studentVideoTransceiverRef = useRef<RTCRtpTransceiver | null>(null);
  const videoTransceiversRef = useRef<RTCRtpTransceiver[]>([]);
  const videoLeasesRef = useRef(new Map<string, ReturnType<typeof cameraSourceManager.acquire>>());
  const outgoingTransformsRef = useRef(outgoingTransforms);
  const outgoingProcessorsRef = useRef(new Map<string, { sourceTrack: MediaStreamTrack; processor: OutgoingVideoTransform }>());
  const videoSelectionsRef = useRef(videoSelections);
  const documentScreenRef = useRef(documentScreen);
  const videoSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const studentVideoDeviceIdRef = useRef(studentVideoDeviceId);
  const studentVideoLeaseRef = useRef<{ deviceId: string; lease: ReturnType<typeof cameraSourceManager.acquire> } | null>(null);
  const studentVideoSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const roomIdRef = useRef<string | null>(null);
  const audioEnabledRef = useRef(false);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const localAudioCaptureKeyRef = useRef("");
  const localAudioDeviceIdRef = useRef("");
  const audioGenerationRef = useRef(0);
  const microphoneDeviceIdRef = useRef(microphoneDeviceId);
  const audioProcessingRef = useRef(audioProcessing);
  const audioApplyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const activeRef = useRef(true);
  const teacherOfferInFlightRef = useRef(false);
  videoSelectionsRef.current = videoSelections;
  documentScreenRef.current = documentScreen;
  studentVideoDeviceIdRef.current = studentVideoDeviceId;
  outgoingTransformsRef.current = outgoingTransforms;
  microphoneDeviceIdRef.current = microphoneDeviceId;
  audioProcessingRef.current = audioProcessing;

  const getOutgoingTrack = useCallback((deviceId: string, sourceTrack: MediaStreamTrack, transform: VideoTransform) => {
    const current = outgoingProcessorsRef.current.get(deviceId);
    // A neutral camera goes directly to WebRTC. Canvas is only needed when
    // changing pixels; bypassing it preserves detail and reduces CPU contention.
    if (transform.rotation === 0 && !transform.mirrored) {
      current?.processor.stop();
      outgoingProcessorsRef.current.delete(deviceId);
      setOutgoingVideoStreams((streams) => ({ ...streams, [deviceId]: new MediaStream([sourceTrack]) }));
      return sourceTrack;
    }
    if (current && current.sourceTrack === sourceTrack && current.sourceTrack.readyState === "live") {
      current.processor.update(transform);
      return current.processor.track;
    }
    current?.processor.stop();
    const processor = new OutgoingVideoTransform(sourceTrack, transform);
    outgoingProcessorsRef.current.set(deviceId, { sourceTrack, processor });
    setOutgoingVideoStreams((streams) => ({ ...streams, [deviceId]: processor.stream }));
    return processor.track;
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    else setStatusMessage("The lesson service is not connected. Try again in a moment.");
  }, []);

  const stopLocalAudio = useCallback(() => {
    stopStream(localAudioStreamRef.current);
    localAudioStreamRef.current = null;
    localAudioCaptureKeyRef.current = "";
    audioGenerationRef.current += 1;
  }, []);

  const closePeerConnection = useCallback(() => {
    audioEnabledRef.current = false;
    setAudioEnabledState(false);
    const peerConnection = peerConnectionRef.current;
    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
    }
    peerConnectionRef.current = null;
    audioTransceiverRef.current = null;
    studentVideoTransceiverRef.current = null;
    videoTransceiversRef.current = [];
    for (const lease of videoLeasesRef.current.values()) lease.release();
    videoLeasesRef.current.clear();
    for (const { processor } of outgoingProcessorsRef.current.values()) processor.stop();
    outgoingProcessorsRef.current.clear();
    setOutgoingVideoStreams({});
    studentVideoLeaseRef.current?.lease.release();
    studentVideoLeaseRef.current = null;
    pendingCandidatesRef.current = [];
    remoteStreamRef.current = null;
    setRemoteStream(null);
    setQualitySamples([]);
    setRemoteAudioEnabled(false);
    setRemoteVideoStreams({});
    setVideoRoleState({ face: null, document: null });
    setRemoteStudentVideoStream(null);
    stopLocalAudio();
  }, [stopLocalAudio]);

  const createPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) return peerConnectionRef.current;

    // STUN helps the browsers discover a direct network route. TURN can be
    // added later for networks that block direct peer-to-peer connectivity.
    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    peerConnectionRef.current = peerConnection;

    if (role === "teacher") {
      // The teacher creates the offer, so it defines four ordered media
      // sections: audio, face video, document video, and student video.
      audioTransceiverRef.current = peerConnection.addTransceiver("audio", {
        direction: "sendrecv"
      });
      videoTransceiversRef.current = [0, 1].map(() => peerConnection.addTransceiver("video", {
        direction: "sendonly"
      }));
      studentVideoTransceiverRef.current = peerConnection.addTransceiver("video", {
        direction: "recvonly"
      });
    }

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !roomIdRef.current) return;
      const candidate = event.candidate.toJSON() as IceCandidatePayload;
      send({ type: "ice-candidate", roomId: roomIdRef.current, candidate });
    };

    peerConnection.ontrack = (event) => {
      if (event.track.kind === "video") {
        const mid = event.transceiver.mid;
        const stream = new MediaStream([event.track]);
        const studentVideoMid = studentVideoTransceiverRef.current?.mid;
        // In this one-teacher/one-student protocol, the teacher only receives
        // one video role: the student's camera. The teacher's own face and
        // document sections are sendonly, so routing by participant role is
        // more reliable than guessing which transceiver object the browser
        // returns for the negotiated m-line.
        const isStudentVideo = role === "teacher";
        console.info("[Live Lesson Lab] Received a remote video track", {
          role,
          mid,
          expectedStudentVideoMid: studentVideoMid,
          isStudentVideo,
          readyState: event.track.readyState,
          muted: event.track.muted
        });
        if (isStudentVideo) {
          const showStudentVideo = () => {
            if (peerConnectionRef.current === peerConnection) setRemoteStudentVideoStream(stream);
          };
          const hideStudentVideo = () => {
            if (peerConnectionRef.current === peerConnection) setRemoteStudentVideoStream(null);
          };
          // A negotiated receiver exists even when the student has no camera.
          // Show it only after media starts, and restore the placeholder when
          // the receiver reports a pause instead of claiming a blank tile is live.
          event.track.addEventListener("unmute", showStudentVideo);
          event.track.addEventListener("mute", hideStudentVideo);
          event.track.addEventListener("ended", hideStudentVideo);
          if (!event.track.muted) showStudentVideo();
          return;
        }
        if (mid) {
          // One stream per negotiated media section. Two logical roles can
          // point to the same MID, so the receiver can reuse this same stream.
          const showTeacherVideo = () => setRemoteVideoStreams((current) => ({ ...current, [mid]: stream }));
          const hideTeacherVideo = () => setRemoteVideoStreams((current) => {
            const next = { ...current };
            delete next[mid];
            return next;
          });
          event.track.addEventListener("unmute", showTeacherVideo);
          event.track.addEventListener("mute", hideTeacherVideo);
          if (!event.track.muted) showTeacherVideo();
        } else {
          console.warn("[Live Lesson Lab] Remote video track has no negotiated MID yet.");
        }
        return;
      }
      console.info("[Live Lesson Lab] Received a remote audio track", {
        role,
        readyState: event.track.readyState,
        muted: event.track.muted
      });
      const stream = event.streams[0] ?? remoteStreamRef.current ?? new MediaStream();
      if (event.streams.length === 0 && !stream.getTracks().includes(event.track)) stream.addTrack(event.track);
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
    };

    peerConnection.onconnectionstatechange = () => {
      if (!activeRef.current) return;
      console.info("[Live Lesson Lab] Peer connection state", {
        role,
        connectionState: peerConnection.connectionState,
        iceConnectionState: peerConnection.iceConnectionState,
        signalingState: peerConnection.signalingState
      });
      if (peerConnection.connectionState === "connected") {
        setStatus("connected");
        setStatusMessage("The lesson connection is live.");
      } else if (peerConnection.connectionState === "disconnected") {
        setStatus("disconnected");
        setStatusMessage("The connection was interrupted. Waiting for it to recover…");
      } else if (peerConnection.connectionState === "failed") {
        setStatus("failed");
        setStatusMessage("A direct connection could not be established. This network may need a TURN relay.");
      }
    };

    return peerConnection;
  }, [role, send]);

  const bindStudentTransceivers = useCallback((peerConnection: RTCPeerConnection) => {
    if (role !== "student") return;

    // The student lets setRemoteDescription create matching transceivers from
    // the teacher's offer. Pre-adding local transceivers leaves them without
    // MIDs, while the browser creates a second, actually negotiated set.
    const byMid = new Map<string, RTCRtpTransceiver>();
    for (const transceiver of peerConnection.getTransceivers()) {
      if (transceiver.mid !== null) byMid.set(transceiver.mid, transceiver);
    }

    // The teacher creates media sections in this fixed order: audio (0),
    // teacher face (1), teacher document (2), and student camera (3).
    const audio = byMid.get("0");
    const teacherFace = byMid.get("1");
    const teacherDocument = byMid.get("2");
    const studentVideo = byMid.get("3");
    if (!audio || !teacherFace || !teacherDocument || !studentVideo) {
      throw new Error("The teacher offer did not include the expected audio and video sections.");
    }

    // A transceiver created from a remote offer defaults to receive-only.
    // Set the local answer directions explicitly for the student's mic and camera.
    audio.direction = "sendrecv";
    teacherFace.direction = "recvonly";
    teacherDocument.direction = "recvonly";
    studentVideo.direction = "sendonly";
    audioTransceiverRef.current = audio;
    videoTransceiversRef.current = [teacherFace, teacherDocument];
    studentVideoTransceiverRef.current = studentVideo;
  }, [role]);

  const syncTeacherVideoSources = useCallback(() => {
    const peerConnection = peerConnectionRef.current;
    if (role !== "teacher" || !peerConnection) return Promise.resolve();

    // Serialize source swaps. If the user changes selections while a camera
    // permission request is pending, the queued pass reads the newest choice.
    const task = videoSyncQueueRef.current.then(async () => {
      const currentPeer = peerConnectionRef.current;
      if (!currentPeer || currentPeer !== peerConnection) return;
      const screen = documentScreenRef.current;
      // Enforce screen-versus-document exclusivity here as well as in the UI;
      // a caller must never accidentally request three teacher video sources.
      const selections = { ...videoSelectionsRef.current, document: screen ? null : videoSelectionsRef.current.document };
      const uniqueIds = [...new Set([selections.face, selections.document].filter((id): id is string => Boolean(id)))].slice(0, 2);

      for (const deviceId of uniqueIds) {
        if (!videoLeasesRef.current.has(deviceId)) {
          videoLeasesRef.current.set(deviceId, cameraSourceManager.acquire(deviceId));
        }
      }

      let captureFailed = false;
      const tracks = new Map<string, MediaStreamTrack>();
      for (const deviceId of uniqueIds) {
        const lease = videoLeasesRef.current.get(deviceId);
        if (!lease) continue;
        try {
          const stream = await lease.stream;
          if (peerConnectionRef.current !== peerConnection) return;
          const track = stream.getVideoTracks()[0];
          if (!track) throw new Error("The selected camera returned no video track.");
          // One camera source produces one processed track. If both teacher
          // roles share the device, the role controls are linked and share it.
          const transformRole = deviceId === selections.face ? "face" : "document";
          const transform = outgoingTransformsRef.current[transformRole];
          const outgoingTrack = getOutgoingTrack(deviceId, track, transform);
          // Shared face/document sources prioritize readable handwriting.
          outgoingTrack.contentHint = deviceId === selections.document ? "detail" : "motion";
          tracks.set(deviceId, outgoingTrack);
        } catch {
          captureFailed = true;
          lease.release();
          videoLeasesRef.current.delete(deviceId);
          setVideoError("A selected camera could not be shared. Choose another camera or turn this view off.");
        }
      }

      if (peerConnectionRef.current !== peerConnection) return;
      const slotIds = uniqueIds.filter((deviceId) => tracks.has(deviceId));
      // Display capture has its own owner and is never a fake camera device ID.
      // Camera slots remain deduplicated; a screen uses the next available slot.
      const outgoingTracks = slotIds.map((deviceId) => tracks.get(deviceId)!);
      const screenTrack = screen?.stream.getVideoTracks()[0];
      const screenSlot = screenTrack ? outgoingTracks.length : -1;
      if (screenTrack) outgoingTracks.push(screenTrack);
      try {
        for (let slot = 0; slot < videoTransceiversRef.current.length; slot += 1) {
          await videoTransceiversRef.current[slot].sender.replaceTrack(outgoingTracks[slot] ?? null);
        }
      } catch {
        if (screen && documentScreenRef.current?.stream === screen.stream) {
          screen.onFailure("This screen could not be attached to the lesson. Your document camera will be restored.");
        }
        setVideoError("The camera track could not be attached to the lesson. Try selecting the camera again.");
        return;
      }

      if (!captureFailed) setVideoError("");
      // The new track is attached before old camera leases are released, so
      // changing devices never creates a gap where the old source is stopped too early.
      for (const [deviceId, lease] of videoLeasesRef.current) {
        if (!uniqueIds.includes(deviceId)) {
          lease.release();
          videoLeasesRef.current.delete(deviceId);
        }
      }
      for (const [deviceId, entry] of outgoingProcessorsRef.current) {
        if (!uniqueIds.includes(deviceId)) {
          entry.processor.stop();
          outgoingProcessorsRef.current.delete(deviceId);
          setOutgoingVideoStreams((streams) => {
            const next = { ...streams };
            delete next[deviceId];
            return next;
          });
        }
      }

      const midForDevice = new Map(slotIds.map((deviceId, index) => [deviceId, videoTransceiversRef.current[index]?.mid ?? null]));
      const roles: VideoRoleState = {
        face: selections.face ? midForDevice.get(selections.face) ?? null : null,
        document: screenSlot >= 0 ? videoTransceiversRef.current[screenSlot]?.mid ?? null
          : selections.document ? midForDevice.get(selections.document) ?? null : null
      };
      if (roomIdRef.current && peerConnection.localDescription) {
        send({ type: "video-role-state", roomId: roomIdRef.current, roles });
      }
    });
    videoSyncQueueRef.current = task.catch(() => undefined);
    return task;
  }, [getOutgoingTrack, role, send]);

  const syncStudentVideoSource = useCallback(() => {
    const peerConnection = peerConnectionRef.current;
    if (role !== "student" || !peerConnection || !studentVideoTransceiverRef.current) return Promise.resolve();

    // The queue prevents two quick picker changes from racing to replace the
    // same sender. Each pass reads the newest device ID when it starts.
    const task = studentVideoSyncQueueRef.current.then(async () => {
      if (peerConnectionRef.current !== peerConnection) return;
      const requestedDeviceId = studentVideoDeviceIdRef.current;
      let nextLease = studentVideoLeaseRef.current;

      if (requestedDeviceId && nextLease?.deviceId !== requestedDeviceId) {
        nextLease = { deviceId: requestedDeviceId, lease: cameraSourceManager.acquire(requestedDeviceId) };
      }

      let nextTrack: MediaStreamTrack | null = null;
      if (requestedDeviceId && nextLease) {
        try {
          const stream = await nextLease.lease.stream;
          if (peerConnectionRef.current !== peerConnection) {
            nextLease.lease.release();
            return;
          }
          const sourceTrack = stream.getVideoTracks()[0] ?? null;
          if (!sourceTrack) throw new Error("The selected camera returned no video track.");
          nextTrack = getOutgoingTrack(requestedDeviceId, sourceTrack, outgoingTransformsRef.current.face);
          nextTrack.contentHint = "motion";
        } catch {
          if (nextLease !== studentVideoLeaseRef.current) nextLease.lease.release();
          setVideoError("Your selected camera could not be shared. Choose another camera or turn your video off.");
          return;
        }
      }

      if (peerConnectionRef.current !== peerConnection) {
        if (nextLease && nextLease !== studentVideoLeaseRef.current) nextLease.lease.release();
        return;
      }

      try {
        // This sender was negotiated in the original offer, so enabling or
        // replacing the student's camera does not require renegotiation.
        await studentVideoTransceiverRef.current?.sender.replaceTrack(nextTrack);
        if (nextTrack) {
          console.info("[Live Lesson Lab] Attached the student's camera to WebRTC", {
            mid: studentVideoTransceiverRef.current?.mid,
            readyState: nextTrack.readyState,
            enabled: nextTrack.enabled
          });
        }
      } catch {
        if (nextLease && nextLease !== studentVideoLeaseRef.current) nextLease.lease.release();
        setVideoError("Your camera could not be attached to the lesson. Try selecting it again.");
        return;
      }

      const previousLease = studentVideoLeaseRef.current;
      studentVideoLeaseRef.current = requestedDeviceId && nextLease ? nextLease : null;
      if (previousLease && previousLease !== studentVideoLeaseRef.current) previousLease.lease.release();
      if (previousLease && previousLease.deviceId !== requestedDeviceId) {
        const previousProcessor = outgoingProcessorsRef.current.get(previousLease.deviceId);
        previousProcessor?.processor.stop();
        outgoingProcessorsRef.current.delete(previousLease.deviceId);
        setOutgoingVideoStreams((streams) => {
          const next = { ...streams };
          delete next[previousLease.deviceId];
          return next;
        });
      }
      setVideoError("");
    });

    studentVideoSyncQueueRef.current = task.catch(() => undefined);
    return task;
  }, [getOutgoingTrack, role]);

  useEffect(() => {
    if (role === "student" && peerConnectionRef.current) void syncStudentVideoSource();
  }, [role, studentVideoDeviceId, outgoingTransforms.face.rotation, outgoingTransforms.face.mirrored, syncStudentVideoSource]);

  useEffect(() => {
    if (role === "teacher" && peerConnectionRef.current) void syncTeacherVideoSources();
  }, [role, syncTeacherVideoSources, videoSelections.face, videoSelections.document, documentScreen?.stream, outgoingTransforms.face.rotation, outgoingTransforms.face.mirrored, outgoingTransforms.document.rotation, outgoingTransforms.document.mirrored]);

  const getMicrophoneStream = useCallback(async () => {
    const generation = audioGenerationRef.current;
    while (activeRef.current && audioEnabledRef.current && generation === audioGenerationRef.current) {
      const deviceId = microphoneDeviceIdRef.current;
      const processing = { ...audioProcessingRef.current };
      const captureKey = JSON.stringify([deviceId, processing]);
      const previous = localAudioStreamRef.current;
      const previousTrack = previous?.getAudioTracks()[0];
      const constraints: MediaTrackConstraints = {
        ...processing,
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 }
      };
      // Processing changes on the same live microphone do not need a second
      // capture. Keep the sender attached while the browser applies constraints.
      const sameDevice = previousTrack?.readyState === "live"
        && localAudioDeviceIdRef.current === deviceId;
      let stream: MediaStream;
      if (sameDevice && previous) {
        if (localAudioCaptureKeyRef.current !== captureKey) await previousTrack.applyConstraints(constraints);
        stream = previous;
        // Some browsers resolve applyConstraints without changing processing.
        // Inspect reported settings and reopen only when a requested value was
        // ignored. Chromium can reuse processing from a still-live capture of
        // the same device, so release that capture before reopening it. This
        // intentionally creates a short audio gap only when changing settings.
        const effective = previousTrack.getSettings();
        if ((Object.keys(processing) as (keyof AudioProcessingSettings)[])
          .some((key) => typeof effective[key] === "boolean" && effective[key] !== processing[key])) {
          stopStream(previous);
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { ...constraints, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, video: false
          });
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { ...constraints, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, video: false
        });
      }
      // Permission dialogs cannot be cancelled. Stop a late result when the
      // user has muted, left, or moved to a new peer connection in the meantime.
      if (!activeRef.current || !audioEnabledRef.current || generation !== audioGenerationRef.current) {
        stopStream(stream);
        throw new DOMException("Microphone request is no longer current.", "AbortError");
      }
      if (deviceId !== microphoneDeviceIdRef.current || captureKey !== JSON.stringify([deviceId, audioProcessingRef.current])) {
        if (stream !== previous) stopStream(stream);
        continue;
      }
      localAudioStreamRef.current = stream;
      localAudioCaptureKeyRef.current = captureKey;
      localAudioDeviceIdRef.current = deviceId;
      const track = stream.getAudioTracks()[0];
      if (track) track.contentHint = "speech";
      return stream;
    }
    throw new DOMException("Microphone request was cancelled.", "AbortError");
  }, []);

  const applyLocalAudio = useCallback((enabled: boolean) => {
    // Replacements are serialized so rapid device changes cannot let an older
    // getUserMedia request overwrite the microphone selected most recently.
    const operation = audioApplyQueueRef.current.then(async () => {
      const transceiver = audioTransceiverRef.current;
      const peer = peerConnectionRef.current;
      if (!transceiver || !peer) return;

      if (!enabled) {
        await transceiver.sender.replaceTrack(null);
        stopLocalAudio();
        if (roomIdRef.current) send({ type: "audio-state", roomId: roomIdRef.current, enabled: false });
        return;
      }

      if (!audioEnabledRef.current) return;
      try {
        setAudioError("");
        const previousStream = localAudioStreamRef.current;
        const stream = await getMicrophoneStream();
        if (!audioEnabledRef.current || peerConnectionRef.current !== peer) {
          if (stream !== previousStream) stopStream(stream);
          return;
        }
        const track = stream.getAudioTracks()[0];
        if (!track) throw new Error("No microphone track was returned by the browser.");
        await transceiver.sender.replaceTrack(track);
        if (previousStream && previousStream !== stream) stopStream(previousStream);
        const effective = track.getSettings();
        const requested = audioProcessingRef.current;
        if ((Object.keys(requested) as (keyof AudioProcessingSettings)[])
          .some((key) => typeof effective[key] === "boolean" && effective[key] !== requested[key])) {
          setAudioError("The browser kept different microphone processing settings. Another tab may be sharing this microphone. Turn its microphone off, then retry your settings.");
        }
        if (roomIdRef.current) send({ type: "audio-state", roomId: roomIdRef.current, enabled: true });
      } catch (error) {
        if (peerConnectionRef.current !== peer || (error instanceof DOMException && error.name === "AbortError")) return;
        audioEnabledRef.current = false;
        setAudioEnabledState(false);
        setAudioError("Microphone access failed. Check browser permissions, then try again.");
        stopLocalAudio();
        if (roomIdRef.current) send({ type: "audio-state", roomId: roomIdRef.current, enabled: false });
      }
    });
    audioApplyQueueRef.current = operation.catch(() => undefined);
    return operation;
  }, [getMicrophoneStream, send, stopLocalAudio]);

  useEffect(() => {
    if (audioEnabledRef.current && audioTransceiverRef.current) void applyLocalAudio(true);
  }, [microphoneDeviceId, audioProcessing.echoCancellation, audioProcessing.noiseSuppression, audioProcessing.autoGainControl, applyLocalAudio]);

  useEffect(() => {
    if (status !== "connected") return;
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection) return;

    const previous: PreviousMediaStats = new Map();
    let sampling = false;
    let disposed = false;
    const sample = async () => {
      if (sampling) return;
      sampling = true;
      try {
        const report = await peerConnection.getStats();
        if (disposed || peerConnectionRef.current !== peerConnection) return;
        const quality = summarizeMediaQuality(report, previous);
        setQualitySamples((samples) => [...samples.slice(-11), quality]);
      } catch {
        // Closing a peer while getStats is pending is a normal lifecycle event.
      } finally {
        sampling = false;
      }
    };
    void sample();
    const timer = window.setInterval(() => void sample(), 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [status]);

  const flushPendingCandidates = useCallback(async (peerConnection: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of queued) await peerConnection.addIceCandidate(candidate);
  }, []);

  const startTeacherOffer = useCallback(async () => {
    const room = roomIdRef.current;
    if (!room || teacherOfferInFlightRef.current) return;
    teacherOfferInFlightRef.current = true;
    try {
      const peerConnection = createPeerConnection();
      setStatus("connecting-peer");
      setStatusMessage("The student joined. Setting up the connection…");
      if (audioEnabledRef.current) await applyLocalAudio(true);
      await syncTeacherVideoSources();

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      console.info("[Live Lesson Lab] Teacher created the offer", describeTransceivers(peerConnection));
      // MID values become available after local description is set.
      await syncTeacherVideoSources();
      send({ type: "offer", roomId: room, sdp: offer.sdp ?? "" });
    } finally { teacherOfferInFlightRef.current = false; }
  }, [applyLocalAudio, createPeerConnection, send, syncTeacherVideoSources]);

  const handleOffer = useCallback(async (message: Extract<ServerMessage, { type: "offer" }>) => {
    const peerConnection = createPeerConnection();
    await peerConnection.setRemoteDescription({ type: "offer", sdp: message.sdp });
    if (role === "student") bindStudentTransceivers(peerConnection);
    // The student microphone transceiver does not exist until the remote
    // offer has created it, so an already-enabled mic is attached afterward.
    if (audioEnabledRef.current) await applyLocalAudio(true);
    // Attach the student's camera after applying the teacher's receive section.
    // This ensures the sender is paired with an active negotiated transceiver.
    if (role === "student") await syncStudentVideoSource();
    console.info("[Live Lesson Lab] Student received the offer", describeTransceivers(peerConnection));
    await flushPendingCandidates(peerConnection);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.info("[Live Lesson Lab] Student created the answer", describeTransceivers(peerConnection));
    send({ type: "answer", roomId: message.roomId, sdp: answer.sdp ?? "" });
    setStatus("connecting-peer");
    setStatusMessage("Joined the room. Connecting to the teacher…");
  }, [applyLocalAudio, bindStudentTransceivers, createPeerConnection, flushPendingCandidates, role, send, syncStudentVideoSource]);

  const handleAnswer = useCallback(async (message: Extract<ServerMessage, { type: "answer" }>) => {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription({ type: "answer", sdp: message.sdp });
    console.info("[Live Lesson Lab] Teacher received the answer", describeTransceivers(peerConnection));
    await flushPendingCandidates(peerConnection);
  }, [flushPendingCandidates]);

  const handleCandidate = useCallback(async (message: Extract<ServerMessage, { type: "ice-candidate" }>) => {
    const peerConnection = peerConnectionRef.current;
    const candidate = message.candidate as RTCIceCandidateInit;
    if (!peerConnection?.remoteDescription) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    await peerConnection.addIceCandidate(candidate);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    // In local development the Vite proxy keeps the browser and signaling
    // server on one origin. A hosted static site can instead point directly at
    // the separately deployed WebSocket service through this build-time value.
    const configuredSignalingUrl = import.meta.env.VITE_SIGNALING_URL?.trim();
    const socketUrl = configuredSignalingUrl || `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/signal`;
    let disposed = false;
    let socket: WebSocket | null = null;
    let heartbeatTimer: number | null = null;

    // StrictMode runs an extra setup/cleanup cycle in development. Deferring
    // creation one task lets that discarded cycle cancel before opening a
    // socket, avoiding a noisy close-while-connecting browser error.
    const connectTimer = window.setTimeout(() => {
      if (disposed) return;
      const activeSocket = new WebSocket(socketUrl);
      let identityAccepted = false;
      socket = activeSocket;
      socketRef.current = activeSocket;

      activeSocket.addEventListener("open", () => {
        if (disposed || socketRef.current !== activeSocket) return;
        setSignalingReady(false);
        setStatusMessage("Verifying your lesson session…");
        // API Gateway completes the WebSocket handshake before the Lambda
        // integration can send data back. This first heartbeat asks the
        // serverless adapter for its versioned `server-ready` message. The
        // local Node server already sends that greeting as soon as it connects.
        const authenticate = async () => {
          try {
            const token = await getIdentityToken();
            if (disposed || activeSocket.readyState !== WebSocket.OPEN) return;
            activeSocket.send(JSON.stringify(token ? { type: "authenticate", token } : { type: "heartbeat" }));
          } catch {
            if (!disposed) window.dispatchEvent(new Event("lesson-auth-expired"));
          }
        };
        void authenticate();
        // A small keepalive helps intermediaries preserve an otherwise quiet
        // signaling socket. Lesson media still flows directly between browsers.
        heartbeatTimer = window.setInterval(() => {
          if (activeSocket.readyState === WebSocket.OPEN) {
            void authenticate();
          }
        }, 5 * 60 * 1000);
      });

      activeSocket.addEventListener("message", (event: MessageEvent<string>) => {
      if (disposed || socketRef.current !== activeSocket) return;
      const message = parseServerMessage(event.data);
      if (!message) {
        setStatusMessage("The lesson service sent an unrecognized message.");
        return;
      }

      if (message.type === "server-ready") {
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          setSignalingReady(false);
          setStatus("failed");
          setStatusMessage("The web app and signaling service use different protocol versions.");
        } else if (!message.authenticationRequired || identityAccepted) {
          setSignalingReady(true);
          if (!roomIdRef.current) { setStatus("ready"); setStatusMessage(identityAccepted ? "Verified and connected to the lesson service." : "Connected to the local lesson service."); }
        }
        return;
      }
      if (message.type === "authenticated") {
        identityAccepted = true;
        // The acknowledgement proves the renewed identity was stored before
        // we refresh room membership. API Gateway messages may run concurrently.
        activeSocket.send(JSON.stringify({ type: "heartbeat" } satisfies ClientMessage));
        return;
      }
      if (message.type === "authentication-error") {
        setSignalingReady(false);
        closePeerConnection();
        window.dispatchEvent(new Event("lesson-auth-expired"));
        return;
      }
      if (message.type === "room-created") {
        membershipConfirmedRef.current = true;
        roomIdRef.current = message.roomId;
        setRoomId(message.roomId);
        setStatus("waiting");
        setStatusMessage("Lesson created. Share the link, then log in to wait for your student.");
        return;
      }
      if (message.type === "room-joined") {
        membershipConfirmedRef.current = true;
        roomIdRef.current = message.roomId;
        setRoomId(message.roomId);
        setStatus("waiting");
        setStatusMessage("Joined the room. Waiting for the teacher…");
        if (role === "student") createPeerConnection();
        return;
      }
      if (message.type === "room-entered") {
        setStatus("waiting");
        setStatusMessage(role === "teacher" ? "You are in the lesson room. Waiting for your student…" : "You are in the lesson room. Waiting for your teacher…");
        return;
      }
      if (message.type === "room-exited") return;
      if (message.type === "peer-joined") {
        if (role === "teacher" && (!peerConnectionRef.current || peerConnectionRef.current.signalingState === "stable")) void startTeacherOffer().catch(() => {
          setStatus("failed");
          setStatusMessage("Could not start the WebRTC connection. Try leaving and creating the room again.");
        });
        return;
      }
      if (message.type === "peer-left") {
        closePeerConnection();
        setStatus("waiting");
        setStatusMessage("The other participant left the lesson room. You can stay here while they return.");
        // Keep the student-side media sections ready so the teacher can offer
        // a fresh peer connection if they re-enter the room.
        if (role === "student" && roomIdRef.current) createPeerConnection();
        return;
      }
      if (message.type === "room-closed") {
        membershipConfirmedRef.current = false;
        setRoomAccess(null);
        closePeerConnection();
        roomIdRef.current = null;
        setRoomId(null);
        setStatus("closed");
        setStatusMessage(message.reason);
        return;
      }
      if (message.type === "room-error") {
        // A denied invitation is not membership. Allow the student to retry
        // join-room after access reopens, rather than sending enter-room.
        if (!membershipConfirmedRef.current) {
          closePeerConnection();
          roomIdRef.current = null;
          setRoomId(null);
        }
        setStatus("failed");
        setStatusMessage(message.message);
        return;
      }
      if (message.type === "room-access") {
        if (message.roomId === roomIdRef.current && role === "teacher") setRoomAccess({ locked: message.locked, joinExpiresAt: message.joinExpiresAt });
        return;
      }
      if (message.type === "audio-state") {
        if (message.roomId === roomIdRef.current) setRemoteAudioEnabled(message.enabled);
        return;
      }

      if (message.type === "video-role-state") {
        if (message.roomId === roomIdRef.current) setVideoRoleState(message.roles);
        return;
      }

      const activeRoom = roomIdRef.current;
      if (message.roomId !== activeRoom) return;
      if (message.type === "offer") void handleOffer(message).catch(() => {
        setStatus("failed");
        setStatusMessage("Could not answer the teacher's WebRTC offer.");
      });
      if (message.type === "answer") void handleAnswer(message).catch(() => {
        setStatus("failed");
        setStatusMessage("Could not complete the WebRTC answer.");
      });
      if (message.type === "ice-candidate") void handleCandidate(message).catch(() => {
        setStatusMessage("A network candidate could not be applied.");
      });
      });

      activeSocket.addEventListener("close", () => {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (disposed || socketRef.current !== activeSocket) return;
      setSignalingReady(false);
      if (roomIdRef.current) {
        closePeerConnection();
        setStatus("disconnected");
        setStatusMessage("The lesson service disconnected.");
      } else {
        setStatus("failed");
        setStatusMessage("Could not connect to the lesson service.");
      }
      });

      activeSocket.addEventListener("error", () => {
      if (disposed || socketRef.current !== activeSocket) return;
      setStatusMessage("A signaling connection error occurred.");
      });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(connectTimer);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      activeRef.current = false;
      audioEnabledRef.current = false;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "leave-room" } satisfies ClientMessage));
      closePeerConnection();
      socket?.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [closePeerConnection, createPeerConnection, handleAnswer, handleCandidate, handleOffer, role, startTeacherOffer]);

  const createRoom = useCallback(() => {
    membershipConfirmedRef.current = false;
    setRoomAccess(null);
    send({ type: "create-room" });
    setStatus("joining");
    setStatusMessage("Creating your lesson room…");
  }, [send]);

  const enterRoom = useCallback((id?: string) => {
    const activeRoomId = id ?? roomIdRef.current;
    if (!activeRoomId) return;
    roomIdRef.current = activeRoomId;
    setRoomId(activeRoomId);
    setStatus("waiting");
    setStatusMessage(role === "teacher" ? "Entering the room. Waiting for your student…" : "Entering the room. Waiting for your teacher…");
    // The student prepares an empty peer; the remote offer creates its media
    // sections. The teacher offers after signaling confirms both are present.
    if (role === "student") createPeerConnection();
    send({ type: "enter-room", roomId: activeRoomId });
  }, [createPeerConnection, role, send]);

  const joinRoom = useCallback((id: string) => {
    roomIdRef.current = id;
    setRoomId(id);
    setStatus("joining");
    setStatusMessage("Joining the lesson…");
    send({ type: "join-room", roomId: id });
  }, [send]);

  const setAudioEnabled = useCallback((enabled: boolean) => {
    audioEnabledRef.current = enabled;
    setAudioEnabledState(enabled);
    if (audioTransceiverRef.current) void applyLocalAudio(enabled);
    if (!enabled && !audioTransceiverRef.current) stopLocalAudio();
  }, [applyLocalAudio, stopLocalAudio]);

  const leaveRoom = useCallback(() => {
    membershipConfirmedRef.current = false;
    setRoomAccess(null);
    send({ type: "leave-room" });
    audioEnabledRef.current = false;
    setAudioEnabledState(false);
    roomIdRef.current = null;
    setRoomId(null);
    setRemoteAudioEnabled(false);
    setStatus("ready");
    setStatusMessage("You left the lesson.");
    closePeerConnection();
  }, [closePeerConnection, send]);

  const exitRoom = useCallback(() => {
    const activeRoomId = roomIdRef.current;
    if (activeRoomId) send({ type: "exit-room", roomId: activeRoomId });
    audioEnabledRef.current = false;
    setAudioEnabledState(false);
    setRemoteAudioEnabled(false);
    // This closes local media and sends exit-room, but deliberately retains the
    // room ID so this participant can log back in with the same lesson link.
    closePeerConnection();
    setStatus("waiting");
    setStatusMessage("You left the lesson room. You can log in again when you are ready.");
  }, [closePeerConnection, send]);

  return {
    roomAccess,
    setRoomLocked: (locked: boolean) => { if (roomIdRef.current) send({ type: "set-room-locked", roomId: roomIdRef.current, locked }); },
    renewInvitation: () => { if (roomIdRef.current) send({ type: "renew-invitation", roomId: roomIdRef.current }); },
    endRoom: () => { if (roomIdRef.current) send({ type: "end-room", roomId: roomIdRef.current }); },
    qualitySamples,
    signalingReady,
    status,
    statusMessage,
    roomId,
    audioEnabled,
    remoteAudioEnabled,
    audioError,
    remoteStream,
    remoteVideoStreams,
    videoRoleState,
    remoteStudentVideoStream,
    videoError,
    outgoingVideoStreams,
    createRoom,
    joinRoom,
    enterRoom,
    exitRoom,
    leaveRoom,
    setAudioEnabled
  };
}
