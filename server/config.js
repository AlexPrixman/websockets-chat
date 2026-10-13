import "dotenv/config";
export function configuration(env = process.env) {
  const production = env.NODE_ENV === "production";
  const publicUrl = (
    env.PUBLIC_APP_URL ||
    env.RENDER_EXTERNAL_URL ||
    "http://localhost:5173"
  ).replace(/\/$/, "");
  const origin = new URL(publicUrl);
  if (
    origin.origin !== publicUrl ||
    !["http:", "https:"].includes(origin.protocol)
  )
    throw new Error("PUBLIC_APP_URL must be an HTTP(S) origin");
  if (
    production &&
    (!env.DATABASE_URL ||
      !env.NEON_AUTH_BASE_URL ||
      !env.NEON_AUTH_JWKS_URL ||
      !env.AWS_ACCESS_KEY_ID ||
      !env.AWS_ENDPOINT_URL_S3 ||
      origin.protocol !== "https:" ||
      !env.AWS_SECRET_ACCESS_KEY)
  )
    throw new Error(
      "Production requires database, managed auth, HTTPS, and photo storage configuration",
    );
  return {
    production,
    publicUrl,
    port: Number(env.PORT || 4000),
    databaseUrl: env.DATABASE_URL || "",
    authUrl: env.NEON_AUTH_BASE_URL || "",
    jwksUrl: env.NEON_AUTH_JWKS_URL || "",
    moderatorId: env.MODERATOR_USER_ID || "",
    bucket: env.PHOTO_BUCKET || "chat-photos",
    storageEndpoint: env.AWS_ENDPOINT_URL_S3 || "",
    region: env.AWS_REGION || "us-east-2",
    accessKey: env.AWS_ACCESS_KEY_ID || "",
    storageSecret: env.AWS_SECRET_ACCESS_KEY || "",
  };
}
