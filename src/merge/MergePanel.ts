import * as vscode from 'vscode';
import { GitService, MergeChange } from '../utils/GitService';
import { MergeTreeProvider } from './MergeTreeProvider';

export class MergePanel implements vscode.Disposable {
    private treeProvider: MergeTreeProvider;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) {
        this.treeProvider = new MergeTreeProvider(gitService);
        
        // Register commands for merge panel
        this.disposables.push(
            vscode.commands.registerCommand('gitforge.openMergeFile', (change: MergeChange) => {
                this.openFile(change);
            }),
            vscode.commands.registerCommand('gitforge.stageFile', (change: MergeChange) => {
                this.stageFile(change);
            }),
            vscode.commands.registerCommand('gitforge.refreshMergePanel', () => {
                this.refresh();
            })
        );

        // Auto-refresh on file changes
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        watcher.onDidChange(() => this.debouncedRefresh());
        watcher.onDidCreate(() => this.debouncedRefresh());
        watcher.onDidDelete(() => this.debouncedRefresh());
        this.disposables.push(watcher);
    }

    private refreshTimer: NodeJS.Timeout | null = null;

    private debouncedRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refresh();
        }, 500);
    }

    getTreeDataProvider(): MergeTreeProvider {
        return this.treeProvider;
    }

    show(): void {
        vscode.commands.executeCommand('gitforge.mergeChanges.focus');
        this.refresh();
    }

    private refresh(): void {
        this.treeProvider.refresh();
    }

    private async openFile(change: MergeChange): Promise<void> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;

        const uri = vscode.Uri.file(`${workspaceRoot}/${change.path}`);
        
        try {
            // Open diff view
            const leftUri = vscode.Uri.parse(`git:${change.path}?~`);
            await vscode.commands.executeCommand('vscode.diff', leftUri, uri, `${change.path} (Working Tree)`);
        } catch {
            // Fallback to regular file open
            await vscode.window.showTextDocument(uri);
        }
    }

    private async stageFile(change: MergeChange): Promise<void> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;

        const fullPath = `${workspaceRoot}/${change.path}`;
        await this.gitService.stageFile(fullPath);
        
        vscode.window.showInformationMessage(`GitForge: Staged ${change.path}`);
        this.refresh();
    }

    dispose(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.disposables.forEach(d => d.dispose());
    }
}

