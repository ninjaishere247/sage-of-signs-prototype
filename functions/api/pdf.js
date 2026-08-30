// POST /api/pdf
// Generates a real, downloadable PDF containing whatever the reader currently
// owns. Regenerates and grows as they buy more, so a reader who owns the
// frontend and Upsell 1 gets a document containing exactly those two.
//
// Expects JSON body: { name, reading, upsell1, upsell2 }
//   Any of upsell1 / upsell2 may be omitted; the document adapts.
//
// Builds the PDF by hand (no external library) so it runs inside a Cloudflare
// Pages Function with no dependencies.

export async function onRequestPost(context) {
  const { request } = context;

  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 40) : '';
    const reading = typeof body.reading === 'string' ? body.reading : '';
    const upsell1 = typeof body.upsell1 === 'string' ? body.upsell1 : '';
    const upsell2 = typeof body.upsell2 === 'string' ? body.upsell2 : '';

    if (!reading) {
      return new Response(JSON.stringify({ error: 'missing_reading' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const pages = buildPages(name, reading, upsell1, upsell2);
    const pdf = renderPdf(pages);

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="sage-of-signs-reading.pdf"'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'server_error', message: String(err && err.message ? err.message : err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ---- Content assembly -------------------------------------------------------

function parseMarkers(text, keys) {
  const pattern = new RegExp('###(' + keys.join('|') + ')###', 'g');
  const parts = text.split(pattern);
  const map = {};
  const intro = (parts[0] || '').trim();
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i];
    if (key && !map[key]) map[key] = (parts[i + 1] || '').trim();
  }
  return { intro: intro, map: map };
}

function buildPages(name, reading, upsell1, upsell2) {
  const blocks = [];

  const r = parseMarkers(reading, ['HEART', 'HEAD', 'LIFE', 'FATE', 'SYNTHESIS', 'HOOK']);

  blocks.push({ type: 'title', text: 'Sage of Signs' });
  blocks.push({ type: 'subtitle', text: name ? 'A reading for ' + name : 'Your reading' });
  if (r.intro) blocks.push({ type: 'lede', text: r.intro });

  const LINE_LABELS = { HEART: 'The Heart Line', HEAD: 'The Head Line', LIFE: 'The Life Line', FATE: 'The Fate Line' };
  ['HEART', 'HEAD', 'LIFE', 'FATE'].forEach(function (k) {
    if (!r.map[k]) return;
    blocks.push({ type: 'heading', text: LINE_LABELS[k] });
    blocks.push({ type: 'body', text: r.map[k] });
  });

  if (r.map.SYNTHESIS) {
    blocks.push({ type: 'heading', text: 'Where This Leads' });
    blocks.push({ type: 'body', text: r.map.SYNTHESIS });
  }

  if (upsell1) {
    const u1 = parseMarkers(upsell1, ['OPENING', 'DEEPER', 'COST', 'ONETHING']);
    blocks.push({ type: 'pagebreak' });
    blocks.push({ type: 'title', text: 'Your Next Chapter' });
    if (u1.map.OPENING) blocks.push({ type: 'body', text: u1.map.OPENING });
    if (u1.map.DEEPER) blocks.push({ type: 'body', text: u1.map.DEEPER });
    if (u1.map.COST) {
      blocks.push({ type: 'heading', text: 'What This Costs' });
      blocks.push({ type: 'body', text: u1.map.COST });
    }
    if (u1.map.ONETHING) {
      blocks.push({ type: 'heading', text: 'One Thing' });
      blocks.push({ type: 'body', text: u1.map.ONETHING });
    }
  }

  if (upsell2) {
    const u2 = parseMarkers(upsell2, ['ATTACHMENT', 'PATTERN', 'GAP', 'TIMING', 'WATCH']);
    const U2_LABELS = {
      ATTACHMENT: 'How You Attach',
      PATTERN: 'Your Pattern',
      GAP: 'The Gap',
      TIMING: 'Timing',
      WATCH: 'What To Watch For'
    };
    blocks.push({ type: 'pagebreak' });
    blocks.push({ type: 'title', text: 'Your Love Blueprint' });
    ['ATTACHMENT', 'PATTERN', 'GAP', 'TIMING', 'WATCH'].forEach(function (k) {
      if (!u2.map[k]) return;
      blocks.push({ type: 'heading', text: U2_LABELS[k] });
      blocks.push({ type: 'body', text: u2.map[k] });
    });
  }

  blocks.push({ type: 'footer', text: 'Sage of Signs is provided for entertainment purposes only.' });

  return blocks;
}

// ---- PDF rendering ----------------------------------------------------------

const PAGE_W = 595.28;   // A4 points
const PAGE_H = 841.89;
const MARGIN = 64;
const MAX_W = PAGE_W - MARGIN * 2;

const STYLES = {
  title:    { font: 'F2', size: 22, leading: 30, gap: 10 },
  subtitle: { font: 'F3', size: 12, leading: 18, gap: 22 },
  lede:     { font: 'F3', size: 11.5, leading: 18, gap: 24 },
  heading:  { font: 'F2', size: 13, leading: 20, gap: 8 },
  body:     { font: 'F1', size: 11, leading: 17, gap: 20 },
  footer:   { font: 'F1', size: 8.5, leading: 13, gap: 0 }
};

// Approximate character widths for Helvetica at size 1, good enough for wrapping.
function charWidth(ch, size) {
  const narrow = "iljtfIr.,:;'|! ";
  const wide = "mwMW@";
  if (narrow.indexOf(ch) !== -1) return size * 0.31;
  if (wide.indexOf(ch) !== -1) return size * 0.85;
  return size * 0.52;
}

function textWidth(str, size) {
  let w = 0;
  for (let i = 0; i < str.length; i++) w += charWidth(str[i], size);
  return w;
}

function wrapText(text, size, maxWidth) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';
  words.forEach(function (word) {
    const test = line ? line + ' ' + word : word;
    if (textWidth(test, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function escapePdf(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// Strip characters outside WinAnsi range so the PDF stays valid.
function sanitize(str) {
  return str.replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\u2014/g, ', ')
            .replace(/\u2013/g, '-')
            .replace(/\u2026/g, '...')
            .replace(/[^\x20-\x7E]/g, '');
}

function renderPdf(blocks) {
  const pages = [];
  let current = [];
  let y = PAGE_H - MARGIN;

  function newPage() {
    if (current.length) pages.push(current);
    current = [];
    y = PAGE_H - MARGIN;
  }

  blocks.forEach(function (block) {
    if (block.type === 'pagebreak') {
      newPage();
      return;
    }
    const style = STYLES[block.type] || STYLES.body;
    const clean = sanitize(block.text);
    const lines = wrapText(clean, style.size, MAX_W);

    lines.forEach(function (line) {
      if (y - style.leading < MARGIN) newPage();
      current.push({ x: MARGIN, y: y, text: line, font: style.font, size: style.size });
      y -= style.leading;
    });
    y -= style.gap;
  });

  if (current.length) pages.push(current);

  // Build PDF objects.
  const objects = [];
  const pageCount = pages.length;
  const fontBase = 3 + pageCount * 2;  // after catalog, pages node, and page/content pairs

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');

  const kids = [];
  for (let i = 0; i < pageCount; i++) kids.push((3 + i * 2) + ' 0 R');
  objects.push('<< /Type /Pages /Count ' + pageCount + ' /Kids [' + kids.join(' ') + '] >>');

  pages.forEach(function (pageLines, i) {
    const contentObjNum = 4 + i * 2;
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] ' +
      '/Resources << /Font << /F1 ' + fontBase + ' 0 R /F2 ' + (fontBase + 1) + ' 0 R /F3 ' + (fontBase + 2) + ' 0 R >> >> ' +
      '/Contents ' + contentObjNum + ' 0 R >>'
    );

    let stream = '';
    pageLines.forEach(function (l) {
      stream += 'BT /' + l.font + ' ' + l.size + ' Tf 1 1 1 rg ' +
                l.x.toFixed(2) + ' ' + l.y.toFixed(2) + ' Td (' + escapePdf(l.text) + ') Tj ET\n';
    });
    // Dark background rectangle drawn first.
    const bg = '0.071 0.078 0.169 rg 0 0 ' + PAGE_W + ' ' + PAGE_H + ' re f\n';
    stream = bg + stream;

    objects.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
  });

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach(function (obj, i) {
    offsets.push(pdf.length);
    pdf += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
  });

  const xrefStart = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\n';
  pdf += 'startxref\n' + xrefStart + '\n%%EOF';

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
