import "dotenv/config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", timeout: 30_000, fullyParallel: false, workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3002", browserName: "chromium", channel: "msedge", trace: "retain-on-failure", screenshot: "only-on-failure" },
  reporter: [["list"], ["html", { open: "never", outputFolder: ".runtime/playwright-report" }]],
});
