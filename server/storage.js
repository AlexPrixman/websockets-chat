import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
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
    put: async (key, bytes) =>
      s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: "image/jpeg",
          CacheControl: "private,no-store",
        }),
      ),
    get: async (key) =>
      (
        await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
      ).Body.transformToByteArray(),
  };
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
      const used = await this.db.one(
        "SELECT coalesce(sum(bytes),0)::bigint AS total,coalesce(sum(bytes) FILTER(WHERE owner_id=$1 AND created_at>now()-interval '1 day'),0)::bigint AS daily FROM photos WHERE status IN ('uploading','ready')",
        [user],
      );
      if (
        Number(used.total) + image.bytes.length > 200 * 1024 * 1024 ||
        Number(used.daily) + image.bytes.length > 25 * 1024 * 1024
      )
        fail(429, "Photo storage limit reached. Try again later");
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
      "SELECT p.* FROM photos p JOIN messages m ON m.photo_id=p.id AND m.deleted_at IS NULL WHERE p.id=$1 AND p.status='ready'",
      [id],
    );
    if (!p) fail(404, "Photo not found");
    await this.chat.membership(p.conversation_id, user);
    return this.files.get(p.object_key);
  }
}
