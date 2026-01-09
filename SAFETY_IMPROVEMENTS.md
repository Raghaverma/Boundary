# Safety Improvements Summary

This document summarizes all safety improvements made to eliminate release-blocking footguns and make the SDK safe by default.

## Hard Blockers (Resolved)

### 1. ✅ Enforce Initialization (Hard Blocker)

**Problem**: SDK could be used before initialization, leading to undefined behavior.

**Solution**:
- Made `Boundary` constructor `private` - only `Boundary.create()` can instantiate
- Added `ensureStarted()` runtime guard that throws synchronously if `start()` hasn't completed
- All public methods (`getCircuitStatus`, provider client methods) call `ensureStarted()` before execution

**Changes**:
- `src/index.ts`: Constructor is private, added `ensureStarted()` method, all public methods guard against uninitialized use
- `src/safety.test.ts`: Tests prove misuse fails fast

**Breaking Changes**: 
- `new Boundary(config)` no longer works - must use `await Boundary.create(config)`

### 2. ✅ Fail-Closed State Management (Hard Blocker)

**Problem**: In-memory state could be silently used in production, causing state loss on restarts.

**Solution**:
- Distributed mode **requires** `stateStorage` - startup fails without it
- Local mode requires explicit `localUnsafe: true` to acknowledge the limitation
- Clear separation between safe local dev and safe distributed production

**Changes**:
- `src/index.ts`: Enhanced `start()` method with fail-closed logic:
  - `mode: "distributed"` → **must** have `stateStorage` or startup throws
  - No `stateStorage` and no `localUnsafe` → startup throws
  - `localUnsafe: true` → allows in-memory state with warning

**Breaking Changes**:
- Configurations without `stateStorage` now require `localUnsafe: true` (unless in local mode)
- Distributed mode without `stateStorage` will fail at startup

### 3. ✅ Centralized Secret Redaction (Hard Blocker)

**Problem**: Secrets could leak through observability (logs, errors, metrics).

**Solution**:
- All observability paths pass through centralized sanitizers:
  - Request logs: `sanitizeRequestOptions()` redacts headers, query params, body
  - Error logs: `sanitizeObject()` redacts error metadata
  - Metrics: `sanitizeMetric()` redacts metric tags
- Enhanced header sanitization to handle variations (e.g., "X-API-Key" matches "apikey")
- Sensitive keys redacted: `authorization`, `cookie`, `token`, `apiKey`, `api_key`, `body`

**Changes**:
- `src/core/request-sanitizer.ts`: Enhanced to normalize hyphens/underscores in header/query keys
- `src/core/observability-sanitizer.ts`: Already existed, verified all paths use it
- `src/core/pipeline.ts`: All observability calls use sanitized data
- `src/index.ts`: Warning metadata is sanitized

**Breaking Changes**: None (internal implementation)

### 4. ✅ Runtime Contract Enforcement (Hard Blocker)

**Problem**: Runtime assumptions (Node version, APIs) were implicit.

**Solution**:
- Added `engines` field to `package.json` requiring Node ≥18
- Runtime uses standard Node APIs: `fetch`, `Headers`, `AbortController`, `crypto.randomUUID`

**Changes**:
- `package.json`: Added `"engines": { "node": ">=18.0.0" }`

**Breaking Changes**: 
- SDK now explicitly requires Node 18+ (was implicit before)

## Secondary Safety Tasks (Resolved)

### 5. ✅ Adapter Validation Safety

**Problem**: Adapter validation could trigger side effects (e.g., real API calls during `authStrategy`).

**Solution**:
- Validation uses clearly fake test token: `BOUNDARY_TEST_TOKEN_DO_NOT_VALIDATE`
- Documented that adapters must recognize test tokens and not make real API calls
- Validation is fully async and does not cause side effects

**Changes**:
- `src/core/adapter-validator.ts`: Updated to use fake test token, added documentation

**Breaking Changes**: None (adapter contract clarification)

### 6. ✅ Adapter Cache Scoping

**Problem**: Global adapter cache could cause config sharing across Boundary instances.

**Solution**:
- Moved adapter cache from module-level to instance-level (`this.adapterCache`)
- Each Boundary instance has its own adapter cache

**Changes**:
- `src/index.ts`: Replaced global `lazyAdapterCache` with instance-scoped `this.adapterCache`

**Breaking Changes**: None (internal implementation)

### 7. ✅ Pagination Safety

**Problem**: Malformed adapters could cause infinite pagination loops.

**Solution**:
- Added cycle detection: tracks seen cursors, throws if cursor repeats
- Added max page limit: 1000 pages maximum, throws if exceeded
- Clear error messages indicating the problem

**Changes**:
- `src/index.ts`: Enhanced `paginate()` with cycle detection and max page limit

**Breaking Changes**: None (safety enhancement)

### 8. ✅ Typed Public API

**Problem**: Public API used `any` types, allowing misuse at compile time.

**Solution**:
- Replaced all `any` types in `ProviderClient` interface with `RequestOptions`
- Exported stable `RequestOptions` type for compile-time safety

**Changes**:
- `src/index.ts`: `ProviderClient` interface now uses `RequestOptions` instead of `any`

**Breaking Changes**: 
- TypeScript users will get compile-time errors if passing invalid options (this is a feature, not a bug)

## Testing

Comprehensive test suite added in `src/safety.test.ts` that proves:

1. ✅ SDK cannot be used before initialization
2. ✅ Distributed mode fails without StateStorage
3. ✅ Secrets never appear in logs, errors, or metrics
4. ✅ Adapter validation async failures stop startup
5. ✅ Pagination cannot infinite-loop

All tests pass.

## Summary of Breaking API Changes

1. **Constructor**: `new Boundary(config)` → `await Boundary.create(config)`
2. **State Storage**: Configurations without `stateStorage` require `localUnsafe: true` (unless in local mode)
3. **Node Version**: Explicitly requires Node ≥18 (was implicit)
4. **Type Safety**: `ProviderClient` methods now strictly typed (compile-time errors for invalid options)

## Confirmation

✅ All hard blockers are resolved  
✅ SDK is safe to publish  
✅ All tests pass  
✅ No silent failures  
✅ Fail-fast behavior enforced  
✅ Secrets cannot leak  
✅ State management is fail-closed  
✅ Runtime contracts are explicit
