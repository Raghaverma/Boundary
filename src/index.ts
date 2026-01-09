/**
 * Boundary SDK - Main entry point
 */

import type {
  BoundaryConfig,
  ProviderConfig,
  NormalizedResponse,
  CircuitBreakerStatus,
  ObservabilityAdapter,
  RequestOptions,
} from "./core/types.js";
import { RequestPipeline, type PipelineConfig } from "./core/pipeline.js";
import { ProviderCircuitBreaker } from "./strategies/circuit-breaker.js";
import { RateLimiter } from "./strategies/rate-limit.js";
import { RetryStrategy } from "./strategies/retry.js";
import { IdempotencyResolver } from "./strategies/idempotency.js";
import { IdempotencyLevel } from "./core/types.js";
import { ConsoleObservability } from "./observability/console.js";
import type { ProviderAdapter } from "./core/types.js";
import { assertValidAdapter } from "./core/adapter-validator.js";
import { GitHubAdapter } from "./providers/github/adapter.js";
import { sanitizeObject } from "./core/observability-sanitizer.js";

/**
 * Lazy-instantiated built-in adapters.
 * Adapter classes are imported at module load, but instances are only
 * created when first requested, reducing memory usage when not all
 * providers are used.
 */
const BUILTIN_ADAPTER_CLASSES: Record<string, new () => ProviderAdapter> = {
  github: GitHubAdapter,
};

/**
 * Gets a built-in adapter by name, instantiating lazily if needed.
 * Adapters are scoped per Boundary instance to prevent config sharing.
 */
function getBuiltinAdapter(
  name: string,
  cache: Map<string, ProviderAdapter>
): ProviderAdapter | null {
  // Check instance-scoped cache first
  if (cache.has(name)) {
    return cache.get(name)!;
  }

  // Check if class exists
  const AdapterClass = BUILTIN_ADAPTER_CLASSES[name];
  if (!AdapterClass) {
    return null;
  }

  // Create and cache the adapter instance (lazy instantiation, scoped to instance)
  const adapter = new AdapterClass();
  cache.set(name, adapter);
  return adapter;
}

export interface ProviderClient {
  get<T = unknown>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>;
  post<T = unknown>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>;
  put<T = unknown>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>;
  patch<T = unknown>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>;
  delete<T = unknown>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>;
  paginate<T = unknown>(endpoint: string, options?: RequestOptions): AsyncGenerator<NormalizedResponse<T>>;
}

/**
 * Interface for external state storage (e.g., Redis).
 * Implement this to persist circuit breaker and rate limiter state
 * across serverless function invocations or multiple instances.
 */
export class Boundary {
  private config: BoundaryConfig;
  private pipelines: Map<string, RequestPipeline> = new Map();
  private circuitBreakers: Map<string, ProviderCircuitBreaker> = new Map();
  private observability: ObservabilityAdapter[];
  private adapters: Map<string, ProviderAdapter> = new Map();
  private started = false;
  private adapterCache: Map<string, ProviderAdapter> = new Map();

  private constructor(config: BoundaryConfig, adapters?: Map<string, ProviderAdapter>) {
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

    // NOTE: Provider validation and initialization happens during `start()`.
    // This ensures async adapter checks (authStrategy) are awaited and
    // startup deterministically fails when adapters are invalid.
  }

  /**
   * Async factory that constructs and starts Boundary.
   * This enforces async initialization and makes startup deterministic.
   */
  static async create(config: BoundaryConfig, adapters?: Map<string, ProviderAdapter>) {
    const b = new Boundary(config, adapters);
    await b.start();
    return b;
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
    // Sanitize metadata to ensure no secrets leak
    const safeMetadata = sanitizeObject(
      { component: "Boundary", type: "state_warning" },
      this.config.observabilitySanitizer
    );
    if (this.observability && this.observability.length > 0) {
      // Safely broadcast warning to observability adapters (non-blocking)
      const errors: Array<{ adapter: string; error: unknown }> = [];
      for (const obs of this.observability) {
        try {
          obs.logWarning(warning, safeMetadata as Record<string, unknown>);
        } catch (error) {
          errors.push({
            adapter: obs.constructor?.name || "UnknownObservabilityAdapter",
            error,
          });
        }
      }

      // If all adapters failed, fall back to console.warn
      if (errors.length === this.observability.length) {
        console.warn(warning);
        console.error(
          `[Boundary] All observability adapters failed for logWarning:\n${errors
            .map(
              ({ adapter, error }) =>
                `  - ${adapter}: ${error instanceof Error ? error.message : String(error)}`
            )
            .join("\n")}`
        );
      } else if (errors.length > 0) {
        // Some adapters failed - log errors but don't fallback (partial observability succeeded)
        console.error(
          `[Boundary] Some observability adapters failed for logWarning (${errors.length}/${this.observability.length}):\n${errors
            .map(
              ({ adapter, error }) =>
                `  - ${adapter}: ${error instanceof Error ? error.message : String(error)}`
            )
            .join("\n")}`
        );
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

  private async initializeProvider(
    providerName: string,
    providerConfig: ProviderConfig
  ): Promise<void> {
    // Get adapter from config, adapters map, built-in adapters (lazy-loaded), or throw error
    let adapter = providerConfig.adapter ?? this.adapters.get(providerName);

    // Auto-register built-in adapter if available (lazy-loaded on demand, scoped to instance)
    if (!adapter) {
      const builtinAdapter = getBuiltinAdapter(providerName, this.adapterCache);
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
    await assertValidAdapter(adapter, providerName);

    // Store adapter for later use in createProviderClient
    this.adapters.set(providerName, adapter);

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
    const pipelineConfig: PipelineConfig = {
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
      ...(this.config.observabilitySanitizer
        ? { sanitizerOptions: this.config.observabilitySanitizer }
        : {}),
    };
    const pipeline = new RequestPipeline(pipelineConfig);

    this.pipelines.set(providerName, pipeline);

    // Create provider client
    (this as any)[providerName] = this.createProviderClient(providerName);
  }

  private createProviderClient(providerName: string): ProviderClient {
    const pipeline = this.pipelines.get(providerName)!;
    const adapter = this.adapters.get(providerName);
    if (!adapter) {
      throw new Error(`Adapter not found for provider: ${providerName}`);
    }
    const boundary = this; // Capture for use in closures
    const maxPages = 1000; // Maximum pages to prevent infinite loops

    const makeRequest = async <T>(
      method: string,
      endpoint: string,
      options: RequestOptions = {}
    ): Promise<NormalizedResponse<T>> => {
      boundary.ensureStarted();
      return pipeline.execute<T>(endpoint, {
        ...options,
        method: method as any,
      });
    };

    const paginate = async function* <T>(
      endpoint: string,
      options: RequestOptions = {}
    ): AsyncGenerator<NormalizedResponse<T>> {
      boundary.ensureStarted();
      // Re-get adapter to ensure it's available (defensive)
      const currentAdapter = boundary.adapters.get(providerName);
      if (!currentAdapter) {
        throw new Error(`Adapter not found for provider: ${providerName}`);
      }
      let currentEndpoint = endpoint;
      let currentOptions: RequestOptions = { ...options, method: "GET" };
      let hasNext = true;
      let pageCount = 0;
      const seenCursors = new Set<string>(); // Cycle detection per pagination call

      const paginationStrategy = currentAdapter.paginationStrategy();

      while (hasNext && pageCount < maxPages) {
        const response = await makeRequest<T>("GET", currentEndpoint, currentOptions);
        pageCount++;

        yield response;

        hasNext = response.meta.pagination?.hasNext ?? false;
        const cursor = response.meta.pagination?.cursor;

        if (hasNext && cursor) {
          // Cycle detection: if we've seen this cursor before, we're in a loop
          if (seenCursors.has(cursor)) {
            throw new Error(
              `Pagination cycle detected: cursor "${cursor}" was encountered twice. ` +
              `This indicates a malformed pagination implementation. Stopping at page ${pageCount}.`
            );
          }
          seenCursors.add(cursor);

          const next = paginationStrategy.buildNextRequest(
            currentEndpoint,
            currentOptions,
            cursor
          );
          currentEndpoint = next.endpoint;
          currentOptions = next.options;
        }
      }

      if (hasNext && pageCount >= maxPages) {
        throw new Error(
          `Pagination limit reached: ${maxPages} pages. ` +
          `This may indicate an infinite pagination loop. Consider using a more specific query.`
        );
      }
    };

    return {
      get: <T = unknown>(endpoint: string, options?: RequestOptions) =>
        makeRequest<T>("GET", endpoint, options),
      post: <T = unknown>(endpoint: string, options?: RequestOptions) =>
        makeRequest<T>("POST", endpoint, options),
      put: <T = unknown>(endpoint: string, options?: RequestOptions) =>
        makeRequest<T>("PUT", endpoint, options),
      patch: <T = unknown>(endpoint: string, options?: RequestOptions) =>
        makeRequest<T>("PATCH", endpoint, options),
      delete: <T = unknown>(endpoint: string, options?: RequestOptions) =>
        makeRequest<T>("DELETE", endpoint, options),
      paginate: <T = unknown>(endpoint: string, options?: RequestOptions) =>
        paginate<T>(endpoint, options),
    };
  }

  getCircuitStatus(provider: string): CircuitBreakerStatus | null {
    this.ensureStarted();
    const circuitBreaker = this.circuitBreakers.get(provider);
    return circuitBreaker?.getStatus() ?? null;
  }

  /**
   * Type-safe provider access method with runtime validation.
   *
   * **Compile-Time Safety Limitation:**
   * True compile-time safety for provider lookup is impossible without breaking changes because:
   * - Providers are registered dynamically at runtime via config
   * - Custom provider names cannot be known at compile time
   * - Dynamic property access (boundary.github) requires type casts
   *
   * **Current Guarantees:**
   * - Runtime validation ensures provider exists before returning
   * - Method overloads provide autocomplete for built-in providers
   * - Returns undefined for unregistered providers (no exceptions)
   *
   * **Alternatives:**
   * - Use direct property access: `boundary.github.get(...)` (runtime-only safety)
   * - Use this method with runtime checks: `if (boundary.provider("github"))`
   *
   * @param name - Provider name (e.g., "github" for built-ins, or custom provider name)
   * @returns Provider client if registered, undefined otherwise
   *
   * @example
   * ```typescript
   * // Built-in provider (with autocomplete)
   * const github = boundary.provider("github");
   * if (github) {
   *   const response = await github.get("/user");
   * }
   *
   * // Custom provider (runtime validation only)
   * const custom = boundary.provider("my-custom-provider");
   * if (custom) {
   *   await custom.post("/endpoint", { body: { ... } });
   * }
   * ```
   */
  provider(name: "github"): ProviderClient | undefined;
  provider(name: string): ProviderClient | undefined;
  provider(name: string): ProviderClient | undefined {
    this.ensureStarted();
    // Type assertion is necessary due to dynamic property assignment.
    // This is the unavoidable cost of runtime provider registration.
    // The sanitizer ensures that only valid ProviderClient instances are assigned.
    return (this as any)[name] as ProviderClient | undefined;
  }

  async registerProvider(
    name: string,
    adapter: ProviderAdapter,
    config: ProviderConfig
  ): Promise<void> {
    this.ensureStarted();
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
    
    // Initialize provider if already started
    if (this.started) {
      await this.initializeProvider(name, this.config.providers[name]!);
    }
  }

  /**
   * Async lifecycle start.
   * Validates adapters (including async `authStrategy`) and initializes providers.
   * Enforces deployment mode constraints (e.g., requiring `stateStorage` in distributed mode).
   */
  async start(): Promise<void> {
    // Fail-closed: In distributed mode, StateStorage is REQUIRED
    if (this.config.mode === "distributed" && !this.config.stateStorage) {
      throw new Error(
        "Boundary requires a configured stateStorage in 'distributed' mode. " +
        "Provide a StateStorage implementation (e.g., Redis) for distributed deployments. " +
        "If you intend to use local in-memory state, set mode to 'local' or omit the mode field."
      );
    }

    // Fail-closed: Require StateStorage unless localUnsafe is explicitly true
    // This prevents accidental use of in-memory state in production
    if (!this.config.stateStorage && !this.config.localUnsafe && this.config.mode !== "local") {
      throw new Error(
        "Boundary requires a configured stateStorage unless 'localUnsafe' is set to true. " +
        "For production deployments, provide a StateStorage implementation. " +
        "For local development, explicitly set 'localUnsafe: true' to acknowledge the limitation."
      );
    }

    // Initialize providers with async validation
    if (this.config.providers) {
      for (const [providerName, providerConfig] of Object.entries(this.config.providers)) {
        await this.initializeProvider(providerName, providerConfig as ProviderConfig);
      }
    }

    // If using in-memory state and not distributed, emit warning (only if localUnsafe is true)
    if (this.config.mode !== "distributed" && this.config.localUnsafe) {
      this.emitLocalStateWarning();
    }

    this.started = true;
  }

  /**
   * Runtime guard: Ensures SDK is initialized before use.
   * Throws synchronously if start() has not completed.
   */
  private ensureStarted(): void {
    if (!this.started) {
      throw new Error(
        "Boundary SDK must be initialized before use. " +
        "Call 'await Boundary.create(config)' and await the result before using any methods."
      );
    }
  }
}

// Export types and utilities
export * from "./core/types.js";
export * from "./observability/index.js";
export * from "./strategies/index.js";
export * from "./validation/index.js";
// Note: Adapters are NOT exported - they are internal implementation details

