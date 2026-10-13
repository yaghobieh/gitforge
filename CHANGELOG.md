# Changelog

All notable changes to the GitForge extension will be documented in this file.

## [1.0.5] - 2026-10-13

### Changed
- New icon: green and blue branch ring on an anvil, replacing the red mascot
- Nav icon has no background tile, so it reads in Cursor’s bottom activity bar
- Status bar item shows the branch in brand blue instead of the prominent source-control chip

### Added
- Commit graph with working changes, lane markers, and a filter
- Commit details with patches, copy SHA, and open-on-host
- Commit actions: checkout, reset soft/mixed/hard, revert, cherry-pick, branch, tag
- Line history stepper on the blame hover (older and newer)
- File history view that follows renames
- Blame format string, ignore-whitespace, and `.git-blame-ignore-revs`
- Repository explorer for branches, remotes, tags, and stashes
- Merge-base compare with ahead, behind, and changed files
- Issue links for `#123` on GitHub, GitLab, and Bitbucket remotes
- Keyboard shortcuts for blame, line history, and the conflict resolver

## [1.0.2] - 2026-01-09

### Improved
- **Blame Annotations**
  - Cleaner UI: Subtle gutter indicator instead of inline text on every line
  - Rich hover popup with commit details, author, date, and summary
  - Shows blame info only for current line (reduces visual clutter)
  - Quick actions: Show History, View Changes, Copy Hash
  - Grouped by commit for better visual organization

- **Compare with Branch**
  - New side-by-side diff view (like IntelliJ/WebStorm)
  - Clear visual separation: Other Branch | Your Working Directory
  - Line-by-line revert arrows (→ to restore, ← to remove)
  - "Revert Block" button for each change hunk
  - "Revert All Changes" button to fully sync with other branch
  - Color-coded: green for additions, red for deletions
  - Quick "Open File" button to edit in VS Code

### Added
- `gitforge.copyCommitHash` command - Copy commit hash to clipboard
- `gitforge.showCommitChanges` command - View changes in a commit

## [1.0.0] - 2026-01-08

### Release
- First official release on VS Code Marketplace
- Publisher: Yaghobieh (John Yaghobieh)

## [0.0.2] - 2024-12-18

### Changed
- **Author**: Updated extension author to John Yaghobieh

### Improved
- **Conflict Resolver**
  - Completely redesigned three-way merge view
  - Side-by-side view: Current Branch | Result | Incoming Branch
  - Line-by-line arrows to choose individual changes (← →)
  - Magic wand (🪄) for smart merging that combines both versions
  - Accept All Local / Accept All Remote buttons
  - Better multi-file support with progress tracking
  - Improved file sidebar with relative paths
  - Branch name indicators in header

- **Branch Management** (New!)
  - Full-featured branch panel (like WebStorm/IntelliJ)
  - View all local and remote branches
  - Create new branches with checkout option
  - Rename branches
  - Delete branches (with force option)
  - Merge branches with conflict detection
  - Push branches to remote
  - Fetch from remote
  - Search/filter branches
  - Ahead/behind commit indicators
  - Double-click to checkout

- **Rollback Panel**
  - Now shows ALL changed files (staged, unstaged, untracked)
  - Filter by file type (Modified, Added, Deleted)
  - Search files by name
  - Full file paths displayed
  - Refresh button to update list
  - Improved diff viewing

### Fixed
- Fixed rollback not showing all changed files
- Fixed file path handling in rollback operations
- Improved Git status detection for all file states

## [0.0.1] - 2024-12-11

### Added
- **Inline Git Blame**
  - Click on any line to see blame information
  - Hover for detailed commit info
  - Navigate through line history (100+ commits back)
  - Relative date formatting ("2 days ago")
  
- **Conflict Resolver**
  - Beautiful side-by-side diff view
  - Accept ours, theirs, or both with one click
  - Edit and customize merged result
  - Auto-opens when conflicts detected

- **Merge Changes Panel**
  - Activity bar icon for quick access
  - Tree view of all changes
  - Grouped by directory
  - Shows additions/deletions count
  - Quick stage/unstage files

### Configuration
- `gitforge.blame.enabled` - Toggle blame annotations
- `gitforge.blame.showOnHover` - Show blame on hover
- `gitforge.blame.dateFormat` - Date format (relative/absolute/short)
- `gitforge.blame.maxHistoryDepth` - Max commits in history
- `gitforge.conflictResolver.autoOpen` - Auto-open on conflicts
- `gitforge.mergePanel.showOnMerge` - Auto-show during merge

