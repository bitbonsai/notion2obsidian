import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { extractZipToSameDirectory } from "./zip.js";

let dir;
let logSpy;
const logged = () => logSpy.mock.calls.map(args => args.join(" ")).join("\n");

async function extract(name, files) {
  const zipPath = join(dir, `${name}.zip`);
  await writeFile(zipPath, zipSync(files));
  return extractZipToSameDirectory(zipPath);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "n2o-zip-"));
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  logSpy.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

describe("extractZipToSameDirectory name conflicts", () => {
  test("file blocking a folder is renamed and both are kept", async () => {
    const result = await extract("a", {
      "root/x": strToU8("FILE"),
      "root/x/page.md": strToU8("PAGE"),
    });
    expect(await readFile(join(result.extractDir, "root/x-file"), "utf8")).toBe("FILE");
    expect(await readFile(join(result.extractDir, "root/x/page.md"), "utf8")).toBe("PAGE");
  });

  test("folder blocking a file is handled by renaming the file", async () => {
    const result = await extract("b", {
      "root/x/page.md": strToU8("PAGE"),
      "root/x": strToU8("FILE"),
    });
    expect(await readFile(join(result.extractDir, "root/x-file"), "utf8")).toBe("FILE");
    expect(await readFile(join(result.extractDir, "root/x/page.md"), "utf8")).toBe("PAGE");
  });

  test("skipped file inside a nested zip is reported, not silent", async () => {
    const inner = zipSync({
      "root/x": strToU8("FILE"),
      "root/x/deep/page.md": strToU8("PAGE"),
    });
    const result = await extract("c", {
      "root/keep.md": strToU8("KEEP"),
      "root/inner.zip": inner,
    });
    expect(await readFile(join(result.extractDir, "root/keep.md"), "utf8")).toBe("KEEP");
    expect(logged()).toContain("skipping root/x/deep/page.md");
  });

  test("bad nested zip does not delete the parent extraction", async () => {
    const result = await extract("d", {
      "root/keep.md": strToU8("KEEP"),
      "root/bad.zip": strToU8("not a zip"),
    });
    expect(await readdir(join(result.extractDir, "root"))).toContain("keep.md");
  });
});
