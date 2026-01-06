# API Reference

## Boundary Class

### Constructor

```typescript
new Boundary(config: BoundaryConfig, adapters?: Map<string, ProviderAdapter>)
```

Creates a new Boundary instance with configured providers.

**Parameters:**
- `config`: Configuration object with provider settings and global options
- `adapters`: Optional map of provider adapters (built-in adapters auto-register)

**Returns:** `Boundary` instance

**Throws:**
- `Error` if provider configuration is invalid
- `Error` if no adapter found for a configured provider (and not built-in)

**Stability:** Stable

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
registerProvider(name: string, adapter: ProviderAdapter, config: ProviderConfig): void
```

Registers a custom provider adapter at runtime.

**Parameters:**
- `name`: Provider identifier
- `adapter`: Provider adapter implementation
- `config`: Provider configuration including auth

**Returns:** `void`

**Throws:**
- `Error` if provider name conflicts with existing provider

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

## NormalizedError

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

Error types: `"AUTH_ERROR" | "RATE_LIMIT" | "VALIDATION_ERROR" | "PROVIDER_ERROR" | "NETWORK_ERROR" | "CIRCUIT_OPEN"`

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

## Stability Guarantees

- **Stable**: API will not change in breaking ways within the same major version
- **Experimental**: API may change in minor versions
- **Deprecated**: API will be removed in next major version

All documented APIs are marked as stable unless otherwise noted.

