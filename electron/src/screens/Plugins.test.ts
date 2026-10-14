import { describe, expect, it } from "vitest";
import { makerCards, sortPlugins } from "./Plugins";
import type { PluginRow } from "../types";

const p = (name: string, maker: string, kind: PluginRow["kind"], used_in = 0) =>
  ({ id: name, name, maker, kind, used_in, formats: [], places: [], used_by: [] }) as unknown as PluginRow;
const rows = [
  p("Serum", "Xfer Records", "Instrument", 5), p("OTT", "Xfer Records", "Effect", 9),
  p("Pro-Q 3", "FabFilter", "Effect", 2), p("Mystery", "", "Effect"), p("Odd", "Arturia", ""),
  p("Pigments", "Arturia", "Instrument", 1), p("LFOTool", "Xfer Records", "Effect"),
];
const names = (r: PluginRow[]) => r.map((x) => x.name);

describe("makerCards", () => {
  it("counts each maker's plugins, types and used ones; most used first, unknown maker last", () => {
    const c = makerCards(rows);
    expect(c.map((m) => m.maker)).toEqual(["Xfer Records", "Arturia", "FabFilter", "Maker not known"]);
    expect(c[0]).toEqual({ maker: "Xfer Records", count: 3, instruments: 1, effects: 2, used: 2 });
    expect(makerCards(rows, "name").map((m) => m.maker)).toEqual(["Arturia", "FabFilter", "Xfer Records", "Maker not known"]);
  });
});

describe("sortPlugins", () => {
  it("sorts by name, or by how many projects use it", () => {
    expect(names(sortPlugins(rows, { key: "name", dir: 1 }))[0]).toBe("LFOTool");
    expect(names(sortPlugins(rows, { key: "used", dir: -1 })).slice(0, 2)).toEqual(["OTT", "Serum"]);
  });
});
