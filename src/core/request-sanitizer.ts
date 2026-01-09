import type { RequestOptions } from "./types.js";

export interface SanitizerOptions {
  redactedKeys?: string[];
}

const DEFAULT_REDACTED = [
  "authorization",
  "cookie",
  "token",
  "apikey",
  "api_key",
  "body",
];

export function sanitizeRequestOptions(options: RequestOptions | undefined, opts?: SanitizerOptions): RequestOptions {
  const redacted = (opts?.redactedKeys ?? DEFAULT_REDACTED).map(k => k.toLowerCase());
  const input = options ?? {};

  const sanitized: RequestOptions = { ...input };

  // Sanitize headers
  if (sanitized.headers) {
    const headersCopy: Record<string, string> = {};
    for (const [k, v] of Object.entries(sanitized.headers)) {
      const lower = k.toLowerCase().replace(/[-_]/g, ""); // Normalize hyphens/underscores
      const lowerValue = String(v).toLowerCase();
      // Check if key (normalized) or value contains any redacted term
      if (redacted.some(r => {
        const normalizedR = r.replace(/[-_]/g, "");
        return lower.includes(normalizedR) || lowerValue.includes(r);
      })) {
        headersCopy[k] = "[REDACTED]";
      } else {
        headersCopy[k] = v;
      }
    }
    sanitized.headers = headersCopy;
  }

  // Sanitize query params
  if (sanitized.query) {
    const queryCopy: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(sanitized.query)) {
      const lower = k.toLowerCase().replace(/[-_]/g, ""); // Normalize hyphens/underscores
      const lowerValue = String(v).toLowerCase();
      // Check if key (normalized) or value contains any redacted term
      if (redacted.some(r => {
        const normalizedR = r.replace(/[-_]/g, "");
        return lower.includes(normalizedR) || lowerValue.includes(r);
      })) {
        queryCopy[k] = "[REDACTED]";
      } else {
        queryCopy[k] = v;
      }
    }
    sanitized.query = queryCopy;
  }

  // Sanitize body
  if (sanitized.body !== undefined) {
    // If body key is considered sensitive, redact entirely
    if (redacted.includes("body")) {
      sanitized.body = "[REDACTED]";
    }
  }

  return sanitized;
}
