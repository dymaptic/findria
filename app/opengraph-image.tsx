import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Findria - Find GIS Data Fast';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1A1A1A',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Gradient accent bar at top */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            background: 'linear-gradient(to right, #E24E42, #1D809F)',
          }}
        />

        {/* Main content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 24,
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              color: '#FFFFFF',
              letterSpacing: -1,
            }}
          >
            Findria
          </div>

          {/* Subtitle */}
          <div
            style={{
              fontSize: 32,
              color: '#A7A7A7',
              fontWeight: 400,
            }}
          >
            Find GIS Data Fast
          </div>

          {/* Decorative divider */}
          <div
            style={{
              width: 120,
              height: 4,
              borderRadius: 2,
              background: 'linear-gradient(to right, #E24E42, #1D809F)',
              marginTop: 8,
              marginBottom: 8,
            }}
          />

          {/* Description */}
          <div
            style={{
              fontSize: 20,
              color: '#888888',
              textAlign: 'center',
              maxWidth: 700,
              lineHeight: 1.5,
            }}
          >
            AI-powered semantic search across ArcGIS and Overture Maps datasets
          </div>
        </div>

        {/* Bottom branding */}
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 18,
            color: '#666666',
          }}
        >
          by dymaptic
        </div>
      </div>
    ),
    { ...size }
  );
}
