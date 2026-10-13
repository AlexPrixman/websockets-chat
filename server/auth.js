import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { fail } from "./validation.js";
export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
export function managedVerifier(config) {
  if (!config.jwksUrl || !config.authUrl)
    throw new Error("Set the Neon auth and JWKS URLs");
  const keys = createRemoteJWKSet(new URL(config.jwksUrl));
  const issuer = new URL(config.authUrl).origin;
  return async (token) =>
    (
      await jwtVerify(token, keys, {
        issuer,
        algorithms: ["EdDSA"],
        requiredClaims: ["sub", "exp", "iat"],
      })
    ).payload;
}
export function authentication(db, config, verify = managedVerifier(config)) {
  async function actor(token) {
    if (typeof token !== "string" || token.length > 10000)
      fail(401, "Sign in to continue");
    let claims;
    try {
      claims = await verify(token);
    } catch {
      fail(401, "Your session expired. Please sign in again");
    }
    if (
      typeof claims.sub !== "string" ||
      claims.sub.length > 200 ||
      !claims.exp ||
      claims.exp * 1000 <= Date.now()
    )
      fail(401, "Your session expired");
    if (
      await db.one(
        "SELECT hash FROM revoked_tokens WHERE hash=$1 AND expires_at>now()",
        [tokenHash(token)],
      )
    )
      fail(401, "This session has signed out");
    const name =
      typeof claims.name === "string" ? claims.name.slice(0, 80) : "New member";
    const handle =
      "user_" +
      createHash("sha256").update(claims.sub).digest("hex").slice(0, 12);
    await db.query(
      "INSERT INTO profiles(id,handle,name) VALUES ($1,$2,$3) ON CONFLICT(id) DO NOTHING",
      [claims.sub, handle, name],
    );
    return {
      ...(await db.one("SELECT id,handle,name,bio FROM profiles WHERE id=$1", [
        claims.sub,
      ])),
      moderator: claims.sub === config.moderatorId,
      expires: claims.exp,
      tokenHash: tokenHash(token),
    };
  }
  const middleware = async (req, res, next) => {
    const h = req.get("authorization");
    if (!h?.startsWith("Bearer ")) fail(401, "Sign in to continue");
    req.actor = await actor(h.slice(7));
    next();
  };
  async function revoke(user) {
    await db.transaction(async () => {
      await db.query("DELETE FROM revoked_tokens WHERE expires_at<=now()");
      await db.query(
        "INSERT INTO revoked_tokens(hash,expires_at) VALUES ($1,to_timestamp($2)) ON CONFLICT DO NOTHING",
        [user.tokenHash, user.expires],
      );
    });
  }
  return { actor, middleware, revoke };
}
