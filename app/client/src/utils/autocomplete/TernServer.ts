/* eslint-disable @typescript-eslint/ban-ts-comment */
// Heavily inspired from https://github.com/codemirror/CodeMirror/blob/master/addon/tern/tern.js
import { DataTree } from "entities/DataTree/dataTreeFactory";
import tern, { Server, Def } from "tern";
import ecma from "tern/defs/ecmascript.json";
import lodash from "constants/defs/lodash.json";
import base64 from "constants/defs/base64-js.json";
import moment from "constants/defs/moment.json";
import xmlJs from "constants/defs/xmlParser.json";
import { dataTreeTypeDefCreator } from "utils/autocomplete/dataTreeTypeDefCreator";
import { customTreeTypeDefCreator } from "utils/autocomplete/customTreeTypeDefCreator";
import CodeMirror, { Hint, Pos, cmpPos } from "codemirror";
import {
  getDynamicStringSegments,
  isDynamicValue,
} from "utils/DynamicBindingUtils";

const DEFS = [ecma, lodash, base64, moment, xmlJs];
const bigDoc = 250;
const cls = "CodeMirror-Tern-";
const hintDelay = 1700;

type Completion = Hint & {
  origin: string;
  type: DataType;
  data: {
    doc: string;
  };
  render?: any;
  isHeader?: boolean;
};

type TernDocs = Record<string, TernDoc>;

type TernDoc = {
  doc: CodeMirror.Doc;
  name: string;
  changed: { to: number; from: number } | null;
};

export type DataType =
  | "OBJECT"
  | "NUMBER"
  | "ARRAY"
  | "FUNCTION"
  | "BOOLEAN"
  | "STRING"
  | "UNKNOWN";

type ArgHints = {
  start: CodeMirror.Position;
  type: { args: any[]; rettype: null | string };
  name: string;
  guess: boolean;
  doc: CodeMirror.Doc;
};

class TernServer {
  server: Server;
  docs: TernDocs = Object.create(null);
  cachedArgHints: ArgHints | null = null;
  active: any;
  expected?: string;

  constructor(
    dataTree: DataTree,
    additionalDataTree?: Record<string, Record<string, unknown>>,
  ) {
    const dataTreeDef = dataTreeTypeDefCreator(dataTree);
    let customDataTreeDef = undefined;
    if (additionalDataTree) {
      customDataTreeDef = customTreeTypeDefCreator(additionalDataTree);
    }
    this.server = new tern.Server({
      async: true,
      defs: customDataTreeDef
        ? [...DEFS, dataTreeDef, customDataTreeDef]
        : [...DEFS, dataTreeDef],
    });
  }

  complete(cm: CodeMirror.Editor, expected: string) {
    this.expected = expected;
    cm.showHint({
      hint: this.getHint.bind(this),
      completeSingle: false,
      extraKeys: {
        Up: (cm: CodeMirror.Editor, handle: any) => {
          handle.moveFocus(-1);
          if (this.active.isHeader === true) {
            handle.moveFocus(-1);
          }
        },
        Down: (cm: CodeMirror.Editor, handle: any) => {
          handle.moveFocus(1);
          if (this.active.isHeader === true) {
            handle.moveFocus(1);
          }
        },
      },
    });
  }

  showType(cm: CodeMirror.Editor) {
    this.showContextInfo(cm, "type");
  }

  showDocs(cm: CodeMirror.Editor) {
    this.showContextInfo(cm, "documentation", (data: any) => {
      if (data.url) {
        window.open(data.url, "_blank");
      }
    });
  }

  updateDef(name: string, def: Def) {
    this.server.deleteDefs(name);
    // @ts-ignore: No types available
    this.server.addDefs(def, true);
  }

  requestCallback(error: any, data: any, cm: CodeMirror.Editor, resolve: any) {
    if (error) return this.showError(cm, error);
    if (data.completions.length === 0) {
      return this.showError(cm, "No suggestions");
    }
    const doc = this.findDoc(cm.getDoc());
    const cursor = cm.getCursor();
    const lineValue = this.lineValue(doc);
    const focusedValue = this.getFocusedDynamicValue(doc);
    const index = lineValue.indexOf(focusedValue);
    let completions: Completion[] = [];
    let after = "";
    const { end, start } = data;
    const from = {
      ...start,
      ch: start.ch + index,
      line: cursor.line,
    };
    const to = {
      ...end,
      ch: end.ch + index,
      line: cursor.line,
    };
    if (
      cm.getRange(Pos(from.line, from.ch - 2), from) === '["' &&
      cm.getRange(to, Pos(to.line, to.ch + 2)) !== '"]'
    ) {
      after = '"]';
    }
    for (let i = 0; i < data.completions.length; ++i) {
      const completion = data.completions[i];
      let className = this.typeToIcon(completion.type);
      const dataType = this.getDataType(completion.type);
      if (data.guess) className += " " + cls + "guess";
      completions.push({
        text: completion.name + after,
        displayText: completion.displayName || completion.name,
        className: className,
        data: completion,
        origin: completion.origin,
        type: dataType,
      });
    }
    completions = this.sortCompletions(completions);
    const indexToBeSelected = completions.length > 1 ? 1 : 0;
    const obj = {
      from: from,
      to: to,
      list: completions,
      selectedHint: indexToBeSelected,
    };
    let tooltip: HTMLElement | undefined = undefined;
    CodeMirror.on(obj, "close", () => this.remove(tooltip));
    CodeMirror.on(obj, "update", () => this.remove(tooltip));
    CodeMirror.on(
      obj,
      "select",
      (cur: { data: { doc: string } }, node: any) => {
        this.active = cur;
        this.remove(tooltip);
        const content = cur.data.doc;
        if (content) {
          tooltip = this.makeTooltip(
            node.parentNode.getBoundingClientRect().right + window.pageXOffset,
            node.getBoundingClientRect().top + window.pageYOffset,
            content,
          );
          tooltip.className += " " + cls + "hint-doc";
          CodeMirror.on(
            cm,
            "keyup",
            (cm: CodeMirror.Editor, keyboardEvent: KeyboardEvent) => {
              if (
                keyboardEvent.code === "Space" &&
                keyboardEvent.ctrlKey &&
                tooltip
              ) {
                tooltip.className += " visible";
              }
            },
          );
        }
      },
    );
    resolve(obj);

    return obj;
  }

  getHint(cm: CodeMirror.Editor) {
    return new Promise((resolve) => {
      this.request(
        cm,
        {
          type: "completions",
          types: true,
          docs: true,
          urls: true,
          origins: true,
          caseInsensitive: true,
          guess: false,
        },
        (error, data) => this.requestCallback(error, data, cm, resolve),
      );
    });
  }

  sortCompletions(completions: Completion[]) {
    // Add data tree completions before others
    const expectedDataType = this.getExpectedDataType();
    const dataTreeCompletions = completions
      .filter((c) => c.origin === "dataTree")
      .sort((a: Completion, b: Completion) => {
        if (a.type === "FUNCTION" && b.type !== "FUNCTION") {
          return 1;
        } else if (a.type !== "FUNCTION" && b.type === "FUNCTION") {
          return -1;
        }
        return a.text.toLowerCase().localeCompare(b.text.toLowerCase());
      });
    const sameDataType = dataTreeCompletions.filter(
      (c) => c.type === expectedDataType,
    );
    const otherDataType = dataTreeCompletions.filter(
      (c) => c.type !== expectedDataType,
    );
    if (otherDataType.length && sameDataType.length) {
      const otherDataTitle: Completion = {
        text: "Search results",
        displayText: "Search results",
        className: "CodeMirror-hint-header",
        data: { doc: "" },
        origin: "",
        type: "UNKNOWN",
        isHeader: true,
      };
      const sameDataTitle: Completion = {
        text: "Best Match",
        displayText: "Best Match",
        className: "CodeMirror-hint-header",
        data: { doc: "" },
        origin: "",
        type: "UNKNOWN",
        isHeader: true,
      };
      sameDataType.unshift(sameDataTitle);
      otherDataType.unshift(otherDataTitle);
    }
    const docCompletetions = completions.filter((c) => c.origin === "[doc]");
    const otherCompletions = completions.filter(
      (c) => c.origin !== "dataTree" && c.origin !== "[doc]",
    );
    return [
      ...docCompletetions,
      ...sameDataType,
      ...otherDataType,
      ...otherCompletions,
    ];
  }

  getDataType(type: string): DataType {
    if (type === "?") return "UNKNOWN";
    else if (type === "number") return "NUMBER";
    else if (type === "string") return "STRING";
    else if (type === "bool") return "BOOLEAN";
    else if (type === "array") return "ARRAY";
    else if (/^fn\(/.test(type)) return "FUNCTION";
    else if (/^\[/.test(type)) return "ARRAY";
    else return "OBJECT";
  }

  getExpectedDataType() {
    const type = this.expected;
    if (type === "Array<Object>" || type === "Array") return "ARRAY";
    if (type === "boolean") return "BOOLEAN";
    if (type === "string") return "STRING";
    if (type === "number") return "NUMBER";
    if (type === "object" || type === "JSON") return "OBJECT";
    if (type === undefined) return "UNKNOWN";
    return undefined;
  }

  typeToIcon(type: string) {
    let suffix;
    if (type === "?") suffix = "unknown";
    else if (type === "number" || type === "string" || type === "bool")
      suffix = type;
    else if (/^fn\(/.test(type)) suffix = "fn";
    else if (/^\[/.test(type)) suffix = "array";
    else suffix = "object";
    return cls + "completion " + cls + "completion-" + suffix;
  }

  showContextInfo(cm: CodeMirror.Editor, queryName: string, callbackFn?: any) {
    this.request(cm, { type: queryName }, (error, data) => {
      if (error) return this.showError(cm, error);
      const tip = this.elt(
        "span",
        null,
        this.elt("strong", null, data.type || "not found"),
      );
      if (data.doc) tip.appendChild(document.createTextNode(" — " + data.doc));
      if (data.url) {
        tip.appendChild(document.createTextNode(" "));
        const child = tip.appendChild(this.elt("a", null, "[docs]"));
        // @ts-ignore: No types available
        child.href = data.url;

        // @ts-ignore: No types available
        child.target = "_blank";
      }
      this.tempTooltip(cm, tip);
      if (callbackFn) callbackFn(data);
    });
  }

  request(
    cm: CodeMirror.Editor,
    query: {
      type: string;
      types?: boolean;
      docs?: boolean;
      urls?: boolean;
      origins?: boolean;
      caseInsensitive?: boolean;
      preferFunction?: boolean;
      end?: CodeMirror.Position;
      guess?: boolean;
    },
    callbackFn: (error: any, data: any) => void,
    pos?: CodeMirror.Position,
  ) {
    const doc = this.findDoc(cm.getDoc());
    const request = this.buildRequest(doc, query, pos);
    // @ts-ignore: No types available
    this.server.request(request, callbackFn);
  }

  findDoc(doc: CodeMirror.Doc, name?: string): TernDoc {
    for (const n in this.docs) {
      const cur = this.docs[n];
      if (cur.doc === doc) return cur;
    }
    if (!name) {
      let n;
      for (let i = 0; ; ++i) {
        n = "[doc" + (i || "") + "]";
        if (!this.docs[n]) {
          name = n;
          break;
        }
      }
    }
    return this.addDoc(name, doc);
  }

  addDoc(name: string, doc: CodeMirror.Doc) {
    const data = { doc: doc, name: name, changed: null };
    this.server.addFile(name, this.getFocusedDynamicValue(data));
    CodeMirror.on(doc, "change", this.trackChange.bind(this));
    return (this.docs[name] = data);
  }

  buildRequest(
    doc: TernDoc,
    query: {
      type?: string;
      types?: boolean;
      docs?: boolean;
      urls?: boolean;
      origins?: boolean;
      fullDocs?: any;
      lineCharPositions?: any;
      end?: any;
      start?: any;
      file?: any;
    },
    pos?: CodeMirror.Position,
  ) {
    const files = [];
    let offsetLines = 0;
    const allowFragments = !query.fullDocs;
    if (!allowFragments) delete query.fullDocs;
    query.lineCharPositions = true;
    if (!query.end) {
      const lineValue = this.lineValue(doc);
      const focusedValue = this.getFocusedDynamicValue(doc);
      const index = lineValue.indexOf(focusedValue);

      const positions = pos || doc.doc.getCursor("end");
      const queryChPosition = positions.ch - index;

      query.end = {
        ...positions,
        line: 0,
        ch: queryChPosition,
      };

      if (doc.doc.somethingSelected()) {
        query.start = doc.doc.getCursor("start");
      }
    }
    const startPos = query.start || query.end;
    if (doc.changed) {
      if (
        doc.doc.lineCount() > bigDoc &&
        allowFragments &&
        doc.changed.to - doc.changed.from < 100 &&
        doc.changed.from <= startPos.line &&
        doc.changed.to > query.end.line
      ) {
        files.push(this.getFragmentAround(doc, startPos, query.end));
        query.file = "#0";
        offsetLines = files[0].offsetLines;
        if (query.start) {
          query.start = Pos(query.start.line - -offsetLines, query.start.ch);
        }
        query.end = Pos(query.end.line - offsetLines, query.end.ch);
      } else {
        files.push({
          type: "full",
          name: doc.name,
          text: this.getFocusedDynamicValue(doc),
        });
        query.file = doc.name;
        doc.changed = null;
      }
    } else {
      query.file = doc.name;
    }
    for (const name in this.docs) {
      const cur = this.docs[name];
      if (cur.changed && cur !== doc) {
        files.push({
          type: "full",
          name: cur.name,
          text: this.getFocusedDynamicValue(cur),
        });
        cur.changed = null;
      }
    }

    return { query: query, files: files };
  }

  trackChange(
    doc: CodeMirror.Doc,
    change: {
      to: CodeMirror.Position;
      from: CodeMirror.Position;
      text: string | any[];
    },
  ) {
    const data = this.findDoc(doc);

    const argHints = this.cachedArgHints;
    if (
      argHints &&
      argHints.doc === doc &&
      cmpPos(argHints.start, change.to) >= 0
    )
      this.cachedArgHints = null;

    let changed = data.changed;
    if (changed === null)
      data.changed = changed = { from: change.from.line, to: change.from.line };
    const end = change.from.line + (change.text.length - 1);
    if (change.from.line < changed.to)
      changed.to = changed.to - (change.to.line - end);
    if (end >= changed.to) changed.to = end + 1;
    if (changed.from > change.from.line) changed.from = change.from.line;

    if (doc.lineCount() > bigDoc && changed.to - changed.from > 100)
      setTimeout(() => {
        if (data.changed && data.changed.to - data.changed.from > 100)
          this.sendDoc(data);
      }, 200);
  }

  sendDoc(doc: TernDoc) {
    this.server.request(
      {
        // @ts-ignore: No types available
        files: [
          // @ts-ignore: No types available
          {
            type: "full",
            name: doc.name,
            text: this.getFocusedDynamicValue(doc),
          },
        ],
      },
      function(error: Error) {
        if (error) window.console.error(error);
        else doc.changed = null;
      },
    );
  }

  lineValue(doc: TernDoc) {
    const cursor = doc.doc.getCursor();

    return doc.doc.getLine(cursor.line);
  }

  docValue(doc: TernDoc) {
    return doc.doc.getValue();
  }

  getFocusedDynamicValue(doc: TernDoc) {
    const cursor = doc.doc.getCursor();
    const value = this.lineValue(doc);
    const stringSegments = getDynamicStringSegments(value);
    const dynamicStrings = stringSegments.filter((segment) => {
      if (isDynamicValue(segment)) {
        const index = value.indexOf(segment);

        if (cursor.ch >= index && cursor.ch <= index + segment.length) {
          return true;
        }
      }

      return false;
    });

    return dynamicStrings.length ? dynamicStrings[0] : value;
  }

  getFragmentAround(
    data: TernDoc,
    start: CodeMirror.Position,
    end: CodeMirror.Position,
  ) {
    const doc = data.doc;
    let minIndent = null;
    let minLine = null;
    let endLine;
    const tabSize = 4;
    for (let p = start.line - 1, min = Math.max(0, p - 50); p >= min; --p) {
      const line = doc.getLine(p),
        fn = line.search(/\bfunction\b/);
      if (fn < 0) continue;
      const indent = CodeMirror.countColumn(line, null, tabSize);
      if (minIndent != null && minIndent <= indent) continue;
      minIndent = indent;
      minLine = p;
    }
    if (minLine === null) minLine = Math.max(0, start.line - 1);
    const max = Math.min(doc.lastLine(), end.line + 20);
    if (
      minIndent === null ||
      minIndent ===
        CodeMirror.countColumn(doc.getLine(start.line), null, tabSize)
    )
      endLine = max;
    else
      for (endLine = end.line + 1; endLine < max; ++endLine) {
        const indent = CodeMirror.countColumn(
          doc.getLine(endLine),
          null,
          tabSize,
        );
        if (indent <= minIndent) break;
      }
    const from = Pos(minLine, 0);

    return {
      type: "part",
      name: data.name,
      offsetLines: from.line,
      text: doc.getRange(
        from,
        Pos(endLine, end.line === endLine ? undefined : 0),
      ),
    };
  }

  showError(cm: CodeMirror.Editor, msg: string) {
    this.tempTooltip(cm, String(msg));
  }

  tempTooltip(cm: CodeMirror.Editor, content: HTMLElement | string) {
    if (cm.state.ternTooltip) this.remove(cm.state.ternTooltip);
    if (cm.state.completionActive) {
      // @ts-ignore: No types available
      cm.closeHint();
    }
    const where = cm.cursorCoords();
    const tip = (cm.state.ternTooltip = this.makeTooltip(
      // @ts-ignore: No types available
      where.right + 1,
      where.bottom,
      content,
    ));
    const maybeClear = () => {
      old = true;
      if (!mouseOnTip) clear();
    };
    const clear = () => {
      cm.state.ternTooltip = null;
      if (tip.parentNode) this.fadeOut(tip);
      clearActivity();
    };
    let mouseOnTip = false;
    let old = false;
    CodeMirror.on(tip, "mousemove", function() {
      mouseOnTip = true;
    });
    CodeMirror.on(tip, "mouseout", function(e: MouseEvent) {
      const related = e.relatedTarget;
      // @ts-ignore: No types available
      if (!related || !CodeMirror.contains(tip, related)) {
        if (old) clear();
        else mouseOnTip = false;
      }
    });
    setTimeout(maybeClear, hintDelay);
    const clearActivity = this.onEditorActivity(cm, clear);
  }

  onEditorActivity(
    cm: CodeMirror.Editor,
    f: (instance: CodeMirror.Editor) => void,
  ) {
    cm.on("cursorActivity", f);
    cm.on("blur", f);
    cm.on("scroll", f);
    cm.on("setDoc", f);
    return function() {
      cm.off("cursorActivity", f);
      cm.off("blur", f);
      cm.off("scroll", f);
      cm.off("setDoc", f);
    };
  }

  makeTooltip(x: number, y: number, content: HTMLElement | string) {
    const node = this.elt("div", cls + "tooltip", content);
    node.style.left = x + "px";
    node.style.top = y + "px";
    document.body.appendChild(node);
    return node;
  }

  remove(node?: HTMLElement) {
    if (node) {
      const p = node.parentNode;
      if (p) p.removeChild(node);
    }
  }

  elt(
    tagName: string,
    cls: string | null,
    content: string | HTMLElement,
  ): HTMLElement {
    const e = document.createElement(tagName);
    if (cls) e.className = cls;
    if (content) {
      const eltNode =
        typeof content === "string"
          ? document.createTextNode(content)
          : content;
      e.appendChild(eltNode);
    }
    return e;
  }

  fadeOut(tooltip: HTMLElement) {
    this.remove(tooltip);
  }
}

export default TernServer;
