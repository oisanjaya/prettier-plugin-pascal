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

const {
  group,
  join,
  line,
  hardline,
  softline,
  indent,
  ifBreak,
  breakParent,
  lineSuffix,
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
  fieldName: string[];
}

interface AsLongFieldMarker {
  type: "asLongField";
  excludeMarker?: boolean;
  retryNode?: boolean;
  fieldName: string[];
}

type GroupMarker =
  NodeMarker | FieldMarker | AsLongFieldMarker | { type: "remaining" };

const SEPARATORS = [",", ";", ":"];

let parserInstance: Parser | null = null;
const slurpedNodes: number[] = [];

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

function notEmptyNode(node: Doc): boolean {
  if (node === "") return false;
  if (Array.isArray(node) && node.flat(5)[0] === "") return false;

  return true;
}

function pathCall(path: AstPath<TSNode>, printFn: PrintFn, idx: number): Doc {
  function getChildNextSibling(node: TSNode | null): TSNode | null {
    if (!node) return null;

    let childNextSibling = node?.child(idx + 1);
    let parentNode: TSNode | null | undefined = node;
    while (
      (childNextSibling === undefined || childNextSibling === null) &&
      parentNode !== undefined &&
      parentNode !== null
    ) {
      childNextSibling = parentNode?.nextSibling;
      parentNode = parentNode?.parent;
    }

    return childNextSibling;
  }

  const node = path.getNode();
  let childNextSibling = getChildNextSibling(node);
  const child = node?.child(idx);
  let nodeDoc = path.call(printFn, "children", idx);

  if (slurpedNodes.includes(child?.id ?? -1)) {
    return "";
  }

  while (
    !slurpedNodes.includes(childNextSibling?.id ?? -1) &&
    (SEPARATORS.includes(childNextSibling?.type ?? "") ||
      (childNextSibling?.type === "kEndDot" && child?.type === "kEnd") ||
      (childNextSibling?.type === "comment" &&
        childNextSibling.startPosition.row === child?.startPosition.row))
  ) {
    if (
      (SEPARATORS.includes(childNextSibling?.type ?? "") &&
        !slurpedNodes.includes(childNextSibling?.id ?? -1)) ||
      (childNextSibling?.type === "kEndDot" && child?.type === "kEnd")
    ) {
      slurpedNodes.push(childNextSibling?.id ?? -100);
      nodeDoc = group([nodeDoc, childNextSibling?.text ?? "", line]);
    } else if (
      childNextSibling?.type === "comment" &&
      childNextSibling.startPosition.row === child?.startPosition.row
    ) {
      slurpedNodes.push(childNextSibling?.id ?? -100);
      if (childNextSibling.text.startsWith("//")) {
        nodeDoc = group([
          nodeDoc,
          line,
          lineSuffix(childNextSibling?.text ?? ""),
        ]);
      } else {
        nodeDoc = group([nodeDoc, line, childNextSibling?.text ?? "", line]);
      }
    }

    childNextSibling = getChildNextSibling(childNextSibling);
  }

  return nodeDoc;
}

function buildGrouping(node: TSNode, targetTypes: GroupMarker[]) {
  const nodecollection: number[][] = [[]];
  let childState = 0;
  let lastChildFieldName: string | null = null;

  for (let i = 0; i < node?.childCount; i++) {
    const child = node.child(i);

    const currentTargetType = targetTypes[childState];

    if (
      (currentTargetType.type === "node" &&
        currentTargetType.markers.includes(child?.type ?? "")) ||
      (currentTargetType.type === "field" &&
        currentTargetType.fieldName.includes(
          node.fieldNameForChild(i) ?? "",
        )) ||
      (currentTargetType.type === "asLongField" &&
        currentTargetType.fieldName.includes(lastChildFieldName ?? "") &&
        !currentTargetType.fieldName.includes(node.fieldNameForChild(i) ?? ""))
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

    lastChildFieldName = node.fieldNameForChild(i);
  }

  return nodecollection;
}

function printNameWithType(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    {
      type: "field",
      excludeMarker: true,
      retryNode: true,
      fieldName: ["name"],
    },
    {
      type: "node",
      excludeMarker: true,
      retryNode: true,
      markers: [":", "kEq"],
    },
    { type: "node", markers: [":", "kEq"] },
    { type: "remaining" },
  ];

  const nodecollection = buildGrouping(node, targetTypes);

  const preGroup: Doc = [];
  const nameGroup: Doc = [];
  const postGroup: Doc = [];

  (nodecollection[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      preGroup.push(nodeItem);
    }
  });

  (nodecollection[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      nameGroup.push(nodeItem);
    }
  });

  (nodecollection[3] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      postGroup.push(nodeItem);
    }
  });

  return group([
    group(join(line, preGroup)),
    preGroup.length > 0 ? line : "",
    group([
      join(softline, nameGroup),
      pathCall(path, printFn, nodecollection[2][0]),
    ]),
    group(indent(join(line, postGroup))),
  ]);
}

function printCagedItems(
  path: AstPath<TSNode>,
  printFn: PrintFn,
  forceBreak = false,
  openinCage: string[],
  closingCage?: string[],
  beforeCageSeparator: Doc = softline,
  afterCageSeparator: Doc = softline,
): Doc {
  const node = path.getNode();
  if (!node) return "";

  const cageBoundaries: GroupMarker[] = [
    {
      type: "node",
      excludeMarker: true,
      retryNode: true,
      markers: openinCage,
    },
    { type: "node", markers: openinCage },
  ];

  if (closingCage !== undefined) {
    cageBoundaries.push({
      type: "node",
      excludeMarker: true,
      retryNode: true,
      markers: closingCage,
    });
    cageBoundaries.push({ type: "node", markers: closingCage });
  }

  cageBoundaries.push({ type: "remaining" });

  const groupingIndexes = buildGrouping(node, cageBoundaries);

  const headerGroup: Doc = [];
  const itemsGroup: Doc = [];
  const closingGroup: Doc = [];

  let firstItem = true;
  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      if (!firstItem) {
        headerGroup.push(line);
      }
      headerGroup.push(nodeItem);
      firstItem = false;
    }
  });

  headerGroup.push(beforeCageSeparator);

  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      headerGroup.push(nodeItem);
    }
  });

  headerGroup.push(afterCageSeparator);

  (groupingIndexes[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      itemsGroup.push(forceBreak ? hardline : softline);
      itemsGroup.push(nodeItem);
    }
  });

  if (closingCage !== undefined) {
    firstItem = true;
    (groupingIndexes[3] ?? []).forEach((i) => {
      const nodeItem = pathCall(path, printFn, i);
      if (notEmptyNode(nodeItem)) {
        if (!firstItem) {
          closingGroup.push(line);
        }
        firstItem = false;
        closingGroup.push(nodeItem);
      }
    });

    (groupingIndexes[4] ?? []).forEach((i) => {
      const nodeItem = pathCall(path, printFn, i);
      if (notEmptyNode(nodeItem)) {
        closingGroup.push("line");
        closingGroup.push(nodeItem);
      }
    });
  }

  return group([
    group(headerGroup),
    indent(group(itemsGroup)),
    softline,
    group(closingGroup),
  ]);
}

function printDeclProc(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const cageBoundaries: GroupMarker[] = [
    {
      type: "field",
      fieldName: ["name"],
    },
    {
      type: "field",
      fieldName: ["args"],
    },
    { type: "remaining" },
  ];

  const groupingIndexes = buildGrouping(node, cageBoundaries);

  let preGroup: Doc = [];
  const preGroupArr: Doc[] = [];
  const declArgsArr: Doc[] = [];
  const postGroupArr: Doc[] = [];

  let firstItem = true;
  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      if (!firstItem) {
        preGroupArr.push(line);
      }
      preGroupArr.push(nodeItem);
      firstItem = false;
    }
  });
  preGroup = group(preGroupArr);

  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      declArgsArr.push(nodeItem);
    }
  });

  firstItem = true;
  (groupingIndexes[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      if (!firstItem) {
        postGroupArr.push(softline);
      }
      postGroupArr.push(nodeItem);
      firstItem = false;
    }
  });

  return indent(
    group([
      preGroup,
      declArgsArr,
      postGroupArr.length > 0 ? softline : "",
      group(postGroupArr),
    ]),
  );
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
        // retDoc = group([
        //   group(["begin", line]),
        //   indent([
        //     softline,
        //     group(["writeln1", ";", line]),
        //     softline,
        //     group(["writeln2", ";", line]),
        //     softline,
        //     group(["writeln3", ";", line]),
        //   ]),
        //   softline,
        //   group(["end", ";", line]),
        // ]);

        // let retDoc = [];
        let firstItem = true;
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (notEmptyNode(nodeItem)) {
            if (!firstItem) {
              retDoc.push(line);
            }
            firstItem = false;
            retDoc.push(nodeItem);
          }
        }

        if (process.env.DEBUG_PASCAL_DOC) {
          console.log("finaldoc");
          console.log(JSON.stringify(retDoc));
        }

        retDoc = [retDoc, line];
        break;
      }
      case "declVars": {
        retDoc = printCagedItems(path, printFn, true, ["kVar"]);
        break;
      }
      case "declTypes": {
        retDoc = printCagedItems(path, printFn, true, ["kType"]);
        break;
      }
      case "declEnum":
      case "declArgs": {
        retDoc = printCagedItems(path, printFn, false, ["("], [")"]);
        break;
      }
      case "declProc": {
        retDoc = printDeclProc(path, printFn);
        break;
      }
      case "declType":
      case "declVar":
      case "declArg": {
        retDoc = printNameWithType(path, printFn);
        break;
      }
      case "typerefTpl": {
        retDoc = printCagedItems(path, printFn, false, ["kLt"], ["kGt"]);
        break;
      }
      case "typerefArgs": {
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (notEmptyNode(nodeItem)) {
            retDoc.push(nodeItem);
          }
        }
        break;
      }
      case "block": {
        retDoc = printCagedItems(
          path,
          printFn,
          false,
          ["kBegin"],
          ["kEnd"],
          softline,
          line,
        );
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
