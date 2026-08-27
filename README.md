# Prettier Pascal Plugin

[![Node.js CI](https://github.com/oisanjaya/prettier-plugin-pascal/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/oisanjaya/prettier-plugin-pascal/actions/workflows/node.js.yml) ![NPM Version](https://img.shields.io/npm/v/prettier-plugin-pascal) ![NPM Downloads](https://img.shields.io/npm/dm/prettier-plugin-pascal) ![Static Badge](https://img.shields.io/badge/plugin-prettier-blue)

## Intro

Prettier is an opinionated code formatter. It parses your code and reprints it using consistent formatting rules while taking the configured maximum line length into account.

This plugin adds support for the Pascal language to Prettier. I believe that Pascal code deserves the same love and consistency as any modern language.

It uses [tree-sitter-pascal](https://github.com/jimmckeeth/tree-sitter-pascal) to parse Pascal source code and generates Prettier's document structure from the resulting syntax tree.

### Input

<!-- prettier-ignore -->
```pascal
program HelloWorld;
var
x,y: Integer;

begin
writeln('Hello World!');



if x>y then
begin
writeln('x is greater');
end
else
writeln('y is greater');
end.
```

### Output

```pascal
program HelloWorld;
  var
    x, y: Integer;

begin
  writeln('Hello World!');

  if x > y then
    begin
      writeln('x is greater');
    end
  else
    writeln('y is greater');
end.
```

## Getting Started

### Installation

npm:

```shell
npm install --save-dev --save-exact prettier prettier-plugin-pascal
```

Yarn:

```shell
yarn add --dev --exact prettier prettier-plugin-pascal
```

### Usage

npm:

```shell
npx prettier --plugin=prettier-plugin-pascal --write "**/*.{pas,pascal,pp}"
```

Yarn:

```shell
yarn exec prettier --plugin=prettier-plugin-pascal --write "**/*.{pas,pascal,pp}"
```

### Supported Extensions

The plugin currently targets these Pascal file extensions:

```text
.pas
.pp
.pascal
```

### Features

The formatter is based on a Tree-sitter Pascal grammar and supports formatting of Pascal constructs including:

- Programs, libraries, and units
- Variable, constant, type, and procedure declarations
- Classes, interfaces, records, properties, and variant records
- Expressions and operators
- Procedure/function implementations
- Control-flow constructs such as `if`, `while`, `for`, `repeat`, `case`, and `try`
- Generic and type-reference syntax
- Pascal and Delphi/FPC-oriented language constructs

Formatting coverage is still evolving, and some advanced Pascal/Delphi/FPC constructs may fall back to a generic printer.

## Development

The plugin uses a precompiled tree-sitter-pascal pinned at [v0.11.0.9e9f070 release](https://github.com/jimmckeeth/tree-sitter-pascal/releases/download/v0.11.0-9e9f070/tree-sitter-pascal.wasm) WebAssembly parser. The parser binary is bundled into the published package, so users do not need to install or compile the Pascal grammar separately.

The project can be built with:

```shell
npm install
npm run build
```

## Contributing

Contributions, bug reports, formatting examples, and additional Pascal language test cases are welcome.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE](LICENSE).
