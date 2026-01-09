# Contract Lock - v2.0.0

**Date:** 2025-01-09  
**Status:** ✅ LOCKED

## Contract Established

v2.0.0 establishes the **safe-by-default contract** for Boundary SDK. This contract is **locked** and will not be weakened in future releases.

## Locked Guarantees

The following guarantees are **non-negotiable** and will be preserved in all future releases:

1. **Fail-Fast Initialization**
   - SDK cannot be used before initialization
   - Constructor is private; only `Boundary.create()` works
   - All methods throw if called before initialization completes

2. **Fail-Closed State Management**
   - Distributed mode **requires** StateStorage
   - In-memory state is opt-in only via `localUnsafe: true`
   - No silent fallback to unsafe defaults

3. **Guaranteed Secret Redaction**
   - All observability paths redact secrets
   - No exceptions, no bypasses
   - Sensitive fields: `authorization`, `cookie`, `token`, `apiKey`, `api_key`, `body`

4. **No Silent Degradation**
   - All failures are explicit
   - Invalid configurations fail at startup
   - Adapter validation failures stop initialization

5. **Enforced Runtime Contract**
   - Node.js ≥18.0.0 required (enforced via `engines`)
   - Standard APIs only: `fetch`, `Headers`, `AbortController`, `crypto.randomUUID`

## What Will NOT Change

The following will **never** be reintroduced:

- ❌ Optional initialization (`new Boundary()`)
- ❌ Silent fallback to in-memory state
- ❌ Convenience shortcuts that bypass safety
- ❌ Weakened defaults for "ease of use"
- ❌ Any mechanism that allows misuse

## Future Development

From v2.0.0 onward, development shifts from "make it safe" to "grow the ecosystem":

- ✅ New adapters
- ✅ Enhanced documentation
- ✅ More examples
- ✅ Integration guides
- ✅ Performance optimizations

**The core safety contract is complete and locked.**

## Deprecation Policy

**Previous versions (<2.0.0) are deprecated:**

```bash
npm deprecate boundary-sdk@"<2.0.0" "Deprecated: unsafe defaults. Upgrade to >=2.0.0 for production use."
```

## GitHub Release

**v2.0.0 Release Checklist:**

1. ✅ Create GitHub release: `v2.0.0`
2. ✅ Use `RELEASE_NOTES_v2.0.0.md` as release description
3. ✅ Pin release note or add banner to README (already done)
4. ✅ Tag commit: `git tag v2.0.0`
5. ✅ Push tag: `git push origin v2.0.0`

## Final Statement

**The SDK is shipped.**  
**The contract is locked.**  
**The release is legitimate.**

This release crosses a line most SDKs never cross:
- Enforced correctness over convenience
- Made misuse impossible
- Protected downstream systems by default

From here on, the focus is ecosystem growth, not core safety improvements.

---

**Contract Lock Date:** 2025-01-09  
**Contract Version:** 2.0.0  
**Status:** ✅ LOCKED
