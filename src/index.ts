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

type Parsers = Record<string, PrettierParser>;
type Printers = Record<string, Printer>;

interface NodeMarker {
  type: "node";
  excludeMarker?: boolean;
  retryNode?: boolean;
  markers: string[];
}

interface FieldMarker {
  type: "field";
  excludeMarker?: boolean;
  retryNode?: boolean;
  filedName: string[];
}

type GroupMarker = NodeMarker | FieldMarker | { type: "remaining" };

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

function printRoot(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const retDoc = join(line, path.map(printFn, "children"));

  if (process.env.DEBUG_PASCAL_DOC) {
    console.log("finaldoc");
    console.log(JSON.stringify(retDoc));
  }

  return [retDoc, line];
}

function printExprBrackets(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    { type: "node", excludeMarker: true, retryNode: true, markers: ["["] },
    { type: "node", markers: ["["] },
    { type: "node", excludeMarker: true, retryNode: true, markers: ["]"] },
    { type: "node", markers: ["]"] },
    { type: "remaining" },
  ];

  const nodecollection: number[][] = [[]];
  let childState = 0;

  for (let i = 0; i < node?.childCount; i++) {
    const child = node.child(i);

    const currentTargetType = targetTypes[childState];
    if (
      (currentTargetType.type === "node" &&
        currentTargetType.markers.includes(child?.type ?? "")) ||
      (currentTargetType.type === "field" &&
        currentTargetType.filedName.includes(node.fieldNameForChild(i) ?? ""))
    ) {
      if (
        currentTargetType.excludeMarker === undefined ||
        currentTargetType.excludeMarker === false
      )
        nodecollection[childState].push(i);

      if (
        currentTargetType.retryNode !== undefined &&
        currentTargetType.retryNode === true
      )
        i--;

      childState++;
      nodecollection.push([]);
    } else {
      nodecollection[childState].push(i);
    }
  }

  const headerGroup: Doc = [];
  const itemsGroup: Doc = [];
  const closingGroup: Doc = [];

  nodecollection[0].forEach((i) => {
    const nodeItem = path.call(printFn, "children", i);
    if (nodeItem !== "") {
      headerGroup.push(nodeItem);
    }
  });

  nodecollection[1].forEach((i) => {
    const nodeItem = path.call(printFn, "children", i);
    if (nodeItem !== "") {
      headerGroup.push(nodeItem);
    }
  });

  nodecollection[2].forEach((i) => {
    const nodeItem = path.call(printFn, "children", i);
    if (nodeItem !== "") {
      itemsGroup.push(nodeItem);
    }
  });

  nodecollection[3].forEach((i) => {
    const nodeItem = path.call(printFn, "children", i);
    if (nodeItem !== "") {
      closingGroup.push(nodeItem);
    }
  });

  nodecollection[4].forEach((i) => {
    const nodeItem = path.call(printFn, "children", i);
    if (nodeItem !== "") {
      closingGroup.push(nodeItem);
    }
  });

  return group([
    indent([group(join(softline, headerGroup)), itemsGroup]),
    softline,
    group(closingGroup),
  ]);
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

  let retDoc: Doc = [];

  if (!node?.type) retDoc = "";
  else if (["kDot", "kHat", "kAt"].includes(node.type)) retDoc = node.text;
  else if (["kGt", "kLt"].includes(node.type)) {
    if (["exprBinary", "operatorName"].includes(node.parent?.type ?? "")) {
      retDoc = [line, node.text, line];
    } else {
      retDoc = node.text;
    }
  } else if (
    [
      "kEq",
      "kNeq",
      "kLte",
      "kGte",
      "kAdd",
      "kSub",
      "kMul",
      "kFdiv",
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
    retDoc = [line, node.text, line];
  } else if ([":", ";", ","].includes(node.type)) retDoc = [node.text, line];
  else {
    switch (node.type) {
      case "root": {
        retDoc = printRoot(path, printFn);
        break;
      }
      case "exprBrackets": {
        retDoc = printExprBrackets(path, printFn);
        break;
      }
      default: {
        const ret = join(line, path.map(printFn, "children"));
        retDoc = ret.length === 0 ? node.text || "" : ret;
        break;
      }
    }
  }

  return retDoc;
}

export default {
  languages,
  parsers,
  printers,
  options,
};
