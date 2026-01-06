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
} from "./types.js";
import { ErrorMapper } from "./error-mapper.js";
import { ResponseNormalizer } from "./normalizer.js";
import { ProviderCircuitBreaker } from "../strategies/circuit-breaker.js";
import { RateLimiter } from "../strategies/rate-limit.js";
import { RetryStrategy } from "../strategies/retry.js";
import { IdempotencyResolver } from "../strategies/idempotency.js";
import { randomUUID } from "crypto";

import type { AuthConfig } from "./types.js";

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

    const requestContext: RequestContext = {
      provider: this.config.provider,
      endpoint,
      method,
      requestId,
      timestamp: new Date(),
      options,
    };

    // Log request
    for (const obs of this.config.observability) {
      obs.logRequest(requestContext);
    }

    try {
      // Step 1: Authenticate
      const authToken = await this.config.adapter.authenticate(
        this.config.authConfig
      );

      // Step 2: Rate limit
      await this.config.rateLimiter.acquire();

      // Step 3-4: Circuit breaker + Retry
      const response = await this.config.retryStrategy.execute(
        async () => {
          return await this.config.circuitBreaker.execute(async () => {
            // Step 5: Fetch
            return await this.fetchWithTimeout(
              endpoint,
              options,
              authToken
            );
          });
        },
        idempotencyLevel,
        !!options.idempotencyKey
      );

      // Step 6: Parse rate limit from response
      const rateLimitInfo = this.config.adapter.parseRateLimit(
        response.headers
      );
      this.config.rateLimiter.updateFromHeaders(
        response.headers,
        rateLimitInfo
      );

      // Step 7: Normalize response
      const paginationStrategy = this.config.adapter.getPaginationStrategy();
      const paginationInfo = ResponseNormalizer.extractPaginationInfo(
        response,
        paginationStrategy
      );

      const normalized = this.config.adapter.normalizeResponse(response);
      const normalizedWithMeta = ResponseNormalizer.normalize(
        response,
        this.config.provider,
        rateLimitInfo,
        paginationInfo,
        normalized.meta.warnings,
        normalized.meta.schemaVersion
      );

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

      // Log response
      for (const obs of this.config.observability) {
        obs.logResponse(responseContext);
        obs.recordMetric({
          name: "boundary.request.count",
          value: 1,
          tags: {
            provider: this.config.provider,
            endpoint,
            status: String(response.status),
          },
          timestamp: new Date(),
        });
        obs.recordMetric({
          name: "boundary.request.duration",
          value: duration,
          tags: {
            provider: this.config.provider,
            endpoint,
          },
          timestamp: new Date(),
        });
      }

      return normalizedWithMeta as NormalizedResponse<T>;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Step 8: Error mapping
      const normalizedError = ErrorMapper.normalize(
        error,
        this.config.provider,
        "An error occurred during the request"
      );

      // Handle 429 rate limit errors
      if (normalizedError.type === "RATE_LIMIT" && normalizedError.retryAfter) {
        this.config.rateLimiter.handle429(
          Math.floor(
            (normalizedError.retryAfter.getTime() - Date.now()) / 1000
          )
        );
      }

      const errorContext: ErrorContext = {
        provider: this.config.provider,
        endpoint,
        method,
        requestId,
        error: normalizedError,
        duration,
        timestamp: new Date(),
      };

      // Log error
      for (const obs of this.config.observability) {
        obs.logError(errorContext);
        obs.recordMetric({
          name: "boundary.request.error",
          value: 1,
          tags: {
            provider: this.config.provider,
            endpoint,
            errorType: normalizedError.type,
          },
          timestamp: new Date(),
        });
      }

      throw normalizedError;
    }
  }

  private async fetchWithTimeout(
    endpoint: string,
    options: RequestOptions,
    authToken: any
  ): Promise<any> {
    const timeout = this.config.timeout ?? 30000;

    return Promise.race([
      this.config.adapter.makeRequest(endpoint, options, authToken),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Request timeout")),
          timeout
        )
      ),
    ]);
  }
}

