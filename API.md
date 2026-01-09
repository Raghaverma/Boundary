# API Reference

## Boundary Class

### create (Static Factory Method)

```typescript
static create(config: BoundaryConfig, adapters?: Map<string, ProviderAdapter>): Promise<Boundary>
```

Creates and initializes a new Boundary instance. **This is the only way to create Boundary instances.**

**Parameters:**
- `config`: Configuration object with provider settings and global options
- `adapters`: Optional map of provider adapters (built-in adapters auto-register)

**Returns:** `Promise<Boundary>` - Resolves after async initialization completes

**Throws:**
- `Error` if provider configuration is invalid
- `Error` if no adapter found for a configured provider (and not built-in)
- `Error` if `mode: "distributed"` without `stateStorage`
- `Error` if configuration lacks `stateStorage` and `localUnsafe: true` is not set
- `Error` if adapter validation fails

**Stability:** Stable

**Example:**
```typescript
const boundary = await Boundary.create({
  github: {
    auth: { token: process.env.GITHUB_TOKEN },
  },
  localUnsafe: true, // Required for local development
});
```

**Note:** The constructor is private. Use `Boundary.create()` instead.

### getCircuitStatus

```typescript
getCircuitStatus(provider: string): CircuitBreakerStatus | null
```

Returns the current circuit breaker status for a provider.

**Parameters:**
- `provider`: Provider name (e.g., "github")

**Returns:** Circuit breaker status object or `null` if provider not found

**Stability:** Stable

### registerProvider

```typescript
registerProvider(name: string, adapter: ProviderAdapter, config: ProviderConfig): Promise<void>
```

Registers a custom provider adapter at runtime. **Requires initialization** - throws if called before `Boundary.create()` completes.

**Parameters:**
- `name`: Provider identifier
- `adapter`: Provider adapter implementation
- `config`: Provider configuration including auth

**Returns:** `Promise<void>` - Resolves after provider is initialized

**Throws:**
- `Error` if SDK not initialized (call `Boundary.create()` first)
- `Error` if provider name conflicts with existing provider
- `Error` if adapter validation fails

**Stability:** Stable

## Provider Client

Each configured provider exposes a client with HTTP methods. All methods return `Promise<NormalizedResponse<T>>` except `paginate`.

### get

```typescript
get<T = unknown>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>
```

Performs a GET request.

**Parameters:**
- `endpoint`: API endpoint path (e.g., "/users/octocat")
- `options`: Optional request configuration

**Returns:** Normalized response with data and metadata

**Throws:** `NormalizedError` on failure

**Stability:** Stable

### post

```typescript
post<T = unknown>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>
```

Performs a POST request.

**Parameters:**
- `endpoint`: API endpoint path
- `options`: Request configuration including body

**Returns:** Normalized response

**Throws:** `NormalizedError` on failure

**Stability:** Stable

### put

```typescript
put<T = unknown>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>
```

Performs a PUT request.

**Parameters:**
- `endpoint`: API endpoint path
- `options`: Request configuration including body

**Returns:** Normalized response

**Throws:** `NormalizedError` on failure

**Stability:** Stable

### patch

```typescript
patch<T = unknown>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>
```

Performs a PATCH request.

**Parameters:**
- `endpoint`: API endpoint path
- `options`: Request configuration including body

**Returns:** Normalized response

**Throws:** `NormalizedError` on failure

**Stability:** Stable

### delete

```typescript
delete<T = unknown>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>
```

Performs a DELETE request.

**Parameters:**
- `endpoint`: API endpoint path
- `options`: Optional request configuration

**Returns:** Normalized response

**Throws:** `NormalizedError` on failure

**Stability:** Stable

### paginate

```typescript
paginate<T = unknown>(endpoint: string, options?: RequestOptions): AsyncGenerator<NormalizedResponse<T>>
```

Returns an async generator that yields paginated responses.

**Parameters:**
- `endpoint`: API endpoint path
- `options`: Optional request configuration

**Returns:** Async generator yielding normalized responses

**Throws:** `NormalizedError` on failure

**Stability:** Stable

**Example:**
```typescript
for await (const response of boundary.github.paginate("/user/repos")) {
  console.log(response.data);
}
```

## RequestOptions

```typescript
interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean>;
  idempotencyKey?: string;
  timeout?: number;
}
```

## NormalizedResponse

```typescript
interface NormalizedResponse<T> {
  data: T;
  meta: ResponseMeta;
}
```

## BoundaryError

```typescript
interface BoundaryError extends Error {
  category: BoundaryErrorCategory;
  retryable: boolean;
  provider: string;
  message: string;
  metadata?: Record<string, unknown>;
  retryAfter?: Date;
}
```

Error categories: `"auth" | "rate_limit" | "network" | "provider" | "validation"`

**Stability**: Stable. Error categories will not change within a major version.

**Note**: Provider-specific error details are normalized into these categories. Applications should not branch on provider-specific error codes or structures. See `PROVIDER_GUIDE.md` for adapter implementation details.

## NormalizedError (Deprecated)

```typescript
interface NormalizedError extends Error {
  type: ErrorType;
  provider: string;
  actionable: string;
  raw?: unknown;
  retryable: boolean;
  retryAfter?: Date;
}
```

**Status**: Deprecated. Use `BoundaryError` instead. This type is kept for backward compatibility during migration.

## CircuitBreakerStatus

```typescript
interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  nextAttempt: Date | null;
}
```

Circuit states: `"CLOSED" | "OPEN" | "HALF_OPEN"`

## Provider Adapter Contract

The `ProviderAdapter` interface is the authoritative contract for all adapters:

```typescript
interface ProviderAdapter {
  buildRequest(input: AdapterInput): BuiltRequest;
  parseResponse(raw: RawResponse): NormalizedResponse;
  parseError(raw: unknown): BoundaryError;
  authStrategy(config: AuthConfig): Promise<AuthToken>;
  rateLimitPolicy(headers: Headers): RateLimitInfo;
  paginationStrategy(): PaginationStrategy;
  getIdempotencyConfig(): IdempotencyConfig;
}
```

**Stability**: Stable. This contract will not change in breaking ways within the same major version.

**Note**: This is the public contract. Implementation details (how adapters normalize provider-specific behavior) are internal. See `PROVIDER_GUIDE.md` for adapter implementation guidance.

## Stability Guarantees

- **Stable**: API will not change in breaking ways within the same major version
- **Experimental**: API may change in minor versions
- **Deprecated**: API will be removed in next major version

All documented APIs are marked as stable unless otherwise noted.

**Provider-Specific Details**: Boundary's public API does not expose provider-specific details. All provider quirks are normalized by adapters. If you need provider-specific behavior, you should either:
1. Extend the adapter to normalize it into Boundary's canonical forms
2. Accept that the behavior cannot be normalized and handle it outside Boundary

See `PROVIDER_GUIDE.md` for guidance on when normalization is appropriate.


