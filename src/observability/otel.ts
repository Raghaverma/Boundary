/**
 * OpenTelemetry observability adapter
 *
 * This adapter provides structured observability compatible with OpenTelemetry.
 * Users should provide their own OTel SDK instances configured for their environment.
 *
 * Usage:
 * ```typescript
 * import { trace, metrics } from "@opentelemetry/api";
 *
 * const boundary = await Boundary.create({
 *   observability: new OpenTelemetryObservability({
 *     tracer: trace.getTracer("boundary-sdk"),
 *     meter: metrics.getMeter("boundary-sdk"),
 *   }),
 *   localUnsafe: true, // Required for local development
 *   // ... other config
 * });
 * ```
 */

import type {
  ObservabilityAdapter,
  RequestContext,
  ResponseContext,
  ErrorContext,
  Metric,
} from "../core/types.js";

/**
 * OpenTelemetry Tracer interface (subset of @opentelemetry/api Tracer)
 */
export interface OTelTracer {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): OTelSpan;
}

/**
 * OpenTelemetry Span interface (subset of @opentelemetry/api Span)
 */
export interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): this;
  setStatus(status: { code: number; message?: string }): this;
  recordException(exception: Error): void;
  end(): void;
}

/**
 * OpenTelemetry Meter interface (subset of @opentelemetry/api Meter)
 */
export interface OTelMeter {
  createCounter(name: string, options?: { description?: string }): OTelCounter;
  createHistogram(name: string, options?: { description?: string; unit?: string }): OTelHistogram;
}

/**
 * OpenTelemetry Counter interface
 */
export interface OTelCounter {
  add(value: number, attributes?: Record<string, string>): void;
}

/**
 * OpenTelemetry Histogram interface
 */
export interface OTelHistogram {
  record(value: number, attributes?: Record<string, string>): void;
}

export interface OpenTelemetryConfig {
  tracer: OTelTracer;
  meter: OTelMeter;
  /** Prefix for metric names (default: "boundary") */
  metricPrefix?: string;
}

// Span status codes (from OpenTelemetry spec)
const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

export class OpenTelemetryObservability implements ObservabilityAdapter {
  private tracer: OTelTracer;
  private meter: OTelMeter;
  private metricPrefix: string;
  private requestCounter: OTelCounter;
  private errorCounter: OTelCounter;
  private durationHistogram: OTelHistogram;
  private activeSpans: Map<string, OTelSpan> = new Map();

  constructor(config: OpenTelemetryConfig) {
    this.tracer = config.tracer;
    this.meter = config.meter;
    this.metricPrefix = config.metricPrefix ?? "boundary";

    // Initialize metrics
    this.requestCounter = this.meter.createCounter(`${this.metricPrefix}.requests`, {
      description: "Total number of Boundary API requests",
    });

    this.errorCounter = this.meter.createCounter(`${this.metricPrefix}.errors`, {
      description: "Total number of Boundary API errors",
    });

    this.durationHistogram = this.meter.createHistogram(`${this.metricPrefix}.duration`, {
      description: "Request duration in milliseconds",
      unit: "ms",
    });
  }

  logRequest(context: RequestContext): void {
    // Start a new span for this request
    const span = this.tracer.startSpan(`${context.provider}.${context.method}`, {
      attributes: {
        "boundary.provider": context.provider,
        "http.method": context.method,
        "http.url": context.endpoint,
        "boundary.request_id": context.requestId,
      },
    });

    // Store span for later completion
    this.activeSpans.set(context.requestId, span);

    // Increment request counter
    this.requestCounter.add(1, {
      provider: context.provider,
      method: context.method,
    });
  }

  logResponse(context: ResponseContext): void {
    // Get and complete the span
    const span = this.activeSpans.get(context.requestId);
    if (span) {
      span.setAttribute("http.status_code", context.statusCode);
      span.setAttribute("boundary.duration_ms", context.duration);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      this.activeSpans.delete(context.requestId);
    }

    // Record duration
    this.durationHistogram.record(context.duration, {
      provider: context.provider,
      method: context.method,
      status: String(context.statusCode),
    });
  }

  logError(context: ErrorContext): void {
    // Get and complete the span with error status
    const span = this.activeSpans.get(context.requestId);
    if (span) {
      span.setAttribute("boundary.error.category", context.error.category);
      span.setAttribute("boundary.error.retryable", context.error.retryable);
      span.setAttribute("boundary.duration_ms", context.duration);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: context.error.message,
      });

      // Record the exception
      const error = new Error(context.error.message);
      error.name = `BoundaryError.${context.error.category}`;
      span.recordException(error);

      span.end();
      this.activeSpans.delete(context.requestId);
    }

    // Increment error counter
    this.errorCounter.add(1, {
      provider: context.provider,
      category: context.error.category,
    });

    // Record duration for errors too
    this.durationHistogram.record(context.duration, {
      provider: context.provider,
      method: context.method,
      status: "error",
      category: context.error.category,
    });
  }

  logWarning(message: string, metadata?: Record<string, unknown>): void {
    // Warnings don't create spans, but we can log them through console
    // In a full implementation, this could use OTel logging API
    console.warn(`[Boundary OTel] ${message}`, metadata);
  }

  recordMetric(metric: Metric): void {
    // Forward custom metrics to the counter
    // In practice, you'd want different metric types for different metrics
    this.requestCounter.add(metric.value, metric.tags);
  }
}
