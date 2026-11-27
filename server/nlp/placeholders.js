// Names, amounts, dates and page numbers are swapped out before translation and put back after,
// so a model cannot mistranslate them (spec 5.5).

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mark = (n) => `⟦N${n}⟧`;

export function protect(text, terms = []) {
  const values = [];
  let out = String(text ?? '');
  const swap = (match) => {
    values.push(match);
    return mark(values.length);
  };
  // Longest first, so "Ravi Kumar" wins over "Ravi".
  const named = [...new Set(terms.filter((t) => t && t.trim().length > 1))].sort((a, b) => b.length - a.length);
  for (const term of named) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}⟦])${escapeRegex(term)}(?![\\p{L}\\p{M}\\p{N}])`, 'giu'), swap);
  }
  out = out.replace(/⟦N\d+⟧|(?:₹\s?)?\p{Nd}+(?:[.,:/-]\p{Nd}+)*/gu, (m) => (m.startsWith('⟦') ? m : swap(m)));
  return { text: out, values };
}

/** Restores protected values. Returns null if the model dropped or invented a placeholder. */
export function restore(translated, values) {
  const used = new Set();
  let invented = false;
  const out = String(translated ?? '').replace(/[⟦\[]{1,2}\s*N\s*(\d+)\s*[⟧\]]{1,2}/g, (_m, n) => {
    const value = values[Number(n) - 1];
    if (value === undefined) {
      invented = true;
      return '';
    }
    used.add(Number(n));
    return value;
  });
  return invented || used.size !== values.length ? null : out.trim();
}
