import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Parser, Language } from "web-tree-sitter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let parser: Parser | null = null;

export async function loadPascalParser(): Promise<Parser> {
  if (parser) {
    return parser;
  }
  await Parser.init();

  const wasmPath = path.join(__dirname, "tree-sitter-pascal.wasm");
  const language = await Language.load(wasmPath);
  parser = new Parser();
  parser.setLanguage(language);

  return parser;
}
