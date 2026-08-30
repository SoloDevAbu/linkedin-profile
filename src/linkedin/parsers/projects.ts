import type { RscResponse } from "./rsc.js";
import { parseToStructuredItems } from "./utils.js";

function resolveRscTree(text: string): any {
  const lines = text.split("\n");
  const dict = new Map<string, any>();

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const id = line.slice(0, colonIdx);
    const valStr = line.slice(colonIdx + 1);
    try {
      if (valStr.startsWith("I[")) {
        dict.set(id, JSON.parse(valStr.slice(1)));
      } else {
        dict.set(id, JSON.parse(valStr));
      }
    } catch {}
  }

  function resolve(node: any, seen = new Set<string>()): any {
    if (typeof node === "string" && node.startsWith("$L")) {
      const refId = node.slice(2);
      if (seen.has(refId)) return null;
      const refNode = dict.get(refId);
      if (refNode) {
        seen.add(refId);
        const resolved = resolve(refNode, seen);
        seen.delete(refId);
        return resolved;
      }
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((n) => resolve(n, seen));
    }
    if (node && typeof node === "object") {
      const res: any = {};
      for (const k of Object.keys(node)) {
        res[k] = resolve(node[k], seen);
      }
      return res;
    }
    return node;
  }

  return resolve(dict.get("0"));
}

function collectTextNodes(node: any, out: string[]): void {
  if (typeof node === "string") {
    const s = node.trim();
    if (
      s &&
      !s.startsWith("$") &&
      !s.startsWith("urn:li") &&
      !s.startsWith("com.linkedin") &&
      !/^_?[0-9a-f]{6,}$/i.test(s)
    ) {
      if (s.startsWith("{") && s.endsWith("}")) return;
      out.push(s);
    }
    return;
  }
  if (Array.isArray(node)) {
    if (
      node[0] === "$" ||
      (typeof node[0] === "string" && node[0].startsWith("$"))
    ) {
      const props = node.length >= 4 ? node[3] : node[2];
      if (props && typeof props === "object") {
        collectTextNodes(props, out);
      }
      return;
    }
    for (const item of node) collectTextNodes(item, out);
    return;
  }
  if (node && typeof node === "object") {
    if ("children" in node) collectTextNodes(node["children"], out);
    if ("textProps" in node) collectTextNodes(node["textProps"], out);
  }
}

export function parseProjects(response: RscResponse): any[] {
  const text = response.text;
  if (!text) return [];

  const tree = resolveRscTree(text);
  const rawLines: string[] = [];
  collectTextNodes(tree, rawLines);

  const skipStrings = new Set([
    "Projects",
    "Message",
    "Collapsed",
    "Expanded",
    "Show all",
    "more",
    "less",
    "default",
    "Skills:",
  ]);

  const filteredLines = rawLines.filter(
    (line) =>
      line.length >= 2 &&
      !skipStrings.has(line) &&
      !/^\d+$/.test(line) &&
      !/^\d+\.\d+\.\d+$/.test(line),
  );

  const values = filteredLines.filter((l, i) => l !== filteredLines[i - 1]);
  if (values.length === 0) return [];

  const isDate = (s: string | undefined) => {
    if (!s) return false;
    return (
      /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Present)\s\d{2,4}/i.test(
        s,
      ) || /\d{4}\s*[-–]\s*\d{4}/.test(s)
    );
  };

  const results: any[] = [];
  let project: any = { extra: [] };

  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (!val) continue;
    const next1 = values[i + 1];

    let startNew = false;
    if (
      project.title &&
      val.length < 150 &&
      !isDate(val) &&
      !val.startsWith("Associated with")
    ) {
      if (isDate(next1)) {
        startNew = true;
      } else if (next1 && next1.startsWith("Associated with")) {
        startNew = true;
      }
    }

    if (startNew) {
      if (project.extra.length > 0)
        project.description = project.extra.join("\n");
      delete project.extra;
      results.push(project);
      project = { extra: [] };
    }

    if (isDate(val)) {
      project.dateRange = val;
    } else if (val.startsWith("Associated with")) {
      project.locationOrExtra = val;
    } else if (!project.title) {
      project.title = val;
    } else {
      project.extra.push(val);
    }
  }

  if (project.title) {
    if (project.extra.length > 0)
      project.description = project.extra.join("\n");
    delete project.extra;
    results.push(project);
  }

  return results;
}
