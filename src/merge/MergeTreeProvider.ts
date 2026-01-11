import * as vscode from 'vscode';
import { GitService, MergeChange } from '../utils/GitService';
import * as path from 'path';

type TreeItem = MergeChangeItem | MergeFolderItem;

export class MergeTreeProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private gitService: GitService) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (element instanceof MergeFolderItem) {
            return element.children;
        }

        const changes = await this.gitService.getMergeChanges();
        
        if (changes.length === 0) {
            return [
                new MergeChangeItem(
                    'No changes',
                    '',
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'empty'
                )
            ];
        }

        // Group by directory
        const folders = new Map<string, MergeChange[]>();
        const rootFiles: MergeChange[] = [];

        for (const change of changes) {
            const dir = path.dirname(change.path);
            if (dir === '.') {
                rootFiles.push(change);
            } else {
                if (!folders.has(dir)) {
                    folders.set(dir, []);
                }
                folders.get(dir)!.push(change);
            }
        }

        const items: TreeItem[] = [];

        // Add folder items
        for (const [folder, folderChanges] of folders) {
            const children = folderChanges.map(change => 
                new MergeChangeItem(
                    path.basename(change.path),
                    this.getChangeDescription(change),
                    vscode.TreeItemCollapsibleState.None,
                    change,
                    'file'
                )
            );
            
            items.push(new MergeFolderItem(folder, children));
        }

        // Add root files
        for (const change of rootFiles) {
            items.push(
                new MergeChangeItem(
                    change.path,
                    this.getChangeDescription(change),
                    vscode.TreeItemCollapsibleState.None,
                    change,
                    'file'
                )
            );
        }

        // Sort: folders first, then files
        items.sort((a, b) => {
            if (a instanceof MergeFolderItem && !(b instanceof MergeFolderItem)) return -1;
            if (!(a instanceof MergeFolderItem) && b instanceof MergeFolderItem) return 1;
            return a.label!.toString().localeCompare(b.label!.toString());
        });

        return items;
    }

    private getChangeDescription(change: MergeChange): string {
        const parts: string[] = [];
        if (change.additions > 0) {
            parts.push(`+${change.additions}`);
        }
        if (change.deletions > 0) {
            parts.push(`-${change.deletions}`);
        }
        return parts.join(' ');
    }
}

class MergeFolderItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly children: MergeChangeItem[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        
        this.iconPath = new vscode.ThemeIcon('folder');
        this.description = `${children.length} file${children.length === 1 ? '' : 's'}`;
    }
}

class MergeChangeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly change?: MergeChange,
        public readonly type?: string
    ) {
        super(label, collapsibleState);

        if (type === 'empty') {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        } else if (type === 'file' && this.change) {
            this.contextValue = 'mergeChangeFile';
            
            // Set icon based on change type
            switch (this.change.type) {
                case 'added':
                    this.iconPath = new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('charts.green'));
                    break;
                case 'deleted':
                    this.iconPath = new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('charts.red'));
                    break;
                case 'modified':
                    this.iconPath = new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('charts.yellow'));
                    break;
                case 'renamed':
                    this.iconPath = new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('charts.blue'));
                    break;
            }
            
            this.command = {
                command: 'gitforge.openMergeFile',
                title: 'Open File',
                arguments: [this.change]
            };
            
            this.tooltip = `${this.change.path}\n\nType: ${this.change.type}\nAdditions: ${this.change.additions}\nDeletions: ${this.change.deletions}`;
        }
    }
}

