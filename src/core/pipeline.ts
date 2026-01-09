/**
 * Main request pipeline
 * Flow: auth → rate-limit → circuit-breaker → retry → fetch → normalize → error-map → schema-check
 */

import type {
  ProviderAdapter,
  RequestOptions,
  NormalizedResponse,
  ObservabilityAdapter,
  RequestContext,
  ResponseContext,
  ErrorContext,
  RawResponse,
  BoundaryError,
} from "./types.js";
import { ProviderCircuitBreaker } from "../strategies/circuit-breaker.js";
import { RateLimiter } from "../strategies/rate-limit.js";
import { RetryStrategy } from "../strategies/retry.js";
import { IdempotencyResolver } from "../strategies/idempotency.js";
import { sanitizeBoundaryError } from "./error-sanitizer.js";
import { sanitizeObject, sanitizeMetric } from "./observability-sanitizer.js";
import { sanitizeRequestOptions } from "./request-sanitizer.js";
import { randomUUID } from "crypto";

import type { AuthConfig, AuthToken } from "./types.js";

export interface PipelineConfig {
  provider: string;
  adapter: ProviderAdapter;
  authConfig: AuthConfig;
  circuitBreaker: ProviderCircuitBreaker;
  rateLimiter: RateLimiter;
  retryStrategy: RetryStrategy;
  idempotencyResolver: IdempotencyResolver;
  observability: ObservabilityAdapter[];
  timeout: number | undefined;
  autoGenerateIdempotencyKeys?: boolean;
  sanitizerOptions?: { redactedKeys?: string[] };
}

export class RequestPipeline {
  private config: PipelineConfig;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  async execute<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<NormalizedResponse<T>> {
    const requestId = randomUUID();
    const method = options.method ?? "GET";
    const startTime = Date.now();

    // Generate idempotency key if needed
    if (this.config.autoGenerateIdempotencyKeys && !options.idempotencyKey) {
      options.idempotencyKey = randomUUID();
    }

    // Get idempotency level
    const idempotencyLevel = this.config.idempotencyResolver.getIdempotencyLevel(
      method,
      endpoint,
      options
    );

    const sanitizedOptions = sanitizeRequestOptions(options, this.config.sanitizerOptions);

    const requestContext: RequestContext = {
      provider: this.config.provider,
      endpoint,
      method,
      requestId,
      timestamp: new Date(),
      options: sanitizedOptions,
    };

    // Log request (sanitized)
    for (const obs of this.config.observability) {
      try {
        obs.logRequest(requestContext);
      } catch {
        // Observability should not break request flow
      }
    }

    try {
      // Step 1: Authenticate using adapter's auth strategy
      const authToken = await this.config.adapter.authStrategy(
        this.config.authConfig
      );

      // Step 2: Rate limit
      await this.config.rateLimiter.acquire();

      // Step 3-4: Circuit breaker + Retry
      const response = await this.config.retryStrategy.execute(
        async () => {
          return await this.config.circuitBreaker.execute(async () => {
            // Step 5: Build request and execute HTTP
            return await this.executeHttpRequest(
              endpoint,
              options,
              authToken
            );
          });
        },
        idempotencyLevel,
        !!options.idempotencyKey
      );

      // Step 6: Parse rate limit from response using adapter's policy
      const rateLimitInfo = this.config.adapter.rateLimitPolicy(
        response.headers
      );
      this.config.rateLimiter.updateFromHeaders(
        response.headers,
        rateLimitInfo
      );

      // Step 7: Parse response using adapter's parseResponse
      const normalized = this.config.adapter.parseResponse(response);

      // Step 8: Schema check (if enabled, handled by adapter)
      // This would be done in the adapter's normalizeResponse method

      const duration = Date.now() - startTime;

      const responseContext: ResponseContext = {
        provider: this.config.provider,
        endpoint,
        method,
        requestId,
        statusCode: response.status,
        duration,
        timestamp: new Date(),
      };

      // Log response (sanitized)
      for (const obs of this.config.observability) {
        try {
          obs.logResponse(responseContext);
        } catch {
          // swallow
        }
        try {
          obs.recordMetric(sanitizeMetric({
            name: "boundary.request.count",
            value: 1,
            tags: {
              provider: this.config.provider,
              endpoint,
              status: String(response.status),
            },
            timestamp: new Date(),
          }, this.config.sanitizerOptions));
        } catch {}
        try {
          obs.recordMetric(sanitizeMetric({
            name: "boundary.request.duration",
            value: duration,
            tags: {
              provider: this.config.provider,
              endpoint,
            },
            timestamp: new Date(),
          }, this.config.sanitizerOptions));
        } catch {}
      }

      return normalized as NormalizedResponse<T>;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Step 8: Parse error using adapter's parseError
      // This is the ONLY place errors are normalized - adapter handles all provider-specific logic
      let boundaryError: BoundaryError;
      try {
        const adapterError = this.config.adapter.parseError(error);
        // CRITICAL: Sanitize adapter output to ensure strict BoundaryError compliance
        // This recomputes category/retryable if invalid and drops unsafe metadata
        boundaryError = sanitizeBoundaryError(adapterError, this.config.provider);
      } catch (parseError) {
        // Adapter failed to parse error - sanitize the original error
        boundaryError = sanitizeBoundaryError(
          {
            message: error instanceof Error ? error.message : String(error),
            metadata: {
              originalError: error instanceof Error ? error.message : error,
              parseError: parseError instanceof Error ? parseError.message : parseError,
            },
          },
          this.config.provider
        );
      }

      // Handle rate limit errors - update rate limiter
      if (boundaryError.category === "rate_limit" && boundaryError.retryAfter) {
        this.config.rateLimiter.handle429(
          Math.floor(
            (boundaryError.retryAfter.getTime() - Date.now()) / 1000
          )
        );
      }

      let errorContext: ErrorContext = {
        provider: this.config.provider,
        endpoint,
        method,
        requestId,
        error: boundaryError,
        duration,
        timestamp: new Date(),
      };

      // Sanitize error metadata before logging
      try {
        const sanitizedError = { ...boundaryError } as any;
        if (sanitizedError.metadata) {
          sanitizedError.metadata = sanitizeObject(sanitizedError.metadata, this.config.sanitizerOptions) as Record<string, unknown>;
        }
        errorContext = { ...errorContext, error: sanitizedError };
      } catch {}

      // Log error (sanitized)
      for (const obs of this.config.observability) {
        try {
          obs.logError(errorContext);
        } catch {}
        try {
          obs.recordMetric(sanitizeMetric({
            name: "boundary.request.error",
            value: 1,
            tags: {
              provider: this.config.provider,
              endpoint,
              errorCategory: boundaryError.category,
            },
            timestamp: new Date(),
          }, this.config.sanitizerOptions));
        } catch {}
      }

      throw boundaryError;
    }
  }

  /**
   * Executes HTTP request using adapter's buildRequest and fetch.
   * This is the ONLY place HTTP execution happens - adapters only build requests.
   */
  private async executeHttpRequest(
    endpoint: string,
    options: RequestOptions,
    authToken: AuthToken
  ): Promise<RawResponse> {
    const timeout = this.config.timeout ?? 30000;

    // Build request using adapter
    const builtRequest = this.config.adapter.buildRequest({
      endpoint,
      options,
      authToken,
    });

    // Use AbortController for proper timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Execute HTTP request
    const fetchOptions: RequestInit = {
      method: builtRequest.method,
      headers: builtRequest.headers,
      signal: controller.signal,
    };
    if (builtRequest.body !== undefined) {
      fetchOptions.body = builtRequest.body;
    }

    try {
      const response = await fetch(builtRequest.url, fetchOptions);

      // Parse response body
      let body: unknown;
      try {
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          body = await response.json();
        } else {
          body = await response.text();
        }
      } catch {
        body = {};
      }

      // Convert Headers to Headers object
      const headersMap = new Headers();
      response.headers.forEach((value, key) => {
        headersMap.set(key, value);
      });

      // If error status, throw error object for adapter to parse
      if (!response.ok) {
        throw {
          status: response.status,
          headers: headersMap,
          body,
        };
      }

      return {
        status: response.status,
        headers: headersMap,
        body,
      } as RawResponse;
    } catch (error) {
      // Convert abort error to canonical timeout error with request context
      if (error instanceof Error && error.name === "AbortError") {
        const timeoutError: BoundaryError = {
          name: "BoundaryError",
          message: `Request timeout after ${timeout}ms`,
          category: "network",
          retryable: true, // Timeouts are generally retryable
          provider: this.config.provider,
          metadata: {
            timeout,
            url: builtRequest.url,
            method: builtRequest.method,
          },
        };
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

}

