import * as vscode from 'vscode';
import { simpleGit, SimpleGit, DefaultLogFields } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';

export interface BlameInfo {
    hash: string;
    author: string;
    authorEmail: string;
    date: Date;
    summary: string;
    line: number;
    originalLine: number;
    filename: string;
}

export interface ConflictFile {
    path: string;
    status: 'conflicted' | 'staged' | 'unstaged';
}

export interface MergeChange {
    path: string;
    type: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
}

export interface GraphCommit {
    hash: string;
    parents: string[];
    author: string;
    email: string;
    date: string;
    subject: string;
    refs: string[];
    lane: number;
}

export interface WorkingChange {
    path: string;
    status: string;
}

export interface CommitFileChange {
    status: string;
    path: string;
    oldPath?: string;
    patch: string;
}

export interface FileHistoryEntry {
    hash: string;
    author: string;
    date: string;
    subject: string;
    filePath: string;
}

export interface RemoteRecord {
    name: string;
    url: string;
}

export interface StashRecord {
    index: number;
    ref: string;
    message: string;
}

export interface RangeCommit {
    hash: string;
    subject: string;
    author: string;
}

export interface MergeBaseReport {
    base: string;
    left: string;
    right: string;
    ahead: number;
    behind: number;
    aheadCommits: RangeCommit[];
    behindCommits: RangeCommit[];
    files: { status: string; path: string }[];
}

function assignLanes(commits: GraphCommit[]): void {
    const lanes: Array<string | null> = [];
    for (const commit of commits) {
        let lane = lanes.indexOf(commit.hash);
        if (lane === -1) {
            lane = lanes.indexOf(null);
        }
        if (lane === -1) {
            lane = lanes.length;
            lanes.push(null);
        }
        commit.lane = lane;
        const [first, ...rest] = commit.parents;
        lanes[lane] = first || null;
        for (const parent of rest) {
            const empty = lanes.indexOf(null);
            if (empty === -1) {
                lanes.push(parent);
            } else {
                lanes[empty] = parent;
            }
        }
    }
}

export class GitService {
    private gitCache: Map<string, SimpleGit> = new Map();

    constructor() {}

    /**
     * Find the git root for a given file path
     */
    private findGitRoot(filePath: string): string | null {
        // Start with the path itself (could be a directory)
        let dir = filePath;
        
        // Check if it's a file, start from its directory
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            dir = path.dirname(filePath);
        }
        
        while (dir !== path.dirname(dir)) { // Stop at filesystem root
            const gitDir = path.join(dir, '.git');
            if (fs.existsSync(gitDir)) {
                return dir;
            }
            dir = path.dirname(dir);
        }
        
        return null;
    }

    /**
     * Get or create a SimpleGit instance for a file
     */
    private getGitForFile(filePath: string): { git: SimpleGit; root: string } | null {
        const gitRoot = this.findGitRoot(filePath);
        if (!gitRoot) return null;

        if (!this.gitCache.has(gitRoot)) {
            this.gitCache.set(gitRoot, simpleGit(gitRoot));
        }

        return { 
            git: this.gitCache.get(gitRoot)!, 
            root: gitRoot 
        };
    }

    /**
     * Get a default git instance (for workspace-level operations)
     * Prioritizes the active editor's file repo
     */
    private getDefaultGit(): { git: SimpleGit; root: string } | null {
        // First try active editor's file
        const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (activeFile) {
            const gitRoot = this.findGitRoot(activeFile);
            console.log('GitForge getDefaultGit: Active file:', activeFile, '-> Git root:', gitRoot);
            if (gitRoot) {
                if (!this.gitCache.has(gitRoot)) {
                    this.gitCache.set(gitRoot, simpleGit(gitRoot));
                }
                return { git: this.gitCache.get(gitRoot)!, root: gitRoot };
            }
        }

        // Fallback to workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        console.log('GitForge getDefaultGit: Workspace folders:', workspaceFolders?.map(f => f.uri.fsPath));
        if (!workspaceFolders || workspaceFolders.length === 0) return null;

        // Try each workspace folder
        for (const folder of workspaceFolders) {
            const gitRoot = this.findGitRoot(folder.uri.fsPath);
            console.log('GitForge getDefaultGit: Checking', folder.uri.fsPath, '-> Git root:', gitRoot);
            if (gitRoot) {
                if (!this.gitCache.has(gitRoot)) {
                    this.gitCache.set(gitRoot, simpleGit(gitRoot));
                }
                return { git: this.gitCache.get(gitRoot)!, root: gitRoot };
            }
        }

        return null;
    }

    async isGitRepository(): Promise<boolean> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return false;
        
        try {
            await gitInfo.git.status();
            return true;
        } catch {
            return false;
        }
    }

    async getBlameForFile(filePath: string): Promise<BlameInfo[]> {
        const gitInfo = this.getGitForFile(filePath);
        if (!gitInfo) {
            console.log('GitForge: No git repo found for', filePath);
            return [];
        }

        try {
            const relativePath = path.relative(gitInfo.root, filePath);
            console.log('GitForge: Getting blame for', relativePath, 'in', gitInfo.root);
            
            const result = await this.runBlame(gitInfo.git, gitInfo.root, [relativePath]);
            const blameInfos = this.parseBlameOutput(result, relativePath);
            console.log('GitForge: Found', blameInfos.length, 'blame entries');
            return blameInfos;
        } catch (error) {
            console.error('GitForge: Error getting blame:', error);
            return [];
        }
    }

    async getBlameForLine(filePath: string, line: number): Promise<BlameInfo | null> {
        const gitInfo = this.getGitForFile(filePath);
        if (!gitInfo) return null;

        try {
            const relativePath = path.relative(gitInfo.root, filePath);
            const result = await this.runBlame(gitInfo.git, gitInfo.root, [
                `-L${line},${line}`,
                relativePath
            ]);
            const blameInfos = this.parseBlameOutput(result, relativePath);
            return blameInfos[0] || null;
        } catch (error) {
            console.error('GitForge: Error getting blame for line:', error);
            return null;
        }
    }

    async getLineHistory(filePath: string, line: number, maxDepth: number = 100): Promise<BlameInfo[]> {
        const gitInfo = this.getGitForFile(filePath);
        if (!gitInfo) {
            console.log('GitForge: No git repo found for history', filePath);
            return [];
        }

        const history: BlameInfo[] = [];
        let currentHash = 'HEAD';
        let currentLine = line;
        const relativePath = path.relative(gitInfo.root, filePath);

        console.log('GitForge: Getting line history for', relativePath, 'line', line);

        try {
            for (let i = 0; i < maxDepth; i++) {
                try {
                    const result = await this.runBlame(gitInfo.git, gitInfo.root, [
                        `-L${currentLine},${currentLine}`,
                        currentHash,
                        '--',
                        relativePath
                    ]);

                    const blameInfos = this.parseBlameOutput(result, relativePath);
                    if (blameInfos.length === 0) {
                        console.log('GitForge: No more blame info at iteration', i);
                        break;
                    }

                    const blameInfo = blameInfos[0];
                    
                    // Check if we've seen this commit before
                    if (history.some(h => h.hash === blameInfo.hash)) {
                        console.log('GitForge: Found duplicate commit, stopping');
                        break;
                    }
                    
                    history.push(blameInfo);
                    console.log('GitForge: Added history entry:', blameInfo.hash.substring(0, 7), blameInfo.summary);

                    // Move to parent commit
                    if (blameInfo.hash === '0000000000000000000000000000000000000000') {
                        console.log('GitForge: Reached uncommitted changes');
                        break;
                    }
                    
                    currentHash = `${blameInfo.hash}^`;
                    currentLine = blameInfo.originalLine;
                } catch (innerError) {
                    // This is expected when we reach the end of history
                    console.log('GitForge: End of history reached at iteration', i);
                    break;
                }
            }
        } catch (error) {
            console.error('GitForge: Error getting line history:', error);
        }

        console.log('GitForge: Total history entries:', history.length);
        return history;
    }

    async getCommitDetails(hash: string): Promise<DefaultLogFields | null> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return null;

        try {
            const log = await gitInfo.git.log({ 
                maxCount: 1,
                from: hash,
                to: hash 
            });
            return log.latest;
        } catch {
            return null;
        }
    }

    async hasConflicts(): Promise<boolean> {
        const conflicts = await this.getConflictedFiles();
        return conflicts.length > 0;
    }

    async getConflictedFiles(): Promise<ConflictFile[]> {
        const allConflicts: ConflictFile[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        console.log('GitForge: Workspace folders:', workspaceFolders?.map(f => f.uri.fsPath));
        
        if (!workspaceFolders) {
            console.log('GitForge: No workspace folders found!');
            return [];
        }

        const checkedRoots = new Set<string>();

        // Check all workspace folders for conflicts
        for (const folder of workspaceFolders) {
            console.log('GitForge: Checking folder:', folder.uri.fsPath);
            const gitRoot = this.findGitRoot(folder.uri.fsPath);
            console.log('GitForge: Git root for', folder.name, ':', gitRoot);
            
            if (!gitRoot) continue;
            if (checkedRoots.has(gitRoot)) continue; // Skip duplicates
            checkedRoots.add(gitRoot);

            if (!this.gitCache.has(gitRoot)) {
                this.gitCache.set(gitRoot, simpleGit(gitRoot));
            }
            
            const git = this.gitCache.get(gitRoot)!;
            
            try {
                const status = await git.status();
                console.log('GitForge: Status for', gitRoot, ':', {
                    conflicted: status.conflicted,
                    current: status.current,
                    files: status.files.length
                });
                
                for (const file of status.conflicted) {
                    allConflicts.push({
                        path: `${gitRoot}/${file}`,
                        status: 'conflicted' as const
                    });
                }
            } catch (error) {
                console.error('GitForge: Error checking conflicts in', gitRoot, error);
            }
        }

        console.log('GitForge: Total conflicts found:', allConflicts.length);
        return allConflicts;
    }

    async getMergeChanges(): Promise<MergeChange[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        console.log('GitForge Rollback: workspaceFolders =', workspaceFolders?.map(f => f.uri.fsPath));
        
        if (!workspaceFolders) {
            console.log('GitForge Rollback: No workspace folders!');
            return [];
        }

        const allChanges: MergeChange[] = [];
        const seenPaths = new Set<string>();
        const checkedRoots = new Set<string>();

        // Scan ALL workspace folders for git repos
        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            console.log('GitForge Rollback: Checking folder:', folderPath);
            
            const gitRoot = this.findGitRoot(folderPath);
            console.log('GitForge Rollback: Git root:', gitRoot);
            
            if (!gitRoot) {
                console.log('GitForge Rollback: No git root for', folderPath);
                continue;
            }
            
            if (checkedRoots.has(gitRoot)) {
                console.log('GitForge Rollback: Already checked', gitRoot);
                continue;
            }
            checkedRoots.add(gitRoot);

            if (!this.gitCache.has(gitRoot)) {
                this.gitCache.set(gitRoot, simpleGit(gitRoot));
            }
            const git = this.gitCache.get(gitRoot)!;

            try {
                const status = await git.status();
                console.log('GitForge Rollback: Status for', gitRoot, ':', {
                    modified: status.modified.length,
                    created: status.created.length,
                    deleted: status.deleted.length,
                    not_added: status.not_added.length,
                    files: status.files.length
                });

                // Helper to add change if not already added
                const addChange = (filePath: string, type: 'added' | 'modified' | 'deleted' | 'renamed') => {
                    const fullPath = path.join(gitRoot, filePath);
                    if (!seenPaths.has(fullPath)) {
                        seenPaths.add(fullPath);
                        allChanges.push({
                            path: fullPath,
                            type,
                            additions: 0,
                            deletions: 0
                        });
                        console.log('GitForge Rollback: Added file:', fullPath, type);
                    }
                };

                // Modified files (staged and unstaged)
                for (const file of status.modified) {
                    addChange(file, 'modified');
                }

                // Created/new files
                for (const file of status.created) {
                    addChange(file, 'added');
                }

                // Deleted files
                for (const file of status.deleted) {
                    addChange(file, 'deleted');
                }

                // Renamed files
                for (const file of status.renamed) {
                    addChange(file.to, 'renamed');
                }

                // Not added (untracked) files
                for (const file of status.not_added) {
                    addChange(file, 'added');
                }

                // Staged files (from the files array for more comprehensive coverage)
                for (const file of status.files) {
                    let type: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified';
                    if (file.index === 'A' || file.working_dir === '?') {
                        type = 'added';
                    } else if (file.index === 'D' || file.working_dir === 'D') {
                        type = 'deleted';
                    } else if (file.index === 'R') {
                        type = 'renamed';
                    }
                    addChange(file.path, type);
                }

                // Get diff stats for working directory changes
                try {
                    const diffStat = await git.diffSummary();
                    for (const file of diffStat.files) {
                        const fullPath = path.join(gitRoot, file.file);
                        const change = allChanges.find(c => c.path === fullPath);
                        if (change) {
                            change.additions = file.insertions;
                            change.deletions = file.deletions;
                        }
                    }
                } catch {
                    // Ignore diff stat errors
                }

                // Also get diff stats for staged changes
                try {
                    const stagedDiffStat = await git.diffSummary(['--cached']);
                    for (const file of stagedDiffStat.files) {
                        const fullPath = path.join(gitRoot, file.file);
                        const change = allChanges.find(c => c.path === fullPath);
                        if (change) {
                            change.additions += file.insertions;
                            change.deletions += file.deletions;
                        }
                    }
                } catch {
                    // Ignore diff stat errors
                }
            } catch (error) {
                console.error('GitForge Rollback: Error for', gitRoot, error);
            }
        }

        console.log('GitForge Rollback: Total changes found:', allChanges.length);
        return allChanges;
    }

    async getFileContent(filePath: string, ref: string = 'HEAD'): Promise<string> {
        const gitInfo = this.getGitForFile(filePath);
        if (!gitInfo) return '';

        try {
            const relativePath = path.relative(gitInfo.root, filePath);
            return await gitInfo.git.show([`${ref}:${relativePath}`]);
        } catch {
            return '';
        }
    }

    async getConflictContent(filePath: string): Promise<{ ours: string; theirs: string; base: string }> {
        const gitInfo = this.getGitForFile(filePath);
        if (!gitInfo) {
            return { ours: '', theirs: '', base: '' };
        }

        try {
            const relativePath = path.relative(gitInfo.root, filePath);
            
            const [ours, theirs, base] = await Promise.all([
                gitInfo.git.show([`:2:${relativePath}`]).catch(() => ''),
                gitInfo.git.show([`:3:${relativePath}`]).catch(() => ''),
                gitInfo.git.show([`:1:${relativePath}`]).catch(() => '')
            ]);

            return { ours, theirs, base };
        } catch {
            return { ours: '', theirs: '', base: '' };
        }
    }

    async stageFile(filePath: string): Promise<void> {
        const gitInfo = this.getGitForFile(filePath);
        if (!gitInfo) return;
        
        const relativePath = path.relative(gitInfo.root, filePath);
        await gitInfo.git.add(relativePath);
    }

    // ===== New Git Operations =====

    async rollbackFile(filePath: string): Promise<void> {
        const gitInfo = this.getGitForFile(filePath);
        if (!gitInfo) return;
        
        const relativePath = path.relative(gitInfo.root, filePath);
        await gitInfo.git.checkout(['--', relativePath]);
    }

    async stash(message?: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        if (message) {
            await gitInfo.git.stash(['push', '-m', message]);
        } else {
            await gitInfo.git.stash(['push']);
        }
    }

    async stashPop(index: number = 0): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        await gitInfo.git.stash(['pop', `stash@{${index}}`]);
    }

    async getStashList(): Promise<Array<{ message: string; date: string }>> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return [];
        
        try {
            const result = await gitInfo.git.stashList();
            return result.all.map(s => ({
                message: s.message,
                date: s.date
            }));
        } catch {
            return [];
        }
    }

    async resetHard(ref: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        await gitInfo.git.reset(['--hard', ref]);
    }

    async resetSoft(ref: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        await gitInfo.git.reset(['--soft', ref]);
    }

    async getRecentCommits(count: number = 50): Promise<Array<{ hash: string; message: string; author_name: string; date: string }>> {
        const gitInfo = this.getDefaultGit();
        console.log('GitForge getRecentCommits: gitInfo =', gitInfo ? 'found' : 'null', gitInfo?.root);
        if (!gitInfo) return [];
        
        try {
            const log = await gitInfo.git.log({ maxCount: count });
            console.log('GitForge getRecentCommits: got', log.all.length, 'commits');
            return log.all.map(c => ({
                hash: c.hash,
                message: c.message,
                author_name: c.author_name,
                date: c.date
            }));
        } catch (error) {
            console.error('GitForge getRecentCommits: error =', error);
            return [];
        }
    }

    async getBranches(): Promise<string[]> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return [];
        
        try {
            const branches = await gitInfo.git.branchLocal();
            return branches.all;
        } catch {
            return [];
        }
    }

    async getCurrentBranch(): Promise<string> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return '';
        
        try {
            const branches = await gitInfo.git.branchLocal();
            return branches.current;
        } catch {
            return '';
        }
    }

    async getBranchCommits(branch: string, count: number = 50): Promise<Array<{ hash: string; message: string; author_name: string; date: string }>> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return [];
        
        try {
            const log = await gitInfo.git.log({ maxCount: count, from: branch });
            return log.all.map(c => ({
                hash: c.hash,
                message: c.message,
                author_name: c.author_name,
                date: c.date
            }));
        } catch {
            return [];
        }
    }

    async cherryPick(hash: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        await gitInfo.git.raw(['cherry-pick', hash]);
    }

    async checkout(ref: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        await gitInfo.git.checkout(ref);
    }

    async checkoutForRepo(repoPath: string, ref: string): Promise<void> {
        if (!repoPath) return;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        await git.checkout(ref);
    }

    async fetch(): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        await gitInfo.git.fetch();
    }

    async pull(): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        await gitInfo.git.pull();
    }

    async push(): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        await gitInfo.git.push();
    }

    async commit(message: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        await gitInfo.git.commit(message);
    }

    // ===== Repository Detection =====
    
    async getRepoForFile(filePath: string): Promise<string> {
        const gitRoot = this.findGitRoot(filePath);
        return gitRoot || '';
    }

    // ===== Branch Management Operations =====

    async getAllBranches(): Promise<{ local: string[]; remote: string[]; current: string }> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return { local: [], remote: [], current: '' };
        return this.getAllBranchesForRepo(gitInfo.root);
    }

    async getAllBranchesForRepo(repoPath: string): Promise<{ local: string[]; remote: string[]; current: string }> {
        console.log('GitForge GitService: getAllBranchesForRepo called for:', repoPath);
        
        if (!repoPath) {
            console.log('GitForge GitService: No repo path provided');
            return { local: [], remote: [], current: '' };
        }
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        
        try {
            const branches = await git.branch(['-a']);
            console.log('GitForge GitService: raw branches:', branches);
            
            const local = branches.all.filter(b => !b.startsWith('remotes/'));
            const remote = branches.all.filter(b => b.startsWith('remotes/')).map(b => b.replace('remotes/', ''));
            
            console.log('GitForge GitService: local branches:', local);
            console.log('GitForge GitService: remote branches:', remote);
            console.log('GitForge GitService: current:', branches.current);
            
            return { local, remote, current: branches.current };
        } catch (error) {
            console.log('GitForge GitService: getAllBranchesForRepo error:', error);
            return { local: [], remote: [], current: '' };
        }
    }

    async getBranchInfoForRepo(repoPath: string, branch: string): Promise<{ ahead: number; behind: number; lastCommit: string } | null> {
        if (!repoPath) return null;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        
        try {
            const log = await git.log({ maxCount: 1, from: branch });
            return {
                ahead: 0,
                behind: 0,
                lastCommit: log.latest?.message || ''
            };
        } catch {
            return null;
        }
    }

    async createBranch(name: string, checkout: boolean = true): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await this.createBranchForRepo(gitInfo.root, name, checkout);
    }

    async createBranchForRepo(repoPath: string, name: string, checkout: boolean = true): Promise<void> {
        if (!repoPath) return;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        
        if (checkout) {
            await git.checkoutLocalBranch(name);
        } else {
            await git.branch([name]);
        }
    }

    async renameBranch(oldName: string, newName: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await this.renameBranchForRepo(gitInfo.root, oldName, newName);
    }

    async renameBranchForRepo(repoPath: string, oldName: string, newName: string): Promise<void> {
        if (!repoPath) return;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        await git.branch(['-m', oldName, newName]);
    }

    async deleteBranch(name: string, force: boolean = false): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await this.deleteBranchForRepo(gitInfo.root, name, force);
    }

    async deleteBranchForRepo(repoPath: string, name: string, force: boolean = false): Promise<void> {
        if (!repoPath) return;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        
        const flag = force ? '-D' : '-d';
        await git.branch([flag, name]);
    }

    async mergeBranch(branch: string): Promise<{ success: boolean; conflicts: boolean; message: string }> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return { success: false, conflicts: false, message: 'No git repository' };
        return this.mergeBranchForRepo(gitInfo.root, branch);
    }

    async mergeBranchForRepo(repoPath: string, branch: string): Promise<{ success: boolean; conflicts: boolean; message: string }> {
        if (!repoPath) return { success: false, conflicts: false, message: 'No git repository' };
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        
        try {
            await git.merge([branch]);
            return { success: true, conflicts: false, message: `Successfully merged ${branch}` };
        } catch (error: any) {
            const hasConflicts = await this.hasConflicts();
            if (hasConflicts) {
                return { success: false, conflicts: true, message: `Merge conflicts detected when merging ${branch}` };
            }
            return { success: false, conflicts: false, message: error.message || 'Merge failed' };
        }
    }

    async abortMerge(): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await this.abortMergeForRepo(gitInfo.root);
    }

    async abortMergeForRepo(repoPath: string): Promise<void> {
        if (!repoPath) return;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        await git.merge(['--abort']);
    }

    async fetchForRepo(repoPath: string): Promise<void> {
        if (!repoPath) return;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        await git.fetch();
    }

    async pushBranchForRepo(repoPath: string, branch: string, remote: string = 'origin', setUpstream: boolean = false): Promise<void> {
        if (!repoPath) return;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        
        if (setUpstream) {
            await git.push(['-u', remote, branch]);
        } else {
            await git.push([remote, branch]);
        }
    }

    async getBranchInfo(branch: string): Promise<{ ahead: number; behind: number; lastCommit: string } | null> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return null;
        
        try {
            const log = await gitInfo.git.log({ maxCount: 1, from: branch });
            const latest = log.latest;
            
            // Get ahead/behind info
            let ahead = 0;
            let behind = 0;
            
            try {
                const revList = await gitInfo.git.raw(['rev-list', '--left-right', '--count', `${branch}...HEAD`]);
                const [b, a] = revList.trim().split('\t').map(Number);
                behind = b || 0;
                ahead = a || 0;
            } catch { /* ignore */ }
            
            return {
                ahead,
                behind,
                lastCommit: latest?.message || ''
            };
        } catch {
            return null;
        }
    }

    async getRemotes(): Promise<string[]> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return [];
        
        try {
            const remotes = await gitInfo.git.getRemotes();
            return remotes.map(r => r.name);
        } catch {
            return [];
        }
    }

    async pushBranch(branch: string, remote: string = 'origin', setUpstream: boolean = false): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        const args = setUpstream ? ['--set-upstream', remote, branch] : [remote, branch];
        await gitInfo.git.push(args);
    }

    async trackRemoteBranch(localBranch: string, remoteBranch: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        
        await gitInfo.git.branch(['--set-upstream-to=' + remoteBranch, localBranch]);
    }

    async getDiffBetweenBranches(branch1: string, branch2: string): Promise<string | null> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return null;
        return this.getDiffBetweenBranchesForRepo(gitInfo.root, branch1, branch2);
    }

    async getDiffBetweenBranchesForRepo(repoPath: string, branch1: string, branch2: string): Promise<string | null> {
        if (!repoPath) return null;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        
        try {
            console.log('GitForge: Getting diff between', branch1, 'and', branch2, 'in', repoPath);
            const diff = await git.diff([branch1, branch2]);
            console.log('GitForge: Diff output length:', diff?.length || 0);
            return diff;
        } catch (error) {
            console.error('GitForge: Error getting diff between branches:', error);
            return null;
        }
    }

    async getDiffForFileForRepo(repoPath: string, filePath: string, _branch1: string, branch2: string): Promise<string | null> {
        if (!repoPath) return null;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        
        try {
            const relativePath = path.relative(repoPath, filePath);
            console.log('GitForge: Getting diff for file', relativePath, 'comparing working directory with', branch2);
            const diff = await git.diff([branch2, '--', relativePath]);
            console.log('GitForge: File diff output length:', diff?.length || 0);
            return diff;
        } catch (error) {
            console.error('GitForge: Error getting file diff:', error);
            return null;
        }
    }

    async getDiffWorkingDirForRepo(repoPath: string, targetBranch: string): Promise<string | null> {
        if (!repoPath) return null;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        
        try {
            console.log('GitForge: Getting diff of working directory vs', targetBranch);
            const diff = await git.diff([targetBranch]);
            console.log('GitForge: Working dir diff output length:', diff?.length || 0);
            return diff;
        } catch (error) {
            console.error('GitForge: Error getting working dir diff:', error);
            return null;
        }
    }

    async getFileFromBranch(repoPath: string, filePath: string, branch: string): Promise<string | null> {
        if (!repoPath) return null;
        
        if (!this.gitCache.has(repoPath)) {
            this.gitCache.set(repoPath, simpleGit(repoPath));
        }
        const git = this.gitCache.get(repoPath)!;
        
        try {
            // Get file content from specific branch
            const content = await git.show([`${branch}:${filePath}`]);
            return content;
        } catch (error) {
            console.error('GitForge: Error getting file from branch:', error);
            return null;
        }
    }

    private blameFlags(root: string): string[] {
        const config = vscode.workspace.getConfiguration('gitforge');
        const flags: string[] = [];
        if (config.get<boolean>('blame.ignoreWhitespace', true)) {
            flags.push('-w');
        }
        if (config.get<boolean>('blame.ignoreRevs', true)) {
            const ignoreFile = path.join(root, '.git-blame-ignore-revs');
            if (fs.existsSync(ignoreFile)) {
                flags.push('--ignore-revs-file', ignoreFile);
            }
        }
        return flags;
    }

    private async runBlame(git: SimpleGit, root: string, rest: string[]): Promise<string> {
        const flags = this.blameFlags(root);
        try {
            return await git.raw(['blame', '--line-porcelain', ...flags, ...rest]);
        } catch (error) {
            if (!flags.includes('--ignore-revs-file')) {
                throw error;
            }
            const stripped: string[] = [];
            for (let i = 0; i < flags.length; i++) {
                if (flags[i] === '--ignore-revs-file') {
                    i += 1;
                    continue;
                }
                stripped.push(flags[i]);
            }
            return git.raw(['blame', '--line-porcelain', ...stripped, ...rest]);
        }
    }

    async getGraphCommits(maxCount: number = 200): Promise<GraphCommit[]> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return [];
        const raw = await gitInfo.git.raw([
            'log',
            '--all',
            '--date-order',
            `-n${maxCount}`,
            '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D'
        ]);
        const commits = raw.split('\n').filter(Boolean).map((row) => {
            const [hash, parents, author, email, date, subject, refs] = row.split('\x1f');
            return {
                hash,
                parents: parents ? parents.split(' ').filter(Boolean) : [],
                author: author || '',
                email: email || '',
                date: date || '',
                subject: subject || '',
                refs: (refs || '').split(',').map((ref) => ref.trim()).filter(Boolean),
                lane: 0
            };
        });
        assignLanes(commits);
        return commits;
    }

    async getWorkingChanges(): Promise<WorkingChange[]> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return [];
        const status = await gitInfo.git.status();
        return status.files.map((file) => ({
            path: file.path,
            status: file.index === '?' || file.working_dir === '?' ? 'untracked' : (file.working_dir || file.index || 'M')
        }));
    }

    async getCommitFileChanges(hash: string): Promise<CommitFileChange[]> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return [];
        const names = await gitInfo.git.raw([
            'show',
            '--first-parent',
            '--name-status',
            '--format=',
            hash
        ]);
        const files: CommitFileChange[] = [];
        for (const line of names.split('\n')) {
            if (!line.trim()) continue;
            const parts = line.split('\t');
            const status = parts[0] || 'M';
            const filePath = parts[parts.length - 1] || '';
            const oldPath = parts.length > 2 ? parts[1] : undefined;
            files.push({ status, path: filePath, oldPath, patch: '' });
        }

        const patch = await gitInfo.git.raw([
            'show',
            '--first-parent',
            '--format=',
            '--unified=3',
            hash
        ]);
        const chunks = patch.split(/^diff --git /m).slice(1);
        for (const chunk of chunks) {
            const header = chunk.split('\n')[0] || '';
            const match = header.match(/b\/(.+)$/);
            const filePath = match ? match[1] : '';
            const file = files.find((item) => item.path === filePath);
            if (!file) continue;
            const body = chunk.split('\n').slice(1).join('\n');
            file.patch = body.split('\n').slice(0, 160).join('\n');
        }
        return files;
    }

    async getFileHistory(filePath: string, maxCount: number = 100): Promise<FileHistoryEntry[]> {
        const gitInfo = this.getGitForFile(filePath);
        if (!gitInfo) return [];
        const relativePath = path.relative(gitInfo.root, filePath);
        const raw = await gitInfo.git.raw([
            'log',
            '--follow',
            `-n${maxCount}`,
            '--pretty=format:%H%x1f%an%x1f%aI%x1f%s',
            '--',
            relativePath
        ]);
        return raw.split('\n').filter(Boolean).map((row) => {
            const [hash, author, date, subject] = row.split('\x1f');
            return {
                hash,
                author: author || '',
                date: date || '',
                subject: subject || '',
                filePath: relativePath
            };
        });
    }

    async getRemoteRecords(): Promise<RemoteRecord[]> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return [];
        const raw = await gitInfo.git.raw(['remote', '-v']);
        const byName = new Map<string, string>();
        for (const line of raw.split('\n')) {
            const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
            if (!match) continue;
            if (match[3] === 'fetch' || !byName.has(match[1])) {
                byName.set(match[1], match[2]);
            }
        }
        return [...byName.entries()].map(([name, url]) => ({ name, url }));
    }

    async getTags(): Promise<string[]> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return [];
        const raw = await gitInfo.git.raw(['tag', '--list']);
        return raw.split('\n').map((tag) => tag.trim()).filter(Boolean);
    }

    async getStashes(): Promise<StashRecord[]> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return [];
        const raw = await gitInfo.git.raw(['stash', 'list', '--pretty=format:%gd%x1f%s']);
        return raw.split('\n').filter(Boolean).map((row, index) => {
            const [ref, message] = row.split('\x1f');
            return { index, ref: ref || `stash@{${index}}`, message: message || ref || '' };
        });
    }

    async getUpstream(): Promise<string> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return '';
        try {
            const raw = await gitInfo.git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
            return raw.trim();
        } catch {
            return '';
        }
    }

    async compareMergeBase(left: string, right: string): Promise<MergeBaseReport | null> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return null;
        const base = (await gitInfo.git.raw(['merge-base', left, right])).trim();
        const aheadRaw = (await gitInfo.git.raw(['rev-list', '--count', `${right}..${left}`])).trim();
        const behindRaw = (await gitInfo.git.raw(['rev-list', '--count', `${left}..${right}`])).trim();
        const aheadLog = await this.logRange(gitInfo.git, `${right}..${left}`);
        const behindLog = await this.logRange(gitInfo.git, `${left}..${right}`);
        const nameStatus = await gitInfo.git.raw(['diff', '--name-status', base, left]);
        const files = nameStatus.split('\n').filter(Boolean).map((line) => {
            const parts = line.split('\t');
            return { status: parts[0] || 'M', path: parts[parts.length - 1] || '' };
        });
        return {
            base,
            left,
            right,
            ahead: Number(aheadRaw) || 0,
            behind: Number(behindRaw) || 0,
            aheadCommits: aheadLog,
            behindCommits: behindLog,
            files
        };
    }

    private async logRange(git: SimpleGit, range: string): Promise<RangeCommit[]> {
        try {
            const raw = await git.raw(['log', '--pretty=format:%H%x1f%s%x1f%an', range]);
            return raw.split('\n').filter(Boolean).map((row) => {
                const [hash, subject, author] = row.split('\x1f');
                return { hash, subject: subject || '', author: author || '' };
            });
        } catch {
            return [];
        }
    }

    async showFileAt(ref: string, filePath: string): Promise<string> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return '';
        try {
            return await gitInfo.git.show([`${ref}:${filePath}`]);
        } catch {
            return '';
        }
    }

    async resetMixed(ref: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await gitInfo.git.reset(['--mixed', ref]);
    }

    async revertCommit(hash: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await gitInfo.git.raw(['revert', '--no-edit', hash]);
    }

    async createBranchAt(name: string, hash: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await gitInfo.git.raw(['branch', name, hash]);
    }

    async createTag(name: string, hash: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await gitInfo.git.raw(['tag', name, hash]);
    }

    async deleteTag(name: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await gitInfo.git.raw(['tag', '-d', name]);
    }

    async applyStash(ref: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await gitInfo.git.raw(['stash', 'apply', ref]);
    }

    async dropStash(ref: string): Promise<void> {
        const gitInfo = this.getDefaultGit();
        if (!gitInfo) return;
        await gitInfo.git.raw(['stash', 'drop', ref]);
    }

    private parseBlameOutput(output: string, filename: string): BlameInfo[] {
        const lines = output.split('\n');
        const blameInfos: BlameInfo[] = [];
        
        let currentBlame: Partial<BlameInfo> = {};
        
        for (const line of lines) {
            if (line.match(/^[0-9a-f]{40}/)) {
                if (currentBlame.hash && currentBlame.author && currentBlame.date) {
                    blameInfos.push(currentBlame as BlameInfo);
                }
                const parts = line.split(' ');
                currentBlame = {
                    hash: parts[0],
                    originalLine: parseInt(parts[1], 10),
                    line: parseInt(parts[2], 10),
                    filename
                };
            } else if (line.startsWith('author ')) {
                currentBlame.author = line.substring(7);
            } else if (line.startsWith('author-mail ')) {
                currentBlame.authorEmail = line.substring(12).replace(/[<>]/g, '');
            } else if (line.startsWith('author-time ')) {
                currentBlame.date = new Date(parseInt(line.substring(12), 10) * 1000);
            } else if (line.startsWith('summary ')) {
                currentBlame.summary = line.substring(8);
            }
        }
        
        // Don't forget the last entry
        if (currentBlame.hash && currentBlame.author && currentBlame.date) {
            blameInfos.push(currentBlame as BlameInfo);
        }
        
        return blameInfos;
    }
}
