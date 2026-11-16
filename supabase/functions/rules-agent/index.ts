// Rules agent: researches a game's current official rules on the web and
// files a rule_proposals row with cited sources for an admin to approve.
//
// Free by design: it uses the Gemini API free tier with Google Search
// grounding, and only runs if an admin sets the secret:
//   supabase secrets set GEMINI_API_KEY=...        (optional: GEMINI_MODEL)
//   supabase functions deploy rules-agent
// then ticks "AI rules agent" in league settings.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return json({ error: 'The AI rules agent is not set up. An admin needs to add a GEMINI_API_KEY secret.' })
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'

  // Act as the calling user so row level security still applies.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: isAdmin } = await supabase.rpc('is_admin')
  if (!isAdmin) return json({ error: 'Only admins can run the rules agent.' }, 403)

  const { game_id } = await req.json().catch(() => ({}))
  const { data: game } = await supabase.from('games').select('id, name, rules_summary, official_rules_url').eq('id', game_id).maybeSingle()
  if (!game) return json({ error: 'Game not found.' }, 404)

  const prompt = `You are researching the current official rules of the game "${game.name}".
Search for the publisher's official rulebook or rules page and any official FAQ or errata.
Write a clear rules summary for a group of friends (setup, turn structure, how to win, scoring, common edge cases),
under 400 words, in plain sentences. Note any recent official rule changes. Do not invent rules; if sources disagree, say so.
${game.official_rules_url ? `The group currently links to: ${game.official_rules_url}` : ''}`

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
  })
  if (!res.ok) {
    const detail = await res.text()
    const limited = res.status === 429
    return json({ error: limited ? 'Free AI quota used up for now. Try again later.' : `AI request failed (${res.status}).`, detail })
  }
  const out: any = await res.json()
  const cand = out.candidates?.[0]
  const text: string = (cand?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim()
  const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
    .map((c: any) => c.web)
    .filter((w: any) => w?.uri)
    .map((w: any) => ({ title: w.title ?? w.uri, url: w.uri }))
  if (!text) return json({ error: 'The AI returned no rules text.' })
  if (sources.length === 0) return json({ error: 'The AI could not find sources to cite, so no proposal was filed.' })

  const { data: me } = await supabase.auth.getUser()
  const { error } = await supabase.from('rule_proposals').insert({
    game_id: game.id,
    proposed_text: text,
    sources,
    origin: 'agent',
    proposed_by: me.user?.id,
  })
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, sources: sources.length })
})
