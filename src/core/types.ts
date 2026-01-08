/**
 * Core type definitions for the Boundary SDK
 */

// ============================================================================
// Unified Response Shape
// ============================================================================

export interface NormalizedResponse<T = unknown> {
  data: T;
  meta: ResponseMeta;
}

export interface ResponseMeta {
  provider: string;
  requestId: string;
  rateLimit: RateLimitInfo;
  pagination?: PaginationInfo;
  warnings: string[];
  schemaVersion: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}

export interface PaginationInfo {
  hasNext: boolean;
  cursor?: string;
  total?: number;
}

// ============================================================================
// Error Contract
// ============================================================================

/**
 * Canonical Boundary error categories.
 * These are the ONLY error categories that may escape adapters.
 * Provider-specific error semantics MUST be mapped to these categories.
 */
export type BoundaryErrorCategory =
  | "auth"        // Authentication/authorization failures
  | "rate_limit"  // Rate limiting violations
  | "network"     // Network-level failures (timeouts, connection errors)
  | "provider"    // Provider service errors (5xx, provider-specific issues)
  | "validation"; // Request validation errors (4xx, except auth)

/**
 * Canonical Boundary error type.
 * 
 * INVARIANTS:
 * - MUST be the only error type that escapes adapters
 * - MUST NOT contain provider-specific fields
 * - MUST map all provider errors to canonical categories
 * - MUST provide retryable flag for retry strategy
 * 
 * GUARANTEES:
 * - category is always one of the canonical categories
 * - retryable accurately reflects whether retry is safe
 * - provider identifies the source provider
 * - message is human-readable and actionable
 * 
 * MUST NEVER LEAK:
 * - Provider-specific error codes
 * - Provider-specific error structures
 * - Raw provider error objects (except in metadata for debugging)
 */
export interface BoundaryError extends Error {
  /**
   * Canonical error category. All provider errors MUST map to one of these.
   */
  category: BoundaryErrorCategory;
  
  /**
   * Whether this error is safe to retry.
   * MUST be accurate - incorrect values break retry logic.
   */
  retryable: boolean;
  
  /**
   * Provider identifier (e.g., "github", "stripe").
   */
  provider: string;
  
  /**
   * Human-readable, actionable error message.
   * MUST NOT include provider-specific terminology.
   */
  message: string;
  
  /**
   * Optional metadata for debugging.
   * MAY contain provider-specific details, but MUST NOT be required for error handling.
   */
  metadata?: Record<string, unknown>;
  
  /**
   * Optional retry-after timestamp for rate limit errors.
   */
  retryAfter?: Date;
}

/**
 * @deprecated Use BoundaryError instead. This type is kept for backward compatibility
 * during migration and will be removed.
 */
export type ErrorType =
  | "AUTH_ERROR"
  | "RATE_LIMIT"
  | "VALIDATION_ERROR"
  | "PROVIDER_ERROR"
  | "NETWORK_ERROR"
  | "CIRCUIT_OPEN";

/**
 * @deprecated Use BoundaryError instead. This type is kept for backward compatibility
 * during migration and will be removed.
 */
export interface NormalizedError extends Error {
  type: ErrorType;
  provider: string;
  actionable: string;
  raw?: unknown;
  retryable: boolean;
  retryAfter?: Date;
}

// ============================================================================
// Request Types
// ============================================================================

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
  idempotencyKey?: string;
  timeout?: number;
}

export interface RequestContext {
  provider: string;
  endpoint: string;
  method: string;
  requestId: string;
  timestamp: Date;
  options: RequestOptions;
}

export interface ResponseContext {
  provider: string;
  endpoint: string;
  method: string;
  requestId: string;
  statusCode: number;
  duration: number;
  timestamp: Date;
}

export interface ErrorContext {
  provider: string;
  endpoint: string;
  method: string;
  requestId: string;
  error: NormalizedError;
  duration: number;
  timestamp: Date;
}

// ============================================================================
// Authentication
// ============================================================================

export interface AuthConfig {
  token?: string;
  apiKey?: string;
  apiKeyHeader?: string; // e.g., "X-API-Key"
  apiKeyQuery?: string; // e.g., "api_key"
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  custom?: Record<string, string>;
}

export interface AuthToken {
  token: string;
  expiresAt?: Date;
  refreshToken?: string;
}

// ============================================================================
// Provider Adapter Interface
// ============================================================================

export interface RawResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

/**
 * Adapter input for building requests.
 * Contains all information needed to construct a provider-specific request.
 */
export interface AdapterInput {
  endpoint: string;
  options: RequestOptions;
  authToken: AuthToken;
  baseUrl?: string;
}

/**
 * Built request ready for HTTP execution.
 * Adapter builds this, but pipeline executes it.
 */
export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

/**
 * Authoritative Provider Adapter Contract.
 * 
 * This contract defines the behavior that ALL adapters MUST implement.
 * It is behavior-focused, not data-focused - adapters transform between
 * Boundary's normalized world and provider-specific implementations.
 * 
 * INVARIANTS:
 * - Adapters MUST NOT leak provider-specific types or structures
 * - Adapters MUST map all provider errors to BoundaryError
 * - Adapters MUST normalize all responses to NormalizedResponse
 * - Adapters MUST NOT contain provider-specific conditionals in core
 * 
 * If an adapter cannot satisfy this contract, it MUST NOT compile.
 */
export interface ProviderAdapter {
  /**
   * Builds a request from normalized input.
   * 
   * ASSUMES:
   * - Input is valid Boundary request structure
   * - Auth token is already obtained via authStrategy
   * 
   * GUARANTEES:
   * - Returns a complete, executable HTTP request
   * - Request includes all necessary provider-specific headers
   * - Request URL is fully qualified
   * - Request body is serialized if needed
   * 
   * MUST NEVER LEAK:
   * - Provider-specific request building logic to core
   * - Provider-specific authentication mechanisms
   * 
   * @param input Normalized request input
   * @returns Built request ready for HTTP execution
   */
  buildRequest(input: AdapterInput): BuiltRequest;

  /**
   * Parses a raw provider response into normalized form.
   * 
   * ASSUMES:
   * - Response is from the provider's API
   * - Response structure matches provider's format
   * 
   * GUARANTEES:
   * - Returns NormalizedResponse with canonical structure
   * - Extracts rate limit information correctly
   * - Extracts pagination information correctly
   * - Handles all valid response status codes
   * 
   * MUST NEVER LEAK:
   * - Provider-specific response fields
   * - Provider-specific data structures
   * - Provider-specific metadata
   * 
   * @param raw Raw response from provider
   * @returns Normalized response
   * @throws BoundaryError if response cannot be normalized
   */
  parseResponse(raw: RawResponse): NormalizedResponse;

  /**
   * Parses a provider error into canonical BoundaryError.
   * 
   * ASSUMES:
   * - Error is from provider API or network layer
   * - Error may be in provider-specific format
   * 
   * GUARANTEES:
   * - Returns BoundaryError with canonical category
   * - Maps all provider errors to one of: auth, rate_limit, network, provider, validation
   * - Sets retryable flag accurately
   * - Provides actionable error message
   * - NEVER returns raw provider error
   * 
   * MUST NEVER LEAK:
   * - Provider-specific error codes
   * - Provider-specific error structures
   * - Provider-specific error messages (must be normalized)
   * 
   * CRITICAL: This is the ONLY place provider errors may be handled.
   * Core code MUST NOT branch on provider-specific error semantics.
   * 
   * @param raw Raw error from provider or network
   * @returns Canonical BoundaryError
   */
  parseError(raw: unknown): BoundaryError;

  /**
   * Authentication strategy for this provider.
   * 
   * ASSUMES:
   * - AuthConfig contains valid credentials for provider
   * 
   * GUARANTEES:
   * - Returns valid AuthToken if credentials are valid
   * - Throws BoundaryError with category "auth" if authentication fails
   * - Handles token refresh if applicable
   * 
   * MUST NEVER LEAK:
   * - Provider-specific authentication mechanisms
   * - Provider-specific token formats
   * 
   * @param config Authentication configuration
   * @returns Authentication token
   * @throws BoundaryError with category "auth" on failure
   */
  authStrategy(config: AuthConfig): Promise<AuthToken>;

  /**
   * Rate limit policy for extracting rate limit information.
   * 
   * ASSUMES:
   * - Headers contain provider-specific rate limit information
   * 
   * GUARANTEES:
   * - Returns RateLimitInfo with accurate limit, remaining, and reset time
   * - Handles missing headers gracefully (returns defaults)
   * - Normalizes provider-specific rate limit formats
   * 
   * MUST NEVER LEAK:
   * - Provider-specific rate limit header names
   * - Provider-specific rate limit formats
   * 
   * @param headers Response headers
   * @returns Normalized rate limit information
   */
  rateLimitPolicy(headers: Headers): RateLimitInfo;

  /**
   * Pagination strategy for this provider.
   * 
   * ASSUMES:
   * - Response may contain pagination information
   * 
   * GUARANTEES:
   * - Correctly identifies if more pages exist
   * - Extracts cursor/token for next page
   * - Builds next request correctly
   * 
   * MUST NEVER LEAK:
   * - Provider-specific pagination mechanisms
   * - Provider-specific pagination formats
   * 
   * @returns Pagination strategy implementation
   */
  paginationStrategy(): PaginationStrategy;

  /**
   * Idempotency configuration for this provider.
   * 
   * ASSUMES:
   * - Provider has specific idempotency requirements
   * 
   * GUARANTEES:
   * - Returns accurate idempotency levels for operations
   * - Identifies safe operations correctly
   * - Identifies unsafe operations correctly
   * 
   * @returns Idempotency configuration
   */
  getIdempotencyConfig(): IdempotencyConfig;
}

/**
 * @deprecated Legacy adapter interface. Use ProviderAdapter instead.
 * Kept for backward compatibility during migration.
 */
export interface LegacyProviderAdapter {
  authenticate(config: AuthConfig): Promise<AuthToken>;
  makeRequest(
    endpoint: string,
    options: RequestOptions,
    authToken: AuthToken
  ): Promise<RawResponse>;
  normalizeResponse(raw: RawResponse): NormalizedResponse;
  parseRateLimit(headers: Headers): RateLimitInfo;
  parseError(error: unknown): NormalizedError;
  getPaginationStrategy(): PaginationStrategy;
  getIdempotencyConfig(): IdempotencyConfig;
}

// ============================================================================
// Idempotency
// ============================================================================

export enum IdempotencyLevel {
  SAFE = "SAFE", // Always safe to retry (GET /users)
  IDEMPOTENT = "IDEMPOTENT", // Safe if repeated (PUT /users/123)
  CONDITIONAL = "CONDITIONAL", // Safe with idempotency key (POST /payments with Idempotency-Key header)
  UNSAFE = "UNSAFE", // Never retry (POST /send-email)
}

export interface IdempotencyConfig {
  defaultSafeOperations: Set<string>; // e.g., ["GET", "HEAD", "OPTIONS"]
  operationOverrides: Map<string, IdempotencyLevel>; // e.g., "POST /repos/:owner/:repo/pulls" -> CONDITIONAL
}

// ============================================================================
// Pagination
// ============================================================================

export interface PaginationStrategy {
  extractCursor(response: RawResponse): string | null;
  extractTotal(response: RawResponse): number | null;
  hasNext(response: RawResponse): boolean;
  buildNextRequest(
    endpoint: string,
    options: RequestOptions,
    cursor: string
  ): { endpoint: string; options: RequestOptions };
}

// ============================================================================
// Circuit Breaker
// ============================================================================

export enum CircuitState {
  CLOSED = "CLOSED", // Normal operation
  OPEN = "OPEN", // Failing, reject immediately
  HALF_OPEN = "HALF_OPEN", // Testing recovery
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // Open after N failures (default: 5)
  successThreshold: number; // Close after N successes in HALF_OPEN (default: 2)
  timeout: number; // Time in OPEN before HALF_OPEN (default: 60000ms)
  volumeThreshold: number; // Min requests before circuit can open (default: 10)
  rollingWindowMs: number; // Error rate calculation window (default: 60000ms)
  errorThresholdPercentage: number; // Open if error rate exceeds this (default: 50)
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  nextAttempt: Date | null;
}

// ============================================================================
// Rate Limiting
// ============================================================================

export interface RateLimitConfig {
  tokensPerSecond: number;
  maxTokens: number;
  adaptiveBackoff: boolean;
  queueSize?: number; // Max queued requests when at limit
}

// ============================================================================
// Retry
// ============================================================================

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // Base delay in ms
  maxDelay: number; // Max delay in ms
  jitter: boolean;
}

// ============================================================================
// Schema Validation
// ============================================================================

export interface Schema {
  type: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  [key: string]: unknown;
}

export interface SchemaMetadata {
  provider: string;
  endpoint: string;
  version: string;
  checksum: string;
  createdAt: Date;
}

export interface SchemaDrift {
  type:
    | "FIELD_REMOVED"
    | "TYPE_CHANGED"
    | "REQUIRED_ADDED"
    | "REQUIRED_REMOVED";
  field: string;
  oldValue: unknown;
  newValue: unknown;
  severity: "WARNING" | "ERROR";
}

export interface SchemaStorage {
  save(
    provider: string,
    endpoint: string,
    schema: Schema,
    version: string
  ): Promise<void>;
  load(provider: string, endpoint: string): Promise<Schema | null>;
  list(provider: string): Promise<SchemaMetadata[]>;
}

// ============================================================================
// Observability
// ============================================================================

export interface Metric {
  name: string;
  value: number;
  tags: Record<string, string>;
  timestamp: Date;
}

export interface ObservabilityAdapter {
  logRequest(context: RequestContext): void;
  logResponse(context: ResponseContext): void;
  logError(context: ErrorContext): void;
  logWarning(message: string, metadata?: Record<string, unknown>): void;
  recordMetric(metric: Metric): void;
}

// ============================================================================
// Configuration
// ============================================================================

export interface ProviderConfig {
  auth: AuthConfig;
  adapter?: ProviderAdapter; // Adapter can be provided in config
  baseUrl?: string;
  retry?: Partial<RetryConfig>;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  rateLimit?: Partial<RateLimitConfig>;
  idempotency?: Partial<IdempotencyConfig>;
}

export interface BoundaryConfig {
  providers?: Record<string, ProviderConfig>;
  defaults?: {
    retry?: Partial<RetryConfig>;
    circuitBreaker?: Partial<CircuitBreakerConfig>;
    rateLimit?: Partial<RateLimitConfig>;
    timeout?: number;
  };
  schemaValidation?: {
    enabled: boolean;
    storage: SchemaStorage;
    onDrift?: (drifts: SchemaDrift[]) => void;
    strictMode?: boolean;
  };
  observability?: ObservabilityAdapter | ObservabilityAdapter[];
  idempotency?: {
    defaultLevel: IdempotencyLevel;
    autoGenerateKeys?: boolean;
  };
  // Allow provider configs at top level for convenience
  [providerName: string]: unknown;
}

// ============================================================================
// Versioning
// ============================================================================

export const SDK_VERSION = "1.0.0";

export interface ProviderVersion {
  [provider: string]: string;
}

