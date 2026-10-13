import * as vscode from 'vscode';
import * as path from 'path';
import { BlameInfo } from '../utils/GitService';
import { formatBlameLine, formatRelativeDate } from '../utils/dateUtils';

export class BlameDecorationProvider implements vscode.Disposable {
    private gutterDecorationType: vscode.TextEditorDecorationType;
    private currentLineDecorationType: vscode.TextEditorDecorationType;
    private hoverDecorationType: vscode.TextEditorDecorationType;
    private blameData: Map<string, BlameInfo[]> = new Map();
    private currentEditor: vscode.TextEditor | null = null;
    private currentLine: number = -1;

    constructor() {
        // Subtle gutter indicator - a small git icon
        this.gutterDecorationType = vscode.window.createTextEditorDecorationType({
            gutterIconPath: path.join(__dirname, '..', '..', 'resources', 'git-dot.svg'),
            gutterIconSize: '60%',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
        });

        // Current line highlight with inline blame
        this.currentLineDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                color: new vscode.ThemeColor('gitforge.blameForeground'),
                margin: '0 0 0 2em',
                fontStyle: 'italic'
            },
            backgroundColor: new vscode.ThemeColor('gitforge.blameBackground'),
            isWholeLine: true,
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen
        });

        // Hover decoration for highlighted state
        this.hoverDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(100, 100, 100, 0.1)',
            isWholeLine: true
        });
    }

    updateDecorations(editor: vscode.TextEditor, blameData: BlameInfo[]): void {
        this.currentEditor = editor;
        const filePath = editor.document.uri.fsPath;
        this.blameData.set(filePath, blameData);

        // Group by commit for gutter icons (show on first line of each commit group)
        const commitGroups = this.groupByCommit(blameData);
        const gutterDecorations: vscode.DecorationOptions[] = [];

        for (const group of commitGroups) {
            const firstBlame = group[0];
            const line = firstBlame.line - 1;
            
            if (line < 0 || line >= editor.document.lineCount) continue;

            const range = new vscode.Range(line, 0, line, 0);
            
            gutterDecorations.push({
                range,
                hoverMessage: this.createHoverMessage(firstBlame, group.length)
            });
        }

        editor.setDecorations(this.gutterDecorationType, gutterDecorations);
    }

    showCurrentLineBlame(editor: vscode.TextEditor, line: number): void {
        this.currentLine = line;
        const filePath = editor.document.uri.fsPath;
        const blameData = this.blameData.get(filePath);
        
        if (!blameData) {
            editor.setDecorations(this.currentLineDecorationType, []);
            return;
        }

        const lineBlame = blameData.find(b => b.line === line + 1);
        if (!lineBlame) {
            editor.setDecorations(this.currentLineDecorationType, []);
            return;
        }

        const lineLength = editor.document.lineAt(line).text.length;
        const range = new vscode.Range(line, lineLength, line, lineLength);

        const format = vscode.workspace.getConfiguration('gitforge').get<string>('blame.format') || '{author}, {age}';
        const text = formatBlameLine(format, lineBlame.author, lineBlame.date, lineBlame.summary, lineBlame.hash);

        const decoration: vscode.DecorationOptions = {
            range,
            renderOptions: {
                after: {
                    contentText: `  ${text}`,
                    color: new vscode.ThemeColor('gitforge.blameForeground'),
                    fontStyle: 'italic',
                    margin: '0 0 0 2em'
                }
            }
        };

        editor.setDecorations(this.currentLineDecorationType, [decoration]);
    }

    showSpecificBlame(editor: vscode.TextEditor, line: number, blame: BlameInfo, label: string): void {
        if (line < 0 || line >= editor.document.lineCount) return;
        const lineLength = editor.document.lineAt(line).text.length;
        const range = new vscode.Range(line, lineLength, line, lineLength);
        const format = vscode.workspace.getConfiguration('gitforge').get<string>('blame.format') || '{author}, {age}';
        const text = formatBlameLine(format, blame.author, blame.date, blame.summary, blame.hash);
        editor.setDecorations(this.currentLineDecorationType, [{
            range,
            renderOptions: {
                after: {
                    contentText: `  ${label} ${text}`,
                    color: new vscode.ThemeColor('gitforge.blameForeground'),
                    fontStyle: 'italic',
                    margin: '0 0 0 2em'
                }
            }
        }]);
    }

    highlightLine(editor: vscode.TextEditor, line: number): void {
        // Just show the current line blame
        this.showCurrentLineBlame(editor, line);
    }

    clearDecorations(): void {
        const editors = vscode.window.visibleTextEditors;
        for (const editor of editors) {
            editor.setDecorations(this.gutterDecorationType, []);
            editor.setDecorations(this.currentLineDecorationType, []);
            editor.setDecorations(this.hoverDecorationType, []);
        }
    }

    getBlameForLine(filePath: string, line: number): BlameInfo | undefined {
        const blameData = this.blameData.get(filePath);
        if (!blameData) return undefined;
        return blameData.find(b => b.line === line + 1);
    }

    private groupByCommit(blameData: BlameInfo[]): BlameInfo[][] {
        const groups: BlameInfo[][] = [];
        let currentGroup: BlameInfo[] = [];
        let currentHash = '';

        for (const blame of blameData) {
            if (blame.hash !== currentHash) {
                if (currentGroup.length > 0) {
                    groups.push(currentGroup);
                }
                currentGroup = [blame];
                currentHash = blame.hash;
            } else {
                currentGroup.push(blame);
            }
        }

        if (currentGroup.length > 0) {
            groups.push(currentGroup);
        }

        return groups;
    }

    private createHoverMessage(blame: BlameInfo, groupSize: number): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        const relativeDate = formatRelativeDate(blame.date);
        const shortHash = blame.hash.substring(0, 8);

        // Header with commit summary
        md.appendMarkdown(`### $(git-commit) ${this.escapeMarkdown(blame.summary)}\n\n`);
        
        // Author info
        md.appendMarkdown(`$(person) **${this.escapeMarkdown(blame.author)}**`);
        if (blame.authorEmail) {
            md.appendMarkdown(` (${blame.authorEmail})`);
        }
        md.appendMarkdown('\n\n');

        // Date and time
        md.appendMarkdown(`$(calendar) ${relativeDate} — ${blame.date.toLocaleDateString()} at ${blame.date.toLocaleTimeString()}\n\n`);

        // Commit hash
        md.appendMarkdown(`$(git-commit) \`${shortHash}\`\n\n`);

        // Lines affected
        if (groupSize > 1) {
            md.appendMarkdown(`$(list-ordered) ${groupSize} lines from this commit\n\n`);
        }

        // Separator
        md.appendMarkdown('---\n\n');

        // Actions
        md.appendMarkdown(`[$(history) Show History](command:gitforge.showLineHistory "View all commits for this line")`);
        md.appendMarkdown(` | `);
        md.appendMarkdown(`[$(diff) Show Changes](command:gitforge.showCommitChanges?${encodeURIComponent(JSON.stringify({hash: blame.hash}))} "View changes in this commit")`);
        md.appendMarkdown(` | `);
        md.appendMarkdown(`[$(clippy) Copy Hash](command:gitforge.copyCommitHash?${encodeURIComponent(JSON.stringify({hash: blame.hash}))} "Copy commit hash to clipboard")`);

        return md;
    }

    private escapeMarkdown(text: string): string {
        return text.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
    }

    private truncateAuthor(author: string, maxLength: number): string {
        if (author.length <= maxLength) return author;
        return author.substring(0, maxLength - 1) + '…';
    }

    private truncateSummary(summary: string, maxLength: number): string {
        if (summary.length <= maxLength) return summary;
        return summary.substring(0, maxLength - 1) + '…';
    }

    dispose(): void {
        this.gutterDecorationType.dispose();
        this.currentLineDecorationType.dispose();
        this.hoverDecorationType.dispose();
    }
}
