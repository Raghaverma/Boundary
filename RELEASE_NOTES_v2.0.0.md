# Release Notes - v2.0.0

**Release Date:** 2025-01-09

## ⚠️ BREAKING CHANGES - Migration Required

**v2.0.0 establishes the safe-by-default contract for Boundary SDK.** This release contains breaking changes that enforce safety by default. Previous versions (<2.0.0) are **deprecated** and contain unsafe defaults.

## What Changed

### Safety Contract Established

This release enforces:

- ✅ **Fail-fast initialization** - SDK cannot be used before initialization
- ✅ **Fail-closed state management** - Distributed mode requires StateStorage
- ✅ **Guaranteed secret redaction** - No secrets leak through observability
- ✅ **No silent degradation** - All failures are explicit

### Breaking Changes

1. **Constructor removed**: `new Boundary(config)` → `await Boundary.create(config)`
2. **StateStorage enforcement**: Distributed mode requires StateStorage; local dev requires `localUnsafe: true`
3. **Node.js ≥18.0.0**: Now explicitly required (enforced via `engines` field)
4. **Typed request options**: Strict TypeScript types replace `any`

## Migration Guide

See [CHANGELOG.md](./CHANGELOG.md#migration-from-1x) for complete migration instructions.

**Quick migration:**

```typescript
// ❌ OLD (1.x - DEPRECATED)
const boundary = new Boundary({ ... });

// ✅ NEW (2.0.0)
const boundary = await Boundary.create({
  ...config,
  localUnsafe: true, // Required for local dev
});
```

## Why This Release Matters

v2.0.0 crosses a line most SDKs never cross:

- **Enforced correctness over convenience** - Misuse is impossible
- **Protected downstream systems by default** - Fail-closed, not fail-open
- **Locked contract** - This establishes the long-term API contract

## Support

- **Documentation**: See [README.md](./README.md) for usage
- **Migration Help**: See [CHANGELOG.md](./CHANGELOG.md) for detailed migration guide
- **Issues**: Report issues on GitHub

---

**Previous versions (<2.0.0) are deprecated. Upgrade to >=2.0.0 for production use.**
