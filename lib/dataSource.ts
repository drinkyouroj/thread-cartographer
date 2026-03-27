// DataSource interface — the critical architectural abstraction
// All Reddit fetching goes through this interface.
// No component or route touches Reddit directly.
// Per PRD Section 4.4

import type { ThreadData } from "./types";

export interface DataSource {
  /**
   * Fetch and normalize a thread into a flat node/edge graph.
   * Implementations handle caching internally.
   * Throws on invalid URL, rate limit exceeded, or fetch failure.
   */
  fetchThread(url: string): Promise<ThreadData>;

  /**
   * Check if a URL is a valid target for this data source.
   */
  isValidUrl(url: string): boolean;
}
