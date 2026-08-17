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
  dedentToRoot,
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

interface UntilFieldChanges {
  type: "until-field-changes";
  excludeMarker?: boolean;
  retryNode?: boolean;
  fieldName: string[];
}

type GroupMarker =
  NodeMarker | FieldMarker | UntilFieldChanges | { type: "until-end" };

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

function getNextNodeInTree(node: TSNode | null | undefined): TSNode | null {
  if (!node) return null;

  let nodeNextSibling = node?.nextSibling;
  let parentNode: TSNode | null | undefined = node;
  while (
    (nodeNextSibling === undefined || nodeNextSibling === null) &&
    parentNode !== undefined &&
    parentNode !== null
  ) {
    nodeNextSibling = parentNode?.nextSibling;
    parentNode = parentNode?.parent;
  }

  return nodeNextSibling;
}

function pathCall(path: AstPath<TSNode>, printFn: PrintFn, idx: number): Doc {
  const node = path.getNode();
  const child = node?.child(idx);
  let childNextSibling = getNextNodeInTree(child);
  let nodeDoc = path.call(printFn, "children", idx);

  if (slurpedNodes.includes(child?.id ?? -1) || nodeDoc === "") {
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
      nodeDoc = group([
        nodeDoc,
        childNextSibling?.text ?? "",
        node?.type === "exceptionHandler" ? "" : line,
      ]);
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

    childNextSibling = getNextNodeInTree(childNextSibling);
  }

  return nodeDoc;
}

function buildGrouping(node: TSNode, targetTypes: GroupMarker[]) {
  const groups: number[][] = [[]];
  let groupIndex = 0;
  let lastChildFieldName: string | null = null;

  for (let i = 0; i < node?.childCount; i++) {
    const child = node.child(i);

    const currentTargetType = targetTypes[groupIndex];

    if (
      (currentTargetType.type === "node" &&
        currentTargetType.markers.includes(child?.type ?? "")) ||
      (currentTargetType.type === "field" &&
        currentTargetType.fieldName.includes(
          node.fieldNameForChild(i) ?? "",
        )) ||
      (currentTargetType.type === "until-field-changes" &&
        currentTargetType.fieldName.includes(lastChildFieldName ?? "") &&
        !currentTargetType.fieldName.includes(node.fieldNameForChild(i) ?? ""))
    ) {
      if (
        currentTargetType.excludeMarker === undefined ||
        currentTargetType.excludeMarker === false
      )
        groups[groupIndex].push(i);

      if (
        currentTargetType.retryNode !== undefined &&
        currentTargetType.retryNode === true
      )
        i--;

      groupIndex++;
      groups.push([]);
    } else {
      groups[groupIndex].push(i);
    }

    lastChildFieldName = node.fieldNameForChild(i);
  }

  return groups;
}

function printModule(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    { type: "node", excludeMarker: true, retryNode: false, markers: [";"] },
    { type: "until-end" },
  ];

  const headerGroup: Doc = [];
  const contentsGroup: Doc = [];

  const nodeGroups = buildGrouping(node, targetTypes);

  nodeGroups[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      headerGroup.push(nodeItem);
    }
  });

  nodeGroups[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      contentsGroup.push(nodeItem);
    }
  });

  if (headerGroup.length > 0 && contentsGroup.length > 0) {
    return group([
      group(join(line, headerGroup)),
      hardline,
      group(join(hardline, contentsGroup)),
    ]);
  } else {
    return "";
  }
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
    { type: "until-end" },
  ];

  const nodeGroups = buildGrouping(node, targetTypes);

  const preGroup: Doc = [];
  const nameGroup: Doc = [];
  let endGroup: Doc = [];
  const postGroup: Doc = [];

  (nodeGroups[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      preGroup.push(nodeItem);
    }
  });

  nodeGroups[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      nameGroup.push(nodeItem);
    }
  });

  const headerGroup = [
    join(softline, nameGroup),
    pathCall(path, printFn, nodeGroups[2][0]),
  ];

  (nodeGroups[3] ?? []).forEach((i) => {
    const nodeItem: Doc = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      postGroup.push(nodeItem);
    }
  });

  const joinedPostGroup = [];
  let firstItem = true;
  for (let i = 0; i < postGroup.length; i++) {
    const nodeItem = postGroup[i];
    if (nodeItem !== "") {
      if (!firstItem) {
        joinedPostGroup.push(line);
      }
      joinedPostGroup.push(nodeItem);
      firstItem = false;
    }
  }

  if (nameGroup.length > 0) {
    return group([
      group(join(line, preGroup)),
      preGroup.length > 0 ? line : "",
      group(headerGroup),
      group(indent(joinedPostGroup)),
      endGroup.length > 0 ? softline : "",
      group(endGroup),
    ]);
  } else {
    return "";
  }
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

  cageBoundaries.push({ type: "until-end" });

  const groupingIndexes = buildGrouping(node, cageBoundaries);

  const headerGroup: Doc = [];
  const itemsGroup: Doc = [];
  const closingGroup: Doc = [];

  let firstItem = true;
  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) {
        headerGroup.push(line);
      }
      headerGroup.push(nodeItem);
      firstItem = false;
    }
  });

  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      headerGroup.push(beforeCageSeparator);
      headerGroup.push(nodeItem);
      headerGroup.push(afterCageSeparator);
    }
  });

  groupingIndexes[2].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      itemsGroup.push(forceBreak ? hardline : softline);
      itemsGroup.push(nodeItem);
    }
  });

  if (closingCage !== undefined) {
    firstItem = true;
    (groupingIndexes[3] ?? []).forEach((i) => {
      const nodeItem = pathCall(path, printFn, i);
      if (nodeItem !== "") {
        if (!firstItem) {
          closingGroup.push(line);
        }
        firstItem = false;
        closingGroup.push(nodeItem);
      }
    });

    (groupingIndexes[4] ?? []).forEach((i) => {
      const nodeItem = pathCall(path, printFn, i);
      if (nodeItem !== "") {
        closingGroup.push(line);
        closingGroup.push(nodeItem);
      }
    });
  }

  if (headerGroup.length > 0 && itemsGroup.length > 0) {
    return group([
      group(headerGroup),
      indent(group(itemsGroup, { shouldBreak: forceBreak })),
      closingGroup.length > 0 ? softline : "",
      group(closingGroup),
    ]);
  } else {
    return "";
  }
}

function printHangingList(
  path: AstPath<TSNode>,
  printFn: PrintFn,
  headerMarkers: string[],
): Doc {
  const node = path.getNode();
  if (!node) return "";

  const cageBoundaries: GroupMarker[] = [
    { type: "node", markers: headerMarkers },
    { type: "until-end" },
  ];

  const groupingIndexes = buildGrouping(node, cageBoundaries);

  const headerGroup: Doc = [];
  const itemsGroup: Doc = [];

  let firstItem = true;
  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) {
        headerGroup.push(softline);
      }
      headerGroup.push(nodeItem);
      firstItem = false;
    }
  });

  headerGroup.push(softline);

  firstItem = true;
  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (firstItem) {
        itemsGroup.push(hardline);
      }
      firstItem = false;
      itemsGroup.push(nodeItem);
    }
  });

  if (headerGroup.length > 0 && itemsGroup.length > 0) {
    return group([group(headerGroup), indent(itemsGroup)]);
  } else {
    return "";
  }
}

function printDeclArray(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  let nodeHasRange = false;
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === "[") {
      nodeHasRange = true;
      break;
    }
  }

  let nodeGroups: number[][];

  if (nodeHasRange) {
    const targetTypes: GroupMarker[] = [
      {
        type: "node",
        markers: ["kArray"],
      },
      {
        type: "node",
        excludeMarker: true,
        retryNode: true,
        markers: ["kOf"],
      },
      { type: "until-end" },
    ];
    nodeGroups = buildGrouping(node, targetTypes);
  } else {
    const targetTypes: GroupMarker[] = [
      {
        type: "node",
        markers: ["kArray"],
      },
      { type: "until-end" },
    ];
    nodeGroups = buildGrouping(node, targetTypes);
    nodeGroups = [nodeGroups[0], [], nodeGroups[1]];
  }

  const preGroup: Doc = [];
  const rangeGroup: Doc = [];
  const postGroup: Doc = [];

  let firstItem = true;
  nodeGroups[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) preGroup.push(line);
      firstItem = false;
      preGroup.push(nodeItem);
    }
  });

  firstItem = true;
  nodeGroups[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) rangeGroup.push(softline);
      firstItem = false;
      rangeGroup.push(nodeItem);
    }
  });

  nodeGroups[2].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      postGroup.push(line);
      postGroup.push(nodeItem);
    }
  });

  if (nodeGroups.length > 0 && postGroup.length > 0) {
    return group([preGroup, rangeGroup, postGroup]);
  } else {
    return "";
  }
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
      type: "until-field-changes",
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
      type: "until-end",
    },
  ];

  const groupingIndexes = buildGrouping(node, cageBoundaries);

  let firstItem = true;
  let lastHeaderItemType = "";
  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
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

  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      sectionsGroup.push(nodeItem);
    }
  });

  (groupingIndexes[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      endGroup.push(nodeItem);
    }
  });

  firstItem = true;
  (groupingIndexes[3] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) {
        postGroup.push(line);
      }
      postGroup.push(nodeItem);
      firstItem = false;
    }
  });

  if (headerGroup.length > 0) {
    return group([
      indent([
        group(headerGroup),
        sectionsGroup.length > 0 ? line : softline,
        join(line, sectionsGroup),
      ]),
      softline,
      join(softline, endGroup),
      postGroup.length > 0 ? softline : "",
      join(softline, postGroup),
    ]);
  } else {
    return "";
  }
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
      type: "until-field-changes",
      fieldName: ["else"],
      excludeMarker: true,
      retryNode: true,
    },
    { type: "until-end" },
  ];

  const nodeGroups = buildGrouping(node, targetTypes);

  const ifGroup: Doc = [];
  const thenGroup: Doc = [];
  const elseGroup: Doc = [];
  const postGroup: Doc = [];

  nodeGroups[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      ifGroup.push(nodeItem);
    }
  });

  nodeGroups[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      thenGroup.push(nodeItem);
    }
  });

  (nodeGroups[3] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      elseGroup.push(nodeItem);
    }
  });

  (nodeGroups[4] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      postGroup.push(nodeItem);
    }
  });

  if (ifGroup.length > 0 && thenGroup.length > 0) {
    return group([
      group(join(line, ifGroup)),
      line,
      group(join(line, thenGroup)),
      elseGroup.length > 0 ? line : "",
      elseGroup.length > 0 ? pathCall(path, printFn, nodeGroups[2][0]) : "",
      elseGroup.length > 0 ? line : "",
      group(join(line, elseGroup)),
      postGroup.length > 0 ? line : "",
      group(join(line, postGroup)),
    ]);
  } else {
    return "";
  }
}

function printTry(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  let targetHandlerField = "except";
  for (let i = 0; i < node.childCount; i++) {
    if (node.fieldNameForChild(i) === "finally") {
      targetHandlerField = "finally";
      break;
    }
  }

  const targetTypes: GroupMarker[] = [
    {
      type: "field",
      excludeMarker: true,
      retryNode: true,
      fieldName: [targetHandlerField],
    },
    {
      type: "node",
      excludeMarker: true,
      retryNode: true,
      markers: ["kEnd"],
    },
    { type: "until-end" },
  ];

  const nodeGroups = buildGrouping(node, targetTypes);

  const tryGroup: Doc = [];
  const handlerGroup: Doc = [];
  const postGroup: Doc = [];

  let firstItem = true;
  nodeGroups[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) tryGroup.push(line);
      firstItem = false;
      tryGroup.push(nodeItem);
    }
  });

  firstItem = true;
  nodeGroups[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) handlerGroup.push(line);
      firstItem = false;
      handlerGroup.push(nodeItem);
    }
  });

  (nodeGroups[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      postGroup.push(nodeItem);
    }
  });

  if (tryGroup.length > 0 && handlerGroup.length > 0 && postGroup.length > 0) {
    return group([
      indent(group(tryGroup, { shouldBreak: true })),
      handlerGroup.length > 0 ? hardline : "",
      indent(group(handlerGroup, { shouldBreak: true })),
      line,
      group(postGroup),
    ]);
  } else {
    return "";
  }
}

function printWhile(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    {
      type: "node",
      markers: ["kDo"],
    },
    { type: "until-end" },
  ];

  const nodeGroups = buildGrouping(node, targetTypes);

  const whileGroup: Doc = [];
  const postGroup: Doc = [];

  let firstItem = true;
  nodeGroups[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) whileGroup.push(line);
      firstItem = false;
      whileGroup.push(nodeItem);
    }
  });

  (nodeGroups[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      postGroup.push(nodeItem);
    }
  });

  if (whileGroup.length > 0 && postGroup.length > 0) {
    return group([group(whileGroup), line, group(postGroup)]);
  } else {
    return "";
  }
}

function printCaseCase(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    {
      type: "node",
      markers: ["caseLabel"],
    },
    { type: "until-end" },
  ];

  const nodeGroups = buildGrouping(node, targetTypes);

  const preGroup: Doc = [];
  const postGroup: Doc = [];

  let firstItem = true;
  (nodeGroups[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) preGroup.push(line);
      firstItem = false;
      preGroup.push(nodeItem);
    }
  });

  firstItem = true;
  (nodeGroups[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) postGroup.push(line);
      firstItem = false;
      postGroup.push(nodeItem);
    }
  });

  if (preGroup.length > 0 && postGroup.length > 0) {
    return group([
      group(preGroup),
      indent(group([ifBreak(line, ""), postGroup])),
    ]);
  } else {
    return "";
  }
}

function printCase(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const cageBoundaries: GroupMarker[] = [
    {
      type: "node",
      excludeMarker: true,
      retryNode: true,
      markers: ["kOf"],
    },
    { type: "node", markers: ["kOf"] },
    {
      type: "node",
      excludeMarker: true,
      retryNode: true,
      markers: ["kEnd"],
    },
    { type: "node", markers: ["kEnd"] },
    { type: "until-end" },
  ];

  const groupingIndexes = buildGrouping(node, cageBoundaries);

  const headerGroup: Doc = [];
  const itemsGroup: Doc = [];
  const closingGroup: Doc = [];

  let firstItem = true;
  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) {
        headerGroup.push(line);
      }
      headerGroup.push(nodeItem);
      firstItem = false;
    }
  });

  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      headerGroup.push(line);
      headerGroup.push(nodeItem);
      headerGroup.push(line);
    }
  });

  groupingIndexes[2].forEach((i) => {
    if (["kElse", "kOtherwise"].includes(node.child(i)?.type ?? "")) {
      const elseStatement = pathCall(path, printFn, i + 1);
      slurpedNodes.push(node.child(i)?.nextSibling?.id ?? -100);
      itemsGroup.push(hardline);
      itemsGroup.push(
        group([
          group(node.child(i)?.text ?? ""),
          indent(group([line, elseStatement])),
        ]),
      );
    } else {
      const nodeItem = pathCall(path, printFn, i);
      if (nodeItem !== "") {
        itemsGroup.push(hardline);
        itemsGroup.push(nodeItem);
      }
    }
  });

  firstItem = true;
  (groupingIndexes[3] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) {
        closingGroup.push(line);
      }
      firstItem = false;
      closingGroup.push(nodeItem);
    }
  });

  (groupingIndexes[4] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      closingGroup.push(line);
      closingGroup.push(nodeItem);
    }
  });

  if (headerGroup.length > 0 && itemsGroup.length > 0) {
    return group([
      group(headerGroup),
      indent(group(itemsGroup, { shouldBreak: true })),
      closingGroup.length > 0 ? softline : "",
      group(closingGroup),
    ]);
  } else {
    return "";
  }
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
    { type: "until-end" },
  ];

  const groupingIndexes = buildGrouping(node, cageBoundaries);

  let preGroup: Doc = [];
  const preGroupArr: Doc[] = [];
  const declArgsArr: Doc[] = [];
  const postGroupArr: Doc[] = [];

  let firstItem = true;
  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) {
        preGroupArr.push(line);
      }
      preGroupArr.push(nodeItem);
      firstItem = false;
    }
  });

  if (preGroupArr.length > 0) preGroup = group(preGroupArr);

  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      declArgsArr.push(nodeItem);
    }
  });

  firstItem = true;
  (groupingIndexes[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) {
        postGroupArr.push(softline);
      }
      postGroupArr.push(nodeItem);
      firstItem = false;
    }
  });

  if (preGroupArr.length > 0) {
    return indent(
      group([
        preGroup,
        declArgsArr,
        postGroupArr.length > 0 ? softline : "",
        group(postGroupArr),
      ]),
    );
  } else {
    return "";
  }
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
    { type: "until-end" },
  ];

  const leftGroup: Doc = [];
  const rightGroup: Doc = [];

  const nodeGroups = buildGrouping(node, targetTypes);

  nodeGroups[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      leftGroup.push(nodeItem);
    }
  });

  (nodeGroups[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      rightGroup.push(nodeItem);
    }
  });

  if (leftGroup.length > 0) {
    return group([
      group(join(line, leftGroup)),
      pathCall(path, printFn, nodeGroups[1][0]),
      group(join(line, rightGroup)),
    ]);
  } else {
    return "";
  }
}

function printDefProc(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const headerGroup: Doc[] = [];
  const localGroup: Doc[] = [];
  const postGroup: Doc[] = [];

  const cageBoundaries: GroupMarker[] = [
    {
      type: "until-field-changes",
      excludeMarker: true,
      retryNode: true,
      fieldName: ["header"],
    },
    {
      type: "field",
      excludeMarker: true,
      retryNode: true,
      fieldName: ["body"],
    },
    {
      type: "until-end",
    },
  ];

  const groupingIndexes = buildGrouping(node, cageBoundaries);

  let firstItem = true;
  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) {
        headerGroup.push(line);
      }
      headerGroup.push(nodeItem);
      firstItem = false;
    }
  });

  firstItem = true;
  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) {
        localGroup.push(softline);
      }
      localGroup.push(nodeItem);
      firstItem = false;
    }
  });

  firstItem = true;
  (groupingIndexes[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeItem !== "") {
      if (!firstItem) {
        postGroup.push(line);
      }
      postGroup.push(nodeItem);
      firstItem = false;
    }
  });

  if (headerGroup.length > 0) {
    return group([
      group(headerGroup),
      localGroup.length > 0 ? softline : "",
      group(localGroup),
      postGroup.length > 0 ? softline : "",
      join(softline, postGroup),
    ]);
  } else {
    return "";
  }
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
  else if (["kDot", "kHat", "kAt", ".."].includes(node.type))
    retDoc = node.text;
  else if (["kGt", "kLt"].includes(node.type)) {
    if (["exprBinary", "operatorName"].includes(node.parent?.type ?? "")) {
      retDoc = [line, node.text, line];
    } else {
      retDoc = node.text;
    }
  } else if (node.type === "kIn" && (node.parent?.type ?? "") === "foreach") {
    retDoc = node.text;
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
          if (nodeItem !== "") {
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

        if (retDoc.length > 0) retDoc = [retDoc, line];
        else retDoc = "";
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
      case "for":
      case "for":
      case "foreach":
      case "with":
      case "while": {
        retDoc = printWhile(path, printFn);
        break;
      }
      case "repeat": {
        retDoc = printCagedItems(
          path,
          printFn,
          true,
          ["kRepeat"],
          ["kUntil"],
          softline,
          line,
        );
        break;
      }
      case "case": {
        retDoc = printCase(path, printFn);
        break;
      }
      case "caseCase": {
        retDoc = printCaseCase(path, printFn);
        break;
      }
      case "if":
      case "ifElse": {
        retDoc = printIfElse(path, printFn);
        break;
      }
      case "try": {
        retDoc = printTry(path, printFn);
        break;
      }
      case "exceptionHandler": {
        retDoc = printCagedItems(
          path,
          printFn,
          true,
          ["kDo"],
          undefined,
          line,
          line,
        );
        break;
      }
      case "exprArgs": {
        let firstItem = true;
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeItem !== "") {
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
      case "declConsts": {
        retDoc = printCagedItems(path, printFn, true, ["kConst"]);
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
        retDoc = printHangingList(path, printFn, ["kUses"]);
        break;
      }
      case "declLabels": {
        retDoc = printHangingList(path, printFn, ["kLabel"]);
        break;
      }
      case "declExports": {
        retDoc = printCagedItems(path, printFn, true, ["kExports"]);
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
      case "declProcRef":
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
          if (nodeItem !== "") {
            retDoc.push(nodeItem);
          }
        }
        break;
      }
      case "defProc": {
        retDoc = printDefProc(path, printFn);
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
      case "declExport":
      case "raise":
      case "label":
      case "goto": {
        let firstItem = true;
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeItem !== "") {
            if (!firstItem) {
              retDoc.push(line);
            }
            firstItem = false;
            retDoc.push(nodeItem);
          }
        }

        if (retDoc.length > 0)
          if (node.type === "label") {
            retDoc = dedentToRoot(group([line, retDoc], { shouldBreak: true }));
          } else {
            retDoc = group(retDoc);
          }

        break;
      }
      case "declArray": {
        retDoc = printDeclArray(path, printFn);
        break;
      }
      case "defaultValue":
      case "declConst":
      case "moduleName":
      case "typerefArgs":
      case "exprParens":
      case "typerefPtr":
      case "exprDot":
      case "statements":
      case "statement": {
        const retArr = [];
        for (let i = 0; i < node.childCount; i++) {
          const pathCallRes = pathCall(path, printFn, i);
          if (pathCallRes !== "") retArr.push(pathCallRes);
        }
        if (retArr.length > 0)
          retDoc = group(join(softline, retArr), {
            shouldBreak: node.type === "statements",
          });
        break;
      }
      case "range": {
        let firstItem = true;
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeItem !== "") {
            if (!firstItem) {
              retDoc.push(softline);
            }
            firstItem = false;
            retDoc.push(nodeItem);
          }
        }

        if (retDoc.length > 0) retDoc = group(retDoc);

        break;
      }
      case "literalString": {
        retDoc = node.text;
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
