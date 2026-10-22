import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    // The design is mobile first: the phone profile is the one that must always pass.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    // The API is stood in for by a small fixture server, so these tests need no database.
    { command: "node e2e/mock-api.mjs", url: "http://localhost:4010/api/v1/health", reuseExistingServer: !process.env.CI, timeout: 30_000 },
    {
      // A production build is what ships, so that is what is tested.
      command: `npm run build && npx next start --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: { API_BASE_URL: "http://localhost:4010/api/v1", NEXT_PUBLIC_API_BASE_URL: "http://localhost:4010/api/v1" },
    },
  ],
});
