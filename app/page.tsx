import { Metadata } from 'next';
import { SearchContainer } from '@/components/SearchContainer';

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const query = params.q;

  if (query) {
    return {
      title: `Search: ${query} | Findria`,
      description: `Search results for "${query}" - find GIS datasets across ArcGIS and Overture Maps`,
      openGraph: {
        title: `Search: ${query} | Findria`,
        description: `GIS data search results for "${query}"`,
      },
    };
  }

  return {};
}

export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams;
  const initialQuery = params.q || '';

  return (
    <main className="min-h-screen flex flex-col">
      <SearchContainer initialQuery={initialQuery} />
    </main>
  );
}
