import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

interface ChatConversation {
  id: string;
  question: string;
  messages: string;
  sources: string | null;
  created_at: string;
}

// GET - Retrieve a shared conversation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const conversation = await queryOne<ChatConversation>(
      `SELECT id, question, messages, sources, created_at
       FROM chat_conversations
       WHERE id = $1`,
      [id]
    );

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: conversation.id,
      question: conversation.question,
      messages: typeof conversation.messages === 'string'
        ? JSON.parse(conversation.messages)
        : conversation.messages,
      sources: conversation.sources
        ? (typeof conversation.sources === 'string'
            ? JSON.parse(conversation.sources)
            : conversation.sources)
        : null,
      createdAt: conversation.created_at,
    });
  } catch (error) {
    console.error('Error retrieving shared conversation:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve conversation' },
      { status: 500 }
    );
  }
}
