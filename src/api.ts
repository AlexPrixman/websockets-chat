import { createAuthClient } from "@neondatabase/auth";
export const auth = createAuthClient(`${location.origin}/api/auth`);
export async function token() {
  const { data, error } = await auth.token();
  // Neon may satisfy /token from its session cache. The wrapper injects
  // the signed set-auth-jwt value into session.token in that cached shape.
  const result = data as {
    token?: string;
    session?: { token?: string };
  } | null;
  const bearer = result?.token || result?.session?.token;
  if (error || !bearer) throw new Error("Please sign in again");
  return bearer;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const bearer = await token();
  const res = await fetch("/api" + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(!(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Request failed. Please retry");
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
export const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
