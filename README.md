# S.I.R for VS Code

Structure-aware patches for source code, in the editor. A
[sir](https://github.com/Danil-Varakin/S.I.R) patch names the place of a change by the
code's own structure — the enclosing blocks and neighbouring lines — rather than by line
numbers, and the core finds that place in the current version of the file.

> Русская версия: [README.ru.md](./README.ru.md)

What the extension does:

- **Generates a patch from edits.** The new version is the editor buffer, unsaved changes
  included; the old one is the base: the file as saved on disk, or a git revision.
- **Links a patch and its code.** One key jumps from a hunk to the code it changes and
  back; another opens a diff of what the hunk replaces. The link works from the moment a
  file is opened, with no generate first.
- **Shows the state of a patch.** Whether every hunk lands, where, and whether the patch is
  already in its code — in the patch itself, in Problems, in the Explorer and in the status
  bar.
- **Applies a patch to its code**, one file or the whole workspace.

The extension holds no patch logic of its own: parsing, matching, the place of a patch
and its target file are answers of the sir core, which runs as a child process.

## Installation

| What | For what | What the system needs |
|---|---|---|
| [The `.vsix` from a GitHub release](https://github.com/Danil-Varakin/S.I.R-VScodeExtension/releases) | writing and maintaining patches in VS Code | VS Code 1.101 or later. The sir core and its tree-sitter grammars are inside the package and run on the editor's own Node: no system Node, no network |
| [The source of the extension](https://github.com/Danil-Varakin/S.I.R-VScodeExtension) | changing the extension | Node.js 22 and npm, git, VS Code 1.101 or later; see [CONTRIBUTING.md](./CONTRIBUTING.md) |
| [sir, the core and its CLI](https://github.com/Danil-Varakin/S.I.R) | generating and applying patches in a terminal, a build script or CI; changing the core | as described in its README |

The extension is not published on the Marketplace or Open VSX. To install the `.vsix`:

1. Download `sir-vscode-<version>.vsix` from the
   [Releases](https://github.com/Danil-Varakin/S.I.R-VScodeExtension/releases) page.
2. In VS Code: **Extensions** (`Ctrl+Shift+X`, macOS `⇧⌘X`) → **…** in the panel header →
   **Install from VSIX…** → the downloaded file.

The same from a terminal, with the `code` command on the PATH (the palette command
**Shell Command: Install 'code' command in PATH** puts it there):

```bash
code --install-extension sir-vscode-0.1.0.vsix
```

- Installing over the same version requires `--force`.
- Removal: `code --uninstall-extension danil-varakin.sir-vscode`. The `sir.*` settings
  remain in `settings.json`.
- In a remote window (SSH, WSL, a container) the extension runs on the remote side.
  Virtual workspaces are not supported: the core needs the files on a real file system.

The extension activates when the workspace contains a `sir.config.json`, when a `.sirp`
file is opened, or on the first S.I.R command. Before that it starts no process and adds no
items to the context menus.

## Commands

| Command | Shortcut | Where | What it does |
|---|---|---|---|
| **Sir: Generate Patch** | `Alt+G`, macOS `⌥⌘G` | palette, editor title, context menu of a file of code in the Explorer and of its tab | Compares the buffer (for a file that is not open, its text on disk) with its base and writes the patch where the project puts patches, then opens it beside the code. An existing patch of the file is regenerated, never doubled |
| **Sir: Generate Patch Against File…** | — | palette | Asks for an old file and generates the patch against it instead of the base, for this run only |
| **Sir: New S.I.R Patch** | — | palette, context menu of a file of code in the Explorer and of its tab | Opens an unsaved patch at the place Generate Patch would write it: the header and one hunk whose anchors are tab stops. A file that already has a patch gets that patch opened |
| **Sir: Continue Generate** | — | lens **▶ Continue Generate** over a draft, palette | Sends a draft of **Write by Hand** back to the core and continues synthesis from it (see [When synthesis cannot anchor a change](#when-synthesis-cannot-anchor-a-change)) |
| **Sir: Go to the Other Side** | `Alt+O`, macOS `⌥⌘O` | palette | From a hunk to the code it changes; from the code, or from the base half of a diff, to its hunk |
| **Sir: Go to What the Hunk Replaces** | `Alt+B`, macOS `⌥⌘B` | palette | Opens the diff «base ↔ base + patch» with the hunk marked on both sides: its lines framed, `◀ hunk N of M` after the first, a mark on the scrollbar. Where the hunk covers nothing — the base of an insertion, the result of a deletion — a line between two lines marks the place. The mark stays until the diff closes or the patch changes |
| **Sir: Preview Patch** | — | palette | The same diff for the whole patch: what a build would write. Nothing is written |
| **Sir: Show Edits Not in Patch** | — | palette, guard in the status bar | The diff «base + patch ↔ file»: the edits in the code that the patch does not contain |
| **Sir: Apply Patch** | `Alt+A`, macOS `⌥⌘A` | palette, title of a `.sirp`, lens over the header, S.I.R Patches panel | Applies the patch to its git base and puts the result in place of the code, unsaved (see [Applying patches](#applying-patches)) |
| **Sir: Apply All Patches** | — | palette, S.I.R Patches panel | Apply Patch for every `.sirp` of the workspace, with a summary of the patches left alone and the reason for each |
| **Sir: Check All Patches** | — | palette, S.I.R Patches panel | Checks every `.sirp` of the workspace against the project base. Results: the S.I.R Patches panel in the Explorer, Problems, red file names in the Explorer |
| **Sir: Copy Patch Report** | — | palette, S.I.R Patches panel | Copies the last check as Markdown: the totals and every patch that needs attention |
| **Sir: Open Failed Patches** | — | palette, S.I.R Patches panel | Opens every patch the last check found not applying |
| **Sir: Show Base** | — | palette, base in the status bar | Writes to the log which base a generate from the active file would use and where each `generate.base` value came from |
| **Sir: Init Config** | — | palette, trusted workspace only | Creates `sir.config.json` at the repository root and opens it (see [Init Config](#init-config)) |
| **Sir: Show Log** | — | palette, status bar | Opens the *S.I.R* output channel |

Every shortcut is three keys. On macOS each includes Command, because Option with a letter
types a character (`⌥O` is `ø`). A command can be bound or rebound in **Preferences: Open
Keyboard Shortcuts**.

### Init Config

**Sir: Init Config** creates the smallest valid `sir.config.json` and has no options.

- **Where:** at the root of the repository of the active file; with no file open, of the
  only workspace folder.
- **Contents:** `$schema` and `version` of the newest config schema the core reads; every
  other key keeps its default. The core composes the text.
- **If the file exists:** it is opened, not rewritten.
- **In an untrusted workspace:** the command refuses and writes nothing.

## The base

The base is the old version a patch is computed against and applied to.

| Base | How it is named | What the patch then describes |
|---|---|---|
| the saved file (default) | nothing named | the unsaved edits of the buffer |
| the last commit of the current branch | `generate.base.head: true` or `sir.base.head: true` | the buffer against that commit |
| the last commit of a branch | `generate.base.branch` or `sir.base.branch` (`main`, `origin/main`) | the buffer against that branch |
| a commit | `generate.base.commit` or `sir.base.commit` (a sha, a tag, `HEAD~3`) | the buffer against that commit |

A project names its base once, in `sir.config.json`:

```jsonc
{ "version": 3, "generate": { "base": { "head": true } } }
```

- The status bar shows the base of the active file, for example `base HEAD:src/a.cc @
  4f1c2e2`, and recomputes it after a commit or a branch switch.
- A git base that cannot be read — the file is not committed, the branch or commit is not
  in the repository — is reported in the message and in the status bar. It is never
  replaced by the saved file.
- A buffer equal to its base produces no patch: `a.cc matches HEAD:src/a.cc, nothing to
  patch`.
- **Generate Patch Against File…** uses the chosen file for one run. The next Generate
  Patch, the navigation and the checks use the base again.

## Where patches go

A patch is a `.sirp` file. Its place is decided by the core, so the extension writes
exactly where the CLI would. Two keys of `sir.config.json` determine it:

- `generate.out` — the place of patches. A path ending in `.sirp` is a file and is taken
  as is. Any other value — a name without an extension, a path ending with `/`, an existing
  directory — is a directory, and the patch inside it is named `<file name>.sirp`. A
  relative path is measured from the repository root. Missing directories are created.
  Not set: the patch is placed next to its file.
- `upstream` — the root of the code the project patches, measured from the directory of the
  config file. With it, `generate.out` is the root of a patch tree, measured from the
  directory of the config file, and the patch path repeats the path of the file inside the
  upstream.

**No keys set.** The patch is placed next to the file:

```
before                          after Generate Patch on src/a/b.cc
repo/                           repo/
└── src/a/                      └── src/a/
    └── b.cc                        ├── b.cc
                                    └── b.cc.sirp
```

**`"generate": { "out": "patches/" }`** — one directory for all patches of the repository:

```
before                          after Generate Patch on src/a/b.cc
repo/                           repo/
├── sir.config.json           ├── sir.config.json
└── src/a/                      ├── patches/
    └── b.cc                    │   └── b.cc.sirp
                                └── src/a/
                                    └── b.cc
```

**`"upstream": "..", "generate": { "out": "patches" }`** in `src/brave/sir.config.json` —
a project inside the code it patches keeps its patches as a tree mirroring that code:

```
before                          after Generate Patch on src/chrome/browser/ui/browser.h
src/                            src/
├── brave/                      ├── brave/
│   └── sir.config.json       │   ├── sir.config.json
└── chrome/browser/ui/          │   └── patches/chrome/browser/ui/
    └── browser.h               │       └── browser.h.sirp
                                └── chrome/browser/ui/
                                    └── browser.h
```

`"upstream": "."` gives the same tree inside a single repository.

## The patch file

A patch begins with a header, up to the first blank line. A patch generated by the core the
extension ships with (sir 0.5.0):

```
Sir: 2
Target: src/a/b.cc
Base-Blob: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad
Sir-Version: 0.5.0
Grammar: tree-sitter-cpp@0.23.4
```

| Field | Meaning |
|---|---|
| `Sir` | the patch format number; always the first line |
| `Target` | the file the patch is for, from the repository root. The core pairs a patch with its file by this field first, then by `generate.out` and `upstream` |
| `Base-Blob` | the git blob of the base; only when the base came out of git |
| `Sir-Version` | the version of sir that wrote the patch |
| `Grammar` | the tree-sitter grammar and its version |

A patch written by hand may omit every field but `Sir`. Without `Target` it is paired by
its name and place; when neither identifies the file, the first line of the patch says so
and the fix is a `Target:` line.

A `# note` … `# end` block immediately before a `# match` is a comment on that hunk: free
text in any column, ignored by the matcher.

```
# note
Keep the retry: the server drops the first request after a restart.
# end

# match cpp
    ...
```

- A hunk has at most one note.
- Text between hunks outside a note is a parse error.
- **Generate Patch** writes no notes: regenerating a patch removes its notes and the hunks
  written by hand. The confirmation before regenerating names the hunks that carry notes.

Editing a `.sirp`:

- the header, the headings, the operators `...`, `>>>`, `<<<` of a `# match` and the notes
  are coloured; the code of a hunk is coloured as the language of its heading (Kotlin only
  with an extension that provides a Kotlin grammar);
- hunks and notes fold; the Outline and the breadcrumbs list the hunks with their state;
- typing `match` or `note` offers a snippet;
- trailing whitespace is significant: it is shown and never trimmed, no final newline is
  added, format-on-save is off, indentation is four spaces.

## What a patch shows

The state of an open patch is computed without a command and recomputed on every edit of
the patch, the code, the base or the config.

**Whether the patch is in its code** — one label after the header line, and a badge on the
patch name in the Explorer and on its tab:

| Label | Badge | Meaning |
|---|---|---|
| `✓ applied` | `✓` green | the code contains what every hunk writes |
| `○ not applied — the code is its base` | `○` blue | the code is equal to its base, as in a fresh checkout of the upstream |
| `⚠ the code changed since the patch` | `≠` yellow | the code no longer contains what some hunks write; regenerating the patch keeps the edits |
| `◌ nothing to check — the base is the saved file` | — | the base is the saved file and the code is equal to it, so presence of the patch cannot be determined; a git base can |

A patch with a problem has no badge: Problems already marks its name red. The label and the
badge remain after the tab is closed, until the patch is opened again or Check All runs.

**Whether each hunk lands** — a lens over every `# match`. A click goes to the place, as
Go to the Other Side does:

| Lens | Meaning |
|---|---|
| `🟢 src/a.cc:413` | the hunk lands at this line: in the code when the patch is applied, in the base otherwise |
| `🟢 src/a.cc:413 · depends on an earlier hunk` | the hunk lands, and its target exists only after an earlier hunk is applied |
| `🟡 differs from the code — regenerate?` | the hunk lands, but the code at that place has changed |
| `🔴 anchor 3 of 5 not found` | the pattern stops at an anchor the base does not contain |
| `🔴 fits 4 places` | the pattern is ambiguous and needs more context |

**Problems and highlighting:**

- A broken anchor is underlined on its line; the reason is in Problems.
- A hunk that lands nowhere has a red background, a hunk the code no longer contains a
  yellow one; both are marked on the scrollbar.
- When nothing can be resolved — no target file, no base — one line at the top of the patch
  gives the reason, and Problems lists it on the header.
- A patch whose file is gone from the upstream is an *orphan*; **Delete Patch…** moves it to
  the trash after confirmation.
- A base branch or commit missing from the repository produces a request to fetch it.

**The light bulb** (Quick Fix, `Ctrl+.`, macOS `⌘.`) on a broken or drifted hunk offers
the actions that apply to it: **Show How Far It Got**, **Show the N Places It Fits…**,
**Go to Hunk N** (the hunk just before, for a hunk that depends on an earlier one),
**Regenerate Patch**. The actions that only show something come first; none that rewrites
is the default.

**The status bar:**

| Active file | Status bar | Click |
|---|---|---|
| a patch | `S.I.R: 3/4 hunks` — how many hunks resolve against the base | the log of the last resolve |
| a file of code with a patch | the guard: `matches its patch`; `edits not in the patch` (a build from the patch would drop them); `patch not applied` | Show Edits Not in Patch or Preview Patch |
| a file of code without a patch | its base: `saved file`, `base HEAD:src/a.cc @ 4f1c2e2`, `new file`, `base unavailable` | Show Base |

**Generate Patch** is offered on files whose language the core has a grammar for. On any
other file it refuses before sending anything, unless `sir.language` names a language.

## When synthesis cannot anchor a change

When the core cannot build a pattern for a change, the error offers **Write by Hand**:

1. An unsaved draft opens: every hunk that landed, plus one to be written for that change.
2. A hunk of the draft that does not land is marked on its line.
3. The lens **▶ Continue Generate** over the draft sends it to the core, which continues
   from the hunks written.
4. The steps repeat until every change is anchored; then the patch is written.

## Applying patches

A patch is always applied to its **clean base out of git** — the revision `generate.base`
names — and never to the code itself: applied to code that already contains it, the core
would write every hunk a second time. The state of the code then determines the outcome:

| The code | Apply Patch |
|---|---|
| is equal to the result | reports it and writes nothing |
| is equal to its base | replaces it with the result in the editor, unsaved; one Undo restores it |
| contains edits the patch does not | asks: **Generate Patch** keeps the edits in the patch, **Overwrite** discards them, **Show Edits Not in Patch** shows them |
| any, and a hunk does not land on the base | refuses and offers **Preview Patch**; no part is applied |
| any, and the base is the saved file | refuses: Apply requires a git base |

A patch ready to apply — its code is equal to the git base and every hunk lands — has a
lens over the header: `▶ Apply to src/a.cc · 2 hunks | Preview`.

**Apply All Patches** decides every patch by the same table and skips every patch that
would require a question.

- Up to 50 files: the changes go through the editor's Refactor Preview, where any file can
  be excluded; one Undo reverts all of them.
- More than 50 files: a summary and a confirmation come first, then the files are written
  on disk; git is the way back.
- A file is written only when its text differs from the result.

## Settings

Two layers configure generation:

- **`sir.config.json`** — the project policy, committed with the repository, so that the
  same two versions of a file give the same patch in the terminal, in the editor and in
  CI. The extension finds it as the CLI does: from the directory of the file up to the
  repository root; a config above the repository root is never used. Every key and its
  trade-offs are described in the
  [sir README](https://github.com/Danil-Varakin/S.I.R#configuration).
- **`sir.*` editor settings** — a personal override for one developer. Each setting
  corresponds to the `generate.*` key with the same path.

Precedence, as of a command-line flag over the config file:

```
built-in default  <  sir.config.json  <  sir.* setting
```

| Setting | Config key | Values | Default (neither the setting nor the config set) | What it does |
|---|---|---|---|---|
| `sir.out` | `generate.out` | a path | next to the file | Where patches are written. A path ending in `.sirp` is the patch file; any other path is a directory that receives `<file name>.sirp`. With `upstream` in the config, the root of the patch tree |
| `sir.language` | `generate.language` | a language name of the core | from the file extension | The language of the file, instead of the one derived from its extension |
| `sir.exact` | `generate.exact` | `true`, `false` | `false` | `true`: the result must reproduce the new file byte for byte; `false`: every line is compared after normalization |
| `sir.bridgeGap` | `generate.bridgeGap` | integer ≥ 0 | `0` | Edits separated by at most this many unchanged non-blank lines become one hunk |
| `sir.parents.min` | `generate.parents.min` | integer ≥ 0 | `1` | Enclosing blocks every pattern carries. `0` allows a pattern without a parent, which drifting neighbours can move into another function |
| `sir.parents.max` | `generate.parents.max` | integer ≥ 0, `"all"` | `"all"` | The maximum number of enclosing blocks per pattern; `"all"` — up to the outermost |
| `sir.parents.detail.base` | `generate.parents.detail.base` | integer ≥ 0 | `0` | Bracket levels written out in parent headers, from the outermost: `0` gives `foo( ... )`, `1` gives `foo(bar( ... ))`. Affects readability and tolerance to drift, not correctness |
| `sir.parents.required` | `generate.parents.required` | `true`, `false` | `false` | `true`: generation fails instead of falling back to a pattern without a parent |
| `sir.siblings.min` | `generate.siblings.min` | integer ≥ 0 | `0` | Neighbouring significant lines every pattern carries, per side |
| `sir.siblings.max` | `generate.siblings.max` | integer ≥ 0 | `8` | The maximum number of neighbouring significant lines per side; `0` forbids neighbours, leaving the anchoring purely structural |
| `sir.siblings.detail.base` | `generate.siblings.detail.base` | integer ≥ 0 | `0` | Bracket levels written out in neighbour anchors, from the outermost |
| `sir.base.head` | `generate.base.head` | `true`, `false` | `false` | `true`: the base is the file as of the last commit of the current branch. `false`: the base is the saved file, even if the config names a git base. Implied when `sir.base.branch` or `sir.base.commit` is set |
| `sir.base.branch` | `generate.base.branch` | a branch name, local or remote-tracking | the current branch | The base is the file as of the last commit of this branch |
| `sir.base.commit` | `generate.base.commit` | a revision: a sha, a tag, `HEAD~3` | the last commit of the branch | The base is the file as of this commit. With `sir.base.branch` set, the commit must belong to that branch |
| `sir.base.eol` | `generate.base.eol` | `repository`, `worktree` | `worktree` (the CLI: `repository`) | Line endings of a base read from git: `repository` — as git stores the file, `worktree` — as the file on disk has them. Applies only to a git base |

- **An unset setting is not sent to the core**, so it cannot override the config. A set
  setting applies for this developer even when its value equals the default.
- **`sir.base.head`, `sir.base.branch`, `sir.base.commit`** name the base as a whole:
  setting any of them replaces the whole `generate.base` of the config.
- **`sir.base.eol` defaults to `worktree`** in the editor, while the core and the CLI
  default to `repository`. The editor compares the base with the buffer, which holds the
  file as it is on disk; under `core.autocrlf` git stores LF while the file has CRLF, and a
  base with the repository's endings would mark every line as changed.
- **The log** names, on every generate, which values came from the config and which from the
  settings:

  ```
  config: /repo/sir.config.json applied generate.parents.min; overridden by editor settings: generate.bridgeGap
  config: none, built-in defaults only
  ```

## Untrusted workspaces

In a workspace that is not trusted:

- patches are generated, checked and navigated as usual;
- the workspace's own `sir.out` setting is ignored;
- a patch that the workspace's `sir.config.json` sends outside the workspace is written
  only after confirmation;
- **Init Config** creates no file.

## The log

The *S.I.R* output channel (**Sir: Show Log**) records each request and its duration; a
`resolve` longer than a second is logged as a warning. The messages exchanged with the
core contain fragments of the patched files and are logged only at the *Trace* level
(**Developer: Set Log Level…**).

## Known limitations

- **Apply requires a git base.** With the saved file as base, Apply refuses; `sir apply`
  in a terminal works in this case.
- **No per-hunk apply.** Apply applies the whole patch.
- **Regenerating removes notes** and hunks written by hand.
- **One file, one patch.** A file cannot have a second `.sirp`.
- **Large files with many edits** may take minutes to generate; the progress notification
  can cancel generation at any time.

## Further documents

- [CONTRIBUTING.md](./CONTRIBUTING.md) — building from source, tests, packaging, the rules of
  the repository.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — the structure of the code.
- [CHANGELOG.md](./CHANGELOG.md) — the changes of every release.
