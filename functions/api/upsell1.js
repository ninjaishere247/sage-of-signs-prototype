// POST /api/upsell1
// "Your Next Chapter" — forward-looking reading, built on top of the reader's
// own original reading and synthesis, branched by what they say is on their mind.
//
// Expects JSON body: { readingText, topic, name }
// Requires: env.ANTHROPIC_API_KEY

const TOPIC_ANGLES = {
  relationship: `The reader chose "a relationship." Build this around a decision or a change they are weighing in how they relate to someone specific, not generic dating advice, and not their general attachment style. Focus on the choice in front of them and what is making it hard to move, not on describing how they love.`,
  career: `The reader chose "work or a decision." Build this around a choice or direction they are weighing, using the fate and head line material as the anchor. Do not invent specifics they didn't give you (no company names, job titles, or concrete predictions). Speak to the shape of the decision, not the content of it.`,
  stuck: `The reader chose "feeling stuck." Build this around the gap between what their hand shows they are capable of and what is actually happening right now. Name the stuck feeling plainly, the way a good friend would, not with self-help language.`,
  fresh_start: `The reader chose "a fresh start." Build this around what is changing and what is carrying over, since a real fresh start rarely means starting from zero. Ground it in something from their life line or fate line about how they have handled change before.`
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

  const systemPrompt = `You are Sage of Signs, the same palm reader who already gave this person their original reading below. They paid again for a deeper, forward-looking piece called "Your Next Chapter." This is NOT a repeat of the original reading. It answers a different question: not who they are, but what to do with that, right now.

${nameInstruction}

THEIR ORIGINAL READING (use this as grounding, reference it specifically, do not repeat it):
"""
${readingText}
"""

TOPIC ANGLE FOR THIS PIECE:
${TOPIC_ANGLES[topic]}

TERRITORY YOU MUST NOT ENTER: this reader may separately purchase a relationship-focused reading covering how they attach, their recurring patterns in relationships, what they are drawn to versus what is good for them, and their readiness for love. Do not cover any of that here. Even if they chose the relationship topic, stay on the decision in front of them and what is blocking movement, not on their attachment style or love patterns. If you find yourself writing about how they love, stop and redirect to what they are deciding.

FORMATTING RULE: never use an em dash anywhere in the output. Use a comma, a period, or a new sentence instead.

STRUCTURE, use these exact markers, each on its own line:

###OPENING###
(90-120 words. Pick the specific tension named in their original synthesis back up directly. Do not summarize the whole original reading, reference the one specific thing it named, and state plainly how that tension is showing up in what they are facing now.)

###DEEPER###
(200-260 words. This is the core of the piece. Go somewhere the original reading did not go, using the topic angle above. Ground it in specific lines already mentioned in their original reading, do not introduce new line readings from scratch. Show them the mechanism: not just what is happening, but why the specific shape of their hand produces this specific pattern. Include at least one reframe where something they think of as a weakness is actually a strength being misapplied, or the reverse.)

###COST###
(140-180 words. Name what staying exactly as they are will actually cost them, concretely and specifically. Not a threat, not fear-mongering, just an honest accounting of what the current pattern is quietly taking from them. This should be the most uncomfortable part of the piece and it should feel earned, not manipulative.)

###ONETHING###
(50-70 words. One small, concrete, safe thing to sit with or notice this week. Not medical, legal, or financial advice. Not a command. Frame it as an invitation, not an instruction. End on this, no further wrap-up after it.)

Requirements, same standards as the original reading:
- Groundedness: write with settled, definite confidence, never hedge.
- Every claim specific enough it could plausibly be wrong for someone else, no Barnum statements.
- No stacked adjectives, no abstract flourishes, no astrology-mount name-dropping.
- Never make concrete predictions about specific real-world future events (dates, named people, financial or legal outcomes).
- Never use an em dash anywhere in the output.
- Use the EXACT ###OPENING###, ###DEEPER###, ###COST###, ###ONETHING### markers exactly as shown.
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
      max_tokens: 2200,
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
