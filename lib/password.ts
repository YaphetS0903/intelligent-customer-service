import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);
const keyLength = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, keyLength)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash: string | null | undefined) {
  if (!passwordHash) {
    return false;
  }

  const [algorithm, salt, key] = passwordHash.split(":");
  if (algorithm !== "scrypt" || !salt || !key) {
    return false;
  }

  const expected = Buffer.from(key, "hex");
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
