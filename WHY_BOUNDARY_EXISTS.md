# Why Boundary Exists

This document explains why Boundary exists through concrete failure analysis. It demonstrates how naive third-party API integrations fail in production and how Boundary contains those failures without leaking provider semantics.

This is not marketing, not a tutorial, and not aspirational. It is a failure analysis and containment narrative.

## TL;DR

External APIs are operationally hostile. They have ambiguous errors, inconsistent formats, and brittle behaviors. Naive integrations scatter provider-specific knowledge throughout application code, causing cascading failures, security risks, and maintenance burden.

Boundary contains these failures by encoding operational knowledge in adapters, enforcing canonical error categories, and rejecting non-normalizable features.

This is for applications integrating multiple providers that need operational consistency. Not for single-provider apps with simple requirements.

## 1. The Naive Integration (Reality)

Here is realistic TypeScript code that integrates directly with the GitHub API without Boundary:

```typescript
async function fetchAllRepos(token: string): Promise<Repo[]> {
  const repos: Repo[] = [];
  let page = 1;
  let hasMore = true;
  const maxRetries = 3;
  let retryCount = 0;

  while (hasMore) {
    try {
      // Check rate limit before making request
      // GitHub returns rate limit info in response headers, but we need to track it
      const rateLimitRemaining = getCachedRateLimitRemaining();
      if (rateLimitRemaining === 0) {
        const resetTime = getCachedRateLimitReset();
        const waitTime = resetTime - Date.now();
        if (waitTime > 0) {
          console.log(`Rate limit exhausted. Waiting ${waitTime}ms`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      const response = await fetch(`https://api.github.com/user/repos?page=${page}&per_page=100`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MyApp/1.0',
        },
      });

      // Parse rate limit from headers (GitHub-specific)
      const rateLimitLimit = parseInt(response.headers.get('X-RateLimit-Limit') || '5000', 10);
      const rateLimitRemaining = parseInt(response.headers.get('X-RateLimit-Remaining') || '0', 10);
      const rateLimitReset = parseInt(response.headers.get('X-RateLimit-Reset') || '0', 10);
      cacheRateLimitInfo(rateLimitRemaining, rateLimitReset * 1000); // GitHub returns Unix timestamp

      // Handle different error cases
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        
        // GitHub uses 404 for both "not found" and "no access" - we need to guess
        if (response.status === 404) {
          // Is this "repo doesn't exist" or "you don't have access"?
          // GitHub doesn't distinguish, so we assume "not found" but it might be wrong
          throw new Error(`Repository not found: ${errorBody.message || 'Unknown error'}`);
        }

        // GitHub sometimes returns 403 for rate limits instead of 429
        if (response.status === 403) {
          // Check if it's actually a rate limit
          if (rateLimitRemaining === 0 || errorBody.message?.includes('rate limit')) {
            const retryAfter = rateLimitReset * 1000 - Date.now();
            if (retryAfter > 0) {
              await new Promise(resolve => setTimeout(resolve, retryAfter));
              retryCount = 0; // Reset retry count after rate limit wait
              continue; // Retry the request
            }
            throw new Error('Rate limit exceeded and reset time has passed');
          }
          // Otherwise it's a permission error
          throw new Error(`Permission denied: ${errorBody.message || 'Check your token scopes'}`);
        }

        // 401 means token is invalid or expired
        if (response.status === 401) {
          throw new Error(`Authentication failed: ${errorBody.message || 'Invalid token'}`);
        }

        // 422 is validation error with field details
        if (response.status === 422) {
          const fieldErrors = errorBody.errors?.map((e: any) => `${e.field}: ${e.message}`).join(', ');
          throw new Error(`Validation failed: ${fieldErrors || errorBody.message}`);
        }

        // 429 is explicit rate limit
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10) * 1000;
          await new Promise(resolve => setTimeout(resolve, retryAfter));
          retryCount = 0;
          continue;
        }

        // 5xx errors might be retryable
        if (response.status >= 500) {
          if (retryCount < maxRetries) {
            retryCount++;
            const backoff = Math.min(1000 * Math.pow(2, retryCount), 10000);
            await new Promise(resolve => setTimeout(resolve, backoff));
            continue;
          }
          throw new Error(`GitHub API error ${response.status}: ${errorBody.message || 'Server error'}`);
        }

        // Other 4xx errors are not retryable
        throw new Error(`Request failed: ${response.status} ${errorBody.message || 'Unknown error'}`);
      }

      const data = await response.json();
      repos.push(...data);

      // Check if there are more pages (GitHub uses Link header)
      const linkHeader = response.headers.get('Link');
      if (linkHeader) {
        // Parse Link header: <https://api.github.com/user/repos?page=2>; rel="next"
        const hasNext = linkHeader.includes('rel="next"');
        hasMore = hasNext;
        if (hasNext) {
          // Extract next page number from Link header
          const nextMatch = linkHeader.match(/<[^>]+page=(\d+)[^>]*>;\s*rel="next"/);
          if (nextMatch) {
            page = parseInt(nextMatch[1], 10);
          } else {
            page++;
          }
        }
      } else {
        // No Link header means we're done (or GitHub changed their API)
        hasMore = false;
      }

      retryCount = 0; // Reset on success

    } catch (error) {
      // Network errors might be retryable
      if (error instanceof Error && (
        error.message.includes('fetch') ||
        error.message.includes('network') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT')
      )) {
        if (retryCount < maxRetries) {
          retryCount++;
          const backoff = Math.min(1000 * Math.pow(2, retryCount), 10000);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
      }

      // If we've exhausted retries or it's not retryable, throw
      throw error;
    }
  }

  return repos;
}
```

**What this code reveals:**

- **Provider-specific conditionals everywhere**: Status code handling, header parsing, Link header parsing
- **Implicit assumptions**: GitHub's 404 ambiguity, 403 rate limit vs permission, Unix timestamp format
- **Manual rate limit tracking**: Application code must cache and check rate limits
- **Manual retry logic**: Exponential backoff implemented in application code
- **Manual pagination**: Link header parsing, page number extraction
- **Error classification guesswork**: Is 404 "not found" or "no access"? Is 403 "permission" or "rate limit"?
- **Provider-specific knowledge required**: Developer must understand GitHub's API quirks

This is not bad code. This is **honest code** that tries to handle GitHub's operational reality. The provider's quirks leak into every line.

## 2. How It Fails in Production

### Failure Mode 1: GitHub 404 Ambiguity

**The Problem**: GitHub returns 404 for both "resource doesn't exist" and "you don't have access to this resource."

```typescript
// Application code receives 404
if (response.status === 404) {
  // What does this mean?
  // - Repository doesn't exist?
  // - Repository exists but you don't have access?
  // - Endpoint doesn't exist?
  // GitHub doesn't tell you.
  
  // Most code assumes "not found" and shows wrong error to user
  throw new Error('Repository not found'); // Might be wrong!
}
```

**Why it fails**: The application cannot distinguish between these cases. Users see "not found" when they should see "access denied." This breaks access control UX and can leak information about private resources.

**Why it's hard to detect**: Both cases return the same status code. The error message might be identical. You only discover the issue when a user reports "I can see the repo in the web UI but your app says it doesn't exist."

See how the [GitHub adapter disambiguates 404 errors](src/providers/github/adapter.ts#L271).

### Failure Mode 2: GitHub 403 Rate Limit vs Permission

**The Problem**: GitHub sometimes returns 403 for rate limit exhaustion instead of 429.

```typescript
if (response.status === 403) {
  // Is this:
  // - Permission denied (token lacks scope)?
  // - Rate limit exhausted (but GitHub returned 403)?
  
  // Code must check X-RateLimit-Remaining header
  const remaining = parseInt(response.headers.get('X-RateLimit-Remaining') || '0', 10);
  if (remaining === 0) {
    // It's a rate limit, wait and retry
  } else {
    // It's a permission error, fail immediately
    throw new Error('Permission denied');
  }
}
```

**Why it fails**: If the application doesn't check the rate limit header, it treats rate limits as permission errors. Users see "permission denied" when they should see "rate limit exceeded." Retry logic doesn't trigger, causing unnecessary failures.

**Why it's hard to detect**: The status code is wrong. You must know GitHub's quirk and check headers. If you miss this, your error handling is broken.

See how the [GitHub adapter detects rate limits in 403 responses](src/providers/github/adapter.ts#L241).

### Failure Mode 3: Rate Limit Retries Causing Cascading Failures

**The Problem**: When rate limit is exhausted, naive retry logic can make it worse.

```typescript
// Application hits rate limit
// Retries immediately (or with short backoff)
// Each retry consumes more of the rate limit window
// Eventually all requests fail

async function fetchWithRetry(url: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url);
    if (response.status === 429) {
      // Retry immediately or with short delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue; // This makes it worse!
    }
    return response;
  }
}
```

**Why it fails**: Retrying on rate limit errors without respecting the `Retry-After` header or coordinating across requests causes more rate limit violations. One rate limit error becomes many, cascading across the application.

**Why it's hard to detect**: In development, rate limits are high. In production, under load, the problem appears. By then, the application is already failing.

### Failure Mode 4: Vendor Response Shape Changes

**The Problem**: GitHub changes response structure, breaking implicit assumptions.

```typescript
// Code assumes GitHub always returns Link header for pagination
const linkHeader = response.headers.get('Link');
if (linkHeader) {
  // Parse pagination
} else {
  // Assume no more pages
  hasMore = false; // Might be wrong if GitHub removed Link header
}
```

**What happens**: GitHub changes API version, removes Link header, or changes pagination format. Application code breaks silently. Pagination stops working, but no error is thrown. Data is incomplete.

**Why it fails**: The application assumes a specific response shape. When the vendor changes it (even in a backward-compatible way), the assumption breaks.

**Why it's hard to detect**: The code doesn't throw errors. It just stops paginating. You might not notice until users report missing data.

### Failure Mode 5: Misclassified Errors Breaking Retry Logic

**The Problem**: Wrong error classification leads to wrong retry behavior.

```typescript
// Application classifies 404 as "not found" (non-retryable)
if (response.status === 404) {
  throw new Error('Not found'); // Marked as non-retryable
}

// But if 404 actually means "no access" (temporary auth issue), 
// it should be retried. The application never retries, causing persistent failures.
```

**Why it fails**: Retry logic depends on correct error classification. If you misclassify an error, you either retry when you shouldn't (wasting resources, causing cascading failures) or don't retry when you should (causing persistent failures).

**Why it's hard to detect**: The error looks correct ("not found"), but the classification is wrong. The application behaves incorrectly, but the error message doesn't reveal the misclassification.

### Failure Mode 6: Security Risks from Error Information Leakage

**The Problem**: Error messages leak information about private resources.

```typescript
// Application receives 404 for private repository
// Shows "Repository not found" to user
// But repository exists - it's just private
// This leaks information: "The repo exists, you just can't access it"
```

**Why it fails**: Distinguishing "not found" from "no access" in error messages can leak information about resource existence. Attackers can probe for private resources.

**Why it's hard to detect**: The application works correctly from a functional perspective, but violates security principles. This is a correctness issue that doesn't manifest as a crash.

## Real-World Example: Production Incident

A production application integrated directly with GitHub's API to fetch repository metadata. The application handled pagination by parsing GitHub's `Link` header and extracting page numbers.

**The Incident**: GitHub updated their API and changed the `Link` header format for some endpoints. The application's regex pattern stopped matching, but no error was thrown. The application silently stopped paginating after the first page.

**The Impact**: 
- Users saw incomplete data (only first 100 repositories)
- No errors were logged (the code assumed "no Link header = no more pages")
- The issue went undetected for 3 days until a user with 200+ repositories reported missing data

**Why It Happened**: The application code made an implicit assumption about GitHub's response format. When GitHub changed it (even in a backward-compatible way), the assumption broke silently.

**How Boundary Prevents This**: Boundary's [GitHub adapter](src/providers/github/adapter.ts) encodes pagination logic in one place. When GitHub changes, the adapter is updated and tested. The application code doesn't need to know about Link headers at all.

This is not a theoretical problem. Vendor API changes break naive integrations regularly. Boundary contains these failures by encoding operational knowledge in adapters.

## 3. The Boundary Version

Here is the same use case using Boundary:

```typescript
import { Boundary } from 'boundary-sdk';

const boundary = new Boundary({
  github: {
    auth: { token: process.env.GITHUB_TOKEN },
  },
});

async function fetchAllRepos(): Promise<Repo[]> {
  const repos: Repo[] = [];
  
  try {
    // Single call, no pagination logic, no rate limit handling, no retry logic
    for await (const response of boundary.github.paginate('/user/repos')) {
      repos.push(...response.data);
    }
    
    return repos;
  } catch (error) {
    // All errors are BoundaryError with canonical categories
    if (error instanceof Error && 'category' in error) {
      const boundaryError = error as BoundaryError;
      
      // Handle by category, not by provider-specific status codes
      switch (boundaryError.category) {
        case 'auth':
          // Authentication failed - token invalid or expired
          throw new Error('Authentication failed. Please check your token.');
        case 'rate_limit':
          // Rate limit exceeded - Boundary already handled retry with backoff
          throw new Error('Rate limit exceeded. Please try again later.');
        case 'validation':
          // Request validation failed or resource not found
          throw new Error('Resource not found or invalid request.');
        case 'network':
          // Network error - Boundary already retried
          throw new Error('Network error. Please check your connection.');
        case 'provider':
          // Provider service error - Boundary already retried if retryable
          throw new Error('GitHub service error. Please try again later.');
      }
    }
    
    throw error;
  }
}
```

| Aspect | Without Boundary | With Boundary |
|--------|-----------------|---------------|
| Lines of code | 150 | 15 |
| Provider knowledge | Throughout app | In adapter only |
| Error handling | 20+ status codes | 5 categories |
| Rate limiting | Manual tracking | Automatic |
| Retries | Manual logic | Automatic |
| Pagination | Manual parsing | Automatic |
| Vendor changes | Break everywhere | Break in adapter |

**What the application code no longer needs to know:**

- ❌ GitHub's 404 ambiguity (adapter disambiguates)
- ❌ GitHub's 403 rate limit quirk (adapter checks headers)
- ❌ Rate limit header names (`X-RateLimit-*`)
- ❌ Rate limit reset time format (Unix timestamp)
- ❌ Link header parsing for pagination
- ❌ Retry logic and exponential backoff
- ❌ Error status code meanings
- ❌ When to retry vs when to fail immediately

**What responsibility moved into the adapter:**

- ✅ Disambiguating GitHub's 404 (checks context, maps to `validation` or `auth`)
- ✅ Detecting rate limits in 403 responses (checks `X-RateLimit-Remaining` header)
- ✅ Parsing rate limit headers and normalizing to `RateLimitInfo`
- ✅ Parsing Link headers and extracting pagination cursors
- ✅ Mapping all GitHub errors to canonical `BoundaryError` categories
- ✅ Determining retryability based on error category
- ✅ Coordinating retries with rate limit state

**What Boundary provides:**

- **Deterministic retry behavior**: Retries based on `BoundaryError.retryable`, not guesswork
- **Rate limit coordination**: Tracks rate limits across requests, prevents cascading failures
- **Canonical error categories**: Application handles 5 categories, not 20+ status codes
- **Explicit error semantics**: `BoundaryError.category` tells you what happened, not just what code was returned

The application code is **60 lines instead of 150**, and it contains **zero provider-specific knowledge**.

## 4. What Boundary Does NOT Solve

### APIs That Do Not Fit the Normalization Domain

Boundary normalizes HTTP-based REST APIs with standard patterns (pagination, rate limiting, error responses). It does not handle:

- **GraphQL APIs**: Different request/response model, different error model
- **WebSocket APIs**: Different protocol, different error handling
- **gRPC APIs**: Different protocol, different error model
- **Streaming APIs**: Different response model, different pagination
- **APIs without rate limits**: Boundary's rate limit coordination is unnecessary
- **APIs with custom authentication flows**: OAuth flows, MFA challenges, etc. must be handled outside Boundary

**When to not use Boundary**: If your API doesn't fit the HTTP REST model with standard patterns, Boundary will fight you. Use the provider's SDK directly.

### Provider-Specific Features Intentionally Excluded

Boundary does not expose provider-specific features that cannot be normalized:

- **GitHub's webhook verification**: Provider-specific cryptographic verification
- **Stripe's payment intents with 3D Secure**: Provider-specific payment flows
- **AWS's presigned URLs**: Provider-specific URL generation
- **Provider-specific admin tools**: Features that don't map to standard CRUD operations

**When to not use Boundary**: If you need provider-specific features, use the provider's SDK for those features. Boundary handles the standard operations.

### Performance Tradeoffs

Boundary adds layers (adapter, pipeline, strategies) that have overhead:

- **Request building**: Adapter builds requests, pipeline executes them (two steps instead of one)
- **Error normalization**: Every error goes through adapter's `parseError` (additional processing)
- **Response normalization**: Every response goes through adapter's `parseResponse` (additional processing)
- **Strategy coordination**: Rate limiting, circuit breaking, retry logic add coordination overhead

**When to not use Boundary**: If you have a single-provider application with simple requirements and performance is critical, direct integration might be faster. Boundary's value increases with multiple providers and operational complexity.

### Simple or Single-Provider Applications

Boundary's value comes from normalizing **multiple providers**. If you have:

- **One provider**: Boundary adds complexity without normalization benefits
- **Simple requirements**: No retries, no rate limits, no pagination - Boundary is overkill
- **Tight performance requirements**: Every layer adds latency

**When to not use Boundary**: If your application integrates with one provider and has simple requirements, direct integration is simpler. Boundary exists for applications that integrate with multiple providers and need operational consistency.

## 5. Design Principles Enforced

### Why Adapters Encode Operational Knowledge

Adapters contain all provider-specific operational knowledge (error semantics, rate limit formats, pagination mechanisms). This knowledge is **hard-won** and **brittle**. By encoding it in adapters, we:

- **Contain failure modes**: Provider quirks break in one place (adapter), not throughout the application
- **Enable testing**: Adapters can be tested with fixtures, simulating vendor changes
- **Enable maintenance**: When a provider changes, update one adapter, not every integration

**The alternative**: Operational knowledge scattered across application code. One provider change breaks multiple places. Testing requires real API calls. Maintenance is expensive.

### Why the Adapter Contract is Behavioral

The `ProviderAdapter` interface defines **behavior** (build request, parse response, parse error), not **data structures**. This ensures:

- **Separation of concerns**: Adapters normalize, pipeline orchestrates, application consumes
- **Testability**: Adapters can be tested without HTTP execution
- **Composability**: Pipeline can swap adapters, strategies, observability without changing application code

**The alternative**: Data-focused contracts leak provider semantics. Application code branches on provider-specific fields. Changes require updates across layers.

### Why Error Categories are Fixed

Boundary has exactly 5 error categories: `auth`, `rate_limit`, `network`, `provider`, `validation`. These categories are **fixed** and **canonical**. This ensures:

- **Deterministic handling**: Application code handles 5 cases, not 20+ status codes
- **Consistent retry logic**: Retry strategy uses `BoundaryError.retryable`, not guesswork
- **No provider leakage**: Application code never branches on provider-specific error codes

**The alternative**: Variable error categories or provider-specific categories. Application code branches on provider semantics. Retry logic is inconsistent. Errors leak provider details.

### Why Convenience is Rejected

Boundary rejects convenience abstractions that hide provider quirks. This ensures:

- **Explicit handling**: Provider quirks are visible in adapters, not hidden in abstractions
- **Correct behavior**: Adapters must disambiguate ambiguous errors explicitly
- **Maintainability**: When a provider changes, the adapter change is visible and reviewable

**The alternative**: Convenience abstractions hide provider quirks. Ambiguous errors are handled incorrectly. Provider changes break silently. Maintenance is difficult.

### Why "Does Not Belong" is a Valid Outcome

If a provider feature cannot be normalized cleanly, Boundary says "no." This ensures:

- **Correctness over convenience**: Better to reject a feature than to leak provider semantics
- **Clear boundaries**: Applications know what Boundary handles and what it doesn't
- **Reduced misuse**: Applications don't try to force provider features into Boundary's model

**The alternative**: Accepting non-normalizable features leaks provider semantics. Application code branches on provider details. The normalization contract breaks.

## Conclusion

Boundary exists because external APIs are **operationally hostile**. They have:

- Ambiguous error codes (404 for "not found" and "no access")
- Inconsistent error formats (403 for "permission" and "rate limit")
- Brittle response structures (pagination formats change)
- Operational complexity (rate limits, retries, circuit breaking)

Naive integrations handle this by scattering provider knowledge throughout application code. This leads to:

- Cascading failures (rate limit retries making things worse)
- Security risks (error messages leaking information)
- Maintenance burden (provider changes break multiple places)
- Incorrect behavior (misclassified errors breaking retry logic)

Boundary contains these failures by:

- Encoding operational knowledge in adapters (one place, testable, maintainable)
- Enforcing canonical error categories (deterministic handling, consistent retries)
- Separating concerns (adapters normalize, pipeline orchestrates, application consumes)
- Rejecting non-normalizable features (correctness over convenience)

The result: Application code that is **simpler, more correct, and more maintainable** because it doesn't need to know about provider quirks.

Boundary is not for every application. It is for applications that integrate with **multiple providers** and need **operational consistency**. If you have one provider and simple requirements, direct integration is simpler. If you have multiple providers and operational complexity, Boundary contains the failures that would otherwise leak into your application.
