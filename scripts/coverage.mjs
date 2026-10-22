// One coverage report over both suites (`npm run coverage`): the unit tests, which run the
// sources as they are, and the end-to-end suite, which runs the bundle in a real editor and
// is mapped back to src/ through dist/extension.cjs.map.
//
// Each suite reports on its own, as Istanbul JSON: the unit tests under c8, the end-to-end
// suite under vscode-test's own --coverage. That one cannot be handed a directory of raw V8
// coverage — it sets NODE_V8_COVERAGE of the extension host itself, to its own temporary
// directory — so the two are merged here, as reports, and only what is under src/ is kept.
//
// The end-to-end suite is the one CI runs on Linux and Windows; on macOS it needs the test
// window to keep the focus (CONTRIBUTING), or the number measures the runner.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'coverage');
rmSync(out, { recursive: true, force: true });

const run = (command, args) => {
  const done = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return done.status ?? 1;
};

const unit = run('npx', ['c8', '--reporter', 'json', '--report-dir', join(out, 'unit'), 'npm', 'test']);
const e2e = run('npm', ['run', 'test:e2e', '--', '--coverage', '--coverage-reporter', 'json', '--coverage-output', join(out, 'e2e')]);

const map = libCoverage.createCoverageMap({});
const src = join(root, 'src') + sep;
for (const suite of ['unit', 'e2e']) {
  const json = join(out, suite, 'coverage-final.json');
  if (!existsSync(json)) {
    console.error(`no coverage from the ${suite} suite: ${json}`);
    continue;
  }
  const one = libCoverage.createCoverageMap(JSON.parse(readFileSync(json, 'utf8')));
  // the tests themselves and the core in node_modules are not what is measured
  one.filter((file) => file.startsWith(src));
  map.merge(one);
}

const context = libReport.createContext({ dir: out, coverageMap: map, defaultSummarizer: 'nested' });
for (const reporter of ['text-summary', 'html']) reports.create(reporter).execute(context);
console.log(`\nreport: coverage/index.html${unit === 0 && e2e === 0 ? '' : ' (a suite failed: the number covers what ran)'}`);
process.exit(unit || e2e);
