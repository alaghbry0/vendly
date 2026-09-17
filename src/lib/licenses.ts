import { createHmac, randomBytes } from "crypto";

// License keys look like: WHPL-9X4K-2M7Q-8RT3
const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars

export function generateLicenseKey(prefix = "WHPL"): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    const bytes = randomBytes(4);
    for (let i = 0; i < 4; i++) {
      group += CHARSET[bytes[i] % CHARSET.length];
    }
    groups.push(group);
  }
  return `${prefix}-${groups.join("-")}`;
}

export function maskKey(key: string): string {
  const parts = key.split("-");
  if (parts.length !== 4) return key.slice(0, 4) + "••••";
  return `${parts[0]}-••••-••••-${parts[3]}`;
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(16).toString("hex")}`;
}

export function generateDownloadToken(): string {
  return randomBytes(24).toString("base64url");
}

export function signPayload(secret: string, payload: string): string {
  // Simulated HMAC-SHA256 signature
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}
