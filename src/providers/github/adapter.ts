/**
 * GitHub provider adapter
 */

import type {
  ProviderAdapter,
  AuthConfig,
  AuthToken,
  RequestOptions,
  RawResponse,
  NormalizedResponse,
  RateLimitInfo,
  NormalizedError,
  PaginationStrategy,
  IdempotencyConfig,
} from "../../core/types.js";
import { IdempotencyLevel } from "../../core/types.js";
import { GitHubPaginationStrategy } from "./pagination.js";
import { ErrorMapper } from "../../core/error-mapper.js";
import { ResponseNormalizer } from "../../core/normalizer.js";

export class GitHubAdapter implements ProviderAdapter {
  private baseUrl: string;

  constructor(baseUrl: string = "https://api.github.com") {
    this.baseUrl = baseUrl;
  }

  async authenticate(config: AuthConfig): Promise<AuthToken> {
    if (config.token) {
      return {
        token: config.token,
      };
    }

    throw new Error("GitHub authentication requires a token");
  }

  async makeRequest(
    endpoint: string,
    options: RequestOptions,
    authToken: AuthToken
  ): Promise<RawResponse> {
    const url = new URL(endpoint, this.baseUrl);

    // Add query parameters
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, String(value));
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Boundary-SDK/1.0.0",
      ...options.headers,
    };

    // Add authentication
    if (authToken.token) {
      headers["Authorization"] = `Bearer ${authToken.token}`;
    }

    // Add idempotency key if provided
    if (options.idempotencyKey) {
      headers["X-Idempotency-Key"] = options.idempotencyKey;
    }

    // Build fetch options
    const fetchOptions: RequestInit = {
      method: options.method ?? "GET",
      headers,
    };

    if (options.body && options.method !== "GET" && options.method !== "HEAD") {
      fetchOptions.body = JSON.stringify(options.body);
      headers["Content-Type"] = "application/json";
    }

    try {
      const response = await fetch(url.toString(), fetchOptions);
      const body = await response.json().catch(() => ({}));

      // Convert Headers to Map-like object for compatibility
      const headersMap = new Headers();
      response.headers.forEach((value, key) => {
        headersMap.set(key, value);
      });

      return {
        status: response.status,
        headers: headersMap,
        body,
      };
    } catch (error) {
      // Wrap fetch errors
      throw {
        status: 0,
        message: error instanceof Error ? error.message : String(error),
        error,
      };
    }
  }

  normalizeResponse(raw: RawResponse): NormalizedResponse {
    const rateLimitInfo = this.parseRateLimit(raw.headers);
    const paginationInfo = ResponseNormalizer.extractPaginationInfo(
      raw,
      this.getPaginationStrategy()
    );

    return ResponseNormalizer.normalize(
      raw,
      "github",
      rateLimitInfo,
      paginationInfo,
      [],
      "1.0.0"
    );
  }

  parseRateLimit(headers: Headers): RateLimitInfo {
    const limit = parseInt(headers.get("X-RateLimit-Limit") ?? "5000", 10);
    const remaining = parseInt(
      headers.get("X-RateLimit-Remaining") ?? "5000",
      10
    );
    const reset = parseInt(headers.get("X-RateLimit-Reset") ?? "0", 10);

    return {
      limit,
      remaining,
      reset: new Date(reset * 1000), // GitHub returns Unix timestamp
    };
  }

  parseError(error: unknown): NormalizedError {
    return ErrorMapper.normalize(
      error,
      "github",
      "GitHub API request failed"
    );
  }

  getPaginationStrategy(): PaginationStrategy {
    return new GitHubPaginationStrategy();
  }

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
}

