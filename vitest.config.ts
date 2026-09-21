import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // All test files share one real Postgres DB and truncate it in
    // beforeEach (tests/helpers/testDb.ts). Running files in parallel lets
    // one file's truncateAll() wipe rows another file just created
    // mid-test — confirmed flaky under default parallelism during Task 8.
    // Serializing file execution trades some wall-clock time for a test
    // suite that isn't racy against itself.
    fileParallelism: false,
  },
});
