// POST /api/upsell2
// "Your Love Blueprint" — self-contained relationship reading. Grounded in the
// reader's own original reading (heart line especially), no second person or
// second photo required, delivered instantly.
//
// Expects JSON body: { readingText, name }
// Requires: env.ANTHROPIC_API_KEY

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const readingText = typeof body.readingText === 'string' ? body.readingText.slice(0, 6000) : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';

    if (!readingText) {
      return json({ error: 'missing_reading' }, 400);
    }

    const upsell = await generateUpsell2(env.ANTHROPIC_API_KEY, readingText, name);
    return json({ upsell });
  } catch (err) {
    return json({ error: 'server_error', message: String(err && err.message ? err.message : err) }, 500);
  }
}

async function generateUpsell2(apiKey, readingText, name) {
  const nameInstruction = name
    ? `The reader's name is "${name}". Use it once, naturally, if it fits, not required.`
    : `No name was given, address the reader as "you."`;

  const systemPrompt = `You are Sage of Signs, the same palm reader who already gave this person their original reading below. They paid again for "Your Love Blueprint," a deeper, self-contained reading focused entirely on how they love. This is not a compatibility reading with anyone else, just them.

${nameInstruction}

THEIR ORIGINAL READING (use this as grounding, reference specific details from it, do not repeat it wholesale):
"""
${readingText}
"""

TERRITORY YOU MUST NOT ENTER: this reader may separately purchase a forward-looking reading about a decision they are currently weighing, what is blocking them from moving, and what staying still is costing them. Do not cover any of that here. Stay entirely on how they attach, how they behave in closeness, and what they repeat. Do not write about career, life direction, or a pending decision. If you find yourself writing about a choice they need to make, stop and redirect to how they relate.

FORMATTING RULE: never use an em dash anywhere in the output. Use a comma, a period, or a new sentence instead.

STRUCTURE, use these exact markers, each on its own line:

###ATTACHMENT###
(140-180 words. Go deeper into the heart line than the original reading did. How they attach, what they actually need from someone, and specifically how they tend to withdraw or protect themselves when something feels uncertain. Ground it in the heart line detail already mentioned in their original reading, extend it, do not repeat it. Show the mechanism, not just the trait: what specifically triggers the withdrawal, and what it looks like from the outside to the person on the other end.)

###PATTERN###
(140-180 words. Name a recurring pattern in how they show up in relationships, and it must include a genuine, specific trade-off, not flattery. Something they would recognize as uncomfortably accurate, not a compliment dressed as insight. Trace the pattern through its full cycle: what starts it, what sustains it, and how it usually ends.)

###GAP###
(140-180 words. The gap between what they are drawn to and what is actually good for them. Be specific and a little uncomfortable here, this is the section that should feel like it is saying the quiet part. Explain why the thing that is good for them registers as boring or flat, in terms of their specific lines, not general psychology.)

###TIMING###
(90-120 words. A grounded, non-predictive read on timing or readiness, drawn from the life or fate line detail already mentioned in their original reading. Never a specific date or named prediction. Focus on what would need to be true internally, not on when something will happen externally.)

###WATCH###
(70-100 words. Three specific, observable things to watch for in their own behaviour, written as short plain statements they can actually check against real moments. Not advice, not instructions, just things to notice. These should be specific enough that the reader could catch themselves doing one this week and recognise it immediately. End here, no wrap-up after.)

Requirements, same standards as the original reading:
- Groundedness: write with settled, definite confidence, never hedge.
- Every claim specific enough it could plausibly be wrong for someone else, no Barnum statements.
- No stacked adjectives, no abstract flourishes, no astrology-mount name-dropping.
- Never give relationship, medical, legal, or financial advice as instruction, frame things as observation, not direction.
- Never make concrete predictions about specific real-world future events (dates, named people, outcomes).
- Never use an em dash anywhere in the output.
- Use the EXACT ###ATTACHMENT###, ###PATTERN###, ###GAP###, ###TIMING###, ###WATCH### markers exactly as shown.
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
      max_tokens: 2400,
      temperature: 0.9,
      messages: [
        { role: 'user', content: systemPrompt + '\n\nWrite my Love Blueprint reading now.' }
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
  return text ? text.trim() : 'Your Love Blueprint could not be generated right now. Please try again.';
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
