import { Parser, Node as TSNode } from "web-tree-sitter";
import { loadPascalParser } from "./treeSitterLoader.js";

import prettier, {
  Parser as PrettierParser,
  Printer,
  SupportLanguage as Language,
  SupportOption,
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
  dedent,
  ifBreak,
  dedentToRoot,
  lineSuffix,
} = prettier.doc.builders;

type Parsers = Record<string, PrettierParser>;
type Printers = Record<string, Printer>;

interface PrinterState {
  slurpedNodesByTree: Set<number>;
}

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
  fieldNames: string[];
}

type GroupMarker =
  NodeMarker | FieldMarker | UntilFieldChanges | { type: "until-end" };

const SEPARATORS = new Set([",", ";", ":"]);
const BINARY_OPERATORS = [
  "kAs",
  "kAdd",
  "kAnd",
  "kDiv",
  "kEq",
  "kFdiv",
  "kGt",
  "kGte",
  "kIn",
  "kIs",
  "kIsNot",
  "kLt",
  "kLte",
  "kMod",
  "kMul",
  "kNeq",
  "kNotIn",
  "kOr",
  "kShl",
  "kShr",
  "kSub",
  "kXor",
];
const UNARY_OPERATORS = ["kAdd", "kAt", "kHat", "kNot", "kSub"];
const ASSIGNMENT_OPERATORS = [
  "kAssign",
  "kAssignAdd",
  "kAssignDiv",
  "kAssignMul",
  "kAssignSub",
];
const INLINE_OPERATORS = [
  ...BINARY_OPERATORS,
  ...UNARY_OPERATORS,
  ...ASSIGNMENT_OPERATORS,
];
const DECLARABLE_OPERATORS = [
  "kAdd",
  "kAnd",
  "kAssign",
  "kDiv",
  "kDot",
  "kEq",
  "kFdiv",
  "kGt",
  "kGte",
  "kIn",
  "kLt",
  "kLte",
  "kMod",
  "kMul",
  "kNeq",
  "kNot",
  "kOr",
  "kShl",
  "kShr",
  "kSub",
  "kXor",
];

let parserInstance: Parser | null = null;
const printerState = new Map<number, PrinterState>();

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
export const options: Record<string, SupportOption> = {};

type PrintFn = (path: AstPath<TSNode>) => Doc;

function getRootNode(node: TSNode): TSNode {
  let root = node;

  while (root.parent) {
    root = root.parent;
  }

  return root;
}

function getSlurpedNodes(node: TSNode): Set<number> {
  const root = getRootNode(node);

  let curState = printerState.get(root.id);

  if (!curState) {
    curState = {
      slurpedNodesByTree: new Set<number>(),
    };
    printerState.set(root.id, curState);
  }

  return curState.slurpedNodesByTree;
}

function getNextNodeInTraversal(
  node: TSNode | null | undefined,
): TSNode | null {
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

function nodeIsNotEmpty(nodeItem: any): boolean {
  return nodeItem !== "" && !(Array.isArray(nodeItem) && nodeItem.length === 0);
}

function pathCall(path: AstPath<TSNode>, printFn: PrintFn, idx: number): Doc {
  const node = path.getNode();

  if (!node) {
    return "";
  }

  const slurpedNodes = getSlurpedNodes(node);
  const child = node.child(idx);

  let childNextSibling = getNextNodeInTraversal(child);
  let nodeDoc = path.call(printFn, "children", idx);

  if (slurpedNodes.has(child?.id ?? -1) || nodeDoc === "") {
    return "";
  }

  while (
    !slurpedNodes.has(childNextSibling?.id ?? -1) &&
    (SEPARATORS.has(childNextSibling?.type ?? "") ||
      (childNextSibling?.type === "kEndDot" && child?.type === "kEnd") ||
      (childNextSibling?.type === "comment" &&
        childNextSibling.startPosition.row === child?.startPosition.row))
  ) {
    if (
      (SEPARATORS.has(childNextSibling?.type ?? "") &&
        !slurpedNodes.has(childNextSibling?.id ?? -1)) ||
      (childNextSibling?.type === "kEndDot" && child?.type === "kEnd")
    ) {
      slurpedNodes.add(childNextSibling?.id ?? -100);
      nodeDoc = group([
        nodeDoc,
        childNextSibling?.text ?? "",
        ["exceptionHandler", "declVariant"].includes(node?.type) ? "" : line,
      ]);
    } else if (
      childNextSibling?.type === "comment" &&
      childNextSibling.startPosition.row === child?.startPosition.row
    ) {
      slurpedNodes.add(childNextSibling?.id ?? -100);
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

    childNextSibling = getNextNodeInTraversal(childNextSibling);
  }

  return nodeDoc;
}

function buildGrouping(node: TSNode, targetTypes: GroupMarker[]) {
  const groups: number[][] = [[]];
  let groupIndex = 0;
  let lastChildFieldName: string | null = null;

  for (let i = 0; i < node?.childCount; i++) {
    const childFieldName = node.fieldNameForChild(i) ?? "";
    const child = node.child(i);

    const currentTargetType = targetTypes[groupIndex];

    if (
      (currentTargetType.type === "node" &&
        currentTargetType.markers.includes(child?.type ?? "")) ||
      (currentTargetType.type === "field" &&
        currentTargetType.fieldName.includes(childFieldName)) ||
      (currentTargetType.type === "until-field-changes" &&
        currentTargetType.fieldNames.includes(lastChildFieldName ?? "") &&
        !currentTargetType.fieldNames.includes(childFieldName))
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

    lastChildFieldName = childFieldName;
  }

  return groups;
}

function printModule(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    { type: "node", markers: ["moduleName"] },
    { type: "until-end" },
  ];

  const headerGroup: Doc = [];
  const contentsGroup: Doc = [];

  const groupingIndexes = buildGrouping(node, targetTypes);

  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      headerGroup.push(nodeItem);
    }
  });

  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      contentsGroup.push(nodeItem);
    }
  });

  // const joinedContentsGroup = join(line, contentsGroup);

  if (headerGroup.length > 0) {
    return group(
      [
        group(join(line, headerGroup)),
        group([line, join(line, contentsGroup)]),
      ],
      { shouldBreak: true },
    );
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

  const groupingIndexes = buildGrouping(node, targetTypes);

  const preGroup: Doc = [];
  const nameGroup: Doc = [];
  const postGroup: Doc = [];

  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      preGroup.push(nodeItem);
    }
  });

  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      nameGroup.push(nodeItem);
    }
  });

  const headerGroup = [
    join(softline, nameGroup),
    Array.isArray(groupingIndexes[2])
      ? pathCall(path, printFn, groupingIndexes[2][0])
      : "",
  ];

  (groupingIndexes[3] ?? []).forEach((i) => {
    const nodeItem: Doc = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      postGroup.push(nodeItem);
    }
  });

  if (nameGroup.length > 0) {
    return group([
      group([
        group(join(line, preGroup)),
        preGroup.length > 0 ? line : "",
        group(headerGroup),
      ]),
      indent([
        ["declClass", "declHelper", "declIntf"].includes(
          node.child((groupingIndexes[3] ?? [])[0])?.type ?? "",
        )
          ? ""
          : softline,
        join(line, postGroup),
      ]),
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
  afterBlockSeparator: Doc = softline,
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

  const preGroup: Doc = [];
  const openCageGroup: Doc = [];
  const itemsGroup: Doc = [];
  const postGroup: Doc = [];
  const closeCageGroup: Doc = [];

  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      preGroup.push(nodeItem);
    }
  });

  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      openCageGroup.push(nodeItem);
    }
  });

  groupingIndexes[2].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      itemsGroup.push(nodeItem);
    }
  });

  if (closingCage !== undefined) {
    (groupingIndexes[3] ?? []).forEach((i) => {
      const nodeItem = pathCall(path, printFn, i);
      if (nodeIsNotEmpty(nodeItem)) {
        closeCageGroup.push(nodeItem);
      }
    });

    (groupingIndexes[4] ?? []).forEach((i) => {
      const nodeItem = pathCall(path, printFn, i);
      if (nodeIsNotEmpty(nodeItem)) {
        postGroup.push(nodeItem);
      }
    });
  }

  if (openCageGroup.length > 0) {
    return group(
      [
        group([
          join(line, preGroup),
          preGroup.length > 0 ? beforeCageSeparator : "",
          join(softline, openCageGroup),
          afterCageSeparator,
        ]),
        indent([
          itemsGroup.length > 0 ? softline : "",
          join(softline, itemsGroup),
        ]),
        closeCageGroup.length > 0 ? softline : "",
        group([join(softline, closeCageGroup), afterBlockSeparator]),
        postGroup.length > 0
          ? group([softline, join(line, postGroup), line])
          : "",
      ],
      { shouldBreak: forceBreak },
    );
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

  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      headerGroup.push(nodeItem);
    }
  });

  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      itemsGroup.push(nodeItem);
    }
  });

  if (headerGroup.length > 0 && itemsGroup.length > 0) {
    return group(
      [
        group([join(line, headerGroup)]),
        indent([softline, group(join(softline, itemsGroup))]),
      ],
      {
        shouldBreak: true,
      },
    );
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

  let groupingIndexes: number[][];

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
    groupingIndexes = buildGrouping(node, targetTypes);
  } else {
    const targetTypes: GroupMarker[] = [
      {
        type: "node",
        markers: ["kArray"],
      },
      { type: "until-end" },
    ];
    groupingIndexes = buildGrouping(node, targetTypes);
    groupingIndexes = [groupingIndexes[0], [], groupingIndexes[1]];
  }

  const preGroup: Doc = [];
  const rangeGroup: Doc = [];
  const postGroup: Doc = [];

  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      preGroup.push(nodeItem);
    }
  });

  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      rangeGroup.push(nodeItem);
    }
  });

  groupingIndexes[2].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    postGroup.push(nodeItem);
    if (nodeIsNotEmpty(nodeItem)) {
    }
  });

  if (groupingIndexes.length > 0 && postGroup.length > 0) {
    return group([
      join(line, preGroup),
      join(softline, rangeGroup),
      line,
      join(line, postGroup),
    ]);
  } else {
    return "";
  }
}

function printDefaultValue(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  let groupingIndexes: number[][];

  const targetTypes: GroupMarker[] = [
    {
      type: "node",
      markers: ["kEq"],
    },
    { type: "until-end" },
  ];

  groupingIndexes = buildGrouping(node, targetTypes);

  const eqGroup: Doc = [];
  const valueGroup: Doc = [];

  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      eqGroup.push(nodeItem);
    }
  });

  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      valueGroup.push(nodeItem);
    }
  });

  if (eqGroup.length > 0 && valueGroup.length > 0) {
    return group([
      [
        join(softline, eqGroup),
        ifBreak(" ", softline),
        join(softline, valueGroup),
      ],
    ]);
  } else {
    return "";
  }
}

function printDeclClass(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const groups: Doc[][] = [[], [], [], [], []];
  let groupingIndex = 0;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);

    switch (groupingIndex) {
      case 0: {
        if (
          [
            "declField",
            "declTypes",
            "declVars",
            "declConsts",
            "declProc",
            "declProp",
            "declSection",
            "declVariant",
            "kEnd",
          ].includes(child?.type ?? "")
        ) {
          groupingIndex++;
          i--;
        } else {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeIsNotEmpty(nodeItem)) groups[groupingIndex].push(nodeItem);
        }
        break;
      }
      case 1: {
        if (
          ["declSection", "declVariant", "kEnd"].includes(child?.type ?? "")
        ) {
          groupingIndex++;
          i--;
        } else {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeIsNotEmpty(nodeItem)) groups[groupingIndex].push(nodeItem);
        }
        break;
      }
      case 2: {
        if (["declVariant", "kEnd"].includes(child?.type ?? "")) {
          groupingIndex++;
          i--;
        } else {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeIsNotEmpty(nodeItem)) groups[groupingIndex].push(nodeItem);
        }
        break;
      }
      case 3: {
        if (["kEnd"].includes(child?.type ?? "")) {
          groupingIndex++;
          i--;
        } else {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeIsNotEmpty(nodeItem)) groups[groupingIndex].push(nodeItem);
        }
        break;
      }
      default: {
        const nodeItem = pathCall(path, printFn, i);
        if (nodeIsNotEmpty(nodeItem)) groups[groupingIndex].push(nodeItem);
        break;
      }
    }
  }

  if (groups[0].length > 0) {
    return group([
      group(
        indent([
          group(groups[0]),
          groups[1].length > 0 ? line : "",
          join(line, groups[1]),
          groups[2].length > 0 ? line : "",
          join(line, groups[2]),
          groups[3].length > 0 ? line : "",
          join(line, groups[3]),
        ]),
        { shouldBreak: true },
      ),
      groups[4].length > 0 ? line : "",
      join(softline, groups[4]),
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
      excludeMarker: true,
      retryNode: true,
      markers: ["kThen"],
    },
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
      fieldNames: ["else"],
      excludeMarker: true,
      retryNode: true,
    },
    { type: "until-end" },
  ];

  const groupingIndexes = buildGrouping(node, targetTypes);

  const ifGroup: Doc = [];
  const thenGroup: Doc = [];
  const elseGroup: Doc = [];
  const postGroup: Doc = [];

  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      ifGroup.push(nodeItem);
    }
  });

  groupingIndexes[2].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      thenGroup.push(nodeItem);
    }
  });

  (groupingIndexes[4] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      elseGroup.push(nodeItem);
    }
  });

  (groupingIndexes[5] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      postGroup.push(nodeItem);
    }
  });

  if (ifGroup.length > 0 && thenGroup.length > 0) {
    return group([
      group([
        indent(group([join(line, ifGroup)])),
        line,
        pathCall(path, printFn, groupingIndexes[1][0]),
      ]),
      indent([line, join(line, thenGroup)]),
      elseGroup.length > 0
        ? [
            line,
            pathCall(path, printFn, groupingIndexes[3][0]),
            indent([line, join(line, elseGroup)]),
          ]
        : "",
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

  const groupingIndexes = buildGrouping(node, targetTypes);

  const tryGroup: Doc = [];
  const handlerGroup: Doc = [];
  const postGroup: Doc = [];

  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      tryGroup.push(nodeItem);
    }
  });

  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      handlerGroup.push(nodeItem);
    }
  });

  (groupingIndexes[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      postGroup.push(nodeItem);
    }
  });

  if (tryGroup.length > 0 && handlerGroup.length > 0 && postGroup.length > 0) {
    return group([
      indent(group(join(line, tryGroup), { shouldBreak: true })),
      handlerGroup.length > 0 ? hardline : "",
      indent(group(join(line, handlerGroup), { shouldBreak: true })),
      line,
      group(postGroup),
    ]);
  } else {
    return "";
  }
}

function printDoBlock(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    {
      type: "node",
      markers: ["kDo"],
    },
    { type: "until-end" },
  ];

  const groupingIndexes = buildGrouping(node, targetTypes);

  const whileGroup: Doc = [];
  const postGroup: Doc = [];

  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      whileGroup.push(nodeItem);
    }
  });

  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      postGroup.push(nodeItem);
    }
  });

  if (whileGroup.length > 0 && postGroup.length > 0) {
    return group([
      group(join(line, whileGroup)),
      indent(group([line, postGroup])),
    ]);
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

  const groupingIndexes = buildGrouping(node, targetTypes);

  const preGroup: Doc = [];
  const postGroup: Doc = [];

  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      preGroup.push(nodeItem);
    }
  });

  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      postGroup.push(nodeItem);
    }
  });

  if (preGroup.length > 0) {
    return group([
      group(join(line, preGroup)),
      indent(group([ifBreak(line, ""), join(line, postGroup)])),
    ]);
  } else {
    return "";
  }
}

function printDeclVariantClause(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    {
      type: "node",
      markers: ["caseLabel"],
    },
    { type: "until-end" },
  ];

  const groupingIndexes = buildGrouping(node, targetTypes);

  const preGroup: Doc = [];
  const postGroup: Doc = [];

  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      preGroup.push(nodeItem);
    }
  });

  let firstItem = true;
  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      if (
        !firstItem &&
        ![")", "declField", "declVariant"].includes(node.child(i)?.type ?? "")
      )
        postGroup.push(line);
      firstItem = false;
      postGroup.push(nodeItem);
    }
  });

  if (preGroup.length > 0 && postGroup.length > 0) {
    return group([
      group(join(line, preGroup)),
      indent(group([ifBreak(line, ""), postGroup])),
    ]);
  } else {
    return "";
  }
}

function printCase(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const slurpedNodes = getSlurpedNodes(node);

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
  const ofGroup: Doc = [];
  const itemsGroup: Doc = [];
  const closingGroup: Doc = [];

  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      headerGroup.push(nodeItem);
    }
  });

  groupingIndexes[1].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      ofGroup.push(nodeItem);
    }
  });

  groupingIndexes[2].forEach((i) => {
    if (["kElse", "kOtherwise"].includes(node.child(i)?.type ?? "")) {
      const elseStatement = pathCall(path, printFn, i + 1);
      slurpedNodes.add(node.child(i)?.nextSibling?.id ?? -100);
      itemsGroup.push(
        group([
          group(node.child(i)?.text ?? ""),
          indent(group([line, elseStatement])),
        ]),
      );
    } else {
      const nodeItem = pathCall(path, printFn, i);
      if (nodeIsNotEmpty(nodeItem)) {
        itemsGroup.push(nodeItem);
      }
    }
  });

  (groupingIndexes[3] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      closingGroup.push(nodeItem);
    }
  });

  (groupingIndexes[4] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      closingGroup.push(nodeItem);
    }
  });

  if (headerGroup.length > 0 && itemsGroup.length > 0) {
    return group([
      group([join(line, headerGroup), line, join(line, ofGroup), line]),
      indent(
        group([hardline, join(hardline, itemsGroup)], { shouldBreak: true }),
      ),
      closingGroup.length > 0 ? softline : "",
      group(join(line, closingGroup)),
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
      excludeMarker: true,
      retryNode: true,
      fieldName: ["name"],
    },
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

  const preGroup: Doc = [];
  const nameGroup: Doc = [];
  const declArgs: Doc = [];
  const postGroup: Doc = [];

  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      preGroup.push(nodeItem);
    }
  });

  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      nameGroup.push(nodeItem);
    }
  });

  (groupingIndexes[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      declArgs.push(nodeItem);
    }
  });

  (groupingIndexes[3] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      postGroup.push(nodeItem);
    }
  });

  if (preGroup.length > 0 || nameGroup.length > 0) {
    return indent(
      group([
        group([join(line, preGroup), line, join(softline, nameGroup)]),
        group([join(softline, declArgs), group(join(line, postGroup))]),
      ]),
    );
  } else {
    return "";
  }
}

function printDeclProcRef(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";

  const retDoc: Doc = [];

  for (let i = 0; i < node.childCount; i++) {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      retDoc.push(nodeItem);
      if (!["kProcedure", "kFunction"].includes(node.child(i)?.type ?? ""))
        retDoc.push(line);
    }
  }

  if (retDoc.length > 0) {
    return group(retDoc);
  } else {
    return "";
  }
}

function printExpression(
  path: AstPath<TSNode>,
  printFn: PrintFn,
  operator: string[],
): Doc {
  const node = path.getNode();
  if (!node) return "";

  const targetTypes: GroupMarker[] = [
    { type: "node", excludeMarker: true, retryNode: true, markers: operator },
    { type: "node", markers: operator },
    { type: "until-end" },
  ];

  const leftGroup: Doc = [];
  const rightGroup: Doc = [];

  const groupingIndexes = buildGrouping(node, targetTypes);

  groupingIndexes[0].forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      leftGroup.push(nodeItem);
    }
  });

  (groupingIndexes[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      rightGroup.push(nodeItem);
    }
  });

  if (leftGroup.length > 0 || rightGroup.length > 0) {
    return group([
      group([
        join(line, leftGroup),
        pathCall(path, printFn, groupingIndexes[1][0]),
      ]),
      indent([softline, group(join(line, rightGroup))]),
    ]);
  } else {
    return "";
  }
}

function printDefProc(
  path: AstPath<TSNode>,
  printFn: PrintFn,
  options: object,
): Doc {
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
      fieldNames: ["header"],
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

  (groupingIndexes[0] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      headerGroup.push(nodeItem);
    }
  });

  (groupingIndexes[1] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      localGroup.push(nodeItem);
    }
  });

  (groupingIndexes[2] ?? []).forEach((i) => {
    const nodeItem = pathCall(path, printFn, i);
    if (nodeIsNotEmpty(nodeItem)) {
      postGroup.push(nodeItem);
    }
  });

  const finalGroup: Doc = group(
    [
      join(line, headerGroup),
      localGroup.length > 0 ? softline : "",
      group(join(softline, localGroup)),
      postGroup.length > 0 ? softline : "",
      join(softline, postGroup),
    ],
    { shouldBreak: true },
  );

  const finalDoc: Doc = [
    "interface",
    "implementation",
    "initialization",
    "finalization",
    "program",
    "library",
    "unit",
    "root",
  ].includes(node.parent?.type ?? "")
    ? group(finalGroup)
    : indent([" ".repeat((options as any)["tabWidth"]), finalGroup]);

  if (headerGroup.length > 0) {
    return finalDoc;
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

  const slurpedNodes = getSlurpedNodes(node);

  let retDoc: Doc = [];

  let rttiAttributesInNode: number[] = [];
  if (
    [
      "declType",
      "declProc",
      "declVar",
      "declConst",
      "declField",
      "declProp",
    ].includes(node.type)
  ) {
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i)?.type === "rttiAttributes") {
        rttiAttributesInNode.push(i);
        slurpedNodes.add(node.child(i)?.id ?? -100);
        break;
      }
    }
  }

  if (!node?.type)
    retDoc = ""; // skip broken AST node
  else if (slurpedNodes.has(node.id))
    retDoc = ""; // skip slurped nodes; slurping node handling them
  else if (node.type === "operatorName" && node.parent?.type === "declProc")
    // for operator override declaration no space around operator
    retDoc = node.text;
  else if (
    DECLARABLE_OPERATORS.includes(node.type) &&
    node.parent?.parent?.type === "genericDot"
  )
    // case where dot used in generics
    retDoc = node.text;
  else if (
    UNARY_OPERATORS.includes(node.type) &&
    node.parent?.type === "exprUnary"
  )
    // for exprUnary don't add space around operator
    retDoc = node.text;
  else if (["kGt", "kLt"].includes(node.type)) {
    if (["exprBinary", "operatorName"].includes(node.parent?.type ?? "")) {
      retDoc = [line, node.text, line]; // kGt and kLt as operator
    } else {
      retDoc = node.text; // kGt and kLt as language token
    }
  } else if (node.type === "kIn" && (node.parent?.type ?? "") === "foreach") {
    retDoc = node.text; // foreach has their own space, don't add extra space
  } else if (["kDot", "kHat", "kAt", ".."].includes(node.type))
    retDoc = node.text; // theese operators need no spaces
  else if (node.type === "kEq" && node.parent?.type === "defaultValue")
    retDoc = [node.text, ifBreak("", line)]; // special case for defaultValue, they has their own space
  else if (INLINE_OPERATORS.includes(node.type)) {
    retDoc = [" ", node.text, " "];
  } else if (SEPARATORS.has(node.type))
    // special case for legacyFormat, no need extra line
    retDoc = [node.text, node.parent?.type === "legacyFormat" ? "" : line];
  else {
    switch (node.type) {
      case "root": {
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeIsNotEmpty(nodeItem)) {
            retDoc.push(nodeItem);
          }
        }

        printerState.delete(node.id);

        if (process.env.DEBUG_PASCAL_DOC) {
          console.log("finaldoc");
          console.log(JSON.stringify(retDoc));
        }

        if (retDoc.length > 0)
          retDoc = group([join(line, retDoc), line], { shouldBreak: true });
        else retDoc = "";
        break;
      }
      case "program":
      case "library":
      case "unit": {
        retDoc = printModule(path, printFn);
        break;
      }
      case "interface":
      case "implementation":
      case "initialization":
      case "finalization": {
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeIsNotEmpty(nodeItem)) retDoc.push(nodeItem);
        }
        retDoc = join(hardline, retDoc);
        break;
      }
      case "exprDot": {
        retDoc = printExpression(path, printFn, ["kDot"]);
        break;
      }
      case "exprBinary": {
        retDoc = printExpression(path, printFn, BINARY_OPERATORS);
        break;
      }
      case "exprUnary": {
        retDoc = printExpression(path, printFn, UNARY_OPERATORS);
        break;
      }
      case "assignment": {
        retDoc = printExpression(path, printFn, ASSIGNMENT_OPERATORS);
        break;
      }
      case "for":
      case "foreach":
      case "with":
      case "while": {
        retDoc = printDoBlock(path, printFn);
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
          line,
        );
        break;
      }
      case "declVariantClause": {
        retDoc = printDeclVariantClause(path, printFn);
        break;
      }
      case "declVariant":
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
          false,
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
          if (nodeIsNotEmpty(nodeItem)) {
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
        retDoc = printCagedItems(path, printFn, true, [
          "kConst",
          "kResourcestring",
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
      case "declPropArgs":
      case "exprBrackets": {
        retDoc = printCagedItems(path, printFn, false, ["["], ["]"]);
        break;
      }
      case "recInitializer":
      case "arrInitializer":
      case "exprCall":
      case "exprParens":
      case "declEnum":
      case "declArgs": {
        retDoc = printCagedItems(path, printFn, false, ["("], [")"]);
        break;
      }
      case "declHelper": {
        retDoc = printCagedItems(
          path,
          printFn,
          true,
          ["typeref"],
          ["kEnd"],
          line,
        );
        break;
      }
      case "declIntf": {
        retDoc = printCagedItems(
          path,
          printFn,
          true,
          ["kDispInterface", "kInterface"],
          ["kEnd"],
        );
        break;
      }
      case "declClass": {
        retDoc = printDeclClass(path, printFn);
        break;
      }
      case "declProcFwd":
      case "declProc": {
        retDoc = printDeclProc(path, printFn);
        break;
      }
      case "declProcRef": {
        retDoc = printDeclProcRef(path, printFn);
        break;
      }
      case "genericArg":
      case "declProp":
      case "declField":
      case "declType":
      case "declVar":
      case "declVariantField":
      case "declArg":
      case "inlineConst": {
        retDoc = printNameWithType(path, printFn);
        break;
      }
      case "recInitializerField": {
        if (node?.fieldNameForChild(0) === "name") {
          retDoc = printNameWithType(path, printFn);
        } else {
          let firstItem = true;
          for (let i = 0; i < node.childCount; i++) {
            const nodeItem = pathCall(path, printFn, i);
            if (nodeIsNotEmpty(nodeItem)) {
              if (!firstItem) {
                retDoc.push(line);
              }
              firstItem = false;
              retDoc.push(nodeItem);
            }
          }
          retDoc = group(retDoc);
        }
        break;
      }
      case "typerefTpl": {
        retDoc = printCagedItems(path, printFn, false, ["kLt"], ["kGt"]);
        break;
      }
      case "typerefArgs": {
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeIsNotEmpty(nodeItem)) {
            retDoc.push(nodeItem);
          }
        }
        break;
      }
      case "defProc": {
        retDoc = printDefProc(path, printFn, options);
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
      case "asm": {
        retDoc = printCagedItems(
          path,
          printFn,
          true,
          ["kAsm"],
          ["kEnd"],
          softline,
          line,
        );
        break;
      }
      case "pp": {
        retDoc = node.text;
        break;
      }
      case "asmBody":
      case "varDef":
      case "varAssignDef":
      case "typeref":
      case "exprIf":
      case "declSet":
      case "declExport":
      case "declMetaClass":
      case "declFile":
      case "inherited":
      case "procAttribute":
      case "procExternal":
      case "raise":
      case "label":
      case "goto": {
        let firstItem = true;
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeIsNotEmpty(nodeItem)) {
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
      case "legacyFormat": {
        retDoc = group(join(softline, path.map(printFn, "children")));
        break;
      }
      case "comment": {
        if (
          node.text.startsWith("//") &&
          node.previousSibling &&
          node.previousSibling?.endPosition.row === node.startPosition.row
        )
          retDoc = "";
        else retDoc = node.text;
        break;
      }
      case "defaultValue": {
        retDoc = printDefaultValue(path, printFn);
        break;
      }
      case "caseLabel":
      case "declConst":
      case "declEnumValue":
      case "declLabel":
      case "declString":
      case "exprSubscript":
      case "exprTpl":
      case "genericDot":
      case "genericTpl":
      case "genericArgs":
      case "guid":
      case "moduleName":
      case "operatorDot":
      case "operatorName":
      case "statement":
      case "statements":
      case "statementsTr":
      case "type":
      case "typerefArgs":
      case "typerefDot":
      case "typerefPtr":
      case "typerefTpl": {
        let firstItem = true;
        const retArr = [];
        for (let i = 0; i < node.childCount; i++) {
          const pathCallRes = pathCall(path, printFn, i);
          if (pathCallRes !== "") {
            if (!firstItem) {
              if (node.child(i)?.type !== "defaultValue") {
                retArr.push(softline);
              } else {
                retArr.push(" ");
              }
            }
            firstItem = false;
            retArr.push(pathCallRes);
          }
        }
        if (retArr.length > 0)
          retDoc = group(retArr, {
            shouldBreak: node.type === "statements",
          });
        break;
      }
      case "range": {
        let firstItem = true;
        for (let i = 0; i < node.childCount; i++) {
          const nodeItem = pathCall(path, printFn, i);
          if (nodeIsNotEmpty(nodeItem)) {
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
      case "literalChar":
      case "literalNumber":
      case "literalStringMultiline":
      case "literalString": {
        retDoc = node.text;
        break;
      }
      default: {
        if (process.env.DEBUG_PASCAL_PRINTER) {
          console.warn(`Fallback printer: ${node.type}`);
        }

        const ret = join(line, path.map(printFn, "children"));
        retDoc = ret.length === 0 ? node.text || "" : ret;
        break;
      }
    }
  }

  const nodePrevSibling = node.previousSibling;
  const nodeMaybeSpacedFromSibling = node.type !== "label";
  if (
    nodePrevSibling &&
    nodeMaybeSpacedFromSibling &&
    node.startPosition.row - nodePrevSibling.endPosition.row > 1
  ) {
    retDoc = [hardline, retDoc];
  }

  if (rttiAttributesInNode.length > 0) {
    retDoc = [
      ...rttiAttributesInNode.map((idx) => node.child(idx)?.text ?? ""),
      hardline,
      retDoc,
    ];
  }

  return retDoc;
}

export default {
  languages,
  parsers,
  printers,
  options,
};
