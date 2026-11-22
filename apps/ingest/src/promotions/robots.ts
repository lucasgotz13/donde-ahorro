import { USER_AGENT } from "../sepa/download.ts";

const toRegExp = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replace(/\\\$$|\$$/, "$")}`);

/** S22: whether the `*` group of a robots.txt lets us fetch `path` (longest rule wins, Allow on ties). */
export function isAllowedByRobots(robots: string, path: string): boolean {
  let agents: string[] = [];
  let inRules = false;
  let best: { allow: boolean; length: number } | undefined;
  for (const raw of robots.split(/\r?\n/)) {
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(raw.replace(/#.*/, "").trim());
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!;
    if (key === "user-agent") {
      if (inRules) [agents, inRules] = [[], false];
      agents.push(value.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      inRules = true;
      if (!agents.includes("*") || !value || !toRegExp(value).test(path)) continue;
      const allow = key === "allow";
      if (!best || value.length > best.length || (value.length === best.length && allow)) best = { allow, length: value.length };
    }
  }
  return best?.allow ?? true;
}

/** Throws unless the site's robots.txt allows `url`; a missing robots.txt allows everything. */
export async function assertAllowedByRobots(url: string): Promise<void> {
  const { origin, pathname, search } = new URL(url);
  const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT } });
  if (res.status >= 500) throw new Error(`${origin}/robots.txt: HTTP ${res.status}`);
  if (res.ok && !isAllowedByRobots(await res.text(), pathname + search)) throw new Error(`robots.txt disallows ${url}`);
}
