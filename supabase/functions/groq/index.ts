const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) {
    return json({ error: { message: 'GROQ_API_KEY não configurado no servidor.' } }, 500);
  }

  try {
    const { messages, temperature, max_tokens } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: { message: 'Campo "messages" é obrigatório.' } }, 400);
    }

    // O modelo é "reasoning" (gasta tokens pensando antes de responder):
    // acrescentamos orçamento de raciocínio ao limite desejado pelo cliente.
    const desired = typeof max_tokens === 'number' && max_tokens > 0 ? max_tokens : 1024;
    const effectiveMaxTokens = Math.max(desired + 1024, 2048);

    const response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: typeof temperature === 'number' ? temperature : 0.2,
        max_tokens: effectiveMaxTokens,
        messages,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      return json(payload, response.status);
    }

    const content = String(payload?.choices?.[0]?.message?.content ?? '').trim();
    if (!content) {
      return json({ error: { message: 'A Groq não retornou conteúdo.' } }, 502);
    }

    return json({ content });
  } catch (error) {
    return json({ error: { message: error instanceof Error ? error.message : 'Erro ao processar a solicitação.' } }, 500);
  }
});