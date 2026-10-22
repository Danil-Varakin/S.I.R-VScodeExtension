// Mutation testing (`npm run test:mutation`): Stryker plants one small fault at a time in
// the code below and runs the unit suite; a fault no test notices is a test that is missing.
//
// Only the code the unit suite reaches is mutated — the code with no `vscode` at run time.
// The rest is tested end to end only, and one run of that suite per fault would take hours.
// The runner is the plain `npm test`: node:test has no Stryker runner of its own, and the
// whole suite runs in about two seconds, so per-test coverage would save little.
//
// A fault must be caught by a test that noticed it, not by a test that ran out of time: the
// instrumented code is slower, and a suite under load misses its own clocks. Hence two
// runners at a time, a generous timeout, and the timing checks left out (`SIR_PERF` unset).

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'npm test' },
  mutate: [
    'src/duration.ts',
    'src/errors.ts',
    'src/hash.ts',
    'src/keys.ts',
    'src/lru.ts',
    'src/minimal-edit.ts',
    'src/patch-files.ts',
    'src/patch-template.ts',
    'src/settings.ts',
    'src/feedback/*.ts',
    'src/navigation/dependencies.ts',
    'src/navigation/failure.ts',
    'src/navigation/focus.ts',
    'src/navigation/hunks.ts',
    'src/navigation/index-store.ts',
    'src/navigation/text.ts',
    'src/project/base.ts',
    'src/project/init-config.ts',
    'src/project/languages.ts',
    'src/service/client.ts',
    'src/service/process.ts',
    'src/service/protocol.ts',
  ],
  // what the unit suite reads besides src/ and test/: the manifest, the grammar, the scripts
  ignorePatterns: ['docs', 'dist', 'out', '.vscode-test', '*.vsix', 'reports'],
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  thresholds: { high: 90, low: 80, break: 80 },
  concurrency: 2,
  timeoutFactor: 3,
  timeoutMS: 30_000,
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
