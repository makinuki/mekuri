import { defineConfig, devices } from "@playwright/test";

// Browser tier. The example lab is the only target: it is the reference host,
// and the one page on which the prebuilt views and the host-owned contract are
// rendered together. A dev server that is already running is reused.
//
// Layout-sensitive specs live under e2e/desktop, touch specs under e2e/mobile,
// and specs that hold on every device at the top level. Each project ignores
// the directory it cannot serve.

const LAB_URL = "http://localhost:5273";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: LAB_URL,
    viewport: { width: 1280, height: 800 },
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm example:dev",
    url: LAB_URL,
    reuseExistingServer: !process.env["CI"],
    stdout: "ignore",
    stderr: "pipe",
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/mobile/**",
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: "**/mobile/**",
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: "**/mobile/**",
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testIgnore: "**/desktop/**",
    },
  ],
});
