

import type {
  ProviderAdapter,
  AuthConfig,
  AuthToken,
  RawResponse,
  NormalizedResponse,
  RateLimitInfo,
  PaginationStrategy,
  IdempotencyConfig,
  AdapterInput,
  BuiltRequest,
} from "../../core/types.js";
import { BoundaryError, IdempotencyLevel, SDK_VERSION } from "../../core/types.js";
import { GitHubPaginationStrategy } from "./pagination.js";
import { ResponseNormalizer } from "../../core/normalizer.js";
import { parseRetryAfter, parseRateLimitHeaders } from "../../core/header-parser.js";


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


export class GitHubAdapter implements ProviderAdapter {
  private baseUrl: string;

  constructor(baseUrl: string = "https://api.github.com") {
    this.baseUrl = baseUrl;
  }

  
  buildRequest(input: AdapterInput): BuiltRequest {
    const { endpoint, options, authToken, baseUrl } = input;
    const effectiveBaseUrl = baseUrl ?? this.baseUrl;
    
    
    const url = new URL(endpoint, effectiveBaseUrl);
    
    
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, String(value));
      }
    }

    
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": `Boundary-SDK/${SDK_VERSION}`,
      ...options.headers,
    };

    
    if (authToken.token) {
      headers["Authorization"] = `Bearer ${authToken.token}`;
    }

    
    if (options.idempotencyKey) {
      headers["X-Idempotency-Key"] = options.idempotencyKey;
    }

    
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

  
  parseResponse(raw: RawResponse): NormalizedResponse {
    
    const rateLimitInfo = this.rateLimitPolicy(raw.headers);
    
    
    const paginationStrategy = this.paginationStrategy();
    const paginationInfo = ResponseNormalizer.extractPaginationInfo(
      raw,
      paginationStrategy
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

  
  parseError(raw: unknown): BoundaryError {
    
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

    
    return this.createBoundaryError(
      "provider",
      false,
      "An unexpected error occurred",
      { raw }
    );
  }

  
  private parseHttpError(error: {
    status: number;
    headers?: Headers | Record<string, string>;
    body?: unknown;
    message?: string;
  }): BoundaryError {
    const status = error.status;
    const body = error.body as GitHubErrorResponse | undefined;
    const headers = error.headers;

    
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

    
    if (status === 403) {
      
      
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

    
    
    
    if (status === 404) {
      
      const message = body?.message?.toLowerCase() ?? "";
      if (
        message.includes("not found") ||
        message.includes("does not exist") ||
        message.includes("not accessible")
      ) {
        
        
        
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

    
    if (status === 422) {
      const fieldErrors = body?.errors
        ?.map((e) => `${e.field ?? }: ${e.message ?? e.code ?? }`)
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

  
  async authStrategy(config: AuthConfig): Promise<AuthToken> {
    if (!config.token) {
      throw this.createBoundaryError(
        "auth",
        false,
        "GitHub authentication requires a token.",
        {}
      );
    }

    
    
    return {
      token: config.token,
    };
  }

  
  rateLimitPolicy(headers: Headers): RateLimitInfo {
    
    const parsed = parseRateLimitHeaders(headers);

    if (parsed) {
      return {
        limit: parsed.limit,
        remaining: parsed.remaining,
        reset: parsed.reset,
      };
    }

    
    return {
      limit: 5000, 
      remaining: 5000,
      reset: new Date(Date.now() + 60 * 60 * 1000), 
    };
  }

  
  paginationStrategy(): PaginationStrategy {
    return new GitHubPaginationStrategy();
  }

  
  getIdempotencyConfig(): IdempotencyConfig {
    return {
      defaultSafeOperations: new Set(["GET", "HEAD", "OPTIONS"]),
      operationOverrides: new Map([
        
        [
          "POST /repos/:owner/:repo/pulls",
          IdempotencyLevel.CONDITIONAL,
        ],
        [
          "POST /repos/:owner/:repo/issues",
          IdempotencyLevel.CONDITIONAL,
        ],
        
        ["GET /search/code", IdempotencyLevel.UNSAFE],
        ["GET /search/repositories", IdempotencyLevel.UNSAFE],
        ["GET /search/users", IdempotencyLevel.UNSAFE],
        
        ["DELETE /repos/:owner/:repo", IdempotencyLevel.IDEMPOTENT],
        ["DELETE /repos/:owner/:repo/issues/:issue_number", IdempotencyLevel.IDEMPOTENT],
      ]),
    };
  }

  
  private createBoundaryError(
    category: BoundaryError["category"],
    retryable: boolean,
    message: string,
    metadata?: Record<string, unknown>,
    retryAfter?: Date
  ): BoundaryError {
    return new BoundaryError(
      message,
      category,
      "github",
      retryable,
      metadata,
      retryAfter
    );
  }

  
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

    
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName) {
        return value;
      }
    }

    return null;
  }

  
  private extractRetryAfter(
    headers: Headers | Record<string, string> | undefined
  ): Date | undefined {
    if (!headers) {
      return undefined;
    }

    
    const retryAfterValue = this.getHeaderValue(headers, "Retry-After");
    const parsed = parseRetryAfter(retryAfterValue);
    if (parsed) {
      return parsed;
    }

    
    const resetValue = this.getHeaderValue(headers, "X-RateLimit-Reset");
    if (resetValue) {
      
      const timestamp = parseInt(resetValue.trim(), 10);
      if (!isNaN(timestamp) && timestamp > 0) {
        const now = Math.floor(Date.now() / 1000);
        
        if (timestamp >= now - 60 && timestamp < now + 86400 * 365) {
          return new Date(timestamp * 1000);
        }
      }
    }

    return undefined;
  }
}
