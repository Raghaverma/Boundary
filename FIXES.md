# Boundary SDK - Critical Fixes

Fix the following issues identified in the production readiness review. Work through each systematically, verify the fix, and ensure no regressions.

## Issue 1: Version Constant Mismatch
**Problem:** SDK_VERSION constant is hardcoded as "1.0.0" but package.json shows version "2.0.0"

**Location:** Search for `SDK_VERSION` constant definition (likely in a constants file or main entry point)

**Fix:**
- Update SDK_VERSION to match package.json version: "2.0.0"
- Consider making this dynamically imported from package.json to prevent future drift:
```typescript
  import { version } from '../package.json';
  export const SDK_VERSION = version;
```
- If using dynamic import, ensure TypeScript config allows JSON imports (resolveJsonModule: true)

**Verify:** Grep for all SDK_VERSION usages and confirm version consistency across codebase

---

## Issue 2: Unused Zod Dependency
**Problem:** `zod` is listed in package.json dependencies but never imported anywhere in the codebase

**Fix:**
- Search entire codebase for `import.*zod` or `require.*zod`
- If truly unused, remove from package.json dependencies
- If it was intended for schema validation, document why it's present or implement planned usage

**Verify:** 
- `npm ls zod` to confirm dependency presence
- After removal: `npm install` and ensure no broken imports
- Run full test suite to catch any hidden dependencies

---

## Issue 3: Error Hierarchy Inconsistency
**Problem:** `CircuitOpenError` doesn't extend `BoundaryError`, breaking the error taxonomy

**Location:** Find CircuitOpenError class definition (likely in error-related files or circuit breaker implementation)

**Fix:**
- Make CircuitOpenError extend BoundaryError:
```typescript
  export class CircuitOpenError extends BoundaryError {
    constructor(message: string, metadata?: Record<string, unknown>) {
      super(message, 'CIRCUIT_OPEN', metadata);
      this.name = 'CircuitOpenError';
    }
  }
```
- Ensure it follows the same pattern as other BoundaryError subclasses
- Verify error category assignment matches the five canonical categories

**Verify:**
- Check instanceof BoundaryError works for CircuitOpenError
- Review all error subclasses for consistency
- Run error-handling tests

---

## Issue 4: Request UUID Regeneration
**Problem:** Request UUID is regenerated in normalize() function, losing original pipeline context

**Location:** Find normalize() function (likely in request processing pipeline)

**Current behavior (problematic):**
```typescript
// Regenerates UUID, losing context
request.id = generateUUID();
```

**Fix:**
- Preserve original request UUID if present:
```typescript
  request.id = request.id || generateUUID();
```
- OR pass through without modification if UUID already exists:
```typescript
  if (!request.id) {
    request.id = generateUUID();
  }
```
- Ensure upstream pipeline context (tracing, logging) isn't broken

**Verify:**
- Trace a request through the full pipeline
- Confirm UUID consistency in logs/traces
- Test that error correlation works across pipeline stages

---

## Issue 5: String-Based Provider Lookup Type Safety
**Problem:** Provider access like `boundary.github` has no type safety (string-based lookup)

**Location:** Find provider registration and access patterns

**Fix:**
Implement type-safe provider access:
```typescript
// Option A: Generic provider access with type parameter
boundary.getProvider<GitHubAdapter>('github')

// Option B: Typed provider registry
interface ProviderRegistry {
  github: GitHubAdapter;
  slack: SlackAdapter;
  // ... other providers
}

class Boundary {
  private providers: Partial<ProviderRegistry> = {};
  
  provider<K extends keyof ProviderRegistry>(name: K): ProviderRegistry[K] | undefined {
    return this.providers[name];
  }
}

// Usage: boundary.provider('github') // Returns GitHubAdapter | undefined
```

**Verify:**
- TypeScript should error on `boundary.provider('invalid')`
- Autocomplete should suggest valid provider names
- No runtime behavior changes, only type safety improvements

---

## Verification Steps

After all fixes:
1. Run full test suite: `npm test`
2. Run type checker: `npx tsc --noEmit`
3. Run linter: `npm run lint`
4. Build: `npm run build`
5. Check for any new TypeScript errors
6. Verify no breaking changes to public API
7. Update CHANGELOG.md with fixes

## Summary Required

After completing fixes, provide:
- List of files modified
- Brief description of each change
- Any breaking changes (should be none)
- Test results
- Any additional issues discovered during fixes