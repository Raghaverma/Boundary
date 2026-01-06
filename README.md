# Boundary - API Normalization SDK

A TypeScript-first, backend-only SDK that sits between applications and third-party APIs, enforcing a single stable contract across all providers.

## Features

- **Unified Response Shape**: All providers return the same normalized response format
- **Resilience Patterns**: Circuit breaker, rate limiting, and retry logic built-in
- **Idempotency Awareness**: Explicit idempotency levels prevent dangerous auto-retries
- **Schema Validation**: Pluggable schema storage with drift detection
- **Observability**: Pluggable logging and metrics adapters
- **Type Safety**: Strict TypeScript with no `any` types in public API

## Installation

```bash
npm install @boundary/sdk
```

## Quick Start

```typescript
import { Boundary } from "@boundary/sdk";
import { GitHubAdapter } from "@boundary/sdk/providers/github";
import { ConsoleObservability } from "@boundary/sdk/observability";
import { FileSystemSchemaStorage } from "@boundary/sdk/validation";

// Option 1: Nested providers structure (recommended for multiple providers)
const boundary = new Boundary(
  {
    providers: {
      github: {
        auth: { token: process.env.GITHUB_TOKEN },
        circuitBreaker: {
          failureThreshold: 5,
          timeout: 30000,
        },
      },
    },
    observability: new ConsoleObservability({ pretty: true }),
    schemaValidation: {
      enabled: true,
      storage: new FileSystemSchemaStorage("./schemas"),
      onDrift: (drifts) => {
        console.warn("Schema drift detected:", drifts);
      },
    },
  },
  new Map([["github", new GitHubAdapter()]])
);

// Option 2: Flat structure (convenient for single provider)
const boundary2 = new Boundary(
  {
    github: {
      auth: { token: process.env.GITHUB_TOKEN },
      circuitBreaker: {
        failureThreshold: 5,
        timeout: 30000,
      },
    },
    observability: new ConsoleObservability({ pretty: true }),
  },
  new Map([["github", new GitHubAdapter()]])
);

// All requests look identical
const { data, meta } = await boundary.github.get("/users/octocat");
console.log(meta.rateLimit.remaining); // Normalized across all providers

// Pagination is unified
for await (const repos of boundary.github.paginate("/user/repos")) {
  console.log(repos);
}

// Circuit breaker status
const status = boundary.getCircuitStatus("github");
console.log(status); // { state: 'CLOSED', failures: 0, ... }
```

## Architecture

### Request Pipeline

Every API request flows through this exact sequence:

```
auth → rate-limit → circuit-breaker → retry → fetch → normalize → error-map → schema-check
```

### Unified Response Shape

```typescript
{
  data: T,
  meta: {
    provider: string,
    requestId: string,
    rateLimit: {
      limit: number,
      remaining: number,
      reset: Date
    },
    pagination?: {
      hasNext: boolean,
      cursor?: string,
      total?: number
    },
    warnings: string[],
    schemaVersion: string
  }
}
```

### Error Contract

```typescript
{
  type: "AUTH_ERROR" | "RATE_LIMIT" | "VALIDATION_ERROR" | "PROVIDER_ERROR" | "NETWORK_ERROR" | "CIRCUIT_OPEN",
  provider: string,
  actionable: string,
  raw?: unknown,
  retryable: boolean,
  retryAfter?: Date
}
```

## Creating a Provider Adapter

```typescript
import type { ProviderAdapter } from "@boundary/sdk";

class MyProviderAdapter implements ProviderAdapter {
  async authenticate(config: AuthConfig): Promise<AuthToken> {
    // Implement authentication
  }

  async makeRequest(
    endpoint: string,
    options: RequestOptions,
    authToken: AuthToken
  ): Promise<RawResponse> {
    // Make the actual HTTP request
  }

  normalizeResponse(raw: RawResponse): NormalizedResponse {
    // Normalize to unified shape
  }

  parseRateLimit(headers: Headers): RateLimitInfo {
    // Extract rate limit info from headers
  }

  parseError(error: unknown): NormalizedError {
    // Normalize errors
  }

  getPaginationStrategy(): PaginationStrategy {
    // Return appropriate pagination strategy
  }

  getIdempotencyConfig(): IdempotencyConfig {
    // Define idempotency levels for operations
  }
}
```

## Configuration

```typescript
interface BoundaryConfig {
  providers: Record<string, ProviderConfig>;
  defaults?: {
    retry?: RetryConfig;
    circuitBreaker?: CircuitBreakerConfig;
    rateLimit?: RateLimitConfig;
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
}
```

## Idempotency Levels

- **SAFE**: Always safe to retry (GET /users)
- **IDEMPOTENT**: Safe if repeated (PUT /users/123)
- **CONDITIONAL**: Safe with idempotency key (POST /payments with Idempotency-Key header)
- **UNSAFE**: Never retry (POST /send-email)

## Circuit Breaker

The circuit breaker prevents cascading failures:

- **CLOSED**: Normal operation
- **OPEN**: Failing, reject immediately
- **HALF_OPEN**: Testing recovery

Configure thresholds for failure rate, success rate, and timeout.

## Rate Limiting

Token bucket implementation with adaptive backoff:

- Respects provider-specific headers (X-RateLimit-*, Retry-After)
- Queues requests when approaching limits
- Coordinates with circuit breaker

## Schema Validation

Pluggable schema storage with drift detection:

- **FileSystemSchemaStorage**: Store in `.boundary/schemas/`
- **InMemorySchemaStorage**: Ephemeral (for testing)
- **RemoteSchemaStorage**: Custom implementation for distributed systems

## Observability

Pluggable adapters for logging and metrics:

- **ConsoleObservability**: JSON structured logs
- **NoOpObservability**: Silent (for testing)
- Custom adapters: Implement `ObservabilityAdapter` interface

## License

MIT

