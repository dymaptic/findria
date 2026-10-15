'use client';

import { useTheme } from 'next-themes';
import { useEffect } from 'react';

const ARCGIS_CSS_ID = 'arcgis-theme-css';

export function ArcGisThemeManager() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const themePath = resolvedTheme === 'light' ? 'light' : 'dark';
    const href = `https://js.arcgis.com/4.31/esri/themes/${themePath}/main.css`;

    let link = document.getElementById(ARCGIS_CSS_ID) as HTMLLinkElement | null;
    if (link) {
      if (link.href !== href) {
        link.href = href;
      }
    } else {
      link = document.createElement('link');
      link.id = ARCGIS_CSS_ID;
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    }
  }, [resolvedTheme]);

  return null;
}
