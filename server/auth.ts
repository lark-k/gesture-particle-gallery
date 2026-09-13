import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const tokenHash = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await derive(password, salt, 64)) as Buffer).toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex || !/^[0-9a-f]{128}$/i.test(hex)) return false;
  const actual = (await derive(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hex, "hex"));
}
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
