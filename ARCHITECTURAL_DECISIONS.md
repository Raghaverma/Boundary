# Architectural Decisions

This document records explicit architectural decisions for the Boundary SDK. These decisions establish invariants that must be preserved across all future changes.

## Error Ownership and Lifecycle

### Error Construction

**Decision:** Errors are constructed in two layers:
1. **Adapter layer**: Adapters parse provider errors into `BoundaryError` instances via `parseError()`
2. **Core layer**: `sanitizeBoundaryError()` validates and sanitizes adapter output

**Invariants:**
- All errors that escape adapters are `BoundaryError` instances
- `BoundaryError` is a class (not interface) to enable `instanceof` checks
- Error category is always one of: `auth`, `rate_limit`, `network`, `provider`, `validation`
- `retryable` is always a boolean

**Where errors are constructed:**
- Adapters: `parseError(raw: unknown): BoundaryError`
- Core pipeline: `sanitizeBoundaryError()` creates fallback errors when adapter fails
- Circuit breaker: `CircuitOpenError extends BoundaryError`

### Error Metadata Responsibility

**Decision:** Error metadata is **tainted/untrusted** and must be sanitized at the error layer.

**Reasoning:**
- Metadata comes from adapters (untrusted source)
- Metadata may contain secrets (tokens, API keys, passwords)
- Errors propagate through the system and may be logged, serialized, or exposed
- Security boundary: errors must be safe even if observability is bypassed or fails

**Implementation:**
- `sanitizeErrorMetadata()` redacts sensitive keys at error construction time
- Sensitive keys: `password`, `secret`, `token`, `apiKey`, `api_key`, `authorization`, `cookie`, `session`, `credentials`, `privateKey`, `private_key`, `access_token`, `refresh_token`
- Observability layer performs additional sanitization for defense-in-depth

**Why not only at observability layer:**
- Errors may be serialized, logged, or exposed outside observability
- Observability may fail or be bypassed
- Error propagation is a security boundary; sanitization must happen at construction

### Error Propagation

**Decision:** Errors propagate through the pipeline and are thrown to callers.

**Invariants:**
- Errors are never swallowed silently
- All errors are `BoundaryError` instances (enforced by `sanitizeBoundaryError()`)
- Error metadata is sanitized before propagation
- Observability logging does not affect error propagation

## Observability Isolation

### Observability Must Never Affect Control Flow

**Decision:** Observability is strictly non-blocking and must never affect request execution.

**Reasoning:**
- Observability failures should not break requests
- Observability is a cross-cutting concern, not core logic
- Request execution and observability are independent

**Implementation:**
- All observability calls are wrapped in try-catch
- Observability failures are logged but do not throw
- `safelyBroadcastObservability()` ensures non-blocking execution

**Invariants:**
- Observability adapters cannot break request flow
- Observability exceptions are caught and logged, never propagated
- Request success/failure is independent of observability state

### Where Sanitization is Guaranteed

**Decision:** Sanitization happens at multiple layers for defense-in-depth:

1. **Error layer** (`error-sanitizer.ts`): Sanitizes error metadata at construction
2. **Request layer** (`request-sanitizer.ts`): Sanitizes request options before logging
3. **Observability layer** (`observability-sanitizer.ts`): Sanitizes all observability data

**Reasoning:**
- Defense-in-depth: multiple layers ensure secrets never leak
- Error layer sanitization protects even if observability fails
- Request/observability sanitization protects logs and metrics

**Sensitive fields redacted:**
- `authorization`, `cookie`, `token`, `apiKey`, `api_key`, `body`
- Error metadata: `password`, `secret`, `token`, `apiKey`, `api_key`, `authorization`, `cookie`, `session`, `credentials`, `privateKey`, `private_key`, `access_token`, `refresh_token`

## Config Normalization Rules

### Provider Extraction

**Decision:** Provider configs are extracted deterministically from `BoundaryConfig`.

**Rules:**
1. If `config.providers` exists and is an object, use it
2. Otherwise, extract top-level keys that are not known config keys
3. Known config keys: `defaults`, `schemaValidation`, `observability`, `observabilitySanitizer`, `idempotency`, `providers`, `stateStorage`, `localUnsafe`, `mode`

**Invariants:**
- Provider extraction is deterministic (same config → same providers)
- Unknown keys that are objects are treated as provider configs
- Provider names are normalized (no special handling for case)

**What happens on unknown keys:**
- Unknown top-level keys that are objects are treated as provider configs
- Unknown top-level keys that are not objects are ignored
- This allows both `{ providers: { github: {...} } }` and `{ github: {...} }` patterns

### Global Config Keys

**Decision:** The following keys are global (not provider configs):

- `defaults`: Default settings for all providers
- `schemaValidation`: Schema validation configuration
- `observability`: Observability adapters
- `observabilitySanitizer`: Sanitization options
- `idempotency`: Global idempotency settings
- `providers`: Explicit provider map
- `stateStorage`: External state storage
- `localUnsafe`: Flag to allow unsafe local state
- `mode`: Deployment mode (`local` | `distributed`)

**Invariants:**
- Global keys are never treated as provider names
- Provider extraction excludes global keys
- Global keys apply to all providers unless overridden

## Pagination Safety

### Termination Conditions

**Decision:** Pagination termination conditions are deterministic, bounded, and cheap to evaluate.

**Termination conditions:**
1. **Max page limit**: 1000 pages maximum (enforced BEFORE making requests - fail-fast)
2. **Cycle detection**: Cursor seen twice (enforced BEFORE making next request - fail-fast)
3. **Natural termination**: `hasNext === false` or no cursor

**Invariants:**
- Max page limit is checked BEFORE making requests (not after)
- Cycle detection happens BEFORE making next request (not after)
- All termination conditions are evaluated before network calls
- Pagination cannot run indefinitely

**Implementation:**
- `pageCount < maxPages` checked at loop start (fail-fast)
- Cycle detection checked before `buildNextRequest()` (fail-fast)
- Natural termination checked after each response

## State Management

### Fail-Closed State

**Decision:** State management is fail-closed: unsafe defaults are never used silently.

**Rules:**
1. `mode: "distributed"` **requires** `stateStorage` (startup fails without it)
2. Configurations without `stateStorage` require `localUnsafe: true` (startup fails without it)
3. In-memory state is opt-in only via `localUnsafe: true`

**Invariants:**
- Distributed mode cannot start without StateStorage
- Local mode requires explicit `localUnsafe: true` acknowledgment
- No silent fallback to unsafe defaults

## Initialization

### Mandatory Async Initialization

**Decision:** SDK requires async initialization via `Boundary.create()`.

**Invariants:**
- Constructor is private (cannot use `new Boundary()`)
- All methods throw if called before `Boundary.create()` completes
- `ensureStarted()` guard enforces initialization on all public methods

**Why async:**
- Adapter validation is async (checks `authStrategy()`)
- Startup failures must be deterministic and explicit
- Async initialization prevents use-before-ready bugs

## Runtime Contract

### Node.js Version Requirement

**Decision:** SDK requires Node.js ≥18.0.0 (enforced via `engines` field).

**APIs used:**
- `fetch`: HTTP requests
- `Headers`: Header manipulation
- `AbortController`: Request timeouts
- `crypto.randomUUID`: Request ID generation

**Invariants:**
- `package.json` includes `"engines": { "node": ">=18.0.0" }`
- No polyfills for standard APIs
- Runtime failures are impossible on supported platforms
