/**
 * Response normalization
 */

import type {
  NormalizedResponse,
  ResponseMeta,
  RawResponse,
  RateLimitInfo,
  PaginationInfo,
} from "./types.js";
import { randomUUID } from "crypto";

export class ResponseNormalizer {
  static normalize<T>(
    raw: RawResponse,
    provider: string,
    rateLimitInfo: RateLimitInfo,
    paginationInfo?: PaginationInfo,
    warnings: string[] = [],
    schemaVersion: string = "1.0.0"
  ): NormalizedResponse<T> {
    const requestId = randomUUID();

    const meta: ResponseMeta = {
      provider,
      requestId,
      rateLimit: rateLimitInfo,
      warnings,
      schemaVersion,
    };

    if (paginationInfo) {
      meta.pagination = paginationInfo;
    }

    return {
      data: raw.body as T,
      meta,
    };
  }

  static extractPaginationInfo(
    raw: RawResponse,
    paginationStrategy: { hasNext: (response: RawResponse) => boolean; extractCursor: (response: RawResponse) => string | null; extractTotal: (response: RawResponse) => number | null }
  ): PaginationInfo | undefined {
    const hasNext = paginationStrategy.hasNext(raw);
    if (!hasNext) {
      return undefined;
    }

    const cursor = paginationStrategy.extractCursor(raw);
    const total = paginationStrategy.extractTotal(raw);

    const pagination: PaginationInfo = {
      hasNext,
    };
    if (cursor !== null) {
      pagination.cursor = cursor;
    }
    if (total !== null) {
      pagination.total = total;
    }
    return pagination;
  }
}

