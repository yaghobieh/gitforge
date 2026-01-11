import * as vscode from 'vscode';
import { GitService, BlameInfo } from '../utils/GitService';
import { formatRelativeDate } from '../utils/dateUtils';

export class BlameHistoryProvider implements vscode.TreeDataProvider<BlameHistoryItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<BlameHistoryItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private history: BlameInfo[] = [];

    constructor(private gitService: GitService) {}

    setHistory(history: BlameInfo[]): void {
        this.history = history;
        this._onDidChangeTreeData.fire();
    }

    clearHistory(): void {
        this.history = [];
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BlameHistoryItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: BlameHistoryItem): Thenable<BlameHistoryItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        if (this.history.length === 0) {
            return Promise.resolve([
                new BlameHistoryItem(
                    'No history loaded',
                    'Select a line and run "Show Line History"',
                    vscode.TreeItemCollapsibleState.None,
                    undefined
                )
            ]);
        }

        return Promise.resolve(
            this.history.map((blame, index) => {
                const relativeDate = formatRelativeDate(blame.date);
                const label = `${blame.summary}`;
                const description = `${blame.author} • ${relativeDate}`;
                
                return new BlameHistoryItem(
                    label,
                    description,
                    vscode.TreeItemCollapsibleState.None,
                    blame,
                    index === 0 ? 'current' : undefined
                );
            })
        );
    }
}

class BlameHistoryItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly blame?: BlameInfo,
        public readonly context?: string
    ) {
        super(label, collapsibleState);
        
        this.tooltip = this.blame 
            ? `${this.blame.summary}\n\nAuthor: ${this.blame.author}\nDate: ${this.blame.date.toLocaleString()}\nCommit: ${this.blame.hash}`
            : this.label;
        
        if (this.blame) {
            this.iconPath = new vscode.ThemeIcon(
                context === 'current' ? 'circle-filled' : 'git-commit',
                context === 'current' 
                    ? new vscode.ThemeColor('charts.green')
                    : undefined
            );
            
            this.contextValue = 'blameHistoryItem';
            
            // Command to show the commit details
            this.command = {
                command: 'git.viewCommit',
                title: 'View Commit',
                arguments: [this.blame.hash]
            };
        } else {
            this.iconPath = new vscode.ThemeIcon('info');
        }
    }
}

