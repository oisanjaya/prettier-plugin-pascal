import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// const EXPECTED_SHA256 =
//   "94c9d6b882f4c673f5165fae766666efaa11b0c7345b414687f2712428a140fb";
// const PASCAL_PARSER_VERSION = "v0.11.0-9e9f070";
// const URL =
//   "https://github.com/jimmckeeth/tree-sitter-pascal/releases/download/" +
//   `${PASCAL_PARSER_VERSION}/tree-sitter-pascal.wasm`;
const EXPECTED_SHA256 =
  "6407e4f1ba0a19ed128987035d929ce891186bc0b53543731df65a7ac8ea4dd7";
const URL =
  "https://github.com/oisanjaya/tree-sitter-pascal/releases/download/" +
  "v0.11.1-4c7ff14/tree-sitter-pascal.wasm";

const output = resolve("dist/tree-sitter-pascal.wasm");

console.log(`Downloading Pascal parser...`);
console.log(`  ${URL}`);

const response = await fetch(URL);

if (!response.ok) {
  throw new Error(
    `Failed to download Pascal parser: ` +
      `${response.status} ${response.statusText}`,
  );
}

const buffer = Buffer.from(await response.arrayBuffer());

const actualSha256 = createHash("sha256").update(buffer).digest("hex");

if (actualSha256 !== EXPECTED_SHA256) {
  throw new Error(
    `Pascal parser checksum mismatch.\n` +
      `Expected: ${EXPECTED_SHA256}\n` +
      `Actual:   ${actualSha256}`,
  );
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, buffer);

console.log(`Saved ${output}`);
