import * as vscode from 'vscode';
import { GitService } from '../utils/GitService';
import { RollbackPanel } from './RollbackPanel';
import { CherryPickPanel } from './CherryPickPanel';
import { GitLogPanel } from './GitLogPanel';
import { BranchPanel } from './BranchPanel';

export class GitOperations implements vscode.Disposable {
    private rollbackPanel: RollbackPanel | null = null;
    private cherryPickPanel: CherryPickPanel | null = null;
    private gitLogPanel: GitLogPanel | null = null;
    private branchPanel: BranchPanel | null = null;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) {}

    async rollback(): Promise<void> {
        console.log('GitForge: Rollback command triggered');
        
        if (!this.rollbackPanel) {
            this.rollbackPanel = new RollbackPanel(this.context, this.gitService);
        }
        
        // Always show the panel - let it display debug info if no changes found
        await this.rollbackPanel.show();
    }

    async rollbackFile(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('GitForge: No file open');
            return;
        }

        const filePath = editor.document.uri.fsPath;
        const fileName = filePath.split('/').pop();

        const confirm = await vscode.window.showWarningMessage(
            `Rollback all changes in ${fileName}?`,
            { modal: true },
            'Rollback'
        );

        if (confirm === 'Rollback') {
            await this.gitService.rollbackFile(filePath);
            vscode.window.showInformationMessage(`GitForge: Rolled back ${fileName}`);
        }
    }

    async cherryPick(): Promise<void> {
        if (!this.cherryPickPanel) {
            this.cherryPickPanel = new CherryPickPanel(this.context, this.gitService);
        }
        
        this.cherryPickPanel.show();
    }

    async stash(): Promise<void> {
        const message = await vscode.window.showInputBox({
            prompt: 'Stash message (optional)',
            placeHolder: 'Enter a description for this stash'
        });

        if (message === undefined) return; // Cancelled

        await this.gitService.stash(message || undefined);
        vscode.window.showInformationMessage('GitForge: Changes stashed');
    }

    async stashPop(): Promise<void> {
        const stashes = await this.gitService.getStashList();
        
        if (stashes.length === 0) {
            vscode.window.showInformationMessage('GitForge: No stashes found');
            return;
        }

        const items = stashes.map((s, i) => ({
            label: s.message || `stash@{${i}}`,
            description: s.date,
            index: i
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select stash to pop'
        });

        if (selected) {
            await this.gitService.stashPop(selected.index);
            vscode.window.showInformationMessage('GitForge: Stash popped');
        }
    }

    async resetHard(): Promise<void> {
        const commits = await this.gitService.getRecentCommits(20);
        
        const items = commits.map(c => ({
            label: c.message.split('\n')[0],
            description: `${c.hash.substring(0, 7)} - ${c.author_name}`,
            detail: c.date,
            hash: c.hash
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select commit to reset to (WARNING: This will discard all changes!)'
        });

        if (selected) {
            const confirm = await vscode.window.showWarningMessage(
                `Reset hard to ${selected.description}? This will discard ALL uncommitted changes!`,
                { modal: true },
                'Reset Hard'
            );

            if (confirm === 'Reset Hard') {
                await this.gitService.resetHard(selected.hash);
                vscode.window.showInformationMessage('GitForge: Reset complete');
            }
        }
    }

    async resetSoft(): Promise<void> {
        const commits = await this.gitService.getRecentCommits(20);
        
        const items = commits.map(c => ({
            label: c.message.split('\n')[0],
            description: `${c.hash.substring(0, 7)} - ${c.author_name}`,
            detail: c.date,
            hash: c.hash
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select commit to reset to (changes will be kept as staged)'
        });

        if (selected) {
            await this.gitService.resetSoft(selected.hash);
            vscode.window.showInformationMessage('GitForge: Soft reset complete');
        }
    }

    async showLog(): Promise<void> {
        if (!this.gitLogPanel) {
            this.gitLogPanel = new GitLogPanel(this.context, this.gitService);
        }
        
        this.gitLogPanel.show();
    }

    async showBranches(): Promise<void> {
        if (!this.branchPanel) {
            this.branchPanel = new BranchPanel(this.context, this.gitService);
        }
        
        this.branchPanel.show();
    }

    async fetch(): Promise<void> {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'GitForge: Fetching...' },
            async () => {
                await this.gitService.fetch();
            }
        );
        vscode.window.showInformationMessage('GitForge: Fetch complete');
    }

    async pull(): Promise<void> {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'GitForge: Pulling...' },
            async () => {
                await this.gitService.pull();
            }
        );
        vscode.window.showInformationMessage('GitForge: Pull complete');
    }

    async push(): Promise<void> {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'GitForge: Pushing...' },
            async () => {
                await this.gitService.push();
            }
        );
        vscode.window.showInformationMessage('GitForge: Push complete');
    }

    async commit(): Promise<void> {
        const message = await vscode.window.showInputBox({
            prompt: 'Commit message',
            placeHolder: 'Enter commit message'
        });

        if (!message) return;

        await this.gitService.commit(message);
        vscode.window.showInformationMessage('GitForge: Committed');
    }

    dispose(): void {
        if (this.rollbackPanel) {
            this.rollbackPanel.dispose();
        }
        if (this.cherryPickPanel) {
            this.cherryPickPanel.dispose();
        }
        if (this.gitLogPanel) {
            this.gitLogPanel.dispose();
        }
        if (this.branchPanel) {
            this.branchPanel.dispose();
        }
        this.disposables.forEach(d => d.dispose());
    }
}

