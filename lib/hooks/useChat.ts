'use client';

import { useState, useCallback, useRef } from 'react';
import type { ChatMessage, ChatStep, ContentBlock, StreamEvent, MapAction, UIAction, SourceDataset } from '@/types/chat';

interface UseChatOptions {
  onMapAction?: (action: MapAction) => void;
  onUIAction?: (action: UIAction) => void;
  mapScale?: number;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  conversationId: string | null;
  sendMessage: (question: string) => Promise<void>;
  clearMessages: () => void;
  stopStreaming: () => void;
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (question: string) => {
      if (isStreaming) return;

      setIsStreaming(true);
      setError(null);

      // Add user message
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: question,
        timestamp: Date.now(),
      };

      // Create placeholder for assistant message
      const assistantMessageId = crypto.randomUUID();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        contentBlocks: [],
        steps: [], // Keep for backwards compat
        actions: [],
        timestamp: Date.now(),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            question,
            conversationId,
            mapScale: options.mapScale,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Chat failed' }));
          throw new Error(errorData.error || 'Chat failed');
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        // Read the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines (NDJSON format)
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const event: StreamEvent = JSON.parse(line);

              // Fire side effects OUTSIDE the state updater to avoid
              // double-execution in React Strict Mode
              if (event.type === 'map_action') {
                options.onMapAction?.(event.action);
              } else if (event.type === 'ui_action') {
                options.onUIAction?.(event.action);
              }

              setMessages((prev) => {
                const updated = [...prev];
                const lastIndex = updated.length - 1;
                const lastMessage = updated[lastIndex];

                if (lastMessage.id !== assistantMessageId) return prev;

                const newMessage = { ...lastMessage };
                const contentBlocks = [...(newMessage.contentBlocks || [])] as ContentBlock[];
                const steps = [...(newMessage.steps || [])];
                const actions = [...(newMessage.actions || [])];

                switch (event.type) {
                  case 'tool_call': {
                    const toolStep: ChatStep = {
                      id: event.id,
                      type: 'tool_call',
                      tool: event.tool,
                      input: event.input,
                      timestamp: Date.now(),
                    };
                    steps.push(toolStep);
                    // Add as content block for interleaved rendering
                    contentBlocks.push({ type: 'tool_call', step: toolStep });
                    break;
                  }

                  case 'tool_result': {
                    // Find and update the corresponding tool call step
                    const toolCallIndex = steps.findIndex(
                      (s) => s.id === event.id && s.type === 'tool_call'
                    );
                    if (toolCallIndex >= 0) {
                      const updatedStep = {
                        ...steps[toolCallIndex],
                        result: event.result,
                        error: event.error,
                      };
                      steps[toolCallIndex] = updatedStep;
                      // Also update in contentBlocks
                      const blockIndex = contentBlocks.findIndex(
                        (b) => b.type === 'tool_call' && b.step.id === event.id
                      );
                      if (blockIndex >= 0) {
                        contentBlocks[blockIndex] = { type: 'tool_call', step: updatedStep };
                      }
                    } else {
                      // Add as separate step if tool call not found
                      steps.push({
                        id: event.id,
                        type: 'tool_result',
                        tool: event.tool,
                        result: event.result,
                        error: event.error,
                        timestamp: Date.now(),
                      });
                    }
                    break;
                  }

                  case 'text': {
                    // Append to content for backwards compat
                    newMessage.content += event.content;
                    // For contentBlocks: append to last text block or create new one
                    const lastBlock = contentBlocks[contentBlocks.length - 1];
                    if (lastBlock && lastBlock.type === 'text') {
                      contentBlocks[contentBlocks.length - 1] = {
                        type: 'text',
                        content: lastBlock.content + event.content,
                      };
                    } else {
                      contentBlocks.push({ type: 'text', content: event.content });
                    }
                    break;
                  }

                  case 'map_action':
                    actions.push(event.action);
                    break;

                  case 'ui_action':
                    actions.push(event.action);
                    break;

                  case 'sources':
                    // Add sources as a content block at the end
                    contentBlocks.push({ type: 'sources', datasets: event.datasets });
                    break;

                  case 'done':
                    setConversationId(event.conversationId);
                    newMessage.isStreaming = false;
                    break;

                  case 'error':
                    setError(event.message);
                    newMessage.isStreaming = false;
                    break;
                }

                newMessage.contentBlocks = contentBlocks;
                newMessage.steps = steps;
                newMessage.actions = actions;
                updated[lastIndex] = newMessage;
                return updated;
              });
            } catch {
              // Invalid JSON line, skip
              console.warn('Invalid JSON in chat stream:', line);
            }
          }
        }

        // Mark streaming as complete
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex]?.id === assistantMessageId) {
            updated[lastIndex] = {
              ...updated[lastIndex],
              isStreaming: false,
            };
          }
          return updated;
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // User cancelled, mark message as incomplete
          setMessages((prev) => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            if (updated[lastIndex]?.id === assistantMessageId) {
              updated[lastIndex] = {
                ...updated[lastIndex],
                content: updated[lastIndex].content || '(Cancelled)',
                isStreaming: false,
              };
            }
            return updated;
          });
        } else {
          setError(err instanceof Error ? err.message : 'Chat failed');
          // Remove the placeholder assistant message on error
          setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId));
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [conversationId, isStreaming, options]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setConversationId(null);
  }, []);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    messages,
    isStreaming,
    error,
    conversationId,
    sendMessage,
    clearMessages,
    stopStreaming,
  };
}
