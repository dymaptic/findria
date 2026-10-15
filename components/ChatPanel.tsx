'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage } from './ChatMessage';
import { useChat } from '@/lib/hooks/useChat';
import type { MapAction, UIAction } from '@/types/chat';

interface ChatPanelProps {
  onMapAction?: (action: MapAction) => void;
  onUIAction?: (action: UIAction) => void;
  mapScale?: number;
}

export function ChatPanel({ onMapAction, onUIAction, mapScale }: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [hasAsked, setHasAsked] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    isStreaming,
    error,
    conversationId,
    sendMessage,
    clearMessages,
  } = useChat({
    onMapAction,
    onUIAction,
    mapScale,
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();

      const question = inputValue.trim();
      if (!question || isStreaming) return;

      setInputValue('');
      setHasAsked(true);
      await sendMessage(question);
    },
    [inputValue, isStreaming, sendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleReset = useCallback(() => {
    clearMessages();
    setHasAsked(false);
    setInputValue('');
    setLinkCopied(false);
    // Clear the map layers
    onMapAction?.({ type: 'clear_layers' });
    // Focus input after reset
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [clearMessages, onMapAction]);

  // Share functionality - conversation is already saved, just copy the link
  const [linkCopied, setLinkCopied] = useState(false);

  const handleShare = useCallback(async () => {
    if (!conversationId) return;

    const url = `${window.location.origin}/chat/${conversationId}`;

    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
    } catch (error) {
      console.error('Error copying link:', error);
    }
  }, [conversationId]);

  // Example questions
  const exampleQuestions = [
    'Find parks near Denver',
    'How many counties are in Oregon?',
    'Show me building footprints in Seattle',
    'What data is available for California?',
  ];

  // Before asking - show centered input
  if (!hasAsked) {
    return (
      <div className="flex flex-col h-full items-center justify-center px-4 md:px-8">
        <div className="w-full max-w-xl">
          {/* Icon and title */}
          <div className="text-center mb-6 md:mb-8">
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-gray-200 dark:bg-dark-bg-light flex items-center justify-center mb-3 md:mb-4 mx-auto">
              <svg className="w-6 h-6 md:w-8 md:h-8 text-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <h3 className="text-lg md:text-xl font-medium text-gray-900 dark:text-white mb-2">Ask Alexandria</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base">
              Ask a question about geospatial data. I&apos;ll search datasets, query features, and show results on the map.
            </p>
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="mb-4 md:mb-6">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What geospatial data are you looking for?"
              rows={2}
              className="
                w-full px-4 py-3 bg-white dark:bg-dark-bg-light text-gray-900 dark:text-white rounded-lg
                border border-gray-300 dark:border-slate-600 focus:border-teal focus:outline-none shadow-sm
                resize-none placeholder-gray-500
              "
            />
            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                disabled={!inputValue.trim()}
                className="
                  px-6 py-2 bg-teal text-white rounded-lg
                  hover:bg-teal-light transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center gap-2
                "
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
                Ask
              </button>
            </div>
          </form>

          {/* Example questions */}
          <div className="flex flex-wrap justify-center gap-2">
            {exampleQuestions.map((question) => (
              <button
                key={question}
                onClick={() => {
                  if (isStreaming) return;
                  setInputValue('');
                  setHasAsked(true);
                  sendMessage(question);
                }}
                className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-dark-bg-light text-gray-600 dark:text-gray-300 rounded-full border border-gray-300 dark:border-transparent hover:bg-gray-200 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // After asking - show messages with scrollable output
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with share and reset buttons */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-dark-bg-light flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
          {isStreaming ? 'Searching...' : 'Results'}
        </h3>
        <div className="flex items-center gap-3">
          {/* Share button */}
          {!isStreaming && conversationId && (
            <button
              onClick={handleShare}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-teal dark:hover:text-teal-light transition-colors flex items-center gap-1"
            >
              {linkCopied ? (
                <>
                  <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-green-400">Link copied!</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </>
              )}
            </button>
          )}
          <button
            onClick={handleReset}
            disabled={isStreaming}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-50"
          >
            New Question
          </button>
        </div>
      </div>

      {/* AI Disclaimer - EU AI Act compliance */}
      <div className="flex-shrink-0 px-4 py-2 bg-amber-100 dark:bg-amber-900/20 border-b border-amber-300 dark:border-amber-800/30">
        <p className="text-xs text-amber-800 dark:text-amber-200/80 flex items-center gap-2">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            <strong>AI-Generated Content:</strong> This response was generated by an AI assistant. Information may be incomplete or inaccurate. Always verify data from original sources before making decisions.
          </span>
        </p>
      </div>

      {/* Messages area - this is the only scrollable part */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="flex-shrink-0 px-4 py-2 bg-red-100 dark:bg-red-900/30 border-t border-red-300 dark:border-red-800">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}
