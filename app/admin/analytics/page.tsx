import { sql } from '@/lib/db';

// Force dynamic rendering - this page needs database access
export const dynamic = 'force-dynamic';

interface SearchLog {
  id: number;
  query_text: string;
  parsed_topics: string[] | null;
  parsed_location: string | null;
  result_count: number | null;
  search_duration_ms: number | null;
  searched_at: Date;
}

interface ChatConversation {
  id: string;
  question: string;
  tools_called: string[] | null;
  created_at: Date;
}

async function getRecentSearches(): Promise<SearchLog[]> {
  const searches = await sql<SearchLog[]>`
    SELECT id, query_text, parsed_topics, parsed_location, result_count, search_duration_ms, searched_at
    FROM search_logs
    ORDER BY searched_at DESC
    LIMIT 50
  `;
  return searches;
}

async function getRecentChats(): Promise<ChatConversation[]> {
  try {
    const chats = await sql<ChatConversation[]>`
      SELECT id, question, tools_called, created_at
      FROM chat_conversations
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return chats;
  } catch {
    // Table may not exist
    return [];
  }
}

async function getPopularSearchTerms(): Promise<{ term: string; count: number }[]> {
  const terms = await sql<{ query_text: string; count: string }[]>`
    SELECT query_text, COUNT(*)::text as count
    FROM search_logs
    WHERE searched_at > NOW() - INTERVAL '7 days'
    GROUP BY query_text
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `;
  return terms.map((t) => ({ term: t.query_text, count: parseInt(t.count, 10) }));
}

async function getNoResultSearches(): Promise<{ term: string; count: number }[]> {
  const terms = await sql<{ query_text: string; count: string }[]>`
    SELECT query_text, COUNT(*)::text as count
    FROM search_logs
    WHERE result_count = 0
      AND searched_at > NOW() - INTERVAL '7 days'
    GROUP BY query_text
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `;
  return terms.map((t) => ({ term: t.query_text, count: parseInt(t.count, 10) }));
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AnalyticsPage() {
  const [recentSearches, recentChats, popularTerms, noResultSearches] = await Promise.all([
    getRecentSearches(),
    getRecentChats(),
    getPopularSearchTerms(),
    getNoResultSearches(),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Popular Search Terms */}
        <section className="bg-gray-50 dark:bg-dark-bg-light rounded-lg p-6 border border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Popular Searches (7 days)</h2>
          {popularTerms.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No search data yet</p>
          ) : (
            <div className="space-y-2">
              {popularTerms.map((term, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-gray-600 dark:text-gray-300 truncate">{term.term}</span>
                  <span className="text-sm text-gray-400 dark:text-gray-500 ml-2">{term.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* No Result Searches */}
        <section className="bg-gray-50 dark:bg-dark-bg-light rounded-lg p-6 border border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Searches with No Results</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Gaps in coverage - consider adding data sources for these topics.
          </p>
          {noResultSearches.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No failed searches</p>
          ) : (
            <div className="space-y-2">
              {noResultSearches.map((term, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-amber-400 truncate">{term.term}</span>
                  <span className="text-sm text-gray-400 dark:text-gray-500 ml-2">{term.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent Searches Table */}
      <section className="bg-gray-50 dark:bg-dark-bg-light rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Searches</h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-100 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Query
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Topics
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Location
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Results
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {recentSearches.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  No searches yet
                </td>
              </tr>
            ) : (
              recentSearches.map((search) => (
                <tr key={search.id} className="hover:bg-gray-100/50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-xs truncate">
                    {search.query_text}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {search.parsed_topics?.join(', ') || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {search.parsed_location || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span
                      className={
                        search.result_count === 0 ? 'text-amber-400' : 'text-emerald-400'
                      }
                    >
                      {search.result_count ?? '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(search.searched_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* Recent Chat Messages Table */}
      <section className="bg-gray-50 dark:bg-dark-bg-light rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Chat Messages</h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-100 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Question
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Tools Used
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Time
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Share Link
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {recentChats.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  No chat messages yet
                </td>
              </tr>
            ) : (
              recentChats.map((chat) => (
                <tr key={chat.id} className="hover:bg-gray-100/50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-xs truncate">
                    {chat.question}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {chat.tools_called?.join(', ') || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(chat.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <a
                      href={`/chat/${chat.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal hover:underline"
                    >
                      View
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
