// `npm test` with the timing checks on (`SIR_PERF=1`), as CI runs it. They are off by
// default: under Stryker or a busy machine a slow run is not a fault in the code.
import { spawnSync } from 'node:child_process';

const run = spawnSync('npm', ['test'], {
  stdio: 'inherit',
  env: { ...process.env, SIR_PERF: '1' },
  shell: process.platform === 'win32',
});
process.exit(run.status ?? 1);
