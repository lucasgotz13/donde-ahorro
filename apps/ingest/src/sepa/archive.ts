import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { basename, join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

// The system `unzip` streams entries of the ~335 MB archive without loading it in memory.

/** Maps each `id_comercio` to its inner archive (`<date>/sepa_<n>_comercio-sepa-<id>_<date>.zip`). */
export async function listInnerArchives(outerZip: string): Promise<Map<number, string>> {
  const { stdout } = await promisify(execFile)("unzip", ["-Z1", outerZip], { maxBuffer: 1 << 20 });
  const inner = new Map<number, string>();
  for (const entry of stdout.split("\n")) {
    const match = /comercio-sepa-(\d+)_[^/]*\.zip$/.exec(entry);
    if (match) inner.set(Number(match[1]), entry);
  }
  return inner;
}

/** Streams one entry out of a ZIP; the stream errors if `unzip` fails. */
export function readEntry(zip: string, entry: string): Readable {
  const child = spawn("unzip", ["-p", zip, entry], { stdio: ["ignore", "pipe", "ignore"] });
  const out = new PassThrough();
  child.stdout.pipe(out, { end: false });
  child.on("error", (error) => out.destroy(error));
  child.on("close", (code) => (code === 0 ? out.end() : out.destroy(new Error(`unzip exited with code ${code} reading ${entry}`))));
  return out;
}

/** Writes one entry of a ZIP into `dir` and returns its path. */
export async function extractEntry(zip: string, entry: string, dir: string): Promise<string> {
  const path = join(dir, basename(entry));
  await pipeline(readEntry(zip, entry), createWriteStream(path));
  return path;
}
