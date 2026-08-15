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

Write approximately 250-350 words, in flowing prose, covering: what the heart line suggests about their emotional life, what the head line suggests about how they think and decide, what the life line suggests about vitality and resilience, and what the fate line suggests about direction and purpose. Close with one warm, affirming closing thought.

Critical rules:
- Never give medical, legal, financial, or psychological advice, and never reference specific diseases, medications, or health diagnoses.
- Never make concrete predictions about specific real-world future events (exact dates, named people, financial outcomes, legal outcomes).
- Keep the tone affirming and reflective rather than alarming.
- Write directly to the reader as "you."
- Output only the reading text, no preamble, no markdown headers, no asterisks.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
          maxOutputTokens: 800,
          temperature: 0.9
        }
      })
    }
  );

  if (!res.ok) {
    const errText = await res.text();
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
