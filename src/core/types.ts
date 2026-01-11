





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






export type BoundaryErrorCategory =
  | "auth"        
  | "rate_limit"  
  | "network"     
  | "provider"    
  | "validation"; 


export class BoundaryError extends Error {
  
  category: BoundaryErrorCategory;

  
  retryable: boolean;

  
  provider: string;

  
  metadata?: Record<string, unknown>;

  
  retryAfter?: Date;

  constructor(
    message: string,
    category: BoundaryErrorCategory,
    provider: string,
    retryable: boolean,
    metadata?: Record<string, unknown>,
    retryAfter?: Date
  ) {
    super(message);
    this.name = "BoundaryError";
    this.category = category;
    this.provider = provider;
    this.retryable = retryable;

    
    if (metadata !== undefined) {
      this.metadata = metadata;
    }
    if (retryAfter !== undefined) {
      this.retryAfter = retryAfter;
    }

    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BoundaryError);
    }
  }
}


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
  error: BoundaryError;
  duration: number;
  timestamp: Date;
}





export interface AuthConfig {
  token?: string;
  apiKey?: string;
  apiKeyHeader?: string; 
  apiKeyQuery?: string; 
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


export interface StateStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}





export interface RawResponse {
  status: number;
  headers: Headers;
  body: unknown;
}


export interface AdapterInput {
  endpoint: string;
  options: RequestOptions;
  authToken: AuthToken;
  baseUrl?: string;
}


export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
}


export interface ProviderAdapter {
  
  buildRequest(input: AdapterInput): BuiltRequest;

  
  parseResponse(raw: RawResponse): NormalizedResponse;

  
  parseError(raw: unknown): BoundaryError;

  
  authStrategy(config: AuthConfig): Promise<AuthToken>;

  
  rateLimitPolicy(headers: Headers): RateLimitInfo;

  
  paginationStrategy(): PaginationStrategy;

  
  getIdempotencyConfig(): IdempotencyConfig;
}


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





export enum IdempotencyLevel {
  SAFE = "SAFE", 
  IDEMPOTENT = "IDEMPOTENT", 
  CONDITIONAL = "CONDITIONAL", 
  UNSAFE = "UNSAFE", 
}

export interface IdempotencyConfig {
  defaultSafeOperations: Set<string>; 
  operationOverrides: Map<string, IdempotencyLevel>; 
}





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





export enum CircuitState {
  CLOSED = "CLOSED", 
  OPEN = "OPEN", 
  HALF_OPEN = "HALF_OPEN", 
}

export interface CircuitBreakerConfig {
  failureThreshold: number; 
  successThreshold: number; 
  timeout: number; 
  volumeThreshold: number; 
  rollingWindowMs: number; 
  errorThresholdPercentage: number; 
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  nextAttempt: Date | null;
}





export interface RateLimitConfig {
  tokensPerSecond: number;
  maxTokens: number;
  adaptiveBackoff: boolean;
  queueSize?: number; 
}





export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; 
  maxDelay: number; 
  jitter: boolean;
}





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





export interface ProviderConfig {
  auth: AuthConfig;
  adapter?: ProviderAdapter; 
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
  
  mode?: "local" | "distributed";
  
  stateStorage?: StateStorage;
  
  observabilitySanitizer?: {
    redactedKeys?: string[];
  };
  
  localUnsafe?: boolean;
  
  [providerName: string]: unknown;
}





import packageJson from "../../package.json";
export const SDK_VERSION = packageJson.version;

export interface ProviderVersion {
  [provider: string]: string;
}

