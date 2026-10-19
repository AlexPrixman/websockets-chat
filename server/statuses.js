import { randomUUID } from "node:crypto";
import { fail, text, uuid } from "./validation.js";
import { normalizePhoto, reserve } from "./storage.js";

const backgrounds = new Set(["sage", "ocean", "sunset", "dusk", "charcoal"]);
const visibleStatus = `s.upload_status='ready' AND s.expires_at>now() AND (s.owner_id=$1 OR (
  EXISTS(SELECT 1 FROM members mine JOIN members other ON other.conversation_id=mine.conversation_id WHERE mine.user_id=$1 AND other.user_id=s.owner_id)
  AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=s.owner_id) OR (b.blocked_id=$1 AND b.blocker_id=s.owner_id))
))`;
const statusSelect = `SELECT s.*,p.name AS owner_name,p.handle AS owner_handle,
  (SELECT viewed_at FROM status_views WHERE status_id=s.id AND viewer_id=$1) AS viewed_at,
  EXISTS(SELECT 1 FROM status_mentions WHERE status_id=s.id AND user_id=$1) AS tagged,
  (SELECT count(*)::int FROM status_views WHERE status_id=s.id) AS view_count,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',tagged_profile.id,'name',tagged_profile.name,'handle',tagged_profile.handle) ORDER BY lower(tagged_profile.name),tagged_profile.id) FROM status_mentions mention JOIN profiles tagged_profile ON tagged_profile.id=mention.user_id WHERE mention.status_id=s.id),'[]'::jsonb) AS mentions
 FROM statuses s JOIN profiles p ON p.id=s.owner_id`;

function parseJson(value, label) {
  if (value === undefined || value === null || value === "") return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    fail(400, `${label} must be a valid list`);
  }
}

export function statusOverlays(value) {
  const overlays = parseJson(value, "Status decorations");
  if (overlays.length > 8) fail(400, "Add up to eight stickers or time labels");
  return overlays.map((overlay) => {
    if (!overlay || typeof overlay !== "object")
      fail(400, "Status decorations are invalid");
    const type = overlay.type;
    if (!["sticker", "time"].includes(type))
      fail(400, "Status decorations are invalid");
    const value = text(
      overlay.value,
      type === "time" ? "Time label" : "Sticker",
      20,
    );
    const x = Number(overlay.x);
    const y = Number(overlay.y);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 5 ||
      x > 95 ||
      y < 5 ||
      y > 95
    )
      fail(400, "Status decorations must stay inside the canvas");
    return { type, value, x, y };
  });
}

function taggedIds(value) {
  const ids = parseJson(value, "Tagged contacts");
  if (
    ids.length > 10 ||
    ids.some((id) => typeof id !== "string" || id.length > 200)
  )
    fail(400, "Tag up to ten contacts");
  return [...new Set(ids)];
}

export async function normalizeStatusMedia(file) {
  if (!file) return null;
  const mimeType = file.mimetype?.split(";")[0]?.trim().toLowerCase();
  if (["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    const image = await normalizePhoto(file);
    return {
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      mediaType: "image",
      mimeType: "image/jpeg",
      extension: "jpg",
    };
  }
  const bytes = file.buffer;
  const validMp4 =
    mimeType === "video/mp4" && bytes?.subarray(4, 8).toString() === "ftyp";
  const validWebm =
    mimeType === "video/webm" &&
    bytes?.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (
    !bytes?.length ||
    bytes.length > 25 * 1024 * 1024 ||
    (!validMp4 && !validWebm)
  )
    fail(
      400,
      "Choose a JPEG, PNG, WebP, MP4, or WebM file (videos up to 25 MB)",
    );
  return {
    bytes,
    width: null,
    height: null,
    mediaType: "video",
    mimeType,
    extension: mimeType === "video/mp4" ? "mp4" : "webm",
  };
}

function status(row, viewer) {
  const overlays =
    typeof row.overlays === "string" ? JSON.parse(row.overlays) : row.overlays;
  const mentions =
    typeof row.mentions === "string" ? JSON.parse(row.mentions) : row.mentions;
  return {
    id: row.id,
    owner: { id: row.owner_id, name: row.owner_name, handle: row.owner_handle },
    text: row.text,
    background: row.background,
    overlays,
    mentions,
    tagged: row.tagged,
    viewedAt: row.viewed_at,
    viewCount: row.owner_id === viewer ? row.view_count : undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    media: row.object_key
      ? {
          type: row.media_type,
          mimeType: row.mime_type,
          width: row.width,
          height: row.height,
          bytes: row.bytes,
        }
      : null,
  };
}

export class Statuses {
  constructor(db, files) {
    this.db = db;
    this.files = files;
  }

  async cleanupExpired() {
    const rows = await this.db.all(
      "SELECT id,object_key FROM statuses WHERE expires_at<=now() ORDER BY expires_at LIMIT 50",
    );
    for (const row of rows) {
      if (row.object_key && this.files.remove) {
        try {
          await this.files.remove(row.object_key);
        } catch {
          continue;
        }
      }
      await this.db.query(
        "DELETE FROM statuses WHERE id=$1 AND expires_at<=now()",
        [row.id],
      );
    }
  }

  async contacts(user) {
    return this.db.all(
      `SELECT DISTINCT p.id,p.name,p.handle,p.bio FROM members mine JOIN members other ON other.conversation_id=mine.conversation_id AND other.user_id<>mine.user_id JOIN profiles p ON p.id=other.user_id WHERE mine.user_id=$1 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=$1 AND b.blocked_id=p.id) OR (b.blocked_id=$1 AND b.blocker_id=p.id)) ORDER BY p.name,p.id LIMIT 100`,
      [user],
    );
  }

  async audience(owner) {
    return [owner, ...(await this.contacts(owner)).map((person) => person.id)];
  }

  async list(viewer) {
    await this.cleanupExpired();
    const rows = await this.db.all(
      `${statusSelect} WHERE ${visibleStatus} ORDER BY s.created_at,s.id`,
      [viewer],
    );
    return rows.map((row) => status(row, viewer));
  }

  async get(id, viewer) {
    uuid(id);
    const row = await this.db.one(
      `${statusSelect} WHERE s.id=$2 AND ${visibleStatus}`,
      [viewer, id],
    );
    if (!row) fail(404, "Status not found");
    return status(row, viewer);
  }

  async create(owner, body, file) {
    await this.cleanupExpired();
    const content = text(body.text, "Status text", 500, { optional: true });
    const background = backgrounds.has(body.background)
      ? body.background
      : "sage";
    const overlays = statusOverlays(body.overlays);
    const tags = taggedIds(body.taggedIds);
    const media = await normalizeStatusMedia(file);
    if (!content && !media && overlays.length === 0)
      fail(400, "Add text, a sticker, a photo, or a video to your status");
    const id = randomUUID();
    const key = media ? `statuses/${owner}/${id}.${media.extension}` : null;
    await this.db.transaction(async () => {
      const active = await this.db.one(
        "SELECT count(*)::int AS count FROM statuses WHERE owner_id=$1 AND upload_status IN ('uploading','ready') AND expires_at>now()",
        [owner],
      );
      if (active.count >= 20)
        fail(429, "You can have up to 20 active statuses");
      if (media) await reserve(this.db, owner, media.bytes.length);
      if (tags.length) {
        const allowed = new Set(
          (await this.contacts(owner)).map((person) => person.id),
        );
        if (tags.some((tag) => !allowed.has(tag)))
          fail(400, "Only current, unblocked contacts can be tagged");
      }
      await this.db.query(
        "INSERT INTO statuses(id,owner_id,object_key,bytes,width,height,media_type,mime_type,text,background,overlays,upload_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)",
        [
          id,
          owner,
          key,
          media?.bytes.length || null,
          media?.width || null,
          media?.height || null,
          media?.mediaType || null,
          media?.mimeType || null,
          content,
          background,
          JSON.stringify(overlays),
          media ? "uploading" : "ready",
        ],
      );
      if (tags.length)
        await this.db.query(
          "INSERT INTO status_mentions(status_id,user_id) SELECT $1,unnest($2::text[])",
          [id, tags],
        );
    });
    if (media) {
      try {
        await this.files.put(key, media.bytes, media.mimeType);
        await this.db.query(
          "UPDATE statuses SET upload_status='ready' WHERE id=$1",
          [id],
        );
      } catch {
        await this.db.query(
          "UPDATE statuses SET upload_status='failed' WHERE id=$1",
          [id],
        );
        fail(503, "Status upload failed. Please retry");
      }
    }
    return this.get(id, owner);
  }

  async view(id, viewer) {
    const item = await this.get(id, viewer);
    if (item.owner.id !== viewer)
      await this.db.query(
        "INSERT INTO status_views(status_id,viewer_id) VALUES ($1,$2) ON CONFLICT(status_id,viewer_id) DO UPDATE SET viewed_at=least(status_views.viewed_at,excluded.viewed_at)",
        [id, viewer],
      );
    return { viewed: item.owner.id !== viewer };
  }

  async download(id, viewer) {
    const item = await this.get(id, viewer);
    if (!item.media) fail(404, "Status media not found");
    const row = await this.db.one(
      "SELECT object_key FROM statuses WHERE id=$1",
      [id],
    );
    if (!row) fail(404, "Status media not found");
    return {
      bytes: await this.files.get(row.object_key),
      mimeType: item.media.mimeType,
    };
  }

  async remove(id, owner) {
    uuid(id);
    const row = await this.db.one(
      "DELETE FROM statuses WHERE id=$1 AND owner_id=$2 RETURNING object_key",
      [id, owner],
    );
    if (!row) fail(404, "Status not found");
    if (row.object_key && this.files.remove)
      try {
        await this.files.remove(row.object_key);
      } catch {
        // Access is already revoked by deleting the database row. Object-store
        // lifecycle rules remain the fallback if physical deletion is delayed.
      }
    return { deleted: true, ownerId: owner };
  }
}
