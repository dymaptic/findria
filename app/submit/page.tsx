import Link from 'next/link';
import { Metadata } from 'next';
import SourceSubmissionForm from '@/components/SourceSubmissionForm';

export const metadata: Metadata = {
  title: 'Submit a Data Source',
  description: 'Help expand our catalog by submitting public ArcGIS servers, services, or Open Data portals.',
};

export default function SubmitPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg">
      <header className="bg-gray-50 dark:bg-dark-bg-light border-b border-gray-200 dark:border-slate-700 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <Link
            href="/"
            className="text-sm text-teal dark:text-teal-light hover:text-coral hover:underline transition-colors"
          >
            &larr; Back to Search
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Add a Data Source</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Help us expand our catalog by submitting public ArcGIS servers, services, or Open Data portals.
            We&apos;ll validate the URL and add it to our indexing queue.
          </p>
        </div>

        <SourceSubmissionForm />

        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
          By submitting a URL, you agree to our{' '}
          <Link href="/terms" className="text-teal dark:text-teal-light hover:text-coral transition-colors">Terms of Service</Link>.
          Submitted URLs are logged and queued for indexing.
        </p>

        <div className="mt-12 border-t border-gray-200 dark:border-slate-700 pt-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Supported URL Types</h2>
          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-dark-bg-light rounded-lg p-4 border border-gray-300 dark:border-slate-700">
              <h3 className="font-medium text-gray-900 dark:text-white mb-2">ArcGIS Server</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Root URL of an ArcGIS Server. We&apos;ll crawl all public folders and services.
              </p>
              <code className="text-xs text-teal-dark dark:text-teal-light bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded block overflow-x-auto">
                https://gis.city.gov/arcgis/rest/services
              </code>
            </div>

            <div className="bg-gray-50 dark:bg-dark-bg-light rounded-lg p-4 border border-gray-300 dark:border-slate-700">
              <h3 className="font-medium text-gray-900 dark:text-white mb-2">Single Service</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Direct URL to a FeatureServer or MapServer. We&apos;ll index all layers.
              </p>
              <code className="text-xs text-teal-dark dark:text-teal-light bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded block overflow-x-auto">
                https://services.arcgis.com/.../FeatureServer
              </code>
            </div>

            <div className="bg-gray-50 dark:bg-dark-bg-light rounded-lg p-4 border border-gray-300 dark:border-slate-700">
              <h3 className="font-medium text-gray-900 dark:text-white mb-2">Open Data Hub</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                ArcGIS Hub or Open Data portal URL. We&apos;ll index the catalog.
              </p>
              <code className="text-xs text-teal-dark dark:text-teal-light bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded block overflow-x-auto">
                https://data.cityname.org
              </code>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-white dark:bg-dark-bg border-t border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 px-4 py-6 text-sm">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <a href="https://www.dymaptic.com" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1.5">
              <span>© {new Date().getFullYear()}</span>
              <img src="/images/dymaptic-logo.svg" alt="dymaptic" className="h-3.5 opacity-60" />
            </a>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-900 dark:hover:text-white transition-colors">Terms</Link>
            <Link href="/cookies" className="hover:text-gray-900 dark:hover:text-white transition-colors">Cookies</Link>
            <Link href="/about" className="hover:text-gray-900 dark:hover:text-white transition-colors">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
