import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GitService } from '../utils/GitService';

interface DiffHunk {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: DiffLine[];
}

interface DiffLine {
    oldLineNum: number | null;
    newLineNum: number | null;
    content: string;
    type: 'context' | 'add' | 'del';
}

interface FileDiff {
    path: string;
    absolutePath: string;
    status: 'added' | 'deleted' | 'modified';
    hunks: DiffHunk[];
    additions: number;
    deletions: number;
    branchContent: string;  // Content from other branch
    currentContent: string; // Current working directory content
}

export class CompareBranchPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | null = null;
    private currentBranch: string = '';
    private compareBranch: string = '';
    private diffs: FileDiff[] = [];
    private currentFileIndex: number = -1;
    private repoPath: string = '';
    private singleFilePath: string = '';

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) {}

    async show(): Promise<void> {
        const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
        this.singleFilePath = activeFile || '';
        
        if (activeFile) {
            this.repoPath = await this.gitService.getRepoForFile(activeFile);
        }
        
        if (!this.repoPath) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                this.repoPath = await this.gitService.getRepoForFile(workspaceFolders[0].uri.fsPath);
            }
        }
        
        console.log('GitForge Compare: Using repo:', this.repoPath);
        console.log('GitForge Compare: Single file:', this.singleFilePath);
        
        if (!this.repoPath) {
            vscode.window.showErrorMessage('GitForge: No git repository found');
            return;
        }
        
        const branches = await this.gitService.getAllBranchesForRepo(this.repoPath);
        if (!branches) {
            vscode.window.showErrorMessage('GitForge: Could not get branches');
            return;
        }

        this.currentBranch = branches.current;
        console.log('GitForge Compare: Current branch:', this.currentBranch);
        
        const allBranches = [...branches.local, ...branches.remote];
        const branchNames = allBranches.filter(b => b !== branches.current);
        
        if (branchNames.length === 0) {
            vscode.window.showInformationMessage('GitForge: No other branches to compare');
            return;
        }

        const fileName = this.singleFilePath ? path.basename(this.singleFilePath) : 'working directory';
        const selected = await vscode.window.showQuickPick(branchNames, {
            placeHolder: `Compare "${fileName}" with...`,
            title: 'Select Branch to Compare'
        });

        if (!selected) return;
        
        this.compareBranch = selected;
        console.log('GitForge Compare: Comparing with:', this.compareBranch);
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Comparing with ${this.compareBranch}...`,
            cancellable: false
        }, async () => {
            await this.loadDiff();
        });
        
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'gitforgeCompareBranch',
                `Compare: ${this.currentBranch} ↔ ${this.compareBranch}`,
                { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
                { enableScripts: true, retainContextWhenHidden: true }
            );

            this.panel.onDidDispose(() => { this.panel = null; });
            this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
        }

        const titleFileName = this.singleFilePath ? path.basename(this.singleFilePath) : 'branches';
        this.panel.title = `Compare: ${titleFileName} (${this.currentBranch} ↔ ${this.compareBranch})`;
        
        if (this.singleFilePath && this.diffs.length === 1) {
            this.currentFileIndex = 0;
        } else {
            this.currentFileIndex = -1;
        }
        
        this.updatePanel();
        this.panel.reveal();
    }

    private async loadDiff(): Promise<void> {
        this.diffs = [];
        
        console.log('GitForge Compare: Loading diff for repo:', this.repoPath);
        
        let diffOutput: string | null;
        
        if (this.singleFilePath) {
            diffOutput = await this.gitService.getDiffForFileForRepo(
                this.repoPath,
                this.singleFilePath,
                this.currentBranch,
                this.compareBranch
            );
        } else {
            diffOutput = await this.gitService.getDiffWorkingDirForRepo(
                this.repoPath, 
                this.compareBranch
            );
        }
        
        console.log('GitForge Compare: Raw diff output length:', diffOutput?.length || 0);
        
        if (!diffOutput || diffOutput.trim() === '') {
            console.log('GitForge Compare: No diff output, files may be identical');
            return;
        }

        this.diffs = await this.parseDiffOutput(diffOutput);
        console.log('GitForge Compare: Parsed', this.diffs.length, 'files');
    }

    private async parseDiffOutput(output: string): Promise<FileDiff[]> {
        const files: FileDiff[] = [];
        const fileSections = output.split(/(?=^diff --git )/m);
        
        for (const section of fileSections) {
            if (!section.trim() || !section.startsWith('diff --git')) continue;
            
            const lines = section.split('\n');
            const headerLine = lines[0] || '';
            const pathMatch = headerLine.match(/diff --git a\/(.+?) b\/(.+)/);
            if (!pathMatch) continue;
            
            const filePath = pathMatch[2];
            const absolutePath = path.join(this.repoPath, filePath);
            let status: 'added' | 'deleted' | 'modified' = 'modified';
            
            if (section.includes('new file mode')) {
                status = 'added';
            } else if (section.includes('deleted file mode')) {
                status = 'deleted';
            }

            const hunks: DiffHunk[] = [];
            let additions = 0;
            let deletions = 0;
            let currentHunk: DiffHunk | null = null;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                
                const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
                if (hunkMatch) {
                    if (currentHunk) {
                        hunks.push(currentHunk);
                    }
                    currentHunk = {
                        oldStart: parseInt(hunkMatch[1], 10),
                        oldCount: parseInt(hunkMatch[2] || '1', 10),
                        newStart: parseInt(hunkMatch[3], 10),
                        newCount: parseInt(hunkMatch[4] || '1', 10),
                        lines: []
                    };
                    continue;
                }
                
                if (!currentHunk) continue;
                
                let oldLine = currentHunk.oldStart + currentHunk.lines.filter(l => l.type !== 'add').length;
                let newLine = currentHunk.newStart + currentHunk.lines.filter(l => l.type !== 'del').length;
                
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    currentHunk.lines.push({
                        oldLineNum: null,
                        newLineNum: newLine,
                        content: line.substring(1),
                        type: 'add'
                    });
                    additions++;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    currentHunk.lines.push({
                        oldLineNum: oldLine,
                        newLineNum: null,
                        content: line.substring(1),
                        type: 'del'
                    });
                    deletions++;
                } else if (line.startsWith(' ')) {
                    currentHunk.lines.push({
                        oldLineNum: oldLine,
                        newLineNum: newLine,
                        content: line.substring(1),
                        type: 'context'
                    });
                }
            }

            if (currentHunk) {
                hunks.push(currentHunk);
            }

            // Get file contents
            let branchContent = '';
            let currentContent = '';
            
            try {
                branchContent = await this.gitService.getFileFromBranch(this.repoPath, filePath, this.compareBranch) || '';
            } catch { branchContent = ''; }
            
            try {
                if (fs.existsSync(absolutePath)) {
                    currentContent = fs.readFileSync(absolutePath, 'utf-8');
                }
            } catch { currentContent = ''; }

            if (hunks.length > 0) {
                files.push({ 
                    path: filePath, 
                    absolutePath,
                    status, 
                    hunks, 
                    additions, 
                    deletions,
                    branchContent,
                    currentContent
                });
            }
        }
        
        return files;
    }

    private async handleMessage(msg: any): Promise<void> {
        switch (msg.cmd) {
            case 'openFile':
                this.currentFileIndex = msg.idx;
                this.updatePanel();
                break;
            case 'backToList':
                this.currentFileIndex = -1;
                this.updatePanel();
                break;
            case 'revertHunk':
                await this.revertHunk(msg.fileIdx, msg.hunkIdx);
                break;
            case 'revertLine':
                await this.revertLine(msg.fileIdx, msg.hunkIdx, msg.lineIdx);
                break;
            case 'revertAll':
                await this.revertAllChanges(msg.fileIdx);
                break;
            case 'openInEditor':
                await this.openFileInEditor(msg.fileIdx);
                break;
            case 'close':
                this.dispose();
                break;
        }
    }

    private async revertHunk(fileIdx: number, hunkIdx: number): Promise<void> {
        const file = this.diffs[fileIdx];
        if (!file) return;
        
        const hunk = file.hunks[hunkIdx];
        if (!hunk) return;

        try {
            let currentLines = file.currentContent.split('\n');
            const branchLines = file.branchContent.split('\n');
            
            // Get the lines to replace from the branch version
            const startLine = hunk.newStart - 1;
            const linesToRemove = hunk.lines.filter(l => l.type === 'add').length;
            const linesToAdd = hunk.lines.filter(l => l.type !== 'add').map(l => l.content);
            
            // Replace the lines
            currentLines.splice(startLine, linesToRemove + hunk.lines.filter(l => l.type === 'context').length, ...linesToAdd);
            
            fs.writeFileSync(file.absolutePath, currentLines.join('\n'));
            
            vscode.window.showInformationMessage(`Reverted hunk ${hunkIdx + 1} in ${path.basename(file.path)}`);
            
            // Reload diff
            await this.loadDiff();
            this.updatePanel();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to revert: ${error}`);
        }
    }

    private async revertLine(fileIdx: number, hunkIdx: number, lineIdx: number): Promise<void> {
        const file = this.diffs[fileIdx];
        if (!file) return;
        
        const hunk = file.hunks[hunkIdx];
        if (!hunk) return;

        const line = hunk.lines[lineIdx];
        if (!line) return;

        try {
            let currentLines = file.currentContent.split('\n');
            
            if (line.type === 'add') {
                // Remove this added line
                if (line.newLineNum !== null) {
                    currentLines.splice(line.newLineNum - 1, 1);
                }
            } else if (line.type === 'del') {
                // Restore this deleted line
                if (line.oldLineNum !== null) {
                    // Find where to insert it
                    let insertAt = line.oldLineNum - 1;
                    // Adjust for previous changes in this hunk
                    const previousAdds = hunk.lines.slice(0, lineIdx).filter(l => l.type === 'add').length;
                    const previousDels = hunk.lines.slice(0, lineIdx).filter(l => l.type === 'del').length;
                    insertAt = insertAt + previousAdds - previousDels;
                    
                    currentLines.splice(insertAt, 0, line.content);
                }
            }
            
            fs.writeFileSync(file.absolutePath, currentLines.join('\n'));
            
            vscode.window.showInformationMessage(`Reverted line in ${path.basename(file.path)}`);
            
            // Reload diff
            await this.loadDiff();
            this.updatePanel();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to revert line: ${error}`);
        }
    }

    private async revertAllChanges(fileIdx: number): Promise<void> {
        const file = this.diffs[fileIdx];
        if (!file) return;

        const confirm = await vscode.window.showWarningMessage(
            `Revert ALL changes in ${path.basename(file.path)} to match ${this.compareBranch}?`,
            { modal: true },
            'Revert All'
        );

        if (confirm !== 'Revert All') return;

        try {
            fs.writeFileSync(file.absolutePath, file.branchContent);
            vscode.window.showInformationMessage(`Reverted ${path.basename(file.path)} to ${this.compareBranch} version`);
            
            // Reload diff
            await this.loadDiff();
            if (this.diffs.length === 0) {
                this.currentFileIndex = -1;
            }
            this.updatePanel();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to revert: ${error}`);
        }
    }

    private async openFileInEditor(fileIdx: number): Promise<void> {
        const file = this.diffs[fileIdx];
        if (!file) return;
        
        const doc = await vscode.workspace.openTextDocument(file.absolutePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    private updatePanel(): void {
        if (!this.panel) return;
        
        if (this.currentFileIndex === -1) {
            this.panel.webview.html = this.getFileListHtml();
        } else {
            this.panel.webview.html = this.getSideBySideDiffHtml();
        }
    }

    private getFileListHtml(): string {
        const statusIcon = (s: string) => s === 'added' ? '➕' : s === 'deleted' ? '➖' : '📝';
        const statusColor = (s: string) => s === 'added' ? 'add' : s === 'deleted' ? 'del' : 'mod';
        
        const totalAdditions = this.diffs.reduce((sum, f) => sum + f.additions, 0);
        const totalDeletions = this.diffs.reduce((sum, f) => sum + f.deletions, 0);
        
        const filesHtml = this.diffs.map((f, i) => `
            <div class="file-row" onclick="openFile(${i})">
                <span class="status-icon ${statusColor(f.status)}">${statusIcon(f.status)}</span>
                <div class="file-info">
                    <span class="file-name">${this.esc(path.basename(f.path))}</span>
                    <span class="file-path">${this.esc(f.path)}</span>
                </div>
                <div class="file-stats">
                    <span class="stat-add">+${f.additions}</span>
                    <span class="stat-del">-${f.deletions}</span>
                </div>
                <button class="btn-action" onclick="event.stopPropagation();revertAll(${i})" title="Revert all changes">
                    ↩ Revert
                </button>
            </div>
        `).join('');

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${this.getBaseStyles()}
.file-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: border-color 0.15s;
}
.file-row:hover { border-color: var(--vscode-focusBorder); }
.status-icon { font-size: 16px; }
.status-icon.add { color: var(--vscode-gitDecoration-addedResourceForeground); }
.status-icon.del { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.status-icon.mod { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
.file-info { flex: 1; min-width: 0; }
.file-name { font-weight: 600; font-size: 13px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-path { color: var(--vscode-descriptionForeground); font-size: 11px; font-family: monospace; display: block; }
.file-stats { display: flex; gap: 8px; font-size: 12px; font-family: monospace; }
.stat-add { color: var(--vscode-gitDecoration-addedResourceForeground); }
.stat-del { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.btn-action {
    padding: 4px 12px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}
.btn-action:hover { background: var(--vscode-button-secondaryHoverBackground); }
.empty { text-align: center; padding: 60px; color: var(--vscode-descriptionForeground); font-size: 14px; }
</style>
</head>
<body>
    <div class="header">
        <h1>Compare with Branch</h1>
        <span class="branch current">Current: ${this.esc(this.currentBranch)}</span>
        <span style="color: var(--vscode-descriptionForeground)">↔</span>
        <span class="branch compare">${this.esc(this.compareBranch)}</span>
        <button class="btn-close" onclick="close()">✕ Close</button>
    </div>
    <div class="stats">
        <span class="stat"><strong>${this.diffs.length}</strong> files changed</span>
        <span class="stat add"><strong>+${totalAdditions}</strong> additions</span>
        <span class="stat del"><strong>-${totalDeletions}</strong> deletions</span>
    </div>
    <div class="content">
        ${filesHtml || '<div class="empty">✓ No differences between branches</div>'}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const openFile = i => vscode.postMessage({cmd:'openFile',idx:i});
        const revertAll = i => vscode.postMessage({cmd:'revertAll',fileIdx:i});
        const close = () => vscode.postMessage({cmd:'close'});
    </script>
</body>
</html>`;
    }

    private getSideBySideDiffHtml(): string {
        const file = this.diffs[this.currentFileIndex];
        if (!file) return '';

        // Build side-by-side view
        let leftHtml = '';
        let rightHtml = '';
        
        // Split files into lines
        const branchLines = file.branchContent.split('\n');
        const currentLines = file.currentContent.split('\n');
        
        // Track which lines have changes
        const changedLineNums = new Set<number>();
        const deletedLineNums = new Set<number>();
        
        for (const hunk of file.hunks) {
            for (const line of hunk.lines) {
                if (line.type === 'add' && line.newLineNum !== null) {
                    changedLineNums.add(line.newLineNum);
                }
                if (line.type === 'del' && line.oldLineNum !== null) {
                    deletedLineNums.add(line.oldLineNum);
                }
            }
        }

        // Build the hunks view with side-by-side diff
        let diffHtml = '';
        let hunkIdx = 0;
        
        for (const hunk of file.hunks) {
            const currentHunkIdx = hunkIdx;
            diffHtml += `
                <div class="hunk-header">
                    <span>@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@</span>
                    <button class="revert-hunk-btn" onclick="revertHunk(${this.currentFileIndex}, ${currentHunkIdx})" title="Revert this entire change block">
                        ↩ Revert Block
                    </button>
                </div>
                <div class="hunk-content">`;
            
            let lineIdx = 0;
            for (const line of hunk.lines) {
                const currentLineIdx = lineIdx;
                const canRevert = line.type !== 'context';
                
                if (line.type === 'del') {
                    // Deleted line - show on left (branch) side only
                    diffHtml += `
                        <div class="diff-row del">
                            <div class="line-num">${line.oldLineNum || ''}</div>
                            <div class="line-content left"><pre>${this.esc(line.content)}</pre></div>
                            <div class="line-actions">
                                ${canRevert ? `<button class="revert-btn" onclick="revertLine(${this.currentFileIndex}, ${currentHunkIdx}, ${currentLineIdx})" title="Restore this line">→</button>` : ''}
                            </div>
                            <div class="line-num empty"></div>
                            <div class="line-content right empty"></div>
                        </div>`;
                } else if (line.type === 'add') {
                    // Added line - show on right (current) side only  
                    diffHtml += `
                        <div class="diff-row add">
                            <div class="line-num empty"></div>
                            <div class="line-content left empty"></div>
                            <div class="line-actions">
                                ${canRevert ? `<button class="revert-btn del" onclick="revertLine(${this.currentFileIndex}, ${currentHunkIdx}, ${currentLineIdx})" title="Remove this line">←</button>` : ''}
                            </div>
                            <div class="line-num">${line.newLineNum || ''}</div>
                            <div class="line-content right"><pre>${this.esc(line.content)}</pre></div>
                        </div>`;
                } else {
                    // Context line - show on both sides
                    diffHtml += `
                        <div class="diff-row context">
                            <div class="line-num">${line.oldLineNum || ''}</div>
                            <div class="line-content left"><pre>${this.esc(line.content)}</pre></div>
                            <div class="line-actions"></div>
                            <div class="line-num">${line.newLineNum || ''}</div>
                            <div class="line-content right"><pre>${this.esc(line.content)}</pre></div>
                        </div>`;
                }
                lineIdx++;
            }
            
            diffHtml += '</div>';
            hunkIdx++;
        }

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
${this.getBaseStyles()}
.diff-header {
    display: flex;
    gap: 0;
    background: var(--vscode-editorGroupHeader-tabsBackground);
    border-bottom: 1px solid var(--vscode-panel-border);
}
.diff-header-col {
    flex: 1;
    padding: 8px 16px;
    font-weight: 600;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.diff-header-col.left { 
    border-right: 1px solid var(--vscode-panel-border);
    color: var(--vscode-gitDecoration-deletedResourceForeground);
}
.diff-header-col.right { 
    color: var(--vscode-gitDecoration-addedResourceForeground);
}
.diff-header-col .tag {
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
}
.diff-header-col.left .tag { background: rgba(248, 81, 73, 0.2); }
.diff-header-col.right .tag { background: rgba(63, 185, 80, 0.2); }

.hunk-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--vscode-diffEditor-insertedLineBackground);
    color: var(--vscode-textLink-foreground);
    font-size: 12px;
    font-family: monospace;
    border-top: 1px solid var(--vscode-panel-border);
}
.revert-hunk-btn {
    padding: 4px 10px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
}
.revert-hunk-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

.hunk-content { font-family: 'SF Mono', Consolas, monospace; font-size: 13px; }

.diff-row {
    display: flex;
    min-height: 24px;
    border-bottom: 1px solid var(--vscode-editorWidget-border);
}
.diff-row.del .line-content.left { background: var(--vscode-diffEditor-removedLineBackground); }
.diff-row.add .line-content.right { background: var(--vscode-diffEditor-insertedLineBackground); }
.diff-row .line-content.empty { background: var(--vscode-editor-background); }

.line-num {
    width: 45px;
    min-width: 45px;
    padding: 0 8px;
    text-align: right;
    color: var(--vscode-editorLineNumber-foreground);
    background: var(--vscode-editorGutter-background);
    font-size: 11px;
    line-height: 24px;
    user-select: none;
}
.line-num.empty { background: var(--vscode-editor-background); }

.line-content {
    flex: 1;
    overflow-x: auto;
    position: relative;
}
.line-content pre {
    margin: 0;
    padding: 0 12px;
    line-height: 24px;
    white-space: pre;
}

.line-actions {
    width: 40px;
    min-width: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--vscode-editorGutter-background);
    border-left: 1px solid var(--vscode-panel-border);
    border-right: 1px solid var(--vscode-panel-border);
}

.revert-btn {
    width: 24px;
    height: 20px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
}
.revert-btn:hover { background: var(--vscode-button-hoverBackground); }
.revert-btn.del {
    background: var(--vscode-inputValidation-errorBackground);
    color: var(--vscode-inputValidation-errorForeground);
}

.actions-bar {
    display: flex;
    gap: 12px;
    padding: 8px 16px;
    background: var(--vscode-editorGroupHeader-tabsBackground);
    border-bottom: 1px solid var(--vscode-panel-border);
}
.btn-revert-all {
    padding: 6px 16px;
    background: var(--vscode-inputValidation-warningBackground);
    color: var(--vscode-inputValidation-warningForeground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
}
.btn-revert-all:hover { filter: brightness(1.1); }
</style>
</head>
<body>
    <div class="header">
        <button class="btn" onclick="backToList()">← Back</button>
        <h1>${this.esc(file.path)}</h1>
        <div class="file-stats">
            <span class="stat-add">+${file.additions}</span>
            <span class="stat-del">-${file.deletions}</span>
        </div>
        <button class="btn" onclick="openInEditor(${this.currentFileIndex})">📝 Open File</button>
    </div>
    <div class="actions-bar">
        <button class="btn-revert-all" onclick="revertAll(${this.currentFileIndex})">↩ Revert All Changes to ${this.esc(this.compareBranch)}</button>
    </div>
    <div class="diff-header">
        <div class="diff-header-col left">
            <span class="tag">${this.esc(this.compareBranch)}</span>
            <span>Other Branch</span>
        </div>
        <div class="diff-header-col right">
            <span class="tag">Current</span>
            <span>Your Working Directory</span>
        </div>
    </div>
    <div class="content">
        ${diffHtml || '<div class="empty">No changes in this file</div>'}
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const backToList = () => vscode.postMessage({cmd:'backToList'});
        const revertHunk = (f,h) => vscode.postMessage({cmd:'revertHunk',fileIdx:f,hunkIdx:h});
        const revertLine = (f,h,l) => vscode.postMessage({cmd:'revertLine',fileIdx:f,hunkIdx:h,lineIdx:l});
        const revertAll = (f) => vscode.postMessage({cmd:'revertAll',fileIdx:f});
        const openInEditor = (f) => vscode.postMessage({cmd:'openInEditor',fileIdx:f});
        const close = () => vscode.postMessage({cmd:'close'});
    </script>
</body>
</html>`;
    }

    private getBaseStyles(): string {
        return `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    height: 100vh;
    display: flex;
    flex-direction: column;
}
.header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: var(--vscode-editorGroupHeader-tabsBackground);
    border-bottom: 1px solid var(--vscode-panel-border);
    gap: 12px;
    flex-shrink: 0;
}
.header h1 { 
    font-size: 13px; 
    flex: 1; 
    overflow: hidden; 
    text-overflow: ellipsis; 
    white-space: nowrap; 
}
.branch {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
}
.branch.current { 
    background: rgba(63, 185, 80, 0.15); 
    color: var(--vscode-gitDecoration-addedResourceForeground); 
}
.branch.compare { 
    background: rgba(88, 166, 255, 0.15); 
    color: var(--vscode-textLink-foreground); 
}
.btn, .btn-close {
    padding: 5px 12px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    cursor: pointer;
    font-size: 11px;
}
.btn:hover, .btn-close:hover { background: var(--vscode-button-secondaryHoverBackground); }
.stats { 
    padding: 12px 16px; 
    background: var(--vscode-sideBar-background); 
    border-bottom: 1px solid var(--vscode-panel-border); 
    display: flex; 
    gap: 24px; 
    font-size: 13px; 
}
.stat { display: flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); }
.stat strong { color: var(--vscode-editor-foreground); }
.stat.add strong { color: var(--vscode-gitDecoration-addedResourceForeground); }
.stat.del strong { color: var(--vscode-gitDecoration-deletedResourceForeground); }
.content { flex: 1; overflow: auto; }
.file-stats { display: flex; gap: 12px; font-size: 12px; }
.stat-add { color: var(--vscode-gitDecoration-addedResourceForeground); }
.stat-del { color: var(--vscode-gitDecoration-deletedResourceForeground); }
`;
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
