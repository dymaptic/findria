import Link from "next/link";

export const metadata = {
  title: "Cookie Policy",
  description: "Learn about how Findria uses cookies and local storage.",
};

export default function CookiesPage() {
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
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Cookie Policy</h1>
          <div className="text-slate-500 dark:text-slate-400">
            <p>Findria</p>
            <p>Operated by Moravec Labs, LLC dba dymaptic</p>
            <p>Last Updated: February 2026</p>
          </div>
        </div>

        {/* What Are Cookies */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            What Are Cookies?
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
            Cookies are small text files stored on your device when you visit a website.
            They help websites remember your preferences and improve your experience.
            Websites may also use similar technologies like local storage to save preferences on your device.
          </p>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            This Cookie Policy is part of and subject to our{" "}
            <Link href="/terms" className="text-teal dark:text-teal-light hover:text-coral transition-colors">Terms of Service</Link>.
            Please also review our{" "}
            <Link href="/privacy" className="text-teal dark:text-teal-light hover:text-coral transition-colors">Privacy Policy</Link>{" "}
            for information about how we handle your data.
          </p>
        </section>

        {/* How We Use Cookies */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            How We Use Cookies &amp; Local Storage
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            Findria employs a minimal set of cookies and browser storage, primarily for essential functionality
            and remembering your preferences.
            We do <strong className="text-gray-900 dark:text-white">not</strong> use tracking or advertising cookies.
          </p>
        </section>

        {/* Cookies & Storage We Use */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Cookies &amp; Storage We Use
          </h2>

          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3 mt-6">Essential (Local Storage)</h3>
          <p className="text-slate-600 dark:text-slate-300 mb-4">
            Findria does not set any first-party cookies. Instead, we use your browser&apos;s local storage
            to save a small amount of data that stays on your device and is never sent to our servers.
          </p>

          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Key</th>
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Purpose</th>
                  <th className="text-left py-3 px-4 text-gray-900 dark:text-white font-medium">Duration</th>
                </tr>
              </thead>
              <tbody className="text-slate-600 dark:text-slate-300">
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <td className="py-3 px-4"><code className="text-teal dark:text-teal-light">theme</code></td>
                  <td className="py-3 px-4">Remembers your light/dark mode preference</td>
                  <td className="py-3 px-4">Until cleared</td>
                </tr>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <td className="py-3 px-4"><code className="text-teal dark:text-teal-light text-xs">data-librarian-recent-searches</code></td>
                  <td className="py-3 px-4">Stores your last 10 search queries for quick access</td>
                  <td className="py-3 px-4">Until cleared</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Local storage data never leaves your browser. You can clear it at any time via your browser settings
            or by clearing your browsing data.
          </p>
        </section>

        {/* Third-Party Services */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Third-Party Cookies
          </h2>

          <div className="space-y-6">
            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Cloudflare</h3>
              <p className="text-slate-600 dark:text-slate-300 mb-2">
                We use Cloudflare for CDN, security, and DDoS protection. Cloudflare may set cookies
                that we do not control.
              </p>
              <ul className="space-y-1 text-slate-500 dark:text-slate-400 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">&bull;</span>
                  <span><code className="text-teal dark:text-teal-light">__cf_bm</code>: Bot management (expires after 30 minutes)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">&bull;</span>
                  <span><code className="text-teal dark:text-teal-light">cf_clearance</code>: Challenge passage for verified visitors</span>
                </li>
              </ul>
            </div>

            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">ArcGIS Maps SDK (Esri)</h3>
              <p className="text-slate-600 dark:text-slate-300 mb-2">
                The embedded map viewer loads Esri&apos;s ArcGIS Maps SDK from CDN, which sets several
                cookies on the <code className="text-teal dark:text-teal-light">.arcgis.com</code> domain
                for authentication, locale, and performance.
              </p>
              <ul className="space-y-1 text-slate-500 dark:text-slate-400 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">&bull;</span>
                  <span><code className="text-teal dark:text-teal-light">esri_aopc</code>, <code className="text-teal dark:text-teal-light">esri_auth_extn</code>: Authentication and session management</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">&bull;</span>
                  <span><code className="text-teal dark:text-teal-light">esri_locale</code>: Language/region preference</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">&bull;</span>
                  <span><code className="text-teal dark:text-teal-light">esri_gdpr</code>: Consent/compliance tracking (managed by Esri via OneTrust)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">&bull;</span>
                  <span><code className="text-teal dark:text-teal-light">at_check</code>, <code className="text-teal dark:text-teal-light">mbox</code>: Esri&apos;s experience optimization (Adobe Target)</span>
                </li>
              </ul>
            </div>

            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Plausible Analytics</h3>
              <p className="text-slate-600 dark:text-slate-300 mb-2">
                We use Plausible Analytics, a privacy-focused analytics service, to understand
                aggregate usage patterns. Plausible uses a lightweight JavaScript script to count page views,
                but it does <strong className="text-gray-900 dark:text-white">not</strong> use cookies, local storage, or collect personal data.
                It will not affect your cookie experience.
              </p>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                Plausible provides aggregate traffic statistics without tracking individual users across
                sessions or websites. All data is anonymous and compliant with GDPR, CCPA, and PECR.
                See{" "}
                <a href="https://plausible.io/data-policy" target="_blank" rel="noopener noreferrer" className="text-teal dark:text-teal-light hover:text-coral transition-colors">
                  Plausible&apos;s data policy
                </a>{" "}
                for details.
              </p>
            </div>
          </div>
        </section>

        {/* What We Do NOT Use */}
        <section className="mb-10 p-6 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800/30">
          <h2 className="text-xl font-semibold text-green-800 dark:text-green-200 mb-4">
            What We Do NOT Use
          </h2>
          <ul className="space-y-2 text-green-900/80 dark:text-green-100/80">
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400 mt-1">&#x2713;</span>
              <span><strong className="text-green-900 dark:text-green-100">No Analytics Cookies</strong> &mdash; Plausible Analytics is cookie-free</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400 mt-1">&#x2713;</span>
              <span><strong className="text-green-900 dark:text-green-100">No Advertising Cookies</strong> &mdash; we do not display ads or use ad tracking</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400 mt-1">&#x2713;</span>
              <span><strong className="text-green-900 dark:text-green-100">No Social Media Cookies</strong> &mdash; we do not embed social media widgets</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400 mt-1">&#x2713;</span>
              <span><strong className="text-green-900 dark:text-green-100">No Cross-Site Tracking</strong> &mdash; we do not track you across other websites</span>
            </li>
          </ul>
        </section>

        {/* Security */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Security
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-4">
            All connections to Findria are protected by HTTPS/TLS encryption. Third-party cookies
            set by Cloudflare and Esri use HttpOnly, Secure, and SameSite attributes where applicable.
          </p>
        </section>

        {/* Managing Cookies */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Managing Cookies &amp; Local Storage
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-4">
            You can control cookies and clear local storage through your browser settings:
          </p>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300">
            {[
              { browser: 'Chrome', path: 'Settings \u2192 Privacy and Security \u2192 Cookies' },
              { browser: 'Firefox', path: 'Settings \u2192 Privacy & Security \u2192 Cookies' },
              { browser: 'Safari', path: 'Preferences \u2192 Privacy \u2192 Cookies' },
              { browser: 'Edge', path: 'Settings \u2192 Privacy, Search, and Services \u2192 Cookies' },
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-teal mt-1">&bull;</span>
                <span><strong className="text-gray-900 dark:text-white">{item.browser}</strong>: {item.path}</span>
              </li>
            ))}
          </ul>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-4">
            Blocking third-party cookies from Cloudflare may affect site access. Clearing local storage
            will reset your theme preference and recent search history.
          </p>
        </section>

        {/* Contact */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Contact Us
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-2">Questions about our cookie practices?</p>
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
