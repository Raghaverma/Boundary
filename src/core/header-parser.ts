/**
 * Hardened header parsing utilities
 *
 * These utilities parse HTTP headers safely, handling malformed input
 * and edge cases that could cause issues.
 */

/**
 * Parses the Retry-After header value.
 *
 * The header can be:
 * - A number of seconds (e.g., "120")
 * - An HTTP-date (e.g., "Wed, 21 Oct 2015 07:28:00 GMT")
 *
 * @param header The Retry-After header value
 * @returns Date when retry is allowed, or null if invalid
 */
export function parseRetryAfter(header: string | null): Date | null {
  if (!header || typeof header !== "string") {
    return null;
  }

  const trimmed = header.trim();

  // Try parsing as seconds first (more common)
  const seconds = parseInt(trimmed, 10);
  if (!isNaN(seconds) && seconds >= 0 && seconds <= 86400 * 365) {
    // Cap at 1 year to prevent overflow
    return new Date(Date.now() + seconds * 1000);
  }

  // Try parsing as HTTP-date
  const date = Date.parse(trimmed);
  if (!isNaN(date)) {
    const parsedDate = new Date(date);
    // Validate date is reasonable (not in past, not too far in future)
    const now = Date.now();
    if (parsedDate.getTime() > now && parsedDate.getTime() < now + 86400 * 365 * 1000) {
      return parsedDate;
    }
  }

  return null;
}

/**
 * Parsed Link header entry.
 */
export interface LinkHeader {
  url: string;
  rel: string;
  params: Record<string, string>;
}

/**
 * Parses the Link header value.
 *
 * Format: <url1>; rel="next"; param="value", <url2>; rel="prev"
 *
 * @param header The Link header value
 * @returns Array of parsed link entries
 */
export function parseLinkHeader(header: string | null): LinkHeader[] {
  if (!header || typeof header !== "string") {
    return [];
  }

  const links: LinkHeader[] = [];

  // Split by comma, but be careful of commas in URLs
  const parts = splitLinkHeader(header);

  for (const part of parts) {
    const link = parseSingleLink(part.trim());
    if (link) {
      links.push(link);
    }
  }

  return links;
}

/**
 * Splits Link header by commas, handling URLs that may contain commas.
 */
function splitLinkHeader(header: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inAngleBrackets = false;

  for (let i = 0; i < header.length; i++) {
    const char = header[i]!;

    if (char === "<") {
      inAngleBrackets = true;
      current += char;
    } else if (char === ">") {
      inAngleBrackets = false;
      current += char;
    } else if (char === "," && !inAngleBrackets) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Parses a single link entry from the Link header.
 */
function parseSingleLink(link: string): LinkHeader | null {
  // Extract URL from angle brackets
  const urlMatch = link.match(/^<([^>]+)>/);
  if (!urlMatch || !urlMatch[1]) {
    return null;
  }

  const url = urlMatch[1];
  const params: Record<string, string> = {};
  let rel = "";

  // Parse remaining parameters
  const remaining = link.slice(urlMatch[0].length);
  const paramParts = remaining.split(";");

  for (const paramPart of paramParts) {
    const trimmed = paramPart.trim();
    if (!trimmed) continue;

    // Parse key=value or key="value"
    const match = trimmed.match(/^(\w+)=["']?([^"']+)["']?$/);
    if (match && match[1] && match[2]) {
      const key = match[1].toLowerCase();
      const value = match[2];

      if (key === "rel") {
        rel = value;
      } else {
        params[key] = value;
      }
    }
  }

  // rel is required
  if (!rel) {
    return null;
  }

  return { url, rel, params };
}

/**
 * Finds a specific link by rel type.
 *
 * @param links Parsed link headers
 * @param rel The rel type to find (e.g., "next", "prev", "last")
 * @returns The matching link or null
 */
export function findLinkByRel(links: LinkHeader[], rel: string): LinkHeader | null {
  return links.find((link) => link.rel === rel) ?? null;
}

/**
 * Parses rate limit headers safely.
 *
 * Handles various formats:
 * - GitHub: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 * - Standard: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
 *
 * @param headers Response headers
 * @returns Parsed rate limit info or null if not present
 */
export interface ParsedRateLimit {
  limit: number;
  remaining: number;
  reset: Date;
}

export function parseRateLimitHeaders(headers: Headers): ParsedRateLimit | null {
  // Try GitHub-style headers first
  let limit = parseIntHeader(headers.get("X-RateLimit-Limit"));
  let remaining = parseIntHeader(headers.get("X-RateLimit-Remaining"));
  let reset = parseResetHeader(headers.get("X-RateLimit-Reset"));

  // Fall back to standard headers
  if (limit === null) {
    limit = parseIntHeader(headers.get("RateLimit-Limit"));
  }
  if (remaining === null) {
    remaining = parseIntHeader(headers.get("RateLimit-Remaining"));
  }
  if (reset === null) {
    reset = parseResetHeader(headers.get("RateLimit-Reset"));
  }

  // All values must be present and valid
  if (limit === null || remaining === null || reset === null) {
    return null;
  }

  // Sanity checks
  if (limit < 0 || remaining < 0 || remaining > limit) {
    return null;
  }

  return { limit, remaining, reset };
}

/**
 * Parses an integer header value safely.
 */
function parseIntHeader(value: string | null): number | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const parsed = parseInt(value.trim(), 10);
  if (isNaN(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  return parsed;
}

/**
 * Parses a rate limit reset header.
 * Can be a Unix timestamp (seconds) or an HTTP-date.
 */
function parseResetHeader(value: string | null): Date | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  // Try parsing as Unix timestamp (seconds)
  const timestamp = parseInt(trimmed, 10);
  if (!isNaN(timestamp) && timestamp > 0) {
    // Validate it's a reasonable timestamp (not in past, not too far in future)
    const now = Math.floor(Date.now() / 1000);
    if (timestamp >= now - 60 && timestamp < now + 86400 * 365) {
      return new Date(timestamp * 1000);
    }
  }

  // Try parsing as HTTP-date
  const date = Date.parse(trimmed);
  if (!isNaN(date)) {
    const parsedDate = new Date(date);
    const now = Date.now();
    if (parsedDate.getTime() >= now - 60000 && parsedDate.getTime() < now + 86400 * 365 * 1000) {
      return parsedDate;
    }
  }

  return null;
}
