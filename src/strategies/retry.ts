/**
 * Retry logic with exponential backoff and idempotency awareness
 *
 * POLICY INVERSION (Safety-first):
 * - Default: NO retry (maxRetries = 0)
 * - Retry ONLY if BOTH conditions are met:
 *   1. Error is EXPLICITLY marked as retryable
 *   2. Idempotency is PROVEN (SAFE, IDEMPOTENT, or CONDITIONAL with key)
 */

import type { RetryConfig } from "../core/types.js";
import { IdempotencyLevel } from "../core/types.js";
import type { IdempotencyResolver } from "./idempotency.js";

export class RetryStrategy {
  private config: Required<RetryConfig>;

  constructor(
    config: Partial<RetryConfig> = {},
    _idempotencyResolver: IdempotencyResolver // Kept for API compatibility
  ) {
    this.config = {
      // POLICY INVERSION: Default to NO retry for safety
      maxRetries: config.maxRetries ?? 0,
      baseDelay: config.baseDelay ?? 1000,
      maxDelay: config.maxDelay ?? 30000,
      jitter: config.jitter ?? true,
    };
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
      // POLICY INVERSION: Both conditions must be met for retry
      // 1. Max retries not exceeded
      if (attempt >= this.config.maxRetries) {
        throw error;
      }

      // 2. Error MUST be explicitly marked as retryable
      if (!this.isExplicitlyRetryable(error)) {
        throw error;
      }

      // 3. Idempotency MUST be proven (SAFE, IDEMPOTENT, or CONDITIONAL with key)
      if (!this.isIdempotencyProven(idempotencyLevel, hasIdempotencyKey)) {
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

  /**
   * Checks if error is EXPLICITLY marked as retryable.
   * POLICY: Do not infer retryability - require explicit marking.
   */
  private isExplicitlyRetryable(error: unknown): boolean {
    // Error MUST have explicit retryable property set to true
    if (error && typeof error === "object" && "retryable" in error) {
      return (error as { retryable: boolean }).retryable === true;
    }

    // No explicit retryable flag = not retryable
    return false;
  }

  /**
   * Checks if idempotency is proven for safe retry.
   */
  private isIdempotencyProven(
    idempotencyLevel: IdempotencyLevel,
    hasIdempotencyKey: boolean
  ): boolean {
    switch (idempotencyLevel) {
      case IdempotencyLevel.SAFE:
      case IdempotencyLevel.IDEMPOTENT:
        return true;
      case IdempotencyLevel.CONDITIONAL:
        return hasIdempotencyKey;
      case IdempotencyLevel.UNSAFE:
        return false;
      default:
        return false;
    }
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

