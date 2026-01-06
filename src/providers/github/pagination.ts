/**
 * GitHub-specific pagination strategy using Link headers (RFC 5988)
 */

import type { PaginationStrategy, RawResponse, RequestOptions } from "../../core/types.js";

export class GitHubPaginationStrategy implements PaginationStrategy {
  extractCursor(response: RawResponse): string | null {
    const linkHeader = response.headers.get("Link");
    if (!linkHeader) {
      return null;
    }

    // Parse Link header: <https://api.github.com/user/repos?page=2>; rel="next"
    const links = this.parseLinkHeader(linkHeader);
    const nextLink = links.find((link) => link.rel === "next");

    if (!nextLink) {
      return null;
    }

    // Extract page number from URL
    const url = new URL(nextLink.url);
    const page = url.searchParams.get("page");
    return page;
  }

  extractTotal(response: RawResponse): number | null {
    // GitHub doesn't always provide total count
    // Some endpoints use X-Total-Count header
    const totalHeader = response.headers.get("X-Total-Count");
    if (totalHeader) {
      return parseInt(totalHeader, 10);
    }

    return null;
  }

  hasNext(response: RawResponse): boolean {
    const linkHeader = response.headers.get("Link");
    if (!linkHeader) {
      return false;
    }

    const links = this.parseLinkHeader(linkHeader);
    return links.some((link) => link.rel === "next");
  }

  buildNextRequest(
    endpoint: string,
    options: RequestOptions,
    cursor: string
  ): { endpoint: string; options: RequestOptions } {
    return {
      endpoint,
      options: {
        ...options,
        query: {
          ...options.query,
          page: cursor,
        },
      },
    };
  }

  private parseLinkHeader(linkHeader: string): Array<{ url: string; rel: string }> {
    const links: Array<{ url: string; rel: string }> = [];
    const parts = linkHeader.split(",");

    for (const part of parts) {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match) {
        links.push({
          url: match[1]!,
          rel: match[2]!,
        });
      }
    }

    return links;
  }
}

