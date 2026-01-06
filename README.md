# Boundary

A TypeScript SDK that normalizes third-party API interactions through a unified request pipeline, enforcing consistent error handling, rate limiting, and response shapes across providers.

## Problem Statement

Applications integrating multiple third-party APIs face inconsistent response formats, error structures, rate limit behaviors, and pagination strategies. This fragmentation requires provider-specific error handling, retry logic, and data transformation code that is difficult to maintain and test.

Boundary provides a single abstraction layer that normalizes these differences, allowing applications to interact with any provider through a consistent interface while maintaining type safety and resilience patterns.

## Non-Goals

- UI components or dashboards
- API mocking or stubbing frameworks
- Request recording or replay functionality
- GraphQL support (v1)
- Webhook handling (v1)
- Multi-region routing
- Built-in caching (applications can layer caching on top)

## Installation

```bash
npm install boundary-sdk
```

## Usage

```typescript
import { Boundary } from "boundary-sdk";

const boundary = new Boundary({
  github: {
    auth: { token: process.env.GITHUB_TOKEN },
  },
});

const { data, meta } = await boundary.github.get("/users/octocat");
console.log(meta.rateLimit.remaining);
```

## Public API

### Boundary Class

- `constructor(config: BoundaryConfig, adapters?: Map<string, ProviderAdapter>)`
- `getCircuitStatus(provider: string): CircuitBreakerStatus | null`
- `registerProvider(name: string, adapter: ProviderAdapter, config: ProviderConfig): void`

### Provider Client

Each configured provider exposes a client with:

- `get<T>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>`
- `post<T>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>`
- `put<T>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>`
- `patch<T>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>`
- `delete<T>(endpoint: string, options?: RequestOptions): Promise<NormalizedResponse<T>>`
- `paginate<T>(endpoint: string, options?: RequestOptions): AsyncGenerator<NormalizedResponse<T>>`

## Project Status

Early beta. Core functionality is stable. Provider coverage is limited. API may change in minor versions before 1.0.0.

## License

MIT. See [LICENSE.md](LICENSE.md) for details.
