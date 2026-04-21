import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { getAppEncryptionKey } from "@/lib/utils/env";

const ENCRYPTED_PREFIX = "enc:v1";
const IV_LENGTH = 12;

function normalizeKeyMaterial(secret: string) {
  const trimmed = secret.trim();

  if (/^[A-Fa-f0-9]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    try {
      const decoded = Buffer.from(trimmed, "base64");
      if (decoded.length === 32) {
        return decoded;
      }
    } catch {
      // Fall back to deterministic hashing for non-base64 secret material.
    }
  }

  return createHash("sha256").update(trimmed).digest();
}

function getCipherKey() {
  return normalizeKeyMaterial(getAppEncryptionKey());
}

export function isEncryptedValue(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith(`${ENCRYPTED_PREFIX}:`);
}

export function encryptSensitiveValue(value: string) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getCipherKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSensitiveValue(value: string) {
  if (!isEncryptedValue(value)) {
    return value;
  }

  const [, version, ivBase64, tagBase64, ciphertextBase64] = value.split(":");
  if (version !== "v1" || !ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error("Invalid encrypted secret format.");
  }

  const decipher = createDecipheriv("aes-256-gcm", getCipherKey(), Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final()
  ]);

  return plaintext.toString("utf8");
}
