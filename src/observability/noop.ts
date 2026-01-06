/**
 * No-op observability adapter - silent (for testing)
 */

import type {
  ObservabilityAdapter,
  RequestContext,
  ResponseContext,
  ErrorContext,
  Metric,
} from "../core/types.js";

export class NoOpObservability implements ObservabilityAdapter {
  logRequest(_context: RequestContext): void {
    // No-op
  }

  logResponse(_context: ResponseContext): void {
    // No-op
  }

  logError(_context: ErrorContext): void {
    // No-op
  }

  logWarning(_message: string, _metadata?: Record<string, unknown>): void {
    // No-op
  }

  recordMetric(_metric: Metric): void {
    // No-op
  }
}

