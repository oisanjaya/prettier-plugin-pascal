import test from "node:test";
import assert from "node:assert/strict";
import prettier from "prettier";
import pascalPlugin from "../dist/index";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const FIXTURES_DIR = "tests/fixtures";

async function formatPascal(code: string): Promise<string> {
  return await prettier.format(code, {
    parser: "pascal",
    plugins: [pascalPlugin],
    printWidth: 80,
    tabWidth: 2,
  });
}

const files = (await readdir(FIXTURES_DIR))
  .filter((name) => name.endsWith(".pas"))
  .sort();

if (files.length === 0) {
  throw new Error(`No .pas fixtures found in ${FIXTURES_DIR}`);
}

test("Pascal Prettier Plugin Test Suite", async (t) => {
  for (const fixture of files) {
    await t.test(`testing ${fixture}`, async () => {
      const source = await readFile(path.join(FIXTURES_DIR, fixture), "utf8");
      const result = await formatPascal(source);
      assert.equal(result, source);
    });
  }
});
