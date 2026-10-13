import express from "express";
const routes = new Set([
  "GET /get-session",
  "GET /token",
  "POST /sign-in/email",
  "POST /sign-up/email",
  "POST /sign-out",
  "POST /email-otp/send-verification-otp",
  "POST /email-otp/verify-email",
  "POST /email-otp/reset-password",
]);
// Keep the managed identity provider while using first-party browser cookies.
// The destination is configuration-owned; clients cannot select an upstream.
export function authProxy(config, upstreamFetch = fetch) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    if (!routes.has(`${req.method} ${req.path}`))
      return res.status(404).json({ message: "Auth route not found" });
    try {
      const headers = {
        "Content-Type": "application/json",
        Origin: config.publicUrl,
      };
      if (req.headers.cookie) headers.Cookie = req.headers.cookie;
      const upstream = await upstreamFetch(
        config.authUrl.replace(/\/$/, "") + req.url,
        {
          method: req.method,
          headers,
          body:
            req.method === "GET" ? undefined : JSON.stringify(req.body || {}),
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (upstream.status >= 300 && upstream.status < 400)
        return res
          .status(502)
          .json({ message: "Unexpected authentication redirect" });
      for (const cookie of upstream.headers.getSetCookie())
        res.append(
          "Set-Cookie",
          cookie
            .replace(/;\s*Domain=[^;]*/gi, "")
            .replace(/;\s*Path=[^;]*/gi, "; Path=/"),
        );
      const jwt = upstream.headers.get("set-auth-jwt");
      if (jwt) res.set("set-auth-jwt", jwt);
      res
        .status(upstream.status)
        .type("application/json")
        .send(await upstream.text());
    } catch (error) {
      res
        .status(502)
        .json({
          message: "Sign-in service is unavailable. Please retry shortly.",
        });
    }
  });
  return router;
}
