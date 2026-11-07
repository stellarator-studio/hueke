// Sorting text compares Unicode code points, never locale rules, so results are the same
// everywhere (docs/README.md, "Conventions").

/** Compares two strings by code point. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  const x = a[Symbol.iterator]();
  const y = b[Symbol.iterator]();
  for (;;) {
    const p = x.next();
    const q = y.next();
    if (p.done || q.done) return p.done ? (q.done ? 0 : -1) : 1;
    const d = (p.value.codePointAt(0) ?? 0) - (q.value.codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
}
