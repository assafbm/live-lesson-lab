import { useCallback, useEffect, useRef, useState } from "react";
import { PROTOCOL_VERSION } from "@live-lesson-lab/shared";
import type { ClientMessage, IceCandidatePayload, MediaRole, ParticipantRole, ServerMessage, VideoRoleState } from "@live-lesson-lab/shared";
import { cameraSourceManager } from "./CameraSourceManager";
import { OutgoingVideoTransform, type VideoTransform } from "./OutgoingVideoTransform";

export type VideoSelections = Record<MediaRole, string | null>;
export type OutgoingVideoTransforms = Record<MediaRole, VideoTransform>;

export type LessonStatus = "connecting" | "ready" | "joining" | "waiting" | "connecting-peer" | "connected" | "disconnected" | "closed" | "failed";

function parseServerMessage(payload: string): ServerMessage | null {
  try {
    const message: unknown = JSON.parse(payload);
    if (typeof message !== "object" || message === null || !("type" in message)) return null;
    const candidate = message as Record<string, unknown>;

    switch (candidate.type) {
      case "server-ready":
        return typeof candidate.protocolVersion === "number"
          ? { type: "server-ready", protocolVersion: candidate.protocolVersion as typeof PROTOCOL_VERSION }
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
  }
) {
  const [signalingReady, setSignalingReady] = useState(false);
  const [status, setStatus] = useState<LessonStatus>("connecting");
  const [statusMessage, setStatusMessage] = useState("Connecting to the lesson service…");
  const [roomId, setRoomId] = useState<string | null>(null);
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
  const videoSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const studentVideoDeviceIdRef = useRef(studentVideoDeviceId);
  const studentVideoLeaseRef = useRef<{ deviceId: string; lease: ReturnType<typeof cameraSourceManager.acquire> } | null>(null);
  const studentVideoSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const roomIdRef = useRef<string | null>(null);
  const audioEnabledRef = useRef(false);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const audioRequestRef = useRef<Promise<MediaStream> | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const activeRef = useRef(true);
  videoSelectionsRef.current = videoSelections;
  studentVideoDeviceIdRef.current = studentVideoDeviceId;
  outgoingTransformsRef.current = outgoingTransforms;

  const getOutgoingTrack = useCallback((deviceId: string, sourceTrack: MediaStreamTrack, transform: VideoTransform) => {
    const current = outgoingProcessorsRef.current.get(deviceId);
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
    audioRequestRef.current = null;
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
          const showStudentVideo = () => setRemoteStudentVideoStream(stream);
          // Keep the track attached while muted. WebRTC often marks a remote
          // track muted briefly before its first RTP frame; detaching it then
          // can make the tile flicker or miss the first render.
          event.track.addEventListener("unmute", showStudentVideo);
          showStudentVideo();
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
      const selections = videoSelectionsRef.current;
      const uniqueIds = [...new Set([selections.face, selections.document].filter((id): id is string => Boolean(id)))].slice(0, 2);

      for (const deviceId of uniqueIds) {
        if (!videoLeasesRef.current.has(deviceId)) {
          videoLeasesRef.current.set(deviceId, cameraSourceManager.acquire(deviceId));
        }
      }

      const tracks = new Map<string, MediaStreamTrack>();
      for (const deviceId of uniqueIds) {
        const lease = videoLeasesRef.current.get(deviceId);
        if (!lease) continue;
        try {
          const stream = await lease.stream;
          const track = stream.getVideoTracks()[0];
          if (!track) throw new Error("The selected camera returned no video track.");
          // One camera source produces one processed track. If both teacher
          // roles share the device, the role controls are linked and share it.
          const transformRole = deviceId === selections.face ? "face" : "document";
          const transform = outgoingTransformsRef.current[transformRole];
          tracks.set(deviceId, getOutgoingTrack(deviceId, track, transform));
        } catch {
          lease.release();
          videoLeasesRef.current.delete(deviceId);
          setVideoError("A selected camera could not be shared. Choose another camera or turn this view off.");
        }
      }

      if (peerConnectionRef.current !== peerConnection) return;
      const slotIds = uniqueIds.filter((deviceId) => tracks.has(deviceId));
      try {
        for (let slot = 0; slot < videoTransceiversRef.current.length; slot += 1) {
          const deviceId = slotIds[slot];
          await videoTransceiversRef.current[slot].sender.replaceTrack(deviceId ? tracks.get(deviceId) ?? null : null);
        }
      } catch {
        setVideoError("The camera track could not be attached to the lesson. Try selecting the camera again.");
        return;
      }

      setVideoError("");
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
        document: selections.document ? midForDevice.get(selections.document) ?? null : null
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
          const sourceTrack = stream.getVideoTracks()[0] ?? null;
          if (!sourceTrack) throw new Error("The selected camera returned no video track.");
          nextTrack = getOutgoingTrack(requestedDeviceId!, sourceTrack, outgoingTransformsRef.current.face);
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
  }, [role, syncTeacherVideoSources, videoSelections.face, videoSelections.document, outgoingTransforms.face.rotation, outgoingTransforms.face.mirrored, outgoingTransforms.document.rotation, outgoingTransforms.document.mirrored]);

  const getMicrophoneStream = useCallback(async () => {
    if (localAudioStreamRef.current) return localAudioStreamRef.current;
    if (!audioRequestRef.current) {
      audioRequestRef.current = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    const stream = await audioRequestRef.current;
    localAudioStreamRef.current = stream;
    return stream;
  }, []);

  const applyLocalAudio = useCallback(async (enabled: boolean) => {
    const transceiver = audioTransceiverRef.current;
    if (!transceiver) return;

    if (!enabled) {
      await transceiver.sender.replaceTrack(null);
      stopLocalAudio();
      if (roomIdRef.current) send({ type: "audio-state", roomId: roomIdRef.current, enabled: false });
      return;
    }

    try {
      setAudioError("");
      const stream = await getMicrophoneStream();
      if (!audioEnabledRef.current) {
        stopLocalAudio();
        return;
      }
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("No microphone track was returned by the browser.");
      await transceiver.sender.replaceTrack(track);
      if (roomIdRef.current) send({ type: "audio-state", roomId: roomIdRef.current, enabled: true });
    } catch {
      audioEnabledRef.current = false;
      setAudioEnabledState(false);
      setAudioError("Microphone access failed. Check browser permissions, then try again.");
      stopLocalAudio();
      if (roomIdRef.current) send({ type: "audio-state", roomId: roomIdRef.current, enabled: false });
    }
  }, [getMicrophoneStream, send, stopLocalAudio]);

  const flushPendingCandidates = useCallback(async (peerConnection: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of queued) await peerConnection.addIceCandidate(candidate);
  }, []);

  const startTeacherOffer = useCallback(async () => {
    const room = roomIdRef.current;
    if (!room) return;

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
      socket = activeSocket;
      socketRef.current = activeSocket;

      activeSocket.addEventListener("open", () => {
        if (disposed || socketRef.current !== activeSocket) return;
        setSignalingReady(true);
        setStatus("ready");
        setStatusMessage("Connected to the lesson service.");
        // Render's free service can scale down after inactivity. A small
        // application message keeps this signaling socket active during a
        // lesson where media itself flows directly between browsers.
        heartbeatTimer = window.setInterval(() => {
          if (activeSocket.readyState === WebSocket.OPEN) {
            activeSocket.send(JSON.stringify({ type: "heartbeat" } satisfies ClientMessage));
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
          setStatus("failed");
          setStatusMessage("The web app and signaling service use different protocol versions.");
        }
        return;
      }
      if (message.type === "room-created") {
        roomIdRef.current = message.roomId;
        setRoomId(message.roomId);
        setStatus("waiting");
        setStatusMessage("Lesson created. Share the link, then log in to wait for your student.");
        return;
      }
      if (message.type === "room-joined") {
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
        if (role === "teacher") void startTeacherOffer().catch(() => {
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
        closePeerConnection();
        setStatus("closed");
        setStatusMessage(message.reason);
        return;
      }
      if (message.type === "room-error") {
        setStatus("failed");
        setStatusMessage(message.message);
        return;
      }
      if (message.type === "audio-state") {
        setRemoteAudioEnabled(message.enabled);
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
    // The student prepares its fixed transceivers while waiting; the teacher
    // creates the offer only after signaling confirms the student is present.
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
