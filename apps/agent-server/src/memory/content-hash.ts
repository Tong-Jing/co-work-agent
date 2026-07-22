import { createHash } from "node:crypto";

export function contentHash(content: string): string {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,!?;:]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}
