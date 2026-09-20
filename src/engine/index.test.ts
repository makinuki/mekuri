import { describe, expect, it } from "vite-plus/test";
import * as engine from "./index";
import * as views from "../views/index";
import * as testUtils from "../test-utils/index";

// Scaffold smoke test: the three package surfaces must resolve and stay
// side-effect free. Engine and test-utils must never pull in view code.
describe("mekuri package barrels", () => {
  it("exposes the engine, views, and test-utils entry points", () => {
    expect(engine).toBeDefined();
    expect(views).toBeDefined();
    expect(testUtils).toBeDefined();
  });
});
