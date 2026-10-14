import { defineConfig } from "vitest/config";

export default defineConfig({
  // Integration tests spawn many short git processes; under `npm run` the extended PATH can make each spawn slow.
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
