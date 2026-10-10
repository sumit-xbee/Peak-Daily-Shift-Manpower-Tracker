import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** 256-bit URL-safe random token. */
export const newToken = () => randomBytes(32).toString("base64url");

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** 6-digit one-time login code. */
export const newLoginCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
