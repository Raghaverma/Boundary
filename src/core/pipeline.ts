

import type {
  ProviderAdapter,
  RequestOptions,
  NormalizedResponse,
  ObservabilityAdapter,
  RequestContext,
  ResponseContext,
  ErrorContext,
  RawResponse,
} from "./types.js";
import { BoundaryError } from "./types.js";
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

  
  private safelyBroadcastObservability(
    action: (adapter: ObservabilityAdapter) => void,
    actionName: string
  ): void {
    const errors: Array<{ adapter: string; error: unknown }> = [];

    for (const obs of this.config.observability) {
      try {
        action(obs);
      } catch (error) {
        errors.push({
          adapter: obs.constructor?.name || "UnknownObservabilityAdapter",
          error,
        });
      }
    }

    
    
    if (errors.length > 0) {
      const errorSummary = errors
        .map(
          ({ adapter, error }) =>
            `  - ${adapter}: ${error instanceof Error ? error.message : String(error)}`
        )
        .join("\n");

      console.error(
        `[Boundary] Observability failure in ${actionName} (${errors.length}/${this.config.observability.length} adapters failed):\n${errorSummary}`
      );
    }
  }

  async execute<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<NormalizedResponse<T>> {
    const requestId = randomUUID();
    const method = options.method ?? "GET";
    const startTime = Date.now();

    
    if (this.config.autoGenerateIdempotencyKeys && !options.idempotencyKey) {
      options.idempotencyKey = randomUUID();
    }

    
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

    
    this.safelyBroadcastObservability(
      (obs) => obs.logRequest(requestContext),
      "logRequest"
    );

    try {
      
      const authToken = await this.config.adapter.authStrategy(
        this.config.authConfig
      );

      
      await this.config.rateLimiter.acquire();

      
      const response = await this.config.retryStrategy.execute(
        async () => {
          return await this.config.circuitBreaker.execute(async () => {
            
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

      
      const rateLimitInfo = this.config.adapter.rateLimitPolicy(
        response.headers
      );
      this.config.rateLimiter.updateFromHeaders(
        response.headers,
        rateLimitInfo
      );

      
      const normalized = this.config.adapter.parseResponse(response);

      
      normalized.meta.requestId = requestId;

      
      

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

      
      this.safelyBroadcastObservability(
        (obs) => obs.logResponse(responseContext),
        "logResponse"
      );

      
      this.safelyBroadcastObservability(
        (obs) => obs.recordMetric(sanitizeMetric({
          name: "boundary.request.count",
          value: 1,
          tags: {
            provider: this.config.provider,
            endpoint,
            status: String(response.status),
          },
          timestamp: new Date(),
        }, this.config.sanitizerOptions)),
        "recordMetric:request.count"
      );

      
      this.safelyBroadcastObservability(
        (obs) => obs.recordMetric(sanitizeMetric({
          name: "boundary.request.duration",
          value: duration,
          tags: {
            provider: this.config.provider,
            endpoint,
          },
          timestamp: new Date(),
        }, this.config.sanitizerOptions)),
        "recordMetric:request.duration"
      );

      return normalized as NormalizedResponse<T>;
    } catch (error) {
      const duration = Date.now() - startTime;



      let boundaryError: BoundaryError;
      try {
        const adapterError = this.config.adapter.parseError(error);


        boundaryError = sanitizeBoundaryError(adapterError, this.config.provider, requestId);
      } catch (parseError) {

        boundaryError = sanitizeBoundaryError(
          {
            message: error instanceof Error ? error.message : String(error),
            metadata: {
              originalError: error instanceof Error ? error.message : error,
              parseError: parseError instanceof Error ? parseError.message : parseError,
            },
          },
          this.config.provider,
          requestId
        );
      }

      
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

      
      
      
      
      try {
        const sanitizedError = { ...boundaryError } as any;
        if (sanitizedError.metadata) {
          sanitizedError.metadata = sanitizeObject(sanitizedError.metadata, this.config.sanitizerOptions) as Record<string, unknown>;
        }
        errorContext = { ...errorContext, error: sanitizedError };
      } catch {
        
      }

      
      this.safelyBroadcastObservability(
        (obs) => obs.logError(errorContext),
        "logError"
      );

      
      this.safelyBroadcastObservability(
        (obs) => obs.recordMetric(sanitizeMetric({
          name: "boundary.request.error",
          value: 1,
          tags: {
            provider: this.config.provider,
            endpoint,
            errorCategory: boundaryError.category,
          },
          timestamp: new Date(),
        }, this.config.sanitizerOptions)),
        "recordMetric:request.error"
      );

      throw boundaryError;
    }
  }

  
  private async executeHttpRequest(
    endpoint: string,
    options: RequestOptions,
    authToken: AuthToken
  ): Promise<RawResponse> {
    const timeout = this.config.timeout ?? 30000;

    
    const builtRequest = this.config.adapter.buildRequest({
      endpoint,
      options,
      authToken,
    });

    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    
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

      
      const headersMap = new Headers();
      response.headers.forEach((value, key) => {
        headersMap.set(key, value);
      });

      
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

      if (error instanceof Error && error.name === "AbortError") {
        throw new BoundaryError(
          `Request timeout after ${timeout}ms`,
          "network",
          this.config.provider,
          true,
          "",
          {
            timeout,
            url: builtRequest.url,
            method: builtRequest.method,
          },
          undefined,
          undefined
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

}

