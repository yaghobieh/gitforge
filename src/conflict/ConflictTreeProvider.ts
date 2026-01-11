import * as vscode from 'vscode';
import { GitService, ConflictFile } from '../utils/GitService';
import * as path from 'path';

export class ConflictTreeProvider implements vscode.TreeDataProvider<ConflictItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ConflictItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private gitService: GitService) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConflictItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ConflictItem): Promise<ConflictItem[]> {
        if (element) {
            return [];
        }

        const conflicts = await this.gitService.getConflictedFiles();
        
        if (conflicts.length === 0) {
            return [
                new ConflictItem(
                    'No conflicts',
                    '',
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'empty'
                )
            ];
        }

        return conflicts.map(conflict => {
            const filename = path.basename(conflict.path);
            const dirname = path.dirname(conflict.path);
            
            return new ConflictItem(
                filename,
                dirname,
                vscode.TreeItemCollapsibleState.None,
                conflict,
                'conflict'
            );
        });
    }
}

class ConflictItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly conflict?: ConflictFile,
        public readonly type?: string
    ) {
        super(label, collapsibleState);

        if (type === 'empty') {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        } else if (type === 'conflict') {
            this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
            this.contextValue = 'conflictFile';
            
            if (this.conflict) {
                this.command = {
                    command: 'gitforge.openConflictFile',
                    title: 'Open Conflict',
                    arguments: [this.conflict]
                };
                
                this.tooltip = `Conflicted file: ${this.conflict.path}\n\nClick to open conflict resolver`;
            }
        }
    }
}
