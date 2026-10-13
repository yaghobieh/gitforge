# Claude prompt — GitForge 1.0.5 icon and conflict redesign

Paste the block below into Claude. The repo is `gitforge/` in the Forge workspace. Do not publish, do not bump `package.json` past the task, and do not add GitLore's Launchpad or teal theme.

---

You are redesigning **GitForge**, a VS Code extension by John Yaghobieh (`Yaghobieh.gitforge`). It is a JetBrains-style Git tool: inline blame, a three-way conflict resolver, branches, rollback, compare, cherry-pick. Version in the tree is 1.0.3. This work is the visual half of 1.0.5.

Read these files before drawing anything:

- `resources/gitforge-icon.svg` — current icon
- `screenshots/conflict-screenshot.html` — the marketplace mock. This is the target, not a suggestion.
- `src/conflict/ConflictWebviewPanel.ts` — the live webview. It does not match the mock.
- `README.md` — section "Planned for 1.0.5"

## 1. New icon

Replace the red mascot. At 24px on the activity bar it reads as a blob, and the Git mark in its hand is someone else's logo.

Design a new mark:

- A forge and a git branch, one symbol. Anvil, heat, or a struck bar is fine. A branch that splits and joins is fine. No animal, no face, no copied Git logo, no copied GitLore mark.
- Square, 128×128, safe padding so it still reads at 24×24 and on the marketplace tile.
- Dark ground `#1e1e2e` to match `galleryBanner.color`. Accent from the conflict mock: local green `#3fb950`, incoming blue `#58a6ff`, result purple `#a371f7`. Use two of those, not all three at full strength.
- Flat enough for an activity-bar SVG. No gradients that turn to mud at small size. No text.
- Deliver `resources/gitforge-icon.svg` (activity bar) and a 128×128 `resources/icon.png` (marketplace `icon` field). Keep the viewBox at `0 0 128 128`.

Show the SVG in the reply before writing files.

## 2. Conflict resolver — match the mock

The live panel is two screens: a file list, then a three-column grid with text buttons (`Use Local`, `Both`, a robot) above each conflict. The mock is one screen. Rebuild `ConflictWebviewPanel` so the open panel looks like `screenshots/conflict-screenshot.html`.

Layout, top to bottom:

1. Header. Title with the conflict count. Chip for the current branch (green) and chip for the incoming branch (blue). Close.
2. Body, horizontal. Left rail, about 220px: "Conflicted Files". Each row is the file name, a count (`2 conflicts`) or a resolved badge. The open file is selected.
3. Merge, three panels:
   - Local, green tag, current branch name
   - A narrow column of arrow buttons between Local and Result
   - Result, purple tag, "Merged Output"
   - A narrow column of arrow buttons between Result and Incoming
   - Incoming, blue tag, the other branch name
4. Footer. Accept Local, Accept Remote, Accept Both, and Save and next conflict. Drop the clipboard-only AI button from this bar. AI merge is out of scope for this pass.

Behavior to keep:

- Scan conflicted files the way `scanForConflicts` does.
- Parse `<<<<<<<`, `=======`, `>>>>>>>`. Put the incoming name from the `>>>>>>>` line into the header. Do not leave the label `INCOMING` once that line exists.
- Arrow toward the result accepts that side for the hunk. Accept Both concatenates local then incoming.
- Non-conflict lines are the same in all three panels.
- Unresolved result cells stay empty, with the hint from the mock: click an arrow to accept changes.
- Save writes the file, stages it, marks the row resolved, and opens the next unresolved file. When none remain, close the panel.
- Undo still works (Cmd/Ctrl+Z).
- Accept Local and Accept Remote on a whole file still ask before replacing every hunk.

Behavior to add so the mock is true:

- The file rail stays visible while a file is open. Do not swap to a separate list page.
- The result column is editable. Edits mark that hunk `custom`.
- Colors follow the mock: local green `#3fb950`, result purple `#a371f7`, incoming blue `#58a6ff`, page background `#1e1e1e`. Do not paint unresolved local lines red.

Do not change blame, branches, rollback, or compare in this pass.

When you are done, say what changed in the webview and how to open a conflicted file to check the rail, the arrows, accept both, edit result, and save-and-next.
