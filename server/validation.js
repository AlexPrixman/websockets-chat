export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new HttpError(status, message);
};
export function text(value, label, max, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return "";
  if (
    typeof value !== "string" ||
    (!optional && !value.trim()) ||
    value.trim().length > max
  )
    fail(
      400,
      `${label} must contain ${optional ? "0" : "1"}–${max} characters`,
    );
  return value.trim();
}
export function uuid(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    fail(400, "Invalid record identifier");
  return value;
}
export function cursor(value) {
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    !/^\d{1,18}$/.test(value) ||
    BigInt(value) < 1n
  )
    fail(400, "Invalid message cursor");
  return value;
}
export function handle(value) {
  const h = text(value, "Handle", 24).toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(h))
    fail(
      400,
      "Handle must start with a letter and contain 3–24 letters, numbers, or underscores",
    );
  return h;
}
