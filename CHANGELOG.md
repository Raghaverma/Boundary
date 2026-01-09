# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-09

**This release establishes the long-term safety contract of the SDK.** All breaking changes are intentional and enforce safety by default.

### Breaking Changes

- **Constructor removed**: `new Boundary(config)` no longer works. Use `await Boundary.create(config)` instead. This enforces async initialization and prevents use before initialization.

- **Mandatory initialization**: All SDK methods throw if called before `Boundary.create()` completes. This prevents undefined behavior from uninitialized state.

- **StateStorage enforcement**: 
  - `mode: "distributed"` **requires** a `StateStorage` implementation. Startup fails without it.
  - Configurations without `stateStorage` require explicit `localUnsafe: true` to acknowledge the limitation.
  - This prevents accidental use of in-memory state in production deployments.

- **Node.js version requirement**: SDK now explicitly requires Node.js ≥18.0.0 (was implicit before). This is enforced via `engines` field in `package.json`.

- **Typed request options**: `ProviderClient` methods now use strict `RequestOptions` types instead of `any`. Invalid options are caught at compile time.

### Added

- **Safety guarantees**:
  - Fail-fast initialization enforcement
  - Fail-closed state management
  - Guaranteed secret redaction in all observability paths
  - No silent degradation - all failures are explicit

- **Pagination safety**: Cycle detection and max page limit (1000 pages) prevent infinite loops from malformed adapters.

- **Adapter validation safety**: Validation uses fake test tokens to prevent side effects during adapter checks.

- **Instance-scoped adapter cache**: Prevents config sharing across Boundary instances.

### Changed

- All examples and documentation updated to use `Boundary.create()` pattern.
- Enhanced header sanitization to handle variations (e.g., "X-API-Key" matches "apikey").
- Improved error messages for state management failures.

### Fixed

- Secrets no longer leak through observability (logs, errors, metrics).
- Adapter cache properly scoped per instance.
- Pagination cannot infinite-loop.

## [Unreleased]

### Added
- Auto-registration of built-in provider adapters
- Configuration validation for rate limit, retry, circuit breaker, and timeout settings
- Fallback error handling when adapter `parseError()` throws unexpectedly

### Fixed
- Removed circular self-dependency in package.json that caused installation failures
- Fetch timeout now properly cancels requests using `AbortController` (prevents resource leaks)
- GitHub 403 errors now correctly distinguished between rate limit and permission denied
- Adapter validation now runs in production (logs warning instead of throwing)

### Changed
- Improved type safety: `authToken` parameter now uses `AuthToken` type instead of `any`

## [1.0.2] - 2024-01-XX

### Fixed
- Constructor now supports both nested and flat provider config structures
- GitHub adapter auto-registers when provider is configured

## [1.0.1] - 2024-01-XX

### Fixed
- TypeScript strict mode compatibility issues
- Optional property handling in exactOptionalPropertyTypes mode

## [1.0.0] - 2024-01-XX

### Added
- Core request pipeline with unified response normalization
- Circuit breaker implementation with state machine
- Rate limiting with token bucket and adaptive backoff
- Retry strategy with exponential backoff and idempotency awareness
- Idempotency resolver with SAFE/IDEMPOTENT/CONDITIONAL/UNSAFE levels
- Schema validation with pluggable storage and drift detection
- Observability adapter pattern with console and no-op implementations
- GitHub provider adapter with OAuth support
- Pagination normalization for cursor and offset-based strategies
- Error normalization with unified error contract
- TypeScript strict mode with full type safety

[Unreleased]: https://github.com/Raghaverma/Boundary/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/Raghaverma/Boundary/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Raghaverma/Boundary/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Raghaverma/Boundary/releases/tag/v1.0.0


