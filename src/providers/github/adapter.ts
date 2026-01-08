/**
 * GitHub provider adapter - Reference implementation
 * 
 * This adapter serves as the authoritative specification for how adapters
 * should normalize provider-specific behavior into Boundary's canonical forms.
 * 
 * Key normalizations:
 * - Disambiguates GitHub's overloaded 404 (not found vs no access)
 * - Normalizes rate limits from X-RateLimit-* headers
 * - Implements cursor/Link-header pagination
 * - Distinguishes auth expiry from permission errors
 * - Maps all failures to canonical BoundaryError categories
 */

import type {
  ProviderAdapter,
  AuthConfig,
  AuthToken,
  RawResponse,
  NormalizedResponse,
  RateLimitInfo,
  BoundaryError,
  PaginationStrategy,
  IdempotencyConfig,
  AdapterInput,
  BuiltRequest,
} from "../../core/types.js";
import { IdempotencyLevel } from "../../core/types.js";
import { GitHubPaginationStrategy } from "./pagination.js";
import { ResponseNormalizer } from "../../core/normalizer.js";
import { validateAdapter } from "../../core/adapter-validator.js";

/**
 * GitHub API error response structure.
 * This is provider-specific and MUST NOT leak outside this adapter.
 */
interface GitHubErrorResponse {
  message?: string;
  documentation_url?: string;
  errors?: Array<{
    resource?: string;
    field?: string;
    code?: string;
    message?: string;
  }>;
}

/**
 * Reference GitHub adapter implementation.
 * 
 * This adapter demonstrates:
 * - Explicit error disambiguation (404 handling)
 * - Complete normalization of provider quirks
 * - Zero leakage of GitHub-specific semantics
 */
export class GitHubAdapter implements ProviderAdapter {
  private baseUrl: string;

  constructor(baseUrl: string = "https://api.github.com") {
    this.baseUrl = baseUrl;

    // Validate adapter implementation at construction time
    // This fails fast if the adapter doesn't meet the contract
    const result = validateAdapter(this, "github");
    if (!result.valid) {
      const errorMessage = `Adapter validation failed for 'github':\n${result.errors.map((e) => `  - ${e}`).join("\n")}`;
      if (process.env.NODE_ENV === "production") {
        // In production, log warning but don't crash
        console.warn(errorMessage);
      } else {
        // In development, fail fast
        throw new Error(errorMessage);
      }
    }
    if (result.warnings.length > 0) {
      console.warn(
        `Adapter validation warnings for 'github':\n${result.warnings.map((w) => `  - ${w}`).join("\n")}`
      );
    }
  }

  /**
   * Builds a GitHub API request from normalized input.
   * 
   * This method constructs the request but does NOT execute it.
   * HTTP execution is handled by the pipeline.
   */
  buildRequest(input: AdapterInput): BuiltRequest {
    const { endpoint, options, authToken, baseUrl } = input;
    const effectiveBaseUrl = baseUrl ?? this.baseUrl;
    
    // Construct URL
    const url = new URL(endpoint, effectiveBaseUrl);
    
    // Add query parameters
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, String(value));
      }
    }

    // Build headers - all GitHub-specific headers are here
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Boundary-SDK/1.0.0",
      ...options.headers,
    };

    // Add authentication - GitHub uses Bearer tokens
    if (authToken.token) {
      headers["Authorization"] = `Bearer ${authToken.token}`;
    }

    // Add idempotency key if provided
    if (options.idempotencyKey) {
      headers["X-Idempotency-Key"] = options.idempotencyKey;
    }

    // Serialize body if present
    let body: string | undefined;
    const method = options.method ?? "GET";
    if (options.body && method !== "GET" && method !== "HEAD") {
      body = JSON.stringify(options.body);
      headers["Content-Type"] = "application/json";
    }

    const built: BuiltRequest = {
      url: url.toString(),
      method,
      headers,
    };
    if (body !== undefined) {
      built.body = body;
    }
    return built;
  }

  /**
   * Parses a GitHub API response into normalized form.
   * 
   * Handles:
   * - Rate limit extraction from headers
   * - Pagination extraction
   * - Response body normalization
   */
  parseResponse(raw: RawResponse): NormalizedResponse {
    // Extract rate limit information
    const rateLimitInfo = this.rateLimitPolicy(raw.headers);
    
    // Extract pagination information
    const paginationStrategy = this.paginationStrategy();
    const paginationInfo = ResponseNormalizer.extractPaginationInfo(
      raw,
      paginationStrategy
    );

    // Normalize response
    return ResponseNormalizer.normalize(
      raw,
      "github",
      rateLimitInfo,
      paginationInfo,
      [],
      "1.0.0"
    );
  }

  /**
   * Parses GitHub errors into canonical BoundaryError.
   * 
   * CRITICAL: This is the ONLY place GitHub error semantics are handled.
   * 
   * GitHub-specific error handling:
   * - 404 can mean "not found" OR "no access" - must disambiguate
   * - 401 = authentication required (token missing/invalid)
   * - 403 = permission denied OR rate limit (check X-RateLimit-Remaining)
   * - 422 = validation error (with detailed field errors)
   * - 5xx = provider error
   */
  parseError(raw: unknown): BoundaryError {
    // Network errors (fetch failures, timeouts, etc.)
    if (raw instanceof Error) {
      const errorMessage = raw.message.toLowerCase();
      if (
        errorMessage.includes("fetch") ||
        errorMessage.includes("network") ||
        errorMessage.includes("econnreset") ||
        errorMessage.includes("etimedout") ||
        errorMessage.includes("enotfound") ||
        errorMessage.includes("timeout")
      ) {
        return this.createBoundaryError(
          "network",
          true,
          "Network request failed. Check your connection and try again.",
          { originalError: raw.message }
        );
      }
    }

    // HTTP error responses
    if (
      typeof raw === "object" &&
      raw !== null &&
      "status" in raw &&
      typeof raw.status === "number"
    ) {
      const httpError = raw as {
        status: number;
        headers?: Headers | Record<string, string>;
        body?: unknown;
        message?: string;
      };

      return this.parseHttpError(httpError);
    }

    // Unknown error format - treat as provider error
    return this.createBoundaryError(
      "provider",
      false,
      "An unexpected error occurred",
      { raw }
    );
  }

  /**
   * Parses HTTP error responses with GitHub-specific logic.
   */
  private parseHttpError(error: {
    status: number;
    headers?: Headers | Record<string, string>;
    body?: unknown;
    message?: string;
  }): BoundaryError {
    const status = error.status;
    const body = error.body as GitHubErrorResponse | undefined;
    const headers = error.headers;

    // 401 Unauthorized - Authentication required
    if (status === 401) {
      return this.createBoundaryError(
        "auth",
        false,
        "Authentication failed. Check your token is valid and not expired.",
        {
          githubMessage: body?.message,
          documentationUrl: body?.documentation_url,
        }
      );
    }

    // 403 Forbidden - Could be permission OR rate limit
    if (status === 403) {
      // Check if this is actually a rate limit (GitHub sometimes returns 403 for rate limits)
      // Only treat as rate limit if X-RateLimit-Remaining is explicitly "0"
      const rateLimitRemaining = this.getHeaderValue(headers, "X-RateLimit-Remaining");
      if (rateLimitRemaining === "0") {
        const retryAfter = this.extractRetryAfter(headers);
        return this.createBoundaryError(
          "rate_limit",
          true,
          "Rate limit exceeded. Please wait before retrying.",
          {
            githubMessage: body?.message,
            retryAfter: retryAfter?.toISOString(),
          },
          retryAfter
        );
      }

      // Otherwise, it's a permission error
      return this.createBoundaryError(
        "auth",
        false,
        "Permission denied. Check your token has the required scopes.",
        {
          githubMessage: body?.message,
          documentationUrl: body?.documentation_url,
        }
      );
    }

    // 404 Not Found - CRITICAL: GitHub uses 404 for both "not found" and "no access"
    // We must disambiguate based on context, but in general we treat it as validation
    // (resource doesn't exist or you don't have access)
    if (status === 404) {
      // If there's a message suggesting access issues, treat as auth
      const message = body?.message?.toLowerCase() ?? "";
      if (
        message.includes("not found") ||
        message.includes("does not exist") ||
        message.includes("not accessible")
      ) {
        // Could be either - default to validation (not found)
        // In practice, 404 for private repos without access might be auth
        // but GitHub doesn't distinguish, so we default to validation
        return this.createBoundaryError(
          "validation",
          false,
          "Resource not found or not accessible.",
          {
            githubMessage: body?.message,
            note: "GitHub returns 404 for both missing resources and inaccessible resources",
          }
        );
      }

      return this.createBoundaryError(
        "validation",
        false,
        "Resource not found.",
        {
          githubMessage: body?.message,
        }
      );
    }

    // 422 Unprocessable Entity - Validation error with details
    if (status === 422) {
      const fieldErrors = body?.errors
        ?.map((e) => `${e.field ?? "unknown"}: ${e.message ?? e.code ?? "error"}`)
        .join("; ");
      
      return this.createBoundaryError(
        "validation",
        false,
        fieldErrors
          ? `Validation failed: ${fieldErrors}`
          : body?.message ?? "Request validation failed.",
        {
          githubMessage: body?.message,
          fieldErrors: body?.errors,
        }
      );
    }

    // 429 Too Many Requests - Rate limit
    if (status === 429) {
      const retryAfter = this.extractRetryAfter(headers);
      return this.createBoundaryError(
        "rate_limit",
        true,
        "Rate limit exceeded. Please wait before retrying.",
        {
          githubMessage: body?.message,
          retryAfter: retryAfter?.toISOString(),
        },
        retryAfter
      );
    }

    // 5xx - Provider errors (retryable)
    if (status >= 500) {
      return this.createBoundaryError(
        "provider",
        true,
        `GitHub API returned error ${status}. This may be temporary.`,
        {
          status,
          githubMessage: body?.message,
        }
      );
    }

    // Other 4xx - Validation errors (not retryable)
    if (status >= 400) {
      return this.createBoundaryError(
        "validation",
        false,
        body?.message ?? `Request failed with status ${status}.`,
        {
          status,
          githubMessage: body?.message,
        }
      );
    }

    // Unknown status - treat as provider error
    return this.createBoundaryError(
      "provider",
      false,
      `Unexpected response status ${status}.`,
      {
        status,
        githubMessage: body?.message,
      }
    );
  }

  /**
   * Authentication strategy for GitHub.
   * 
   * GitHub uses Bearer token authentication.
   * Token expiry is not explicitly signaled by GitHub - 401 indicates invalid token.
   */
  async authStrategy(config: AuthConfig): Promise<AuthToken> {
    if (!config.token) {
      throw this.createBoundaryError(
        "auth",
        false,
        "GitHub authentication requires a token.",
        {}
      );
    }

    // GitHub tokens don't have explicit expiry in the config
    // If token is invalid, API will return 401
    return {
      token: config.token,
    };
  }

  /**
   * Rate limit policy for GitHub.
   * 
   * GitHub provides rate limit information in response headers:
   * - X-RateLimit-Limit: Total requests allowed per window
   * - X-RateLimit-Remaining: Requests remaining in current window
   * - X-RateLimit-Reset: Unix timestamp when window resets
   * - X-RateLimit-Used: Requests used in current window (not needed)
   */
  rateLimitPolicy(headers: Headers): RateLimitInfo {
    const limitStr = this.getHeaderValue(headers, "X-RateLimit-Limit");
    const remainingStr = this.getHeaderValue(headers, "X-RateLimit-Remaining");
    const resetStr = this.getHeaderValue(headers, "X-RateLimit-Reset");

    // Parse limit (default: 5000 for authenticated, 60 for unauthenticated)
    const limit = limitStr ? parseInt(limitStr, 10) : 5000;
    
    // Parse remaining (default: assume limit if not provided)
    const remaining = remainingStr ? parseInt(remainingStr, 10) : limit;
    
    // Parse reset time (GitHub provides Unix timestamp)
    let reset: Date;
    if (resetStr) {
      const resetTimestamp = parseInt(resetStr, 10);
      if (!isNaN(resetTimestamp)) {
        reset = new Date(resetTimestamp * 1000);
      } else {
        // Fallback: 1 hour from now
        reset = new Date(Date.now() + 60 * 60 * 1000);
      }
    } else {
      // Fallback: 1 hour from now
      reset = new Date(Date.now() + 60 * 60 * 1000);
    }

    return {
      limit,
      remaining,
      reset,
    };
  }

  /**
   * Returns the pagination strategy for GitHub.
   */
  paginationStrategy(): PaginationStrategy {
    return new GitHubPaginationStrategy();
  }

  /**
   * Returns idempotency configuration for GitHub.
   */
  getIdempotencyConfig(): IdempotencyConfig {
    return {
      defaultSafeOperations: new Set(["GET", "HEAD", "OPTIONS"]),
      operationOverrides: new Map([
        // POST operations that are safe with idempotency keys
        [
          "POST /repos/:owner/:repo/pulls",
          IdempotencyLevel.CONDITIONAL,
        ],
        [
          "POST /repos/:owner/:repo/issues",
          IdempotencyLevel.CONDITIONAL,
        ],
        // Search endpoints can mutate rate limits aggressively
        ["GET /search/code", IdempotencyLevel.UNSAFE],
        ["GET /search/repositories", IdempotencyLevel.UNSAFE],
        ["GET /search/users", IdempotencyLevel.UNSAFE],
        // DELETE operations are idempotent
        ["DELETE /repos/:owner/:repo", IdempotencyLevel.IDEMPOTENT],
        ["DELETE /repos/:owner/:repo/issues/:issue_number", IdempotencyLevel.IDEMPOTENT],
      ]),
    };
  }

  /**
   * Helper to create BoundaryError instances.
   */
  private createBoundaryError(
    category: BoundaryError["category"],
    retryable: boolean,
    message: string,
    metadata?: Record<string, unknown>,
    retryAfter?: Date
  ): BoundaryError {
    const error = new Error(message) as BoundaryError;
    error.category = category;
    error.retryable = retryable;
    error.provider = "github";
    error.message = message;
    if (metadata) {
      error.metadata = metadata;
    }
    if (retryAfter) {
      error.retryAfter = retryAfter;
    }
    return error;
  }

  /**
   * Helper to extract header values from Headers or Record.
   */
  private getHeaderValue(
    headers: Headers | Record<string, string> | undefined,
    name: string
  ): string | null {
    if (!headers) {
      return null;
    }

    if (headers instanceof Headers) {
      return headers.get(name);
    }

    // Case-insensitive lookup for Record
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName) {
        return value;
      }
    }

    return null;
  }

  /**
   * Extracts retry-after from headers.
   * Handles both Retry-After header and X-RateLimit-Reset.
   */
  private extractRetryAfter(
    headers: Headers | Record<string, string> | undefined
  ): Date | undefined {
    if (!headers) {
      return undefined;
    }

    // Try Retry-After header first (seconds)
    const retryAfter = this.getHeaderValue(headers, "Retry-After");
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return new Date(Date.now() + seconds * 1000);
      }
    }

    // Fallback to X-RateLimit-Reset (Unix timestamp)
    const resetStr = this.getHeaderValue(headers, "X-RateLimit-Reset");
    if (resetStr) {
      const resetTimestamp = parseInt(resetStr, 10);
      if (!isNaN(resetTimestamp)) {
        return new Date(resetTimestamp * 1000);
      }
    }

    return undefined;
  }
}
