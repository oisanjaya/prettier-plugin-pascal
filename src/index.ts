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

// ============================================================================
// MAIN PRINTER FUNCTION
// ============================================================================

export function printNode(
  path: AstPath<TSNode>,
  options: object,
  printFn: PrintFn,
): Doc {
  const node = path.getNode();

  if (!node?.type) return "";
  if (["kDot", "kHat"].includes(node.type)) return node.text;
  if (["kGt", "kLt"].includes(node.type)) {
    if (["exprBinary", "operatorName"].includes(node.parent?.type ?? "")) {
      return [line, node.text, line];
    } else {
      return node.text;
    }
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
  )
    return [line, node.text, line];
  if (/*node.type.startsWith("k") ||*/ [":", ";", ","].includes(node.type))
    return [node.text, line];

  type GroupingType = "normal" | "indented";

  let retDoc: Doc[] = [];
  let groupedRetDoc: Doc[] = [];
  let endGroupMarker: (string | undefined)[] | "use_field" = [undefined];
  let endGroupMarkerField: string = "";
  let groupingType: GroupingType = "normal";
  let groupingSeparator: Doc = softline;
  let targetCildField: number[] = [];
  // if (endGroupMarker === "use_field") {
  //   targetCildField =
  //     node
  //       ?.childrenForFieldName(endGroupMarkerField)
  //       .map((item) => item.id) ?? [];
  // }

  // Helper function to decide wether childDoc pushed to retDoc or groupedRetDoc
  // returns true if endGroupMarker reached and groupedRetDoc transfered to retDoc
  function pushChildNode(
    child: TSNode,
    childDoc: Doc,
    skipEndMarker: (string | undefined)[] | boolean = false,
    resetEndGroupMarker: boolean = true,
    noSeparatorBeforeStandardSeparator = false,
  ): boolean {
    function joinChildren(childDocs: Doc[]): Doc[] {
      const retJoin: Doc[] = [];
      let firstChild = true;
      let previousIsStandardOperator = false;
      childDocs.forEach((child) => {
        const childStr = printDocToString(child, {
          printWidth: 80,
          tabWidth: 2,
        });

        const thisIsStandardSeparator = [":", ";", ","].includes(
          childStr.formatted.trim(),
        );

        if (!firstChild) {
          if (
            !noSeparatorBeforeStandardSeparator ||
            (!thisIsStandardSeparator && !previousIsStandardOperator)
          )
            retJoin.push(groupingSeparator);
        }
        firstChild = false;
        retJoin.push(child);

        previousIsStandardOperator = thisIsStandardSeparator;
      });
      return retJoin;
    }

    if (endGroupMarker[0] === undefined) {
      retDoc.push(childDoc);
    } else {
      if (
        skipEndMarker === false ||
        !(
          Array.isArray(skipEndMarker) ? skipEndMarker : endGroupMarker
        ).includes(child?.type) ||
        (endGroupMarker === "use_field" && !targetCildField.includes(child.id))
      ) {
        groupedRetDoc.push(childDoc);
      }
    }

    if (
      endGroupMarker[0] !== undefined &&
      (endGroupMarker.includes(child?.type) ||
        targetCildField.includes(child.id))
    ) {
      if (resetEndGroupMarker) {
        endGroupMarkerField = "";
        endGroupMarker = [undefined];
      }

      if (groupingType === "indented") {
        retDoc.push(indent(group(joinChildren(groupedRetDoc))));
      } else if (groupingType === "normal") {
        retDoc.push(group(joinChildren(groupedRetDoc)));
      }

      groupedRetDoc = [];

      return true;
    }

    return false;
  }

  // Helper function generate list children
  function listRetDoc(separator: string = ",") {
    endGroupMarker = [","];
    groupingSeparator = line;
    retDoc = [softline];
    for (let i = 0; i < (node?.childCount ?? -1); i++) {
      const child = node?.child(i);
      if (!child) continue;

      if (
        pushChildNode(child, path.call(printFn, "children", i), true, false)
      ) {
        retDoc[retDoc.length - 1] = group([
          retDoc[retDoc.length - 1],
          ",",
          line,
        ]);
      }
    }

    if (groupedRetDoc.length > 0) {
      retDoc.push(groupedRetDoc);
      groupedRetDoc = [];
    }

    return retDoc;
  }

  switch (node.type) {
    case "root": {
      for (let i = 0; i < node.childCount; i++) {
        retDoc.push(path.call(printFn, "children", i));
      }

      if (node.type === "root" && process.env.DEBUG_PASCAL_DOC) {
        console.log("finaldoc");
        console.log(JSON.stringify(retDoc));
      }

      return [retDoc, line];
    }

    case "unit":
    case "library":
    case "program": {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (["kProgram", "kLibrary", "kUnit"].includes(child?.type)) {
          endGroupMarker = [";"];
          groupingSeparator = line;
        }

        if (["block"].includes(child?.type)) {
          endGroupMarker = ["==remaining"];
          groupingSeparator = line;
        }

        if (pushChildNode(child, path.call(printFn, "children", i), true)) {
          retDoc.push(";", hardline);
        }
      }

      if (groupedRetDoc.length > 0) {
        retDoc.push(hardline, hardline, groupedRetDoc);
      }

      return retDoc;
    }

    case "block": {
      retDoc = [];
      groupingType = "indented";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (
          pushChildNode(child, path.call(printFn, "children", i), true, true)
        ) {
          i--;
          endGroupMarker = [undefined];
        }

        if (child.type === "kBegin") {
          groupedRetDoc = [line];
          endGroupMarker = ["kEnd"];
        }
        if (child.type === "kEnd") {
          // retDoc[retDoc.length - 1] = [retDoc[retDoc.length - 1], softline];
          groupingSeparator = softline;
          groupedRetDoc = [line, child.text];
          endGroupMarker = ["==remaining"];
        }
      }

      if (groupedRetDoc.length > 0) {
        retDoc.push(groupedRetDoc);
      }

      return retDoc;
    }

    case "moduleName": {
      return group(path.map(printFn, "children"));
    }

    case "declArg":
    case "declVar": {
      endGroupMarker = [":"];

      groupingSeparator = line;
      // if (node.type === "declArg") groupingSeparator = line;
      // if (node.type === "declVar") groupingSeparator = softline;

      groupingType = "indented";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (
          pushChildNode(
            child,
            path.call(printFn, "children", i),
            true,
            false,
            true,
          )
        ) {
          retDoc.push(endGroupMarker[0] ?? "", " ");
          if (endGroupMarker[0] === ":") {
            groupingType = "indented";
            endGroupMarker = [";"];
          } else endGroupMarker = [undefined];
        }
      }

      if (groupedRetDoc.length > 0) {
        retDoc.push(group(groupedRetDoc));
        groupedRetDoc = [];
      }

      return group(retDoc);
    }

    case "declVars": {
      endGroupMarker = ["declVar"];
      groupingSeparator = line;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (
          pushChildNode(child, path.call(printFn, "children", i), [
            endGroupMarker[0] ?? "",
          ])
        ) {
          i--;
          endGroupMarker = ["==remaining"];
          groupingSeparator = line;
        }
      }

      if (groupedRetDoc.length > 0) {
        retDoc.push(group(indent([hardline, join(hardline, groupedRetDoc)])));
        groupedRetDoc = [];
      }

      return [hardline, retDoc, hardline];
    }

    case "defProc": {
      const headerChild = node
        .childrenForFieldName("header")
        .map((item) => item.id);
      const localChild = node
        .childrenForFieldName("local")
        .map((item) => item.id);
      const bodyChild = node
        .childrenForFieldName("body")
        .map((item) => item.id);

      let lastField = "";
      groupedRetDoc = [];
      retDoc = [];
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
          if (groupedRetDoc.length > 0) {
            retDoc.push(group(groupedRetDoc));
            groupedRetDoc = [];
          }
          lastField = currentField;
          groupedRetDoc.push(path.call(printFn, "children", i));
        } else {
          if (currentField === "") {
            retDoc.push(path.call(printFn, "children", i));
          } else {
            groupedRetDoc.push(path.call(printFn, "children", i));
          }
        }
      }

      if (groupedRetDoc.length > 0) {
        retDoc.push(group(groupedRetDoc));
        groupedRetDoc = [];
      }
      return group(indent([hardline, retDoc]));
    }

    case "typerefTpl": {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        groupingSeparator = softline;
        groupingType = "indented";

        if (!child) continue;

        if (
          pushChildNode(child, path.call(printFn, "children", i), true, true)
        ) {
          i--;
        }

        if (child.type === "kLt") {
          endGroupMarker = ["kGt"];
        }
      }

      return retDoc;
    }

    case "declArgs": {
      return listRetDoc(";");
    }

    case "typerefArgs": {
      return listRetDoc();
    }

    case "declProc":
    case "typeref": {
      return group(join(line, path.map(printFn, "children")));
    }

    case "typerefPtr": {
      console.log(node.type);
      return group(join(softline, path.map(printFn, "children")));
    }

    default: {
      const ret = join(line, path.map(printFn, "children"));
      return ret.length === 0 ? node.text || "" : ret;
    }
  }

  return "";
}

export default {
  languages,
  parsers,
  printers,
  options,
};
