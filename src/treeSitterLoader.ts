import fs from "fs";
import path from "path";
import { Parser, Language } from "web-tree-sitter";

let initialized = false;

export async function loadPascalParser(): Promise<Parser> {
  if (!initialized) {
    await Parser.init();
    initialized = true;
  }

  const wasmPath = path.join(__dirname, "tree-sitter-pascal.wasm");
  const wasmBuffer = fs.readFileSync(wasmPath);

  const language = await Language.load(wasmBuffer);

  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
