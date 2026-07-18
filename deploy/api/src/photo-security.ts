export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOAD_TTL_SECONDS = 15 * 60;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PHOTO_KEY = new RegExp(`^(?:courts|avatars)/${UUID}/${UUID}\\.jpg$`);
const AUTHORIZATION = /^PullUp-Upload ([1-9][0-9]{9})\.([0-9a-f]{64})$/i;
export interface UploadCredentials {
  expiresAt: string;
  signature: string;
}

export function isAllowedPhotoKey(key: string): boolean {
  return PHOTO_KEY.test(key);
}

export function isJpegContentType(value: string | null): boolean {
  return value?.trim().toLowerCase() === "image/jpeg";
}

export function hasJpegMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function readUploadCredentials(
  request: Request,
): UploadCredentials | null {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return null;
  const match = AUTHORIZATION.exec(authorization);
  if (!match) return null;
  return {
    expiresAt: match[1]!,
    signature: match[2]!.toLowerCase(),
  };
}

export async function verifyUploadSignature(
  secret: string,
  key: string,
  credentials: UploadCredentials,
  nowMs = Date.now(),
): Promise<boolean> {
  const expiresAt = Number(credentials.expiresAt);
  const now = Math.floor(nowMs / 1000);
  if (
    !secret ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + MAX_UPLOAD_TTL_SECONDS
  ) {
    return false;
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    cryptoKey,
    hexToBytes(credentials.signature),
    new TextEncoder().encode(`${key}:${credentials.expiresAt}`),
  );
}

// Constant-time string comparison for shared-secret headers. Length mismatch
// returns early, which only reveals the secret's length, not its content.
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.byteLength; i++) diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  return diff === 0;
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
