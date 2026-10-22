# Contributing

> Русская версия: [CONTRIBUTING.ru.md](./CONTRIBUTING.ru.md)

- The extension is a client of the sir service. The versioning rules of sir — the
  package version, the protocol, the config schema, the patch format — are in the core's
  [VERSIONING.md](https://github.com/Danil-Varakin/S.I.R/blob/main/VERSIONING.md) and
  bind this repository as they bind the core. The rules below are the ones specific to the
  extension.
- The structure of the code is described in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Setup

Requirements: Node.js 22 and npm, git, VS Code 1.101 or later.

```bash
npm install
```

`npm install` installs the core as the release tarball named in `package.json`
(`dependencies.sirp`).

| Script | What it does |
|---|---|
| `npm run build` | generates `syntaxes/sir.tmLanguage.json` and bundles `src/extension.ts` into `dist/extension.cjs` |
| `npm run watch` | rebuilds the bundle on every change of the sources; the grammar is not regenerated |
| `npm run grammar` | regenerates `syntaxes/sir.tmLanguage.json` from the language registry of the installed core |
| `npm run typecheck` | `tsc` over the project |
| `npm test` | the unit tests, `node --test` over `test/**/*.test.ts`, without an editor |
| `npm run check` | `typecheck`, then `test` |
| `npm run test:perf` | `npm test` with `SIR_PERF=1`: the tests also check their timings, as in CI |
| `npm run test:e2e` | `build`, then the end-to-end suite in a real VS Code; the first run downloads VS Code into `.vscode-test/` |
| `npm run package` | `build`, the check of the package contents, then `sir-vscode-<version>.vsix` |
| `npm run test:packaged` | installs the `.vsix` written by `package` into a throwaway profile and runs the end-to-end suite inside it |
| `npm run coverage` | the unit tests under c8 and the end-to-end suite under `vscode-test --coverage`, merged into one report of `src/`: `coverage/index.html` |
| `npm run test:mutation` | mutation testing of the pure modules (Stryker, `stryker.config.mjs`); the report is `reports/mutation/mutation.html` |

**F5** opens an *Extension Development Host* window (`.vscode/launch.json`; the `build`
task runs first). The same window from a terminal:

```bash
code --extensionDevelopmentPath=. /path/to/a/project
```

Changes of the code and of the manifest take effect after **Developer: Reload Window** in
that window.

### A local core

To work against a core being changed at the same time, the core's checkout is placed next
to this one and linked without changing the manifest:

```
some-dir/
├── S.I.R/                  git clone https://github.com/Danil-Varakin/S.I.R S.I.R
│                             npm install && npm run build
└── S.I.R-VScodeExtension/    this repository
```

```bash
npm install --no-save ../S.I.R   # node_modules/sir becomes a link to the checkout
```

- Everything here then runs the core from `S.I.R/dist`; after a change or a `git pull` in
  the core, `npm run build` in `S.I.R` comes first.
- `npm install` without the flag restores the released core.
- `npm run package` refuses to run while `node_modules/sir` is a link (see
  [Packaging](#packaging)).

## Packaging

A package is built against the released core only:

```bash
npm install             # the released core
npm run package         # the bundle, the contents check, sir-vscode-<version>.vsix
npm run test:packaged   # the end-to-end suite against the installed .vsix
```

- **A linked core is refused.** vsce does not accept a path above the package root, and
  the link would carry the core's build tree and dev dependencies instead of its package.
- **The contents are checked** before the `.vsix` is written (`scripts/package-contents.mjs`):
  the bundle, the files the manifest refers to, the service entry of the core and its
  grammars must be inside; the sources, the tests, the local `docs/` and the documents for
  contributors must stay out (`.vscodeignore`).
- **No LICENSE file.** The repository has none, so the package is written with
  `skipLicense`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | Where | What |
|---|---|---|
| `test` | Linux, macOS, Windows × two cores: `release` (the one `package.json` names) and `dev` (branch `dev` of sirTs, or the revision given to a manual run) | `npm run check`; on Linux and Windows also `npm run test:e2e` |
| `package` | Linux, after `test` | `npm run package` with the released core; the `.vsix` is kept as a build artifact |
| `packaged` | Linux, Windows, after `package` | `npm run test:packaged` against that `.vsix` |

The end-to-end suite does not run on the macOS runner: the editor reports the active editor
to extensions only while its window has focus, and that runner has no focused window. On
macOS the suite is run by hand before a release.

`.github/workflows/release.yml` runs on a tag `v*`:

1. The tag must equal `v` + the version in `package.json`; otherwise the run fails.
2. `npm run check`, `npm run test:e2e`, `npm run package`, `npm run test:packaged`.
3. The `.vsix` is attached to the GitHub Release of the tag.

Nothing is published to the Marketplace or to Open VSX.

## The architectural rule

**The extension holds no S.I.R logic.** It does not parse `.sirp`, match patterns, carry
positions between versions of a file, or determine where a patch goes or which file it
belongs to. It asks the core (`generate`, `resolve`, `apply`, `config`, `pair`) and shows
the answer.

- A second copy of any of these rules would diverge from the core without notice and
  produce plausible but wrong coordinates.
- A feature that seems to need such a rule gets it in the core, and the extension reads it
  through the protocol.

The second rule: **never jump to a plausible place.** Every answer is an exact place, a
place named as approximate, or a refusal with its reason and a next step.

## The protocol range (R7–R9)

R7–R9 are the client rules of VERSIONING.md.

- The extension declares a **range**, `SUPPORTED_PROTOCOL = { min, max }` in
  `src/service/protocol.ts`: `max` is the newest protocol it was written and tested
  against, `min` the oldest core it still works with.
- It is compatible with a core when the ranges overlap: `min ≤ protocol` and
  `protocolMin ≤ max`. A core without `protocolMin` (protocol 2 and older) is read as
  `protocolMin = protocol`.
- **Protocol numbers are never compared for equality** (R9): such a check breaks the
  extension on every raise of the protocol, compatible or not.
- `max` is raised only after the tests have run against a core of that protocol. `min` is
  raised only when the extension starts to rely on something older cores lack, and that is
  a breaking change for the extension.
- The working protocol is `min(protocol of the core, max)`. A feature of a protocol newer
  than `min` is used only when the core announced that protocol.
- Paths in requests are absolute (protocol 2): the service has no working directory.
- Protocol types are re-exported from `sir/protocol`, never copied, so a mismatch with the
  core is a compile error. Exception: a field of a protocol newer than the shipped core is
  declared in `src/service/protocol.ts`, optional and with its protocol in the name
  (`ConfigResultV5`, `GenerateParamsV5`), and is removed when the dependency moves to a core
  that has it.

## Editor settings mirror the config (E1)

- Every `generate.*` key of `sir.config.json` has a `sir.*` setting with the same path
  minus `generate.` (`generate.base.eol` → `sir.base.eol`), the same meaning and the
  same values. Unset by default (`null` or an empty string), which leaves the choice to
  the config; set, it overrides the config for that person only, as a CLI flag does.
- A setting ships **in the same release** as support for the config schema that introduced
  its key. A key removed or renamed in the core is removed or renamed here in the same way.
- No `sir.*` setting without a config key. An exception is written below, with its
  reason, before the setting ships.
- The default is the core's, except as listed here, with the reason:
  - `base.eol`: when neither the setting nor the config names it, the extension sends
    `worktree`, while the core and the CLI default to `repository`. The extension
    compares with the buffer, and the buffer is the file on disk: under `core.autocrlf` a
    base with the repository's endings would mark every line as changed.
- `test/settings-config.test.ts` checks `package.json` against the newest config schema of
  the core the extension is built with, and the settings an untrusted workspace may not
  set against the ones the code ignores there.

## Tests

`npm test` runs without an editor:

- **Pure modules** — hunk selection, trimming, the index store, verdicts, settings, the
  Apply decision — are tested in isolation. New logic belongs in pure modules for this
  reason: the code bound to the editor stays thin.
- **Against the real core** — the client, `config`/`pair`/`resolve`, the coordinates
  navigation relies on. Coordinates are never tested against hand-written fixtures: a
  hand-written hunk can agree with a test and disagree with the service.
- **Against a substitute core** (`test/fixtures/fake-service.mjs`,
  `test/fixtures/scripted-service.mjs`) — only behaviour the real core cannot produce on
  demand: a `generate` that runs until cancelled, a core without `cancel`, a core that
  never stops.

`npm run test:e2e` runs the extension in a real VS Code (`@vscode/test-cli`):

- `test/e2e/fixture.mjs` creates fresh workspaces in the temporary directory on every run:
  a repository with a git base, a project over an `upstream`, a folder without git, and a
  `quiet` workspace with nothing of sir.
- The tests in `test/e2e/*.e2e.ts` drive the extension only through its commands and what
  VS Code shows: lenses, Problems, the Outline, the status bar, diffs, message boxes
  (answered by a stub).
- `activate` returns a few read-only hooks for the tests (`SirTestApi`): the number of
  cores started, the gate, the status bar text, the table of a patch, the state of a patch.
- A feature that shows something in the editor comes with its end-to-end test.

What the commands cannot reach — the look of a lens or a badge, the position of a
context-menu item — is checked by hand in the development host.

`npm run test:mutation` (Stryker) plants one small fault at a time in the pure modules and
runs `npm test`; a fault no test notices is a missing test. It takes minutes, so it is run
by hand, not in CI, and fails below a mutation score of 80%. Only the modules the unit
tests reach are mutated (the list is in `stryker.config.mjs`): a new pure module is added
there.

## Before a change goes in

- `npm run check` passes; with a linked core, after `npm run build` in the core.
- `README.md` and `README.ru.md` change together; so do `CONTRIBUTING.md` and
  `CONTRIBUTING.ru.md`.
- A user-visible change has its entry in `CHANGELOG.md` under *Unreleased*, breaking
  changes first.
- A new setting follows E1; a new protocol method or field is used only after `max` covers
  it.
- A command id is written in `package.json` and in `src/commands/ids.ts`, nowhere else.

## Releases

- `CHANGELOG.md` names four numbers for every release: the extension version, the protocol
  range it speaks, the config schema its settings mirror, the patch format its grammar
  colours.
- **The extension version.** Before 1.0.0, any new feature and any breaking change raise
  the minor (0.1.0 → 0.2.0), a fix alone the patch (0.1.0 → 0.1.1). From 1.0.0, semver:
  breaking — major, feature — minor, fix — patch.
- **Breaking for the extension:** raising `min` of the protocol range (an older sir stops
  working); removing or renaming a `sir.*` setting, a command id or a keybinding;
  dropping support for a config schema or a patch format. Each is listed in the CHANGELOG
  under *Breaking*, with what to do.
- **A feature:** raising `max` of the protocol range, a setting for a new config key (E1),
  a new command.
- The `.vsix` carries the core it was tested with; the core's version is named in the
  CHANGELOG entry, and `max` is raised only after `npm run check` and `npm run test:e2e`
  pass against it (R7).
- A release of the extension that speaks a new protocol ships before, or together with,
  the sir that raises `protocolMin` (VERSIONING.md, S3); the *Clients* table there is
  updated with it.
- A release is made by pushing the tag `v<version>`; see
  [Continuous integration](#continuous-integration).
