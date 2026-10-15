import { sql } from '@/lib/db';

// Force dynamic rendering - this page needs database access
export const dynamic = 'force-dynamic';

interface Stats {
  totalDatasets: number;
  livingAtlas: number;
  geoparquet: number;
  customOrg: number;
  userSubmitted: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  recentSearches: number;
  recentChats: number;
}

async function getStats(): Promise<Stats> {
  const [datasetStats] = await sql<{
    total: string;
    living_atlas: string;
    geoparquet: string;
    custom_org: string;
    user_submitted: string;
  }[]>`
    SELECT
      COUNT(*)::text as total,
      COUNT(*) FILTER (WHERE source = 'living_atlas')::text as living_atlas,
      COUNT(*) FILTER (WHERE source = 'geoparquet')::text as geoparquet,
      COUNT(*) FILTER (WHERE source = 'custom_org')::text as custom_org,
      COUNT(*) FILTER (WHERE source = 'user_submitted')::text as user_submitted
    FROM datasets
  `;

  const [jobStats] = await sql<{
    pending: string;
    processing: string;
    completed: string;
    failed: string;
  }[]>`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::text as pending,
      COUNT(*) FILTER (WHERE status = 'processing')::text as processing,
      COUNT(*) FILTER (WHERE status = 'completed')::text as completed,
      COUNT(*) FILTER (WHERE status = 'failed')::text as failed
    FROM indexing_jobs
  `;

  const [searchStats] = await sql<{ count: string }[]>`
    SELECT COUNT(*)::text as count
    FROM search_logs
    WHERE searched_at > NOW() - INTERVAL '24 hours'
  `;

  let chatCount = 0;
  try {
    const [chatStats] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text as count
      FROM chat_conversations
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;
    chatCount = parseInt(chatStats?.count || '0', 10);
  } catch {
    // chat_conversations table may not exist
  }

  return {
    totalDatasets: parseInt(datasetStats?.total || '0', 10),
    livingAtlas: parseInt(datasetStats?.living_atlas || '0', 10),
    geoparquet: parseInt(datasetStats?.geoparquet || '0', 10),
    customOrg: parseInt(datasetStats?.custom_org || '0', 10),
    userSubmitted: parseInt(datasetStats?.user_submitted || '0', 10),
    pendingJobs: parseInt(jobStats?.pending || '0', 10),
    processingJobs: parseInt(jobStats?.processing || '0', 10),
    completedJobs: parseInt(jobStats?.completed || '0', 10),
    failedJobs: parseInt(jobStats?.failed || '0', 10),
    recentSearches: parseInt(searchStats?.count || '0', 10),
    recentChats: chatCount,
  };
}

export default async function AdminDashboard() {
  const stats = await getStats();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>

      {/* Dataset Stats */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Datasets</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Total" value={stats.totalDatasets} />
          <StatCard label="ArcGIS" value={stats.livingAtlas} color="coral" />
          <StatCard label="GeoParquet" value={stats.geoparquet} color="teal" />
          <StatCard label="Custom Orgs" value={stats.customOrg} color="purple" />
          <StatCard label="User Submitted" value={stats.userSubmitted} color="amber" />
        </div>
      </section>

      {/* Job Queue Stats */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Indexing Queue</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Pending" value={stats.pendingJobs} color="amber" />
          <StatCard label="Processing" value={stats.processingJobs} color="blue" />
          <StatCard label="Completed" value={stats.completedJobs} color="emerald" />
          <StatCard label="Failed" value={stats.failedJobs} color="red" />
        </div>
      </section>

      {/* Activity Stats */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Activity (24h)</h2>
        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Searches" value={stats.recentSearches} />
          <StatCard label="Chat Messages" value={stats.recentChats} />
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  color = 'default',
}: {
  label: string;
  value: number;
  color?: 'default' | 'coral' | 'teal' | 'purple' | 'amber' | 'blue' | 'emerald' | 'red';
}) {
  const colorClasses = {
    default: 'border-gray-200 dark:border-slate-700',
    coral: 'border-coral/50',
    teal: 'border-teal/50',
    purple: 'border-purple-500/50',
    amber: 'border-amber-500/50',
    blue: 'border-blue-500/50',
    emerald: 'border-emerald-500/50',
    red: 'border-red-500/50',
  };

  return (
    <div className={`bg-gray-50 dark:bg-dark-bg-light rounded-lg p-4 border ${colorClasses[color]}`}>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value.toLocaleString()}</div>
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  );
}
