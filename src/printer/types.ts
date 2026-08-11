import { Doc } from "prettier";

export type GroupingType = "normal" | "indented";

export type GroupEndMarker =
  | { type: "none" }
  | { type: "node"; markers: string[] }
  | { type: "field"; fieldIds: number[] }
  | { type: "until-end" };

// Doc traversal and grouping.
// each print...() function has their own state for clarity
export interface GroupDoc {
  doc: Doc;
  isSeparator: boolean;
  isEmpty: boolean;
}

export interface GroupState {
  retDoc: Doc[];
  groupedRetDoc: GroupDoc[];
  endCondition: GroupEndMarker;
  groupingType: GroupingType;
  groupingSeparator: Doc;
}
