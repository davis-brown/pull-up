import { describe, expect, it } from "vitest";

import {
  hasJpegMagic,
  isAllowedPhotoKey,
  isJpegContentType,
  readUploadCredentials,
  verifyUploadSignature,
} from "./photo-security";

const COURT_ID = "123e4567-e89b-42d3-a456-426614174000";
const PHOTO_ID = "123e4567-e89b-42d3-a456-426614174001";
const KEY = `courts/${COURT_ID}/${PHOTO_ID}.jpg`;

describe("photo key validation", () => {
  it("accepts only generated court and avatar JPEG keys", () => {
    expect(isAllowedPhotoKey(KEY)).toBe(true);
    expect(isAllowedPhotoKey(`avatars/${COURT_ID}/${PHOTO_ID}.jpg`)).toBe(true);
    expect(isAllowedPhotoKey(`courts/${COURT_ID}/../${PHOTO_ID}.jpg`)).toBe(false);
    expect(isAllowedPhotoKey(`courts/${COURT_ID}/${PHOTO_ID}.png`)).toBe(false);
    expect(isAllowedPhotoKey(`courts/${COURT_ID.toUpperCase()}/${PHOTO_ID}.jpg`)).toBe(false);
  });
});

describe("JPEG validation", () => {
  it("requires the canonical media type and JPEG signature", () => {
    expect(isJpegContentType("image/jpeg")).toBe(true);
    expect(isJpegContentType("IMAGE/JPEG ")).toBe(true);
    expect(isJpegContentType("image/jpeg; charset=binary")).toBe(false);
    expect(isJpegContentType("image/png")).toBe(false);
    expect(hasJpegMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(hasJpegMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe("upload authorization", () => {
  it("prefers the signed Authorization header and rejects mixed credentials", () => {
    const signature = "ab".repeat(32);
    const headerRequest = new Request("https://api.example/photos/upload/key", {
      headers: { Authorization: `PullUp-Upload 1900000000.${signature}` },
    });
    expect(readUploadCredentials(headerRequest)).toEqual({
      expiresAt: "1900000000",
      signature,
    });

    const malformed = new Request(
      `https://api.example/photos/upload/key?exp=1900000000&sig=${signature}`,
      { headers: { Authorization: "Bearer something" } },
    );
    expect(readUploadCredentials(malformed)).toBeNull();
    expect(readUploadCredentials(new Request(
      `https://api.example/photos/upload/key?exp=1900000000&sig=${signature}`,
    ))).toBeNull();
  });

  it("verifies HMAC signatures and bounds their lifetime", async () => {
    const secret = "test-only-upload-secret";
    const nowMs = 1_800_000_000_000;
    const expiresAt = String(nowMs / 1000 + 600);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(`${KEY}:${expiresAt}`),
    );
    const signature = [...new Uint8Array(mac)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    await expect(
      verifyUploadSignature(secret, KEY, { expiresAt, signature }, nowMs),
    ).resolves.toBe(true);
    await expect(
      verifyUploadSignature(secret, `${KEY}x`, { expiresAt, signature }, nowMs),
    ).resolves.toBe(false);
    await expect(
      verifyUploadSignature(
        secret,
        KEY,
        { expiresAt: String(nowMs / 1000 + 901), signature },
        nowMs,
      ),
    ).resolves.toBe(false);
  });
});
