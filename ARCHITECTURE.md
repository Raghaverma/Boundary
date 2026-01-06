# Architecture

## Overview

Boundary normalizes third-party API interactions through a unified request pipeline. Every request flows through the same sequence of steps, ensuring consistent behavior across all providers.

## Core Components

### 1. Request Pipeline (`src/core/pipeline.ts`)

The pipeline orchestrates the request flow:

```
auth → rate-limit → circuit-breaker → retry → fetch → normalize → error-map → schema-check
```

Each step is responsible for a specific concern:
- **auth**: Authenticates with the provider
- **rate-limit**: Acquires tokens from the rate limiter
- **circuit-breaker**: Checks circuit state before proceeding
- **retry**: Wraps the fetch in retry logic
- **fetch**: Makes the actual HTTP request
- **normalize**: Converts provider response to unified shape
- **error-map**: Normalizes errors to unified error contract
- **schema-check**: Validates response against stored schema (if enabled)

### 2. Provider Adapters (`src/providers/`)

Each provider implements the `ProviderAdapter` interface:

```typescript
interface ProviderAdapter {
  authenticate(config: AuthConfig): Promise<AuthToken>
  makeRequest(endpoint: string, options: RequestOptions, authToken: AuthToken): Promise<RawResponse>
  normalizeResponse(raw: RawResponse): NormalizedResponse
  parseRateLimit(headers: Headers): RateLimitInfo
  parseError(error: unknown): NormalizedError
  getPaginationStrategy(): PaginationStrategy
  getIdempotencyConfig(): IdempotencyConfig
}
```

### 3. Resilience Strategies (`src/strategies/`)

#### Circuit Breaker (`circuit-breaker.ts`)

State machine with three states:
- **CLOSED**: Normal operation, requests flow through
- **OPEN**: Circuit is open, requests rejected immediately
- **HALF_OPEN**: Testing recovery, allows limited requests

Transitions:
- CLOSED → OPEN: When error rate exceeds threshold
- OPEN → HALF_OPEN: After timeout duration
- HALF_OPEN → CLOSED: After N consecutive successes
- HALF_OPEN → OPEN: On any failure

#### Rate Limiter (`rate-limit.ts`)

Token bucket implementation:
- Refills tokens at configured rate
- Queues requests when tokens exhausted
- Adaptive backoff based on provider headers
- Coordinates with circuit breaker (rate limits don't trip circuit)

#### Retry Strategy (`retry.ts`)

Exponential backoff with jitter:
- Respects idempotency levels
- Retries only retryable errors
- Configurable max retries and delays

#### Idempotency Resolver (`idempotency.ts`)

Determines idempotency level for operations:
- **SAFE**: Always retry (GET requests)
- **IDEMPOTENT**: Retry with caution (PUT requests)
- **CONDITIONAL**: Retry only with idempotency key (POST with key)
- **UNSAFE**: Never retry (destructive operations)

### 4. Schema Validation (`src/validation/`)

#### Schema Storage

Pluggable storage interface:
- **FileSystemSchemaStorage**: Stores in `.boundary/schemas/`
- **InMemorySchemaStorage**: Ephemeral (for testing)
- Custom implementations for distributed systems

#### Drift Detection

Compares new schemas against stored schemas:
- Detects field removals (ERROR)
- Detects type changes (ERROR)
- Detects required field changes (WARNING)

### 5. Observability (`src/observability/`)

Pluggable adapters for logging and metrics:
- **ConsoleObservability**: JSON structured logs
- **NoOpObservability**: Silent (for testing)
- Custom adapters implement `ObservabilityAdapter` interface

Standard metrics:
- `boundary.request.count` - Request count by status
- `boundary.request.duration` - Request duration
- `boundary.request.error` - Error count by type
- `boundary.circuit.state` - Circuit breaker state
- `boundary.ratelimit.remaining` - Rate limit remaining

## Data Flow

### Request Flow

1. User calls `boundary.github.get('/users/octocat')`
2. Provider client calls pipeline's `execute()` method
3. Pipeline:
   - Authenticates (gets token)
   - Acquires rate limit token
   - Checks circuit breaker state
   - Wraps in retry logic
   - Makes HTTP request via adapter
   - Normalizes response
   - Maps errors (if any)
   - Validates schema (if enabled)
4. Returns normalized response to user

### Error Flow

1. Error occurs at any step
2. Caught by retry strategy or pipeline
3. Error mapper normalizes to `NormalizedError`
4. Observability adapters log error
5. Error thrown to user

### Pagination Flow

1. User calls `boundary.github.paginate('/user/repos')`
2. Generator function:
   - Makes initial request
   - Yields response
   - Extracts pagination info from response
   - Uses pagination strategy to build next request
   - Repeats until `hasNext` is false

## Configuration

### Provider Configuration

```typescript
{
  auth: { token: "..." },
  circuitBreaker: { failureThreshold: 5 },
  rateLimit: { tokensPerSecond: 10 },
  retry: { maxRetries: 3 },
  idempotency: { /* overrides */ }
}
```

### Global Defaults

Applied to all providers unless overridden:

```typescript
{
  defaults: {
    retry: { maxRetries: 3 },
    circuitBreaker: { timeout: 60000 },
    rateLimit: { maxTokens: 100 },
    timeout: 30000
  }
}
```

## Extension Points

### Adding a New Provider

1. Implement `ProviderAdapter` interface
2. Define idempotency config for operations
3. Implement pagination strategy (or use built-in)
4. Register with `boundary.registerProvider()`

### Custom Observability

1. Implement `ObservabilityAdapter` interface
2. Pass to `Boundary` constructor in `observability` config

### Custom Schema Storage

1. Implement `SchemaStorage` interface
2. Pass to `Boundary` constructor in `schemaValidation.storage`

## Design Decisions

### Per-Provider Circuit Breakers

Circuit breakers are per-provider, not per-endpoint. This simplifies state management and prevents one bad endpoint from breaking the entire provider.

### Explicit Idempotency

Idempotency is explicitly declared per operation, not inferred from HTTP verbs. This prevents dangerous auto-retries.

### Pluggable Storage

Schema storage is pluggable to support different deployment models (serverless vs long-running).

### Provider-Scoped Versioning

Each provider can have its own version, allowing independent evolution while keeping the core SDK stable.

## Testing Strategy

- **Unit tests**: Mock all external dependencies
- **Integration tests**: Test against real APIs with test accounts
- **Snapshot tests**: Verify normalized response shapes
- **Property-based tests**: Test retry logic edge cases
- **State machine tests**: Verify circuit breaker transitions

