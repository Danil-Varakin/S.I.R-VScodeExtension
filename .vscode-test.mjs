import { defineConfig } from '@vscode/test-cli';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorkspaces } from './test/e2e/fixture.mjs';
import { pinTheme } from './scripts/pin-theme.mjs';

const { sir, quiet } = makeWorkspaces();

// Where the editor keeps the profile of a test run. By default it is `.vscode-test/user-data`
// beside this file, and on macOS that can be too deep: the editor opens a unix socket inside
// it, and the path may not exceed 103 characters — on CI, where the checkout sits under
// `work/<repo>/<repo>/…`, it did ("listen EINVAL"). CI names a short directory here instead.
const userData = process.env.SIR_TEST_USER_DATA;

// the theme of the test window: scripts/pin-theme.mjs
pinTheme(userData ?? join(dirname(fileURLToPath(import.meta.url)), '.vscode-test', 'user-data'));

// A runner has no GPU and a small /dev/shm; both have hung the window on start there.
const headless = process.platform === 'linux' ? ['--disable-gpu', '--disable-dev-shm-usage'] : [];

const common = {
  version: 'stable',
  mocha: { ui: 'tdd', timeout: 60_000 },
  launchArgs: [
    '--disable-extensions',
    '--disable-workspace-trust',
    ...headless,
    ...(userData === undefined ? [] : [`--user-data-dir=${userData}`]),
  ],
};

// `npm run test:packaged` (scripts/test-packaged.mjs) installs the .vsix into a throwaway
// profile, copies the compiled suite inside it and names the folder here: the same tests
// then run against the packaged files instead of this working tree, and nothing else runs.
const packaged = process.env.SIR_PACKAGED_DIR;

export default defineConfig(
  packaged === undefined
    ? [
        { ...common, label: 'sir', files: 'out/e2e/*.e2e.cjs', workspaceFolder: sir },
        { ...common, label: 'quiet', files: 'out/e2e/quiet.e2e.cjs', workspaceFolder: quiet },
      ]
    : [
        {
          ...common,
          label: 'packaged',
          files: process.env.SIR_PACKAGED_FILES,
          workspaceFolder: sir,
          extensionDevelopmentPath: packaged,
        },
      ],
);
