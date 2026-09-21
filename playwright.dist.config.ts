import { defineConfig, devices } from "@playwright/test";

// Release leg: the same lab built against the package output instead of the
// library source, so the entries a host installs are the ones under test.
// Run it with `pnpm test:e2e:dist`; it builds the library and the lab first.

const LAB_URL = "http://localhost:5274";

export default defineConfig({
  testDir: "e2e-dist",
  reporter: [["list"]],
  use: {
    baseURL: LAB_URL,
    viewport: { width: 1280, height: 800 },
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm build && pnpm example:build:dist && pnpm example:preview",
    url: LAB_URL,
    reuseExistingServer: !process.env["CI"],
    stdout: "ignore",
    stderr: "pipe",
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
