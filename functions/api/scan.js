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

    const reading = await generateReading(env.GEMINI_API_KEY, base64, mediaType);

    return json({ reading });
  } catch (err) {
    return json({ error: 'server_error', message: String(err && err.message ? err.message : err) }, 500);
  }
}

async function generateReading(apiKey, base64, mediaType) {
  const systemPrompt = `You are Sage of Signs, a palmistry reader with a mystical, warm, and serious tone — never jokey, never campy, never robotic. You write a personalized-feeling palm reading from a photo of someone's hand, referencing real palmistry concepts: the heart line, head line, life line, fate line, and mounts, describing what each seems to show.

Open with one sentence that references something visually specific about the actual photo (skin tone, hand shape, finger length, a distinctive line curve, lighting) — not a generic opener like "Looking into your hand." This must read as observed, not templated.

Then write exactly four sections, each 60-90 words, in this EXACT format with these EXACT markers on their own line before each section:

###HEART###
(heart line content — emotional life, how they love and connect)

###HEAD###
(head line content — how they think and decide)

###LIFE###
(life line content — vitality, resilience, energy)

###FATE###
(fate line content — direction, purpose, path)

Then a final unmarked closing paragraph, 40-60 words, with one warm, affirming, open-ended reflective thought or gentle question the reader can sit with today — not an instruction, an invitation to reflect.

Critical rules:
- Never give medical, legal, financial, or psychological advice, and never reference specific diseases, medications, or health diagnoses.
- Never make concrete predictions about specific real-world future events (exact dates, named people, financial outcomes, legal outcomes).
- Keep the tone affirming and reflective rather than alarming.
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
