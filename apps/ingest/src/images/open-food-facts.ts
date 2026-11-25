import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import type postgres from "postgres";
import { USER_AGENT } from "../sepa/download.ts";

/** The whole catalog as tab-separated text: their API asks for it beyond a few hundred products. */
export const OFF_DUMP_URL = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";
const IMAGE_PREFIX = "https://images.openfoodfacts.org/images/products/";
// The dump is ~1.5 GB, so it is read weekly; half a day short of it, so that a week later the same tick is due.
const REFRESH_MS = 6.5 * 86_400_000;
const TIMEOUT_MS = 2 * 3600_000;

/** A copy that does not keep the whole decoded chunk it was sliced from in memory. */
const detach = (slice: string) => Buffer.from(slice).toString();

/** The dump's image URL of each EAN in `eans`, streamed so that nothing touches the disk. */
async function readImages(url: string, eans: Set<string>): Promise<Map<string, string>> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`Open Food Facts: HTTP ${res.status}`);
  const images = new Map<string, string>();
  let imageColumn = -1;
  const read = (line: string) => {
    if (imageColumn < 0) {
      const header = line.replace(/\r$/, "").split("\t");
      imageColumn = header.indexOf("image_small_url");
      if (header[0] !== "code" || imageColumn < 0) throw new Error("Open Food Facts: the dump lacks an expected column");
      return;
    }
    // Millions of rows with 200+ columns: only the matching ones are split.
    const ean = line.slice(0, line.indexOf("\t"));
    if (!eans.has(ean)) return;
    const image = line.split("\t")[imageColumn];
    if (image?.startsWith(IMAGE_PREFIX)) images.set(detach(ean), detach(image));
  };
  // fetch's body is a web ReadableStream; only its DOM and Node typings differ.
  await pipeline(Readable.fromWeb(res.body as ReadableStream), createGunzip().setEncoding("utf8"), async (text: AsyncIterable<string>) => {
    let rest = "";
    for await (const chunk of text) {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop()!;
      lines.forEach(read);
    }
    if (rest) read(rest);
  });
  return images;
}

/** Links products to their Open Food Facts photo by EAN. Logged in `ingest_runs`; a failure keeps the stored images. */
export async function loadProductImages(sql: postgres.Sql, { url = OFF_DUMP_URL, now = new Date() }: { url?: string; now?: Date } = {}) {
  const [run] = await sql`insert into ingest_runs (source) values ('images') returning id`;
  const finish = (fields: Record<string, unknown>) =>
    sql`update ingest_runs set ${sql({ ...fields, finished_at: new Date() })} where id = ${run!.id}`;
  try {
    const [previous] = await sql`select started_at from ingest_runs
      where source = 'images' and status = 'succeeded' order by started_at desc limit 1`;
    if (previous && now.getTime() - previous.started_at.getTime() < REFRESH_MS) {
      await finish({ status: "skipped", message: "images loaded less than a week ago" });
      return;
    }
    const products = await sql`select ean from products where ean is not null`;
    if (products.length === 0) {
      await finish({ status: "skipped", message: "no products with an EAN yet" });
      return;
    }
    const images = await readImages(url, new Set(products.map((p) => p.ean)));
    if (images.size === 0) throw new Error("Open Food Facts: no image for any product");
    await sql`update products p set image_url = m.url
      from products o left join unnest(${[...images.keys()]}::text[], ${[...images.values()]}::text[]) as m(ean, url) on m.ean = o.ean
      where p.id = o.id and p.image_url is distinct from m.url`;
    const stats = { products: products.length, images: images.size };
    await finish({ status: "succeeded", stats: sql.json(stats) });
    return stats;
  } catch (error) {
    await finish({ status: "failed", message: String(error) });
    throw error;
  }
}
