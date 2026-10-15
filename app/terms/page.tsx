import Link from "next/link";

export const metadata = {
  title: "Terms of Service",
  description: "Terms of Service for using Findria by dymaptic.",
};

export default function TermsPage() {
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
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Terms of Service</h1>
          <div className="text-slate-500 dark:text-slate-400">
            <p>Findria</p>
            <p>Operated by Moravec Labs, LLC dba dymaptic</p>
            <p>Last Updated: February 2026</p>
          </div>
        </div>

        <section className="mb-10">
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            These Terms of Service (the &ldquo;Terms&rdquo;) are between you and Moravec Labs, LLC,
            dba dymaptic, an Oregon limited liability company with its principal place of business
            at 3327 NE 59th Ave., Portland, OR 97213.
          </p>
        </section>

        {/* 1. Agreement to Terms */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            1. Agreement to Terms
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            By accessing or using Findria (&ldquo;the Service&rdquo;), you agree to be bound by these
            Terms of Service (&ldquo;Terms&rdquo;). If you are using the Service on behalf of an organization, 
            you represent and warrant that you have the authority to bind that organization to these Terms.
          </p>
          <p>
            If you do not agree to these Terms, you may not use the Service.
          </p>
        </section>

        {/* 2. Description of Service */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            2. Description of Service
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
            Findria is a free web application that helps users discover public
            geospatial datasets. The Service provides semantic search across multiple data sources including:
          </p>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300 mb-4">
            <li className="flex items-start gap-2">
              <span className="text-teal mt-1">•</span>
              <span><strong className="text-gray-900 dark:text-white">Government & Public Data Hubs</strong>: Datasets from federal, state, and local agencies</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-coral mt-1">•</span>
              <span><strong className="text-gray-900 dark:text-white">Overture Maps</strong>: Open data from Microsoft, Meta, and OpenStreetMap</span>
            </li>
          </ul>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            The Service uses artificial intelligence to parse natural language queries and match them
            to relevant datasets. It does not host or provide the actual data—it helps you find and
            access data from original sources.
          </p>
        </section>

        {/* 3. No Account Required */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            3. No Account Required
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            Findria is a free service that does not require registration or login.
            You may use the Service without providing any personal information.
          </p>
        </section>

        {/* 4. Acceptable Use */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            4. Acceptable Use
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-4">You agree to use the Service only for lawful purposes. You must not:</p>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300">
            {[
              'Use the Service in any way that violates applicable laws or regulations',
              'Attempt to interfere with or disrupt the Service or its infrastructure',
              'Use automated systems (bots, scrapers) to access the Service at excessive rates',
              'Attempt to reverse engineer, decompile, or extract source code from the Service',
              'Resell, redistribute, or commercially exploit the Service or its outputs without authorization',
              'Misrepresent AI-generated content from the Service as human-written',
              'Use the Service to conduct any activity that could harm dymaptic or other users',
              'Misrepresent your identity or affiliation when using the Service',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-red-400 mt-1">✗</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 5. Data Sources and Accuracy */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            5. Data Sources and Accuracy
          </h2>

          <div className="space-y-6">
            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Third-Party Data</h3>
              <p className="text-slate-600 dark:text-slate-300">
                Findria indexes metadata from third-party sources. We do not control, verify, or
                guarantee the accuracy, completeness, or availability of any dataset listed in our search results.
              </p>
            </div>

            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Your Responsibilities</h3>
              <p className="text-slate-600 dark:text-slate-300 mb-3">You are responsible for:</p>
              <ul className="space-y-1 text-slate-500 dark:text-slate-400 text-sm">
                {[
                  'Evaluating whether any dataset is suitable for your intended use',
                  'Complying with the license terms of any data you access through linked sources',
                  'Verifying the accuracy and currency of any data before relying on it',
                  'Understanding that data sources may change, become unavailable, or be updated',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-slate-400 dark:text-slate-500 mt-1">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No Endorsement</h3>
              <p className="text-slate-600 dark:text-slate-300">
                Inclusion of a dataset in our search results does not constitute endorsement by dymaptic.
                We make no representations about the quality, accuracy, or suitability of any third-party data.
              </p>
            </div>
          </div>
        </section>

        {/* 6. AI-Generated Search Results */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            6. AI-Generated Search Results
          </h2>

          <div className="mb-6 p-6 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800/30">
            <h3 className="text-lg font-medium text-amber-800 dark:text-amber-200 mb-3">Nature of AI Processing</h3>
            <p className="text-amber-900/80 dark:text-amber-100/80">
              Search queries are processed using artificial intelligence
              to understand natural language and match queries to relevant datasets. We use third-party
              AI providers that are opted out of model training. <strong className="text-amber-900 dark:text-amber-100">AI systems can make
              mistakes.</strong>
            </p>
          </div>

          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">Limitations</h3>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300 mb-6">
            {[
              'Search results may not be comprehensive or include all relevant datasets',
              'AI may misinterpret queries or return irrelevant results',
              'Dataset descriptions in search results are based on source metadata, which may be incomplete',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-amber-400 mt-1">!</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">Your Responsibilities</h3>
          <p className="text-slate-600 dark:text-slate-300">
            You should verify that search results actually contain the data you need by reviewing
            the original source. Do not rely solely on our search results for critical decisions.
          </p>
        </section>

        {/* 7. Intellectual Property */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            7. Intellectual Property
          </h2>

          <div className="space-y-6">
            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Our Property</h3>
              <p className="text-slate-600 dark:text-slate-300">
                The Service, including its design, features, and underlying technology, and including any
                derivative works, modifications or improvements to them, are and will remain the property
                of dymaptic. These Terms do not grant you any rights to our trademarks, logos, or branding.
              </p>
            </div>

            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Third-Party Content</h3>
              <p className="text-slate-600 dark:text-slate-300">
                Dataset metadata displayed in search results belongs to the respective data providers
                (Esri, Overture Maps Foundation, etc.). Links to original sources are provided for your convenience.
              </p>
            </div>

            <div className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Your Use</h3>
              <p className="text-slate-600 dark:text-slate-300">
                You may use search results for any lawful purpose. When accessing actual datasets from
                original sources, you must comply with their respective license terms.
              </p>
            </div>
          </div>
        </section>

        {/* 8. Privacy and Data Logging */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            8. Privacy and Data Logging
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-4">
            Your use of the Service is also governed by our{" "}
            <Link href="/privacy" className="text-teal dark:text-teal-light hover:text-coral transition-colors">Privacy Policy</Link> and{" "}
            <Link href="/cookies" className="text-teal dark:text-teal-light hover:text-coral transition-colors">Cookie Policy</Link>, which describe how we collect, use, and protect
            your information.
          </p>

          <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-3">Key Points</h3>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300 mb-6">
            {[
              'We do not require accounts or collect personal information',
              'Search queries are processed by third-party AI providers (opted out of model training)',
              'We collect anonymous usage data to improve the Service',
              'We do not sell data or use it for advertising',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-teal mt-1">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="p-6 bg-gray-100 dark:bg-slate-800/50 rounded-lg border border-gray-200 dark:border-slate-700">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">Search and Query Logging</h3>
            <p className="text-slate-600 dark:text-slate-300 mb-3">
              <strong className="text-gray-900 dark:text-white">By using Findria, you acknowledge that all search queries and Ask AI questions
              are logged.</strong> This is part of providing the Service for free. Logged data includes:
            </p>
            <ul className="space-y-1 text-slate-500 dark:text-slate-400 text-sm mb-3">
              {[
                'The text of your search queries and Ask AI questions',
                'Timestamps and session identifiers',
                'Search performance metrics',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              This data helps us understand what users are searching for and improve the Service. Search logs
              may be retained indefinitely. We do not collect personal information, and logged data cannot be
              used to identify individual users.
            </p>
          </div>
        </section>

        {/* 9. Third-Party Services */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            9. Third-Party Services
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-4">The Service integrates with third-party services:</p>

          <div className="space-y-3">
            {[
              { name: 'ArcGIS Online (Esri)', desc: 'Map display, data previews, and geocoding', url: 'https://www.esri.com/en-us/legal/terms/full-master-agreement', linkText: "Esri's Terms of Use" },
              { name: 'Overture Maps Foundation', desc: 'Open data', url: 'https://overturemaps.org/download/', linkText: 'ODbL and CDLA Permissive licenses' },
              { name: 'Anthropic Claude', desc: 'Query parsing', url: 'https://www.anthropic.com/legal/consumer-terms', linkText: "Anthropic's Terms of Service" },
              { name: 'OpenAI', desc: 'Embeddings', url: 'https://openai.com/policies/terms-of-use', linkText: "OpenAI's Terms of Use" },
              { name: 'Cloudflare', desc: 'CDN and security', url: 'https://www.cloudflare.com/website-terms/', linkText: "Cloudflare's Terms of Service" },
            ].map((service, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-slate-800/30 rounded-lg">
                <span className="text-teal mt-0.5">•</span>
                <div>
                  <span className="text-gray-900 dark:text-white font-medium">{service.name}</span>
                  <span className="text-slate-500 dark:text-slate-400"> — {service.desc}, governed by </span>
                  <a href={service.url} target="_blank" rel="noopener noreferrer" className="text-teal dark:text-teal-light hover:text-coral transition-colors">
                    {service.linkText}
                  </a>
                </div>
              </div>
            ))}
          </div>

          <p className="text-slate-500 dark:text-slate-400 text-sm mt-4">
            dymaptic does not endorse and is not affiliated with any third-party service provider beyond
            what is necessary to operate the Service. We are not responsible for the availability, accuracy,
            or policies of third-party services, nor are we liable for any loss or damage arising from
            third-party data, content, or services. We do not guarantee that any integration with a
            third-party service will be maintained indefinitely, and we reserve the right to disable or
            remove any integration at any time. These Terms govern your use of the Service
            even when accessed through or in connection with third-party integrations.
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-3">
            Use of the Service in violation of any third-party service&apos;s terms of use (e.g., Esri&apos;s
            Terms of Use) constitutes a violation of these Terms and may result in immediate termination
            of your access to the Service.
          </p>
        </section>

        {/* 10. Service Availability */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            10. Service Availability
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-4">
            We strive to maintain high availability but do not guarantee uninterrupted access. The Service
            may be temporarily unavailable due to:
          </p>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300 mb-4">
            {[
              'Scheduled maintenance (we will provide advance notice when possible)',
              'Unscheduled outages or technical issues',
              'Third-party service disruptions (ArcGIS, AI providers, hosting)',
              'Events beyond our reasonable control',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-slate-400 dark:text-slate-500 mt-1">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            As a free service, we do not offer service level agreements (SLAs) or uptime guarantees.
          </p>
        </section>

        {/* 11. Disclaimer of Warranties */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            11. Disclaimer of Warranties
          </h2>
          <div className="p-6 bg-gray-100 dark:bg-slate-800/50 rounded-lg border border-gray-200 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-300 mb-4 uppercase text-sm tracking-wide">
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind,
              either express or implied. To the fullest extent permitted by law, we disclaim all warranties,
              including but not limited to:
            </p>
            <ul className="space-y-2 text-slate-500 dark:text-slate-400 text-sm">
              {[
                'MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE',
                'ACCURACY, RELIABILITY, OR COMPLETENESS OF SEARCH RESULTS',
                'ACCURACY OR AVAILABILITY OF THIRD-PARTY DATA SOURCES',
                'NON-INFRINGEMENT OF THIRD-PARTY RIGHTS',
                'UNINTERRUPTED OR ERROR-FREE OPERATION',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 12. Limitation of Liability */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            12. Limitation of Liability
          </h2>
          <div className="p-6 bg-gray-100 dark:bg-slate-800/50 rounded-lg border border-gray-200 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-300 mb-4 uppercase text-sm tracking-wide">
              To the maximum extent permitted by law, dymaptic shall not be liable for any indirect, incidental,
              special, consequential, or punitive damages, including but not limited to:
            </p>
            <ul className="space-y-2 text-slate-500 dark:text-slate-400 text-sm mb-4">
              {[
                'LOSS OF PROFITS, DATA, OR BUSINESS OPPORTUNITIES',
                'RELIANCE ON INACCURATE OR INCOMPLETE SEARCH RESULTS',
                'DECISIONS MADE BASED ON DATA DISCOVERED THROUGH THE SERVICE',
                'UNAVAILABILITY OF THIRD-PARTY DATA SOURCES',
                'SERVICE INTERRUPTIONS OR ERRORS',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-slate-400 dark:text-slate-500 mt-1">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Since the Service is provided free of charge, our total liability for any claims arising
              from these Terms or your use of the Service shall not exceed <strong className="text-slate-600 dark:text-slate-300">one hundred US dollars ($100)</strong>.
            </p>
          </div>
        </section>

        {/* 13. Indemnification */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            13. Indemnification
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-4">
            You agree to indemnify and hold harmless dymaptic, its officers, employees, and agents from any
            claims, damages, losses, or expenses (including reasonable attorney&apos;s fees) arising from:
          </p>
          <ul className="space-y-2 text-slate-600 dark:text-slate-300 mb-4">
            {[
              'Your use of the Service',
              'Your violation of these Terms',
              'Your violation of any third-party rights',
              'Your misuse of data accessed through the Service',
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-teal mt-1">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Your defense or indemnification obligations will not apply to the extent the underlying
            allegation arises from dymaptic&apos;s fraud, willful misconduct, violations of law, or breach
            of these Terms.
          </p>
        </section>

        {/* 14. Termination */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            14. Termination
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
            We may suspend or restrict access to the Service at any time if you violate these Terms
            or engage in conduct that we determine, in our sole discretion, is harmful to the Service
            or other users.
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Since the Service does not require accounts, termination simply means blocking access.
            Provisions that by their nature should survive will remain in effect.
          </p>
        </section>

        {/* 15. Changes to Terms */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            15. Changes to Terms
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
            We may update these Terms from time to time. Changes will be posted on this page with an
            updated &ldquo;Last Updated&rdquo; date. Your continued use of the Service after changes take effect
            constitutes acceptance of the updated Terms.
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Since we don&apos;t collect email addresses, we cannot notify you directly of changes. We encourage
            you to review these Terms periodically.
          </p>
        </section>

        {/* 16. Governing Law */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            16. Governing Law
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
            These Terms are governed by the laws of the State of Oregon, United States, without regard
            to conflict of law principles. You consent to the exclusive jurisdiction and venue of the state
            and federal courts located in Portland, Oregon for any disputes arising from these Terms or your
            use of the Service. The parties expressly disclaim the application of the United Nations Convention
            on Contracts for the International Sale of Goods.
          </p>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            If you are a US federal, state, or local government entity, this governing law provision does not
            apply to the extent prohibited by applicable law.
          </p>
        </section>

        {/* 17. US Government Customers */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            17. US Government Customers
          </h2>
          <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
            If you are a US Government end user, the Service is a &ldquo;commercial item&rdquo; as defined
            in 48 C.F.R. &sect; 2.101, consisting of &ldquo;commercial computer software&rdquo; and
            &ldquo;commercial computer software documentation&rdquo; as those terms are used in 48 C.F.R.
            &sect; 12.212. In accordance with 48 C.F.R. &sect; 12.212 and 48 C.F.R. &sect;&sect; 227.7202-1
            through 227.7202-4, all US Government end users acquire the Service with only those rights set
            forth in these Terms.
          </p>
        </section>

        {/* 18. General Provisions */}
        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            18. General Provisions
          </h2>
          <div className="space-y-4">
            {[
              { term: 'Entire Agreement', desc: 'These Terms, together with our Privacy Policy and Cookie Policy, constitute the entire agreement between you and dymaptic regarding the Service.' },
              { term: 'Severability', desc: 'If any provision is found unenforceable, the remaining provisions remain in effect.' },
              { term: 'Waiver', desc: 'Our failure to enforce any right or provision does not constitute a waiver.' },
              { term: 'Assignment', desc: 'You may not assign these Terms without our consent. We may assign our rights and obligations without restriction.' },
              { term: 'Notices', desc: 'All notices under these Terms must be in writing. We may deliver notices electronically through the Service. Notices are effective upon delivery (for electronic notices) or upon receipt (for physical mail).' },
              { term: 'Amendment', desc: 'We may update these Terms by posting the revised version on the Service. Updates take effect 30 days after posting, except changes required by law, which may take effect immediately. No amendment applies retroactively. Any other amendment must be in writing and signed by both parties.' },
              { term: 'Force Majeure', desc: 'Dymaptic shall not be liable for delays or failures in performance resulting from causes beyond its reasonable control, including but not limited to acts of God, natural disasters, war, terrorism, labor disputes, government actions, internet or utility failures, or third-party service outages.' },
            ].map((item, i) => (
              <div key={i} className="pl-4 border-l-2 border-slate-300 dark:border-slate-600">
                <h3 className="text-gray-900 dark:text-white font-medium mb-1">{item.term}</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Contact Us */}
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-700">
            Contact Us
          </h2>
          <p className="text-slate-600 dark:text-slate-300 mb-2">Questions about these Terms?</p>
          <p className="text-slate-600 dark:text-slate-300">
            <strong className="text-gray-900 dark:text-white">Moravec Labs, LLC dba dymaptic</strong><br />
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
