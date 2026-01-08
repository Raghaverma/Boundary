/**
 * Core-side error sanitizer
 *
 * This module ensures that adapter output is strictly compliant with the BoundaryError contract.
 * Even if an adapter returns a malformed error, the core sanitizes it before propagating.
 *
 * INVARIANTS:
 * - Output is ALWAYS a valid BoundaryError
 * - category is always one of the canonical categories
 * - retryable is always a boolean
 * - provider is always set correctly
 * - Unsafe metadata is dropped
 */

import type { BoundaryError, BoundaryErrorCategory } from "./types.js";

/**
 * List of valid canonical error categories.
 */
const VALID_CATEGORIES: readonly BoundaryErrorCategory[] = [
  "auth",
  "rate_limit",
  "network",
  "provider",
  "validation",
] as const;

/**
 * Metadata keys that should be dropped for security.
 * These could leak sensitive information or provider internals.
 */
const UNSAFE_METADATA_KEYS: readonly string[] = [
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "credentials",
  "privateKey",
  "private_key",
] as const;

/**
 * Checks if a category is a valid BoundaryErrorCategory.
 */
function isValidCategory(category: unknown): category is BoundaryErrorCategory {
  return typeof category === "string" && VALID_CATEGORIES.includes(category as BoundaryErrorCategory);
}

/**
 * Determines the category based on error characteristics.
 * Used when adapter provides invalid or missing category.
 */
function inferCategory(error: unknown): BoundaryErrorCategory {
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;

    // Check for status code patterns
    if (typeof err.status === "number") {
      const status = err.status;
      if (status === 401 || status === 403) return "auth";
      if (status === 429) return "rate_limit";
      if (status >= 500) return "provider";
      if (status >= 400) return "validation";
    }

    // Check message patterns
    if (typeof err.message === "string") {
      const msg = err.message.toLowerCase();
      if (msg.includes("timeout") || msg.includes("econnreset") || msg.includes("enotfound")) {
        return "network";
      }
      if (msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("auth")) {
        return "auth";
      }
      if (msg.includes("rate limit") || msg.includes("too many requests")) {
        return "rate_limit";
      }
    }
  }

  // Default to provider error
  return "provider";
}

/**
 * Determines if an error is retryable based on its category and characteristics.
 */
function inferRetryable(category: BoundaryErrorCategory, error: unknown): boolean {
  // Auth errors are never retryable
  if (category === "auth") return false;

  // Rate limit errors are retryable (with backoff)
  if (category === "rate_limit") return true;

  // Network errors are generally retryable
  if (category === "network") return true;

  // Provider errors (5xx) may be retryable
  if (category === "provider") {
    // Check if error explicitly says not retryable
    if (error && typeof error === "object" && "retryable" in error) {
      return Boolean((error as { retryable: unknown }).retryable);
    }
    return true; // Default to retryable for transient server errors
  }

  // Validation errors are not retryable (client error)
  return false;
}

/**
 * Sanitizes metadata by removing unsafe keys.
 */
function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  const lowerUnsafeKeys = UNSAFE_METADATA_KEYS.map((k) => k.toLowerCase());

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();

    // Skip unsafe keys
    if (lowerUnsafeKeys.some((unsafeKey) => lowerKey.includes(unsafeKey))) {
      continue;
    }

    // Recursively sanitize nested objects
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const sanitizedValue = sanitizeMetadata(value as Record<string, unknown>);
      if (sanitizedValue && Object.keys(sanitizedValue).length > 0) {
        sanitized[key] = sanitizedValue;
      }
    } else {
      sanitized[key] = value;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Sanitizes an adapter error output to ensure strict BoundaryError compliance.
 *
 * This function:
 * 1. Validates all required fields exist and have correct types
 * 2. Recomputes category if invalid
 * 3. Recomputes retryable if invalid
 * 4. Ensures provider is correct
 * 5. Drops unsafe metadata
 *
 * @param error The error from adapter.parseError()
 * @param expectedProvider The provider name (must match)
 * @returns A strictly compliant BoundaryError
 */
export function sanitizeBoundaryError(
  error: unknown,
  expectedProvider: string
): BoundaryError {
  // Handle null/undefined
  if (!error) {
    return createFallbackError("Unknown error", expectedProvider);
  }

  // Handle non-objects
  if (typeof error !== "object") {
    return createFallbackError(String(error), expectedProvider);
  }

  const err = error as Record<string, unknown>;

  // Extract and validate message
  const message = typeof err.message === "string" && err.message.length > 0
    ? err.message
    : "Unknown error";

  // Extract and validate/recompute category
  const rawCategory = err.category;
  const category: BoundaryErrorCategory = isValidCategory(rawCategory)
    ? rawCategory
    : inferCategory(error);

  // Extract and validate/recompute retryable
  const rawRetryable = err.retryable;
  const retryable: boolean = typeof rawRetryable === "boolean"
    ? rawRetryable
    : inferRetryable(category, error);

  // Provider MUST match expected provider
  const provider = expectedProvider;

  // Extract and sanitize metadata
  const rawMetadata = err.metadata as Record<string, unknown> | undefined;
  const metadata = sanitizeMetadata(rawMetadata);

  // Extract retryAfter if present and valid
  let retryAfter: Date | undefined;
  if (err.retryAfter instanceof Date) {
    retryAfter = err.retryAfter;
  } else if (typeof err.retryAfter === "number") {
    retryAfter = new Date(Date.now() + err.retryAfter * 1000);
  } else if (typeof err.retryAfter === "string") {
    const parsed = Date.parse(err.retryAfter);
    if (!isNaN(parsed)) {
      retryAfter = new Date(parsed);
    }
  }

  // Construct sanitized BoundaryError
  const sanitized: BoundaryError = {
    name: "BoundaryError",
    message,
    category,
    retryable,
    provider,
  };

  // Only add optional properties if defined
  if (metadata !== undefined) {
    sanitized.metadata = metadata;
  }
  if (retryAfter !== undefined) {
    sanitized.retryAfter = retryAfter;
  }

  return sanitized;
}

/**
 * Creates a fallback BoundaryError when adapter output is completely unusable.
 */
function createFallbackError(message: string, provider: string): BoundaryError {
  return {
    name: "BoundaryError",
    message,
    category: "provider",
    retryable: false,
    provider,
  };
}
