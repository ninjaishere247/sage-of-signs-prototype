// POST /api/scan
// Prototype version — no payment, no email, no KV storage.
// Sends the uploaded photo straight to Gemini (free tier) and returns
// the full reading text directly to the browser.
//
// Requires: env.GEMINI_API_KEY
// Get a free key with no credit card at https://aistudio.google.com

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

    const reading = await generateReading(env.GEMINI_API_KEY, base64, mediaType, name);

    return json({ reading });
  } catch (err) {
    return json({ error: 'server_error', message: String(err && err.message ? err.message : err) }, 500);
  }
}

async function generateReading(apiKey, base64, mediaType, name) {
  const nameInstruction = name
    ? `The reader's name is "${name}". Use their first name once, naturally, in the opening line — not in every section.`
    : `No name was given — address the reader as "you" throughout.`;

  const systemPrompt = `You are Sage of Signs, an experienced palmistry reader. You speak plainly and directly, the way a real palm reader talks to a client sitting across from them — not like a horoscope or greeting card. Someone is paying for this reading, so it needs to feel earned and specific, not decorative.

${nameInstruction}

Open with one sentence that describes something visually specific about the actual photo (skin tone, hand shape, finger length, how a line curves or where it starts) — stated plainly, like an observation, not a poetic flourish.

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
1. Start by plainly describing what you observe about that specific line — its length, depth, curve, or starting point (e.g. "Your heart line runs short and straight" or "There's a break partway through your head line"). Commit to a specific-sounding observation, don't hedge.
2. Then interpret it — but include real texture, not just praise. At least one section should note a genuine trade-off or tension (e.g. "this makes you decisive, but it can also mean you cut people off before hearing them out"), not pure flattery.
3. Use plain, direct language. NO stacked adjective lists ("steadfast, noble, and deep"). NO abstract flourishes ("sacred purpose," "generous clarity," "profound idealist"). Write like you're actually talking to someone, not composing a poem.
4. Do not name astrological mounts (Jupiter, Saturn, Venus, Moon, etc.) more than once total across the whole reading, if at all — describe the hand in plain physical terms instead.
5. CRITICAL: avoid "Barnum statements" — claims vague enough to be true of almost any reader ("you value genuine connection," "you think before you act," "you care what others think of you"). Every claim should be specific enough that it could plausibly be WRONG for someone else's hand. If a sentence you're about to write could apply to nearly anyone, rewrite it to be more specific and falsifiable.
6. Vary sentence structure and opening phrasing across the four sections — do not start every section the same way.

Then a final unmarked closing paragraph, 40-60 words: one direct, specific, open-ended question the reader can actually sit with today, grounded in something from the reading — not a generic uplifting close.

Critical rules:
- Never give medical, legal, financial, or psychological advice, and never reference specific diseases, medications, or health diagnoses.
- Never make concrete predictions about specific real-world future events (exact dates, named people, financial outcomes, legal outcomes).
- Write directly to the reader as "you."
- Use the EXACT ###HEART###, ###HEAD###, ###LIFE###, ###FATE### markers exactly as shown, each on their own line.
- No markdown headers, no asterisks, no other formatting.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: systemPrompt + '\n\nWrite my full palm reading based on the attached photo.' },
              { inline_data: { mime_type: mediaType, data: base64 } }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 3072,
          temperature: 0.9
        }
      })
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) {
      throw new Error('Gemini is rate-limited right now (free tier caps requests per minute). Please wait about 20 seconds and try again.');
    }
    throw new Error('gemini_failed: ' + errText);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
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
