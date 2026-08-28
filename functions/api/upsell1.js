// POST /api/upsell1
// "Your Next Chapter" — forward-looking reading, built on top of the reader's
// own original reading and synthesis, branched by what they say is on their mind.
//
// Expects JSON body: { readingText, topic, name }
//   readingText: the full original reading text (all sections + synthesis),
//                as returned by /api/scan. Used as grounding context, not
//                re-analyzed from the photo, to keep this cheap and fast.
//   topic: one of 'relationship' | 'career' | 'stuck' | 'fresh_start'
//   name: optional first name
//
// Requires: env.ANTHROPIC_API_KEY

const TOPIC_ANGLES = {
  relationship: `The reader chose "a relationship." Build this around how they actually show up with someone close to them right now, not generic dating advice. Ground it in a real dynamic: what they give easily, what they withhold, where the friction usually starts. Avoid therapy language.`,
  career: `The reader chose "work or a decision." Build this around a choice or direction they're weighing, using the fate and head line material as the anchor. Do not invent specifics they didn't give you (no company names, job titles, or concrete predictions). Speak to the shape of the decision, not the content of it.`,
  stuck: `The reader chose "feeling stuck." Build this around the gap between what their hand shows they're capable of and what's actually happening right now. Name the stuck feeling plainly, the way a good friend would, not with self-help language.`,
  fresh_start: `The reader chose "a fresh start." Build this around what changing and what's carrying over, since a real fresh start rarely means starting from zero. Ground it in something from their life line or fate line about how they've handled change before.`
};

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const readingText = typeof body.readingText === 'string' ? body.readingText.slice(0, 6000) : '';
    const topic = TOPIC_ANGLES[body.topic] ? body.topic : 'stuck';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';

    if (!readingText) {
      return json({ error: 'missing_reading' }, 400);
    }

    const upsell = await generateUpsell1(env.ANTHROPIC_API_KEY, readingText, topic, name);
    return json({ upsell });
  } catch (err) {
    return json({ error: 'server_error', message: String(err && err.message ? err.message : err) }, 500);
  }
}

async function generateUpsell1(apiKey, readingText, topic, name) {
  const nameInstruction = name
    ? `The reader's name is "${name}". Use it once, naturally, if it fits, not required.`
    : `No name was given, address the reader as "you."`;

  const systemPrompt = `You are Sage of Signs, the same palm reader who already gave this person their original reading below. They paid again for a deeper, forward-looking piece called "Your Next Chapter." This is NOT a repeat of the original reading, it answers a different question: not who they are, but what to do with that, right now.

${nameInstruction}

THEIR ORIGINAL READING (use this as grounding, reference it specifically, do not repeat it):
"""
${readingText}
"""

TOPIC ANGLE FOR THIS PIECE:
${TOPIC_ANGLES[topic]}

FORMATTING RULE: never use an em dash anywhere in the output. Use a comma, a period, or a new sentence instead.

STRUCTURE, use these exact markers, each on its own line:

###OPENING###
(40-60 words. Pick the specific tension named in their original synthesis back up directly, do not summarize the whole original reading, reference the one specific thing it named.)

###DEEPER###
(120-160 words. This is the core of the piece. Go somewhere the original reading didn't go, using the topic angle above. Ground it in a specific line or detail already mentioned in their original reading, don't introduce a new line reading from scratch.)

###ONETHING###
(30-50 words. One small, concrete, safe thing to sit with or notice this week. Not medical, legal, or financial advice. Not a command. Frame it as an invitation, not an instruction. End on this, no further wrap-up after it.)

Requirements, same standards as the original reading:
- Groundedness: write with settled, definite confidence, never hedge.
- Every claim specific enough it could plausibly be wrong for someone else, no Barnum statements.
- No stacked adjectives, no abstract flourishes, no astrology-mount name-dropping.
- Never make concrete predictions about specific real-world future events (dates, named people, financial or legal outcomes).
- Never use an em dash anywhere in the output.
- Use the EXACT ###OPENING###, ###DEEPER###, ###ONETHING### markers exactly as shown.
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
      max_tokens: 900,
      temperature: 0.9,
      messages: [
        { role: 'user', content: systemPrompt + '\n\nWrite my Next Chapter reading now.' }
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
  return text ? text.trim() : 'Your Next Chapter could not be generated right now. Please try again.';
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
