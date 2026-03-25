import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.28.0';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { messages, systemPrompt, temperature = 0.7, max_tokens = 2000 } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: 'Messages array is required' }, { status: 400 });
    }

    const chatMessages = [
      {
        role: "system",
        content: systemPrompt || "You are a helpful clinical assistant for home health nurses."
      },
      ...messages
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: chatMessages,
      temperature,
      max_tokens
    });

    return Response.json({
      success: true,
      message: completion.choices[0].message.content,
      usage: completion.usage
    });

  } catch (error) {
    console.error('ChatGPT error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});