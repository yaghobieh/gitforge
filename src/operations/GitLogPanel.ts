import * as vscode from 'vscode';
import { GitService } from '../utils/GitService';

interface CommitInfo {
    hash: string;
    message: string;
    author_name: string;
    date: string;
}

export class GitLogPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | null = null;
    private commits: CommitInfo[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) {}

    async show(): Promise<void> {
        console.log('GitForge Log: show() called');
        
        try {
            this.commits = await this.gitService.getRecentCommits(100);
            console.log('GitForge Log: Loaded', this.commits.length, 'commits');
        } catch (error) {
            console.error('GitForge Log: Error loading commits:', error);
            this.commits = [];
            vscode.window.showErrorMessage(`GitForge Log Error: ${error}`);
        }

        if (this.commits.length === 0) {
            vscode.window.showWarningMessage('GitForge: No commits found. Make sure you are in a Git repository.');
        }

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'gitforgeLog',
                '📜 Git Log',
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

    private async handleMessage(message: { command: string; hash?: string }): Promise<void> {
        switch (message.command) {
            case 'viewCommit':
                if (message.hash) {
                    await vscode.commands.executeCommand('git.viewCommit', message.hash);
                }
                break;
            case 'checkout':
                if (message.hash) {
                    const confirm = await vscode.window.showWarningMessage(
                        `Checkout commit ${message.hash.substring(0, 7)}?`,
                        'Checkout'
                    );
                    if (confirm) {
                        await this.gitService.checkout(message.hash);
                        vscode.window.showInformationMessage('GitForge: Checked out commit');
                    }
                }
                break;
            case 'close':
                this.dispose();
                break;
        }
    }

    private getHtml(): string {
        const commitsHtml = this.commits.map((c, i) => `
            <div class="commit-item" style="animation-delay: ${i * 0.02}s">
                <div class="commit-graph">
                    <div class="commit-dot"></div>
                    ${i < this.commits.length - 1 ? '<div class="commit-line"></div>' : ''}
                </div>
                <div class="commit-content">
                    <div class="commit-message">${this.escapeHtml(c.message.split('\n')[0])}</div>
                    <div class="commit-meta">
                        <span class="commit-hash">${c.hash.substring(0, 7)}</span>
                        <span class="commit-author">${c.author_name}</span>
                        <span class="commit-date">${c.date}</span>
                    </div>
                </div>
                <div class="commit-actions">
                    <button class="btn-small" onclick="viewCommit('${c.hash}')">View</button>
                    <button class="btn-small" onclick="checkout('${c.hash}')">Checkout</button>
                </div>
            </div>
        `).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Log</title>
    <style>
        :root {
            --bg: var(--vscode-editor-background, #1a1b26);
            --bg2: var(--vscode-sideBar-background, #1e1e2e);
            --bg3: var(--vscode-button-secondaryBackground, #313244);
            --border: var(--vscode-panel-border, #313244);
            --text: var(--vscode-editor-foreground, #cdd6f4);
            --text2: var(--vscode-descriptionForeground, #6c7086);
            --accent: var(--vscode-focusBorder, #89b4fa);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg);
            color: var(--text);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .modal {
            background: var(--bg2);
            border-radius: 12px;
            margin: 20px;
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            border: 1px solid var(--border);
        }
        
        .header {
            padding: 20px 24px;
            background: var(--bg2);
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .header h1 {
            font-size: 18px;
            font-weight: 600;
            color: var(--text);
        }
        
        .commit-count {
            background: var(--accent);
            color: var(--bg);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        
        .content {
            flex: 1;
            overflow-y: auto;
            padding: 24px;
        }
        
        .commit-item {
            display: flex;
            gap: 16px;
            padding: 12px 0;
            animation: fadeIn 0.3s ease forwards;
            opacity: 0;
        }
        
        @keyframes fadeIn {
            to { opacity: 1; }
        }
        
        .commit-graph {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 20px;
        }
        
        .commit-dot {
            width: 12px;
            height: 12px;
            background: var(--accent);
            border-radius: 50%;
            border: 2px solid var(--bg2);
            z-index: 1;
        }
        
        .commit-line {
            width: 2px;
            flex: 1;
            background: var(--border);
            margin-top: -2px;
        }
        
        .commit-content {
            flex: 1;
        }
        
        .commit-message {
            font-weight: 500;
            color: var(--text);
            margin-bottom: 4px;
        }
        
        .commit-meta {
            display: flex;
            gap: 12px;
            font-size: 12px;
            color: var(--text2);
        }
        
        .commit-hash {
            font-family: 'SF Mono', Monaco, monospace;
            color: var(--accent);
        }
        
        .commit-actions {
            display: flex;
            gap: 8px;
            align-items: flex-start;
        }
        
        .btn-small {
            padding: 6px 12px;
            background: var(--bg3);
            border: none;
            border-radius: 4px;
            color: var(--text);
            font-size: 12px;
            cursor: pointer;
            transition: all 0.15s;
        }
        
        .btn-small:hover {
            background: var(--border);
        }
        
        .footer {
            padding: 16px 24px;
            background: var(--bg);
            border-top: 1px solid var(--border);
            display: flex;
            justify-content: flex-end;
        }
        
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            background: var(--bg3);
            color: var(--text);
        }
    </style>
</head>
<body>
    <div class="modal">
        <div class="header">
            <h1>📜 Git Log</h1>
            <span class="commit-count">${this.commits.length} commits</span>
        </div>
        
        <div class="content">
            ${commitsHtml}
        </div>
        
        <div class="footer">
            <button class="btn" onclick="close()">Close</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function viewCommit(hash) {
            vscode.postMessage({ command: 'viewCommit', hash });
        }
        
        function checkout(hash) {
            vscode.postMessage({ command: 'checkout', hash });
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

