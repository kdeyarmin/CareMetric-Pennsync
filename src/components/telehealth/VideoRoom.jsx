import { useEffect, useRef, useState, useCallback } from "react";
import { createTelehealthToken } from "@/functions/createTelehealthToken";
import { configNotReadyMessage } from "@/lib/aiFeatureError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VideoOff, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import NetworkMonitor from "./NetworkMonitor";
import EnhancedVideoControls from "./EnhancedVideoControls";
import TelehealthChat from "./TelehealthChat";

// VideoRoom — Telnyx Video room client (@telnyx/video v1).
//
// createTelehealthToken returns a Telnyx token:
//   { token, room_id, room_name, identity, host_name, refresh_token }
//
// Validated against the installed @telnyx/video type surface (see
// src/components/telehealth/telnyxVideoApi.test.js, which asserts every SDK
// method/event used here actually exists):
//   initialize({ roomId, clientToken, context }) -> Promise<Room>
//   room.on(event, cb), room.connect(), room.disconnect()
//   room.getState() -> { status, localParticipantId, participants: Map, streams: Map }
//   room.addStream(key, { audio?: track, video?: track }), room.removeStream(key)
//   room.addSubscription(participantId, key, { audio, video })
//   room.getParticipantStream(participantId, key) -> Stream{ audioTrack, videoTrack }
//   room.sendMessage(message, recipients?)
//   events: connected, disconnected, state_changed, participant_joined/left,
//           stream_published/unpublished, subscription_started/ended,
//           track_enabled/disabled, message_received

// The participant `context` we set is JSON.stringify({ identity }); read it back.
function identityFromParticipant(p) {
  if (!p) return "Participant";
  try {
    const ctx = typeof p.context === "string" ? JSON.parse(p.context) : p.context;
    if (ctx?.identity) return ctx.identity;
  } catch { /* context wasn't our JSON */ }
  return p.id;
}

export default function VideoRoom({ roomName, identity, onDisconnect, onParticipantListChange, joinToken, videoDeviceId, audioDeviceId, waitingMessage = "Waiting for patient to join..." }) {
  // Remote participants, keyed for rendering. Each: { id, identity, streamKeys }
  const [participants, setParticipants] = useState([]);
  const [status, setStatus] = useState("connecting"); // connecting | connected | reconnecting | error | disconnected
  const [error, setError] = useState(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState([]);
  const [providerName, setProviderName] = useState(null);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const participantNames = [identity, ...participants.map((p) => p.identity)].filter(Boolean);
    onParticipantListChange?.([...new Set(participantNames)]);
  }, [participants, identity, onParticipantListChange]);

  const localVideoRef = useRef(null);
  const containerRef = useRef(null);
  const roomRef = useRef(null);          // the connected Telnyx Video Room
  const localStreamRef = useRef(null);   // local MediaStream (camera + mic)
  const screenStreamRef = useRef(null);  // active screen-share MediaStream
  const endedRef = useRef(false);
  const wasConnectedRef = useRef(false);

  // Append a chat message received over the room's message channel.
  const handleIncomingMessage = useCallback((raw, senderIdentity) => {
    let text = raw;
    let ts = Date.now();
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      text = parsed.text ?? raw;
      ts = parsed.ts ?? ts;
    } catch { /* fall back to the raw string */ }
    setMessages((prev) => [...prev, {
      id: `${senderIdentity}-${ts}-${Math.random().toString(36).slice(2, 6)}`,
      sender: senderIdentity,
      text,
      timestamp: new Date(ts).toISOString(),
      isSelf: false,
    }]);
  }, []);

  // Refresh the rendered remote-participant list from the room's current state.
  // state.participants is a Map<id, Participant>; exclude the local participant.
  const syncParticipants = useCallback((room) => {
    if (!room) return;
    const state = room.getState();
    const localId = state.localParticipantId;
    const remote = [...state.participants.values()]
      .filter((p) => p && p.id !== localId && p.origin !== "local")
      .map((p) => ({
        id: p.id,
        identity: identityFromParticipant(p),
        streamKeys: Object.keys(p.streams || {}),
      }));
    setParticipants(remote);
  }, []);

  // Subscribe to every stream a remote participant publishes so its media flows
  // to us; the SDK requires an explicit subscription before tracks arrive.
  const subscribeRemote = useCallback(async (room, participantId, key) => {
    const state = room.getState();
    if (participantId === state.localParticipantId) return;
    try {
      await room.addSubscription(participantId, key, { audio: true, video: true });
    } catch (e) {
      console.error("subscribe error:", e);
    }
  }, []);

  const connectToRoom = useCallback(async () => {
    try {
      setStatus("connecting");
      // Patients authenticate with the per-session capability token from their
      // invite link; staff authenticate with their app session.
      const res = await createTelehealthToken(
        joinToken ? { room_name: roomName, join_token: joinToken } : { room_name: roomName, identity }
      );
      const { token, room_id } = res.data || {};
      if (!token) throw new Error(res.data?.error || "We couldn't start the visit. Please try again.");
      if (joinToken && res.data.host_name) setProviderName(res.data.host_name);

      const { initialize } = await import("@telnyx/video");

      // Honor the camera/mic chosen in the pre-join device check (bare deviceId
      // is an "ideal" hint, so a since-unplugged device falls back gracefully).
      const audioConstraint = audioDeviceId ? { deviceId: audioDeviceId } : true;
      const videoConstraint = { width: 1280, height: 720 };
      if (videoDeviceId) videoConstraint.deviceId = videoDeviceId;

      // initialize() returns a Promise<Room>; it must be awaited.
      const room = await initialize({
        roomId: room_id,
        clientToken: token,
        context: JSON.stringify({ identity }),
        enableMessages: true,
      });
      roomRef.current = room;
      endedRef.current = false;

      // Wire room lifecycle + participant events before connecting so we don't
      // miss the initial participant set.
      room.on("connected", () => {
        wasConnectedRef.current = true;
        setStatus("connected");
        setSessionStartTime((t) => t || new Date());
        syncParticipants(room);
      });
      room.on("disconnected", () => {
        setStatus("disconnected");
        if (!endedRef.current) {
          endedRef.current = true;
          onDisconnect && onDisconnect();
        }
      });
      // Derive a "Reconnecting…" state from the room status without inventing
      // events: status returns to 'connecting' after a transient drop.
      room.on("state_changed", (state) => {
        if (state.status === "connecting" && wasConnectedRef.current) setStatus("reconnecting");
        else if (state.status === "connected") setStatus("connected");
      });
      const onParticipantJoin = (participantId) => {
        syncParticipants(room);
        const p = room.getState().participants.get(participantId);
        const who = p ? identityFromParticipant(p) : null;
        if (who) toast.success(`${who} joined the visit`);
      };
      room.on("participant_joined", onParticipantJoin);
      room.on("participant_left", () => syncParticipants(room));
      // A remote stream was published → subscribe, then re-render once it starts.
      room.on("stream_published", (participantId, key) => {
        subscribeRemote(room, participantId, key);
      });
      room.on("stream_unpublished", () => syncParticipants(room));
      room.on("subscription_started", () => syncParticipants(room));
      room.on("subscription_ended", () => syncParticipants(room));
      room.on("track_enabled", () => syncParticipants(room));
      room.on("track_disabled", () => syncParticipants(room));
      // In-call chat over the message channel. Signature is
      // (participantId, message, recipients, state).
      room.on("message_received", (participantId, message) => {
        const p = room.getState().participants.get(participantId);
        // message is a Telnyx Message { type: 'text', payload: string }.
        handleIncomingMessage(message?.payload ?? message, p ? identityFromParticipant(p) : "Participant");
      });

      // Acquire local media honoring the chosen devices.
      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraint,
        video: videoConstraint,
      });
      localStreamRef.current = localStream;
      if (localVideoRef.current) {
        const videoEl = document.createElement("video");
        videoEl.autoplay = true;
        videoEl.muted = true; // never echo our own mic
        videoEl.playsInline = true;
        videoEl.srcObject = localStream;
        localVideoRef.current.innerHTML = "";
        localVideoRef.current.appendChild(videoEl);
      }

      // connect() joins the room; addStream publishes the local camera + mic as
      // the "self" stream (tracks passed individually, per the SDK).
      await room.connect();
      await room.addStream("self", {
        audio: localStream.getAudioTracks()[0],
        video: localStream.getVideoTracks()[0],
      });

      // Subscribe to anyone already publishing when we joined.
      const state = room.getState();
      for (const p of state.participants.values()) {
        if (p.id === state.localParticipantId) continue;
        for (const key of Object.keys(p.streams || {})) subscribeRemote(room, p.id, key);
      }

      if (!wasConnectedRef.current) {
        wasConnectedRef.current = true;
        setStatus("connected");
        setSessionStartTime((t) => t || new Date());
      }
      syncParticipants(room);
    } catch (err) {
      // Stop the local camera/mic we acquired before the failure so the device
      // LED doesn't stay on, and so a later Retry can't orphan this stream.
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      const friendly = configNotReadyMessage(err);
      if (!friendly) console.error("Video connect error:", err);
      setError(friendly || err.message);
      setStatus("error");
    }
  }, [roomName, identity, joinToken, videoDeviceId, audioDeviceId, onDisconnect, syncParticipants, subscribeRemote, handleIncomingMessage]);

  useEffect(() => {
    connectToRoom();
    return () => {
      try { roomRef.current?.disconnect(); } catch { /* already gone */ }
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [connectToRoom]);

  // Live call timer.
  useEffect(() => {
    if (!sessionStartTime) return;
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - sessionStartTime.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [sessionStartTime]);

  // Keep the fullscreen button in sync if the user exits with Esc.
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Mute by toggling the local track's enabled flag and republishing the new
  // track to the "self" stream so remote participants see the change.
  const toggleAudio = () => {
    const next = !audioMuted;
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !next;
      try { roomRef.current?.updateStream("self", { audio: track }); } catch { /* optional */ }
    }
    setAudioMuted(next);
  };

  const toggleVideo = () => {
    const next = !videoMuted;
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !next;
      try { roomRef.current?.updateStream("self", { video: track }); } catch { /* optional */ }
    }
    setVideoMuted(next);
  };

  const disconnect = () => {
    if (screenStreamRef.current) {
      try { screenStreamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
      screenStreamRef.current = null;
    }
    const room = roomRef.current;
    if (room && status !== "disconnected") {
      // Let the room's "disconnected" event invoke onDisconnect exactly once.
      try { room.disconnect(); } catch { /* fall through */ }
    } else if (!endedRef.current) {
      endedRef.current = true;
      onDisconnect && onDisconnect();
    }
  };

  // Screen sharing: publish a getDisplayMedia track as a named "screen" stream,
  // restoring the camera preview when it stops.
  const stopScreenShare = () => {
    const screenStream = screenStreamRef.current;
    if (!screenStream) return; // already stopped — keep this idempotent
    screenStreamRef.current = null;
    screenStream.getTracks().forEach((t) => t.stop());
    try { roomRef.current?.removeStream("screen"); } catch { /* optional */ }
    // Restore the local camera preview.
    if (localVideoRef.current && localStreamRef.current) {
      const videoEl = document.createElement("video");
      videoEl.autoplay = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.srcObject = localStreamRef.current;
      localVideoRef.current.innerHTML = "";
      localVideoRef.current.appendChild(videoEl);
    }
    setScreenSharing(false);
  };

  const startScreenShare = async () => {
    const room = roomRef.current;
    if (!room) return;

    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    screenStreamRef.current = screenStream;

    try {
      await room.addStream("screen", { video: screenStream.getVideoTracks()[0] });
    } catch (e) {
      console.error("Screen publish error:", e);
    }

    // Preview the shared screen locally.
    if (localVideoRef.current) {
      const videoEl = document.createElement("video");
      videoEl.autoplay = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.srcObject = screenStream;
      localVideoRef.current.innerHTML = "";
      localVideoRef.current.appendChild(videoEl);
    }

    // The browser's own "Stop sharing" control ends the underlying track.
    const screenTrack = screenStream.getVideoTracks()[0];
    if (screenTrack) screenTrack.onended = () => stopScreenShare();
    setScreenSharing(true);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      containerRef.current?.requestFullscreen?.();
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (screenSharing) {
        stopScreenShare();
      } else {
        await startScreenShare();
      }
    } catch (err) {
      // Most commonly the user dismissed the screen picker — leave the call as-is.
      console.error("Screen share error:", err);
      setScreenSharing(false);
    }
  };

  const sendMessage = (text) => {
    try {
      // Telnyx requires a Message object { type: 'text', payload: string }.
      roomRef.current?.sendMessage({ type: "text", payload: JSON.stringify({ text, ts: Date.now() }) });
    } catch (err) {
      console.error("Chat send error:", err);
    }
    // Messages don't echo back to the sender, so add our own locally.
    setMessages((prev) => [...prev, {
      id: `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sender: identity,
      text,
      timestamp: new Date().toISOString(),
      isSelf: true,
    }]);
  };

  if (status === "connecting") {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 bg-slate-900 rounded-xl" role="status">
        <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
        <p className="text-white text-lg">Connecting to session...</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 bg-slate-900 rounded-xl" role="status">
        <p className="text-red-400 text-lg">Failed to connect: {error}</p>
        <Button onClick={connectToRoom} variant="outline">Retry</Button>
      </div>
    );
  }

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");

  return (
    <div ref={containerRef} className={`flex flex-col gap-4 ${isFullscreen ? "h-full overflow-y-auto bg-slate-950 p-4" : ""}`}>
      {/* Status bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2" aria-live="polite">
          {status === "reconnecting" ? (
            <>
              <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
              <span className="text-sm font-medium text-amber-600">Reconnecting…</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-green-700">Live</span>
            </>
          )}
          <Badge variant="outline" className="text-xs">
            <Users className="w-3 h-3 mr-1" />
            {participants.length + 1} participant{participants.length !== 0 ? "s" : ""}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <NetworkMonitor room={roomRef.current} />
          <span className={`text-sm font-mono ${isFullscreen ? "text-slate-300" : "text-slate-500"}`}>{mm}:{ss}</span>
        </div>
      </div>

      {/* Video grid - responsive */}
      <div className={`grid gap-2 sm:gap-3 ${participants.length > 0 ? "sm:grid-cols-2 grid-cols-1" : "grid-cols-1"}`}>
        {/* Local video */}
        <div className="relative bg-slate-900 rounded-xl overflow-hidden aspect-video">
          <div ref={localVideoRef} className={`w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-cover ${screenSharing ? "" : "[&>video]:[transform:scaleX(-1)]"}`} />
          {videoMuted && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
              <VideoOff className="w-12 h-12 text-slate-500" />
            </div>
          )}
          <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
            You {audioMuted && "🔇"}
          </div>
        </div>

        {/* Remote participants */}
        {participants.map((participant) => (
          <RemoteParticipant key={participant.id} participant={participant} room={roomRef.current} />
        ))}

        {/* Waiting placeholder */}
        {participants.length === 0 && (
          <div className="bg-slate-800 rounded-xl aspect-video flex flex-col items-center justify-center gap-2">
            <Users className="w-10 h-10 text-slate-500" />
            <p className="text-slate-400 text-sm">{providerName ? `Waiting for ${providerName} to join…` : waitingMessage}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <EnhancedVideoControls
        audioMuted={audioMuted}
        videoMuted={videoMuted}
        screenSharing={screenSharing}
        chatActive={showChat}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onDisconnect={disconnect}
        onToggleChat={() => setShowChat((v) => !v)}
        onToggleScreenShare={toggleScreenShare}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {showChat && (
        <TelehealthChat messages={messages} onSend={sendMessage} userName={identity} />
      )}
    </div>
  );
}

function RemoteParticipant({ participant, room }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!room) return undefined;
    // Build a MediaStream from the participant's subscribed Telnyx streams
    // (getParticipantStream(participantId, key) -> Stream{ audioTrack, videoTrack }).
    const tracks = [];
    for (const key of participant.streamKeys || []) {
      const s = room.getParticipantStream(participant.id, key);
      if (s?.audioTrack) tracks.push(s.audioTrack);
      if (s?.videoTrack) tracks.push(s.videoTrack);
    }
    if (!tracks.length) return undefined;
    const mediaStream = new MediaStream(tracks);

    const videoHost = videoRef.current;
    const audioHost = audioRef.current;
    if (videoHost && mediaStream.getVideoTracks().length) {
      const v = document.createElement("video");
      v.autoplay = true;
      v.playsInline = true;
      v.srcObject = mediaStream;
      videoHost.innerHTML = "";
      videoHost.appendChild(v);
    }
    if (audioHost && mediaStream.getAudioTracks().length) {
      const a = document.createElement("audio");
      a.autoplay = true;
      a.srcObject = mediaStream;
      audioHost.innerHTML = "";
      audioHost.appendChild(a);
    }
    // Tear down the created media elements when the participant/room changes or
    // the participant leaves: detach srcObject and pause so the old <audio>/
    // <video> stop playing immediately instead of lingering until GC (a leaving
    // participant's audio could otherwise keep playing for a beat).
    return () => {
      [videoHost, audioHost].forEach((host) => {
        if (!host) return;
        host.querySelectorAll("video, audio").forEach((el) => {
          try { el.pause(); } catch { /* not playing */ }
          el.srcObject = null;
        });
        host.innerHTML = "";
      });
    };
  }, [participant, room]);

  return (
    <div className="relative bg-slate-900 rounded-xl overflow-hidden aspect-video">
      <div ref={videoRef} className="w-full h-full [&>video]:w-full [&>video]:h-full [&>video]:object-cover" />
      <div ref={audioRef} className="hidden" />
      <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
        {participant.identity}
      </div>
    </div>
  );
}