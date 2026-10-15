import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About',
  description: 'Learn about Findria, an AI-powered geospatial data discovery tool by dymaptic.',
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg">
      <header className="bg-gray-50 dark:bg-dark-bg-light border-b border-gray-200 dark:border-slate-700 px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/"
            className="text-sm text-teal dark:text-teal-light hover:text-coral transition-colors"
          >
            &larr; Back to Search
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        {/* Page Title */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">About Findria</h1>
          <p className="text-xl text-slate-500 dark:text-slate-400">
            Find the right geospatial data in seconds, not hours.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 italic">
            Inspired by the Great Library of Alexandria &mdash; the ancient world&apos;s first attempt
            to gather all human knowledge in one place. We&apos;re carrying that mission forward for geospatial data.
          </p>
        </div>

        {/* What is Findria */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            What is Findria?
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            Findria is an AI-powered semantic search engine for discovering public geospatial data.
            It indexes metadata from multiple authoritative sources, enabling you to find relevant datasets
            through natural language queries with automatic location detection and spatial filtering.
          </p>
        </section>

        {/* Data Sources */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6 pb-2 border-b border-gray-200 dark:border-slate-700">
            Data Sources
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-6">
            Findria indexes geospatial data from across the web, including government agencies,
            public data portals, and open data initiatives.
          </p>

          {/* Government & Public Data */}
          <div className="mb-8 pl-4 border-l-2 border-teal">
            <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">Government & Public Data Hubs</h3>
            <p className="text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
              We crawl and index publicly available geospatial datasets from federal, state, and local
              government agencies, as well as authoritative public data portals.
            </p>
            <ul className="space-y-2 text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2">
                <span className="text-teal mt-1.5">•</span>
                <span>~15,000+ curated datasets</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-teal mt-1.5">•</span>
                <span>Authoritative data from government and industry sources</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-teal mt-1.5">•</span>
                <span>Strong coverage of US demographics, utilities, infrastructure, and environment</span>
              </li>
            </ul>
          </div>

          {/* Overture Maps */}
          <div className="pl-4 border-l-2 border-coral">
            <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">Overture Maps</h3>
            <p className="text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
              Overture Maps is an open data initiative from Microsoft, Meta, Amazon, and
              TomTom that provides massive global coverage of building footprints, roads, places of
              interest, and more.
            </p>
            <ul className="space-y-2 text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2">
                <span className="text-coral mt-1.5">•</span>
                <span>2.3B+ building footprints worldwide</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-coral mt-1.5">•</span>
                <span>Global road network data</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-coral mt-1.5">•</span>
                <span>100M+ points of interest</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-coral mt-1.5">•</span>
                <span>Administrative boundaries</span>
              </li>
            </ul>
          </div>
        </section>

        {/* How It Works */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            How It Works
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            Just describe what you&apos;re looking for in plain English &mdash; like &ldquo;building footprints
            in Portland, Oregon&rdquo; &mdash; and Findria uses AI and semantic search to find the most relevant
            datasets. Instead of matching keywords, it understands the meaning behind your query,
            so you spend less time digging through catalogs and more time working with the data you need.
            Preview results on an interactive map before accessing the full dataset.
          </p>
        </section>

        {/* Built by dymaptic */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Built by dymaptic
          </h2>
          <a href="https://www.dymaptic.com" target="_blank" rel="noopener noreferrer" className="inline-block mb-6">
            <img src="/images/dymaptic-logo.svg" alt="dymaptic" className="h-10" />
          </a>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
            Findria is built and operated by{' '}
            <a href="https://www.dymaptic.com" target="_blank" rel="noopener noreferrer" className="text-teal dark:text-teal-light hover:text-coral transition-colors">
              dymaptic
            </a>
            , a GIS software and consulting company specializing in web mapping applications,
            spatial analysis, and geospatial AI solutions.
          </p>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            As an Esri partner, we build tools that help GIS professionals work more efficiently
            with spatial data.
          </p>
        </section>

        {/* Data Logging */}
        <section className="mb-12 p-6 bg-gray-100 dark:bg-slate-800/50 rounded-lg border border-gray-300 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
            Data Logging
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
            Findria is a free service. To help us improve and understand how the tool is used,
            <strong className="text-gray-900 dark:text-white"> we log all search queries and Ask AI questions</strong>. This data helps us understand
            what types of geospatial data users are looking for and improve our search quality.
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Logged data includes the search query text, timestamps, and basic session information. We do not
            collect personal information, and logged data cannot be used to identify individual users.
          </p>
        </section>

        {/* AI Disclaimer */}
        <section className="mb-12 p-6 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800/30">
          <h2 className="text-xl font-semibold text-amber-800 dark:text-amber-200 mb-3">
            AI Disclaimer
          </h2>
          <p className="text-amber-900/80 dark:text-amber-100/80 leading-relaxed mb-3">
            Findria uses artificial intelligence to understand
            your queries and find relevant datasets. <strong className="text-amber-900 dark:text-amber-100">AI systems can make mistakes.</strong> Search results
            and Ask AI responses may be incomplete, inaccurate, or miss relevant datasets entirely.
          </p>
          <p className="text-amber-800/60 dark:text-amber-100/60 text-sm">
            This service is provided &ldquo;as is&rdquo; without warranties. Always verify that datasets meet your
            needs by reviewing the original source. Do not rely solely on Findria for critical decisions.
          </p>
        </section>

        {/* Contact */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Contact
          </h2>
          <p className="text-slate-600 dark:text-slate-300">
            For questions, feedback, or partnership inquiries, please contact us at{' '}
            <a href="mailto:support@dymaptic.com" className="text-teal dark:text-teal-light hover:text-coral transition-colors">
              support@dymaptic.com
            </a>
            .
          </p>
        </section>
      </main>

      <footer className="bg-white dark:bg-dark-bg border-t border-gray-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 px-4 py-6 text-sm">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <a href="https://www.dymaptic.com" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1.5">
              <span>&copy; {new Date().getFullYear()}</span>
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
