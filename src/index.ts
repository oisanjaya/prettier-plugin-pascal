import { Parser, Node as TSNode } from "web-tree-sitter";
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

type PrintFn = (path: AstPath<TSNode>) => Doc;

type GroupingType = "normal" | "indented";

// Doc traversal and grouping. 
// each print...() function has their own state for clarity
interface GroupState {
  retDoc: Doc[];
  groupedRetDoc: Doc[];
  endGroupMarker: (string | undefined)[] | "use_field";
  endGroupMarkerField: string;
  groupingType: GroupingType;
  groupingSeparator: Doc;
  targetChildField: number[];
}

function createGroupState(): GroupState {
  return {
    retDoc: [],
    groupedRetDoc: [],
    endGroupMarker: [undefined],
    endGroupMarkerField: "",
    groupingType: "normal",
    groupingSeparator: softline,
    targetChildField: [],
  };
}

function pushChildNode(
  state: GroupState,
  child: TSNode,
  childDoc: Doc,
  skipMarkerNode: (string | undefined)[] | boolean = false,
  resetEndGroupMarker = true,
  noSeparatorBeforeStandardSeparator = false,
): boolean {
  const joinChildren = (childDocs: Doc[]): Doc[] => {
    const retJoin: Doc[] = [];
    let firstChild = true;
    let previousIsStandardOperator = false;

    childDocs.forEach((doc, idx) => {
      const childStr = printDocToString(doc, {
        printWidth: 80,
        tabWidth: 2,
      });
      const thisIsStandardSeparator = [":", ";", ","].includes(
        childStr.formatted.trim(),
      );

      if (
        !firstChild &&
        (!noSeparatorBeforeStandardSeparator ||
          (!thisIsStandardSeparator && !previousIsStandardOperator))
      ) {
        retJoin.push(state.groupingSeparator);
      }

      firstChild = firstChild && childStr.formatted.trim().length < 1;
      retJoin.push(doc);
      previousIsStandardOperator = thisIsStandardSeparator;
    });

    return retJoin;
  };

  if (state.endGroupMarker[0] === undefined) {
    state.retDoc.push(childDoc);
  } else {
    if (
      skipMarkerNode === false ||
      !(
        Array.isArray(skipMarkerNode) ? skipMarkerNode : state.endGroupMarker
      ).includes(child.type) ||
      (state.endGroupMarker === "use_field" &&
        !state.targetChildField.includes(child.id))
    ) {
      state.groupedRetDoc.push(childDoc);
    }
  }

  if (
    state.endGroupMarker[0] !== undefined &&
    (state.endGroupMarker.includes(child.type) ||
      state.targetChildField.includes(child.id))
  ) {
    if (resetEndGroupMarker) {
      state.endGroupMarkerField = "";
      state.endGroupMarker = [undefined];
    }

    if (state.groupingType === "indented") {
      state.retDoc.push(indent(group(joinChildren(state.groupedRetDoc))));
    } else {
      state.retDoc.push(group(joinChildren(state.groupedRetDoc)));
    }

    state.groupedRetDoc = [];
    return true;
  }

  return false;
}

function listRetDoc(
  node: TSNode,
  path: AstPath<TSNode>,
  printFn: PrintFn,
  state: GroupState,
  separator: string = ",",
): Doc[] {
  state.endGroupMarker = [separator];
  state.groupingSeparator = line;
  state.retDoc = [softline];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (
      pushChildNode(
        state,
        child,
        path.call(printFn, "children", i),
        true,
        false,
      )
    ) {
      state.retDoc[state.retDoc.length - 1] = group([
        state.retDoc[state.retDoc.length - 1],
        ",",
        line,
      ]);
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(state.groupedRetDoc);
    state.groupedRetDoc = [];
  }

  return state.retDoc;
}

function printRoot(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const state = createGroupState();
  const node = path.getNode();
  if (!node) return "";

  for (let i = 0; i < node.childCount; i++) {
    state.retDoc.push(path.call(printFn, "children", i));
  }

  if (process.env.DEBUG_PASCAL_DOC) {
    console.log("finaldoc");
    console.log(JSON.stringify(state.retDoc));
  }

  return [state.retDoc, line];
}

function printModule(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (["kProgram", "kLibrary", "kUnit"].includes(child.type)) {
      state.endGroupMarker = [";"];
      state.groupingSeparator = line;
    }

    if (["block"].includes(child.type)) {
      state.endGroupMarker = ["==remaining"];
      state.groupingSeparator = line;
    }

    if (pushChildNode(state, child, path.call(printFn, "children", i), true)) {
      state.retDoc.push(";", hardline);
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(hardline, hardline, state.groupedRetDoc);
  }

  return state.retDoc;
}

function printBlock(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();
  state.groupingType = "indented";

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child || child.type === ";") continue;

    let statement = path.call(printFn, "children", i);

    if (child.nextSibling?.type === ";") {
      statement = group([statement, child.nextSibling.text]);
    }

    if (pushChildNode(state, child, statement, true, true)) {
      i--;
      state.endGroupMarker = [undefined];
    }

    if (child.type === "kBegin") {
      state.groupedRetDoc = [line];
      state.endGroupMarker = ["kEnd"];
    }
    if (child.type === "kEnd") {
      state.groupingSeparator = softline;
      state.groupedRetDoc = [line, child.text];
      state.endGroupMarker = ["==remaining"];
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(state.groupedRetDoc);
  }

  return state.retDoc;
}

function printDeclProc(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();
  state.endGroupMarker = "use_field";
  state.groupingSeparator = line;
  state.groupingType = "indented";
  state.targetChildField = node
    .childrenForFieldName("name")
    .map((item) => item.id);

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (
      pushChildNode(
        state,
        child,
        path.call(printFn, "children", i),
        false,
        true,
        true,
      )
    ) {
      state.endGroupMarker = ["==remaining"];
      state.groupingSeparator = softline;
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(group(state.groupedRetDoc));
    state.groupedRetDoc = [];
  }

  return state.retDoc;
}

function printDeclVar(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();
  state.endGroupMarker = [":"];
  state.groupingSeparator = line;
  state.groupingType = "indented";

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (
      pushChildNode(
        state,
        child,
        path.call(printFn, "children", i),
        true,
        false,
        true,
      )
    ) {
      state.retDoc.push(state.endGroupMarker[0] ?? "", " ");
      if (state.endGroupMarker[0] === ":") {
        state.groupingType = "indented";
        state.endGroupMarker = [";"];
      } else {
        state.endGroupMarker = [undefined];
      }
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(group(state.groupedRetDoc));
    state.groupedRetDoc = [];
  }

  return group(state.retDoc);
}

function printDeclVars(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();
  state.endGroupMarker = ["declVar"];
  state.groupingSeparator = line;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (
      pushChildNode(state, child, path.call(printFn, "children", i), [
        state.endGroupMarker[0] ?? "",
      ])
    ) {
      i--;
      state.endGroupMarker = ["==remaining"];
      state.groupingSeparator = line;
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(indent([hardline, join(hardline, state.groupedRetDoc)]));
    state.groupedRetDoc = [];
  }

  return [hardline, state.retDoc, hardline];
}

function printDefProc(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();
  const headerChild = node
    .childrenForFieldName("header")
    .map((item) => item.id);
  const localChild = node.childrenForFieldName("local").map((item) => item.id);
  const bodyChild = node.childrenForFieldName("body").map((item) => item.id);

  let lastField = "";
  state.groupedRetDoc = [];
  state.retDoc = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    const currentField = headerChild.includes(child.id)
      ? "header"
      : localChild.includes(child.id)
        ? "local"
        : bodyChild.includes(child.id)
          ? "body"
          : "";

    if (currentField !== lastField) {
      if (state.groupedRetDoc.length > 0) {
        state.retDoc.push(group(state.groupedRetDoc));
        state.groupedRetDoc = [];
      }
      lastField = currentField;
      state.groupedRetDoc.push(path.call(printFn, "children", i));
    } else if (currentField === "") {
      state.retDoc.push(path.call(printFn, "children", i));
    } else {
      state.groupedRetDoc.push(path.call(printFn, "children", i));
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(group(state.groupedRetDoc));
    state.groupedRetDoc = [];
  }

  return group(indent([hardline, state.retDoc]));
}

function printTyperefTpl(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    state.groupingSeparator = softline;
    state.groupingType = "indented";

    if (!child) continue;

    if (
      pushChildNode(state, child, path.call(printFn, "children", i), true, true)
    ) {
      i--;
    }

    if (child.type === "kLt") {
      state.endGroupMarker = ["kGt"];
    }
  }

  return state.retDoc;
}

// ============================================================================
// MAIN PRINTER FUNCTION
// ============================================================================

export function printNode(
  path: AstPath<TSNode>,
  options: object,
  printFn: PrintFn,
): Doc {
  const node = path.getNode();
  if (!node) return "";

  if (!node?.type) return "";
  if (["kDot", "kHat"].includes(node.type)) return node.text;
  if (["kGt", "kLt"].includes(node.type)) {
    if (["exprBinary", "operatorName"].includes(node.parent?.type ?? "")) {
      return [line, node.text, line];
    }
    return node.text;
  }
  if (
    [
      "kEq",
      "kNeq",
      "kLte",
      "kGte",
      "kAdd",
      "kSub",
      "kMul",
      "kFdiv",
      "kAt",
      "kAssign",
      "kAssignAdd",
      "kAssignSub",
      "kAssignMul",
      "kAssignDiv",
      "kOr",
      "kXor",
      "kDiv",
      "kMod",
      "kAnd",
      "kShl",
      "kShr",
      "kNot",
      "kIs",
      "kAs",
      "kIn",
    ].includes(node.type)
  ) {
    return [line, node.text, line];
  }
  if ([":", ";", ","].includes(node.type)) return [node.text, line];

  switch (node.type) {
    case "root":
      return printRoot(path, printFn);
    case "unit":
    case "library":
    case "program":
      return printModule(path, printFn);
    case "block":
      return printBlock(path, printFn);
    case "moduleName":
      return group(path.map(printFn, "children"));
    case "declProc":
      return printDeclProc(path, printFn);
    case "declArg":
    case "declVar":
      return printDeclVar(path, printFn);
    case "declVars":
      return printDeclVars(path, printFn);
    case "defProc":
      return printDefProc(path, printFn);
    case "typerefTpl":
      return printTyperefTpl(path, printFn);
    case "statement":
    case "exprCall":
    case "exprParens":
    case "exprBinary":
      return group(join(softline, path.map(printFn, "children")));
    case "declArgs": {
      const state = createGroupState();
      return listRetDoc(node, path, printFn, state, ";");
    }
    case "typerefArgs": {
      const state = createGroupState();
      return listRetDoc(node, path, printFn, state);
    }
    case "typeref":
      return group(join(line, path.map(printFn, "children")));
    case "ifElse":
    case "typerefPtr":
      return group(join(softline, path.map(printFn, "children")));
    default: {
      const ret = join(line, path.map(printFn, "children"));
      return ret.length === 0 ? node.text || "" : ret;
    }
  }
}

export default {
  languages,
  parsers,
  printers,
  options,
};
