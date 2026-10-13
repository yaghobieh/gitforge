import * as vscode from 'vscode';
import { GitService, BlameInfo } from '../utils/GitService';
import { BlameDecorationProvider } from './BlameDecorationProvider';
import { BlameHistoryProvider } from './BlameHistoryProvider';
import { formatRelativeDate } from '../utils/dateUtils';

interface LineCursor {
    file: string;
    line: number;
    items: BlameInfo[];
    index: number;
}

export class BlameController implements vscode.Disposable {
    private decorationProvider: BlameDecorationProvider;
    private historyProvider: BlameHistoryProvider;
    private enabled: boolean = false;
    private disposables: vscode.Disposable[] = [];
    private currentBlameData: Map<string, BlameInfo[]> = new Map();
    private hoverProvider: vscode.Disposable | null = null;
    private lineCursor: LineCursor | null = null;
    private lineStatus: vscode.StatusBarItem;

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) {
        this.decorationProvider = new BlameDecorationProvider();
        this.historyProvider = new BlameHistoryProvider(gitService);
        this.lineStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
        this.lineStatus.tooltip = 'GitForge line history. Older and newer are on the blame hover.';
        
        console.log('GitForge: BlameController initialized');
        
        // Watch for active editor changes
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (this.enabled && editor) {
                    this.updateBlameForEditor(editor);
                }
            })
        );

        // Watch for text document changes
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                if (this.enabled) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && editor.document === event.document) {
                        // Debounce the update
                        this.debouncedUpdate(editor);
                    }
                }
            })
        );

        // Watch for selection changes (for line click) - show blame for current line
        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection(event => {
                if (this.enabled && event.textEditor) {
                    const line = event.selections[0]?.active.line;
                    if (line !== undefined) {
                        this.decorationProvider.showCurrentLineBlame(event.textEditor, line);
                    }
                }
            })
        );

        // Auto-enable blame on startup (default behavior like WebStorm)
        // The config just controls if it stays on
        console.log('GitForge: Auto-enabling blame annotations');
        this.enable();
    }

    private updateDebounceTimer: NodeJS.Timeout | null = null;

    private debouncedUpdate(editor: vscode.TextEditor) {
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }
        this.updateDebounceTimer = setTimeout(() => {
            this.updateBlameForEditor(editor);
        }, 500);
    }

    async toggle(): Promise<void> {
        if (this.enabled) {
            this.disable();
        } else {
            this.enable();
        }
    }

    private enable(): void {
        this.enabled = true;
        this.registerHoverProvider();
        
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            this.updateBlameForEditor(editor);
        }
        
        vscode.window.showInformationMessage('GitForge: Blame annotations enabled');
    }

    private disable(): void {
        this.enabled = false;
        this.decorationProvider.clearDecorations();
        this.currentBlameData.clear();
        
        if (this.hoverProvider) {
            this.hoverProvider.dispose();
            this.hoverProvider = null;
        }
        
        vscode.window.showInformationMessage('GitForge: Blame annotations disabled');
    }

    private registerHoverProvider(): void {
        if (this.hoverProvider) {
            this.hoverProvider.dispose();
        }

        this.hoverProvider = vscode.languages.registerHoverProvider(
            { scheme: 'file' },
            {
                provideHover: (document, position) => {
                    return this.provideHover(document, position);
                }
            }
        );
    }

    private async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Hover | null> {
        const config = vscode.workspace.getConfiguration('gitforge');
        if (!config.get('blame.showOnHover')) {
            return null;
        }

        const blameData = this.currentBlameData.get(document.uri.fsPath);
        if (!blameData) return null;

        const lineBlame = blameData.find(b => b.line === position.line + 1);
        if (!lineBlame) return null;

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        const relativeDate = formatRelativeDate(lineBlame.date);
        
        markdown.appendMarkdown(`### $(git-commit) ${this.escapeMarkdown(lineBlame.summary)}\n\n`);
        markdown.appendMarkdown(`**Author:** ${this.escapeMarkdown(lineBlame.author)} (${lineBlame.authorEmail})\n\n`);
        markdown.appendMarkdown(`**Date:** ${relativeDate} (${lineBlame.date.toLocaleDateString()})\n\n`);
        markdown.appendMarkdown(`**Commit:** \`${lineBlame.hash.substring(0, 8)}\`\n\n`);
        markdown.appendMarkdown(`---\n\n`);
        const cursor = this.lineCursor;
        const onThisLine = cursor && cursor.file === document.uri.fsPath && cursor.line === position.line + 1;
        const shown = onThisLine ? cursor.items[cursor.index] : lineBlame;
        if (shown && shown.hash !== lineBlame.hash) {
            markdown.appendMarkdown(`\n\n**Showing:** \`${shown.hash.substring(0, 7)}\` ${this.escapeMarkdown(shown.summary)}\n\n`);
        }
        if (onThisLine) {
            markdown.appendMarkdown(`**Line history:** ${cursor.index + 1} of ${cursor.items.length}\n\n`);
        }
        markdown.appendMarkdown(`[$(history) Show History](command:gitforge.showLineHistory) | `);
        markdown.appendMarkdown(`[Older](command:gitforge.stepLineOlder) | `);
        markdown.appendMarkdown(`[Newer](command:gitforge.stepLineNewer) | `);
        markdown.appendMarkdown(`[$(git-commit) Open Commit](command:gitforge.showCommitDetails?${encodeURIComponent(JSON.stringify({ hash: (shown || lineBlame).hash }))})`);

        return new vscode.Hover(markdown);
    }

    private escapeMarkdown(text: string): string {
        return text.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&');
    }

    async updateBlameForEditor(editor: vscode.TextEditor): Promise<void> {
        if (!editor || editor.document.uri.scheme !== 'file') {
            return;
        }

        const filePath = editor.document.uri.fsPath;
        
        try {
            const blameData = await this.gitService.getBlameForFile(filePath);
            this.currentBlameData.set(filePath, blameData);
            this.decorationProvider.updateDecorations(editor, blameData);
        } catch (error) {
            console.error('GitForge: Error updating blame:', error);
        }
    }

    async copyCommitHash(hash: string): Promise<void> {
        await vscode.env.clipboard.writeText(hash);
        vscode.window.showInformationMessage(`Copied commit hash: ${hash}`);
    }

    async showCommitChanges(hash: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        
        try {
            // Use git show to display commit diff
            await vscode.commands.executeCommand('git.viewCommit', hash);
        } catch {
            vscode.window.showInformationMessage(`View commit ${hash.substring(0, 8)} in Git Graph or terminal: git show ${hash}`);
        }
    }

    async showLineHistory(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('GitForge: No active editor');
            return;
        }

        const line = editor.selection.active.line + 1;
        const filePath = editor.document.uri.fsPath;

        console.log('GitForge: Showing history for', filePath, 'line', line);

        const config = vscode.workspace.getConfiguration('gitforge');
        const maxDepth = config.get<number>('blame.maxHistoryDepth') || 100;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Loading history for line ${line}...`,
                cancellable: false
            },
            async () => {
                const history = await this.gitService.getLineHistory(filePath, line, maxDepth);
                console.log('GitForge: Got history with', history.length, 'entries');
                
                if (history.length === 0) {
                    vscode.window.showWarningMessage('GitForge: No history found for this line. It may be uncommitted or new.');
                    return;
                }
                
                this.historyProvider.setHistory(history);
                
                // Focus the history view
                await vscode.commands.executeCommand('gitforge.blameHistory.focus');
                
                vscode.window.showInformationMessage(`GitForge: Found ${history.length} commits for this line`);
            }
        );
    }

    getHistoryProvider(): BlameHistoryProvider {
        return this.historyProvider;
    }

    async stepLineHistory(direction: 'older' | 'newer'): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const file = editor.document.uri.fsPath;
        const line = editor.selection.active.line + 1;
        const same = this.lineCursor && this.lineCursor.file === file && this.lineCursor.line === line;

        if (!same) {
            const config = vscode.workspace.getConfiguration('gitforge');
            const maxDepth = config.get<number>('blame.maxHistoryDepth') || 100;
            const items = await this.gitService.getLineHistory(file, line, maxDepth);
            if (items.length === 0) {
                vscode.window.showWarningMessage('GitForge: No history for this line.');
                return;
            }
            this.lineCursor = { file, line, items, index: 0 };
            this.historyProvider.setHistory(items);
        }

        const cursor = this.lineCursor;
        if (!cursor) return;
        if (direction === 'older' && cursor.index < cursor.items.length - 1) {
            cursor.index += 1;
        }
        if (direction === 'newer' && cursor.index > 0) {
            cursor.index -= 1;
        }

        const item = cursor.items[cursor.index];
        this.decorationProvider.showSpecificBlame(
            editor,
            line - 1,
            item,
            `${cursor.index + 1}/${cursor.items.length}`
        );
        this.lineStatus.text = `$(history) ${cursor.index + 1}/${cursor.items.length} ${item.hash.substring(0, 7)} ${item.summary}`;
        this.lineStatus.show();
    }

    disposeLineStatus(): void {
        this.lineStatus.dispose();
    }

    dispose(): void {
        this.decorationProvider.dispose();
        
        if (this.hoverProvider) {
            this.hoverProvider.dispose();
        }
        
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }
        
        this.lineStatus.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

