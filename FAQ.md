# Frequently Asked Questions

## Why does this exist?

Third-party APIs have inconsistent response formats, error structures, rate limit behaviors, and pagination strategies. Applications integrating multiple providers must write provider-specific code for error handling, retry logic, and data transformation. Boundary provides a unified abstraction that eliminates this fragmentation.

## Why not use raw API clients directly?

Raw API clients require:
- Provider-specific error handling
- Custom retry logic per provider
- Manual rate limit management
- Different pagination implementations
- Inconsistent response shapes

Boundary normalizes these differences, allowing applications to interact with any provider through a single interface while maintaining type safety and resilience patterns.

## Is my API token safe?

Tokens are stored in memory only during runtime. They are never:
- Logged (except in error contexts with sanitization)
- Persisted to disk
- Transmitted except to the target API provider
- Exposed in response metadata

Use environment variables for token storage. Never commit tokens to version control.

## How does rate limiting work?

Boundary implements a token bucket algorithm per provider:
- Tokens refill at a configured rate
- Requests consume tokens before execution
- When tokens are exhausted, requests queue or fail
- Adaptive backoff adjusts based on provider rate limit headers
- Rate limit errors do not trip circuit breakers

Rate limiting is per-process. For distributed systems, use external rate limiting (e.g., Redis) in addition to Boundary's built-in limiter.

## What happens when a circuit breaker opens?

When a circuit breaker opens:
- Requests are immediately rejected with `CIRCUIT_OPEN` error
- No network calls are made
- Circuit transitions to `HALF_OPEN` after timeout
- Limited requests allowed in `HALF_OPEN` to test recovery
- Circuit closes after consecutive successes

This prevents cascading failures when a provider is experiencing issues.

## Can I use this in production?

The SDK is in early beta. Core functionality is stable, but:
- Provider coverage is limited
- API may change in minor versions before 1.0.0
- Some edge cases may not be fully tested

Use in production with appropriate monitoring and testing. Report issues promptly.

## How do I add a custom provider?

Implement the `ProviderAdapter` interface:

```typescript
class MyProviderAdapter implements ProviderAdapter {
  async authenticate(config: AuthConfig): Promise<AuthToken> { /* ... */ }
  async makeRequest(endpoint: string, options: RequestOptions, authToken: AuthToken): Promise<RawResponse> { /* ... */ }
  normalizeResponse(raw: RawResponse): NormalizedResponse { /* ... */ }
  parseRateLimit(headers: Headers): RateLimitInfo { /* ... */ }
  parseError(error: unknown): NormalizedError { /* ... */ }
  getPaginationStrategy(): PaginationStrategy { /* ... */ }
  getIdempotencyConfig(): IdempotencyConfig { /* ... */ }
}
```

Then register it:
```typescript
boundary.registerProvider("myprovider", new MyProviderAdapter(), {
  auth: { token: "..." }
});
```

## What are common mistakes?

**Storing tokens in code**: Use environment variables.

**Ignoring circuit breaker status**: Monitor circuit state and handle `CIRCUIT_OPEN` errors gracefully.

**Not handling rate limits**: Implement exponential backoff or queue requests when rate limited.

**Assuming all operations are safe to retry**: Check idempotency levels before implementing custom retry logic.

**Not validating schemas**: Enable schema validation to catch API contract changes early.

**Using wrong pagination strategy**: Ensure your adapter's pagination strategy matches the provider's API.

## Does this work with serverless?

Yes. Boundary is stateless except for in-memory circuit breaker and rate limiter state. For serverless:
- Use `InMemorySchemaStorage` or external storage for schemas
- Circuit breakers reset on cold starts
- Consider external rate limiting for distributed deployments
- Use environment variables for configuration

## How do I handle errors?

All errors are normalized to `NormalizedError` with:
- `type`: Error category
- `actionable`: Human-readable guidance
- `retryable`: Whether the error is transient
- `retryAfter`: When to retry (if applicable)

Check `error.type` and `error.retryable` to determine handling strategy.

## Can I disable certain features?

Yes, through configuration:
- Circuit breaker: Set high thresholds or disable per provider
- Rate limiting: Configure high token limits
- Retry: Set `maxRetries: 0`
- Schema validation: Set `enabled: false`

Some features cannot be fully disabled as they are core to the normalization contract.

