import * as vscode from 'vscode';
import * as path from 'path';
import { GitService, ConflictFile } from '../utils/GitService';
import { ConflictTreeProvider } from './ConflictTreeProvider';
import { ConflictWebviewPanel } from './ConflictWebviewPanel';

export class ConflictResolver implements vscode.Disposable {
    private treeProvider: ConflictTreeProvider;
    private webviewPanel: ConflictWebviewPanel | null = null;
    private disposables: vscode.Disposable[] = [];
    private currentConflictFile: string | null = null;

    constructor(
        private context: vscode.ExtensionContext,
        private gitService: GitService
    ) {
        this.treeProvider = new ConflictTreeProvider(gitService);
        
        // Watch for conflict file selection
        this.disposables.push(
            vscode.commands.registerCommand('gitforge.openConflictFile', (file: ConflictFile) => {
                this.openConflictFile(file);
            })
        );

        // Watch for resolution actions
        this.disposables.push(
            vscode.commands.registerCommand('gitforge.acceptOurs', (file: ConflictFile) => {
                this.resolveFile(file, 'ours');
            }),
            vscode.commands.registerCommand('gitforge.acceptTheirs', (file: ConflictFile) => {
                this.resolveFile(file, 'theirs');
            }),
            vscode.commands.registerCommand('gitforge.acceptBoth', (file: ConflictFile) => {
                this.resolveFile(file, 'both');
            })
        );

        // Refresh on file system changes
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        watcher.onDidChange(() => this.refresh());
        this.disposables.push(watcher);
    }

    getTreeDataProvider(): ConflictTreeProvider {
        return this.treeProvider;
    }

    async open(): Promise<void> {
        console.log('GitForge: Opening conflict resolver...');
        
        // First try to detect from current file
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const currentFile = activeEditor.document.uri.fsPath;
            console.log('GitForge: Current file:', currentFile);
            
            // Check if current file has conflict markers
            const content = activeEditor.document.getText();
            if (content.includes('<<<<<<<') && content.includes('=======') && content.includes('>>>>>>>')) {
                console.log('GitForge: Found conflict markers in current file!');
                const conflictContent = await this.gitService.getConflictContent(currentFile);
                
                if (!this.webviewPanel) {
                    this.webviewPanel = new ConflictWebviewPanel(
                        this.context,
                        this.gitService,
                        (resolution) => this.handleResolution(resolution)
                    );
                }
                
                this.currentConflictFile = currentFile;
                const displayPath = path.basename(currentFile);
                this.webviewPanel.show(displayPath, conflictContent);
                return;
            }
        }
        
        const conflicts = await this.gitService.getConflictedFiles();
        
        console.log('GitForge: Found conflicts:', conflicts);
        
        if (conflicts.length === 0) {
            vscode.window.showInformationMessage('GitForge: No conflicts detected. Open a file with conflict markers and try again.');
            return;
        }

        vscode.window.showInformationMessage(`GitForge: Found ${conflicts.length} conflicted file(s)`);

        // Open the first conflicted file
        await this.openConflictFile(conflicts[0]);
    }

    async openConflictFile(file: ConflictFile): Promise<void> {
        // file.path is now the full path
        this.currentConflictFile = file.path;
        
        console.log('GitForge: Opening conflict file:', file.path);

        const content = await this.gitService.getConflictContent(file.path);
        
        console.log('GitForge: Conflict content loaded:', {
            oursLength: content.ours.length,
            theirsLength: content.theirs.length,
            baseLength: content.base.length
        });

        // Create or reveal the webview panel
        if (!this.webviewPanel) {
            this.webviewPanel = new ConflictWebviewPanel(
                this.context,
                this.gitService,
                (resolution) => this.handleResolution(resolution)
            );
        }

        const displayPath = path.basename(file.path);
        this.webviewPanel.show(displayPath, content);
    }

    async resolveCurrentConflict(resolution: 'ours' | 'theirs' | 'both'): Promise<void> {
        if (!this.currentConflictFile) {
            vscode.window.showWarningMessage('No conflict file selected');
            return;
        }

        await this.resolveFile(
            { path: this.currentConflictFile, status: 'conflicted' },
            resolution
        );
    }

    private async resolveFile(file: ConflictFile, resolution: 'ours' | 'theirs' | 'both'): Promise<void> {
        const fullPath = file.path;
        const content = await this.gitService.getConflictContent(fullPath);

        let resolvedContent: string;
        switch (resolution) {
            case 'ours':
                resolvedContent = content.ours;
                break;
            case 'theirs':
                resolvedContent = content.theirs;
                break;
            case 'both':
                // Combine both versions
                resolvedContent = content.ours + '\n' + content.theirs;
                break;
        }

        // Write the resolved content
        const uri = vscode.Uri.file(fullPath);
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(uri, encoder.encode(resolvedContent));

        // Stage the file
        await this.gitService.stageFile(fullPath);

        vscode.window.showInformationMessage(`GitForge: Resolved ${path.basename(file.path)} with "${resolution}"`);
        
        this.refresh();
    }

    private handleResolution(resolution: { file: string; content: string }): void {
        if (!this.currentConflictFile) return;
        
        const fullPath = this.currentConflictFile;
        const uri = vscode.Uri.file(fullPath);
        const encoder = new TextEncoder();
        
        vscode.workspace.fs.writeFile(uri, encoder.encode(resolution.content)).then(() => {
            this.gitService.stageFile(fullPath);
            vscode.window.showInformationMessage(`GitForge: Resolved ${resolution.file}`);
            this.refresh();
        });
    }

    private async refresh(): Promise<void> {
        this.treeProvider.refresh();
        
        // Check if there are still conflicts
        const hasConflicts = await this.gitService.hasConflicts();
        vscode.commands.executeCommand('setContext', 'gitforge.hasConflicts', hasConflicts);
        
        if (!hasConflicts && this.webviewPanel) {
            this.webviewPanel.dispose();
            this.webviewPanel = null;
            vscode.window.showInformationMessage('GitForge: All conflicts resolved! 🎉');
        }
    }

    dispose(): void {
        if (this.webviewPanel) {
            this.webviewPanel.dispose();
        }
        this.disposables.forEach(d => d.dispose());
    }
}
