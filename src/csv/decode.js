// Stage 1: bytes → text. The renderer can only sniff encodings if it gets raw
// bytes (proposal §5.1); until the csv:open IPC hands bytes over, callers may
// still pass an already-decoded string and this stage is skipped.

// Detection order matters: the UTF-32LE BOM (FF FE 00 00) starts with the
// UTF-16LE one, so UTF-32 must be checked first.
export function sniffEncoding(bytes) {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return { encoding: 'utf-8', bom: true };
  if (b.length >= 4 && b[0] === 0xFF && b[1] === 0xFE && b[2] === 0 && b[3] === 0) return { encoding: 'utf-32le', bom: true };
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 0xFE && b[3] === 0xFF) return { encoding: 'utf-32be', bom: true };
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return { encoding: 'utf-16le', bom: true };
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return { encoding: 'utf-16be', bom: true };

  // BOM-less UTF-16: NUL bytes clustered on one parity over the first 4 KB.
  const n = Math.min(b.length, 4096);
  let even = 0, odd = 0;
  for (let i = 0; i < n; i++) if (b[i] === 0) (i % 2 ? odd++ : even++);
  if ((even + odd) / n > 0.15) {
    if (odd > even * 4) return { encoding: 'utf-16le', bom: false };
    if (even > odd * 4) return { encoding: 'utf-16be', bom: false };
  }

  // Valid UTF-8? Test a codepoint-aligned prefix so a truncated multi-byte
  // sequence at the 4 KB boundary doesn't cause a false negative.
  let end = n;
  if (end < b.length) {
    while (end > 0 && (b[end] & 0xC0) === 0x80) end--;
    if (end > 0 && (b[end] & 0x80)) end--;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, end));
    return { encoding: 'utf-8', bom: false };
  } catch {
    // windows-1252, never iso-8859-1: they differ exactly in 0x80–0x9F, where
    // bank files put curly apostrophes and en-dashes.
    return { encoding: 'windows-1252', bom: false };
  }
}

export function decode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { encoding, bom } = sniffEncoding(b);
  let text = new TextDecoder(encoding).decode(b); // TextDecoder eats a leading BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // …but strip defensively
  // A cp1252 decode of double-encoded UTF-8 leaves telltale Ã©/â€™ pairs — repair.
  if (encoding === 'windows-1252' && /Ã[©¤¼¶]|â€™|Â£/.test(text)) {
    try {
      text = new TextDecoder('utf-8', { fatal: true })
        .decode(Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xFF));
      return { text, encoding: 'utf-8 (repaired double-encoding)', bom };
    } catch { /* not actually double-encoded — keep the cp1252 read */ }
  }
  return { text, encoding, bom };
}
