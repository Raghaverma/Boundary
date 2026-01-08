# Provider Adapter Guide

## Overview

This guide explains how to write Boundary adapters, why it's difficult, and when to say "no" to provider-specific behavior that cannot be normalized.

**This guide does not soften language.** Adapter writing is hard by design. Boundary enforces strict normalization because the alternative (provider-specific code throughout applications) is worse.

## The Adapter Contract

All adapters MUST implement the `ProviderAdapter` interface:

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

If your adapter cannot satisfy this contract, it will not compile. This is intentional.

## Why Adapter Writing is Hard

### 1. Zero Leakage Requirement

**Constraint**: Provider-specific semantics MUST NOT leak into core or application code.

**What this means**: If GitHub uses 404 for both "resource not found" and "no access", your adapter must disambiguate this. Core code will never see a 404 - it will see a `BoundaryError` with category `validation` or `auth`.

**Why this is hard**: You must understand ALL provider quirks and normalize them explicitly. There are no shortcuts.

### 2. Explicit Rejection of Non-Normalizable Behavior

**Constraint**: If something cannot be normalized cleanly, it MUST fail loudly.

**What this means**: You cannot add "convenience" methods that expose provider-specific behavior. You cannot add conditionals in core to handle provider quirks. If a provider does something that doesn't fit Boundary's model, you must either:
- Normalize it explicitly in the adapter
- Reject it (throw an error)
- Document why it cannot be normalized

**Why this is hard**: You must make hard decisions about what can and cannot be normalized. Some provider features may not fit.

### 3. No SDK Shortcuts

**Constraint**: Do NOT wrap provider SDKs. All logic must be explicit.

**What this means**: You cannot just wrap `@octokit/rest` and call it done. You must:
- Build requests explicitly
- Parse responses explicitly
- Handle errors explicitly
- Understand the provider's HTTP API directly

**Why this is hard**: SDKs hide complexity. You must understand the underlying HTTP API to normalize it correctly.

### 4. Verbosity is Required

**Constraint**: Do not reduce adapter verbosity.

**What this means**: Adapters should be explicit about what they're doing. If GitHub's 404 handling requires 50 lines of code to disambiguate, write 50 lines. Do not abstract it away.

**Why this is hard**: It's tempting to create abstractions. But abstractions hide provider quirks, making them harder to understand and maintain.

## How to Write an Adapter

### Step 1: Understand the Provider's API

Before writing code, understand:
- How the provider authenticates
- How the provider handles errors (all error codes and their meanings)
- How the provider implements rate limiting (headers, status codes)
- How the provider implements pagination (cursors, offsets, Link headers)
- What quirks exist (overloaded status codes, ambiguous errors)

**Do not skip this step.** You will write incorrect code if you don't understand the provider.

### Step 2: Implement buildRequest

`buildRequest` constructs the HTTP request but does NOT execute it.

```typescript
buildRequest(input: AdapterInput): BuiltRequest {
  const { endpoint, options, authToken, baseUrl } = input;
  
  // Build URL
  const url = new URL(endpoint, baseUrl ?? this.baseUrl);
  
  // Add query parameters
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, String(value));
    }
  }
  
  // Build headers (provider-specific)
  const headers: Record<string, string> = {
    "Accept": "application/vnd.provider.v1+json", // Provider-specific
    "User-Agent": "Boundary-SDK/1.0.0",
    ...options.headers,
  };
  
  // Add authentication (provider-specific)
  if (authToken.token) {
    headers["Authorization"] = `Bearer ${authToken.token}`;
  }
  
  // Serialize body
  let body: string | undefined;
  if (options.body && options.method !== "GET") {
    body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }
  
  return {
    url: url.toString(),
    method: options.method ?? "GET",
    headers,
    body,
  };
}
```

**Key points**:
- All provider-specific headers go here
- All provider-specific URL construction goes here
- Do NOT execute the request (that's the pipeline's job)

### Step 3: Implement parseResponse

`parseResponse` normalizes the provider's response into Boundary's canonical form.

```typescript
parseResponse(raw: RawResponse): NormalizedResponse {
  // Extract rate limit (provider-specific)
  const rateLimitInfo = this.rateLimitPolicy(raw.headers);
  
  // Extract pagination (provider-specific)
  const paginationStrategy = this.paginationStrategy();
  const paginationInfo = ResponseNormalizer.extractPaginationInfo(
    raw,
    paginationStrategy
  );
  
  // Normalize response
  return ResponseNormalizer.normalize(
    raw,
    "provider-name",
    rateLimitInfo,
    paginationInfo,
    [],
    "1.0.0"
  );
}
```

**Key points**:
- Use `ResponseNormalizer.normalize` for the structure
- Extract rate limit and pagination using your policies
- Do NOT add provider-specific fields to the response

### Step 4: Implement parseError (CRITICAL)

`parseError` is the MOST IMPORTANT method. This is where ALL provider error handling happens.

```typescript
parseError(raw: unknown): BoundaryError {
  // Network errors
  if (raw instanceof Error) {
    if (this.isNetworkError(raw)) {
      return this.createBoundaryError(
        "network",
        true,
        "Network request failed. Check your connection and try again.",
        { originalError: raw.message }
      );
    }
  }
  
  // HTTP errors
  if (this.isHttpError(raw)) {
    const httpError = raw as { status: number; headers?: Headers; body?: unknown };
    return this.parseHttpError(httpError);
  }
  
  // Unknown - treat as provider error
  return this.createBoundaryError(
    "provider",
    false,
    "An unexpected error occurred",
    { raw }
  );
}

private parseHttpError(error: { status: number; headers?: Headers; body?: unknown }): BoundaryError {
  const status = error.status;
  
  // 401 = auth
  if (status === 401) {
    return this.createBoundaryError(
      "auth",
      false,
      "Authentication failed. Check your credentials.",
      { providerMessage: this.extractMessage(error.body) }
    );
  }
  
  // 403 = could be auth OR rate limit (provider-specific!)
  if (status === 403) {
    // Check if it's actually a rate limit
    if (this.isRateLimitError(error)) {
      return this.createBoundaryError(
        "rate_limit",
        true,
        "Rate limit exceeded. Please wait before retrying.",
        {},
        this.extractRetryAfter(error.headers)
      );
    }
    // Otherwise, it's auth
    return this.createBoundaryError(
      "auth",
      false,
      "Permission denied. Check your token has the required scopes.",
      {}
    );
  }
  
  // 404 = validation (but provider might use it for auth - disambiguate!)
  if (status === 404) {
    // Provider-specific logic to disambiguate
    if (this.isAuthError(error)) {
      return this.createBoundaryError("auth", false, "...", {});
    }
    return this.createBoundaryError("validation", false, "Resource not found.", {});
  }
  
  // 422 = validation
  if (status === 422) {
    return this.createBoundaryError(
      "validation",
      false,
      this.formatValidationErrors(error.body),
      { fieldErrors: this.extractFieldErrors(error.body) }
    );
  }
  
  // 429 = rate limit
  if (status === 429) {
    return this.createBoundaryError(
      "rate_limit",
      true,
      "Rate limit exceeded.",
      {},
      this.extractRetryAfter(error.headers)
    );
  }
  
  // 5xx = provider error
  if (status >= 500) {
    return this.createBoundaryError(
      "provider",
      true,
      `Provider returned error ${status}. This may be temporary.`,
      {}
    );
  }
  
  // Other 4xx = validation
  if (status >= 400) {
    return this.createBoundaryError(
      "validation",
      false,
      `Request failed with status ${status}.`,
      {}
    );
  }
  
  // Unknown
  return this.createBoundaryError("provider", false, `Unexpected status ${status}.`, {});
}
```

**Key points**:
- This is the ONLY place provider error semantics are handled
- You MUST map all provider errors to canonical categories
- You MUST disambiguate ambiguous errors (e.g., 404 for "not found" vs "no access")
- You MUST NOT return raw provider errors
- You MUST set `retryable` accurately

### Step 5: Implement authStrategy

`authStrategy` handles authentication. It should throw `BoundaryError` with category `auth` on failure.

```typescript
async authStrategy(config: AuthConfig): Promise<AuthToken> {
  if (!config.token) {
    throw this.createBoundaryError(
      "auth",
      false,
      "Provider authentication requires a token.",
      {}
    );
  }
  
  // Provider-specific token validation/refresh logic
  // ...
  
  return { token: config.token };
}
```

### Step 6: Implement rateLimitPolicy

`rateLimitPolicy` extracts rate limit information from response headers.

```typescript
rateLimitPolicy(headers: Headers): RateLimitInfo {
  // Provider-specific header names
  const limit = parseInt(headers.get("X-RateLimit-Limit") ?? "5000", 10);
  const remaining = parseInt(headers.get("X-RateLimit-Remaining") ?? "5000", 10);
  const reset = this.parseResetTime(headers);
  
  return {
    limit,
    remaining,
    reset,
  };
}
```

### Step 7: Implement paginationStrategy

`paginationStrategy` returns a `PaginationStrategy` implementation.

```typescript
paginationStrategy(): PaginationStrategy {
  return new ProviderPaginationStrategy();
}
```

See the GitHub adapter's pagination implementation for a reference.

### Step 8: Implement getIdempotencyConfig

`getIdempotencyConfig` returns idempotency configuration for the provider.

```typescript
getIdempotencyConfig(): IdempotencyConfig {
  return {
    defaultSafeOperations: new Set(["GET", "HEAD", "OPTIONS"]),
    operationOverrides: new Map([
      // Provider-specific overrides
      ["POST /resource", IdempotencyLevel.CONDITIONAL],
      ["DELETE /resource/:id", IdempotencyLevel.IDEMPOTENT],
    ]),
  };
}
```

## When to Say "No"

Not all provider behavior can be normalized. Here's when to reject it:

### 1. Provider-Specific Features That Don't Map

**Example**: Provider has a "webhook verification" endpoint that requires provider-specific logic.

**Decision**: Do NOT add this to Boundary. Applications should call the provider's SDK directly for features that don't fit Boundary's model.

**Why**: Adding provider-specific features breaks normalization. Better to have a clear boundary (pun intended) than to leak provider semantics.

### 2. Ambiguous Behavior That Cannot Be Disambiguated

**Example**: Provider returns the same error code for multiple scenarios, and there's no way to tell them apart.

**Decision**: Map to the most common case, document the ambiguity, and fail loudly if the ambiguous case occurs.

**Why**: If we can't disambiguate, we must be explicit about the limitation. Silent failures are worse than loud failures.

### 3. Provider Changes That Break Normalization

**Example**: Provider changes their API in a way that breaks normalization (e.g., removes rate limit headers).

**Decision**: Update the adapter to handle the change, or if it's impossible, document the limitation and fail loudly.

**Why**: We cannot silently break. If normalization fails, we must fail loudly so applications know something is wrong.

## Testing Your Adapter

### Contract Tests

Write contract tests that validate Boundary invariants, not provider behavior:

```typescript
describe("Provider Adapter - Contract Tests", () => {
  it("should normalize responses to Boundary structure", () => {
    const raw: RawResponse = { /* ... */ };
    const normalized = adapter.parseResponse(raw);
    
    // Validate Boundary structure
    expect(normalized).toHaveProperty("data");
    expect(normalized).toHaveProperty("meta");
    expect(normalized.meta.provider).toBe("provider-name");
    // ...
  });
  
  it("should map all errors to canonical categories", () => {
    const errors = [
      { status: 401, expected: "auth" },
      { status: 404, expected: "validation" },
      // ...
    ];
    
    for (const { status, expected } of errors) {
      const error = adapter.parseError({ status, headers: new Headers(), body: {} });
      expect(error.category).toBe(expected);
    }
  });
  
  it("should NEVER leak provider-specific fields", () => {
    const error = adapter.parseError({ /* provider error */ });
    
    // Must be BoundaryError, not raw provider error
    expect(error).toBeInstanceOf(Error);
    expect((error as any).provider_specific_field).toBeUndefined();
  });
});
```

### Use Adapter Validator

Use the adapter validator to catch issues early:

```typescript
import { assertValidAdapter } from "../../core/adapter-validator.js";

constructor() {
  // Validate at construction time (development only)
  if (process.env.NODE_ENV !== "production") {
    assertValidAdapter(this, "provider-name");
  }
}
```

## Common Mistakes

### 1. Leaking Provider-Specific Fields

**Wrong**:
```typescript
parseError(raw: unknown): BoundaryError {
  const error = raw as { status: number; github_message: string };
  return {
    category: "auth",
    // ...
    github_message: error.github_message, // LEAK!
  };
}
```

**Right**:
```typescript
parseError(raw: unknown): BoundaryError {
  const error = raw as { status: number; github_message: string };
  return {
    category: "auth",
    // ...
    metadata: { githubMessage: error.github_message }, // OK - in metadata
  };
}
```

### 2. Adding Provider-Specific Methods

**Wrong**:
```typescript
class ProviderAdapter {
  // ...
  getProviderSpecificFeature(): ProviderSpecificType { // LEAK!
    // ...
  }
}
```

**Right**: Do not add provider-specific methods. If a feature cannot be normalized, do not add it.

### 3. Shortcutting with Provider SDKs

**Wrong**:
```typescript
parseResponse(raw: RawResponse): NormalizedResponse {
  const sdkResponse = providerSDK.normalize(raw); // LEAK!
  return sdkResponse;
}
```

**Right**: Implement normalization explicitly. Understand the provider's HTTP API directly.

### 4. Not Disambiguating Ambiguous Errors

**Wrong**:
```typescript
if (status === 404) {
  return this.createBoundaryError("validation", false, "Not found", {});
  // But 404 might also mean "no access"!
}
```

**Right**: Disambiguate explicitly:
```typescript
if (status === 404) {
  if (this.isAuthError(error)) {
    return this.createBoundaryError("auth", false, "No access", {});
  }
  return this.createBoundaryError("validation", false, "Not found", {});
}
```

## Reference Implementation

See `src/providers/github/adapter.ts` for a reference implementation that demonstrates:
- Explicit error disambiguation
- Complete normalization
- Zero provider quirk leakage
- All logic explicit (no shortcuts)

## Summary

Writing adapters is hard because:
1. You must understand ALL provider quirks
2. You must normalize them explicitly
3. You cannot use shortcuts
4. You must make hard decisions about what can be normalized

This difficulty is intentional. The alternative (provider-specific code throughout applications) is worse.

If you cannot normalize a provider's behavior cleanly, say "no". It's better to have a clear boundary than to leak provider semantics.
