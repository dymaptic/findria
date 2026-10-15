import type { Metadata } from 'next';
import { Rubik } from 'next/font/google';
import Script from 'next/script';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ArcGisThemeManager } from '@/components/ArcGisThemeManager';
import './globals.css';

const rubik = Rubik({
  subsets: ['latin'],
  variable: '--font-rubik',
});

export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = process.env.BASE_URL || 'https://findria.dymaptic.ai';

  return {
    title: {
      default: 'Findria - Find GIS Data Fast',
      template: '%s | Findria',
    },
    description:
      'Discover public geospatial datasets across ArcGIS and Overture Maps with AI-powered semantic search.',
    keywords: [
      'GIS',
      'geospatial',
      'data discovery',
      'ArcGIS',
      'Overture Maps',
      'open data',
      'spatial data',
      'map data',
    ],
    authors: [{ name: 'dymaptic' }],
    creator: 'dymaptic',
    metadataBase: new URL(siteUrl),
    openGraph: {
      title: 'Findria - Find GIS Data Fast',
      description:
        'Discover public geospatial datasets across ArcGIS and Overture Maps with AI-powered semantic search.',
      url: siteUrl,
      siteName: 'Findria',
      locale: 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Findria - Find GIS Data Fast',
      description: 'AI-powered search for public GIS datasets',
    },
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
      ],
      apple: '/apple-touch-icon.png',
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read in the server component. Most pages are statically prerendered, so like
  // BASE_URL this is resolved when `next build` runs - set it in the build environment.
  const plausibleScriptUrl = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL?.trim() || null;

  return (
    <html lang="en" className={rubik.variable} suppressHydrationWarning>
      <head>
        {/* ArcGIS CSS - default dark theme, dynamically switched by ArcGisThemeManager */}
        <link
          id="arcgis-theme-css"
          rel="stylesheet"
          href="https://js.arcgis.com/4.31/esri/themes/dark/main.css"
        />
      </head>
      <body className="bg-white dark:bg-dark-bg text-gray-900 dark:text-gray-100 antialiased">
        <ThemeProvider>
          <ArcGisThemeManager />
          {children}
        </ThemeProvider>
        {/* ArcGIS JS - load from CDN (DO NOT npm install @arcgis/core) */}
        <Script
          src="https://js.arcgis.com/4.31/"
          strategy="beforeInteractive"
        />
        {/* Plausible Analytics (optional) - privacy-friendly, cookie-free.
            Rendered only when NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL is set. */}
        {plausibleScriptUrl && (
          <>
            <Script src={plausibleScriptUrl} strategy="afterInteractive" />
            <Script id="plausible-init" strategy="afterInteractive">
              {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
