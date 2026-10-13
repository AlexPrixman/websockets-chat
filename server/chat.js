import { randomUUID } from "node:crypto";
import { fail, text, uuid, cursor, handle } from "./validation.js";
export const profile = (p) => ({
  id: p.id,
  handle: p.handle,
  name: p.name,
  bio: p.bio,
});
export function message(row) {
  return {
    id: String(row.id),
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderHandle: row.sender_handle,
    clientId: row.client_id,
    text: row.deleted_at ? "" : row.text,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    photo:
      !row.deleted_at && row.photo_id
        ? {
            id: row.photo_id,
            width: row.width,
            height: row.height,
            bytes: row.bytes,
          }
        : null,
  };
}
const messageSelect = `SELECT m.*,p.name AS sender_name,p.handle AS sender_handle,ph.width,ph.height,ph.bytes FROM messages m JOIN profiles p ON p.id=m.sender_id LEFT JOIN photos ph ON ph.id=m.photo_id`;
export class Chat {
  constructor(db) {
    this.db = db;
  }
  async membership(id, user) {
    uuid(id);
    const row = await this.db.one(
      "SELECT c.*,m.last_read_id FROM conversations c JOIN members m ON m.conversation_id=c.id WHERE c.id=$1 AND m.user_id=$2",
      [id, user],
    );
    if (!row) fail(404, "Conversation not found");
    return row;
  }
  async blocked(id, user) {
    return !!(await this.db.one(
      "SELECT 1 FROM members m JOIN blocks b ON (b.blocker_id=$2 AND b.blocked_id=m.user_id) OR (b.blocked_id=$2 AND b.blocker_id=m.user_id) WHERE m.conversation_id=$1",
      [id, user],
    ));
  }
  async canInteract(id, user) {
    await this.membership(id, user);
    if (await this.blocked(id, user))
      fail(403, "Messaging is unavailable because a participant is blocked");
  }
  async recipients(id) {
    return (
      await this.db.all(
        "SELECT user_id FROM members WHERE conversation_id=$1",
        [id],
      )
    ).map((m) => m.user_id);
  }
  async people(q, user) {
    const term = text(q || "", "Search", 60, { optional: true });
    return this.db.all(
      `SELECT id,handle,name,bio FROM profiles p WHERE id<>$1 AND (name ILIKE $2 ESCAPE '\\' OR handle ILIKE $2 ESCAPE '\\') AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=p.id) OR (b.blocked_id=$1 AND b.blocker_id=p.id)) ORDER BY lower(name),id LIMIT 20`,
      [user, "%" + term.replace(/[\\%_]/g, "\\$&") + "%"],
    );
  }
  async updateProfile(user, body) {
    const h = handle(body.handle),
      name = text(body.name, "Name", 80),
      bio = text(body.bio, "Bio", 160, { optional: true });
    return profile(
      (
        await this.db.query(
          "UPDATE profiles SET handle=$1,name=$2,bio=$3 WHERE id=$4 RETURNING *",
          [h, name, bio, user],
        )
      ).rows[0],
    );
  }
  async conversations(user) {
    const rows = await this.db.all(
      `SELECT c.id,c.kind,c.title,c.owner_id,c.created_at,coalesce(last.created_at,c.created_at) AS updated_at,
   (SELECT jsonb_agg(jsonb_build_object('id',p.id,'handle',p.handle,'name',p.name,'bio',p.bio) ORDER BY p.name) FROM members mm JOIN profiles p ON p.id=mm.user_id WHERE mm.conversation_id=c.id) AS members,
   (SELECT count(*)::int FROM messages unread WHERE unread.conversation_id=c.id AND unread.id>mine.last_read_id AND unread.sender_id<>$1) AS unread,
   last.text AS last_text,last.deleted_at AS last_deleted,last.photo_id AS last_photo,last.sender_id AS last_sender,
   EXISTS(SELECT 1 FROM members bm JOIN blocks b ON (b.blocker_id=$1 AND b.blocked_id=bm.user_id) OR (b.blocked_id=$1 AND b.blocker_id=bm.user_id) WHERE bm.conversation_id=c.id) AS blocked
   FROM conversations c JOIN members mine ON mine.conversation_id=c.id AND mine.user_id=$1
   LEFT JOIN LATERAL(SELECT * FROM messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) last ON true
   ORDER BY coalesce(last.created_at,c.created_at) DESC,c.id LIMIT 50`,
      [user],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      ownerId: r.owner_id,
      members: r.members,
      unread: r.unread,
      blocked: r.blocked,
      updatedAt: r.updated_at,
      lastMessage: r.last_deleted
        ? "Message removed"
        : r.last_photo
          ? r.last_text || "Photo"
          : r.last_text || "Start the conversation",
      lastSender: r.last_sender,
    }));
  }
  async create(user, body) {
    const kind =
      body.kind === "group"
        ? "group"
        : body.kind === "direct"
          ? "direct"
          : null;
    if (!kind) fail(400, "Choose a direct or group conversation");
    if (
      !Array.isArray(body.memberIds) ||
      body.memberIds.some((x) => typeof x !== "string") ||
      body.memberIds.length > 8
    )
      fail(400, "Select up to eight people");
    const ids = [...new Set([user, ...body.memberIds])].sort();
    if (ids.length < 2 || (kind === "direct" && ids.length !== 2))
      fail(400, "Select the people you want to message");
    const title = kind === "group" ? text(body.title, "Group name", 60) : "";
    return this.db.transaction(async () => {
      const found = await this.db.all(
        "SELECT id FROM profiles WHERE id=ANY($1::text[])",
        [ids],
      );
      if (found.length !== ids.length)
        fail(404, "A selected person is unavailable");
      if (
        await this.db.one(
          "SELECT 1 FROM blocks WHERE blocker_id=ANY($1::text[]) AND blocked_id=ANY($1::text[])",
          [ids],
        )
      )
        fail(403, "A selected person is blocked");
      const key = kind === "direct" ? ids.join("|") : null;
      if (key) {
        const existing = await this.db.one(
          "SELECT id FROM conversations WHERE direct_key=$1",
          [key],
        );
        if (existing) return { id: existing.id };
      }
      const id = randomUUID();
      await this.db.query(
        "INSERT INTO conversations(id,kind,title,owner_id,direct_key) VALUES ($1,$2,$3,$4,$5)",
        [id, kind, title, user, key],
      );
      for (const member of ids)
        await this.db.query(
          "INSERT INTO members(conversation_id,user_id) VALUES ($1,$2)",
          [id, member],
        );
      return { id };
    });
  }
  async history(id, user, before) {
    await this.membership(id, user);
    const edge = cursor(before);
    const rows = await this.db.all(
      `${messageSelect} WHERE m.conversation_id=$1 ${edge ? "AND m.id<$2::bigint" : ""} ORDER BY m.id DESC LIMIT 41`,
      edge ? [id, edge] : [id],
    );
    const hasMore = rows.length > 40;
    return {
      items: rows.slice(0, 40).reverse().map(message),
      hasMore,
      nextCursor: hasMore ? String(rows[39].id) : null,
    };
  }
  async send(id, user, body) {
    uuid(body.clientId);
    const content = text(body.text, "Message", 4000, { optional: true });
    if (!content && !body.photoId)
      fail(400, "Write a message or choose a photo");
    if (body.photoId) uuid(body.photoId);
    return this.db.transaction(async () => {
      await this.canInteract(id, user);
      const existing = await this.db.one(
        `${messageSelect} WHERE m.conversation_id=$1 AND m.sender_id=$2 AND m.client_id=$3`,
        [id, user, body.clientId],
      );
      if (existing) return message(existing);
      if (body.photoId) {
        const photo = await this.db.one(
          "SELECT * FROM photos WHERE id=$1 AND conversation_id=$2 AND owner_id=$3 AND status='ready'",
          [body.photoId, id, user],
        );
        if (!photo) fail(400, "Photo is unavailable for this conversation");
      }
      const r = await this.db.one(
        "INSERT INTO messages(conversation_id,sender_id,client_id,text,photo_id) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [id, user, body.clientId, content, body.photoId || null],
      );
      return message(
        await this.db.one(`${messageSelect} WHERE m.id=$1`, [r.id]),
      );
    });
  }
  async read(id, user, last) {
    cursor(last);
    await this.membership(id, user);
    const row = await this.db.one(
      "SELECT id FROM messages WHERE id=$1 AND conversation_id=$2",
      [last, id],
    );
    if (!row)
      fail(400, "Read position must reference a message in this conversation");
    await this.db.query(
      "UPDATE members SET last_read_id=greatest(last_read_id,$1::bigint) WHERE conversation_id=$2 AND user_id=$3",
      [last, id, user],
    );
    return { userId: user, conversationId: id, lastReadId: last };
  }
  async receipts(id, user) {
    await this.membership(id, user);
    return (
      await this.db.all(
        "SELECT user_id,last_read_id FROM members WHERE conversation_id=$1",
        [id],
      )
    ).map((m) => ({ userId: m.user_id, lastReadId: String(m.last_read_id) }));
  }
  async remove(id, user) {
    cursor(id);
    return this.db.transaction(async () => {
      const r = await this.db.one(`${messageSelect} WHERE m.id=$1`, [id]);
      if (!r) fail(404, "Message not found");
      await this.membership(r.conversation_id, user);
      if (r.sender_id !== user)
        fail(403, "You can only remove your own messages");
      await this.db.query(
        "UPDATE messages SET text='',deleted_at=coalesce(deleted_at,now()) WHERE id=$1",
        [id],
      );
      return message(await this.db.one(`${messageSelect} WHERE m.id=$1`, [id]));
    });
  }
  async block(user, target) {
    return this.db.transaction(async () => {
      if (typeof target !== "string" || target === user)
        fail(400, "Choose another person");
      if (!(await this.db.one("SELECT id FROM profiles WHERE id=$1", [target])))
        fail(404, "Person not found");
      await this.db.query(
        "INSERT INTO blocks(blocker_id,blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [user, target],
      );
      return { blocked: true };
    });
  }
  async unblock(user, target) {
    await this.db.query(
      "DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2",
      [user, target],
    );
    return { blocked: false };
  }
  async blocks(user) {
    return this.db.all(
      "SELECT p.id,p.name,p.handle,p.bio FROM blocks b JOIN profiles p ON p.id=b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC",
      [user],
    );
  }
  async report(user, id, reason) {
    cursor(id);
    const r = await this.db.one(
      "SELECT conversation_id FROM messages WHERE id=$1",
      [id],
    );
    if (!r) fail(404, "Message not found");
    await this.membership(r.conversation_id, user);
    const content = text(reason, "Reason", 500);
    await this.db.query(
      "INSERT INTO reports(id,reporter_id,message_id,reason) VALUES ($1,$2,$3,$4) ON CONFLICT(reporter_id,message_id) DO NOTHING",
      [randomUUID(), user, id, content],
    );
    return { submitted: true };
  }
}
