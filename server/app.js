import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { authentication, managedVerifier } from "./auth.js";
import { authProxy } from "./auth-proxy.js";
import { Chat, profile } from "./chat.js";
import { Photos, VoiceNotes, storage } from "./storage.js";
import { Statuses } from "./statuses.js";
import { VoiceCalls } from "./calls.js";
import { fail, HttpError, text, uuid } from "./validation.js";

export function createApp(
  db,
  config,
  { verifyToken, files, authTestRouter } = {},
) {
  if (authTestRouter && config.production)
    throw new Error("Test auth is prohibited in production");
  const app = express(),
    server = createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 32000,
    allowRequest: (req, done) =>
      done(
        null,
        !req.headers.origin || req.headers.origin === config.publicUrl,
      ),
  });
  const chat = new Chat(db),
    fileStore = files || storage(config),
    photos = new Photos(db, chat, fileStore),
    voiceNotes = new VoiceNotes(db, chat, fileStore),
    statuses = new Statuses(db, fileStore),
    calls = new VoiceCalls(chat, io);
  const auth = authentication(
    db,
    config,
    verifyToken || managedVerifier(config),
  );
  const online = new Map(),
    socketRates = new Map();
  app.disable("x-powered-by");
  if (config.production) app.set("trust proxy", 1);
  const authOrigin = config.authUrl ? new URL(config.authUrl).origin : null;
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "connect-src": [
            "'self'",
            ...(authOrigin ? [authOrigin] : []),
            "ws:",
            "wss:",
          ],
          "frame-src": ["'self'", ...(authOrigin ? [authOrigin] : [])],
          "img-src": ["'self'", "blob:", "data:"],
          "media-src": ["'self'", "blob:"],
          "upgrade-insecure-requests": config.production ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("origin") && req.get("origin") !== config.publicUrl)
        fail(403, "Cross-site request rejected");
      if (req.get("sec-fetch-site") === "cross-site")
        fail(403, "Cross-site request rejected");
      if (
        req.body !== undefined &&
        (typeof req.body !== "object" || Array.isArray(req.body))
      )
        fail(400, "Send a JSON object");
    }
    next();
  });
  app.get("/api/health", async (req, res) => {
    await db.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.get("/api/config", (req, res) =>
    res.json({
      authUrl: config.authUrl,
      maxPhotoBytes: 5 * 1024 * 1024,
      maxVoiceBytes: 5 * 1024 * 1024,
      maxStatusBytes: 25 * 1024 * 1024,
      moderationEnabled: !!config.moderatorId,
    }),
  );
  // Bound invalid-token traffic before verification; the tighter limit below
  // is per signed-in account so people sharing an IP do not throttle each other.
  app.use("/api", rateLimit({
    windowMs: 60000, limit: 1200, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "Too many requests. Please wait a moment" },
  }));
  app.use("/api/auth", rateLimit({
    windowMs: 60000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "Too many requests. Please wait a moment" },
  }), authTestRouter || authProxy(config));
  app.use("/api", auth.middleware);
  app.use("/api", rateLimit({
    windowMs: 60000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: (req) => req.actor.id,
    message: { error: "Too many requests. Please wait a moment" },
  }));
  app.get("/api/me", (req, res) =>
    res.json({ ...profile(req.actor), moderator: req.actor.moderator }),
  );
  app.patch("/api/me", async (req, res) => {
    const p = await chat.updateProfile(req.actor.id, req.body);
    io.emit("profile:updated", { id: p.id });
    res.json(p);
  });
  app.post("/api/logout", async (req, res) => {
    const issuedThrough = await auth.revoke(req.actor);
    for (const socket of await io.in("user:" + req.actor.id).fetchSockets())
      if (socket.data.actor.issuedAt <= issuedThrough)
        socket.disconnect(true);
    await auth.finishLogout(issuedThrough);
    res.status(204).end();
  });
  app.get("/api/people", async (req, res) =>
    res.json(await chat.people(req.query.q, req.actor.id)),
  );
  app.get("/api/conversations", async (req, res) =>
    res.json(await chat.conversations(req.actor.id)),
  );
  app.get("/api/statuses", async (req, res) =>
    res.json(await statuses.list(req.actor.id)),
  );
  app.get("/api/statuses/contacts", async (req, res) =>
    res.json(await statuses.contacts(req.actor.id)),
  );
  app.post(
    "/api/statuses",
    rateLimit({
      windowMs: 60000,
      limit: 12,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 5 },
    }).single("media"),
    async (req, res) => {
      const item = await statuses.create(req.actor.id, req.body, req.file);
      await statusChanged(req.actor.id);
      res.status(201).json(item);
    },
  );
  app.get("/api/statuses/:id/media", async (req, res) => {
    const media = await statuses.download(req.params.id, req.actor.id);
    res
      .set({
        "Content-Type": media.mimeType,
        "Content-Length": String(media.bytes.length),
        "Cache-Control": "private,no-store",
      })
      .send(Buffer.from(media.bytes));
  });
  app.post("/api/statuses/:id/view", async (req, res) => {
    const item = await statuses.get(req.params.id, req.actor.id);
    const result = await statuses.view(req.params.id, req.actor.id);
    if (item.owner.id !== req.actor.id)
      io.to("user:" + item.owner.id).emit("statuses:changed", {
        ownerId: item.owner.id,
      });
    res.json(result);
  });
  app.delete("/api/statuses/:id", async (req, res) => {
    const result = await statuses.remove(req.params.id, req.actor.id);
    await statusChanged(req.actor.id);
    res.json(result);
  });
  app.get("/api/call-config", (req, res) => res.json({ iceServers: config.iceServers || [{ urls: ["stun:stun.l.google.com:19302"] }] }));
  app.post("/api/conversations", async (req, res) => {
    const c = await chat.create(req.actor.id, req.body);
    await changed(c.id);
    res.status(201).json(c);
  });
  app.delete("/api/conversations/:id", async (req, res) => {
    await chat.hide(req.params.id, req.actor.id);
    calls.leaveUser(req.actor.id, req.params.id);
    io.to("user:" + req.actor.id).emit("conversations:changed");
    res.status(204).end();
  });
  app.get("/api/conversations/:id/call", async (req, res) => {
    await chat.canInteract(req.params.id, req.actor.id);
    res.json(calls.state(req.params.id));
  });
  app.get("/api/conversations/:id/messages", async (req, res) =>
    res.json(await chat.history(req.params.id, req.actor.id, req.query.before)),
  );
  app.get("/api/conversations/:id/receipts", async (req, res) =>
    res.json(await chat.receipts(req.params.id, req.actor.id)),
  );
  app.get("/api/conversations/:id/presence", async (req, res) => {
    await chat.membership(req.params.id, req.actor.id);
    const blocked = await chat.blocked(req.params.id, req.actor.id);
    res.json(
      blocked
        ? []
        : (await chat.recipients(req.params.id)).filter((id) => online.has(id)),
    );
  });
  app.post("/api/conversations/:id/messages", async (req, res) => {
    const m = await chat.send(req.params.id, req.actor.id, req.body);
    await broadcastVisible(m, "message:new");
    res.status(201).json(m);
  });
  app.post("/api/conversations/:id/read", async (req, res) => {
    const receipt = await chat.read(
      req.params.id,
      req.actor.id,
      req.body.lastReadId,
    );
    await broadcast(req.params.id, "message:read", receipt);
    res.json(receipt);
  });
  app.delete("/api/messages/:id", async (req, res) => {
    const m = await chat.remove(req.params.id, req.actor.id);
    await broadcastVisible(m, "message:updated");
    res.json(m);
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  });
  app.post(
    "/api/conversations/:id/photos",
    rateLimit({
      windowMs: 60000,
      limit: 15,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res, next) => {
      await chat.canInteract(req.params.id, req.actor.id);
      next();
    },
    upload.single("photo"),
    async (req, res) =>
      res
        .status(201)
        .json(await photos.upload(req.params.id, req.actor.id, req.file)),
  );
  app.get("/api/photos/:id", async (req, res) => {
    const bytes = await photos.download(req.params.id, req.actor.id);
    res
      .set({
        "Content-Type": "image/jpeg",
        "Cache-Control": "private,no-store",
      })
      .send(Buffer.from(bytes));
  });
  app.post(
    "/api/conversations/:id/voice",
    rateLimit({ windowMs: 60000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false }),
    async (req, res, next) => {
      await chat.canInteract(req.params.id, req.actor.id);
      next();
    },
    multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1 } }).single("voice"),
    async (req, res) => res.status(201).json(await voiceNotes.upload(req.params.id, req.actor.id, req.file, req.body.durationMs)),
  );
  app.get("/api/voice/:id", async (req, res) => {
    const note = await voiceNotes.download(req.params.id, req.actor.id);
    res.set({ "Content-Type": note.mimeType, "Cache-Control": "private,no-store" }).send(Buffer.from(note.bytes));
  });
  app.get("/api/blocks", async (req, res) =>
    res.json(await chat.blocks(req.actor.id)),
  );
  app.put("/api/blocks/:id", async (req, res) => {
    const result = await chat.block(req.actor.id, req.params.id);
    await calls.block(req.actor.id, req.params.id);
    io.to("user:" + req.actor.id).emit("conversations:changed");
    io.to("user:" + req.params.id).emit("conversations:changed");
    io.to("user:" + req.actor.id).emit("statuses:changed");
    io.to("user:" + req.params.id).emit("statuses:changed");
    res.json(result);
  });
  app.delete("/api/blocks/:id", async (req, res) => {
    res.json(await chat.unblock(req.actor.id, req.params.id));
    io.to("user:" + req.actor.id).emit("conversations:changed");
    io.to("user:" + req.params.id).emit("conversations:changed");
    io.to("user:" + req.actor.id).emit("statuses:changed");
    io.to("user:" + req.params.id).emit("statuses:changed");
  });
  app.post("/api/reports", async (req, res) =>
    res
      .status(201)
      .json(
        await chat.report(req.actor.id, req.body.messageId, req.body.reason),
      ),
  );
  app.get("/api/reports", async (req, res) => {
    if (!req.actor.moderator) fail(403, "Moderator access required");
    res.json(
      await db.all(
        "SELECT r.id,r.reason,r.status,r.created_at,m.text AS message_text,p.handle AS reporter_handle FROM reports r JOIN messages m ON m.id=r.message_id JOIN profiles p ON p.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 100",
      ),
    );
  });
  app.patch("/api/reports/:id", async (req, res) => {
    if (!req.actor.moderator) fail(403, "Moderator access required");
    uuid(req.params.id);
    if (req.body.status !== "reviewed") fail(400, "Invalid report status");
    const r = await db.one(
      "UPDATE reports SET status='reviewed' WHERE id=$1 RETURNING id,status",
      [req.params.id],
    );
    if (!r) fail(404, "Report not found");
    res.json(r);
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API route not found" }),
  );
  const root = fileURLToPath(new URL("../dist/", import.meta.url));
  if (existsSync(root + "index.html")) {
    app.use(express.static(root));
    app.get("/{*path}", (req, res) => res.sendFile(root + "index.html"));
  }
  app.use((e, req, res, next) => {
    if (res.headersSent) return next(e);
    if (e.code === "23505")
      return res
        .status(409)
        .json({ error: "That handle or attachment is already in use" });
    if (e instanceof multer.MulterError)
      return res.status(400).json({
        error:
          e.field === "media"
            ? "Choose one status photo up to 5 MB or video up to 25 MB"
            : "Choose one attachment up to 5 MB",
      });
    if (e.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON" });
    if (e.type === "entity.too.large")
      return res.status(413).json({ error: "Request is too large" });
    if (e instanceof HttpError)
      return res.status(e.status).json({ error: e.message });
    console.error("Request failed", e.code || e.name);
    res
      .status(500)
      .json({ error: "Unable to complete this request. Please retry" });
  });
  async function broadcast(id, event, value) {
    for (const user of await chat.recipients(id))
      io.to("user:" + user).emit(event, value);
  }
  async function broadcastVisible(message, event) {
    const viewers = await db.all(
      "SELECT user_id FROM members WHERE conversation_id=$1 AND hidden_before_id<$2::bigint",
      [message.conversationId, message.id],
    );
    for (const viewer of viewers)
      io.to("user:" + viewer.user_id).emit(event, message);
  }
  async function changed(id) {
    await broadcast(id, "conversations:changed");
  }
  async function statusChanged(owner) {
    for (const user of await statuses.audience(owner))
      io.to("user:" + user).emit("statuses:changed", { ownerId: owner });
  }
  async function presence(id) {
    const peers = await db.all(
      "SELECT DISTINCT other.user_id FROM members mine JOIN members other ON other.conversation_id=mine.conversation_id WHERE mine.user_id=$1 AND other.user_id<>$1 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=other.user_id) OR (b.blocked_id=$1 AND b.blocker_id=other.user_id))",
      [id],
    );
    for (const peer of peers)
      io.to("user:" + peer.user_id).emit("presence:changed", {
        userId: id,
        online: online.has(id),
      });
  }
  io.use(async (socket, next) => {
    try {
      socket.data.actor = await auth.actor(socket.handshake.auth?.token);
      next();
    } catch (e) {
      next(new Error(e.message));
    }
  });
  io.on("connection", (socket) => {
    const user = socket.data.actor.id;
    socket.join("user:" + user);
    calls.register(socket);
    online.set(user, (online.get(user) || 0) + 1);
    presence(user).catch(() => {});
    const expiry = setTimeout(
      () => {
        socket.emit("auth:expired");
        socket.disconnect(true);
      },
      Math.max(1, socket.data.actor.expires * 1000 - Date.now()),
    );
    expiry.unref();
    socket.use(async (packet, next) => {
      try {
        const now = Date.now();
        const rate = socketRates.get(user);
        if (!rate || now - rate.start > 60000)
          socketRates.set(user, { start: now, count: 1 });
        else if (++rate.count > 120) fail(429, "Please slow down");
        socket.data.actor = await auth.actor(socket.handshake.auth.token);
        next();
      } catch (e) {
        socket.emit("operation:error", { error: e.message });
        socket.disconnect(true);
        next(e);
      }
    });
    socket.on("message:send", async (body, callback) => {
      const ack = typeof callback === "function" ? callback : () => {};
      try {
        if (!body || typeof body !== "object") fail(400, "Invalid message");
        const m = await chat.send(body.conversationId, user, body);
        await broadcastVisible(m, "message:new");
        ack({ ok: true, value: m });
      } catch (e) {
        ack({
          ok: false,
          error: e.status ? e.message : "Message could not be sent",
          status: e.status || 500,
        });
      }
    });
    socket.on("typing", async (body) => {
      try {
        if (!body || typeof body.active !== "boolean") return;
        await chat.canInteract(body.conversationId, user);
        for (const peer of await chat.recipients(body.conversationId))
          if (peer !== user)
            io.to("user:" + peer).emit("typing", {
              conversationId: body.conversationId,
              userId: user,
              name: socket.data.actor.name,
              active: body.active,
            });
      } catch {
        /* Unauthorized typing emits nothing. */
      }
    });
    socket.on("disconnect", () => {
      clearTimeout(expiry);
      const count = (online.get(user) || 1) - 1;
      if (count) online.set(user, count);
      else {
        online.delete(user);
        socketRates.delete(user);
      }
      presence(user).catch(() => {});
    });
  });
  return {
    app,
    server,
    io,
    chat,
    photos,
    voiceNotes,
    statuses,
    calls,
    auth,
    close: () =>
      new Promise((resolve) => {
        calls.close();
        io.close(() => server.close(() => resolve()));
        if (!server.listening) resolve();
      }),
  };
}
