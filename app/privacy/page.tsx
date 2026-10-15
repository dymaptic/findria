import Link from "next/link";

export const metadata = {
  title: "Privacy Policy",
  description: "Learn how Findria collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-dark-bg">
      <header className="bg-gray-50 dark:bg-dark-bg-light border-b border-gray-200 dark:border-slate-700 px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <Link href="/" className="text-sm text-teal dark:text-teal-light hover:text-coral transition-colors">
            &larr; Back to Home
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        {/* Page Title */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Privacy Policy</h1>
          <div className="text-slate-500 dark:text-slate-400">
            <p>Findria</p>
            <p>Operated by Moravec Labs, LLC dba dymaptic</p>
            <p>Last Updated: February 2026</p>
          </div>
        </div>

        {/* Key Point Callout */}
        <section className="mb-10 p-6 bg-teal/10 rounded-lg border border-teal/30">
          <p className="text-teal dark:text-teal-light leading-relaxed">
            <strong className="text-gray-900 dark:text-white">Key Point:</strong> Findria is a free, public service that does not require login or account creation.
            We collect minimal information, and what we do collect is anonymous.
          </p>
        </section>

        {/* Overview */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Overview
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
            Findria (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;the Service&rdquo;) is operated by Moravec Labs, LLC dba dymaptic.
            This Privacy Policy explains how we collect, use, store, and protect your information when
            you use our web application to discover and search for public geospatial datasets.
          </p>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
            We are committed to protecting your privacy and being transparent about what data we collect and how we use it.
          </p>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            This Privacy Policy is part of and subject to our{" "}
            <Link href="/terms" className="text-teal dark:text-teal-light hover:text-coral transition-colors">Terms of Service</Link>.
            Please also review our{" "}
            <Link href="/cookies" className="text-teal dark:text-teal-light hover:text-coral transition-colors">Cookie Policy</Link>{" "}
            for information about how we use cookies.
          </p>
        </section>

        {/* Information We Collect */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Information We Collect
          </h2>

          {/* What we do NOT collect */}
          <div className="mb-8 p-6 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800/30">
            <h3 className="text-xl font-medium text-green-800 dark:text-green-200 mb-4">Information We Do NOT Collect</h3>
            <p className="text-green-900/80 dark:text-green-100/80 mb-4">
              Findria does not require authentication. We do <strong className="text-green-900 dark:text-green-100">not</strong> collect:
            </p>
            <ul className="space-y-2 text-green-900/80 dark:text-green-100/80">
              {[
                'Your name or email address',
                'ArcGIS credentials or account information',
                'Payment or billing information',
                'Location from your device (GPS)',
                'Personally identifiable information of any kind',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-green-600 dark:text-green-400 mt-1">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Anonymous Usage Data */}
          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">Anonymous Usage Data</h3>
          <p className="text-slate-600 dark:text-slate-300 mb-4">
            To improve the Service, we collect anonymous usage data when you perform searches
            or use Ask AI. This data cannot be used to identify you personally.
          </p>

          <div className="overflow-x-auto mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Data</th>
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Purpose</th>
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Retention</th>
                </tr>
              </thead>
              <tbody className="text-slate-600 dark:text-slate-300">
                {[
                  { data: 'Search Queries', purpose: 'Understand what data types users are looking for', retention: 'Indefinitely' },
                  { data: 'Ask AI Conversations', purpose: 'Full questions, AI responses, and referenced datasets', retention: 'Indefinitely' },
                  { data: 'Parsed Topics', purpose: 'Identify popular data categories', retention: 'Indefinitely' },
                  { data: 'Location References', purpose: 'Understand geographic areas of interest', retention: 'Indefinitely' },
                  { data: 'Result Counts', purpose: 'Measure search effectiveness', retention: 'Indefinitely' },
                  { data: 'Performance Metrics', purpose: 'Optimize search speed', retention: 'Indefinitely' },
                  { data: 'Hashed Session ID', purpose: 'Group searches within a session (not reversible)', retention: 'Indefinitely' },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-gray-200 dark:border-slate-800">
                    <td className="py-3 px-4 text-gray-900 dark:text-white font-medium">{row.data}</td>
                    <td className="py-3 px-4">{row.purpose}</td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{row.retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Shared Conversations */}
          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">Shared Conversations</h3>
          <p className="text-slate-600 dark:text-slate-300 mb-4">
            When you use Ask AI, conversations are stored in our database. You may choose to share a
            conversation via a public link. Shared conversations include the full question, all AI-generated
            responses, and referenced datasets. Shared links are accessible to anyone with the URL.
            Conversations do not contain personal information as no login is required.
          </p>

          {/* Technical Data */}
          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">Technical Data</h3>
          <p className="text-slate-600 dark:text-slate-300 mb-4">Like most websites, our servers automatically log:</p>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300 mb-4">
            {[
              'IP address (used for security, not stored long-term)',
              'Browser type and version',
              'Referring URL',
              'Time of access',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-teal mt-1">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            This data is processed by Cloudflare and our hosting provider for security and performance.
            We do not correlate this data with search activity.
          </p>
        </section>

        {/* How We Use Your Information */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            How We Use Your Information
          </h2>

          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">To Improve the Service</h3>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300 mb-6">
            {[
              'Identify gaps in our dataset coverage',
              'Understand what types of data users are searching for',
              'Optimize search performance and accuracy',
              'Prioritize new data sources to add',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-teal mt-1">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">We Do NOT</h3>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300">
            {[
              'Sell your information (we have no personal information to sell)',
              'Use your data for advertising',
              'Share your data with third parties for marketing',
              'Build profiles about individual users',
              'Track you across websites',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-red-400 mt-1">✗</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* AI Processing */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            AI Processing
          </h2>

          <div className="space-y-6">
            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Query Parsing &amp; Ask AI (Anthropic Claude)</h3>
              <p className="text-slate-600 dark:text-slate-300 mb-3">
                When you enter a search query, we send it to Anthropic&apos;s Claude API to parse the natural
                language and extract search parameters (topics, locations, data types). When you use Ask AI,
                your full conversation (questions and AI responses) is sent to Claude to generate responses.
              </p>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-2">How we protect your data:</p>
              <ul className="space-y-1 text-slate-500 dark:text-slate-400 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">•</span>
                  <span>We use Anthropic&apos;s API tier, which is <strong className="text-slate-600 dark:text-slate-300">opted out of model training</strong> by default</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">•</span>
                  <span>Anthropic maintains <strong className="text-slate-600 dark:text-slate-300">SOC 2 Type II</strong> certification</span>
                </li>
              </ul>
            </div>

            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Embedding Generation (OpenAI)</h3>
              <p className="text-slate-600 dark:text-slate-300 mb-3">
                Search queries are converted to numerical embeddings using OpenAI&apos;s text-embedding-3-small
                model for semantic search matching.
              </p>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-2">How we protect your data:</p>
              <ul className="space-y-1 text-slate-500 dark:text-slate-400 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">•</span>
                  <span>We use OpenAI&apos;s API tier, which is <strong className="text-slate-600 dark:text-slate-300">opted out of model training</strong> by default</span>
                </li>
              </ul>
            </div>

            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Geocoding (Esri ArcGIS)</h3>
              <p className="text-slate-600 dark:text-slate-300 mb-3">
                Location references extracted from your queries (e.g., &ldquo;Denver, CO&rdquo;) are sent to
                Esri&apos;s ArcGIS geocoding service to convert them into geographic coordinates for spatial
                filtering of search results.
              </p>
            </div>
          </div>

          <div className="mt-6 p-4 bg-gray-100 dark:bg-slate-800/50 rounded-lg">
            <h4 className="text-gray-900 dark:text-white font-medium mb-2">What This Means For You</h4>
            <p className="text-slate-600 dark:text-slate-300 text-sm mb-2">
              We use API tiers from both Anthropic and OpenAI that are opted out of model training by default.
              We do not voluntarily opt in to any training programs with our AI providers.
            </p>
            <p className="text-slate-600 dark:text-slate-300 text-sm">
              <strong className="text-gray-900 dark:text-white">Findria itself stores</strong> your search queries, Ask AI conversations,
              and related metadata as described in the &ldquo;Information We Collect&rdquo; section above. This data
              is stored in our database to improve the Service and is retained indefinitely.
            </p>
          </div>
        </section>

        {/* Data Sharing */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Data Sharing
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-4">We share information only with these service providers:</p>

          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Recipient</th>
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Data Shared</th>
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody className="text-slate-600 dark:text-slate-300">
                {[
                  { recipient: 'Anthropic (AI Provider)', data: 'Search queries, Ask AI conversations', purpose: 'Parse queries and power AI chat' },
                  { recipient: 'OpenAI (AI Provider)', data: 'Search queries', purpose: 'Generate embeddings for semantic search' },
                  { recipient: 'Esri / ArcGIS (Mapping)', data: 'Location text from queries', purpose: 'Geocoding, map display, data previews' },
                  { recipient: 'Cloudflare (CDN/Security)', data: 'IP address, request headers', purpose: 'Security, DDoS protection, performance' },
                  { recipient: 'Microsoft Azure (Hosting)', data: 'All stored data (encrypted)', purpose: 'Host our application and database' },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-gray-200 dark:border-slate-800">
                    <td className="py-3 px-4 text-gray-900 dark:text-white font-medium">{row.recipient}</td>
                    <td className="py-3 px-4">{row.data}</td>
                    <td className="py-3 px-4">{row.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-slate-500 dark:text-slate-400 text-sm">We do not sell, rent, or trade any information.</p>
        </section>

        {/* Data Security */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Data Security
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-4">We implement industry-standard security measures:</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { name: 'Encryption in Transit', desc: 'All data transmitted via HTTPS/TLS' },
              { name: 'Encryption at Rest', desc: 'Database contents encrypted' },
              { name: 'Access Controls', desc: 'Database and infrastructure access restricted to authorized personnel' },
              { name: 'Cloudflare Protection', desc: 'DDoS mitigation, WAF, bot protection' },
              { name: 'No Personal Data', desc: "We don't collect PII, so there's minimal risk" },
            ].map((item, i) => (
              <div key={i} className="p-4 bg-gray-100 dark:bg-slate-800/50 rounded-lg">
                <h4 className="text-gray-900 dark:text-white font-medium mb-1">{item.name}</h4>
                <p className="text-slate-500 dark:text-slate-400 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Your Rights */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Your Rights
          </h2>

          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">No Account = No Personal Data</h3>
          <p className="text-slate-600 dark:text-slate-300 mb-6">
            Since Findria does not require accounts or collect personal information,
            there is no personal data to access, correct, or delete.
          </p>

          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">Cookies</h3>
          <p className="text-slate-600 dark:text-slate-300">
            You can control cookies through your browser settings. See our{" "}
            <Link href="/cookies" className="text-teal dark:text-teal-light hover:text-coral transition-colors">
              Cookie Policy
            </Link>{" "}
            for details.
          </p>
        </section>

        {/* Data Retention */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Data Retention
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Data Type</th>
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Retention Period</th>
                </tr>
              </thead>
              <tbody className="text-slate-600 dark:text-slate-300">
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <td className="py-3 px-4">Anonymous Search Logs</td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400">Indefinitely</td>
                </tr>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <td className="py-3 px-4">Server Access Logs</td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400">Managed by Cloudflare/Azure</td>
                </tr>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <td className="py-3 px-4">Ask AI Conversations</td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400">Indefinitely</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Children's Privacy */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Children&apos;s Privacy
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            Findria is a general-purpose data discovery tool. We do not knowingly collect
            information from children under 13. Since we don&apos;t collect personal information from
            anyone, this applies equally to all users.
          </p>
        </section>

        {/* International Users */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            International Users
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            Findria is operated from the United States. If you access the Service from outside
            the US, your search queries will be processed in the US. Since we don&apos;t collect personal
            information, GDPR data transfer provisions generally do not apply.
          </p>
        </section>

        {/* Changes to This Policy */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Changes to This Policy
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            We may update this Privacy Policy from time to time. Changes will be posted on this page
            with an updated &ldquo;Last Updated&rdquo; date. Since we don&apos;t collect email addresses, we cannot
            notify you directly of changes.
          </p>
        </section>

        {/* Contact Us */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Contact Us
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-2">If you have questions about this Privacy Policy:</p>
          <p className="text-slate-600 dark:text-slate-300">
            <strong className="text-gray-900 dark:text-white">Moravec Labs, LLC dba dymaptic</strong><br />
            3327 NE 59th Ave., Portland, OR 97213<br />
            Email: <a href="mailto:support@dymaptic.com" className="text-teal dark:text-teal-light hover:text-coral transition-colors">support@dymaptic.com</a>
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
