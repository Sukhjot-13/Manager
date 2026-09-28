import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: rootDir }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
