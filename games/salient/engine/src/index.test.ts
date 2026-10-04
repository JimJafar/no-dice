import { describe, expect, it } from "vitest";

import { enginePackage } from "./index";

describe("salient engine package", () => {
  it("is wired into the workspace", () => {
    expect(enginePackage.name).toBe("@no-dice/salient-engine");
  });
});
