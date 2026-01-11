import * as vscode from 'vscode';
import { GitService } from '../utils/GitService';
import * as path from 'path';
import * as fs from 'fs';

interface ConflictRegion {
    id: number;
    startLine: number;
    endLine: number;
    localStartLine: number;
    remoteStartLine: number;
    localLines: string[];
    remoteLines: string[];
    resolved: 'none' | 'local' | 'remote' | 'both' | 'custom';
    resultLines: string[];
}

interface ParsedFile {
    localLines: string[];
    remoteLines: string[];
    resultLines: string[];
    conflicts: ConflictRegion[];
}

interface ConflictedFile {
    path: string;
    name: string;
    parsed: ParsedFile | null;
    originalContent: string;
}

type ResolutionCallback = (resolution: { file: string; content: string }) => void;

export class ConflictWebviewPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | null = null;
    private files: ConflictedFile[] = [];
    private currentFileIndex: number = -1;
    private currentBranch: string = '';
    private incomingBranch: string = '';
    private undoStack: Map<string, string[]> = new Map();

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService,
        private onResolution: ResolutionCallback
    ) {}

    async show(filePath: string, _content: any): Promise<void> {
        this.currentBranch = await this.gitService.getCurrentBranch() || 'HEAD';
        this.incomingBranch = 'INCOMING';
        this.currentFileIndex = -1;
        
        await this.scanForConflicts();
        
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'gitforgeConflict',
                '⚔️ Merge Conflicts',
                { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
                { enableScripts: true, retainContextWhenHidden: true }
            );

            this.panel.onDidDispose(() => { this.panel = null; });
            this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
        }

        this.updatePanel();
        this.panel.reveal();
    }

    private async scanForConflicts(): Promise<void> {
        this.files = [];
        const addedPaths = new Set<string>();
        
        const conflictedFiles = await this.gitService.getConflictedFiles();
        
        for (const file of conflictedFiles) {
            try {
                const content = fs.readFileSync(file.path, 'utf-8');
                if (this.hasConflictMarkers(content)) {
                    this.files.push({
                        path: file.path,
                        name: path.basename(file.path),
                        parsed: null,
                        originalContent: content
                    });
                    addedPaths.add(file.path);
                }
            } catch { }
        }
        
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme !== 'file') continue;
            if (addedPaths.has(doc.uri.fsPath)) continue;
            
            const content = doc.getText();
            if (this.hasConflictMarkers(content)) {
                this.files.push({
                    path: doc.uri.fsPath,
                    name: path.basename(doc.uri.fsPath),
                    parsed: null,
                    originalContent: content
                });
                addedPaths.add(doc.uri.fsPath);
            }
        }
    }
    
    private hasConflictMarkers(content: string): boolean {
        const hasStart = content.includes('<<<<<<<');
        const hasMid = content.includes('=======');
        const hasEnd = content.includes('>>>>>>>');
        
        if (!hasStart || !hasMid || !hasEnd) return false;
        
        const startIdx = content.indexOf('<<<<<<<');
        const midIdx = content.indexOf('=======', startIdx);
        const endIdx = content.indexOf('>>>>>>>', midIdx);
        
        return startIdx < midIdx && midIdx < endIdx;
    }

    private parseFile(file: ConflictedFile): void {
        if (file.parsed) return;
        
        const content = file.originalContent;
        const rawLines = content.split('\n');
        
        const localLines: string[] = [];
        const remoteLines: string[] = [];
        const resultLines: string[] = [];
        const conflicts: ConflictRegion[] = [];
        
        let inConflict = false;
        let section: 'local' | 'remote' = 'local';
        let conflictId = 0;
        let conflictLocalLines: string[] = [];
        let conflictRemoteLines: string[] = [];
        let conflictStartLocal = 0;
        let conflictStartRemote = 0;
        let conflictStartResult = 0;

        for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            
            if (line.startsWith('<<<<<<<')) {
                inConflict = true;
                section = 'local';
                conflictLocalLines = [];
                conflictRemoteLines = [];
                conflictStartLocal = localLines.length;
                conflictStartRemote = remoteLines.length;
                conflictStartResult = resultLines.length;
            } else if (line.startsWith('=======') && inConflict) {
                section = 'remote';
            } else if (line.startsWith('>>>>>>>') && inConflict) {
                const branchMatch = line.match(/>>>>>>> (.+)/);
                if (branchMatch) {
                    this.incomingBranch = branchMatch[1];
                }
                
                for (const l of conflictLocalLines) {
                    localLines.push(l);
                }
                for (let j = conflictLocalLines.length; j < conflictRemoteLines.length; j++) {
                    localLines.push('');
                }
                
                for (const l of conflictRemoteLines) {
                    remoteLines.push(l);
                }
                for (let j = conflictRemoteLines.length; j < conflictLocalLines.length; j++) {
                    remoteLines.push('');
                }
                
                const maxLines = Math.max(conflictLocalLines.length, conflictRemoteLines.length);
                for (let j = 0; j < maxLines; j++) {
                    resultLines.push('');
                }
                
                conflicts.push({
                    id: conflictId++,
                    startLine: conflictStartResult,
                    endLine: resultLines.length,
                    localStartLine: conflictStartLocal,
                    remoteStartLine: conflictStartRemote,
                    localLines: [...conflictLocalLines],
                    remoteLines: [...conflictRemoteLines],
                    resolved: 'none',
                    resultLines: []
                });
                
                inConflict = false;
            } else if (inConflict) {
                if (section === 'local') {
                    conflictLocalLines.push(line);
                } else {
                    conflictRemoteLines.push(line);
                }
            } else {
                localLines.push(line);
                remoteLines.push(line);
                resultLines.push(line);
            }
        }
        
        file.parsed = { localLines, remoteLines, resultLines, conflicts };
    }

    private handleMessage(msg: any): void {
        switch (msg.cmd) {
            case 'openFile':
                this.currentFileIndex = msg.idx;
                this.parseFile(this.files[msg.idx]);
                this.updatePanel();
                break;
            case 'backToList':
                this.currentFileIndex = -1;
                this.updatePanel();
                break;
            case 'acceptOurs':
                this.confirmAndAccept(msg.idx, 'ours');
                break;
            case 'acceptTheirs':
                this.confirmAndAccept(msg.idx, 'theirs');
                break;
            case 'acceptConflict':
                this.acceptConflict(msg.conflictId, msg.side);
                break;
            case 'aiMerge':
                this.aiMerge(msg.conflictId);
                break;
            case 'undo':
                this.undo();
                break;
            case 'apply':
                this.applyFile();
                break;
            case 'abort':
                this.currentFileIndex = -1;
                this.updatePanel();
                break;
            case 'close':
                this.dispose();
                break;
        }
    }

    private async confirmAndAccept(idx: number, side: 'ours' | 'theirs'): Promise<void> {
        const file = this.files[idx];
        if (!file) return;
        
        const sideLabel = side === 'ours' ? 'local (yours)' : 'remote (theirs)';
        const confirm = await vscode.window.showWarningMessage(
            `Accept all ${sideLabel} changes for "${file.name}"?`,
            { modal: true },
            'Accept'
        );
        
        if (confirm === 'Accept') {
            this.acceptFileQuick(idx, side);
        }
    }

    private acceptFileQuick(idx: number, side: 'ours' | 'theirs'): void {
        const file = this.files[idx];
        if (!file) return;
        
        const content = file.originalContent;
        const lines = content.split('\n');
        const result: string[] = [];
        
        let inConflict = false;
        let section: 'local' | 'remote' = 'local';
        let localLines: string[] = [];
        let remoteLines: string[] = [];
        
        for (const line of lines) {
            if (line.startsWith('<<<<<<<')) {
                inConflict = true;
                section = 'local';
                localLines = [];
                remoteLines = [];
            } else if (line.startsWith('=======') && inConflict) {
                section = 'remote';
            } else if (line.startsWith('>>>>>>>') && inConflict) {
                const chosen = side === 'ours' ? localLines : remoteLines;
                result.push(...chosen);
                inConflict = false;
            } else if (inConflict) {
                if (section === 'local') {
                    localLines.push(line);
                } else {
                    remoteLines.push(line);
                }
            } else {
                result.push(line);
            }
        }
        
        fs.writeFileSync(file.path, result.join('\n'));
        this.gitService.stageFile(file.path);
        vscode.window.showInformationMessage(`✅ ${file.name}: Accepted ${side === 'ours' ? 'local' : 'remote'}`);
        
        this.files.splice(idx, 1);
        if (this.files.length === 0) {
            vscode.window.showInformationMessage('🎉 All conflicts resolved!');
            this.dispose();
        } else {
            this.updatePanel();
        }
    }

    private acceptConflict(conflictId: number, side: 'local' | 'remote' | 'both'): void {
        const file = this.files[this.currentFileIndex];
        if (!file?.parsed) return;
        
        const conflict = file.parsed.conflicts.find(c => c.id === conflictId);
        if (!conflict) return;
        
        this.saveUndo();
        
        if (side === 'local') {
            conflict.resultLines = [...conflict.localLines];
        } else if (side === 'remote') {
            conflict.resultLines = [...conflict.remoteLines];
        } else {
            conflict.resultLines = [...conflict.localLines, ...conflict.remoteLines];
        }
        conflict.resolved = side;
        
        const maxLen = Math.max(conflict.localLines.length, conflict.remoteLines.length);
        for (let i = 0; i < maxLen; i++) {
            const resultIdx = conflict.startLine + i;
            file.parsed.resultLines[resultIdx] = conflict.resultLines[i] || '';
        }
        
        this.updatePanel();
    }

    private async aiMerge(conflictId: number): Promise<void> {
        const file = this.files[this.currentFileIndex];
        if (!file?.parsed) return;
        
        const conflict = file.parsed.conflicts.find(c => c.id === conflictId);
        if (!conflict) return;
        
        const prompt = `Resolve this merge conflict. Return ONLY the merged code:

<<<<<<< ${this.currentBranch}
${conflict.localLines.join('\n')}
=======
${conflict.remoteLines.join('\n')}
>>>>>>> ${this.incomingBranch}`;

        await vscode.env.clipboard.writeText(prompt);
        vscode.window.showInformationMessage('🤖 Copied! Paste in AI chat (⌘L)');
    }

    private saveUndo(): void {
        const file = this.files[this.currentFileIndex];
        if (!file?.parsed) return;
        
        const key = file.path;
        if (!this.undoStack.has(key)) this.undoStack.set(key, []);
        this.undoStack.get(key)!.push(JSON.stringify(file.parsed));
        if (this.undoStack.get(key)!.length > 30) this.undoStack.get(key)!.shift();
    }

    private undo(): void {
        const file = this.files[this.currentFileIndex];
        if (!file) return;
        
        const stack = this.undoStack.get(file.path);
        if (stack?.length) {
            file.parsed = JSON.parse(stack.pop()!);
            this.updatePanel();
        }
    }

    private applyFile(): void {
        const file = this.files[this.currentFileIndex];
        if (!file?.parsed) return;

        const unresolved = file.parsed.conflicts.filter(c => c.resolved === 'none').length;
        if (unresolved > 0) {
            vscode.window.showWarningMessage(`${unresolved} conflict(s) still unresolved!`);
            return;
        }

        const result: string[] = [];
        let conflictIdx = 0;
        let lineIdx = 0;
        
        while (lineIdx < file.parsed.resultLines.length) {
            const conflict = file.parsed.conflicts[conflictIdx];
            
            if (conflict && lineIdx === conflict.startLine) {
                result.push(...conflict.resultLines);
                lineIdx = conflict.endLine;
                conflictIdx++;
            } else {
                result.push(file.parsed.resultLines[lineIdx]);
                lineIdx++;
            }
        }

        fs.writeFileSync(file.path, result.join('\n'));
        this.gitService.stageFile(file.path);
        vscode.window.showInformationMessage(`✅ Saved: ${file.name}`);
        
        this.files.splice(this.currentFileIndex, 1);
        this.currentFileIndex = -1;
        
        if (this.files.length === 0) {
            vscode.window.showInformationMessage('🎉 All conflicts resolved!');
            this.dispose();
        } else {
            this.updatePanel();
        }
    }

    private updatePanel(): void {
        if (!this.panel) return;
        
        if (this.currentFileIndex === -1) {
            this.panel.webview.html = this.getFileListHtml();
        } else {
            this.panel.webview.html = this.getMergeEditorHtml();
        }
    }

    private computeInlineDiff(localLine: string, remoteLine: string): { local: string; remote: string } {
        if (!localLine && !remoteLine) return { local: '', remote: '' };
        if (!localLine) return { local: '', remote: `<span class="add">${this.esc(remoteLine)}</span>` };
        if (!remoteLine) return { local: `<span class="del">${this.esc(localLine)}</span>`, remote: '' };
        if (localLine === remoteLine) return { local: this.esc(localLine), remote: this.esc(remoteLine) };
        
        const localChars = localLine.split('');
        const remoteChars = remoteLine.split('');
        
        let commonPrefixLen = 0;
        while (commonPrefixLen < localChars.length && commonPrefixLen < remoteChars.length && 
               localChars[commonPrefixLen] === remoteChars[commonPrefixLen]) {
            commonPrefixLen++;
        }
        
        let commonSuffixLen = 0;
        while (commonSuffixLen < localChars.length - commonPrefixLen && 
               commonSuffixLen < remoteChars.length - commonPrefixLen &&
               localChars[localChars.length - 1 - commonSuffixLen] === remoteChars[remoteChars.length - 1 - commonSuffixLen]) {
            commonSuffixLen++;
        }
        
        const prefix = this.esc(localLine.substring(0, commonPrefixLen));
        const localDiff = localLine.substring(commonPrefixLen, localLine.length - commonSuffixLen);
        const remoteDiff = remoteLine.substring(commonPrefixLen, remoteLine.length - commonSuffixLen);
        const suffix = this.esc(localLine.substring(localLine.length - commonSuffixLen));
        
        const localHtml = prefix + (localDiff ? `<span class="del">${this.esc(localDiff)}</span>` : '') + suffix;
        const remoteHtml = prefix + (remoteDiff ? `<span class="add">${this.esc(remoteDiff)}</span>` : '') + suffix;
        
        return { local: localHtml, remote: remoteHtml };
    }

    private getFileListHtml(): string {
        const filesHtml = this.files.map((f, i) => `
            <div class="file-row">
                <span class="file-icon">⚔️</span>
                <div class="file-info">
                    <span class="file-name">${this.esc(f.name)}</span>
                    <span class="file-path">${this.esc(path.dirname(f.path))}</span>
                </div>
                <div class="file-actions">
                    <button class="btn green" onclick="acceptOurs(${i})">
                        <span class="icon">◀</span> Accept Local
                    </button>
                    <button class="btn purple" onclick="openFile(${i})">
                        <span class="icon">⚔️</span> Resolve
                    </button>
                    <button class="btn blue" onclick="acceptTheirs(${i})">
                        Accept Remote <span class="icon">▶</span>
                    </button>
                </div>
            </div>
        `).join('');

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
:root {
    --bg: #0d1117;
    --bg2: #161b22;
    --bg3: #21262d;
    --border: #30363d;
    --text: #c9d1d9;
    --text2: #8b949e;
    --green: #3fb950;
    --green-bg: rgba(63, 185, 80, 0.15);
    --blue: #58a6ff;
    --blue-bg: rgba(88, 166, 255, 0.15);
    --purple: #a371f7;
    --purple-bg: rgba(163, 113, 247, 0.15);
    --red: #f85149;
    --red-bg: rgba(248, 81, 73, 0.15);
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }

.header {
    padding:20px 32px;
    background:var(--bg2);
    border-bottom:1px solid var(--border);
    display:flex;
    align-items:center;
    gap:20px;
}
.header h1 { font-size:18px; flex:1; font-weight:600; }
.count {
    background:var(--red);
    color:#fff;
    padding:4px 12px;
    border-radius:12px;
    font-size:12px;
    font-weight:600;
}
.btn-close {
    padding:6px 12px;
    background:var(--bg3);
    border:1px solid var(--border);
    border-radius:6px;
    color:var(--text2);
    cursor:pointer;
    font-size:12px;
}
.btn-close:hover { background:var(--border); color:var(--text); }

.content { padding:20px 32px; }

.file-row {
    display:flex;
    align-items:center;
    gap:16px;
    padding:16px 20px;
    background:var(--bg2);
    border:1px solid var(--border);
    border-radius:8px;
    margin-bottom:12px;
}
.file-row:hover { border-color:var(--purple); }
.file-icon { font-size:24px; }
.file-info { flex:1; }
.file-name { font-weight:600; font-size:14px; display:block; margin-bottom:2px; }
.file-path { color:var(--text2); font-size:11px; font-family:monospace; }

.file-actions { display:flex; gap:8px; }
.btn {
    padding:8px 16px;
    border:1px solid var(--border);
    border-radius:6px;
    cursor:pointer;
    font-size:12px;
    font-weight:500;
    background:var(--bg);
    color:var(--text);
    display:flex;
    align-items:center;
    gap:6px;
}
.btn:hover { transform:translateY(-1px); }
.btn .icon { font-size:10px; }

.btn.green { background:var(--green-bg); color:var(--green); border-color:var(--green); }
.btn.blue { background:var(--blue-bg); color:var(--blue); border-color:var(--blue); }
.btn.purple { background:var(--purple-bg); color:var(--purple); border-color:var(--purple); }

.empty { text-align:center; padding:60px; color:var(--text2); }
</style>
</head>
<body>
    <div class="header">
        <h1>⚔️ Merge Conflicts</h1>
        <span class="count">${this.files.length} file${this.files.length !== 1 ? 's' : ''}</span>
        <button class="btn-close" onclick="close()">✕ Close</button>
    </div>
    <div class="content">
        ${filesHtml || '<div class="empty">✨ No conflicts found</div>'}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const openFile = i => vscode.postMessage({cmd:'openFile',idx:i});
        const acceptOurs = i => vscode.postMessage({cmd:'acceptOurs',idx:i});
        const acceptTheirs = i => vscode.postMessage({cmd:'acceptTheirs',idx:i});
        const close = () => vscode.postMessage({cmd:'close'});
    </script>
</body>
</html>`;
    }

    private getMergeEditorHtml(): string {
        const file = this.files[this.currentFileIndex];
        if (!file?.parsed) return '';
        
        const { localLines, remoteLines, resultLines, conflicts } = file.parsed;
        const maxLines = Math.max(localLines.length, remoteLines.length, resultLines.length);
        
        const conflictMap = new Map<number, ConflictRegion>();
        for (const c of conflicts) {
            for (let i = c.startLine; i < c.endLine; i++) {
                conflictMap.set(i, c);
            }
        }
        
        let rowsHtml = '';
        let lastConflictId = -1;
        
        for (let i = 0; i < maxLines; i++) {
            const conflict = conflictMap.get(i);
            const isConflict = !!conflict;
            const isFirstOfConflict = conflict && conflict.startLine === i;
            const isResolved = conflict && conflict.resolved !== 'none';
            
            if (isFirstOfConflict && conflict.id !== lastConflictId) {
                lastConflictId = conflict.id;
                rowsHtml += `
                    <div class="conflict-header">
                        <div class="conflict-actions local">
                            <button class="act-btn accept-local" onclick="acceptConflict(${conflict.id},'local')" title="Accept Local">
                                ← Use Local
                            </button>
                        </div>
                        <div class="conflict-info">
                            <span class="conflict-badge ${isResolved ? 'resolved' : ''}">
                                ${isResolved ? '✓ Resolved' : `Conflict #${conflict.id + 1}`}
                            </span>
                            <button class="act-btn both" onclick="acceptConflict(${conflict.id},'both')" title="Use Both">Both</button>
                            <button class="act-btn ai" onclick="aiMerge(${conflict.id})" title="AI Merge">🤖</button>
                        </div>
                        <div class="conflict-actions remote">
                            <button class="act-btn accept-remote" onclick="acceptConflict(${conflict.id},'remote')" title="Accept Remote">
                                Use Remote →
                            </button>
                        </div>
                    </div>`;
            }
            
            const localContent = localLines[i] || '';
            const remoteContent = remoteLines[i] || '';
            let resultContent = '';
            
            if (conflict && conflict.resolved !== 'none') {
                const resultIdx = i - conflict.startLine;
                resultContent = conflict.resultLines[resultIdx] || '';
            } else if (!conflict) {
                resultContent = resultLines[i] || '';
            }

            let localHtml: string;
            let remoteHtml: string;
            
            if (isConflict && !isResolved) {
                const diff = this.computeInlineDiff(localContent, remoteContent);
                localHtml = diff.local || '&nbsp;';
                remoteHtml = diff.remote || '&nbsp;';
            } else {
                localHtml = this.esc(localContent) || '&nbsp;';
                remoteHtml = this.esc(remoteContent) || '&nbsp;';
            }
            
            const rowClass = isConflict ? (isResolved ? 'row resolved' : 'row conflict') : 'row';
            
            rowsHtml += `
                <div class="${rowClass}">
                    <div class="gutter local">${i + 1}</div>
                    <div class="code local"><pre>${localHtml}</pre></div>
                    <div class="gutter result">${i + 1}</div>
                    <div class="code result"><pre>${this.esc(resultContent) || '&nbsp;'}</pre></div>
                    <div class="gutter remote">${i + 1}</div>
                    <div class="code remote"><pre>${remoteHtml}</pre></div>
                </div>`;
        }

        const allResolved = conflicts.every(c => c.resolved !== 'none');
        const resolvedCount = conflicts.filter(c => c.resolved !== 'none').length;

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
:root {
    --bg: #0d1117;
    --bg2: #161b22;
    --bg3: #21262d;
    --border: #30363d;
    --text: #c9d1d9;
    --text2: #8b949e;
    --green: #3fb950;
    --green-bg: rgba(63, 185, 80, 0.15);
    --green-line: rgba(63, 185, 80, 0.25);
    --blue: #58a6ff;
    --blue-bg: rgba(88, 166, 255, 0.15);
    --blue-line: rgba(88, 166, 255, 0.25);
    --purple: #a371f7;
    --purple-bg: rgba(163, 113, 247, 0.15);
    --red: #f85149;
    --red-bg: rgba(248, 81, 73, 0.15);
    --red-line: rgba(248, 81, 73, 0.25);
    --yellow: #d29922;
}
* { margin:0; padding:0; box-sizing:border-box; }
body { 
    font-family:'SF Mono',Consolas,Monaco,'Courier New',monospace; 
    background:var(--bg); 
    color:var(--text); 
    height:100vh; 
    display:flex; 
    flex-direction:column; 
    font-size:13px;
    line-height:1.5;
}

.header {
    display:flex;
    align-items:center;
    padding:12px 16px;
    background:var(--bg2);
    border-bottom:1px solid var(--border);
    gap:12px;
    flex-shrink:0;
}
.header h1 { font-size:13px; font-weight:600; font-family:-apple-system,sans-serif; }
.branch { padding:3px 8px; border-radius:4px; font-size:11px; font-weight:600; }
.branch.local { background:var(--green-bg); color:var(--green); }
.branch.remote { background:var(--blue-bg); color:var(--blue); }
.spacer { flex:1; }
.progress { font-size:11px; color:var(--text2); font-family:-apple-system,sans-serif; }
.btn { 
    padding:5px 12px; 
    border:1px solid var(--border); 
    border-radius:4px; 
    background:var(--bg3); 
    color:var(--text); 
    cursor:pointer; 
    font-size:11px; 
    font-family:-apple-system,sans-serif; 
}
.btn:hover { background:var(--border); }
.btn.primary { background:var(--green); color:#0d1117; border-color:var(--green); font-weight:600; }
.btn.primary:disabled { background:var(--bg3); color:var(--text2); border-color:var(--border); }

.col-headers { 
    display:flex; 
    background:var(--bg2); 
    border-bottom:1px solid var(--border); 
    font-size:11px; 
    font-weight:600; 
    text-transform:uppercase; 
    letter-spacing:0.5px;
    flex-shrink:0;
}
.col-header { 
    flex:1; 
    padding:8px 12px; 
    display:flex; 
    align-items:center; 
    gap:6px; 
    border-right:1px solid var(--border); 
}
.col-header:last-child { border-right:none; }
.col-header.local { color:var(--green); background:var(--green-bg); }
.col-header.result { color:var(--purple); }
.col-header.remote { color:var(--blue); background:var(--blue-bg); }
.col-gutter { width:50px; text-align:center; color:var(--text2); }

.content { flex:1; overflow:auto; }

.row { 
    display:flex; 
    border-bottom:1px solid var(--border); 
    min-height:24px;
}
.gutter { 
    width:50px; 
    min-width:50px;
    padding:0 8px; 
    text-align:right; 
    color:var(--text2); 
    background:var(--bg2); 
    border-right:1px solid var(--border); 
    font-size:11px; 
    line-height:24px;
    user-select:none;
}
.code { 
    flex:1; 
    border-right:1px solid var(--border);
    min-width:0;
    overflow-x:auto;
}
.code:last-child { border-right:none; }
.code pre { 
    margin:0; 
    padding:0 12px; 
    line-height:24px; 
    white-space:pre; 
    min-height:24px;
}
.code.local { background:var(--bg); }
.code.result { background:var(--bg); }
.code.remote { background:var(--bg); }

.row.conflict .code.local { background:var(--red-line); border-left:3px solid var(--red); }
.row.conflict .code.remote { background:var(--green-line); border-left:3px solid var(--green); }
.row.conflict .code.result { background:var(--bg3); }
.row.resolved .code.result { background:var(--green-bg); border-left:3px solid var(--green); }
.row.resolved .code.local, .row.resolved .code.remote { opacity:0.5; }

.code pre .del { 
    background:var(--red-bg); 
    color:var(--red);
    padding:1px 2px;
    border-radius:2px;
    text-decoration:line-through;
}
.code pre .add { 
    background:var(--green-bg); 
    color:var(--green);
    padding:1px 2px;
    border-radius:2px;
}

.conflict-header {
    display:flex;
    background:var(--bg3);
    border-bottom:1px solid var(--border);
    padding:6px 12px;
    gap:12px;
}
.conflict-actions { display:flex; gap:6px; }
.conflict-actions.local { flex:1; justify-content:flex-start; padding-left:50px; }
.conflict-actions.remote { flex:1; justify-content:flex-end; padding-right:12px; }
.conflict-info { display:flex; align-items:center; gap:8px; }
.conflict-badge { 
    font-size:11px; 
    font-weight:600; 
    color:var(--yellow);
    padding:2px 8px;
    background:rgba(210, 153, 34, 0.15);
    border-radius:4px;
}
.conflict-badge.resolved { color:var(--green); background:var(--green-bg); }

.act-btn {
    padding:4px 10px;
    border:1px solid var(--border);
    border-radius:4px;
    background:var(--bg2);
    cursor:pointer;
    font-size:11px;
    font-weight:500;
    color:var(--text);
    font-family:-apple-system,sans-serif;
}
.act-btn:hover { background:var(--border); }
.act-btn.accept-local { color:var(--green); border-color:var(--green); background:var(--green-bg); }
.act-btn.accept-remote { color:var(--blue); border-color:var(--blue); background:var(--blue-bg); }
.act-btn.both { color:var(--purple); border-color:var(--purple); }
.act-btn.ai { color:var(--purple); }

.footer {
    display:flex;
    padding:10px 16px;
    background:var(--bg2);
    border-top:1px solid var(--border);
    gap:8px;
    justify-content:flex-end;
    flex-shrink:0;
}
</style>
</head>
<body>
    <div class="header">
        <button class="btn" onclick="backToList()">← Back</button>
        <h1>${this.esc(file.name)}</h1>
        <span class="branch local">${this.esc(this.currentBranch)}</span>
        <span style="color:var(--text2)">vs</span>
        <span class="branch remote">${this.esc(this.incomingBranch)}</span>
        <span class="spacer"></span>
        <span class="progress">${resolvedCount}/${conflicts.length} resolved</span>
        <button class="btn" onclick="undo()">↩ Undo</button>
    </div>
    
    <div class="col-headers">
        <div class="col-gutter">#</div>
        <div class="col-header local">Local (${this.esc(this.currentBranch)})</div>
        <div class="col-gutter">#</div>
        <div class="col-header result">Result</div>
        <div class="col-gutter">#</div>
        <div class="col-header remote">Remote (${this.esc(this.incomingBranch)})</div>
    </div>
    
    <div class="content">${rowsHtml}</div>
    
    <div class="footer">
        <button class="btn" onclick="abort()">Cancel</button>
        <button class="btn primary" onclick="apply()" ${allResolved ? '' : 'disabled'}>
            ${allResolved ? '✓ Apply & Stage' : `${conflicts.length - resolvedCount} remaining`}
        </button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const backToList = () => vscode.postMessage({cmd:'backToList'});
        const acceptConflict = (id,side) => vscode.postMessage({cmd:'acceptConflict',conflictId:id,side});
        const aiMerge = id => vscode.postMessage({cmd:'aiMerge',conflictId:id});
        const undo = () => vscode.postMessage({cmd:'undo'});
        const apply = () => vscode.postMessage({cmd:'apply'});
        const abort = () => vscode.postMessage({cmd:'abort'});
        
        document.addEventListener('keydown', e => {
            if ((e.metaKey||e.ctrlKey) && e.key==='z') { e.preventDefault(); undo(); }
        });
    </script>
</body>
</html>`;
    }

    private esc(s: string): string {
        return s ? s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c)) : '';
    }

    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }
}
