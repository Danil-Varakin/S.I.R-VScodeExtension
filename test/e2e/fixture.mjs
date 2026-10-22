// The workspaces the end-to-end tests open, made fresh for every run in the temp directory.
// `sir`: projects side by side — one repository with a git base, a project over an
// upstream inside it, a folder with no git (the saved file is the base), and a repository
// with no config at all. `quiet`: a file of code and nothing of sir.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export const OLD_CC = 'int f() {\n  return 1;\n}\n\nint g() {\n  return 10;\n}\n';
export const OLD_PY = 'def f():\n    return 1\n';
// two identical if-blocks: a change in the second one no pattern anchors (golden cpp/57)
const TWIN_BODY = '  if (cond) {\n    a();\n    work();\n  }\n';
export const TWIN_CC = `void f() {\n${TWIN_BODY}${TWIN_BODY}}\n`;
// one call in two functions: a pattern that names only the call fits twice
export const MANY_CC = 'void a() { one(); }\nvoid b() { one(); }\n';
export const CHAIN_CC = 'void a() { one(); }\n';

function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

function commit(root) {
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'base');
}

export function makeWorkspaces() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'sir-e2e-')));

  const sir = join(top, 'sir');
  const repo = join(sir, 'repo');
  write(repo, {
    'sir.config.json': JSON.stringify({ version: 3, generate: { base: { head: true } } }),
    'src/a.cc': OLD_CC,
    'src/nav.cc': OLD_CC,
    'src/focus.cc': OLD_CC,
    'src/drift.cc': OLD_CC,
    'src/regen.cc': OLD_CC,
    'src/other.cc': OLD_CC,
    'src/other.py': 'def f():\n    return 3\n',
    'src/guard.cc': OLD_CC,
    'src/twin.cc': OLD_CC,
    'src/notes.cc': OLD_CC,
    'src/orphsrc.cc': OLD_CC,
    'src/panel.cc': OLD_CC,
    'src/repair.cc': OLD_CC,
    'src/clean.cc': OLD_CC,
    'src/broken.cc': OLD_CC,
    'src/out.cc': OLD_CC,
    'src/state.cc': OLD_CC,
    'src/apply.cc': OLD_CC,
    'src/apply-edits.cc': OLD_CC,
    'src/apply-all-1.cc': OLD_CC,
    'src/apply-all-2.cc': OLD_CC,
    'src/apply-broken.cc': OLD_CC,
    'src/fresh.cc': OLD_CC,
    'src/menu.cc': OLD_CC,
    'src/twins.cc': TWIN_CC,
    'src/twins-bad.cc': TWIN_CC,
    'src/fresh-twice.cc': OLD_CC,
    'src/started.cc': OLD_CC,
    'src/b.py': OLD_PY,
    'src/crlf.cc': OLD_CC.replace(/\n/g, '\r\n'),
    'src/many.cc': MANY_CC,
    'src/chain.cc': CHAIN_CC,
    'src/commit.cc': OLD_CC,
    'src/report-ok.cc': OLD_CC,
    'src/report-bad.cc': OLD_CC,
    'src/undo.cc': OLD_CC,
    'BUILD.gn': 'group("all") {}\n',
  });
  commit(repo);
  // a file the base revision does not have: its patch is an orphan
  write(repo, { 'src/new.cc': OLD_CC });

  const proj = join(sir, 'proj');
  write(proj, {
    'sir.config.json': JSON.stringify({ version: 3, upstream: 'up', generate: { out: 'patches', base: { head: true } } }),
    'up/src/c.cc': OLD_CC,
    'up/src/d.cc': OLD_CC,
  });
  commit(proj);

  const saved = join(sir, 'saved');
  write(saved, { 'sir.config.json': JSON.stringify({ version: 3 }), 's.cc': OLD_CC, 'apply.cc': OLD_CC });

  // a repository with no config yet: what Init Config writes one for
  const bare = join(sir, 'bare');
  write(bare, { 'x.cc': OLD_CC });
  commit(bare);

  const quiet = join(top, 'quiet');
  write(quiet, { 'x.cc': OLD_CC });

  return { sir, quiet };
}
