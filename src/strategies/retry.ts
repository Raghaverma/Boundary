/**
 * Retry logic with exponential backoff and idempotency awareness
 */

import type { RetryConfig, NormalizedError } from "../core/types.js";
import { IdempotencyLevel } from "../core/types.js";
import { IdempotencyResolver } from "./idempotency.js";

export class RetryStrategy {
  private config: Required<RetryConfig>;
  private idempotencyResolver: IdempotencyResolver;

  constructor(
    config: Partial<RetryConfig> = {},
    idempotencyResolver: IdempotencyResolver
  ) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      baseDelay: config.baseDelay ?? 1000,
      maxDelay: config.maxDelay ?? 30000,
      jitter: config.jitter ?? true,
    };
    this.idempotencyResolver = idempotencyResolver;
  }

  async execute<T>(
    fn: () => Promise<T>,
    idempotencyLevel: IdempotencyLevel,
    hasIdempotencyKey: boolean,
    attempt: number = 0
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= this.config.maxRetries) {
        throw error;
      }

      // Check if we should retry based on idempotency level
      const shouldRetry = this.idempotencyResolver.shouldRetry(
        idempotencyLevel,
        error as Error,
        attempt,
        this.config.maxRetries,
        hasIdempotencyKey
      );

      if (!shouldRetry) {
        throw error;
      }

      // Check if error is retryable
      if (!this.isRetryableError(error)) {
        throw error;
      }

      // Calculate delay
      const delay = this.calculateDelay(attempt);

      // Wait before retry
      await this.sleep(delay);

      // Retry
      return this.execute(fn, idempotencyLevel, hasIdempotencyKey, attempt + 1);
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // Network errors
      if (
        error.message.includes("ECONNRESET") ||
        error.message.includes("ETIMEDOUT") ||
        error.message.includes("ENOTFOUND")
      ) {
        return true;
      }

      // Normalized errors
      if ("retryable" in error) {
        const normalizedError = error as NormalizedError;
        return normalizedError.retryable;
      }
    }

    return false;
  }

  private calculateDelay(attempt: number): number {
    // Exponential backoff: baseDelay * 2^attempt
    let delay = this.config.baseDelay * Math.pow(2, attempt);

    // Add jitter
    if (this.config.jitter) {
      const jitter = Math.random() * 1000; // 0-1000ms jitter
      delay += jitter;
    }

    // Cap at maxDelay
    return Math.min(delay, this.config.maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

