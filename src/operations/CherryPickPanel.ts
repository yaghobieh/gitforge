import * as vscode from 'vscode';
import { GitService } from '../utils/GitService';

interface CommitInfo {
    hash: string;
    message: string;
    author_name: string;
    date: string;
}

export class CherryPickPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | null = null;
    private commits: CommitInfo[] = [];
    private branches: string[] = [];
    private currentBranch: string = '';

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) {}

    async show(): Promise<void> {
        this.branches = await this.gitService.getBranches();
        this.currentBranch = await this.gitService.getCurrentBranch();

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'gitforgeCherryPick',
                '🍒 Cherry Pick',
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

    private async handleMessage(message: { command: string; branch?: string; commits?: string[] }): Promise<void> {
        switch (message.command) {
            case 'loadBranchCommits':
                if (message.branch) {
                    this.commits = await this.gitService.getBranchCommits(message.branch, 50);
                    this.updateCommitsList();
                }
                break;
                
            case 'cherryPick':
                if (message.commits && message.commits.length > 0) {
                    await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: 'Cherry picking...' },
                        async () => {
                            for (const hash of message.commits) {
                                await this.gitService.cherryPick(hash);
                            }
                        }
                    );
                    vscode.window.showInformationMessage(`GitForge: Cherry picked ${message.commits.length} commit(s)`);
                    this.dispose();
                }
                break;
                
            case 'close':
                this.dispose();
                break;
        }
    }

    private updateCommitsList(): void {
        if (!this.panel) return;
        
        const commitsHtml = this.commits.map(c => `
            <div class="commit-item">
                <label class="checkbox-wrapper">
                    <input type="checkbox" class="commit-checkbox" value="${c.hash}">
                    <span class="checkmark"></span>
                </label>
                <div class="commit-info">
                    <div class="commit-message">${this.escapeHtml(c.message.split('\n')[0])}</div>
                    <div class="commit-meta">
                        <span class="commit-hash">${c.hash.substring(0, 7)}</span>
                        <span class="commit-author">${c.author_name}</span>
                        <span class="commit-date">${c.date}</span>
                    </div>
                </div>
            </div>
        `).join('');

        this.panel.webview.postMessage({ command: 'updateCommits', html: commitsHtml });
    }

    private getHtml(): string {
        const branchOptions = this.branches
            .filter(b => b !== this.currentBranch)
            .map(b => `<option value="${b}">${b}</option>`)
            .join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cherry Pick</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: rgba(0, 0, 0, 0.85);
            color: #e0e0e0;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .modal {
            background: #1e1e2e;
            border-radius: 12px;
            margin: 20px;
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            border: 1px solid #313244;
        }
        
        .header {
            padding: 20px 24px;
            background: linear-gradient(135deg, #1e1e2e 0%, #181825 100%);
            border-bottom: 1px solid #313244;
        }
        
        .header h1 {
            font-size: 18px;
            font-weight: 600;
            color: #cdd6f4;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .branch-selector {
            padding: 16px 24px;
            background: #181825;
            border-bottom: 1px solid #313244;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .branch-selector label {
            font-size: 14px;
            color: #6c7086;
        }
        
        .branch-selector select {
            flex: 1;
            padding: 10px 14px;
            background: #313244;
            border: 1px solid #45475a;
            border-radius: 6px;
            color: #cdd6f4;
            font-size: 14px;
        }
        
        .current-branch {
            font-size: 12px;
            color: #a6e3a1;
            background: rgba(166, 227, 161, 0.1);
            padding: 4px 10px;
            border-radius: 20px;
        }
        
        .content {
            flex: 1;
            overflow-y: auto;
            padding: 16px 24px;
        }
        
        .commit-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 12px 16px;
            background: #181825;
            border-radius: 8px;
            margin-bottom: 8px;
            border: 1px solid #313244;
        }
        
        .checkbox-wrapper {
            position: relative;
            width: 20px;
            height: 20px;
            margin-top: 2px;
        }
        
        .checkbox-wrapper input { opacity: 0; position: absolute; }
        
        .checkmark {
            position: absolute;
            width: 20px;
            height: 20px;
            background: #313244;
            border-radius: 4px;
            border: 1px solid #45475a;
        }
        
        .checkbox-wrapper input:checked ~ .checkmark {
            background: #f5c2e7;
            border-color: #f5c2e7;
        }
        
        .checkmark:after {
            content: "";
            position: absolute;
            display: none;
            left: 7px;
            top: 3px;
            width: 5px;
            height: 10px;
            border: solid #11111b;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }
        
        .checkbox-wrapper input:checked ~ .checkmark:after { display: block; }
        
        .commit-info { flex: 1; }
        
        .commit-message {
            font-weight: 500;
            color: #cdd6f4;
            margin-bottom: 4px;
        }
        
        .commit-meta {
            display: flex;
            gap: 12px;
            font-size: 12px;
            color: #6c7086;
        }
        
        .commit-hash {
            font-family: 'SF Mono', Monaco, monospace;
            color: #f5c2e7;
        }
        
        .footer {
            padding: 16px 24px;
            background: #181825;
            border-top: 1px solid #313244;
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }
        
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
        }
        
        .btn-primary {
            background: #f5c2e7;
            color: #11111b;
        }
        
        .btn-primary:disabled {
            background: #45475a;
            color: #6c7086;
            cursor: not-allowed;
        }
        
        .btn-secondary {
            background: #313244;
            color: #cdd6f4;
        }
        
        .placeholder {
            text-align: center;
            padding: 40px;
            color: #6c7086;
        }
    </style>
</head>
<body>
    <div class="modal">
        <div class="header">
            <h1>🍒 Cherry Pick Commits</h1>
        </div>
        
        <div class="branch-selector">
            <label>From branch:</label>
            <select id="branchSelect" onchange="loadBranch()">
                <option value="">Select a branch...</option>
                ${branchOptions}
            </select>
            <span class="current-branch">→ ${this.currentBranch}</span>
        </div>
        
        <div class="content" id="commitsContainer">
            <div class="placeholder">Select a branch to see commits</div>
        </div>
        
        <div class="footer">
            <button class="btn btn-secondary" onclick="close()">Cancel</button>
            <button class="btn btn-primary" id="cherryPickBtn" onclick="cherryPick()" disabled>
                🍒 Cherry Pick Selected
            </button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function loadBranch() {
            const branch = document.getElementById('branchSelect').value;
            if (branch) {
                vscode.postMessage({ command: 'loadBranchCommits', branch });
            }
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateCommits') {
                document.getElementById('commitsContainer').innerHTML = message.html;
                document.querySelectorAll('.commit-checkbox').forEach(cb => {
                    cb.addEventListener('change', updateButton);
                });
            }
        });
        
        function updateButton() {
            const checked = document.querySelectorAll('.commit-checkbox:checked');
            const btn = document.getElementById('cherryPickBtn');
            btn.disabled = checked.length === 0;
        }
        
        function cherryPick() {
            const checked = document.querySelectorAll('.commit-checkbox:checked');
            const commits = Array.from(checked).map(cb => cb.value);
            vscode.postMessage({ command: 'cherryPick', commits });
        }
        
        function close() {
            vscode.postMessage({ command: 'close' });
        }
    </script>
</body>
</html>`;
    }

    private escapeHtml(text: string): string {
        return text.replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char] || char));
    }

    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }
}

