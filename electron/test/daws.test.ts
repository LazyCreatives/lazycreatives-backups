import { describe, expect, it } from "vitest";
import { dawLabel } from "../src/format";
import { dawDisplay, toProject } from "../src/screens/Crate/types";

describe("music program names", () => {
  it("names Logic Pro projects in both looks", () => {
    expect(dawLabel("logic")).toBe("Logic");
    expect(dawDisplay("logic")).toBe("Logic Pro");
    expect(toProject({ project_name: "Night Drive", daw: "logic" } as any).daw).toBe("logic");
  });
  it("names Studio One songs in both looks", () => {
    expect(dawLabel("studioone")).toBe("Studio One");
    expect(dawDisplay("studioone")).toBe("Studio One");
    expect(toProject({ project_name: "Night Drive", daw: "studioone" } as any).daw).toBe("studioone");
  });
  it("still falls back for programs it doesn't know", () => {
    expect(dawLabel("cubase")).toBe("DAW");
  });
});
