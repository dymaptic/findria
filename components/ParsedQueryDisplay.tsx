'use client';

import type { ParsedQuery } from '@/types';
import { Badge } from './ui/Badge';

interface ParsedQueryDisplayProps {
  query: ParsedQuery;
}

export function ParsedQueryDisplay({ query }: ParsedQueryDisplayProps) {
  if (!query.topics.length && !query.location) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-500 dark:text-slate-400">Searching for:</span>

      {query.topics.map((topic, index) => (
        <Badge key={index} variant="teal">
          {topic}
        </Badge>
      ))}

      {query.location && (
        <>
          <span className="text-slate-500 dark:text-slate-400">in</span>
          <Badge variant="coral">{query.location}</Badge>
        </>
      )}

      {query.dataTypes.length > 0 && (
        <>
          <span className="text-slate-500 dark:text-slate-400">type:</span>
          {query.dataTypes.map((type, index) => (
            <Badge key={index} variant="gray">
              {type}
            </Badge>
          ))}
        </>
      )}
    </div>
  );
}
