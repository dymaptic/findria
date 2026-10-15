import { sql } from '@/lib/db';

// Force dynamic rendering - this page needs database access
export const dynamic = 'force-dynamic';

interface IndexingJob {
  id: string;
  job_type: string;
  url: string | null;
  url_type: string | null;
  server_name: string | null;
  status: string;
  priority: number;
  submitted_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  items_processed: number;
  items_indexed: number;
  items_skipped: number;
  error_message: string | null;
  is_reindex: boolean;
}

async function getJobs(): Promise<IndexingJob[]> {
  const jobs = await sql<IndexingJob[]>`
    SELECT
      id, job_type, url, url_type, server_name, status, priority,
      submitted_at, started_at, completed_at,
      items_processed, items_indexed, items_skipped,
      error_message, is_reindex
    FROM indexing_jobs
    ORDER BY
      CASE status
        WHEN 'processing' THEN 1
        WHEN 'pending' THEN 2
        WHEN 'failed' THEN 3
        WHEN 'completed' THEN 4
        ELSE 5
      END,
      submitted_at DESC
    LIMIT 100
  `;

  return jobs;
}

function formatDate(date: Date | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    processing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
    paused: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  return (
    <span className={`px-2 py-1 text-xs rounded border ${styles[status] || styles.paused}`}>
      {status}
    </span>
  );
}

function getJobTypeLabel(jobType: string) {
  const labels: Record<string, string> = {
    user_submission: 'User Submission',
    living_atlas: 'Living Atlas',
    custom_orgs: 'Custom Orgs',
    single_url_admin: 'Admin URL',
  };
  return labels[jobType] || jobType;
}

export default async function QueuePage() {
  const jobs = await getJobs();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Indexing Queue</h1>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Showing {jobs.length} jobs
        </div>
      </div>

      <div className="bg-gray-50 dark:bg-dark-bg-light rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-100 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                URL / Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Progress
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Submitted
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  No jobs in queue
                </td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-100/50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3">
                    {getStatusBadge(job.status)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      {getJobTypeLabel(job.job_type)}
                    </span>
                    {job.is_reindex && (
                      <span className="ml-2 text-xs text-amber-400">(re-index)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="max-w-md">
                      {job.server_name && (
                        <div className="text-sm text-gray-900 dark:text-white truncate">{job.server_name}</div>
                      )}
                      {job.url && (
                        <div className="text-xs text-gray-500 truncate">{job.url}</div>
                      )}
                      {job.error_message && (
                        <div className="text-xs text-red-400 mt-1 truncate">
                          Error: {job.error_message}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      {job.items_indexed > 0 && (
                        <span className="text-emerald-400">{job.items_indexed} indexed</span>
                      )}
                      {job.items_skipped > 0 && (
                        <span className="text-gray-500 dark:text-gray-400 ml-2">{job.items_skipped} skipped</span>
                      )}
                      {job.items_processed === 0 && job.items_indexed === 0 && '-'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(job.submitted_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
