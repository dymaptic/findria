import { ImageResponse } from 'next/og';
import { queryOne } from '@/lib/db';

export const runtime = 'nodejs';
export const alt = 'Findria Chat';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '...';
}

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = await queryOne<{ question: string }>(
    `SELECT question FROM chat_conversations WHERE id = $1`,
    [id]
  );

  if (!row) {
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
          }}
        >
          <div style={{ fontSize: 56, fontWeight: 700, color: '#FFFFFF' }}>Findria</div>
          <div style={{ fontSize: 24, color: '#A7A7A7', marginTop: 16 }}>Find GIS Data Fast</div>
        </div>
      ),
      { ...size }
    );
  }

  const question = truncate(row.question, 200);
  const fontSize = question.length > 100 ? 28 : question.length > 60 ? 34 : 40;

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
          padding: 48,
        }}
      >
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
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: '#1D809F',
            letterSpacing: 2,
            marginBottom: 24,
          }}
        >
          ASKED ALEXANDRIA
        </div>
        <div
          style={{
            fontSize,
            fontWeight: 600,
            color: '#FFFFFF',
            textAlign: 'center',
            lineHeight: 1.4,
            maxWidth: 900,
          }}
        >
          {`\u201C${question}\u201D`}
        </div>
        <div
          style={{
            width: 80,
            height: 4,
            borderRadius: 2,
            background: 'linear-gradient(to right, #E24E42, #1D809F)',
            marginTop: 32,
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700, color: '#FFFFFF' }}>Findria</div>
          <div style={{ fontSize: 16, color: '#666666' }}>by dymaptic</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
