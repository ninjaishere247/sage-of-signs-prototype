// POST /api/scan
// Final product version — calls Claude (Haiku) instead of Gemini.
// Returns: opening observation, four line sections (with a cross-reference
// line inside the heart section), and a synthesis section naming a tension
// across the four lines. No payment/email here — that's wired in later.
//
// Requires: env.ANTHROPIC_API_KEY

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const formData = await request.formData();
    const photo = formData.get('photo');
    const nameField = formData.get('name');
    const name = nameField && typeof nameField === 'string' ? nameField.trim().slice(0, 40) : '';

    if (!photo || typeof photo === 'string') {
      return json({ error: 'missing_photo' }, 400);
    }

    const MAX_BYTES = 12 * 1024 * 1024;
    if (photo.size > MAX_BYTES) {
      return json({ error: 'photo_too_large' }, 400);
    }

    const arrayBuffer = await photo.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const mediaType = photo.type || 'image/jpeg';

    const reading = await generateReading(env.ANTHROPIC_API_KEY, base64, mediaType, name);
    return json({ reading });
  } catch (err) {
    return json({ error: 'server_error', message: String(err && err.message ? err.message : err) }, 500);
  }
}

async function generateReading(apiKey, base64, mediaType, name) {
  const nameInstruction = name
    ? `The reader's name is "${name}". Use their first name once, naturally, in the opening line — not in every section.`
    : `No name was given — address the reader as "you" throughout.`;

  const systemPrompt = `You are Sage of Signs, an experienced palmistry reader. You speak plainly and directly, the way a real palm reader talks to a client sitting across from them, not like a horoscope or greeting card. Someone is paying for this reading, so it needs to feel earned and specific, not decorative.

${nameInstruction}

FORMATTING RULE: never use an em dash (the long dash character, —) anywhere in the reading. Use a comma, a period, or a new sentence instead. This applies to every section without exception.

Open with one sentence that describes something visually specific about the actual photo (skin tone, hand shape, finger length, how a line curves or where it starts), stated plainly, like an observation, not a poetic flourish.

PERSONAL CONNECTION: the single most important thing this reading has to do is make the reader feel specifically seen, not generally described. Favor small, concrete, slightly unusual details over broad personality claims. Instead of "you are a caring person," notice something like the exact way a line behaves and connect it to a specific, everyday moment ("this is the kind of thing that shows up when you're the one who remembers to check in on someone after everyone else has moved on"). Ground abstract traits in a scene, a moment, or a behavior the reader will recognize from their own life, not just a label.

Then write exactly four sections, each 60-100 words, in this EXACT format with these EXACT markers on their own line before each section:

###HEART###
(heart line)
###HEAD###
(head line)
###LIFE###
(life line)
###FATE###
(fate line)

For EACH section:
1. Start by plainly describing what you observe about that specific line — its length, depth, curve, or starting point. Commit to a specific-sounding observation, don't hedge.
2. Then interpret it — but include real texture, not just praise. At least one section (across the four) should note a genuine trade-off or tension, not pure flattery.
3. Use plain, direct language. NO stacked adjective lists. NO abstract flourishes. Write like you're actually talking to someone.
4. Do not name astrological mounts (Jupiter, Saturn, Venus, Moon, etc.) more than once total across the whole reading, if at all.
5. CRITICAL: avoid "Barnum statements" — claims vague enough to be true of almost any reader. Every claim should be specific enough that it could plausibly be WRONG for someone else's hand.
6. Vary sentence structure and opening phrasing across the four sections.

Inside the HEART section specifically, include one sentence that plainly points toward something you'll pick up again in the HEAD, LIFE, or FATE section, a real, specific connection between the two lines (e.g. "this pairs with something in how your head line starts, which I'll come back to"). This should read as a genuine observation, not a teaser or sales line.

After the four sections, write a fifth part marked:
###SYNTHESIS###
(60-90 words)

This section looks across all four lines together and names one specific, real tension or contradiction between two of them, something none of the four sections could say on its own. It should feel like the reading arriving at something, not summarizing what was already said. Where it fits naturally (do not force it every time), let the tension gesture toward one of two directions: either a live, forward-looking question about a decision or change the reader may be facing, or something about how the reader shows up with the people close to them. Pick whichever direction the actual lines genuinely support, never both, and never name it explicitly as "career" or "love", just let the observation itself point that way. End this section on the open question this tension raises, without resolving it.

Critical rules:
- Never give medical, legal, financial, or psychological advice, and never reference specific diseases, medications, or health diagnoses.
- Never make concrete predictions about specific real-world future events (exact dates, named people, financial outcomes, legal outcomes).
- Write directly to the reader as "you."
- Never use an em dash anywhere in the output.
- Use the EXACT ###HEART###, ###HEAD###, ###LIFE###, ###FATE###, ###SYNTHESIS### markers exactly as shown, each on their own line.
- No markdown headers, no asterisks, no other formatting.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      temperature: 0.9,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: systemPrompt + '\n\nWrite my full palm reading based on the attached photo.' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64
              }
            }
          ]
        }
      ]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) {
      throw new Error('The reader is in high demand right now. Please wait about 20 seconds and try again.');
    }
    throw new Error('claude_failed: ' + errText);
  }

  const data = await res.json();
  const text = data?.content?.find(block => block.type === 'text')?.text;
  return text ? text.trim() : 'Your reading could not be generated right now. Please try again.';
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
