# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Auto-registration of built-in provider adapters

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

