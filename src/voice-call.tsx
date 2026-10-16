import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { api } from "./api";
import type { Conversation, Person } from "./types";

type CallState = {
  conversationId: string;
  callId: string | null;
  initiatorId: string | null;
  participants: string[];
  active: boolean;
  peers?: string[];
};
type Invite = {
  callId: string;
  conversationId: string;
  from: { id: string; name: string };
};
type Signal = {
  callId: string;
  conversationId: string;
  fromUserId: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
type Session = { callId: string; conversationId: string; participants: string[] };
type Runtime = Session & {
  local: MediaStream;
  config: RTCConfiguration;
  peers: Map<string, RTCPeerConnection>;
  queued: Map<string, RTCIceCandidateInit[]>;
};
type Remote = { userId: string; stream: MediaStream };
const message = (e: unknown) => e instanceof Error ? e.message : "Unable to connect the call";

export function useVoiceCalls(socket: Socket | null, selected: string, onError: (message: string) => void) {
  const [incoming, setIncoming] = useState<Invite | null>(null);
  const [available, setAvailable] = useState<CallState | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [remote, setRemote] = useState<Remote[]>([]);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState("");
  const runtime = useRef<Runtime | null>(null);
  const entering = useRef(false);
  const currentSocket = useRef(socket);
  const selectedRef = useRef(selected);
  currentSocket.current = socket;
  selectedRef.current = selected;

  function finish(notify = true) {
    const call = runtime.current;
    if (!call) return;
    runtime.current = null;
    if (notify && currentSocket.current?.connected)
      currentSocket.current.emit("call:leave", { callId: call.callId });
    for (const pc of call.peers.values()) pc.close();
    call.local.getTracks().forEach((track) => track.stop());
    setSession(null);
    setRemote([]);
    setMuted(false);
    setStatus("");
  }
  function signal(call: Runtime, toUserId: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    currentSocket.current?.emit("call:signal", {
      callId: call.callId, conversationId: call.conversationId, toUserId, ...data,
    }, (response: { ok: boolean; error?: string }) => {
      if (!response?.ok && runtime.current === call)
        setStatus(response?.error || "Call signal could not be delivered");
    });
  }
  function peer(call: Runtime, userId: string) {
    const existing = call.peers.get(userId);
    if (existing) return existing;
    const pc = new RTCPeerConnection(call.config);
    call.peers.set(userId, pc);
    call.local.getTracks().forEach((track) => pc.addTrack(track, call.local));
    pc.onicecandidate = (event) => {
      if (event.candidate && runtime.current === call)
        signal(call, userId, { candidate: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      if (runtime.current !== call) return;
      const stream = event.streams[0] || new MediaStream([event.track]);
      setRemote((old) => [...old.filter((r) => r.userId !== userId), { userId, stream }]);
    };
    pc.onconnectionstatechange = () => {
      if (runtime.current === call && pc.connectionState === "failed")
        setStatus("A connection failed. Leave and rejoin to try again.");
    };
    return pc;
  }
  async function offer(call: Runtime, userId: string) {
    const pc = peer(call, userId);
    await pc.setLocalDescription(await pc.createOffer());
    if (runtime.current === call && pc.localDescription)
      signal(call, userId, { description: pc.localDescription.toJSON() });
  }
  async function receive(data: Signal) {
    const call = runtime.current;
    if (!call || call.callId !== data.callId || call.conversationId !== data.conversationId) return;
    const pc = peer(call, data.fromUserId);
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      for (const candidate of call.queued.get(data.fromUserId) || [])
        await pc.addIceCandidate(candidate);
      call.queued.delete(data.fromUserId);
      if (data.description.type === "offer") {
        await pc.setLocalDescription(await pc.createAnswer());
        if (runtime.current === call && pc.localDescription)
          signal(call, data.fromUserId, { description: pc.localDescription.toJSON() });
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
      else call.queued.set(data.fromUserId, [...(call.queued.get(data.fromUserId) || []), data.candidate]);
    }
  }
  async function enter(conversationId: string, callId?: string) {
    const connection = currentSocket.current;
    if (!connection?.connected || runtime.current || entering.current) {
      onError("Finish your current call or reconnect first");
      return;
    }
    let stream: MediaStream | null = null;
    let joined: string | null = null;
    entering.current = true;
    setStatus("Connecting…");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined")
        throw new Error("Voice calls need a browser with microphone and WebRTC support");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      const config = await api<{ iceServers: RTCIceServer[] }>("/call-config");
      if (!connection.connected) throw new Error("Connection interrupted. Please retry");
      const response: { ok: boolean; error?: string; value?: CallState } = await connection.timeout(10000).emitWithAck(
        callId ? "call:join" : "call:start",
        { conversationId, ...(callId ? { callId } : {}) },
      );
      if (!response?.ok || !response.value?.callId)
        throw new Error(response?.error || "Call unavailable. Please retry");
      joined = response.value.callId;
      const call: Runtime = {
        callId: joined, conversationId, participants: response.value.participants,
        local: stream, config: { iceServers: config.iceServers },
        peers: new Map(), queued: new Map(),
      };
      runtime.current = call;
      setSession({ callId: joined, conversationId, participants: call.participants });
      setIncoming(null);
      setStatus(callId ? "Joining call…" : "Ringing your people…");
      for (const userId of response.value.peers || []) await offer(call, userId);
    } catch (e) {
      if (joined) connection.emit("call:leave", { callId: joined });
      if (runtime.current?.callId === joined) finish(false);
      else stream?.getTracks().forEach((track) => track.stop());
      setStatus("");
      onError(message(e));
    } finally {
      entering.current = false;
    }
  }
  async function decline() {
    const invite = incoming;
    setIncoming(null);
    if (invite && currentSocket.current?.connected)
      currentSocket.current.emit("call:decline", { conversationId: invite.conversationId, callId: invite.callId });
  }
  function toggleMute() {
    const call = runtime.current;
    if (!call) return;
    const next = !muted;
    call.local.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }

  useEffect(() => {
    if (!socket) return;
    const onInvite = (invite: Invite) => {
      if (!runtime.current) setIncoming(invite);
    };
    const onChanged = (state: CallState) => {
      if (state.conversationId === selectedRef.current) setAvailable(state);
      if (runtime.current?.callId === state.callId) {
        setSession({ callId: state.callId!, conversationId: state.conversationId, participants: state.participants });
        setStatus(state.participants.length > 1 ? "Connected" : "Waiting for someone to join…");
      }
      if (!state.active)
        setIncoming((old) => old?.conversationId === state.conversationId ? null : old);
    };
    const onEnded = (event: { callId: string; reason: string }) => {
      if (runtime.current?.callId === event.callId) {
        finish(false);
        setStatus(event.reason);
      }
      setIncoming((old) => old?.callId === event.callId ? null : old);
    };
    const onLeft = (event: { callId: string; userId: string }) => {
      const call = runtime.current;
      if (call?.callId !== event.callId) return;
      call.peers.get(event.userId)?.close();
      call.peers.delete(event.userId);
      call.queued.delete(event.userId);
      setRemote((old) => old.filter((r) => r.userId !== event.userId));
    };
    const onSignal = (event: Signal) => { void receive(event).catch((e) => onError(message(e))); };
    const onDisconnect = () => { finish(false); setIncoming(null); setAvailable(null); };
    socket.on("call:invite", onInvite);
    socket.on("call:changed", onChanged);
    socket.on("call:ended", onEnded);
    socket.on("call:participant-left", onLeft);
    socket.on("call:signal", onSignal);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("call:invite", onInvite);
      socket.off("call:changed", onChanged);
      socket.off("call:ended", onEnded);
      socket.off("call:participant-left", onLeft);
      socket.off("call:signal", onSignal);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);
  useEffect(() => {
    if (!selected) { setAvailable(null); return; }
    let current = true;
    void api<CallState>(`/conversations/${selected}/call`)
      .then((state) => { if (current) setAvailable(state); })
      .catch(() => { if (current) setAvailable(null); });
    return () => { current = false; };
  }, [selected, socket]);
  useEffect(() => () => { finish(true); }, []);
  return { incoming, available, session, remote, muted, status,
    start: (id: string) => enter(id), join: (id: string, callId: string) => enter(id, callId),
    decline, leave: () => finish(true), toggleMute };
}

export function CallDock({ calls, conversations, me }: {
  calls: ReturnType<typeof useVoiceCalls>;
  conversations: Conversation[];
  me: Person;
}) {
  const nameOf = (conversationId: string, userId?: string) => {
    const chat = conversations.find((c) => c.id === conversationId);
    if (!userId) return chat?.title || "Voice call";
    if (userId === me.id) return "You";
    return chat?.members.find((member) => member.id === userId)?.name || "A participant";
  };
  if (!calls.incoming && !calls.session) return null;
  return (
    <section className="call-dock" aria-label="Voice call" aria-live="polite">
      {calls.incoming && !calls.session && (
        <>
          <div className="call-dock-heading"><Phone size={20} /><strong>Incoming voice call</strong></div>
          <p>{calls.incoming.from.name} is calling in {nameOf(calls.incoming.conversationId)}.</p>
          <div className="call-actions">
            <button className="call-accept" onClick={() => void calls.join(calls.incoming!.conversationId, calls.incoming!.callId)}><Phone size={17} /> Join call</button>
            <button onClick={() => void calls.decline()}><PhoneOff size={17} /> Decline</button>
          </div>
        </>
      )}
      {calls.session && (
        <>
          <div className="call-dock-heading"><Phone size={20} /><strong>Voice call</strong><span>{calls.session.participants.length} in call</span></div>
          <p>{nameOf(calls.session.conversationId)} · {calls.status || "Connected"}</p>
          <div className="call-people">{calls.session.participants.map((id) => <span key={id}>{nameOf(calls.session!.conversationId, id)}</span>)}</div>
          {calls.remote.map(({ userId, stream }) => (
            <div className="remote-audio" key={userId}>
              <small>{nameOf(calls.session!.conversationId, userId)} audio</small>
              <audio controls autoPlay playsInline aria-label={`${nameOf(calls.session!.conversationId, userId)} audio`}
                ref={(element) => { if (element && element.srcObject !== stream) element.srcObject = stream; }} />
            </div>
          ))}
          <div className="call-actions">
            <button onClick={calls.toggleMute}>{calls.muted ? <MicOff size={17} /> : <Mic size={17} />}{calls.muted ? "Unmute" : "Mute"}</button>
            <button className="call-hangup" onClick={calls.leave}><PhoneOff size={17} /> Leave call</button>
          </div>
        </>
      )}
    </section>
  );
}
