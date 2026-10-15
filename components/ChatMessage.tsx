'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType, ContentBlock, SourceDataset } from '@/types/chat';
import { ToolCallStep } from './ToolCallStep';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const contentBlocks = message.contentBlocks || [];
  const hasContentBlocks = contentBlocks.length > 0;

  // For user messages or messages without content blocks, use simple rendering
  if (isUser || !hasContentBlocks) {
    return (
      <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
        {/* Avatar for assistant */}
        {!isUser && <AssistantAvatar />}

        <div className={`max-w-[80%] ${isUser ? 'order-1' : ''}`}>
          <div
            className={`
              rounded-2xl px-4 py-2
              ${isUser
                ? 'bg-teal text-white rounded-tr-sm'
                : 'bg-gray-200/70 dark:bg-dark-bg-light text-gray-800 dark:text-gray-100 rounded-tl-sm'
              }
            `}
          >
            {/* Streaming indicator */}
            {message.isStreaming && !message.content && (
              <StreamingIndicator />
            )}

            {/* Message content */}
            {message.content && (
              <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </div>
            )}

            {/* Streaming cursor */}
            {message.isStreaming && message.content && (
              <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" />
            )}
          </div>
        </div>

        {/* Avatar for user */}
        {isUser && <UserAvatar />}
      </div>
    );
  }

  // For assistant messages with content blocks, render interleaved
  return (
    <div className="flex gap-3 justify-start">
      <AssistantAvatar />

      <div className="max-w-[80%] space-y-2">
        {/* Streaming indicator when no blocks yet */}
        {message.isStreaming && contentBlocks.length === 0 && (
          <div className="rounded-2xl px-4 py-2 bg-gray-200/70 dark:bg-dark-bg-light text-gray-800 dark:text-gray-100 rounded-tl-sm">
            <StreamingIndicator />
          </div>
        )}

        {/* Render content blocks in sequence */}
        {contentBlocks.map((block, index) => (
          <ContentBlockRenderer
            key={index}
            block={block}
            isLast={index === contentBlocks.length - 1}
            isStreaming={message.isStreaming}
          />
        ))}
      </div>
    </div>
  );
}

function ContentBlockRenderer({
  block,
  isLast,
  isStreaming,
}: {
  block: ContentBlock;
  isLast: boolean;
  isStreaming?: boolean;
}) {
  if (block.type === 'text') {
    return (
      <div className="rounded-2xl px-4 py-2 bg-gray-200/70 dark:bg-dark-bg-light text-gray-800 dark:text-gray-100 rounded-tl-sm">
        <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
        </div>
        {/* Streaming cursor on last text block */}
        {isLast && isStreaming && (
          <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-0.5" />
        )}
      </div>
    );
  }

  if (block.type === 'tool_call') {
    return <ToolCallStep step={block.step} />;
  }

  if (block.type === 'sources') {
    return <SourcesCard datasets={block.datasets} />;
  }

  return null;
}

function SourcesCard({ datasets }: { datasets: SourceDataset[] }) {
  if (datasets.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-dark-bg-light overflow-hidden shadow-sm">
      <div className="px-3 py-2 bg-gray-100 dark:bg-slate-700/50 border-b border-gray-300 dark:border-slate-600">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <svg className="w-4 h-4 text-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Data Sources
        </h4>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-slate-700">
        {datasets.map((dataset) => (
          <div key={dataset.id} className="px-3 py-2 hover:bg-gray-100 dark:hover:bg-slate-700/30 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <a
                  href={dataset.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-teal dark:text-teal-light hover:text-teal hover:underline font-medium truncate block"
                >
                  {dataset.name}
                </a>
                <span className={`
                  text-xs px-1.5 py-0.5 rounded mt-1 inline-block
                  ${dataset.source === 'geoparquet'
                    ? 'bg-teal/20 text-teal dark:text-teal-light'
                    : dataset.source === 'living_atlas'
                      ? 'bg-coral/20 text-coral'
                      : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}
                `}>
                  {dataset.source === 'geoparquet' ? 'Overture Maps' : dataset.orgDisplayName || 'ArcGIS'}
                </span>
              </div>
              <a
                href={dataset.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 p-1 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                title="Open source"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-teal flex items-center justify-center">
      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 dark:bg-dark-bg-light flex items-center justify-center order-2">
      <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    </div>
  );
}

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-sm text-gray-500 dark:text-gray-400">Thinking...</span>
    </div>
  );
}
