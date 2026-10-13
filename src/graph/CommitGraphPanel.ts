import * as vscode from 'vscode';
import { GitService, GraphCommit, WorkingChange } from '../utils/GitService';
import { commitWebUrl, escapeHtml, linkifyIssues, parseRemoteUrl, RemoteWeb } from '../utils/hostLinks';

export class CommitGraphPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | null = null;
    private remote: RemoteWeb | null = null;

    constructor(private gitService: GitService) {}

    async show(hash?: string): Promise<void> {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'gitforgeCommitGraph',
                'GitForge: Commit Graph',
                { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
                { enableScripts: true, retainContextWhenHidden: true }
            );
            this.panel.onDidDispose(() => { this.panel = null; });
            this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
        }
        await this.render(hash);
        this.panel.reveal();
    }

    private async render(initialHash?: string): Promise<void> {
        if (!this.panel) return;
        const config = vscode.workspace.getConfiguration('gitforge');
        const max = config.get<number>('graph.maxItems') || 200;
        let commits: GraphCommit[] = [];
        let working: WorkingChange[] = [];
        let remotes: { name: string; url: string }[] = [];
        try {
            [commits, working, remotes] = await Promise.all([
                this.gitService.getGraphCommits(max),
                this.gitService.getWorkingChanges(),
                this.gitService.getRemoteRecords()
            ]);
        } catch (error) {
            vscode.window.showErrorMessage(`GitForge: ${error instanceof Error ? error.message : String(error)}`);
        }
        const origin = remotes.find((item) => item.name === 'origin') || remotes[0];
        this.remote = origin ? parseRemoteUrl(origin.url) : null;
        this.panel.webview.html = this.html(commits, working, initialHash);
    }

    private async onMessage(msg: { cmd?: string; hash?: string; name?: string }): Promise<void> {
        if (!msg.cmd) return;
        if (msg.cmd === 'refresh') {
            await this.render();
            return;
        }
        if (msg.cmd === 'scm') {
            await vscode.commands.executeCommand('workbench.view.scm');
            return;
        }
        if (msg.cmd === 'details' && msg.hash) {
            const files = await this.gitService.getCommitFileChanges(msg.hash);
            this.panel?.webview.postMessage({ cmd: 'details', hash: msg.hash, files, url: this.commitUrl(msg.hash) });
            return;
        }
        if (msg.cmd === 'copy' && msg.hash) {
            await vscode.env.clipboard.writeText(msg.hash);
            vscode.window.showInformationMessage(`Copied ${msg.hash.substring(0, 7)}`);
            return;
        }
        if (msg.cmd === 'open' && msg.hash) {
            const url = this.commitUrl(msg.hash);
            if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
            return;
        }
        if (!msg.hash) return;
        await this.runAction(msg.cmd, msg.hash, msg.name);
    }

    private commitUrl(hash: string): string {
        if (!this.remote) return '';
        return commitWebUrl(this.remote, hash);
    }

    private async runAction(cmd: string, hash: string, name?: string): Promise<void> {
        try {
            if (cmd === 'checkout') {
                const ok = await vscode.window.showWarningMessage(`Check out ${hash.substring(0, 7)}?`, { modal: true }, 'Checkout');
                if (ok !== 'Checkout') return;
                await this.gitService.checkout(hash);
            } else if (cmd === 'reset-soft' || cmd === 'reset-mixed' || cmd === 'reset-hard') {
                const mode = cmd.replace('reset-', '');
                const ok = await vscode.window.showWarningMessage(
                    `Reset ${mode} to ${hash.substring(0, 7)}? This cannot be undone from GitForge.`,
                    { modal: true },
                    'Reset'
                );
                if (ok !== 'Reset') return;
                if (mode === 'soft') await this.gitService.resetSoft(hash);
                else if (mode === 'mixed') await this.gitService.resetMixed(hash);
                else await this.gitService.resetHard(hash);
            } else if (cmd === 'revert') {
                await this.gitService.revertCommit(hash);
            } else if (cmd === 'cherry') {
                await this.gitService.cherryPick(hash);
            } else if (cmd === 'branch') {
                const branch = name || await vscode.window.showInputBox({ prompt: 'Branch name', placeHolder: 'feature/from-commit' });
                if (!branch) return;
                await this.gitService.createBranchAt(branch, hash);
            } else if (cmd === 'tag') {
                const tag = name || await vscode.window.showInputBox({ prompt: 'Tag name', placeHolder: 'v1.0.5' });
                if (!tag) return;
                await this.gitService.createTag(tag, hash);
            }
            vscode.window.showInformationMessage('GitForge: Done');
            await this.render();
        } catch (error) {
            vscode.window.showErrorMessage(`GitForge: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private html(commits: GraphCommit[], working: WorkingChange[], initialHash?: string): string {
        const link = (text: string) => this.remote && vscode.workspace.getConfiguration('gitforge').get('issueLinking.enabled', true)
            ? linkifyIssues(text, this.remote)
            : escapeHtml(text);
        const rows = commits.map((commit) => {
            const refs = commit.refs.map((ref) => `<span class="ref">${escapeHtml(ref)}</span>`).join('');
            return `<button class="row" data-hash="${commit.hash}" style="--lane:${commit.lane}">
                <span class="lane"></span>
                <span class="meta">
                    <span class="subject">${link(commit.subject)}</span>
                    <span class="sub">${escapeHtml(commit.author)} · ${escapeHtml(commit.date.slice(0, 10))} · ${commit.hash.substring(0, 7)}</span>
                    <span class="refs">${refs}</span>
                </span>
            </button>`;
        }).join('');
        const work = working.length
            ? `<button class="row work" id="work"><span class="lane"></span><span class="meta"><span class="subject">Working changes</span><span class="sub">${working.length} file${working.length === 1 ? '' : 's'}</span></span></button>`
            : '';
        return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
:root { --bg:#1b2438; --card:#243044; --line:#334155; --text:#e8eef7; --muted:#93a4bd; --green:#3ddc84; --blue:#4c9aff; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
header { display:flex; gap:8px; padding:12px 16px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); }
input, button.tool { background:var(--card); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px 10px; }
input { flex:1; }
.list { padding:8px 12px 24px; }
.row { width:100%; display:flex; gap:10px; text-align:left; background:transparent; color:inherit; border:0; border-bottom:1px solid var(--line); padding:8px 4px; cursor:pointer; }
.row:hover, .row.on { background:#2a3a52; }
.lane { width:14px; margin-left:calc(var(--lane, 0) * 14px); border-left:2px solid var(--blue); position:relative; }
.lane:before { content:''; position:absolute; left:-5px; top:6px; width:8px; height:8px; border-radius:50%; background:var(--green); }
.work .lane:before { background:var(--blue); }
.subject { display:block; }
.sub, .refs { color:var(--muted); font-size:11px; }
.ref { display:inline-block; margin:2px 4px 0 0; padding:1px 6px; border-radius:8px; background:#1e3a5f; color:var(--blue); }
a { color:var(--blue); }
#details { padding:12px 16px 32px; border-top:1px solid var(--line); display:none; }
.file { margin:8px 0; background:var(--card); border-radius:8px; padding:8px 10px; }
pre { overflow:auto; background:#121826; padding:8px; border-radius:6px; font-size:12px; }
.actions { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.actions button { background:var(--card); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:4px 8px; cursor:pointer; }
</style></head>
<body>
<header>
  <input id="q" placeholder="Filter by message, author, or SHA" />
  <button class="tool" id="refresh">Refresh</button>
</header>
<div class="list" id="list">${work}${rows}</div>
<section id="details"></section>
<script>
const vscode = acquireVsCodeApi();
const q = document.getElementById('q');
q.addEventListener('input', () => {
  const needle = q.value.toLowerCase();
  document.querySelectorAll('.row').forEach((row) => {
    row.style.display = row.innerText.toLowerCase().includes(needle) ? '' : 'none';
  });
});
document.getElementById('refresh').onclick = () => vscode.postMessage({ cmd: 'refresh' });
const work = document.getElementById('work');
if (work) work.onclick = () => vscode.postMessage({ cmd: 'scm' });
document.querySelectorAll('.row[data-hash]').forEach((row) => {
  row.onclick = () => {
    document.querySelectorAll('.row').forEach((item) => item.classList.remove('on'));
    row.classList.add('on');
    vscode.postMessage({ cmd: 'details', hash: row.dataset.hash });
  };
});
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.cmd !== 'details') return;
  const root = document.getElementById('details');
  root.style.display = 'block';
  const files = (msg.files || []).map((file) => '<div class="file"><strong>' + esc(file.status) + '</strong> ' + esc(file.path) + '<pre>' + esc(file.patch) + '</pre></div>').join('');
  root.innerHTML = '<div class="actions">'
    + btn('copy', msg.hash, 'Copy SHA')
    + (msg.url ? btn('open', msg.hash, 'Open on host') : '')
    + btn('checkout', msg.hash, 'Checkout')
    + btn('reset-soft', msg.hash, 'Reset soft')
    + btn('reset-mixed', msg.hash, 'Reset mixed')
    + btn('reset-hard', msg.hash, 'Reset hard')
    + btn('revert', msg.hash, 'Revert')
    + btn('cherry', msg.hash, 'Cherry-pick')
    + btn('branch', msg.hash, 'New branch')
    + btn('tag', msg.hash, 'Tag')
    + '</div>' + files;
  root.querySelectorAll('button[data-cmd]').forEach((button) => {
    button.onclick = () => vscode.postMessage({ cmd: button.dataset.cmd, hash: button.dataset.hash });
  });
});
function btn(cmd, hash, label) {
  return '<button data-cmd="' + cmd + '" data-hash="' + hash + '">' + label + '</button>';
}
function esc(value) {
  return String(value || '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}
const initialHash = ${JSON.stringify(initialHash || '')};
if (initialHash) vscode.postMessage({ cmd: 'details', hash: initialHash });
</script>
</body></html>`;
    }

    dispose(): void {
        this.panel?.dispose();
    }
}
