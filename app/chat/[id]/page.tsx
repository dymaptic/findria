import type { Metadata } from 'next';
import { queryOne } from '@/lib/db';
import { SharedChatView } from '@/components/SharedChatView';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;

  const row = await queryOne<{ question: string }>(
    `SELECT question FROM chat_conversations WHERE id = $1`,
    [id]
  );

  if (!row) {
    return {
      title: 'Conversation Not Found',
      description: 'This conversation may have been deleted or the link is invalid.',
    };
  }

  const question = row.question;
  const truncatedQuestion = question.length > 120 ? question.slice(0, 119) + '\u2026' : question;

  return {
    title: truncatedQuestion,
    description: `Asked Alexandria: "${truncatedQuestion}" - AI-powered geospatial data discovery`,
    openGraph: {
      title: truncatedQuestion,
      description: `Asked Alexandria: "${truncatedQuestion}"`,
      siteName: 'Findria',
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: truncatedQuestion,
      description: `Asked Alexandria: "${truncatedQuestion}"`,
    },
  };
}

export default async function SharedChatPage({ params }: PageProps) {
  const { id } = await params;
  return <SharedChatView id={id} />;
}
