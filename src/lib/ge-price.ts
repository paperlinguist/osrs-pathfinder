/**
 * GE price parsing shared by the build script and the live-price API route —
 * the Jagex item DB reports prices as `1025`, `"2.3k"`, `"1.2m"` or `"-"`.
 */
export function parseGePrice(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^([\d,.]+)\s*([km])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (/k/i.test(m[2] ?? "")) return Math.round(n * 1_000);
  if (/m/i.test(m[2] ?? "")) return Math.round(n * 1_000_000);
  return Math.round(n);
}
