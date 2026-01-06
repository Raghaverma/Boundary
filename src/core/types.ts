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

export type ErrorType =
  | "AUTH_ERROR"
  | "RATE_LIMIT"
  | "VALIDATION_ERROR"
  | "PROVIDER_ERROR"
  | "NETWORK_ERROR"
  | "CIRCUIT_OPEN";

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

export interface ProviderAdapter {
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

