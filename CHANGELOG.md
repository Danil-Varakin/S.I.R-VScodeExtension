# Changelog

Every release names its four numbers — the extension's version, the sir protocol range
it speaks, the config schema its `sir.*` settings mirror, the patch format its `.sirp`
language colors (until 0.1.0 the core was hatch, the settings `hatch.*`, the patches
`.hatch`) — then what changed, breaking changes first. The rules behind the numbers are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## 0.1.0 — 2026-10-22

**Extension 0.1.0 · protocol 5–5 · config schema 3 · patch format 2 · VS Code 1.101+ · ships sir 0.5.0**

### Breaking

- **Hatch Patches is S.I.R Patches** — the core is renamed from hatch to sir (search,
  insert, replace), and the extension with it; nothing of hatch is read:
  - the extension is `sir-vscode` (was `hatch-vscode`), its repository
    `Danil-Varakin/S.I.R-VScodeExtension`; the language of patches is `sir`, files `.sirp`
    (a `.hatch` is plain text); the commands are `sir.*`, the palette category `S.I.R`;
  - every setting `hatch.*` is `sir.*`, with the same path and meaning; the theme colours
    `hatch.*` are `sir.*`;
  - the project config is `sir.config.json`, schema 3; a `hatch.config.json` does not
    activate the extension and is not read;
  - it speaks protocol **5–5** and carries sir 0.5.0 inside: a core of protocol 4
    (hatch 0.4.1) is refused with "update sir".
  → uninstall Hatch Patches 0.0.1 and install `sir-vscode-0.1.0.vsix`.
  → in `settings.json`: rename every `hatch.` key to `sir.`, theme colours included.
  → in the project: rename `hatch.config.json` to `sir.config.json` with `"version": 3`,
  and every `x.hatch` to `x.sirp` with its first line `Sir: 2` — or regenerate the patch.

### Added

- **Apply Patch** (`alt+A`, macOS `⌥⌘A`), from the patch or its code. The patch is applied
  to its clean git base, and the result replaces the code in the editor, unsaved; one Undo
  restores it.
  - Code that already equals the result is left alone.
  - Code with edits the patch does not contain is overwritten only after a question.
  - A patch with a hunk that does not land, or with the saved file as base, is refused.
  - Entry points: the lens `▶ Apply to … · N hunks | Preview` over the header of a patch
    ready to apply, a button in the title bar of a patch, a button in the S.I.R Patches
    panel.
- **Apply All Patches**: every patch of the workspace by the same rules, with a summary and
  the list of patches left alone. Up to 50 files through the Refactor Preview; above that,
  on disk after a confirmation. A file is written only when its text changes.
- **New S.I.R Patch**, from the context menu of a file of code in the Explorer or of its
  tab, and from the palette. An unsaved patch opens at the place Generate Patch would
  write it: the header and one hunk whose anchors are tab stops. A file that already has a
  patch gets that patch opened.
  - The header is the one Generate Patch would write (`Base-Blob`, `Sir-Version` and
    `Grammar` included), and the word of `# match` is the core's (`cpp` for `.cc`).
- **Generate Patch** in the context menu of a file of code in the Explorer and of its tab,
  beside New S.I.R Patch. For a file that is not open, its text on disk is the new
  version.
- **Write by Hand** and **Continue Generate**. When synthesis cannot anchor a change, the
  error offers a draft: every hunk that landed and one to write for that change. The lens
  over the draft sends it back, and synthesis continues from it, round after round, until
  the patch is written. A hunk of the draft that does not land is marked on its line.
  Uses `detail.draft` and `generate.keep` of protocol 5.

### Changed

- **Check All Patches** checks against the project base at once and asks for no revision.
- **Check All Patches** puts every patch that does not apply into Problems, so the
  Explorer marks it without opening it first.
- The findings of a check remain in **Problems**, and the patch remains red in the
  Explorer, after its tab is closed — until the patch is opened again, Check All runs, or
  the file is removed.
- Whether a patch is in its code is stated once: a coloured label after the header —
  `✓ applied`, `○ not applied — the code is its base`, `⚠ the code changed since the
  patch`, `◌ nothing to check` — and a badge on its name in the Explorer and on its tab
  (`✓`, `○`, `≠`). A closed patch keeps the badge once it was open or Check All ran.
- The lens of a hunk states only whether the hunk lands: `🟢`, `🟡` or `🔴` and where. The
  white `⚪ not applied` on every hunk of a fresh checkout is removed; with nothing to check
  there are no hunk lenses, only the label.
- Six new theme colours: `sir.appliedPatch*`, `sir.notAppliedPatch*`,
  `sir.changedPatch*` (foreground and background each).
- **Go to What the Hunk Replaces** marks the hunk in the diff instead of selecting it: its
  lines are framed on both sides, with `◀ hunk N of M` after the first line and a mark on
  the scrollbar. An insertion is a line between two lines in the base, no longer its
  neighbouring line selected as if it were replaced. The mark stays until the diff closes
  or the patch changes. Two new theme colours: `sir.selectedHunkForeground`,
  `sir.selectedHunkBackground`.

## 0.0.1 — 2026-10-06

**Extension 0.0.1 · protocol 4–4 · config schema 2 · patch format 1 · VS Code 1.101+**

The first release. It needs hatch with protocol 4 and carries hatch 0.4.1 inside the
package: hatch 0.2 and 0.3 (protocols 2–3) are refused at the handshake with "update
hatch".

### Added

- **Generate Patch** (`alt+G`, macOS `⌥⌘G`): the buffer — unsaved edits included —
  against its base, written as a `.hatch` where the CLI would write it (`generate.out`,
  the patch tree of an `upstream`) and opened beside the code. Progress shows the segment
  being synthesized; cancelling stops the core between changes. One file has one patch:
  an existing one is regenerated or opened, never doubled, and a patch there that names
  another file is not written over without saying so.
- **The base**: the file as last saved on disk, or a git revision named by
  `generate.base` (`head`, `branch`, `commit`, `eol`) or the `hatch.base.*` settings. A git
  base that cannot be read yet is said so and never replaced by the saved file. A git base
  is read with the line endings of the file on disk unless `base.eol` says otherwise.
- **Generate Patch Against File…**: one run against an old file you pick,
  as the CLI's `--in-old`.
- **Go to the Other Side** (`alt+O`, macOS `⌥⌘O`): from a hunk to the code it writes, and from the code,
  or from the base half of a diff, back to its hunk. A drifted file is followed line by
  line and named as approximate; a patch not applied yet is followed in the base.
- **Go to What the Hunk Replaces** (`alt+B`, macOS `⌥⌘B`) and **Preview Patch**: a diff of the
  base against the base with the patch applied — what a build would write — nothing
  written anywhere. The hunk is selected on both sides; one whose target only exists
  after an earlier hunk is shown on the right. A patch that does not reproduce the file
  exactly offers **Preview Result**.
- **The patch guard** in the status bar of a file with a patch: `matches its patch`,
  `edits not in the patch` (a build from the patch would drop them), `patch not
  applied`; **Show Edits Not in Patch** diffs base + patch against the file. A file not
  in the base revision reads `new file`.
- Failed hunks explain themselves: the anchor that did not match ("anchor 3 of 5 not
  found") with how far the pattern got in the base; every place an ambiguous pattern fits,
  in a picker.
- **Feedback in the patch** without a command: a lens over every `# match` (`✓`, `○ not
  applied`, `⚠ differs from the code`, `✗ …`), errors on the anchor line in Problems,
  red and yellow backgrounds for broken and drifted hunks, dimmed notes, and
  `Hatch: 3/4 hunks` in the status bar. All of it follows edits of the patch, the code,
  the base on disk, the config, HEAD and branches.
- **Notes on hunks** (`# note` … `# end`, hatch 0.4) are shown as comments.
- Warnings about significant trailing whitespace are underlined on their line of the patch,
  for a patch edited by hand too, and stay after a restart.
- **The `.hatch` language**: the header, headings, operators and notes colored, the code
  of each hunk colored as its language, folding, Outline and breadcrumbs by hunk with its
  state, `match` and `note` snippets; trailing whitespace shown and never trimmed. The
  grammar is generated from the languages of the core the extension ships with.
- **The Hatch Patches panel** in the Explorer: every patch of the workspace checked against
  the project base or a branch, tag or commit you name — before moving to a new upstream —
  worst first, with `✓ · ⚠ · ✗` totals and a badge; **Copy Patch Report** (Markdown) and
  **Open Failed Patches**. Nothing is written.
- **The light bulb** on a broken or drifted hunk of a patch: Show How Far It Got, Show
  the N Places It Fits…, Go to the Earlier Hunk, Regenerate Patch — and Delete Patch… on
  the header of an orphan. Looking comes first; nothing that rewrites is preferred.
- **Honest states.** A patch whose file is gone from the upstream is an orphan, with
  **Delete Patch…** (to the trash, after a confirmation); a base branch or commit that is
  not here asks for a fetch; a patch that names no file points at its header. Each of
  these is also listed in Problems, on the patch's first line. With the saved file as the
  base, code equal to it reads `◌ nothing to check`, not `○ not applied`.
- **Quiet without hatch**: the core is not started, and the status bar stays empty, until
  the workspace has a `hatch.config.json`, a `.hatch` is opened or a Hatch command runs.
- **Generate Patch** is offered only on files the core has a grammar for, and refuses any
  other before sending it, unless `hatch.language` names one. Its progress shows the
  elapsed time; regenerating a patch with notes names how many it would drop, and offers
  Open Existing first.
- **The log** is a log channel with levels: how long each request took (a `resolve` over
  a second is a warning), and the protocol messages, which hold pieces of your files, only
  at *Trace*.
- Fixed: on macOS the shortcuts typed a character instead of running. They were
  `ctrl+alt+…`, and Control does not reliably stop Option from inserting one — `alt+O` is
  `ø`, `alt+G` is `©`. Every macOS chord now holds Command, and none is longer than three
  keys: `⌥⌘G` Generate Patch, `⌥⌘O` Go to the Other Side, `⌥⌘B` Go to What the Hunk
  Replaces — which moved off `alt+shift+O` so that no shortcut needs a fourth key. The
  sentences the extension shows name the chord of the platform it runs on, instead of
  telling every reader `alt+O`.
- **Breaking**: Go to What the Hunk Replaces is `alt+B` (was `alt+shift+O`), and Generate
  Patch Against File… has no default shortcut — it is a one-off, and the *Pick Old File*
  button offers it where a missing base makes it the answer. Bind it in **Preferences:
  Open Keyboard Shortcuts** if you use it often.
- The verdict of a hunk is coloured, not grey: the lens opens with `✅`, `⚪`, `⚠️`, `❌` or
  `⬜`, and the hunk's header carries a mark in `hatch.brokenHunkForeground` or
  `hatch.driftedHunkForeground`. A CodeLens takes no colour of its own — the editor paints
  every lens in `editorCodeLens.foreground` — so the glyph brings one with it.
- Fixed: **Check All Patches** could not be stopped. It asked for a cancel button at a
  location that does not draw one, so a run over hundreds of patches had to finish.
- Fixed: a `resolve` of 999.9 ms was logged as `1000 ms`, and one of 59 999 ms as `60.0 s`.
- Fixed: the light bulb's Go to the Earlier Hunk could skip the hunk just before and land
  on an earlier one; it now names the hunk it goes to (`Go to Hunk 4`), since the core
  says only that a hunk needs an earlier one, never which.
- Fixed: with a patch open beside its code, typing in the code asked the core to apply the
  patch again every time, though neither the patch nor the base had changed — 46 ms per
  burst on a 1 900-line file, 248 ms on a 10 800-line one, on the one core process every
  other request waits behind.
- Fixed: a git base the core resolved without sending its text would have been shown as an
  empty file, with the hunk offsets still pointing into the real one.
- Fixed: the Patches panel could report a patch `broken` while explaining an ambiguity in
  a different hunk.
- Fixed: editing the code did not turn a placed lens into a drifted one when the patch and
  its base were unchanged; an edit made while a patch's table was first built was lost; one slow
  table held up the rebuild of every other; the Outline of a patch lagged one edit
  behind. Alt+G on a `.hatch` says to generate from its code. `hatch.base.eol` set alone,
  with the base named in the config, was not applied; the light bulb offered Go to the
  Earlier Hunk on a hunk that was neither broken nor drifted.
- While a `generate` runs, the other requests wait for it instead of timing out: a long
  step of synthesis no longer restarts the core and loses the patch.
- **Show Base**: which base a generate from the active file would use, and where each
  `generate.base` setting came from; the status bar shows the base of the active file.
- **Init Config**: a minimal `hatch.config.json` at the repository root, composed by the
  core.
- Every `generate.*` key of `hatch.config.json` (schema 2) as a `hatch.*` setting that
  overrides the project config for you only; settings you never touched are not sent.
- **Untrusted workspaces**: the workspace's own `hatch.out` is
  ignored, and a patch its config sends outside the workspace is written only after you
  confirm.
