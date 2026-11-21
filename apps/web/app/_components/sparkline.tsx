import type { IsoDate, PriceStep } from "@donde-ahorro/core";
import { priceText, shortDate } from "../../lib/format.ts";

export interface SparkDomain {
  start: IsoDate;
  end: IsoDate;
  min: number;
  max: number;
}

const W = 100;
const H = 40;

/**
 * One chain's cheapest price as steps, on a domain shared by every chain so rows compare.
 * Each step is a hover target with its date and price.
 */
export function Sparkline({ steps, domain, label }: { steps: PriceStep[]; domain: SparkDomain; label: string }) {
  const t0 = Date.parse(domain.start);
  const span = Math.max(Date.parse(domain.end) - t0, 1);
  const x = (day: IsoDate) => ((Date.parse(day) - t0) / span) * W;
  const y = (price: number) =>
    domain.max === domain.min ? H / 2 : H - 2 - ((price - domain.min) / (domain.max - domain.min)) * (H - 4);

  const segments = steps.map((step, i) => ({
    step,
    x1: x(step.from),
    x2: i + 1 < steps.length ? x(steps[i + 1]!.from) : W,
  }));
  const d = segments
    .map(({ step, x1, x2 }, i) => {
      if (step.price === null) return "";
      const move = i > 0 && segments[i - 1]!.step.price !== null ? "V" : "M";
      return `${move === "M" ? `M${x1},` : "V"}${y(step.price)}H${x2}`;
    })
    .join("");
  const last = steps.findLast((s) => s.price !== null);

  return (
    <figure className="chain-history" style={{ margin: 0 }}>
      <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <path className="spark-line" d={d} />
        {segments.map(({ step, x1, x2 }) => (
          <rect key={step.from} className="spark-hit" x={x1} y={0} width={Math.max(x2 - x1, 0.5)} height={H}>
            <title>
              {step.price === null ? `desde el ${shortDate(step.from)}: sin precio` : `desde el ${shortDate(step.from)}: ${priceText(step.price)}`}
            </title>
          </rect>
        ))}
      </svg>
      <figcaption className="spark-caption">
        <span>{shortDate(domain.start)}</span>
        <span>{last ? `hoy ${priceText(last.price!)}` : ""}</span>
      </figcaption>
    </figure>
  );
}
