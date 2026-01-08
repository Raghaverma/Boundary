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
import { assertValidAdapter } from "./core/adapter-validator.js";
import { GitHubAdapter } from "./providers/github/adapter.js";

/**
 * Lazy-instantiated built-in adapters.
 * Adapter classes are imported at module load, but instances are only
 * created when first requested, reducing memory usage when not all
 * providers are used.
 */
const BUILTIN_ADAPTER_CLASSES: Record<string, new () => ProviderAdapter> = {
  github: GitHubAdapter,
};

// Cache for instantiated adapters (lazy instantiation)
const lazyAdapterCache = new Map<string, ProviderAdapter>();

/**
 * Gets a built-in adapter by name, instantiating lazily if needed.
 */
function getBuiltinAdapter(name: string): ProviderAdapter | null {
  // Check cache first
  if (lazyAdapterCache.has(name)) {
    return lazyAdapterCache.get(name)!;
  }

  // Check if class exists
  const AdapterClass = BUILTIN_ADAPTER_CLASSES[name];
  if (!AdapterClass) {
    return null;
  }

  // Create and cache the adapter instance (lazy instantiation)
  const adapter = new AdapterClass();
  lazyAdapterCache.set(name, adapter);
  return adapter;
}

export interface ProviderClient {
  get<T = unknown>(endpoint: string, options?: any): Promise<NormalizedResponse<T>>;
  post<T = unknown>(endpoint: string, options?: any): Promise<NormalizedResponse<T>>;
  put<T = unknown>(endpoint: string, options?: any): Promise<NormalizedResponse<T>>;
  patch<T = unknown>(endpoint: string, options?: any): Promise<NormalizedResponse<T>>;
  delete<T = unknown>(endpoint: string, options?: any): Promise<NormalizedResponse<T>>;
  paginate<T = unknown>(endpoint: string, options?: any): AsyncGenerator<NormalizedResponse<T>>;
}

/**
 * Interface for external state storage (e.g., Redis).
 * Implement this to persist circuit breaker and rate limiter state
 * across serverless function invocations or multiple instances.
 */
export interface StateStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

export class Boundary {
  private config: BoundaryConfig;
  private pipelines: Map<string, RequestPipeline> = new Map();
  private circuitBreakers: Map<string, ProviderCircuitBreaker> = new Map();
  private observability: ObservabilityAdapter[];
  private adapters: Map<string, ProviderAdapter> = new Map();

  constructor(config: BoundaryConfig, adapters?: Map<string, ProviderAdapter>) {
    // Validate configuration
    this.validateConfig(config);

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

    // IMPORTANT: Emit warning about in-memory state (after observability is ready)
    this.emitLocalStateWarning();

    // Initialize providers
    if (this.config.providers) {
      for (const [providerName, providerConfig] of Object.entries(
        this.config.providers
      )) {
        this.initializeProvider(providerName, providerConfig);
      }
    }
  }

  /**
   * Emits a warning about in-memory state that resets on cold starts.
   * This helps developers understand the limitations in serverless environments.
   */
  private emitLocalStateWarning(): void {
    // Use observability adapter if available, otherwise use console
    const warning = [
      "[Boundary] WARNING: Using in-memory state for circuit breaker and rate limiter.",
      "This state will be lost on process restart or serverless cold start.",
      "For production serverless deployments, consider:",
      "  1. Implementing StateStorage interface with Redis/Memcached",
      "  2. Using external rate limiting (API gateway)",
      "  3. Accepting state reset as a trade-off for simplicity",
      "See: https://github.com/Raghaverma/Boundary#state-persistence",
    ].join("\n");

    // Log through observability if available, otherwise console
    if (this.observability && this.observability.length > 0) {
      for (const obs of this.observability) {
        obs.logWarning(warning, { component: "Boundary", type: "state_warning" });
      }
    } else {
      console.warn(warning);
    }
  }

  private validateConfig(config: BoundaryConfig): void {
    const errors: string[] = [];

    // Validate default rate limit config
    if (config.defaults?.rateLimit) {
      const { tokensPerSecond, maxTokens, queueSize } = config.defaults.rateLimit;
      if (tokensPerSecond !== undefined && tokensPerSecond <= 0) {
        errors.push("defaults.rateLimit.tokensPerSecond must be positive");
      }
      if (maxTokens !== undefined && maxTokens <= 0) {
        errors.push("defaults.rateLimit.maxTokens must be positive");
      }
      if (queueSize !== undefined && queueSize <= 0) {
        errors.push("defaults.rateLimit.queueSize must be positive");
      }
    }

    // Validate default retry config
    if (config.defaults?.retry) {
      const { maxRetries, baseDelay, maxDelay } = config.defaults.retry;
      if (maxRetries !== undefined && maxRetries < 0) {
        errors.push("defaults.retry.maxRetries must be non-negative");
      }
      if (baseDelay !== undefined && baseDelay <= 0) {
        errors.push("defaults.retry.baseDelay must be positive");
      }
      if (maxDelay !== undefined && maxDelay <= 0) {
        errors.push("defaults.retry.maxDelay must be positive");
      }
    }

    // Validate default circuit breaker config
    if (config.defaults?.circuitBreaker) {
      const { failureThreshold, timeout, successThreshold } = config.defaults.circuitBreaker;
      if (failureThreshold !== undefined && failureThreshold <= 0) {
        errors.push("defaults.circuitBreaker.failureThreshold must be positive");
      }
      if (timeout !== undefined && timeout <= 0) {
        errors.push("defaults.circuitBreaker.timeout must be positive");
      }
      if (successThreshold !== undefined && successThreshold <= 0) {
        errors.push("defaults.circuitBreaker.successThreshold must be positive");
      }
    }

    // Validate default timeout
    if (config.defaults?.timeout !== undefined && config.defaults.timeout <= 0) {
      errors.push("defaults.timeout must be positive");
    }

    if (errors.length > 0) {
      throw new Error(`Invalid Boundary configuration:\n  - ${errors.join("\n  - ")}`);
    }
  }

  private initializeProvider(
    providerName: string,
    providerConfig: ProviderConfig
  ): void {
    // Get adapter from config, adapters map, built-in adapters (lazy-loaded), or throw error
    let adapter = providerConfig.adapter ?? this.adapters.get(providerName);

    // Auto-register built-in adapter if available (lazy-loaded on demand)
    if (!adapter) {
      const builtinAdapter = getBuiltinAdapter(providerName);
      if (builtinAdapter) {
        this.adapters.set(providerName, builtinAdapter);
        adapter = builtinAdapter;
      }
    }
    
    if (!adapter) {
      throw new Error(
        `No adapter found for provider: ${providerName}. Provide adapter in config or use registerProvider().`
      );
    }

    // Validate adapter contract - fail fast if non-compliant
    assertValidAdapter(adapter, providerName);

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

      const paginationStrategy = adapter.paginationStrategy();

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

