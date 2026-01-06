/**
 * Boundary SDK - Main entry point
 */

import type {
  BoundaryConfig,
  ProviderConfig,
  NormalizedResponse,
  CircuitBreakerStatus,
  ObservabilityAdapter,
} from "./core/types.js";
import { RequestPipeline } from "./core/pipeline.js";
import { ProviderCircuitBreaker } from "./strategies/circuit-breaker.js";
import { RateLimiter } from "./strategies/rate-limit.js";
import { RetryStrategy } from "./strategies/retry.js";
import { IdempotencyResolver } from "./strategies/idempotency.js";
import { IdempotencyLevel } from "./core/types.js";
import { ConsoleObservability } from "./observability/console.js";
import type { ProviderAdapter } from "./core/types.js";
import { GitHubAdapter } from "./providers/github/adapter.js";

// Internal registry of built-in adapters (not exported)
const BUILTIN_ADAPTERS = {
  github: new GitHubAdapter(),
} as const;

export interface ProviderClient {
  get<T = unknown>(endpoint: string, options?: any): Promise<NormalizedResponse<T>>;
  post<T = unknown>(endpoint: string, options?: any): Promise<NormalizedResponse<T>>;
  put<T = unknown>(endpoint: string, options?: any): Promise<NormalizedResponse<T>>;
  patch<T = unknown>(endpoint: string, options?: any): Promise<NormalizedResponse<T>>;
  delete<T = unknown>(endpoint: string, options?: any): Promise<NormalizedResponse<T>>;
  paginate<T = unknown>(endpoint: string, options?: any): AsyncGenerator<NormalizedResponse<T>>;
}

export class Boundary {
  private config: BoundaryConfig;
  private pipelines: Map<string, RequestPipeline> = new Map();
  private circuitBreakers: Map<string, ProviderCircuitBreaker> = new Map();
  private observability: ObservabilityAdapter[];
  private adapters: Map<string, ProviderAdapter> = new Map();

  constructor(config: BoundaryConfig, adapters?: Map<string, ProviderAdapter>) {
    // Normalize config: support both { providers: {...} } and { github: {...} } shapes
    const providers = "providers" in config && config.providers
      ? config.providers
      : (() => {
          // Extract provider configs from top-level keys (excluding known config keys)
          const knownKeys = new Set([
            "defaults",
            "schemaValidation",
            "observability",
            "idempotency",
            "providers",
          ]);
          const providerConfigs: Record<string, ProviderConfig> = {};
          
          for (const [key, value] of Object.entries(config)) {
            if (!knownKeys.has(key) && value && typeof value === "object") {
              providerConfigs[key] = value as ProviderConfig;
            }
          }
          
          return providerConfigs;
        })();
    
    // Reconstruct normalized config
    this.config = {
      ...config,
      providers,
    };
    
    // Store adapters if provided
    if (adapters) {
      this.adapters = adapters;
    }

    // Setup observability
    if (Array.isArray(this.config.observability)) {
      this.observability = this.config.observability;
    } else if (this.config.observability) {
      this.observability = [this.config.observability];
    } else {
      this.observability = [new ConsoleObservability()];
    }

    // Initialize providers
    if (this.config.providers) {
      for (const [providerName, providerConfig] of Object.entries(
        this.config.providers
      )) {
        this.initializeProvider(providerName, providerConfig);
      }
    }
  }

  private initializeProvider(
    providerName: string,
    providerConfig: ProviderConfig
  ): void {
    // Get adapter from config, adapters map, built-in adapters, or throw error
    let adapter = providerConfig.adapter ?? this.adapters.get(providerName);
    
    // Auto-register built-in adapter if available
    if (!adapter && providerName in BUILTIN_ADAPTERS) {
      const builtinAdapter = BUILTIN_ADAPTERS[providerName as keyof typeof BUILTIN_ADAPTERS];
      this.adapters.set(providerName, builtinAdapter);
      adapter = builtinAdapter;
    }
    
    if (!adapter) {
      throw new Error(
        `No adapter found for provider: ${providerName}. Provide adapter in config or use registerProvider().`
      );
    }

    // Setup circuit breaker
    const circuitBreakerConfig = {
      ...this.config.defaults?.circuitBreaker,
      ...providerConfig.circuitBreaker,
    };
    const circuitBreaker = new ProviderCircuitBreaker(
      providerName,
      circuitBreakerConfig
    );
    this.circuitBreakers.set(providerName, circuitBreaker);

    // Setup rate limiter
    const rateLimitConfig = {
      ...this.config.defaults?.rateLimit,
      ...providerConfig.rateLimit,
    };
    const rateLimiter = new RateLimiter(rateLimitConfig);

    // Setup retry strategy
    const retryConfig = {
      ...this.config.defaults?.retry,
      ...providerConfig.retry,
    };
    const idempotencyConfig = adapter.getIdempotencyConfig();
    const idempotencyResolver = new IdempotencyResolver(
      {
        ...idempotencyConfig,
        ...providerConfig.idempotency,
      },
      this.config.idempotency?.defaultLevel ?? IdempotencyLevel.SAFE
    );
    const retryStrategy = new RetryStrategy(retryConfig, idempotencyResolver);

    // Create pipeline
    const pipeline = new RequestPipeline({
      provider: providerName,
      adapter,
      authConfig: providerConfig.auth,
      circuitBreaker,
      rateLimiter,
      retryStrategy,
      idempotencyResolver,
      observability: this.observability,
      timeout: this.config.defaults?.timeout ?? undefined,
      autoGenerateIdempotencyKeys:
        this.config.idempotency?.autoGenerateKeys ?? false,
    });

    this.pipelines.set(providerName, pipeline);

    // Create provider client
    (this as any)[providerName] = this.createProviderClient(providerName);
  }

  private createProviderClient(providerName: string): ProviderClient {
    const pipeline = this.pipelines.get(providerName)!;
    const adapter = this.adapters.get(providerName)!;

    const makeRequest = async <T>(
      method: string,
      endpoint: string,
      options: any = {}
    ): Promise<NormalizedResponse<T>> => {
      return pipeline.execute<T>(endpoint, {
        ...options,
        method: method as any,
      });
    };

    const paginate = async function* <T>(
      endpoint: string,
      options: any = {}
    ): AsyncGenerator<NormalizedResponse<T>> {
      let currentEndpoint = endpoint;
      let currentOptions = { ...options, method: "GET" as const };
      let hasNext = true;

      const paginationStrategy = adapter.getPaginationStrategy();

      while (hasNext) {
        const response = await makeRequest<T>("GET", currentEndpoint, currentOptions);

        yield response;

        hasNext = response.meta.pagination?.hasNext ?? false;
        const cursor = response.meta.pagination?.cursor;

        if (hasNext && cursor) {
          const next = paginationStrategy.buildNextRequest(
            currentEndpoint,
            currentOptions,
            cursor
          );
          currentEndpoint = next.endpoint;
          currentOptions = next.options;
        }
      }
    };

    return {
      get: <T = unknown>(endpoint: string, options?: any) =>
        makeRequest<T>("GET", endpoint, options),
      post: <T = unknown>(endpoint: string, options?: any) =>
        makeRequest<T>("POST", endpoint, options),
      put: <T = unknown>(endpoint: string, options?: any) =>
        makeRequest<T>("PUT", endpoint, options),
      patch: <T = unknown>(endpoint: string, options?: any) =>
        makeRequest<T>("PATCH", endpoint, options),
      delete: <T = unknown>(endpoint: string, options?: any) =>
        makeRequest<T>("DELETE", endpoint, options),
      paginate: <T = unknown>(endpoint: string, options?: any) =>
        paginate<T>(endpoint, options),
    };
  }

  getCircuitStatus(provider: string): CircuitBreakerStatus | null {
    const circuitBreaker = this.circuitBreakers.get(provider);
    return circuitBreaker?.getStatus() ?? null;
  }

  registerProvider(
    name: string,
    adapter: ProviderAdapter,
    config: ProviderConfig
  ): void {
    // Store adapter
    this.adapters.set(name, adapter);
    
    // Ensure providers object exists
    if (!this.config.providers) {
      this.config.providers = {};
    }
    
    // Update config
    this.config.providers[name] = {
      ...config,
      adapter, // Also store in config for consistency
    };
    
    // Initialize provider
    this.initializeProvider(name, this.config.providers[name]!);
  }
}

// Export types and utilities
export * from "./core/types.js";
export * from "./observability/index.js";
export * from "./strategies/index.js";
export * from "./validation/index.js";
// Note: Adapters are NOT exported - they are internal implementation details

