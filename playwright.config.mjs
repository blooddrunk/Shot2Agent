import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./apps/desktop/tests",
  testMatch: "*.spec.mjs",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  outputDir: "build/ui-test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "build/ui-report", open: "never" }],
  ],
  webServer: {
    command:
      "pnpm exec vite --config apps/desktop/vite.config.mjs --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
