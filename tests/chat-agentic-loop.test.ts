/**
 * Tests for chat.service hardening:
 * - crypto-secure share/conversation IDs
 * - the agentic tool-use loop is capped at MAX_AGENTIC_ITERATIONS
 */

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

jest.mock('@/lib/db', () => ({
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/services/geoparquet.service', () => ({
  geoParquetService: {},
  GEOPARQUET_SOURCES: [],
}));
jest.mock('@/services/feature-query.service', () => ({ featureQueryService: {} }));
jest.mock('@/services/spatial-query.service', () => ({ spatialQueryService: {} }));

import { ChatService, generateShareId, MAX_AGENTIC_ITERATIONS } from '@/services/chat.service';
import { query } from '@/lib/db';
import type { StreamEvent } from '@/types/chat';

/** A streamed model turn that always asks for one more tool call. */
function toolUseTurn(n: number) {
  return (async function* () {
    yield { type: 'content_block_start', content_block: { type: 'tool_use', id: `tool_${n}`, name: 'noop_tool' } };
    yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } };
    yield { type: 'content_block_stop' };
    yield { type: 'message_delta', delta: { stop_reason: 'tool_use' } };
  })();
}

function finalTurn(text: string) {
  return (async function* () {
    yield { type: 'content_block_start', content_block: { type: 'text' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
    yield { type: 'content_block_stop' };
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
  })();
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe('generateShareId', () => {
  it('produces 16-char base64url IDs (96 bits)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateShareId()).toMatch(/^[A-Za-z0-9_-]{16}$/);
    }
  });

  it('fits in chat_conversations.id VARCHAR(36)', () => {
    expect(generateShareId().length).toBeLessThanOrEqual(36);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateShareId()));
    expect(ids.size).toBe(1000);
  });

  it('does not use Math.random', () => {
    const spy = jest.spyOn(Math, 'random');
    generateShareId();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('ChatService agentic loop cap', () => {
  let service: ChatService;
  let executeToolSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCreate.mockReset();
    (query as jest.Mock).mockClear();
    service = new ChatService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    executeToolSpy = jest.spyOn(service as any, 'executeTool').mockResolvedValue({ result: { ok: true } });
  });

  it(`stops after ${MAX_AGENTIC_ITERATIONS} model calls and tells the user`, async () => {
    let n = 0;
    mockCreate.mockImplementation(async () => toolUseTurn(n++));

    const events = await collect(service.streamResponse('loop forever'));

    expect(MAX_AGENTIC_ITERATIONS).toBe(25);
    expect(mockCreate).toHaveBeenCalledTimes(MAX_AGENTIC_ITERATIONS);
    expect(executeToolSpy).toHaveBeenCalledTimes(MAX_AGENTIC_ITERATIONS);

    const text = events.filter((e) => e.type === 'text').map((e) => (e as { content: string }).content).join('');
    expect(text).toMatch(/maximum number of tool steps/);

    const done = events.find((e) => e.type === 'done') as { conversationId: string } | undefined;
    expect(done).toBeDefined();
    expect(done!.conversationId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(events.some((e) => e.type === 'error')).toBe(false);

    // The notice is persisted with the conversation
    const insert = (query as jest.Mock).mock.calls.find((c) => String(c[0]).includes('INSERT INTO chat_conversations'));
    expect(insert).toBeDefined();
    expect(insert![1][0]).toBe(done!.conversationId);
    expect(insert![1][2]).toContain('maximum number of tool steps');
  });

  it('does not add the notice when the model finishes normally', async () => {
    mockCreate
      .mockImplementationOnce(async () => toolUseTurn(0))
      .mockImplementationOnce(async () => finalTurn('All done.'));

    const events = await collect(service.streamResponse('normal question'));

    expect(mockCreate).toHaveBeenCalledTimes(2);
    const text = events.filter((e) => e.type === 'text').map((e) => (e as { content: string }).content).join('');
    expect(text).toBe('All done.');
  });
});
