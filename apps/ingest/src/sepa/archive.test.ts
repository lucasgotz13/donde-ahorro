import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { extractEntry, listInnerArchives, readEntry } from "./archive.ts";
import { readRecords } from "./parse.ts";

const outer = fileURLToPath(new URL("./fixtures/sepa_jueves.zip", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "sepa-test-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("SEPA archive", () => {
  it("lists the inner archive of each comercio", async () => {
    const inner = await listInnerArchives(outer);
    expect([...inner.keys()].sort((a, b) => a - b)).toEqual([9, 10, 12, 15, 36]);
    expect(inner.get(12)).toBe("2026-11-19/sepa_1_comercio-sepa-12_2026-11-19_09-05-10.zip");
  });

  it("reads a CSV from an inner archive", async () => {
    const inner = await extractEntry(outer, (await listInnerArchives(outer)).get(12)!, dir);
    const records = [];
    for await (const record of readRecords(readEntry(inner, "comercio.csv"))) records.push(record);
    expect(records).toEqual([expect.objectContaining({ id_comercio: "12", comercio_bandera_nombre: "COTO CICSA" })]);
  });

  it("rejects an archive with two inner archives for one comercio", async () => {
    const twice = join(dir, "twice.zip");
    await promisify(execFile)("python3", ["-I", "-c", `import zipfile\nwith zipfile.ZipFile("${twice}", "w") as z:\n  z.writestr("d/sepa_1_comercio-sepa-12_a.zip", b"")\n  z.writestr("d/sepa_2_comercio-sepa-12_b.zip", b"")`]);
    await expect(listInnerArchives(twice)).rejects.toThrow(/two archives for comercio 12/);
  });

  it("fails when the entry does not exist", async () => {
    const read = async () => {
      for await (const _ of readEntry(outer, "missing.csv"));
    };
    await expect(read()).rejects.toThrow(/unzip exited with code/);
  });
});
