# Roadmap

## Current Phase: Early Beta

Focus: Core stability, provider coverage, documentation.

## Short-Term Goals (Next 3-6 Months)

### Provider Coverage
- Stripe adapter with idempotency key handling
- OpenAI adapter with streaming support
- AWS SDK integration patterns
- Generic REST adapter for custom providers

### Resilience Improvements
- Distributed rate limiting (Redis-backed)
- Circuit breaker state persistence
- Adaptive retry strategies based on error patterns
- Request queuing with priority support

### Developer Experience
- TypeScript type generation from provider schemas
- CLI tool for schema extraction and validation
- Enhanced error messages with troubleshooting hints
- Performance profiling and optimization

## Long-Term Vision (6-12 Months)

### Advanced Features
- Multi-region failover support
- Request/response transformation pipeline
- GraphQL provider support
- Webhook signature verification and routing
- Built-in caching layer with TTL management

### Enterprise Features
- Audit logging and compliance reporting
- Fine-grained access control per provider
- Cost tracking and budget alerts
- SLA monitoring and alerting

### Ecosystem
- Official provider adapters for top 20 APIs
- Community-contributed adapter registry
- Plugin system for custom middleware
- Integration with popular frameworks (Express, Fastify, NestJS)

## Non-Goals

These are explicitly out of scope:

- UI dashboards or admin panels
- API mocking or stubbing (use external tools)
- Request recording/replay (use external tools)
- GraphQL support before v2.0
- Webhook handling before v2.0
- Built-in caching (layer on top)
- Multi-tenant isolation (application concern)

## Version Milestones

- **1.0.0**: Core SDK stable, 3+ provider adapters
- **1.5.0**: 10+ provider adapters, distributed rate limiting
- **2.0.0**: GraphQL support, webhook handling, major API refinements

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute provider adapters or core improvements.


