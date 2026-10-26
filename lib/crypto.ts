import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// AES-256-GCM for stored API keys. Server-only: both call sites are server
// (actions/credential.ts writes, app/api/chat/route.ts reads), so the plain
// key never enters the client bundle.
//
// The key lives in CREDENTIAL_ENC_KEY — a 32-byte secret, written as 64 hex
// chars (generate one with `openssl rand -hex 32` into .env.local).
const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const TAG_LENGTH = 16

function encryptionKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENC_KEY
  if (!raw || !/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error(
      "CREDENTIAL_ENC_KEY must be a 64-character hex string (32 bytes). " +
        "Generate one with `openssl rand -hex 32` and add it to .env.local."
    )
  }
  return Buffer.from(raw, "hex")
}

// Payload layout (one base64 string, stored in credentials.api_key):
//   iv (12 bytes) ‖ auth tag (16 bytes) ‖ ciphertext
// Random 96-bit IV per key + a fresh AES key = no IV reuse in practice.
export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")
}

export function decryptCredential(payload: string): string {
  const data = Buffer.from(payload, "base64")
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Malformed credential payload.")
  }
  const iv = data.subarray(0, IV_LENGTH)
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  )
}
