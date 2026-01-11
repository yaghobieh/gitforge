import * as vscode from 'vscode';
import { GitService, MergeChange } from '../utils/GitService';
import * as path from 'path';

export class RollbackPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | null = null;
    private changes: MergeChange[] = [];
    private filter: 'all' | 'modified' | 'added' | 'deleted' = 'all';
    private searchQuery: string = '';

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) {}

    async show(): Promise<void> {
        console.log('GitForge RollbackPanel: Loading changes...');
        this.changes = await this.gitService.getMergeChanges();
        console.log('GitForge RollbackPanel: Found', this.changes.length, 'changes');
        
        if (this.changes.length === 0) {
            // Show a message with debug info
            const workspaceFolders = vscode.workspace.workspaceFolders;
            console.log('GitForge RollbackPanel: Workspace folders:', workspaceFolders?.map(f => f.uri.fsPath));
        }

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'gitforgeRollback',
                '↩️ Rollback Changes',
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

        this.panel.webview.html = this.getHtml();
        this.panel.reveal();
    }

    private async handleMessage(message: { command: string; files?: string[]; file?: string; filter?: string; search?: string }): Promise<void> {
        switch (message.command) {
            case 'rollbackSelected':
                if (message.files && message.files.length > 0) {
                    const confirm = await vscode.window.showWarningMessage(
                        `Rollback ${message.files.length} file(s)? This cannot be undone.`,
                        { modal: true },
                        'Rollback'
                    );
                    
                    if (confirm === 'Rollback') {
                        for (const file of message.files) {
                            await this.gitService.rollbackFile(file);
                        }
                        vscode.window.showInformationMessage(`GitForge: Rolled back ${message.files.length} file(s)`);
                        
                        // Refresh the list
                        this.changes = await this.gitService.getMergeChanges();
                        if (this.changes.length === 0) {
                            this.dispose();
                        } else {
                            this.panel!.webview.html = this.getHtml();
                        }
                    }
                }
                break;
                
            case 'showDiff':
                if (message.file) {
                    await this.showFileDiff(message.file);
                }
                break;

            case 'filter':
                if (message.filter) {
                    this.filter = message.filter as 'all' | 'modified' | 'added' | 'deleted';
                    this.panel!.webview.html = this.getHtml();
                }
                break;

            case 'search':
                this.searchQuery = message.search || '';
                this.panel!.webview.html = this.getHtml();
                break;

            case 'refresh':
                this.changes = await this.gitService.getMergeChanges();
                this.panel!.webview.html = this.getHtml();
                break;
                
            case 'close':
                this.dispose();
                break;
        }
    }

    private async showFileDiff(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        const gitUri = uri.with({ scheme: 'git', query: JSON.stringify({ path: filePath, ref: 'HEAD' }) });
        
        try {
            await vscode.commands.executeCommand('vscode.diff', 
                gitUri, 
                uri, 
                `${path.basename(filePath)} (HEAD ↔ Working Tree)`
            );
        } catch {
            // Fallback: just open the file
            await vscode.window.showTextDocument(uri);
        }
    }

    private getFilteredChanges(): MergeChange[] {
        let filtered = this.changes;

        // Apply type filter
        if (this.filter !== 'all') {
            filtered = filtered.filter(c => c.type === this.filter);
        }

        // Apply search filter
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            filtered = filtered.filter(c => c.path.toLowerCase().includes(query));
        }

        return filtered;
    }

    private getHtml(): string {
        const filteredChanges = this.getFilteredChanges();
        
        // Count by type
        const counts = {
            all: this.changes.length,
            modified: this.changes.filter(c => c.type === 'modified').length,
            added: this.changes.filter(c => c.type === 'added').length,
            deleted: this.changes.filter(c => c.type === 'deleted').length,
        };

        const changesHtml = filteredChanges.map(change => {
            const fileName = path.basename(change.path);
            const dirName = path.dirname(change.path);
            const typeIcon = this.getTypeIcon(change.type);
            const typeColor = this.getTypeColor(change.type);
            const escapedPath = change.path.replace(/'/g, "\\'");
            
            return `
                <div class="file-item" data-path="${escapedPath}">
                    <label class="checkbox-wrapper">
                        <input type="checkbox" class="file-checkbox" value="${escapedPath}">
                        <span class="checkmark"></span>
                    </label>
                    <div class="file-icon" style="color: ${typeColor}">${typeIcon}</div>
                    <div class="file-info" ondblclick="showDiff('${escapedPath}')">
                        <div class="file-name">${fileName}</div>
                        <div class="file-path">${dirName}</div>
                    </div>
                    <div class="file-type" style="color: ${typeColor}">${change.type.toUpperCase()}</div>
                    <div class="file-stats">
                        ${change.additions > 0 ? `<span class="additions">+${change.additions}</span>` : ''}
                        ${change.deletions > 0 ? `<span class="deletions">-${change.deletions}</span>` : ''}
                    </div>
                    <button class="btn-icon" onclick="showDiff('${escapedPath}')" title="View Changes">
                        👁️
                    </button>
                    <button class="btn-icon btn-rollback" onclick="rollbackSingle('${escapedPath}')" title="Rollback">
                        ✕
                    </button>
                </div>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rollback Changes</title>
    <style>
        :root {
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #21262d;
            --border-color: #30363d;
            --text-primary: #e6edf3;
            --text-secondary: #8b949e;
            --accent-green: #3fb950;
            --accent-green-bg: rgba(63, 185, 80, 0.15);
            --accent-red: #f85149;
            --accent-red-bg: rgba(248, 81, 73, 0.15);
            --accent-blue: #58a6ff;
            --accent-yellow: #d29922;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
            font-size: 13px;
        }
        
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
        
        .file-count {
            background: var(--accent-red-bg);
            color: var(--accent-red);
            padding: 4px 12px;
            border-radius: 20px;
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
        }
        
        .btn:hover { background: var(--border-color); }
        
        .btn-primary {
            background: var(--accent-red);
            color: #fff;
            border-color: var(--accent-red);
        }
        
        .btn-primary:hover { background: #da3633; }
        .btn-primary:disabled { background: var(--bg-tertiary); color: var(--text-secondary); cursor: not-allowed; border-color: var(--border-color); }
        
        /* Filters */
        .filter-bar {
            padding: 12px 24px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            gap: 16px;
            align-items: center;
        }
        
        .filter-tabs {
            display: flex;
            gap: 4px;
        }
        
        .filter-tab {
            padding: 6px 12px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: transparent;
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 12px;
            transition: all 0.15s;
        }
        
        .filter-tab:hover { background: var(--bg-tertiary); color: var(--text-primary); }
        .filter-tab.active { background: var(--bg-tertiary); color: var(--text-primary); border-color: var(--accent-blue); }
        
        .search-input {
            flex: 1;
            padding: 8px 12px;
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            color: var(--text-primary);
            font-size: 13px;
            outline: none;
        }
        
        .search-input:focus { border-color: var(--accent-blue); }
        .search-input::placeholder { color: var(--text-secondary); }
        
        /* Toolbar */
        .toolbar {
            padding: 12px 24px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            gap: 12px;
            align-items: center;
        }
        
        .select-all-wrapper {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .hint {
            font-size: 12px;
            color: var(--text-secondary);
            margin-left: auto;
        }
        
        .content {
            flex: 1;
            overflow-y: auto;
            padding: 16px 24px;
        }
        
        .file-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: var(--bg-secondary);
            border-radius: 8px;
            margin-bottom: 8px;
            border: 1px solid var(--border-color);
            transition: all 0.15s;
        }
        
        .file-item:hover {
            background: var(--bg-tertiary);
            border-color: var(--accent-blue);
        }
        
        .checkbox-wrapper {
            position: relative;
            width: 20px;
            height: 20px;
            cursor: pointer;
        }
        
        .checkbox-wrapper input {
            opacity: 0;
            position: absolute;
            cursor: pointer;
        }
        
        .checkmark {
            position: absolute;
            top: 0;
            left: 0;
            width: 20px;
            height: 20px;
            background: var(--bg-tertiary);
            border-radius: 4px;
            border: 1px solid var(--border-color);
        }
        
        .checkbox-wrapper:hover .checkmark {
            background: var(--border-color);
        }
        
        .checkbox-wrapper input:checked ~ .checkmark {
            background: var(--accent-red);
            border-color: var(--accent-red);
        }
        
        .checkmark:after {
            content: "";
            position: absolute;
            display: none;
            left: 7px;
            top: 3px;
            width: 5px;
            height: 10px;
            border: solid #fff;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }
        
        .checkbox-wrapper input:checked ~ .checkmark:after {
            display: block;
        }
        
        .file-icon {
            font-size: 18px;
            width: 24px;
            text-align: center;
        }
        
        .file-info {
            flex: 1;
            cursor: pointer;
            min-width: 0;
        }
        
        .file-name {
            font-weight: 500;
            color: var(--text-primary);
        }
        
        .file-path {
            font-size: 11px;
            color: var(--text-secondary);
            font-family: 'SF Mono', Monaco, monospace;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        .file-type {
            font-size: 10px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(255,255,255,0.1);
        }
        
        .file-stats {
            display: flex;
            gap: 8px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 12px;
            min-width: 80px;
            justify-content: flex-end;
        }
        
        .additions {
            color: var(--accent-green);
        }
        
        .deletions {
            color: var(--accent-red);
        }
        
        .btn-icon {
            width: 32px;
            height: 32px;
            border: none;
            background: transparent;
            color: var(--text-secondary);
            font-size: 16px;
            cursor: pointer;
            border-radius: 6px;
            transition: all 0.15s;
        }
        
        .btn-icon:hover {
            background: var(--bg-tertiary);
            color: var(--text-primary);
        }
        
        .btn-rollback:hover {
            background: var(--accent-red-bg);
            color: var(--accent-red);
        }
        
        .footer {
            padding: 16px 24px;
            background: var(--bg-secondary);
            border-top: 1px solid var(--border-color);
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }
        
        .empty-state {
            text-align: center;
            padding: 60px;
            color: var(--text-secondary);
        }
        
        .empty-state .icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <h1>↩️ Rollback Changes</h1>
            <div class="file-count">${this.changes.length} changed file${this.changes.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="header-actions">
            <button class="btn" onclick="refresh()">🔄 Refresh</button>
            <button class="btn" onclick="close()">✕ Close</button>
        </div>
    </div>
    
    <div class="filter-bar">
        <div class="filter-tabs">
            <button class="filter-tab ${this.filter === 'all' ? 'active' : ''}" onclick="setFilter('all')">
                All (${counts.all})
            </button>
            <button class="filter-tab ${this.filter === 'modified' ? 'active' : ''}" onclick="setFilter('modified')">
                ✏️ Modified (${counts.modified})
            </button>
            <button class="filter-tab ${this.filter === 'added' ? 'active' : ''}" onclick="setFilter('added')">
                ➕ Added (${counts.added})
            </button>
            <button class="filter-tab ${this.filter === 'deleted' ? 'active' : ''}" onclick="setFilter('deleted')">
                🗑️ Deleted (${counts.deleted})
            </button>
        </div>
        <input type="text" class="search-input" placeholder="🔍 Search files..." 
            value="${this.searchQuery}" oninput="search(this.value)">
    </div>
    
    <div class="toolbar">
        <div class="select-all-wrapper">
            <label class="checkbox-wrapper">
                <input type="checkbox" id="selectAll" onchange="toggleSelectAll()">
                <span class="checkmark"></span>
            </label>
            <span>Select All</span>
        </div>
        <span class="hint">Double-click a file to view changes</span>
    </div>
    
    <div class="content">
        ${filteredChanges.length > 0 ? changesHtml : `
            <div class="empty-state">
                <div class="icon">${this.changes.length === 0 ? '✅' : '🔍'}</div>
                <h2>${this.changes.length === 0 ? 'No changes to rollback' : 'No files match your filter'}</h2>
                <p>${this.changes.length === 0 ? 'Your working directory is clean.' : 'Try adjusting your search or filter.'}</p>
            </div>
        `}
    </div>
    
    <div class="footer">
        <button class="btn btn-primary" id="rollbackBtn" onclick="rollbackSelected()" disabled>
            ↩️ Rollback Selected
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function toggleSelectAll() {
            const selectAll = document.getElementById('selectAll');
            const checkboxes = document.querySelectorAll('.file-checkbox');
            checkboxes.forEach(cb => cb.checked = selectAll.checked);
            updateRollbackButton();
        }
        
        function updateRollbackButton() {
            const checked = document.querySelectorAll('.file-checkbox:checked');
            const btn = document.getElementById('rollbackBtn');
            btn.disabled = checked.length === 0;
            btn.textContent = checked.length > 0 
                ? '↩️ Rollback ' + checked.length + ' file' + (checked.length > 1 ? 's' : '')
                : '↩️ Rollback Selected';
        }
        
        document.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.addEventListener('change', updateRollbackButton);
        });
        
        function rollbackSelected() {
            const checked = document.querySelectorAll('.file-checkbox:checked');
            const files = Array.from(checked).map(cb => cb.value);
            vscode.postMessage({ command: 'rollbackSelected', files });
        }
        
        function rollbackSingle(file) {
            vscode.postMessage({ command: 'rollbackSelected', files: [file] });
        }
        
        function showDiff(file) {
            vscode.postMessage({ command: 'showDiff', file });
        }
        
        function setFilter(filter) {
            vscode.postMessage({ command: 'filter', filter });
        }
        
        function search(query) {
            vscode.postMessage({ command: 'search', search: query });
        }
        
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
        
        function close() {
            vscode.postMessage({ command: 'close' });
        }
    </script>
</body>
</html>`;
    }

    private getTypeIcon(type: string): string {
        switch (type) {
            case 'added': return '➕';
            case 'modified': return '✏️';
            case 'deleted': return '🗑️';
            case 'renamed': return '📝';
            default: return '📄';
        }
    }

    private getTypeColor(type: string): string {
        switch (type) {
            case 'added': return '#3fb950';
            case 'modified': return '#d29922';
            case 'deleted': return '#f85149';
            case 'renamed': return '#58a6ff';
            default: return '#e6edf3';
        }
    }

    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }
}
