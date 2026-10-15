import Link from 'next/link';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg">
      {/* Admin Header */}
      <header className="bg-gray-50 dark:bg-dark-bg-light border-b border-gray-200 dark:border-slate-700 px-4 py-4">
        <div className="max-w-7xl mx-auto">
          {/* Top row - logo and back link */}
          <div className="flex items-center justify-between mb-3 md:mb-0">
            <Link href="/admin" className="text-xl font-bold text-gray-900 dark:text-white">
              Admin
            </Link>
            <Link
              href="/"
              className="text-sm text-teal dark:text-teal-light hover:text-coral transition-colors"
            >
              &larr; Back to Site
            </Link>
          </div>

          {/* Navigation - horizontal scroll on mobile, inline on desktop */}
          <nav className="flex items-center gap-3 md:gap-4 overflow-x-auto pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 md:mt-0 mt-2">
            <Link
              href="/admin"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap"
            >
              Dashboard
            </Link>
            <Link
              href="/admin/queue"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap"
            >
              Queue
            </Link>
            <Link
              href="/admin/indexing"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap"
            >
              Indexing
            </Link>
            <Link
              href="/admin/analytics"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap"
            >
              Analytics
            </Link>
          </nav>
        </div>
      </header>

      {/* Admin Content */}
      <main className="max-w-7xl mx-auto px-4 py-4 md:py-8">{children}</main>
    </div>
  );
}
