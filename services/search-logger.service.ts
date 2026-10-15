import { execute } from '@/lib/db';
import crypto from 'crypto';

interface SearchLogEntry {
  queryText: string;
  parsedTopics: string[];
  parsedLocation?: string;
  parsedBbox?: [number, number, number, number];
  resultCount: number;
  topResultIds: string[];
  searchDurationMs: number;
  embeddingDurationMs: number;
  sessionHash?: string;
  referrerDomain?: string;
}

export class SearchLogger {
  /**
   * Log a search anonymously for analytics.
   * No personally identifiable information is stored.
   */
  async log(entry: SearchLogEntry): Promise<void> {
    await execute(
      `
      INSERT INTO search_logs (
        query_text, parsed_topics, parsed_location, parsed_bbox,
        result_count, top_result_ids,
        search_duration_ms, embedding_duration_ms,
        session_hash, referrer_domain
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
      [
        entry.queryText,
        entry.parsedTopics,
        entry.parsedLocation || null,
        entry.parsedBbox
          ? JSON.stringify({
              xmin: entry.parsedBbox[0],
              ymin: entry.parsedBbox[1],
              xmax: entry.parsedBbox[2],
              ymax: entry.parsedBbox[3],
            })
          : null,
        entry.resultCount,
        entry.topResultIds,
        entry.searchDurationMs,
        entry.embeddingDurationMs,
        entry.sessionHash || null,
        entry.referrerDomain || null,
      ]
    );
  }

  /**
   * Hash a session ID so it can be used for session-level analytics
   * without being reversible to the original session.
   */
  static hashSession(sessionId: string): string {
    return crypto.createHash('sha256').update(sessionId).digest('hex');
  }

  /**
   * Extract domain from referrer URL for analytics.
   */
  static extractDomain(referrer: string | null): string | null {
    if (!referrer) return null;
    try {
      return new URL(referrer).hostname;
    } catch {
      return null;
    }
  }
}

export const searchLogger = new SearchLogger();
