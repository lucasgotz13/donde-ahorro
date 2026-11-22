import type { Cap, CapPeriod } from "@donde-ahorro/core";

const periods: [RegExp, CapPeriod][] = [
  [/transacci[oó]n|compra|ticket/iu, "transaction"],
  [/d[ií]a(?![a-z])|diari/iu, "day"],
  [/semana/iu, "week"],
  [/\bmes(?:es)?\b|mensual/iu, "month"],
];

/** S12: the cap from a promotion's legal text; `unknown` when a cap is mentioned but cannot be parsed. */
export function parseCap(text: string): Cap {
  const at = text.search(/\btope\b/iu);
  if (at < 0 || /\bsin\s+$/iu.test(text.slice(0, at))) return null;
  // The clause runs to the first period that is not a thousands separator.
  const clause = /^tope(?:[^.]|\.(?=\d))*/iu.exec(text.slice(at))![0];
  const amount = /\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/u.exec(clause);
  const period = periods
    .map(([re, p]) => ({ p, i: clause.search(re) }))
    .filter(({ i }) => i >= 0)
    .sort((a, b) => a.i - b.i)[0];
  if (!amount || !period) return "unknown";
  const cents = Number(amount[1]!.replaceAll(".", "")) * 100 + Number((amount[2] ?? "0").padEnd(2, "0"));
  return { amount: cents, period: period.p };
}
