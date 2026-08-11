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
import { GroupDoc, GroupState } from "./printer/types";

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

interface PushChildResult {
  consumed: boolean;
  groupClosed: boolean;
}

function createGroupDoc(doc: Doc, node?: TSNode): GroupDoc {
  return {
    doc,
    isSeparator: [":", ";", ","].includes(node?.type || ""),
    isEmpty: node === undefined || node.text.trim() === "",
  };
}

function createGroupState(): GroupState {
  return {
    retDoc: [],
    groupedRetDoc: [],
    endCondition: { type: "none" },
    groupingType: "normal",
    groupingSeparator: softline,
  };
}

function shouldCloseGroup(state: GroupState, child: TSNode): boolean {
  switch (state.endCondition.type) {
    case "none":
      return false;

    case "until-end":
      return false;

    case "node":
      return state.endCondition.markers.includes(child.type);

    case "field":
      return state.endCondition.fieldIds.includes(child.id);
  }
}

function pushChildNode(
  state: GroupState,
  child: TSNode,
  childDoc: Doc,
  skipMarkerNode = false,
  resetendCondition = true,
  noSeparatorAroundStandardSeparator = false,
): PushChildResult {
  let consumed = false;
  let groupClosed = false;

  const joinChildren = (childDocs: GroupDoc[]): Doc[] => {
    const retJoin: Doc[] = [];
    let firstChild = true;
    let previousIsStandardOperator = false;

    childDocs.forEach((doc, idx) => {
      if (
        !firstChild &&
        (!noSeparatorAroundStandardSeparator ||
          (!doc.isSeparator && !previousIsStandardOperator))
      ) {
        retJoin.push(state.groupingSeparator);
      }

      firstChild = firstChild && doc.isEmpty;
      retJoin.push(doc.doc);
      previousIsStandardOperator = doc.isSeparator;
    });

    return retJoin;
  };

  if (state.endCondition.type === "none") {
    state.retDoc.push(childDoc);
  } else {
    if (
      skipMarkerNode === false ||
      !(
        Array.isArray(skipMarkerNode)
          ? skipMarkerNode
          : state.endCondition.type === "node"
            ? state.endCondition.markers
            : []
      ).includes(child.type) ||
      (state.endCondition.type === "field" &&
        !state.endCondition.fieldIds.includes(child.id))
    ) {
      consumed = true;
      state.groupedRetDoc.push(createGroupDoc(childDoc, child));
    }
  }

  if (shouldCloseGroup(state, child)) {
    if (resetendCondition) {
      state.endCondition = { type: "none" };
    }

    if (state.groupingType === "indented") {
      state.retDoc.push(indent(group(joinChildren(state.groupedRetDoc))));
    } else {
      state.retDoc.push(group(joinChildren(state.groupedRetDoc)));
    }

    groupClosed = true;

    state.groupedRetDoc = [];
  }

  return { consumed, groupClosed };
}

function listRetDoc(
  node: TSNode,
  path: AstPath<TSNode>,
  printFn: PrintFn,
  state: GroupState,
  separator: string = ",",
): Doc[] {
  state.endCondition = { type: "node", markers: [separator] };
  state.groupingSeparator = line;
  state.retDoc = [softline];

  let childCursor = 0;
  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child) {
      childCursor++;
      continue;
    }

    const pushChildResult = pushChildNode(
      state,
      child,
      path.call(printFn, "children", childCursor),
      true,
      false,
    );

    if (pushChildResult.groupClosed) {
      state.retDoc[state.retDoc.length - 1] = group([
        state.retDoc[state.retDoc.length - 1],
        ",",
        line,
      ]);
    }

    childCursor++;
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(state.groupedRetDoc.map((item) => item.doc));
    state.groupedRetDoc = [];
  }

  return state.retDoc;
}

function printRoot(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const state = createGroupState();
  const node = path.getNode();
  if (!node) return "";

  let childCursor = 0;
  while (childCursor < node.childCount) {
    state.retDoc.push(path.call(printFn, "children", childCursor));

    childCursor++;
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

  let childCursor = 0;
  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child) {
      childCursor++;
      continue;
    }

    if (["kProgram", "kLibrary", "kUnit"].includes(child.type)) {
      state.endCondition = { type: "node", markers: [";"] };
      state.groupingSeparator = line;
    }

    if (["block"].includes(child.type)) {
      state.endCondition = { type: "until-end" };
      state.groupingSeparator = line;
    }

    const pushChildResult = pushChildNode(
      state,
      child,
      path.call(printFn, "children", childCursor),
      true,
    );

    if (pushChildResult.groupClosed) {
      state.retDoc.push(";", hardline);
    }

    if (pushChildResult.consumed || state.endCondition.type === "none") {
      childCursor++;
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(
      hardline,
      hardline,
      state.groupedRetDoc.map((item) => item.doc),
    );
  }

  return state.retDoc;
}

function printBlock(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();
  state.groupingType = "indented";
  let childCursor = 0;
  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child || child.type === ";") {
      childCursor++;
      continue;
    }

    let statement = path.call(printFn, "children", childCursor);

    if (child.nextSibling?.type === ";") {
      statement = group([statement, child.nextSibling.text, line]);
    }

    const pushChildResult = pushChildNode(state, child, statement, true, false);

    if (pushChildResult.groupClosed) {
      state.endCondition = { type: "none" };
    }

    if (child.type === "kBegin") {
      state.groupedRetDoc = [createGroupDoc(line)];
      state.endCondition = { type: "node", markers: ["kEnd"] };
    }
    if (child.type === "kEnd") {
      state.groupingSeparator = softline;
      state.groupedRetDoc = [
        createGroupDoc(softline),
        createGroupDoc(child.text),
      ];
      state.endCondition = { type: "until-end" };
    }

    if (pushChildResult.consumed || state.endCondition.type === "none") {
      childCursor++;
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(state.groupedRetDoc.map((item) => item.doc));
  }

  return state.retDoc;
}

function printDeclProc(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();
  state.endCondition = {
    type: "field",
    fieldIds: node.childrenForFieldName("name").map((item) => item.id),
  };
  state.groupingSeparator = line;
  state.groupingType = "indented";

  let childCursor = 0;
  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child) {
      childCursor++;
      continue;
    }

    const pushChildResult = pushChildNode(
      state,
      child,
      path.call(printFn, "children", childCursor),
      false,
      true,
      true,
    );

    if (pushChildResult.groupClosed) {
      state.endCondition = { type: "until-end" };
      state.groupingSeparator = softline;
    }

    if (pushChildResult.consumed) {
      childCursor++;
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(group(state.groupedRetDoc.map((item) => item.doc)));
    state.groupedRetDoc = [];
  }

  return state.retDoc;
}

function printDeclVar(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();
  state.endCondition = { type: "node", markers: [":"] };
  state.groupingSeparator = line;
  state.groupingType = "indented";

  let childCursor = 0;
  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child) {
      childCursor++;
      continue;
    }

    const pushChildResult = pushChildNode(
      state,
      child,
      path.call(printFn, "children", childCursor),
      false,
      true,
      true,
    );

    // if (child.type === ":") {
    //   console.log({ afterpushchild: childCursor });
    //   console.log(JSON.stringify(state));
    //   console.log({ childtype: child.type });
    //   console.log(JSON.stringify(pushChildResult));
    //   console.log({ groupretdoc: state.groupedRetDoc.map((item) => item.doc) });
    // }

    if (pushChildResult.consumed) {
      childCursor++;
    }

    if (pushChildResult.groupClosed) {
      break;
    }
  }

  state.endCondition = { type: "until-end" };
  state.groupingSeparator = line;
  state.groupingType = "indented";
  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child) {
      childCursor++;
      continue;
    }

    pushChildNode(
      state,
      child,
      path.call(printFn, "children", childCursor),
      false,
      true,
      true,
    );

    childCursor++;
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(group(state.groupedRetDoc.map((item) => item.doc)));
    state.groupedRetDoc = [];
  }

  return group(state.retDoc);
}

function printDeclVars(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();
  state.endCondition = { type: "node", markers: ["declVar"] };
  state.groupingSeparator = line;

  let childCursor = 0;
  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child) {
      childCursor++;
      continue;
    }
    
    const pushChildResult = pushChildNode(
      state,
      child,
      path.call(printFn, "children", childCursor),
      true,
    );

    if (pushChildResult.groupClosed) {
      state.endCondition = { type: "until-end" };
      state.groupingSeparator = line;
      state.groupingType = "indented";
    }

    if (pushChildResult.consumed) {
      childCursor++;
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(
      indent([
        hardline,
        join(
          hardline,
          state.groupedRetDoc.map((item) => item.doc),
        ),
      ]),
    );
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

  let childCursor = 0;
  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child) {
      childCursor++;
      continue;
    }

    const currentField = headerChild.includes(child.id)
      ? "header"
      : localChild.includes(child.id)
        ? "local"
        : bodyChild.includes(child.id)
          ? "body"
          : "";

    if (currentField !== lastField) {
      if (state.groupedRetDoc.length > 0) {
        state.retDoc.push(group(state.groupedRetDoc.map((item) => item.doc)));
        state.groupedRetDoc = [];
      }
      lastField = currentField;
      state.groupedRetDoc.push(
        createGroupDoc(path.call(printFn, "children", childCursor), child),
      );
    } else if (currentField === "") {
      state.retDoc.push(path.call(printFn, "children", childCursor));
    } else {
      state.groupedRetDoc.push(
        createGroupDoc(path.call(printFn, "children", childCursor), child),
      );
    }

    childCursor++;
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(group(state.groupedRetDoc.map((item) => item.doc)));
    state.groupedRetDoc = [];
  }

  return group(indent([hardline, state.retDoc]));
}

function printIfElse(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();
  state.endCondition = { type: "node", markers: ["kThen"] };
  state.groupingSeparator = line;
  state.groupingType = "normal";

  let childCursor = 0;
  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child) {
      childCursor++;
      continue;
    }

    const pushChildResult = pushChildNode(
      state,
      child,
      path.call(printFn, "children", childCursor),
      false,
      true,
    );

    if (pushChildResult.consumed) {
      childCursor++;
    }

    if (pushChildResult.groupClosed) {
      break;
    }
  }

  state.endCondition = { type: "node", markers: ["kElse"] };
  state.groupingSeparator = line;
  state.groupingType = "indented";
  state.groupedRetDoc = [createGroupDoc(line)];

  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child) {
      childCursor++;
      continue;
    }

    const pushChildResult = pushChildNode(
      state,
      child,
      path.call(printFn, "children", childCursor),
      true,
      true,
    );

    if (pushChildResult.consumed) {
      childCursor++;
    }

    if (pushChildResult.groupClosed) {
      break;
    }
  }

  state.retDoc.push(line);

  state.endCondition = { type: "until-end" };
  state.groupingSeparator = line;
  state.groupingType = "indented";
  state.groupedRetDoc = [];

  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    if (!child) {
      childCursor++;
      continue;
    }

    const pushChildResult = pushChildNode(
      state,
      child,
      path.call(printFn, "children", childCursor),
      true,
      true,
    );

    if (pushChildResult.consumed) {
      childCursor++;
    }

    if (pushChildResult.groupClosed) {
      break;
    }
  }

  if (state.groupedRetDoc.length > 0) {
    state.retDoc.push(
      group(
        join(
          state.groupingSeparator,
          state.groupedRetDoc.map((item) => item.doc),
        ),
      ),
    );
  }

  return state.retDoc;
}

function printTyperefTpl(path: AstPath<TSNode>, printFn: PrintFn): Doc {
  const node = path.getNode();
  if (!node) return "";
  const state = createGroupState();

  let childCursor = 0;
  while (childCursor < node.childCount) {
    const child = node.child(childCursor);
    state.groupingSeparator = softline;
    state.groupingType = "indented";

    if (!child) {
      childCursor++;
      continue;
    }

    const pushChildResult = pushChildNode(
      state,
      child,
      path.call(printFn, "children", childCursor),
      true,
      true,
    );

    if (child.type === "kLt") {
      state.endCondition = { type: "node", markers: ["kGt"] };
    }

    if (pushChildResult.consumed || state.endCondition.type === "none") {
      childCursor++;
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
  if (["kDot", "kHat", "kAt"].includes(node.type)) return node.text;
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
    case "ifElse":
      return printIfElse(path, printFn);
    case "typerefTpl":
      return printTyperefTpl(path, printFn);
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
    case "assignment":
    case "exprUnary":
    case "exprBinary":
    case "typerefPtr":
    case "exprCall":
    case "exprParens":
    case "exprDot":
    case "statement": {
      const testRet = group(join(softline, path.map(printFn, "children")));
      return testRet;
    }
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
