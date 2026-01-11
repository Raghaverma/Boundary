

import type { NormalizedError, ErrorType } from "./types.js";

export class ErrorMapper {
  static normalize(
    error: unknown,
    provider: string,
    defaultActionable: string = "An error occurred"
  ): NormalizedError {
    if (error instanceof Error && "type" in error) {
      
      return error as NormalizedError;
    }

    
    if (error instanceof Error) {
      if (
        error.message.includes("ECONNRESET") ||
        error.message.includes("ETIMEDOUT") ||
        error.message.includes("ENOTFOUND")
      ) {
        return this.createError(
          "NETWORK_ERROR",
          provider,
          "Network request failed. Check your connection and try again.",
          error,
          true
        );
      }
    }

    
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
    ) {
      const httpError = error as { status: number; message?: string };
      const status = httpError.status;

      if (status === 401 || status === 403) {
        return this.createError(
          "AUTH_ERROR",
          provider,
          "Authentication failed. Check your credentials.",
          error,
          false
        );
      }

      if (status === 429) {
        const retryAfter = this.extractRetryAfter(error);
        return this.createError(
          "RATE_LIMIT",
          provider,
          "Rate limit exceeded. Please wait before retrying.",
          error,
          true,
          retryAfter
        );
      }

      if (status >= 500) {
        return this.createError(
          "PROVIDER_ERROR",
          provider,
          `Provider returned error ${status}. This may be temporary.`,
          error,
          true
        );
      }

      if (status >= 400) {
        return this.createError(
          "VALIDATION_ERROR",
          provider,
          httpError.message ?? "Request validation failed.",
          error,
          false
        );
      }
    }

    
    return this.createError(
      "PROVIDER_ERROR",
      provider,
      defaultActionable,
      error,
      false
    );
  }

  private static createError(
    type: ErrorType,
    provider: string,
    actionable: string,
    raw: unknown,
    retryable: boolean,
    retryAfter?: Date
  ): NormalizedError {
    const error = new Error(
      typeof raw === "object" && raw !== null && "message" in raw
        ? String(raw.message)
        : String(raw)
    ) as NormalizedError;

    error.type = type;
    error.provider = provider;
    error.actionable = actionable;
    error.raw = raw;
    error.retryable = retryable;
    if (retryAfter !== undefined) {
      error.retryAfter = retryAfter;
    }
    error.name = type;

    return error;
  }

  private static extractRetryAfter(error: unknown): Date | undefined {
    if (
      typeof error === "object" &&
      error !== null &&
      "headers" in error
    ) {
      const headers = error.headers as Headers | Record<string, string>;
      const retryAfterHeader =
        headers instanceof Headers
          ? headers.get("retry-after")
          : headers["retry-after"] ?? headers["Retry-After"];

      if (retryAfterHeader) {
        const seconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(seconds)) {
          return new Date(Date.now() + seconds * 1000);
        }
      }
    }

    return undefined;
  }
}

