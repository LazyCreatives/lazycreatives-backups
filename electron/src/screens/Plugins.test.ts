import { describe, expect, it } from "vitest";
import { pluginTree, sortPlugins } from "./Plugins";
import type { PluginRow } from "../types";

const p = (name: string, maker: string, kind: PluginRow["kind"], used_in = 0) =>
  ({ id: name, name, maker, kind, used_in, formats: [], places: [], used_by: [] }) as unknown as PluginRow;
const rows = [
  p("Serum", "Xfer Records", "Instrument", 5), p("OTT", "Xfer Records", "Effect", 9),
  p("Pro-Q 3", "FabFilter", "Effect", 2), p("Mystery", "", "Effect"), p("Odd", "Arturia", ""),
  p("Pigments", "Arturia", "Instrument", 1), p("LFOTool", "Xfer Records", "Effect"),
];
const names = (r: PluginRow[]) => r.map((x) => x.name);

describe("pluginTree", () => {
  it("makes one folder per maker A to Z, unknown maker last, then one per type", () => {
    const t = pluginTree(sortPlugins(rows, { key: "name", dir: 1 }));
    expect(t.map((m) => m.maker)).toEqual(["Arturia", "FabFilter", "Xfer Records", "Maker not known"]);
    expect(t[0].kinds.map((k) => k.label)).toEqual(["Instruments", "Type not known"]);
    expect(t[2].kinds.map((k) => [k.label, names(k.rows)])).toEqual([["Instruments", ["Serum"]], ["Effects", ["LFOTool", "OTT"]]]);
    expect(t[2].count).toBe(3);
  });
});

describe("sortPlugins", () => {
  it("sorts by name, or by how many projects use it", () => {
    expect(names(sortPlugins(rows, { key: "name", dir: 1 }))[0]).toBe("LFOTool");
    expect(names(sortPlugins(rows, { key: "used", dir: -1 })).slice(0, 2)).toEqual(["OTT", "Serum"]);
  });
});
