import { randomUUID } from "node:crypto";
import { fail, uuid } from "./validation.js";

// A single Render instance owns signaling and presence. Audio goes directly between
// members over WebRTC; no audio passes through Socket.IO or this process.
export class VoiceCalls {
  constructor(chat, io) {
    this.chat = chat;
    this.io = io;
    this.active = new Map();
  }
  state(id) {
    const call = this.active.get(id);
    return call
      ? { conversationId: id, callId: call.id, initiatorId: call.initiatorId,
          participants: [...call.participants.keys()], active: true }
      : { conversationId: id, callId: null, initiatorId: null, participants: [], active: false };
  }
  async notify(id) {
    for (const user of await this.chat.recipients(id))
      this.io.to("user:" + user).emit("call:changed", this.state(id));
  }
  busy(user) {
    return [...this.active.values()].some((call) => call.participants.has(user));
  }
  expire(call) {
    clearTimeout(call.timer);
    call.timer = setTimeout(() => {
      if (this.active.get(call.conversationId) === call && call.participants.size < 2)
        this.end(call, "No one else joined");
    }, 60000);
    call.timer.unref();
  }
  end(call, reason = "Call ended") {
    if (this.active.get(call.conversationId) !== call) return;
    clearTimeout(call.timer);
    clearTimeout(call.lifetime);
    this.active.delete(call.conversationId);
    for (const participant of call.participants.values())
      this.io.to(participant.socketId).emit("call:ended", {
        conversationId: call.conversationId, callId: call.id, reason,
      });
    void this.notify(call.conversationId).catch(() => {});
  }
  async start(socket, conversationId) {
    const conversation = await this.chat.membership(conversationId, socket.data.actor.id);
    if (await this.chat.blocked(conversationId, socket.data.actor.id))
      fail(403, "Messaging is unavailable because a participant is blocked");
    if (this.active.has(conversationId)) fail(409, "A voice call is already active");
    if (this.busy(socket.data.actor.id)) fail(409, "Finish your current call first");
    const call = {
      id: randomUUID(), conversationId, kind: conversation.kind, initiatorId: socket.data.actor.id,
      participants: new Map([[socket.data.actor.id, { socketId: socket.id }]]),
      timer: null, lifetime: null,
    };
    this.active.set(conversationId, call);
    call.lifetime = setTimeout(() => this.end(call, "Call time limit reached"), 3 * 60 * 60 * 1000);
    call.lifetime.unref();
    this.expire(call);
    for (const recipient of await this.chat.recipients(conversationId))
      if (recipient !== socket.data.actor.id)
        this.io.to("user:" + recipient).emit("call:invite", {
          callId: call.id, conversationId,
          from: { id: socket.data.actor.id, name: socket.data.actor.name },
        });
    await this.notify(conversationId);
    return this.state(conversationId);
  }
  async join(socket, conversationId, callId) {
    uuid(callId);
    await this.chat.canInteract(conversationId, socket.data.actor.id);
    const call = this.active.get(conversationId);
    if (!call || call.id !== callId) fail(404, "Call is no longer available");
    if (this.busy(socket.data.actor.id)) fail(409, "Finish your current call first");
    const participants = [...call.participants.keys()];
    call.participants.set(socket.data.actor.id, { socketId: socket.id });
    clearTimeout(call.timer);
    for (const peer of call.participants.values())
      if (peer.socketId !== socket.id)
        this.io.to(peer.socketId).emit("call:participant-joined", {
          callId, conversationId, userId: socket.data.actor.id,
        });
    await this.notify(conversationId);
    return { ...this.state(conversationId), peers: participants };
  }
  leave(socket, callId) {
    for (const call of this.active.values()) {
      if (call.id !== callId || call.participants.get(socket.data.actor.id)?.socketId !== socket.id)
        continue;
      call.participants.delete(socket.data.actor.id);
      for (const peer of call.participants.values())
        this.io.to(peer.socketId).emit("call:participant-left", {
          callId, conversationId: call.conversationId, userId: socket.data.actor.id,
        });
      if (!call.participants.size || (call.participants.size === 1 && call.kind === "direct"))
        this.end(call);
      else if (call.participants.size === 1) this.expire(call);
      void this.notify(call.conversationId).catch(() => {});
      return;
    }
  }
  async signal(socket, body) {
    const { callId, conversationId, toUserId, description, candidate } = body || {};
    uuid(callId);
    uuid(conversationId);
    await this.chat.canInteract(conversationId, socket.data.actor.id);
    const call = this.active.get(conversationId);
    if (!call || call.id !== callId ||
      call.participants.get(socket.data.actor.id)?.socketId !== socket.id)
      fail(404, "Call is no longer available");
    const target = call.participants.get(toUserId);
    if (!target || toUserId === socket.data.actor.id)
      fail(404, "Call participant not found");
    const validDescription = description && !candidate &&
      ["offer", "answer"].includes(description.type) &&
      typeof description.sdp === "string" && description.sdp.length > 0 && description.sdp.length <= 24000;
    const validCandidate = candidate && !description &&
      typeof candidate.candidate === "string" && candidate.candidate.length <= 3000 &&
      (candidate.sdpMid == null || (typeof candidate.sdpMid === "string" && candidate.sdpMid.length <= 40)) &&
      (candidate.sdpMLineIndex == null || (Number.isInteger(candidate.sdpMLineIndex) && candidate.sdpMLineIndex >= 0 && candidate.sdpMLineIndex < 20));
    if (!validDescription && !validCandidate) fail(400, "Invalid call signal");
    this.io.to(target.socketId).emit("call:signal", {
      callId, conversationId, fromUserId: socket.data.actor.id,
      ...(validDescription ? { description: { type: description.type, sdp: description.sdp } } :
        { candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null } }),
    });
  }
  async decline(socket, conversationId, callId) {
    uuid(callId);
    await this.chat.membership(conversationId, socket.data.actor.id);
    const call = this.active.get(conversationId);
    if (!call || call.id !== callId) return;
    if (call.participants.has(socket.data.actor.id)) return;
    const initiator = call.participants.get(call.initiatorId);
    if (initiator) this.io.to(initiator.socketId).emit("call:declined", {
      callId, conversationId, userId: socket.data.actor.id,
    });
    if (call.kind === "direct") this.end(call, "Call declined");
  }
  leaveUser(user, conversationId) {
    const call = this.active.get(conversationId);
    const participant = call?.participants.get(user);
    if (participant) this.leave({ id: participant.socketId, data: { actor: { id: user } } }, call.id);
  }
  async block(user, target) {
    for (const call of this.active.values()) {
      const members = await this.chat.recipients(call.conversationId);
      if (members.includes(user) && members.includes(target)) this.end(call, "A participant was blocked");
    }
  }
  close() {
    for (const call of this.active.values()) this.end(call, "Server disconnected");
  }
  register(socket) {
    const acked = (job) => async (body, callback) => {
      const ack = typeof callback === "function" ? callback : () => {};
      try { ack({ ok: true, value: await job(body || {}) }); }
      catch (e) { ack({ ok: false, status: e.status || 500, error: e.status ? e.message : "Call unavailable. Please retry" }); }
    };
    socket.on("call:start", acked(async (body) => this.start(socket, body.conversationId)));
    socket.on("call:join", acked(async (body) => this.join(socket, body.conversationId, body.callId)));
    socket.on("call:signal", acked(async (body) => this.signal(socket, body)));
    socket.on("call:decline", acked(async (body) => this.decline(socket, body.conversationId, body.callId)));
    socket.on("call:leave", acked(async (body) => {
      uuid(body.callId);
      this.leave(socket, body.callId);
    }));
    socket.on("disconnect", () => {
      for (const call of this.active.values())
        if (call.participants.get(socket.data.actor.id)?.socketId === socket.id)
          this.leave(socket, call.id);
    });
  }
}
