import * as vscode from 'vscode';
import { FileHistoryEntry, GitService } from '../utils/GitService';
import { formatRelativeDate } from '../utils/dateUtils';

class HistoryItem extends vscode.TreeItem {
    constructor(entry: FileHistoryEntry) {
        super(entry.subject || entry.hash.substring(0, 7), vscode.TreeItemCollapsibleState.None);
        const when = entry.date ? formatRelativeDate(new Date(entry.date)) : '';
        this.description = `${entry.hash.substring(0, 7)} · ${entry.author} · ${when}`;
        this.tooltip = `${entry.subject}\n${entry.hash}\n${entry.filePath}`;
        this.contextValue = 'commit';
        this.iconPath = new vscode.ThemeIcon('git-commit');
        this.command = {
            command: 'gitforge.showCommitDetails',
            title: 'Show Commit',
            arguments: [{ hash: entry.hash }]
        };
    }
}

export class FileHistoryProvider implements vscode.TreeDataProvider<HistoryItem>, vscode.Disposable {
    private emitter = new vscode.EventEmitter<HistoryItem | void>();
    readonly onDidChangeTreeData = this.emitter.event;
    private entries: FileHistoryEntry[] = [];
    private fileLabel = '';

    constructor(private gitService: GitService) {}

    refresh(): void {
        this.emitter.fire();
    }

    async loadActiveFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') {
            this.entries = [];
            this.fileLabel = '';
            this.refresh();
            return;
        }
        this.fileLabel = editor.document.uri.fsPath;
        const config = vscode.workspace.getConfiguration('gitforge');
        const max = config.get<number>('blame.maxHistoryDepth') || 100;
        try {
            this.entries = await this.gitService.getFileHistory(this.fileLabel, max);
        } catch {
            this.entries = [];
        }
        this.refresh();
    }

    getTreeItem(element: HistoryItem): vscode.TreeItem {
        return element;
    }

    getChildren(): HistoryItem[] {
        return this.entries.map((entry) => new HistoryItem(entry));
    }

    getFileLabel(): string {
        return this.fileLabel;
    }

    dispose(): void {
        this.emitter.dispose();
    }
}
