// # ==============================================================================
// # UNHANDLED TREE-SITTER AST NODES
// # do we even need to implement theese?
// # ==============================================================================

// [top_level_and_preprocessor]
// moduleName = "Dot-delimited module or unit name identifiers"
// pp = "Preprocessor compiler directives (e.g., {$IFDEF}, {$ELSE}, {$ENDIF})"

// [statements_and_control_flow]
// try = "try ... except/finally ... end exception blocks"
// exceptionHandler = "on E: Exception do ... clauses inside except blocks"
// exceptionElse = "The else block inside a try ... except handler"
// raise = "raise ...; exception triggering statements"
// with = "with ... do statements"
// goto = "goto <label>; jump statements"
// label = "Statement label prefix (<identifier>:)"
// asm = "Inline assembly blocks (asm ... end;)"
// asmBody = "Body content of inline assembly blocks"
// varDef = "Inline or statement-level variable declarations"
// varAssignDef = "Inline variable assignment definitions"
// statement = "Wrapper node for standalone expression statements"

// [expressions_and_operators]
// exprUnary = "Prefix unary expressions (not, +, -, @)"
// exprParens = "Parenthesized expressions ((expr))"
// exprDot = "Member access expressions (foo.bar)"
// exprDeref = "Pointer dereference postfix expressions (foo^)"
// exprAs = "Type-casting expressions (foo as TBar)"
// exprTpl = "Generic template instantiation expressions (Foo<T>)"
// exprSubscript = "Array indexing expressions (foo[i])"
// inherited = "inherited method calls"
// lambda = "Anonymous procedure and function expressions"
// legacyFormat = "Legacy string output formatting (e.g., :4:2 in WriteLn)"

// [types_and_generic_references]
// typerefDot = "Dot-namespaced type references (UnitName.TypeName)"
// typerefPtr = "Pointer type references (^Integer)"
// typerefTpl = "Generic type references (TList<Integer>)"
// typerefArgs = "Argument list inside generic type references"
// genericDot = "Namespaced generic identifiers (UnitName.GenericName)"
// genericTpl = "Generic definition header names (TFoo<T>)"
// genericArgs = "Semicolon-delimited generic parameter list"
// genericArg = "Individual generic type parameter (T: TConstraint)"

// [declarations_and_oop_definitions]
// declConsts = "const and resourcestring declaration blocks"
// declConst = "Individual constant items"
// declIntf = "interface and dispinterface type definitions"
// declHelper = "class helper and record helper declarations"
// declProcFwd = "Forward procedure/function declarations (...; forward;)"
// declLabel = "Individual label names inside a label x, y; block"
// declExport = "Individual exported routine entries inside an exports block"
// defaultValue = "= <initializer> assignment suffix in declarations"
// guid = "Interface GUID attribute string (['{...}'])"
// rttiAttributes = "Extended Delphi RTTI attribute brackets ([MyAttr(42)])"
// procAttribute = "Method/routine calling conventions and modifiers (cdecl, inline, etc.)"
// procExternal = "external 'lib' name 'foo'; procedure import suffixes"
// operatorDot = "Namespaced operator overload declarations"
// operatorName = "Operator overload name declarations"

// [literals_ranges_and_initializers]
// literalString = "Single-quoted strings and concatenated string literals"
// literalChar = "Numeric character literals (#65, #$0D)"
// literalNumber = "Integer, hex, and floating-point numeric literals"
// range = "Subrange syntax (1..10 or 'a'..'z')"
// recInitializer = "Record literal initializers ((Field1: Val1; Field2: Val2))"
// recInitializerField = "Individual field-value assignment in a record initializer"
// arrInitializer = "Array literal initializers ((Val1, Val2, Val3))"

import { Parser } from "web-tree-sitter";
import { loadPascalParser } from "./treeSitterLoader";

import prettier, {
  Parser as PrettierParser,
  Printer,
  SupportLanguage as Language,
  Options,
  AstPath,
  Doc,
} from "prettier";
import { builders } from "prettier/doc";

const {
  group,
  join,
  line,
  hardline,
  softline,
  indent,
  breakParent,
  fill,
  align,
} = prettier.doc.builders;

const { printDocToString } = prettier.doc.printer;

type Parsers = Record<string, PrettierParser>;
type Printers = Record<string, Printer>;

let parserInstance: Parser | null = null;

const getParser = async () => {
  if (!parserInstance) {
    parserInstance = await loadPascalParser();
  }
  return parserInstance;
};

export const languages: Language[] = [
  {
    name: "Pascal",
    parsers: ["pascal"],
    extensions: [".pas", ".pp", ".pascal"],
    vscodeLanguageIds: ["pascal"],
  },
];

export const parsers: Parsers = {
  pascal: {
    parse: async (text: string) => {
      const parser = await getParser();
      const tree = parser.parse(text);

      if (tree === null) {
        throw new Error("Failed to parse Pascal code – tree is null");
      }

      if (process.env.DEBUG_PASCAL_PARSER) {
        function debugPrintNode(node: any, indent = 0, fieldName = "") {
          const fieldNameStr =
            fieldName?.length > 0 ? "(" + fieldName + ")" : "";
          console.log(
            `${" ".repeat(indent)}${node.type}${fieldNameStr} [${node.startPosition.row}:${node.startPosition.column}] - [${node.endPosition.row}:${node.endPosition.column}]`,
          );
          for (let i = 0; i < node.childCount; i++) {
            const childFiledName = node.fieldNameForChild(i);
            debugPrintNode(node.child(i), indent + 2, childFiledName);
          }
        }
        debugPrintNode(tree.rootNode);
      }

      return tree.rootNode;
    },
    astFormat: "pascal",
    locStart: (node: any) => node.startIndex,
    locEnd: (node: any) => node.endIndex,
  },
};

export const printers: Printers = {
  pascal: {
    print: printNode,
  },
};

// Optional custom options
export const options: Options = {};

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface SyntaxNode {
  type: string;
  text: string;
  childCount: number;
  children: SyntaxNode[];
  fieldNameForChild(index: number): string | null;
}

export class SourceSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceSyntaxError";
  }
}

type PrintFn = (path: AstPath<SyntaxNode>) => Doc;

// ============================================================================
// STACK & NODE FILTERING UTILITIES
// ============================================================================

const skipStack: string[][] = [];

/**
 * Safely executes a callback with specified node types added to the skip stack.
 */
function withSkippedNodes<T>(skipNodes: string[], callback: () => T): T {
  skipStack.push(skipNodes);
  try {
    return callback();
  } finally {
    skipStack.pop();
  }
}

function filterChildrenTypeField(
  node: SyntaxNode,
  typeName = "",
  fieldName = "",
): number[] {
  if (!node || typeof node.childCount !== "number") {
    throw new TypeError("Invalid SyntaxNode provided.");
  }

  const matches: number[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.children[i];
    const matchesType = typeName === "" || child.type === typeName;
    const matchesField =
      fieldName === "" || node.fieldNameForChild(i) === fieldName;
    if (matchesType && matchesField) {
      matches.push(i);
    }
  }
  return matches;
}

function filterThenCallPrint(
  path: AstPath<SyntaxNode>,
  print: PrintFn,
  node: SyntaxNode,
  typeName = "",
  fieldName = "",
  skipNodes: string[] = [],
): Doc[] {
  return withSkippedNodes(skipNodes, () =>
    filterChildrenTypeField(node, typeName, fieldName)
      .map((idx) => path.call(print, "children", idx))
      .filter(
        (item) =>
          typeof item === "object" || Array.isArray(item) || item.length > 0,
      ),
  );
}

// Overloads for fetchTextByType
function fetchTextByType(
  path: AstPath<SyntaxNode>,
  print: PrintFn,
  node: SyntaxNode,
  typeName: string,
): Doc;
function fetchTextByType(
  path: AstPath<SyntaxNode>,
  print: PrintFn,
  node: SyntaxNode,
  typeName: string[],
): Map<string, Doc>;
function fetchTextByType(
  path: AstPath<SyntaxNode>,
  print: PrintFn,
  node: SyntaxNode,
  typeName: string | string[],
): Doc | Map<string, Doc> {
  const targetTypes = Array.isArray(typeName) ? typeName : [typeName];

  const results = targetTypes.map((target) =>
    withSkippedNodes([], () => {
      const idx = filterChildrenTypeField(node, target)[0];
      return idx !== undefined ? path.call(print, "children", idx) : "";
    }),
  );

  if (Array.isArray(typeName)) {
    const map = new Map<string, Doc>();
    targetTypes.forEach((target, i) => map.set(target, results[i]));
    return map;
  }

  return results[0];
}

// ============================================================================
// SHARED PRINTING HELPERS
// ============================================================================

/** Prints Delphi RTTI attributes [Attr] */
function printRttiAttributes(
  path: AstPath<SyntaxNode>,
  print: PrintFn,
  node: SyntaxNode,
): Doc {
  const attrs = filterThenCallPrint(path, print, node, "rttiAttribute", "", [
    "[",
    "]",
    ":",
  ]);
  if (attrs.length === 0) return "";
  return group(["[", join([",", line], attrs), "]", hardline]);
}

/** Prints trailing semicolon-separated attributes */
function printTrailingAttributes(
  path: AstPath<SyntaxNode>,
  print: PrintFn,
  node: SyntaxNode,
): Doc {
  const semiIndices = filterChildrenTypeField(node, ";");
  if (semiIndices.length <= 1) return "";

  const attrs: Doc[] = [];
  for (let i = semiIndices[0] + 1; i < node.childCount; i++) {
    withSkippedNodes([], () => {
      const childText = path.call(print, "children", i);
      if (childText !== ";") {
        attrs.push([join(line, childText as Doc[]), ";", line]);
      }
    });
  }
  return group(attrs);
}

/** Prints top-level modules (program / unit) */
function printModule(
  path: AstPath<SyntaxNode>,
  print: PrintFn,
  node: SyntaxNode,
  keyword: "program" | "unit" | "library",
): Doc {
  return withSkippedNodes(
    [
      keyword === "program"
        ? "kProgram"
        : keyword === "library"
          ? "kLibrary"
          : "kUnit",
      "moduleName",
      ";",
      "kEndDot",
    ],
    () => {
      const moduleName = withSkippedNodes([], () =>
        path.call(
          print,
          "children",
          filterChildrenTypeField(node, "moduleName")[0],
        ),
      );

      const header = [`${keyword} `, moduleName, ";", hardline, hardline];
      let firstChild = true;

      const body = path.map(print, "children").map((child) => {
        if (child === "") return child;
        const childString = printDocToString(child, {
          printWidth: 800,
          tabWidth: 2,
        });
        let separator: Doc = [
          childString.formatted.endsWith("\n") ? "" : hardline,
          hardline,
        ];

        if (firstChild) {
          firstChild = false;
          separator = "";
        }
        return [separator, group(child)];
      });

      return [header, ...body, "."];
    },
  );
}

/** Collects AST nodes enclosed within "[" and "]" brackets */
function collectBracketItems(
  path: AstPath<SyntaxNode>,
  print: PrintFn,
  node: SyntaxNode,
): Doc[] {
  const items: Doc[] = [];
  let inBrackets = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.children[i];
    if (child.type === "[") {
      inBrackets = true;
      continue;
    }
    if (child.type === "]") {
      inBrackets = false;
      continue;
    }
    if (inBrackets && child.type !== ",") {
      withSkippedNodes([], () => items.push(path.call(print, "children", i)));
    }
  }
  return items;
}

// ============================================================================
// MAIN PRINTER FUNCTION
// ============================================================================

export function printNode(
  path: AstPath<SyntaxNode>,
  options: object,
  printFn: PrintFn,
): Doc {
  const node = path.getNode();
  if (!node?.type) return "";

  const skippedChildNodes = skipStack[skipStack.length - 1] ?? [];
  if (skippedChildNodes.includes(node.type)) return "";

  switch (node.type) {
    // ================= SPECIAL CHARS =================
    case ":":
    case ",":
      return [node.text, line];

    // ====================== ROOT =====================
    case "root":
      return withSkippedNodes([], () => {
        const retDoc = [path.map(printFn, "children"), line];
        // console.log(JSON.stringify(retDoc));
        return retDoc;
      });

    // =================== TOP LEVEL ===================
    case "program":
      return printModule(path, printFn, node, "program");

    case "unit":
      return printModule(path, printFn, node, "unit");

    case "library":
      return printModule(path, printFn, node, "library");

    case "interface":
    case "implementation":
    case "initialization":
    case "finalization": {
      return withSkippedNodes([], () => {
        const kSection = path
          .call(printFn, "children", 0)
          .toString()
          .toLowerCase();
        const items = [];
        for (let i = 1; i < node.childCount; i++) {
          items.push(path.call(printFn, "children", i));
        }
        return [kSection, hardline, hardline, join(line, items)];
      });
    }

    // ================== DEFINITIONS ==================
    case "defProc": {
      const header =
        filterThenCallPrint(path, printFn, node, "", "header")[0] ?? "";
      const headerString = printDocToString(header, {
        printWidth: 800,
        tabWidth: 2,
      });

      const local = withSkippedNodes(
        [],
        () =>
          filterChildrenTypeField(node, "", "local").map((idx) =>
            path.call(printFn, "children", idx),
          )[0] ?? "",
      );

      const body = withSkippedNodes(
        [],
        () =>
          filterChildrenTypeField(node, "", "body").map((idx) =>
            path.call(printFn, "children", idx),
          )[0] ?? "",
      );

      return group([
        header,
        !headerString.formatted.endsWith(";") ? ";" : "",
        indent([local && (local as Doc[]).length > 0 ? hardline : "", local]),
        indent([hardline, body]),
        ";",
        hardline,
      ]);
    }

    // =================== CLASS / RECORD ===================
    case "declClass": {
      const isPacked =
        filterChildrenTypeField(node, "kPacked").length > 0 ? "packed " : "";
      const kindMap = fetchTextByType(path, printFn, node, [
        "kClass",
        "kRecord",
        "kObject",
        "kObjcclass",
        "kObjccategory",
        "kObjcprotocol",
      ]);

      const kind =
        [...kindMap.values()]
          .find((val) => val && (val as Doc[]).length > 0)
          ?.toString()
          .toLowerCase() ?? "class";

      const parentNodes = filterThenCallPrint(
        path,
        printFn,
        node,
        "",
        "parent",
        ["(", ")", ","],
      );
      const parentDoc =
        parentNodes.length > 0
          ? group(["(", join([",", line], parentNodes), ")"])
          : "";

      const modifiers = [
        filterChildrenTypeField(node, "kAbstract").length > 0 ? "abstract" : "",
        filterChildrenTypeField(node, "kSealed").length > 0 ? "sealed" : "",
      ].filter(Boolean);

      const headerParts: Doc = [isPacked, kind, parentDoc];
      if (modifiers.length > 0) {
        headerParts.push(" ", join(" ", modifiers));
      }
      const header = group(headerParts);

      if (filterChildrenTypeField(node, "kEnd").length === 0) {
        return header;
      }

      const nonBodyTypes = new Set([
        "kPacked",
        "kClass",
        "kRecord",
        "kObject",
        "kObjcclass",
        "kObjccategory",
        "kObjcprotocol",
        "kAbstract",
        "kSealed",
        "kExternal",
        "kName",
        "kEnd",
        "(",
        ")",
        ",",
      ]);

      const bodyItems: Doc[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const child = node.children[i];
        if (child.type === "kEnd") break;
        if (
          nonBodyTypes.has(child.type) ||
          node.fieldNameForChild(i) === "parent"
        )
          continue;

        withSkippedNodes([], () => {
          const childDoc = path.call(printFn, "children", i);
          if (childDoc !== "") bodyItems.push(childDoc);
        });
      }

      return group([
        header,
        indent([hardline, join(hardline, bodyItems)]),
        hardline,
        "end",
      ]);
    }

    case "declSection": {
      const isStrict =
        filterChildrenTypeField(node, "kStrict").length > 0 ? "strict " : "";
      const visMap = fetchTextByType(path, printFn, node, [
        "kPublished",
        "kPublic",
        "kProtected",
        "kPrivate",
        "kRequired",
        "kOptional",
      ]);
      const visibility =
        [...visMap.values()]
          .find((val) => val && (val as Doc[]).length > 0)
          ?.toString()
          .toLowerCase() ?? "";

      const sectionHeaders = new Set([
        "kStrict",
        "kPublished",
        "kPublic",
        "kProtected",
        "kPrivate",
        "kRequired",
        "kOptional",
      ]);

      const sectionItems: Doc[] = [];
      for (let i = 0; i < node.childCount; i++) {
        if (sectionHeaders.has(node.children[i].type)) continue;
        withSkippedNodes([], () => {
          const childDoc = path.call(printFn, "children", i);
          if (childDoc !== "") sectionItems.push(childDoc);
        });
      }

      return group([
        [isStrict, visibility],
        indent([hardline, join(hardline, sectionItems)]),
      ]);
    }

    case "declField": {
      const rttiAttribute = printRttiAttributes(path, printFn, node);
      const name = group(
        join(
          [",", line],
          filterThenCallPrint(path, printFn, node, "", "name", [","]),
        ),
      );
      const type =
        filterThenCallPrint(path, printFn, node, "", "type")[0] ?? "";
      const defaultValue = filterThenCallPrint(
        path,
        printFn,
        node,
        "",
        "defaultValue",
      );

      return group([
        rttiAttribute,
        name,
        ":",
        line,
        type,
        defaultValue.length > 0 ? group(defaultValue[0]) : "",
        ";",
      ]);
    }

    case "declProp": {
      const rttiAttribute = printRttiAttributes(path, printFn, node);
      const isClass =
        filterChildrenTypeField(node, "kClass").length > 0 ? "class " : "";
      const name =
        filterThenCallPrint(path, printFn, node, "", "name")[0] ?? "";
      const args =
        filterThenCallPrint(path, printFn, node, "declPropArgs", "args")[0] ??
        "";
      const type =
        filterThenCallPrint(path, printFn, node, "", "type")[0] ?? "";

      const specifiers: Doc[] = [];
      let afterType = false;
      for (let i = 0; i < node.childCount; i++) {
        if (node.children[i].type === ";") break;
        if (node.fieldNameForChild(i) === "type") {
          afterType = true;
          continue;
        }
        if (!afterType) continue;
        withSkippedNodes([], () => {
          const text = path.call(printFn, "children", i);
          if (text !== "") specifiers.push(text);
        });
      }

      const procAttribute = printTrailingAttributes(path, printFn, node);

      return group([
        rttiAttribute,
        isClass,
        "property ",
        name,
        args,
        ": ",
        type,
        specifiers.length > 0
          ? indent(group([line, join(" ", specifiers)]))
          : "",
        ";",
        procAttribute !== "" ? [line, procAttribute] : "",
      ]);
    }

    case "declPropArgs": {
      const args = withSkippedNodes(["[", "]", ";"], () =>
        path
          .map(printFn, "children")
          .filter((child) => (child as Doc[]).length > 0),
      );
      return group(["[", join([";", line], args), "]"]);
    }

    case "declVariant": {
      const name =
        filterThenCallPrint(path, printFn, node, "", "name")[0] ?? "";
      const type =
        filterThenCallPrint(path, printFn, node, "", "type")[0] ?? "";
      const clauses: Doc[] = [];

      for (let i = 0; i < node.childCount; i++) {
        if (node.children[i].type === "declVariantClause") {
          withSkippedNodes([], () =>
            clauses.push(path.call(printFn, "children", i)),
          );
        }
      }

      const header = ["case ", name ? [name, ": "] : "", type, " of"];

      return group([
        header,
        indent([hardline, join([";", hardline], clauses)]),
      ]);
    }

    case "declVariantClause": {
      const label =
        filterThenCallPrint(path, printFn, node, "caseLabel")[0] ?? "";
      const items: Doc[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const child = node.children[i];
        if (child.type === "declField" || child.type === "declVariant") {
          withSkippedNodes([], () =>
            items.push(path.call(printFn, "children", i)),
          );
        }
      }

      return group([
        label,
        line,
        "(",
        indent([softline, join([";", line], items)]),
        softline,
        ")",
      ]);
    }

    // ================== DECLARATION ==================
    case "declTypes": {
      const items = withSkippedNodes([], () => {
        const list: Doc[] = [];
        for (let i = 1; i < node.childCount; i++) {
          list.push(path.call(printFn, "children", i));
        }
        return list;
      });
      return [hardline, indent(group(["type", line, join(line, items)]))];
    }

    case "declVars": {
      const header = [
        breakParent,
        filterChildrenTypeField(node, "kClass").length > 0 ? "class " : "",
        "var ",
      ];

      const body = withSkippedNodes(
        ["kClass", "kVar", "kThreadvar"],
        () => path.map(printFn, "children"),
        // .map((child) => (child === "" ? child : [group(child), hardline]))
      );

      return [header, indent([join(line, body)])];
    }

    case "declType": {
      const rttiAttribute = printRttiAttributes(path, printFn, node);
      const kGeneric = fetchTextByType(path, printFn, node, "kGeneric");
      const name = filterThenCallPrint(path, printFn, node, "", "name")[0];
      const type = filterThenCallPrint(path, printFn, node, "", "type");

      return group([
        rttiAttribute,
        kGeneric ? kGeneric.toString().toLowerCase() : "",
        kGeneric ? line : "",
        group([name, line, "="]),
        indent([line, type]),
        ";",
      ]);
    }

    case "declVar": {
      const rttiAttribute = printRttiAttributes(path, printFn, node);
      const name = group(
        join(
          [",", line],
          filterThenCallPrint(path, printFn, node, "", "name", [","]),
        ),
      );
      const type = filterThenCallPrint(path, printFn, node, "", "type")[0];
      const procAttribute = printTrailingAttributes(path, printFn, node);
      const typeString = printDocToString(type, {
        printWidth: 800,
        tabWidth: 2,
      });

      return group([
        rttiAttribute,
        name,
        ":",
        line,
        type,
        ";",
        line,
        procAttribute,
      ]);
    }

    case "declProc": {
      const rttiAttribute = printRttiAttributes(path, printFn, node);
      const name = filterThenCallPrint(path, printFn, node, "", "name");
      const kNodes = fetchTextByType(path, printFn, node, [
        "kGeneric",
        "kClass",
        "kProcedure",
        "kFunction",
        "kConstructor",
        "kDestructor",
      ]);

      const args =
        filterChildrenTypeField(node, "declArgs").length > 0
          ? filterThenCallPrint(path, printFn, node, "declArgs")
          : "";

      return [
        rttiAttribute,
        kNodes.get("kGeneric")
          ? `${kNodes.get("kGeneric")?.toString().toLowerCase()}`
          : "",
        kNodes.get("kGeneric") ? line : "",
        kNodes.get("kClass")
          ? `${kNodes.get("kClass")?.toString().toLowerCase()}`
          : "",
        kNodes.get("kClass") ? line : "",
        kNodes.get("kProcedure")?.toString().toLowerCase() ?? "",
        kNodes.get("kFunction")?.toString().toLowerCase() ?? "",
        kNodes.get("kConstructor")?.toString().toLowerCase() ?? "",
        kNodes.get("kDestructor")?.toString().toLowerCase() ?? "",
        group([line, name]),
        indent(group(args)),
        ";",
      ];
    }

    case "declArgs": {
      const args = withSkippedNodes(["(", ")", ";"], () =>
        path
          .map(printFn, "children")
          .filter((child) => (child as Doc[]).length > 0),
      );
      return group([
        "(",
        group([indent(group([softline, join([";", line], args)])), softline]),
        ")",
      ]);
    }

    case "declArg": {
      const name = group(
        join(
          [",", line],
          filterThenCallPrint(path, printFn, node, "", "name", [","]),
        ),
      );
      const type = filterThenCallPrint(path, printFn, node, "", "type")[0];
      const defaultValue = filterThenCallPrint(
        path,
        printFn,
        node,
        "",
        "defaultValue",
      );

      const argSpec = [
        filterChildrenTypeField(node, "kVar").length > 0 ? "var " : "",
        filterChildrenTypeField(node, "kConst").length > 0 ? "const " : "",
        filterChildrenTypeField(node, "kOut").length > 0 ? "out " : "",
        filterChildrenTypeField(node, "kConstref").length > 0
          ? "constref "
          : "",
      ].join("");

      return [
        argSpec,
        name,
        type
          ? group([
              " :",
              line,
              [type, defaultValue.length > 0 ? group(defaultValue) : ""],
            ])
          : "",
      ];
    }

    case "declLabels":
    case "declUses":
    case "declExports": {
      return withSkippedNodes([], () => {
        const kSection = path
          .call(printFn, "children", 0)
          .toString()
          .toLowerCase();
        const items = [];
        for (let i = 1; i < node.childCount; i++) {
          if ([",", ";"].includes(node.children[i].type)) continue;
          items.push(path.call(printFn, "children", i));
        }
        return indent(group([kSection, line, join([",", line], items), ";"]));
      });
    }

    case "declMetaClass": {
      const typeRef =
        filterThenCallPrint(path, printFn, node, "", "", [
          "kClass",
          "kOf",
        ])[0] ?? "";
      return group(["class of ", typeRef]);
    }

    case "declEnum": {
      const values = filterThenCallPrint(
        path,
        printFn,
        node,
        "declEnumValue",
        "",
        ["(", ")", ","],
      );
      return group([
        "(",
        indent([softline, join([",", line], values)]),
        softline,
        ")",
      ]);
    }

    case "declEnumValue": {
      const name =
        filterThenCallPrint(path, printFn, node, "", "name")[0] ?? "";
      const value = filterThenCallPrint(path, printFn, node, "", "value");
      return [name, value.length > 0 ? [" = ", group(value[0])] : ""];
    }

    case "declSet": {
      const type =
        filterThenCallPrint(path, printFn, node, "", "type", [
          "kSet",
          "kOf",
        ])[0] ?? "";
      return group(["set of ", type]);
    }

    case "declArray": {
      const isPacked =
        filterChildrenTypeField(node, "kPacked").length > 0 ? "packed " : "";
      const dimItems = collectBracketItems(path, printFn, node);

      const dimensions =
        dimItems.length > 0
          ? group([
              "[",
              indent([softline, join([",", line], dimItems)]),
              softline,
              "] ",
            ])
          : "";

      const type =
        filterThenCallPrint(path, printFn, node, "", "type", [
          "kPacked",
          "kArray",
          "kOf",
          "[",
          "]",
          ",",
        ])[0] ?? "";

      return group([isPacked, "array ", dimensions, "of ", type]);
    }

    case "declFile": {
      const type = filterThenCallPrint(path, printFn, node, "", "type", [
        "kFile",
        "kOf",
      ]);
      return group(["file", type.length > 0 ? [" of ", type[0]] : ""]);
    }

    case "declString": {
      const lenItems = collectBracketItems(path, printFn, node);
      const lengthDoc =
        lenItems.length > 0 ? group(["[", join(line, lenItems), "]"]) : "";
      return group(["string", lengthDoc]);
    }

    case "declProcRef": {
      const isReference =
        filterChildrenTypeField(node, "kReference").length > 0
          ? "reference to "
          : "";
      const kindMap = fetchTextByType(path, printFn, node, [
        "kProcedure",
        "kFunction",
      ]);
      const kind =
        [...kindMap.values()]
          .find((val) => val && (val as Doc[]).length > 0)
          ?.toString()
          .toLowerCase() ?? "procedure";

      const args =
        filterChildrenTypeField(node, "declArgs").length > 0
          ? filterThenCallPrint(path, printFn, node, "declArgs", "args")[0]
          : "";

      const returnType = filterThenCallPrint(path, printFn, node, "", "type", [
        "kReference",
        "kTo",
        "kProcedure",
        "kFunction",
        "declArgs",
        ":",
        "kOf",
        "kObject",
      ]);

      const isOfObject =
        filterChildrenTypeField(node, "kObject").length > 0 ? " of object" : "";

      return group([
        isReference,
        kind,
        args ? group(args) : "",
        returnType.length > 0 ? [": ", returnType[0]] : "",
        isOfObject,
      ]);
    }

    // ==================== TYPES ======================
    case "typeref": {
      const kSpecialize = filterThenCallPrint(
        path,
        printFn,
        node,
        "kSpecialize",
      );
      const kDeprecatedIdx =
        filterChildrenTypeField(node, "kDeprecated")[0] ?? -1;
      const parts: Doc[] = [];
      const deprecatedExpr: Doc[] = [];

      for (
        let i = 0;
        i < (kDeprecatedIdx >= 0 ? kDeprecatedIdx : node.childCount);
        i++
      ) {
        if (["kSpecialize", "kDeprecated", ";"].includes(node.children[i].type))
          continue;
        withSkippedNodes([], () =>
          parts.push(path.call(printFn, "children", i)),
        );
      }

      if (kDeprecatedIdx >= 0) {
        deprecatedExpr.push("deprecated");
        for (let i = kDeprecatedIdx + 1; i < node.childCount; i++) {
          if (
            ["kSpecialize", "kDeprecated", ";"].includes(node.children[i].type)
          )
            continue;
          withSkippedNodes([], () =>
            deprecatedExpr.push(path.call(printFn, "children", i)),
          );
        }
      }

      return group([
        kSpecialize,
        indent(
          group([
            kSpecialize.length > 0 ? line : "",
            join(line, parts),
            indent(
              group([
                kDeprecatedIdx >= 0 ? line : "",
                join(line, deprecatedExpr),
              ]),
            ),
          ]),
        ),
      ]);
    }

    // ================== EXPRESSION ===================
    case "exprBinary":
      return withSkippedNodes([], () =>
        fill([
          path.call(printFn, "children", 0),
          line,
          path.call(printFn, "children", 1),
          line,
          path.call(printFn, "children", 2),
        ]),
      );

    case "exprArgs":
      return group(
        join(
          [",", line],
          filterThenCallPrint(path, printFn, node, "", "", [","]),
        ),
      );

    case "exprBrackets": {
      const parts = group(
        join(
          [",", line],
          filterThenCallPrint(path, printFn, node, "", "", [",", "[", "]"]),
        ),
      );
      return group(["[", indent([softline, parts]), softline, "]"]);
    }

    case "exprCall": {
      let params = group(
        join(
          [",", line],
          filterThenCallPrint(path, printFn, node, "", "", [
            "identifier",
            "(",
            ")",
          ]),
        ),
      );

      if (filterChildrenTypeField(node, "(").length > 0) {
        params = group(["(", indent([softline, params]), softline, ")"]);
      }

      return group([node.children[0].text, params]);
    }

    // ================== STATEMENTS ===================
    case "assignment": {
      const lValue: Doc[] = [];
      const rValue: Doc[] = [];
      let idx = 0;

      const assignOps = new Set([
        "kAssign",
        "kAssignAdd",
        "kAssignSub",
        "kAssignMul",
        "kAssignDiv",
      ]);
      for (idx = 0; idx < node.childCount; idx++) {
        if (assignOps.has(node.children[idx].type)) {
          lValue.push([line, node.children[idx].text]);
          rValue.push(line);
          break;
        } else {
          withSkippedNodes([], () =>
            lValue.push(path.call(printFn, "children", idx)),
          );
        }
      }

      for (idx = idx + 1; idx < node.childCount; idx++) {
        withSkippedNodes([], () =>
          rValue.push(path.call(printFn, "children", idx)),
        );
      }

      return indent(group([lValue, indent(group(rValue))]));
    }

    case "statements": {
      return [
        join(
          [";", line],
          filterThenCallPrint(path, printFn, node, "", "", [";"]),
        ),
        "; ",
      ];
    }

    case "ifElse":
    case "if": {
      const condition = filterThenCallPrint(
        path,
        printFn,
        node,
        "",
        "condition",
      );
      const thenField = filterThenCallPrint(path, printFn, node, "", "then");
      const elseField = filterThenCallPrint(path, printFn, node, "", "else");

      const elseFieldGroup =
        elseField.length > 0 ? [line, "else", indent([line, elseField])] : "";

      return group([
        group(["if", indent([line, fill(condition), line, "then"])]),
        indent([line, thenField]),
        elseFieldGroup,
      ]);
    }

    case "while": {
      const condition = filterThenCallPrint(
        path,
        printFn,
        node,
        "",
        "condition",
      );

      const body = withSkippedNodes(
        [],
        () =>
          filterChildrenTypeField(node, "", "body").map((idx) =>
            path.call(printFn, "children", idx),
          )[0] ?? "",
      );

      return group([
        group(["while", indent([line, fill(condition), line, "do"])]),
        indent([line, body]),
      ]);
    }

    case "repeat": {
      const condition = filterThenCallPrint(
        path,
        printFn,
        node,
        "",
        "condition",
      );

      const conditionNodes = filterChildrenTypeField(node, "", "condition");
      const idxAfterCondition = conditionNodes[conditionNodes.length + 1] ?? -1;

      const body = withSkippedNodes(
        [],
        () =>
          filterChildrenTypeField(node, "", "body").map((idx) => {
            return path.call(printFn, "children", idx);
          })[0] ?? "",
      );

      const afterCondition = [];
      for (let i = idxAfterCondition; i < node.childCount; i++) {
        afterCondition.push(path.call(printFn, "children", i));
      }

      return group([
        group([
          "repeat",
          indent(group([line, body])),
          [softline, "until"],
          group([indent([line, condition])]),
        ]),
      ]);
    }

    case "for": {
      const start = filterThenCallPrint(path, printFn, node, "", "start");

      const end = filterThenCallPrint(path, printFn, node, "", "end");

      const body = withSkippedNodes(
        [],
        () =>
          filterChildrenTypeField(node, "", "body").map((idx) =>
            path.call(printFn, "children", idx),
          )[0] ?? "",
      );

      const kNodes = fetchTextByType(path, printFn, node, [
        "kTo",
        "kDownto",
        "kDo",
      ]);

      return [
        group([
          "for",
          line,
          start,
          line,
          (kNodes.get("kTo") as string).length > 0
            ? "to"
            : (kNodes.get("kDownto") as string).length > 0
              ? "downto"
              : "",
          line,
          end,
          line,
          (kNodes.get("kDo") as string).length > 0 ? "do" : "",
        ]),
        indent(group([line, body])),
      ];
    }

    case "foreach": {
      const iterator = filterThenCallPrint(path, printFn, node, "", "iterator");

      const iterable = filterThenCallPrint(path, printFn, node, "", "iterable");

      const body = withSkippedNodes(
        [],
        () =>
          filterChildrenTypeField(node, "", "body").map((idx) =>
            path.call(printFn, "children", idx),
          )[0] ?? "",
      );

      const kNodes = fetchTextByType(path, printFn, node, ["kIn", "kDo"]);

      return [
        group([
          "for",
          line,
          iterator,
          line,
          kNodes.has("kIn") ? "in" : "",
          line,
          iterable,
          line,
          kNodes.has("kDo") ? "do" : "",
        ]),
        indent(group([line, body])),
      ];
    }

    case "case":
    case "caseTr": {
      const kOfIdx = filterChildrenTypeField(node, "kOf")[0] ?? -1;
      const kOtherwiseIdx = filterChildrenTypeField(node, "kOtherwise")[0] ?? -1;
      const kElseIdx =
        filterChildrenTypeField(node, "kElse")[0] ??
        (kOtherwiseIdx >= 0 ? kOtherwiseIdx : -1);
      const kEndIdx =
        filterChildrenTypeField(node, "kEnd")[0] ?? node.childCount;

      console.log({ kOtherwiseIdx });
      console.log({ kElseIdx });

      const exprDocs: Doc[] = [];
      const exprEnd = kOfIdx !== -1 ? kOfIdx : node.childCount;
      for (let i = 0; i < exprEnd; i++) {
        const child = node.children[i];
        if (child.type === "kCase" || child.type === "comment") continue;
        withSkippedNodes([], () =>
          exprDocs.push(path.call(printFn, "children", i)),
        );
      }

      const caseClauses: Doc[] = [];
      const clausesEnd = kElseIdx !== -1 ? kElseIdx : kEndIdx;
      for (let i = kOfIdx + 1; i < clausesEnd; i++) {
        const child = node.children[i];
        if (child.type === "caseCase" || child.type === "caseCaseTr") {
          withSkippedNodes([], () =>
            caseClauses.push(path.call(printFn, "children", i)),
          );
        }
      }

      const elseDocs: Doc[] = [];
      if (kElseIdx !== -1) {
        for (let i = kElseIdx + 1; i < kEndIdx; i++) {
          const child = node.children[i];
          if (child.type === ":" || child.type === ";") continue;
          withSkippedNodes([], () => {
            const stmt = path.call(printFn, "children", i);
            if (stmt !== "") {
              if (child.type === "comment") {
                elseDocs.push(stmt);
              } else {
                const stmtStr = printDocToString(stmt, {
                  printWidth: 800,
                  tabWidth: 2,
                });
                elseDocs.push([
                  stmt,
                  stmtStr.formatted.endsWith(";") ? "" : ";",
                ]);
              }
            }
          });
        }
      }

      const headerDoc = group(["case ", fill(exprDocs), " of"]);

      const elseSection =
        kElseIdx !== -1
          ? [
              hardline,
              kOtherwiseIdx !== -1 ? "otherwise" : "else",
              indent([hardline, join(hardline, elseDocs)]),
            ]
          : "";

      return group([
        headerDoc,
        indent([hardline, join([";", hardline], caseClauses)]),
        elseSection,
        hardline,
        "end",
      ]);
    }

    case "caseCase":
    case "caseCaseTr": {
      const label =
        filterThenCallPrint(path, printFn, node, "caseLabel", "label")[0] ?? "";
      const body =
        filterThenCallPrint(path, printFn, node, "", "body")[0] ?? "";

      return group([label, indent([line, body])]);
    }

    case "caseLabel": {
      // Handles label lists preceding the colon: "1, 2, 5..10:"
      const items = filterThenCallPrint(path, printFn, node, "", "", [
        ",",
        ":",
      ]);

      return group([join([",", line], items), ":"]);
    }

    case "range": {
      // Handles subrange syntax inside labels or types: "1..10" or "'a'..'z'"
      return withSkippedNodes([".."], () =>
        join("..", path.map(printFn, "children")),
      );
    }

    case "exceptionHandler": {
      // return "===exceptionHandler";
      const variable =
        filterThenCallPrint(path, printFn, node, "", "variable") ?? "";
      const exception =
        filterThenCallPrint(path, printFn, node, "", "exception") ?? "";
      const body = filterThenCallPrint(path, printFn, node, "", "body") ?? "";

      return group([
        group(["on", line, group([variable, exception]), line, "do"]),
        indent(group([line, body])),
      ]);
    }

    case "try": {
      const tryBuilder: Doc[] = ["try"];
      const kNodes = fetchTextByType(path, printFn, node, [
        "kExcept",
        "kFinally",
        "kDo",
      ]);

      tryBuilder.push(
        group([
          indent([line, filterThenCallPrint(path, printFn, node, "", "try")]),
        ]),
      );

      if ((kNodes.get("kExcept") as string).length > 0) {
        tryBuilder.push(
          line,
          "except",
          group([
            indent([
              line,
              join(
                line,
                filterThenCallPrint(path, printFn, node, "exceptionHandler"),
              ),
            ]),
          ]),
        );
      }

      if ((kNodes.get("kFinally") as string).length > 0) {
        tryBuilder.push(
          line,
          "finally",
          group([
            indent([
              line,
              filterThenCallPrint(
                path,
                printFn,
                node,
                "statements",
                "finally",
                ["kFinally"],
              ),
            ]),
          ]),
        );
      }

      return tryBuilder;
    }

    // ===================== BLOCK =====================
    case "block": {
      const statements: Doc[] = [];
      const endTermination: Doc[] = [];

      for (let i = 0; i < node.childCount; i++) {
        const child = node.children[i];
        if (child.type === "kEnd") break;
        if (child.type === "kBegin" || child.type === ";") continue;

        withSkippedNodes([], () => {
          const statement = path.call(printFn, "children", i);
          const statementString = printDocToString(statement, {
            printWidth: 800,
            tabWidth: 2,
          });
          statements.push([
            statement,
            statementString.formatted.endsWith(";") ? "" : ";",
          ]);
        });
      }

      const endIdx = filterChildrenTypeField(node, "kEnd")[0];
      if (endIdx !== undefined) {
        for (let i = endIdx + 1; i < node.childCount; i++) {
          withSkippedNodes([], () =>
            endTermination.push(path.call(printFn, "children", i)),
          );
        }
      }

      return group([
        "begin",
        indent([hardline, join(line, statements)]),
        hardline,
        "end",
        endTermination,
      ]);
    }

    // ==================== COMMENT ====================
    case "comment":
      return group([line, node.text, hardline]);

    // ==================== DEFAULT ====================
    default:
      return withSkippedNodes([], () => {
        const ret = path.map(printFn, "children");
        return ret.length === 0 ? node.text || "" : ret;
      });
  }
}

export default {
  languages,
  parsers,
  printers,
  options,
};
