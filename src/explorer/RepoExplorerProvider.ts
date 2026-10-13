import * as vscode from 'vscode';
import { GitService } from '../utils/GitService';
import { parseRemoteUrl } from '../utils/hostLinks';

export class RepoItem extends vscode.TreeItem {
    constructor(
        label: string,
        public readonly kind: 'section' | 'branch' | 'remote' | 'tag' | 'stash',
        public readonly value: string,
        collapsible: vscode.TreeItemCollapsibleState,
        public readonly extra: string = ''
    ) {
        super(label, collapsible);
        this.contextValue = kind;
        if (kind === 'section') this.iconPath = new vscode.ThemeIcon('folder');
        if (kind === 'branch') this.iconPath = new vscode.ThemeIcon('git-branch');
        if (kind === 'remote') this.iconPath = new vscode.ThemeIcon('cloud');
        if (kind === 'tag') this.iconPath = new vscode.ThemeIcon('tag');
        if (kind === 'stash') this.iconPath = new vscode.ThemeIcon('archive');
        if (extra) this.description = extra;
    }
}

export class RepoExplorerProvider implements vscode.TreeDataProvider<RepoItem>, vscode.Disposable {
    private emitter = new vscode.EventEmitter<RepoItem | void>();
    readonly onDidChangeTreeData = this.emitter.event;

    constructor(private gitService: GitService) {}

    refresh(): void {
        this.emitter.fire();
    }

    getTreeItem(element: RepoItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: RepoItem): Promise<RepoItem[]> {
        if (!element) {
            return [
                new RepoItem('Branches', 'section', 'branches', vscode.TreeItemCollapsibleState.Expanded),
                new RepoItem('Remotes', 'section', 'remotes', vscode.TreeItemCollapsibleState.Collapsed),
                new RepoItem('Tags', 'section', 'tags', vscode.TreeItemCollapsibleState.Collapsed),
                new RepoItem('Stashes', 'section', 'stashes', vscode.TreeItemCollapsibleState.Collapsed)
            ];
        }
        if (element.value === 'branches') {
            const branches = await this.gitService.getAllBranches();
            return branches.local.map((name) => new RepoItem(
                name,
                'branch',
                name,
                vscode.TreeItemCollapsibleState.None,
                name === branches.current ? 'current' : ''
            ));
        }
        if (element.value === 'remotes') {
            const remotes = await this.gitService.getRemoteRecords();
            return remotes.map((remote) => new RepoItem(remote.name, 'remote', remote.url, vscode.TreeItemCollapsibleState.None, remote.url));
        }
        if (element.value === 'tags') {
            const tags = await this.gitService.getTags();
            return tags.map((tag) => new RepoItem(tag, 'tag', tag, vscode.TreeItemCollapsibleState.None));
        }
        if (element.value === 'stashes') {
            const stashes = await this.gitService.getStashes();
            return stashes.map((stash) => new RepoItem(stash.message || stash.ref, 'stash', stash.ref, vscode.TreeItemCollapsibleState.None, stash.ref));
        }
        return [];
    }

    async checkout(item: RepoItem): Promise<void> {
        if (!item?.value) return;
        await this.gitService.checkout(item.value);
        vscode.window.showInformationMessage(`Switched to ${item.value}`);
        this.refresh();
    }

    async merge(item: RepoItem): Promise<void> {
        if (!item?.value) return;
        const current = await this.gitService.getCurrentBranch();
        const ok = await vscode.window.showWarningMessage(`Merge ${item.value} into ${current}?`, { modal: true }, 'Merge');
        if (ok !== 'Merge') return;
        const result = await this.gitService.mergeBranch(item.value);
        if (result.conflicts) {
            vscode.window.showWarningMessage('Merge conflicts. Open the conflict resolver.');
        } else if (!result.success) {
            vscode.window.showErrorMessage(result.message);
        } else {
            vscode.window.showInformationMessage(`Merged ${item.value}`);
        }
        this.refresh();
    }

    async removeBranch(item: RepoItem): Promise<void> {
        if (!item?.value) return;
        const ok = await vscode.window.showWarningMessage(`Delete branch ${item.value}?`, { modal: true }, 'Delete', 'Force Delete');
        if (!ok) return;
        await this.gitService.deleteBranch(item.value, ok === 'Force Delete');
        this.refresh();
    }

    async removeTag(item: RepoItem): Promise<void> {
        if (!item?.value) return;
        const ok = await vscode.window.showWarningMessage(`Delete tag ${item.value}?`, { modal: true }, 'Delete');
        if (ok !== 'Delete') return;
        await this.gitService.deleteTag(item.value);
        this.refresh();
    }

    async applyStash(item: RepoItem): Promise<void> {
        if (!item?.value) return;
        await this.gitService.applyStash(item.value);
        vscode.window.showInformationMessage(`Applied ${item.value}`);
        this.refresh();
    }

    async dropStash(item: RepoItem): Promise<void> {
        if (!item?.value) return;
        const ok = await vscode.window.showWarningMessage(`Drop ${item.value}? This cannot be undone.`, { modal: true }, 'Drop');
        if (ok !== 'Drop') return;
        await this.gitService.dropStash(item.value);
        this.refresh();
    }

    async openRemote(item: RepoItem): Promise<void> {
        if (!item?.value) return;
        const parsed = parseRemoteUrl(item.value);
        if (!parsed) {
            vscode.window.showWarningMessage('GitForge: Could not build a browser URL for this remote.');
            return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(parsed.webRoot));
    }

    dispose(): void {
        this.emitter.dispose();
    }
}
