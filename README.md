# GitForge

Advanced Git tools for VS Code, inspired by JetBrains IDEs.

![GitForge](resources/gitforge-icon.svg)

A merge conflict resolver and branch manager for VS Code.

## Screenshots

### Compare with Branch
![Compare with Branch](screenshots/compare-branch.png)

### Conflict Resolver
![Conflict Resolver](screenshots/conflict-resolver.png)

## Features

### Inline Git Blame

See who made each change and when. Navigate through the complete history of any line.

- One-click blame: Click any line to see blame info
- Deep history: Navigate back through 100+ commits
- Hover details: Rich commit information on hover
- Relative dates: Shows "2 days ago" instead of timestamps

### Conflict Resolver

A three-way merge UI for resolving merge conflicts. No more manual editing of conflict markers.

- Three-panel view: Current Branch, Result, Incoming Branch
- Line-by-line selection: Click arrows to choose individual changes
- Smart merge: Combines both versions intelligently
- Accept All buttons: Accept all local or all remote with one click
- Multi-file support: Handle multiple conflicted files with progress tracking
- Branch indicators: See exactly which branches you are merging
- Manual editing: Edit the result directly when needed

### Branch Management

Full-featured branch panel like WebStorm and IntelliJ.

- View all branches: Local and remote branches in one place
- Create branches: With optional checkout
- Rename branches: Quick rename from context menu
- Delete branches: With force delete option
- Merge branches: Direct merge with conflict detection
- Push to remote: Push branches with upstream tracking
- Fetch updates: Fetch from remote with one click
- Search and filter: Find branches quickly
- Ahead and behind indicators: See commit differences at a glance

### Rollback Changes

Selectively rollback changes with a visual UI.

- All file states: Shows staged, unstaged, and untracked files
- Type filters: Filter by Modified, Added, or Deleted
- Search: Find files by name
- Diff preview: Double-click to view changes
- Batch rollback: Select multiple files to rollback at once
- Single file rollback: Rollback individual files with one click

### Merge Changes Panel

See all changes at a glance during merge operations.

- File tree view: All changed files organized by folder
- Change summary: Additions, deletions, modifications
- Quick navigation: Click to open any changed file
- Status indicators: See staged, unstaged, and conflicted files

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X on Windows, Cmd+Shift+X on macOS)
3. Search for "GitForge"
4. Click Install

### From VSIX

```bash
code --install-extension gitforge-1.0.2.vsix
```

## Usage

### Toggle Blame

- Command Palette: GitForge: Toggle Line Blame
- Keyboard: Ctrl+Shift+B (Windows) or Cmd+Shift+B (macOS)
- Click: Click on line number in gutter

### Show Line History

- Right-click on any line and select GitForge: Show Line History
- Or use Command Palette: GitForge: Show Line History

### Conflict Resolver

When conflicts are detected, GitForge automatically shows the Conflict Resolver panel. You can also open it manually:

- Command Palette: GitForge: Open Conflict Resolver
- Activity Bar: Click the GitForge icon, then Conflicts panel

### Merge Panel

- Activity Bar: Click the GitForge icon, then Merge Changes panel
- Command Palette: GitForge: Show Merge Changes Panel

### Branch Panel

Manage branches like in WebStorm and IntelliJ:

- Command Palette: GitForge: Branches...
- Right-click menu: Git, then Branches...

In the panel you can:
- Double-click a branch to checkout
- Click merge button to merge into current branch
- Click rename button to rename
- Click delete button to delete
- Click push button to push to remote

### Rollback Panel

Rollback unwanted changes:

- Command Palette: GitForge: Rollback Changes...
- Right-click menu: Git, then Rollback Changes...
- Single file: GitForge: Rollback This File

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| gitforge.blame.enabled | true | Enable inline blame annotations |
| gitforge.blame.showOnHover | true | Show blame info on hover |
| gitforge.blame.dateFormat | relative | Date format: relative, absolute, short |
| gitforge.blame.maxHistoryDepth | 100 | Max commits in line history |
| gitforge.conflictResolver.autoOpen | true | Auto-open on conflicts |
| gitforge.mergePanel.showOnMerge | true | Auto-show during merge |

## Keyboard Shortcuts

| Command | Windows and Linux | macOS |
|---------|-------------------|-------|
| Toggle Blame | Ctrl+Shift+B | Cmd+Shift+B |
| Show Line History | Ctrl+Shift+H | Cmd+Shift+H |
| Open Conflict Resolver | Ctrl+Shift+C | Cmd+Shift+C |

## Requirements

- VS Code 1.85.0 or higher
- Git installed and available in PATH
- A Git repository open in workspace

## License

MIT License, John Yaghobieh

---

Made by John Yaghobieh
