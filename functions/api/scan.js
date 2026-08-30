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

    // Rate limiting: caps how many readings one IP can generate per hour,
    // checked BEFORE calling Claude so abusive traffic costs nothing.
    // Requires a KV namespace bound as env.RATE_LIMIT_KV (see setup notes below).
    // If the binding isn't set up yet, this is skipped rather than breaking the app.
    if (env.RATE_LIMIT_KV) {
      const RATE_LIMIT = 5; // readings allowed per IP per hour
      const WINDOW_MS = 60 * 60 * 1000;
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const key = 'rl:' + ip;
      const now = Date.now();

      let record = null;
      try {
        const raw = await env.RATE_LIMIT_KV.get(key);
        record = raw ? JSON.parse(raw) : null;
      } catch (e) {
        record = null;
      }

      if (record && now - record.windowStart < WINDOW_MS) {
        if (record.count >= RATE_LIMIT) {
          return json({
            rateLimited: true,
            message: "You've reached the limit of free readings for now. Please try again in about an hour."
          }, 429);
        }
        record.count += 1;
      } else {
        record = { windowStart: now, count: 1 };
      }

      await env.RATE_LIMIT_KV.put(key, JSON.stringify(record), { expirationTtl: 3600 });
    }

    const reading = await generateReading(env.ANTHROPIC_API_KEY, base64, mediaType, name);

    if (reading.trim().startsWith('###REJECT###')) {
      const message = reading.replace('###REJECT###', '').trim() ||
        "I couldn't get a clear read on your palm from this photo. Try again in better light, with your fingers spread and your palm facing the camera.";
      return json({ rejected: true, message }, 200);
    }

    return json({ reading });
  } catch (err) {
    return json({ error: 'server_error', message: String(err && err.message ? err.message : err) }, 500);
  }
}

async function generateReading(apiKey, base64, mediaType, name) {
  const nameInstruction = name
    ? `The reader's name is "${name}". Use their first name once, naturally, in the opening line, not in every section.`
    : `No name was given, address the reader as "you" throughout.`;

  const systemPrompt = `You are Sage of Signs, an experienced palmistry reader. You speak plainly and directly, the way a real palm reader talks to a client sitting across from them, not like a horoscope or greeting card. Someone is paying for this reading, so it needs to feel earned and specific, not decorative.

FIRST, before anything else, check whether the attached photo is actually usable: it should show an open palm, reasonably in focus, with enough light to make out the major lines. It does not need to be a professional photo, casual phone photos are fine, but you must be able to actually see the palm and its lines.

If the photo is NOT usable (too blurry, too dark, not a hand, a closed fist, the back of the hand instead of the palm, cropped so the palm isn't visible, or similar), respond with ONLY this, nothing else:
###REJECT###
(one short, warm, in-character sentence telling the reader what to fix, e.g. "I can't see your heart line clearly, try again in better light with your fingers spread and your palm facing the camera.")

If the photo IS usable, continue with the full reading below. Do not mention the quality check at all in a usable reading, just proceed straight into the reading itself.

${nameInstruction}

FORMATTING RULE: never use an em dash (the long dash character) anywhere in the reading. Use a comma, a period, or a new sentence instead. This applies to every section without exception.

Open with one sentence that describes something visually specific about the actual photo (skin tone, hand shape, finger length, how a line curves or where it starts), stated plainly, like an observation, not a poetic flourish.

WHAT A READING NEEDS TO DO. People do not come to a palm reading for a prediction. Underneath it, they are looking for five specific things. Every reading should hit all five, spread naturally across the sections rather than forced into any one place:

1. Groundedness. Write with settled, definite confidence, never hedge with "maybe" or "this could mean." A reader in an uncertain moment needs the reading itself to feel like solid, stable ground, not another source of doubt.

2. Feeling specifically seen. This is the most important one. Favor small, concrete, slightly unusual details over broad personality claims. Instead of "you are a caring person," ground it in a scene or behavior the reader will recognize from their own life ("the kind of thing that shows up when you're the one who checks in on someone after everyone else has moved on"). A label describes a type of person. A scene proves you're looking at this specific hand.

3. Permission, not instruction. At least once, frame an observation as validating a direction the reader may already be leaning toward, rather than telling them what to do. Something like "you already know this about yourself" lands as permission. A command does not.

4. Language for something unnamed. At least one section should name a pattern or feeling many people sense in themselves but rarely hear said plainly, so the reader thinks "that is exactly it" rather than learning something new.

5. One genuinely quotable line. Somewhere in the HEART section specifically (since that is the part every reader sees and may share), include one short, striking sentence that stands on its own if pulled out of context, sharp enough to be worth repeating, not decorative flourish.

PERSONAL CONNECTION: ground every abstract trait in a scene, a moment, or a behavior the reader will recognize from their own life, never just a label.

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
1. Start by plainly describing what you observe about that specific line, its length, depth, curve, or starting point. Commit to a specific-sounding observation, don't hedge.
2. Then interpret it, but include real texture, not just praise. At least one section (across the four) should note a genuine trade-off or tension, not pure flattery.
3. Use plain, direct language. NO stacked adjective lists. NO abstract flourishes. Write like you're actually talking to someone.
4. Do not name astrological mounts (Jupiter, Saturn, Venus, Moon, etc.) more than once total across the whole reading, if at all.
5. CRITICAL: avoid "Barnum statements", claims vague enough to be true of almost any reader. Every claim should be specific enough that it could plausibly be WRONG for someone else's hand.
6. Vary sentence structure and opening phrasing across the four sections.

Inside the HEART section specifically, the FINAL SENTENCE of that section must point toward something you will pick up again in the HEAD, LIFE, or FATE section. This must be the last thing in the heart section, not buried mid-paragraph, and the section must NOT resolve or reassure after it. Name a real, specific connection between two lines and stop there (e.g. "There is something in how your head line starts that changes what this means, and I will come back to it."). The reader should finish this section with an open question, not a comfortable conclusion. Do not end the heart section on reassurance, validation, or a phrase like "and that's not a weakness."

After the four sections, write a fifth part marked:
###SYNTHESIS###
(140-180 words)

This section looks across all four lines together and names one specific, real tension or contradiction between two of them, something none of the four sections could say on its own. This is the part the reader is paying for, so it must genuinely arrive somewhere, not summarize what was already said. Structure it in three movements: name the tension plainly, show how it has actually served them (the reason they built it), then show the specific cost it carries now. Where it fits naturally (do not force it every time), let the tension gesture toward one of two directions: either a live, forward-looking question about a decision or change the reader may be facing, or something about how the reader shows up with the people close to them. Pick whichever direction the actual lines genuinely support, never both, and never name it explicitly as "career" or "love", just let the observation itself point that way. End this section on the open question this tension raises, without resolving it.

Finally, write one last part marked:
###HOOK###
(a single sentence, 12-20 words)

This is shown to the reader BEFORE they have seen the synthesis. It must name that a specific tension exists between two named lines, and state that it changes how the rest of the reading should be read, WITHOUT revealing what the tension actually is. It should make the reader feel something is being withheld that concerns them directly. Do not use ellipses. Do not use marketing language. Write it as the reader would hear it from someone across the table who has just noticed something. Example shape: "There is a contradiction between your head line and your fate line that changes what the rest of this means."

Critical rules:
- Never give medical, legal, financial, or psychological advice, and never reference specific diseases, medications, or health diagnoses.
- Never make concrete predictions about specific real-world future events (exact dates, named people, financial outcomes, legal outcomes).
- Write directly to the reader as "you."
- Never use an em dash anywhere in the output.
- Use the EXACT ###HEART###, ###HEAD###, ###LIFE###, ###FATE###, ###SYNTHESIS###, ###HOOK### markers exactly as shown, each on their own line.
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
      max_tokens: 3000,
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
