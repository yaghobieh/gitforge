import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from '../utils/GitService';

interface BranchItem {
    name: string;
    isCurrent: boolean;
    isRemote: boolean;
    ahead?: number;
    behind?: number;
    lastCommit?: string;
}

export class BranchPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | null = null;
    private branches: BranchItem[] = [];
    private currentBranch: string = '';
    private searchQuery: string = '';
    private currentRepoPath: string = '';

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) {}

    async show(): Promise<void> {
        // Detect current repository from active editor or let user choose
        await this.detectCurrentRepo();
        await this.loadBranches();

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'gitforgeBranches',
                '🔀 Git Branches',
                { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = null;
            });

            this.panel.webview.onDidReceiveMessage(message => {
                this.handleMessage(message);
            });
        }

        this.updatePanel();
        this.panel.reveal();
    }

    private async detectCurrentRepo(): Promise<void> {
        // First try to get from active editor
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const filePath = activeEditor.document.uri.fsPath;
            const repoPath = await this.gitService.getRepoForFile(filePath);
            if (repoPath) {
                this.currentRepoPath = repoPath;
                console.log('GitForge BranchPanel: Using repo from active file:', repoPath);
                return;
            }
        }

        // Fallback to first workspace folder with git
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const repoPath = await this.gitService.getRepoForFile(folder.uri.fsPath);
                if (repoPath) {
                    this.currentRepoPath = repoPath;
                    console.log('GitForge BranchPanel: Using first workspace repo:', repoPath);
                    return;
                }
            }
        }
    }

    private async loadBranches(): Promise<void> {
        console.log('GitForge BranchPanel: Loading branches for repo:', this.currentRepoPath);
        
        const branchData = await this.gitService.getAllBranchesForRepo(this.currentRepoPath);
        console.log('GitForge BranchPanel: Got branch data:', branchData);
        
        this.currentBranch = branchData.current;
        this.branches = [];
        
        // Add local branches
        for (const branch of branchData.local) {
            const info = await this.gitService.getBranchInfoForRepo(this.currentRepoPath, branch);
            this.branches.push({
                name: branch,
                isCurrent: branch === branchData.current,
                isRemote: false,
                ahead: info?.ahead,
                behind: info?.behind,
                lastCommit: info?.lastCommit
            });
        }
        
        // Add remote branches
        for (const branch of branchData.remote) {
            this.branches.push({
                name: branch,
                isCurrent: false,
                isRemote: true
            });
        }
        
        console.log('GitForge BranchPanel: Total branches loaded:', this.branches.length);
    }

    private async handleMessage(message: { 
        command: string; 
        branch?: string; 
        newName?: string;
        source?: string;
        search?: string;
    }): Promise<void> {
        switch (message.command) {
            case 'checkout':
                if (message.branch) {
                    await this.checkoutBranch(message.branch);
                }
                break;

            case 'createBranch':
                await this.createNewBranch();
                break;

            case 'rename':
                if (message.branch) {
                    await this.renameBranch(message.branch);
                }
                break;

            case 'delete':
                if (message.branch) {
                    await this.deleteBranch(message.branch);
                }
                break;

            case 'merge':
                if (message.branch) {
                    await this.mergeBranch(message.branch);
                }
                break;

            case 'rebase':
                if (message.branch) {
                    await this.rebaseBranch(message.branch);
                }
                break;

            case 'compare':
                if (message.branch) {
                    await this.compareBranch(message.branch);
                }
                break;

            case 'push':
                if (message.branch) {
                    await this.pushBranch(message.branch);
                }
                break;

            case 'fetch':
                await this.fetchAll();
                break;

            case 'refresh':
                await this.loadBranches();
                this.updatePanel();
                break;

            case 'search':
                this.searchQuery = message.search || '';
                this.updatePanel();
                break;

            case 'close':
                this.dispose();
                break;
        }
    }

    private async checkoutBranch(branch: string): Promise<void> {
        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Switching to ${branch}...` },
                async () => {
                    await this.gitService.checkoutForRepo(this.currentRepoPath, branch);
                }
            );
            vscode.window.showInformationMessage(`✅ Switched to ${branch}`);
            await this.loadBranches();
            this.updatePanel();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to checkout: ${error.message}`);
        }
    }

    private async createNewBranch(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter new branch name',
            placeHolder: 'feature/my-feature',
            validateInput: (value) => {
                if (!value) return 'Branch name is required';
                if (!/^[\w\-\/]+$/.test(value)) return 'Invalid branch name';
                return null;
            }
        });

        if (!name) return;

        const checkout = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Switch to the new branch?'
        });

        try {
            await this.gitService.createBranchForRepo(this.currentRepoPath, name, checkout === 'Yes');
            vscode.window.showInformationMessage(`✅ Created branch: ${name}`);
            await this.loadBranches();
            this.updatePanel();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to create branch: ${error.message}`);
        }
    }

    private async renameBranch(oldName: string): Promise<void> {
        const newName = await vscode.window.showInputBox({
            prompt: `Rename branch '${oldName}' to:`,
            value: oldName,
            validateInput: (value) => {
                if (!value) return 'Branch name is required';
                if (!/^[\w\-\/]+$/.test(value)) return 'Invalid branch name';
                return null;
            }
        });

        if (!newName || newName === oldName) return;

        try {
            await this.gitService.renameBranchForRepo(this.currentRepoPath, oldName, newName);
            vscode.window.showInformationMessage(`✅ Renamed ${oldName} → ${newName}`);
            await this.loadBranches();
            this.updatePanel();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to rename branch: ${error.message}`);
        }
    }

    private async deleteBranch(branch: string): Promise<void> {
        if (branch === this.currentBranch) {
            vscode.window.showWarningMessage('Cannot delete the current branch');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete branch '${branch}'?`,
            { modal: true },
            'Delete',
            'Force Delete'
        );

        if (!confirm) return;

        try {
            await this.gitService.deleteBranchForRepo(this.currentRepoPath, branch, confirm === 'Force Delete');
            vscode.window.showInformationMessage(`✅ Deleted branch: ${branch}`);
            await this.loadBranches();
            this.updatePanel();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to delete branch: ${error.message}`);
        }
    }

    private async mergeBranch(branch: string): Promise<void> {
        const confirm = await vscode.window.showInformationMessage(
            `Merge '${branch}' into '${this.currentBranch}'?`,
            { modal: true },
            'Merge'
        );

        if (confirm !== 'Merge') return;

        try {
            const result = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Merging ${branch}...` },
                async () => {
                    return await this.gitService.mergeBranchForRepo(this.currentRepoPath, branch);
                }
            );

            if (result.success) {
                vscode.window.showInformationMessage(`✅ ${result.message}`);
            } else if (result.conflicts) {
                const action = await vscode.window.showWarningMessage(
                    '⚔️ Merge conflicts detected!',
                    'Open Resolver',
                    'Abort Merge'
                );

                if (action === 'Open Resolver') {
                    vscode.commands.executeCommand('gitforge.openConflictResolver');
                } else if (action === 'Abort Merge') {
                    await this.gitService.abortMergeForRepo(this.currentRepoPath);
                    vscode.window.showInformationMessage('Merge aborted');
                }
            } else {
                vscode.window.showErrorMessage(`❌ ${result.message}`);
            }

            await this.loadBranches();
            this.updatePanel();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to merge: ${error.message}`);
        }
    }

    private async rebaseBranch(branch: string): Promise<void> {
        vscode.window.showInformationMessage(`Rebase onto ${branch} - Coming soon!`);
    }

    private async compareBranch(branch: string): Promise<void> {
        // Use VS Code's built-in diff capability
        try {
            await vscode.commands.executeCommand('git.viewBranch', branch);
        } catch {
            vscode.window.showInformationMessage(`Compare with ${branch} - Use Git Graph extension for detailed view`);
        }
    }

    private async pushBranch(branch: string): Promise<void> {
        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Pushing ${branch}...` },
                async () => {
                    await this.gitService.pushBranchForRepo(this.currentRepoPath, branch, 'origin', true);
                }
            );
            vscode.window.showInformationMessage(`✅ Pushed ${branch}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to push: ${error.message}`);
        }
    }

    private async fetchAll(): Promise<void> {
        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Fetching...' },
                async () => {
                    await this.gitService.fetchForRepo(this.currentRepoPath);
                }
            );
            vscode.window.showInformationMessage('✅ Fetch complete');
            await this.loadBranches();
            this.updatePanel();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to fetch: ${error.message}`);
        }
    }

    private updatePanel(): void {
        if (!this.panel) return;
        this.panel.webview.html = this.getHtml();
    }

    private getHtml(): string {
        const filteredBranches = this.searchQuery
            ? this.branches.filter(b => b.name.toLowerCase().includes(this.searchQuery.toLowerCase()))
            : this.branches;

        const localBranches = filteredBranches.filter(b => !b.isRemote);
        const remoteBranches = filteredBranches.filter(b => b.isRemote);

        const localHtml = localBranches.map(b => this.renderBranchItem(b)).join('');
        const remoteHtml = remoteBranches.map(b => this.renderBranchItem(b)).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Branches</title>
    <style>
        :root {
            --bg-primary: var(--vscode-editor-background, #0d1117);
            --bg-secondary: var(--vscode-sideBar-background, #161b22);
            --bg-tertiary: var(--vscode-button-secondaryBackground, #21262d);
            --border-color: var(--vscode-panel-border, #30363d);
            --text-primary: var(--vscode-editor-foreground, #e6edf3);
            --text-secondary: var(--vscode-descriptionForeground, #8b949e);
            --accent-green: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
            --accent-green-bg: rgba(63, 185, 80, 0.15);
            --accent-blue: var(--vscode-gitDecoration-modifiedResourceForeground, #58a6ff);
            --accent-blue-bg: rgba(88, 166, 255, 0.15);
            --accent-red: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
            --accent-purple: var(--vscode-symbolIcon-classForeground, #a371f7);
            --accent-yellow: var(--vscode-editorWarning-foreground, #d29922);
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
            font-size: 13px;
        }
        
        /* Header */
        .header {
            padding: 16px 24px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .header-left {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        
        .header h1 {
            font-size: 16px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .current-branch {
            padding: 4px 12px;
            background: var(--accent-green-bg);
            color: var(--accent-green);
            border-radius: 16px;
            font-size: 12px;
            font-weight: 600;
        }
        
        .header-actions {
            display: flex;
            gap: 8px;
        }
        
        .btn {
            padding: 8px 16px;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            font-size: 12px;
            background: var(--bg-tertiary);
            color: var(--text-primary);
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .btn:hover { background: var(--border-color); }
        
        .btn-primary {
            background: var(--accent-green);
            color: #fff;
            border-color: var(--accent-green);
        }
        
        .btn-primary:hover { background: #2ea043; }
        
        /* Search */
        .search-bar {
            padding: 12px 24px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
        }
        
        .search-input {
            width: 100%;
            padding: 10px 16px;
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            color: var(--text-primary);
            font-size: 13px;
            outline: none;
        }
        
        .search-input:focus {
            border-color: var(--accent-blue);
        }
        
        .search-input::placeholder {
            color: var(--text-secondary);
        }
        
        /* Content */
        .content {
            flex: 1;
            overflow-y: auto;
            padding: 16px 24px;
        }
        
        /* Section */
        .section {
            margin-bottom: 24px;
        }
        
        .section-header {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
            padding: 8px 0;
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .section-count {
            background: var(--bg-tertiary);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
        }
        
        /* Branch Item */
        .branch-item {
            display: flex;
            align-items: center;
            padding: 10px 12px;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.15s;
            gap: 12px;
        }
        
        .branch-item:hover {
            background: var(--bg-secondary);
        }
        
        .branch-item.current {
            background: var(--accent-green-bg);
            border-left: 3px solid var(--accent-green);
        }
        
        .branch-icon {
            font-size: 16px;
            width: 24px;
            text-align: center;
        }
        
        .branch-info {
            flex: 1;
            min-width: 0;
        }
        
        .branch-name {
            font-weight: 500;
            font-family: 'SF Mono', Monaco, monospace;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .branch-meta {
            font-size: 11px;
            color: var(--text-secondary);
            margin-top: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .branch-badges {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        
        .badge {
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
        }
        
        .badge-ahead {
            background: var(--accent-green-bg);
            color: var(--accent-green);
        }
        
        .badge-behind {
            background: var(--accent-blue-bg);
            color: var(--accent-blue);
        }
        
        .branch-actions {
            display: flex;
            gap: 4px;
            opacity: 0;
            transition: opacity 0.15s;
        }
        
        .branch-item:hover .branch-actions {
            opacity: 1;
        }
        
        .action-btn {
            padding: 6px 10px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: var(--bg-tertiary);
            color: var(--text-secondary);
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s;
        }
        
        .action-btn:hover {
            background: var(--border-color);
            color: var(--text-primary);
        }
        
        .action-btn.merge:hover {
            background: var(--accent-purple);
            border-color: var(--accent-purple);
            color: #fff;
        }
        
        .action-btn.delete:hover {
            background: var(--accent-red);
            border-color: var(--accent-red);
            color: #fff;
        }
        
        /* Empty state */
        .empty {
            text-align: center;
            padding: 40px;
            color: var(--text-secondary);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <h1>🔀 ${this.currentRepoPath ? path.basename(this.currentRepoPath) : 'Branches'}</h1>
            <span class="current-branch">📍 ${this.currentBranch}</span>
        </div>
        <div class="header-actions">
            <button class="btn" onclick="fetchAll()">
                ⬇️ Fetch
            </button>
            <button class="btn" onclick="refresh()">
                🔄 Refresh
            </button>
            <button class="btn btn-primary" onclick="createBranch()">
                ➕ New Branch
            </button>
        </div>
    </div>
    
    <div class="search-bar">
        <input type="text" class="search-input" 
            placeholder="🔍 Search branches..." 
            value="${this.searchQuery}"
            oninput="search(this.value)">
    </div>
    
    <div class="content">
        <div class="section">
            <div class="section-header">
                <span>🌿 Local Branches</span>
                <span class="section-count">${localBranches.length}</span>
            </div>
            ${localHtml || '<div class="empty">No local branches found</div>'}
        </div>
        
        <div class="section">
            <div class="section-header">
                <span>☁️ Remote Branches</span>
                <span class="section-count">${remoteBranches.length}</span>
            </div>
            ${remoteHtml || '<div class="empty">No remote branches found</div>'}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function checkout(branch) { vscode.postMessage({ command: 'checkout', branch }); }
        function createBranch() { vscode.postMessage({ command: 'createBranch' }); }
        function rename(branch) { vscode.postMessage({ command: 'rename', branch }); }
        function deleteBranch(branch) { vscode.postMessage({ command: 'delete', branch }); }
        function merge(branch) { vscode.postMessage({ command: 'merge', branch }); }
        function push(branch) { vscode.postMessage({ command: 'push', branch }); }
        function fetchAll() { vscode.postMessage({ command: 'fetch' }); }
        function refresh() { vscode.postMessage({ command: 'refresh' }); }
        function search(query) { vscode.postMessage({ command: 'search', search: query }); }
    </script>
</body>
</html>`;
    }

    private renderBranchItem(branch: BranchItem): string {
        const icon = branch.isCurrent ? '📍' : (branch.isRemote ? '☁️' : '🌿');
        const badges = [];
        
        if (branch.ahead && branch.ahead > 0) {
            badges.push(`<span class="badge badge-ahead">↑${branch.ahead}</span>`);
        }
        if (branch.behind && branch.behind > 0) {
            badges.push(`<span class="badge badge-behind">↓${branch.behind}</span>`);
        }

        const actions = branch.isCurrent ? `
            <button class="action-btn" onclick="rename('${branch.name}')" title="Rename">✏️</button>
            <button class="action-btn" onclick="push('${branch.name}')" title="Push">⬆️</button>
        ` : `
            <button class="action-btn" onclick="checkout('${branch.name}')" title="Checkout">📍</button>
            <button class="action-btn merge" onclick="merge('${branch.name}')" title="Merge into current">🔀</button>
            ${!branch.isRemote ? `
                <button class="action-btn" onclick="rename('${branch.name}')" title="Rename">✏️</button>
                <button class="action-btn delete" onclick="deleteBranch('${branch.name}')" title="Delete">🗑️</button>
            ` : ''}
        `;

        return `
            <div class="branch-item ${branch.isCurrent ? 'current' : ''}" ondblclick="checkout('${branch.name}')">
                <span class="branch-icon">${icon}</span>
                <div class="branch-info">
                    <div class="branch-name">${branch.name}</div>
                    ${branch.lastCommit ? `<div class="branch-meta">${this.escapeHtml(branch.lastCommit.substring(0, 60))}...</div>` : ''}
                </div>
                <div class="branch-badges">
                    ${badges.join('')}
                </div>
                <div class="branch-actions">
                    ${actions}
                </div>
            </div>
        `;
    }

    private escapeHtml(text: string): string {
        if (!text) return '';
        return text.replace(/[&<>"']/g, c => 
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)
        );
    }

    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }
}

