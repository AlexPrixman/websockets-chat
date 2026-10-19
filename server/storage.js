import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { fail, uuid } from "./validation.js";
sharp.concurrency(1);
export function storage(config) {
  const s3 = new S3Client({
    region: config.region,
    endpoint: config.storageEndpoint,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.storageSecret,
    },
    forcePathStyle: true,
  });
  return {
    put: async (key, bytes, contentType = "image/jpeg") =>
      s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          CacheControl: "private,no-store",
        }),
      ),
    get: async (key) =>
      (
        await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
      ).Body.transformToByteArray(),
    remove: async (key) =>
      s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })),
  };
}
const usageQuery = `SELECT coalesce(sum(bytes),0)::bigint AS total,coalesce(sum(bytes) FILTER(WHERE owner_id=$1 AND created_at>now()-interval '1 day'),0)::bigint AS daily FROM (SELECT owner_id,bytes,created_at FROM photos WHERE status IN ('uploading','ready') UNION ALL SELECT owner_id,bytes,created_at FROM voice_notes WHERE status IN ('uploading','ready') UNION ALL SELECT owner_id,bytes,created_at FROM statuses WHERE upload_status IN ('uploading','ready') AND expires_at>now()) objects`;
export async function reserve(db, user, bytes) {
  const used = await db.one(usageQuery, [user]);
  if (
    Number(used.total) + bytes > 200 * 1024 * 1024 ||
    Number(used.daily) + bytes > 75 * 1024 * 1024
  )
    fail(429, "Media storage limit reached. Try again later");
}
export async function normalizePhoto(file) {
  if (
    !file?.buffer ||
    file.buffer.length > 5 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
  )
    fail(400, "Choose a JPEG, PNG, or WebP photo up to 5 MB");
  try {
    const image = sharp(file.buffer, {
      limitInputPixels: 16000000,
      animated: false,
    });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format) || meta.pages > 1)
      fail(400, "Animated images are not supported");
    const { data, info } = await image
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch (error) {
    if (error.status) throw error;
    fail(400, "This file is not a supported photo");
  }
}
export class Photos {
  constructor(db, chat, files) {
    this.db = db;
    this.chat = chat;
    this.files = files;
  }
  async upload(id, user, file) {
    await this.chat.canInteract(id, user);
    const image = await normalizePhoto(file),
      photoId = randomUUID(),
      key = `photos/${id}/${photoId}.jpg`;
    await this.db.transaction(async () => {
      await this.chat.canInteract(id, user);
      await reserve(this.db, user, image.bytes.length);
      await this.db.query(
        "INSERT INTO photos(id,conversation_id,owner_id,object_key,bytes,width,height,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'uploading')",
        [photoId, id, user, key, image.bytes.length, image.width, image.height],
      );
    });
    try {
      await this.files.put(key, image.bytes);
      await this.db.query("UPDATE photos SET status='ready' WHERE id=$1", [
        photoId,
      ]);
      return {
        id: photoId,
        width: image.width,
        height: image.height,
        bytes: image.bytes.length,
      };
    } catch {
      await this.db.query("UPDATE photos SET status='failed' WHERE id=$1", [
        photoId,
      ]);
      fail(503, "Photo upload failed. Please retry");
    }
  }
  async download(id, user) {
    uuid(id);
    const p = await this.db.one(
      "SELECT p.* FROM photos p JOIN messages m ON m.photo_id=p.id AND m.deleted_at IS NULL JOIN members member ON member.conversation_id=m.conversation_id AND member.user_id=$2 AND m.id>member.hidden_before_id WHERE p.id=$1 AND p.status='ready'",
      [id, user],
    );
    if (!p) fail(404, "Photo not found");
    await this.chat.membership(p.conversation_id, user);
    return this.files.get(p.object_key);
  }
}

export function validateVoice(file, duration) {
  const durationMs = Number(duration);
  const mimeType = file?.mimetype?.split(";")[0]?.trim().toLowerCase();
  const bytes = file?.buffer;
  const signature =
    mimeType === "audio/webm"
      ? bytes?.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : mimeType === "audio/ogg"
        ? bytes?.subarray(0, 4).toString() === "OggS"
        : mimeType === "audio/mp4"
          ? bytes?.subarray(4, 8).toString() === "ftyp"
          : false;
  if (
    !bytes?.length ||
    bytes.length > 5 * 1024 * 1024 ||
    !signature ||
    !Number.isInteger(durationMs) ||
    durationMs < 250 ||
    durationMs > 60000
  )
    fail(400, "Record an audio note up to 60 seconds and 5 MB");
  return { bytes, mimeType, durationMs };
}

export class VoiceNotes {
  constructor(db, chat, files) {
    this.db = db;
    this.chat = chat;
    this.files = files;
  }
  async upload(id, user, file, duration) {
    await this.chat.canInteract(id, user);
    const voice = validateVoice(file, duration);
    const noteId = randomUUID();
    const extension = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" }[voice.mimeType];
    const key = `voice/${id}/${noteId}.${extension}`;
    await this.db.transaction(async () => {
      await this.chat.canInteract(id, user);
      await reserve(this.db, user, voice.bytes.length);
      await this.db.query(
        "INSERT INTO voice_notes(id,conversation_id,owner_id,object_key,bytes,duration_ms,mime_type,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'uploading')",
        [noteId, id, user, key, voice.bytes.length, voice.durationMs, voice.mimeType],
      );
    });
    try {
      await this.files.put(key, voice.bytes, voice.mimeType);
      await this.db.query("UPDATE voice_notes SET status='ready' WHERE id=$1", [noteId]);
      return { id: noteId, durationMs: voice.durationMs, mimeType: voice.mimeType, bytes: voice.bytes.length };
    } catch {
      await this.db.query("UPDATE voice_notes SET status='failed' WHERE id=$1", [noteId]);
      fail(503, "Voice note upload failed. Please retry");
    }
  }
  async download(id, user) {
    uuid(id);
    const note = await this.db.one(
      "SELECT v.* FROM voice_notes v JOIN messages m ON m.voice_id=v.id AND m.deleted_at IS NULL JOIN members member ON member.conversation_id=m.conversation_id AND member.user_id=$2 AND m.id>member.hidden_before_id WHERE v.id=$1 AND v.status='ready'",
      [id, user],
    );
    if (!note) fail(404, "Voice note not found");
    return { bytes: await this.files.get(note.object_key), mimeType: note.mime_type };
  }
}
