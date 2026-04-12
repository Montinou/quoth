import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 10000,
    // Limit concurrency to reduce I/O contention on WSL2 ext4.
    // At default concurrency (16 workers on this 16-core host), 56 test files
    // hammering the same volume simultaneously pushes writeSync latency above
    // the 100ms budget of the perf test. 4 workers keeps throughput reasonable
    // while keeping I/O latency manageable.
    maxWorkers: 4,
    minWorkers: 1,
  },
})
