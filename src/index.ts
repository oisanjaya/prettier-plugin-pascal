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
  if (Array.isArray(node) && node.length === 0) return false;
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

function printModule(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    { type: "node", excludeMarker: true, retryNode: false, markers: [";"] },
    { type: "remaining" },
  ];

  const headerGroup: Doc = [];
  const contentsGroup: Doc = [];

  const nodecollection = buildGrouping(node, targetTypes);

  (nodecollection[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      headerGroup.push(nodeItem);
    }
  });

  (nodecollection[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      contentsGroup.push(nodeItem);
    }
  });

  return group([
    group(join(line, headerGroup)),
    hardline,
    group(join(hardline, contentsGroup)),
  ]);
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
  let endGroup: Doc = [];
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

  const headerGroup = [
    join(softline, nameGroup),
    pathCall(path, printFn, nodecollection[2][0]),
  ];

  (nodecollection[3] ?? []).forEach((i) => {
    const nodeItem: Doc = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      postGroup.push(nodeItem);
    }
  });

  const joinedPostGroup = [];
  let firstItem = true;
  for (let i = 0; i < postGroup.length; i++) {
    const nodeItem = postGroup[i];
    if (notEmptyNode(nodeItem)) {
      if (!firstItem) {
        joinedPostGroup.push(line);
      }
      joinedPostGroup.push(nodeItem);
      firstItem = false;
    }
  }

  return group([
    group(join(line, preGroup)),
    preGroup.length > 0 ? line : "",
    group(headerGroup),
    group(indent(joinedPostGroup)),
    endGroup.length > 0 ? softline : "",
    group(endGroup),
  ]);
}

function printCagedItems(
  path: AstPath<TSNode>,
  printFn: PrintFn,
  forceBreak: boolean,
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
        closingGroup.push(line);
        closingGroup.push(nodeItem);
      }
    });
  }

  return group([
    group(headerGroup),
    indent(group(itemsGroup, { shouldBreak: forceBreak })),
    closingGroup.length > 0 ? softline : "",
    group(closingGroup),
  ]);
}

function printUses(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const cageBoundaries: GroupMarker[] = [
    { type: "node", markers: ["kUses"] },
    { type: "remaining" },
  ];

  const groupingIndexes = buildGrouping(node, cageBoundaries);

  const headerGroup: Doc = [];
  const itemsGroup: Doc = [];

  let firstItem = true;
  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      if (!firstItem) {
        headerGroup.push(softline);
      }
      headerGroup.push(nodeItem);
      firstItem = false;
    }
  });

  headerGroup.push(softline);

  firstItem = true;
  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      if (firstItem) {
        itemsGroup.push(hardline);
      }
      firstItem = false;
      itemsGroup.push(nodeItem);
    }
  });

  return group([group(headerGroup), indent(itemsGroup)]);
}

function printDeclClass(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const headerGroup: Doc[] = [];
  const sectionsGroup: Doc[] = [];
  const endGroup: Doc[] = [];
  const postGroup: Doc[] = [];

  const cageBoundaries: GroupMarker[] = [
    {
      type: "asLongField",
      excludeMarker: true,
      retryNode: true,
      fieldName: ["parent"],
    },
    {
      type: "node",
      excludeMarker: true,
      retryNode: true,
      markers: ["kEnd"],
    },
    {
      type: "node",
      markers: ["kEnd"],
    },
    {
      type: "remaining",
    },
  ];

  const groupingIndexes = buildGrouping(node, cageBoundaries);

  let firstItem = true;
  let lastHeaderItemType = "";
  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      if (
        !firstItem &&
        !["(", ")"].includes(node.child(i)?.type ?? "") &&
        !["(", ")"].includes(lastHeaderItemType)
      ) {
        headerGroup.push(line);
      }
      headerGroup.push(nodeItem);
      firstItem = false;
      lastHeaderItemType = node.child(i)?.type ?? "";
    }
  });

  firstItem = true;
  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      if (!firstItem) {
        sectionsGroup.push(line);
      }
      sectionsGroup.push(nodeItem);
      firstItem = false;
    }
  });

  (groupingIndexes[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      endGroup.push(nodeItem);
    }
  });

  firstItem = true;
  (groupingIndexes[3] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (notEmptyNode(nodeItem)) {
      if (!firstItem) {
        postGroup.push(line);
      }
      postGroup.push(nodeItem);
      firstItem = false;
    }
  });

  return group([
    indent([
      group(headerGroup),
      sectionsGroup.length > 0 ? line : softline,
      join(line, sectionsGroup),
    ]),
    softline,
    join(softline, endGroup),
    softline,
    join(softline, postGroup),
  ]);
}

function printIfElse(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    {
      type: "node",
      markers: ["kThen"],
    },
    {
      type: "node",
      excludeMarker: true,
      retryNode: true,
      markers: ["kElse"],
    },
    {
      type: "node",
      markers: ["kElse"],
    },
    {
      type: "asLongField",
      fieldName: ["else"],
      excludeMarker: true,
      retryNode: true,
    },
    { type: "remaining" },
  ];

  const nodecollection = buildGrouping(node, targetTypes);

  const ifGroup: Doc = [];
  const thenGroup: Doc = [];
  const elseGroup: Doc = [];
  const postGroup: Doc = [];

  (nodecollection[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      ifGroup.push(nodeItem);
    }
  });

  (nodecollection[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      thenGroup.push(nodeItem);
    }
  });

  (nodecollection[3] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      elseGroup.push(nodeItem);
    }
  });

  (nodecollection[4] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      postGroup.push(nodeItem);
    }
  });

  return group([
    group(join(line, ifGroup)),
    line,
    group(join(line, thenGroup)),
    line,
    pathCall(path, printFn, nodecollection[2][0]),
    line,
    group(join(line, elseGroup)),
    postGroup.length > 0 ? line : "",
    group(join(line, postGroup)),
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

function printBinaryExp(
  path: AstPath<TSNode>,
  printFn: PrintFn,
  infix: string[],
): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    { type: "node", excludeMarker: true, retryNode: true, markers: infix },
    { type: "node", markers: infix },
    { type: "remaining" },
  ];

  const leftGroup: Doc = [];
  const rightGroup: Doc = [];

  const nodecollection = buildGrouping(node, targetTypes);

  (nodecollection[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      leftGroup.push(nodeItem);
    }
  });

  (nodecollection[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      rightGroup.push(nodeItem);
    }
  });

  return group([
    group(join(line, leftGroup)),
    pathCall(path, printFn, nodecollection[1][0]),
    group(join(line, rightGroup)),
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
  else if (slurpedNodes.includes(node.id)) retDoc = "";
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
      case "program":
      case "library":
      case "unit": {
        retDoc = printModule(path, printFn);
        break;
      }
      case "exprBinary": {
        retDoc = printBinaryExp(path, printFn, [
          "kLt",
          "kLt",
          "kEq",
          "kNeq",
          "kGt",
          "kLte",
          "kGte",
          "kIn",
          "kIs",
          "kAdd",
          "kSub",
          "kOr",
          "kXor",
          "kMul",
          "kFdiv",
          "kDiv",
          "kMod",
          "kAnd",
          "kShl",
          "kShr",
        ]);
        break;
      }

      case "exprUnary": {
        retDoc = printBinaryExp(path, printFn, [
          "kNot",
          "kAdd",
          "kSub",
          "kAt",
          "kHat",
        ]);
        break;
      }
      case "assignment": {
        retDoc = printBinaryExp(path, printFn, [
          "kAssign",
          "kAssignAdd",
          "kAssignSub",
          "kAssignMul",
          "kAssignDiv",
        ]);
        break;
      }
      case "ifElse": {
        retDoc = printIfElse(path, printFn);
        break;
      }
      case "exprArgs": {
        let firstItem = true;
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (notEmptyNode(nodeItem)) {
            if (!firstItem) {
              retDoc.push(softline);
            }
            firstItem = false;
            retDoc.push(nodeItem);
          }
        }

        break;
      }
      case "declSection": {
        retDoc = printCagedItems(path, printFn, true, [
          "kStrict",
          "kPublished",
          "kPublic",
          "kProtected",
          "kPrivate",
        ]);
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
      case "declUses": {
        retDoc = printUses(path, printFn);
        break;
      }
      case "exprBrackets": {
        retDoc = printCagedItems(path, printFn, false, ["["], ["]"]);
        break;
      }
      case "exprCall":
      case "declEnum":
      case "declArgs": {
        retDoc = printCagedItems(path, printFn, false, ["("], [")"]);
        break;
      }
      case "declClass": {
        retDoc = printDeclClass(path, printFn);
        break;
      }
      case "declProc": {
        retDoc = printDeclProc(path, printFn);
        break;
      }
      case "declProp":
      case "declField":
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
          true,
          ["kBegin"],
          ["kEnd"],
          softline,
          line,
        );
        break;
      }
      case "moduleName":
      case "typerefArgs":
      case "exprParens":
      case "typerefPtr":
      case "exprDot":
      case "statement": {
        const retArr = [];
        for (let i = 0; i < node.childCount; i++) {
          const pathCallRes = pathCall(path, printFn, i);
          if (pathCallRes !== "") retArr.push(pathCallRes);
        }
        retDoc = group(join(softline, retArr));
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
