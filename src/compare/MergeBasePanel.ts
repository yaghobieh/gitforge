import * as path from 'path';
import * as vscode from 'vscode';
import { GitService, MergeBaseReport } from '../utils/GitService';
import { escapeHtml } from '../utils/hostLinks';

export class MergeBasePanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | null = null;
    private report: MergeBaseReport | null = null;

    constructor(private gitService: GitService) {}

    async show(): Promise<void> {
        const branches = await this.gitService.getAllBranches();
        if (!branches.current) {
            vscode.window.showWarningMessage('GitForge: Open a Git repository first.');
            return;
        }
        const upstream = await this.gitService.getUpstream();
        const choices = [...branches.local, ...branches.remote].filter((name) => name !== branches.current);
        const picked = await vscode.window.showQuickPick(choices, {
            title: 'Compare against the merge base',
            placeHolder: upstream ? `Default suggestion: ${upstream}` : 'Pick the other ref'
        });
        if (!picked) return;
        let report: MergeBaseReport | null = null;
        try {
            report = await this.gitService.compareMergeBase(branches.current, picked);
        } catch (error) {
            vscode.window.showErrorMessage(`GitForge: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        if (!report) {
            vscode.window.showErrorMessage('GitForge: Could not find a merge base.');
            return;
        }
        this.report = report;
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'gitforgeMergeBase',
                'GitForge: Merge-base compare',
                vscode.ViewColumn.Active,
                { enableScripts: true, retainContextWhenHidden: true }
            );
            this.panel.onDidDispose(() => { this.panel = null; });
            this.panel.webview.onDidReceiveMessage(async (msg: { path?: string }) => {
                if (!msg.path) return;
                const root = await this.repoRoot();
                const uri = vscode.Uri.file(path.isAbsolute(msg.path) ? msg.path : path.join(root, msg.path));
                await vscode.commands.executeCommand('vscode.open', uri);
            });
        }
        this.panel.title = `${report.left} ↔ ${report.right}`;
        this.panel.webview.html = this.html(report);
        this.panel.reveal();
    }

    private async repoRoot(): Promise<string> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) return '';
        return this.gitService.getRepoForFile(folders[0].uri.fsPath);
    }

    private html(report: MergeBaseReport): string {
        const commits = (items: MergeBaseReport['aheadCommits']) => items.map((item) =>
            `<li><code>${item.hash.substring(0, 7)}</code> ${escapeHtml(item.subject)} <span>${escapeHtml(item.author)}</span></li>`
        ).join('') || '<li>None</li>';
        const files = report.files.map((file) =>
            `<li><button data-path="${escapeHtml(file.path)}">${escapeHtml(file.status)} ${escapeHtml(file.path)}</button></li>`
        ).join('') || '<li>None</li>';
        return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
body { margin:0; padding:16px 20px 32px; background:#1b2438; color:#e8eef7; font:13px/1.45 -apple-system,sans-serif; }
h1 { font-size:16px; margin:0 0 8px; }
.counts { display:flex; gap:8px; margin:12px 0; }
.counts span { background:#243044; border-radius:8px; padding:6px 10px; }
.ahead { color:#3ddc84; } .behind { color:#4c9aff; }
h2 { font-size:13px; margin:18px 0 6px; }
li { margin:4px 0; }
code, span { color:#93a4bd; }
button { background:#243044; color:#e8eef7; border:1px solid #334155; border-radius:6px; padding:4px 8px; cursor:pointer; }
</style></head>
<body>
<h1>${escapeHtml(report.left)} compared with ${escapeHtml(report.right)}</h1>
<p>Merge base <code>${report.base.substring(0, 7)}</code>. File list is the diff from that base to ${escapeHtml(report.left)}.</p>
<div class="counts">
  <span class="ahead">Ahead ${report.ahead}</span>
  <span class="behind">Behind ${report.behind}</span>
  <span>${report.files.length} files</span>
</div>
<h2>Ahead</h2><ul>${commits(report.aheadCommits)}</ul>
<h2>Behind</h2><ul>${commits(report.behindCommits)}</ul>
<h2>Changed files</h2><ul>${files}</ul>
<script>
const vscode = acquireVsCodeApi();
document.querySelectorAll('button[data-path]').forEach((button) => {
  button.onclick = () => vscode.postMessage({ path: button.dataset.path });
});
</script>
</body></html>`;
    }

    dispose(): void {
        this.panel?.dispose();
    }
}
