import * as vscode from 'vscode';
import { BlameController } from './blame/BlameController';
import { ConflictResolver } from './conflict/ConflictResolver';
import { MergePanel } from './merge/MergePanel';
import { GitService } from './utils/GitService';
import { GitOperations } from './operations/GitOperations';
import { CompareBranchPanel } from './operations/CompareBranchPanel';

let blameController: BlameController | null = null;
let conflictResolver: ConflictResolver | null = null;
let mergePanel: MergePanel | null = null;
let gitOperations: GitOperations | null = null;
let compareBranchPanel: CompareBranchPanel | null = null;
let gitService: GitService;
let conflictWatcher: NodeJS.Timeout | null = null;
let lastConflictState: boolean = false;
let branchStatusBar: vscode.StatusBarItem | null = null;

export async function activate(context: vscode.ExtensionContext) {
    console.log('GitForge: Extension activating...');

    // Initialize Git service
    gitService = new GitService();
    
    // Check if any workspace folder is a git repo
    const isGitRepo = await gitService.isGitRepository();
    vscode.commands.executeCommand('setContext', 'gitforge.isGitRepo', isGitRepo);
    console.log('GitForge: Is git repo:', isGitRepo);

    // Initialize controllers
    blameController = new BlameController(context, gitService);
    conflictResolver = new ConflictResolver(context, gitService);
    mergePanel = new MergePanel(context, gitService);
    gitOperations = new GitOperations(context, gitService);
    compareBranchPanel = new CompareBranchPanel(context, gitService);

    // Register commands
    const commands = [
        // Blame commands
        vscode.commands.registerCommand('gitforge.toggleBlame', () => {
            console.log('GitForge: Toggle blame command triggered');
            blameController?.toggle();
        }),
        
        vscode.commands.registerCommand('gitforge.showLineHistory', () => {
            console.log('GitForge: Show line history command triggered');
            blameController?.showLineHistory();
        }),
        
        vscode.commands.registerCommand('gitforge.copyCommitHash', (args: { hash: string }) => {
            console.log('GitForge: Copy commit hash command triggered');
            blameController?.copyCommitHash(args?.hash || '');
        }),
        
        vscode.commands.registerCommand('gitforge.showCommitChanges', (args: { hash: string }) => {
            console.log('GitForge: Show commit changes command triggered');
            blameController?.showCommitChanges(args?.hash || '');
        }),
        
        // Conflict commands
        vscode.commands.registerCommand('gitforge.openConflictResolver', () => {
            console.log('GitForge: Open conflict resolver command triggered');
            conflictResolver?.open();
        }),
        
        vscode.commands.registerCommand('gitforge.showMergePanel', () => {
            console.log('GitForge: Show merge panel command triggered');
            mergePanel?.show();
        }),
        
        vscode.commands.registerCommand('gitforge.resolveConflict', (resolution: 'ours' | 'theirs' | 'both') => {
            conflictResolver?.resolveCurrentConflict(resolution);
        }),

        // Git operations commands
        vscode.commands.registerCommand('gitforge.rollback', () => {
            console.log('GitForge: Rollback command triggered');
            gitOperations?.rollback();
        }),

        vscode.commands.registerCommand('gitforge.rollbackFile', () => {
            console.log('GitForge: Rollback file command triggered');
            gitOperations?.rollbackFile();
        }),

        vscode.commands.registerCommand('gitforge.cherryPick', () => {
            console.log('GitForge: Cherry pick command triggered');
            gitOperations?.cherryPick();
        }),

        vscode.commands.registerCommand('gitforge.stash', () => {
            console.log('GitForge: Stash command triggered');
            gitOperations?.stash();
        }),

        vscode.commands.registerCommand('gitforge.stashPop', () => {
            console.log('GitForge: Stash pop command triggered');
            gitOperations?.stashPop();
        }),

        vscode.commands.registerCommand('gitforge.resetHard', () => {
            console.log('GitForge: Reset hard command triggered');
            gitOperations?.resetHard();
        }),

        vscode.commands.registerCommand('gitforge.resetSoft', () => {
            console.log('GitForge: Reset soft command triggered');
            gitOperations?.resetSoft();
        }),

        vscode.commands.registerCommand('gitforge.showLog', () => {
            console.log('GitForge: Show log command triggered');
            gitOperations?.showLog();
        }),

        vscode.commands.registerCommand('gitforge.showBranches', () => {
            console.log('GitForge: Show branches command triggered');
            gitOperations?.showBranches();
        }),

        vscode.commands.registerCommand('gitforge.fetch', () => {
            console.log('GitForge: Fetch command triggered');
            gitOperations?.fetch();
        }),

        vscode.commands.registerCommand('gitforge.pull', () => {
            console.log('GitForge: Pull command triggered');
            gitOperations?.pull();
        }),

        vscode.commands.registerCommand('gitforge.push', () => {
            console.log('GitForge: Push command triggered');
            gitOperations?.push();
        }),

        vscode.commands.registerCommand('gitforge.commit', () => {
            console.log('GitForge: Commit command triggered');
            gitOperations?.commit();
        }),

        vscode.commands.registerCommand('gitforge.compareBranch', () => {
            console.log('GitForge: Compare branch command triggered');
            compareBranchPanel?.show();
        }),

        // Branch quick actions (status bar)
        vscode.commands.registerCommand('gitforge.branchQuickPick', async () => {
            const currentBranch = await gitService.getCurrentBranch();
            const branches = await gitService.getAllBranches();
            
            // Build items: branches first, then actions
            const items: vscode.QuickPickItem[] = [
                { label: 'Quick Actions', kind: vscode.QuickPickItemKind.Separator },
                { label: '$(add) New Branch...', description: 'Create a new branch' },
                { label: '$(edit) Rename Current Branch', description: `Rename ${currentBranch}` },
                { label: '$(cloud-download) Fetch', description: 'Fetch from remote' },
                { label: '$(repo-pull) Pull', description: 'Pull changes' },
                { label: '$(repo-push) Push', description: 'Push changes' },
                { label: `Local Branches (${branches.local.length})`, kind: vscode.QuickPickItemKind.Separator },
            ];

            // Add all local branches with click-for-actions description
            for (const branch of branches.local) {
                if (branch === currentBranch) {
                    items.push({
                        label: '$(check) ' + branch,
                        description: '← current branch'
                    });
                } else {
                    items.push({
                        label: '$(git-branch) ' + branch,
                        description: `Click for actions...`
                    });
                }
            }

            // Add remote branches
            if (branches.remote.length > 0) {
                items.push({ label: `Remote Branches (${branches.remote.length})`, kind: vscode.QuickPickItemKind.Separator });
                for (const branch of branches.remote.slice(0, 10)) {
                    items.push({
                        label: '$(cloud) ' + branch,
                        description: 'Click for actions...'
                    });
                }
            }

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `📍 ${currentBranch}`,
                title: 'GitForge: Branches'
            });

            if (!selected) return;

            const label = selected.label.replace(/\$\([^)]+\)\s*/g, '').trim();

            // Quick actions
            if (label === 'New Branch...') {
                const name = await vscode.window.showInputBox({
                    prompt: 'Enter new branch name',
                    placeHolder: 'feature/my-feature'
                });
                if (name) {
                    await gitService.createBranch(name, true);
                    vscode.window.showInformationMessage(`✅ Created and switched to: ${name}`);
                    updateBranchStatusBar();
                }
            } else if (label === 'Rename Current Branch') {
                const newName = await vscode.window.showInputBox({
                    prompt: `Rename '${currentBranch}' to:`,
                    value: currentBranch
                });
                if (newName && newName !== currentBranch) {
                    await gitService.renameBranch(currentBranch, newName);
                    vscode.window.showInformationMessage(`✅ Renamed to: ${newName}`);
                    updateBranchStatusBar();
                }
            } else if (label === 'Fetch') {
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Fetching...' },
                    () => gitService.fetch());
                vscode.window.showInformationMessage('✅ Fetch complete');
            } else if (label === 'Pull') {
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Pulling...' },
                    () => gitService.pull());
                vscode.window.showInformationMessage('✅ Pull complete');
            } else if (label === 'Push') {
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Pushing...' },
                    () => gitService.push());
                vscode.window.showInformationMessage('✅ Push complete');
            } else if (label === currentBranch) {
                // Clicked on current branch - show current branch actions
                const action = await vscode.window.showQuickPick([
                    { label: '$(edit) Rename', description: `Rename ${currentBranch}` },
                    { label: '$(repo-push) Push', description: `Push ${currentBranch} to origin` },
                    { label: '$(history) View Log', description: 'Show commit history' },
                ], {
                    placeHolder: `Actions for ${currentBranch} (current)`
                });
                if (action?.label.includes('Rename')) {
                    const newName = await vscode.window.showInputBox({ prompt: `Rename '${currentBranch}' to:`, value: currentBranch });
                    if (newName && newName !== currentBranch) {
                        await gitService.renameBranch(currentBranch, newName);
                        vscode.window.showInformationMessage(`✅ Renamed to: ${newName}`);
                        updateBranchStatusBar();
                    }
                } else if (action?.label.includes('Push')) {
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Pushing...' },
                        () => gitService.push());
                    vscode.window.showInformationMessage('✅ Push complete');
                } else if (action?.label.includes('Log')) {
                    gitOperations?.showGitLog();
                }
            } else {
                // Show submenu for selected branch
                const isRemote = branches.remote.includes(label) || label.startsWith('origin/');
                const branchName = label.replace(/^origin\//, '');
                
                const actions = [
                    { label: `$(arrow-right) Checkout ${branchName}`, description: `Switch to ${branchName}` },
                    { label: `$(git-merge) Merge ${branchName} → ${currentBranch}`, description: `Merge into current branch` },
                ];
                
                if (!isRemote) {
                    actions.push(
                        { label: `$(edit) Rename ${branchName}`, description: 'Rename this branch' },
                        { label: `$(repo-push) Push ${branchName}`, description: 'Push to origin' },
                        { label: `$(trash) Delete ${branchName}`, description: 'Delete this branch' }
                    );
                }

                const action = await vscode.window.showQuickPick(actions, {
                    placeHolder: `Actions for ${branchName}`,
                    title: `GitForge: ${branchName}`
                });

                if (!action) return;

                if (action.label.includes('Checkout')) {
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Switching to ${branchName}...` },
                        () => gitService.checkout(branchName));
                    vscode.window.showInformationMessage(`✅ Switched to: ${branchName}`);
                    updateBranchStatusBar();
                } else if (action.label.includes('Merge')) {
                    const confirm = await vscode.window.showWarningMessage(
                        `Merge ${branchName} into ${currentBranch}?`,
                        { modal: true },
                        'Merge'
                    );
                    if (confirm === 'Merge') {
                        const result = await vscode.window.withProgress(
                            { location: vscode.ProgressLocation.Notification, title: `Merging ${branchName}...` },
                            () => gitService.mergeBranch(branchName)
                        );
                        if (result.success) {
                            vscode.window.showInformationMessage(`✅ Merged ${branchName} → ${currentBranch}`);
                        } else if (result.conflicts) {
                            vscode.window.showWarningMessage('⚔️ Merge conflicts! Opening resolver...', 'Open').then(a => {
                                if (a === 'Open') conflictResolver?.open();
                            });
                        } else {
                            vscode.window.showErrorMessage(`❌ ${result.message}`);
                        }
                    }
                } else if (action.label.includes('Rename')) {
                    const newName = await vscode.window.showInputBox({ prompt: `Rename '${branchName}' to:`, value: branchName });
                    if (newName && newName !== branchName) {
                        await gitService.renameBranch(branchName, newName);
                        vscode.window.showInformationMessage(`✅ Renamed to: ${newName}`);
                    }
                } else if (action.label.includes('Push')) {
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Pushing ${branchName}...` },
                        () => gitService.pushBranch(branchName, 'origin', true));
                    vscode.window.showInformationMessage(`✅ Pushed ${branchName}`);
                } else if (action.label.includes('Delete')) {
                    const confirm = await vscode.window.showWarningMessage(
                        `Delete branch '${branchName}'?`,
                        { modal: true },
                        'Delete', 'Force Delete'
                    );
                    if (confirm) {
                        await gitService.deleteBranch(branchName, confirm === 'Force Delete');
                        vscode.window.showInformationMessage(`✅ Deleted ${branchName}`);
                    }
                }
            }
        }),
    ];

    // Create GitForge icon button - LEFT side, right after git branch
    branchStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    branchStatusBar.command = 'gitforge.branchQuickPick';
    branchStatusBar.tooltip = 'GitForge\n─────────────\n• New Branch\n• Merge Branch\n• Rename Branch\n• Push / Pull / Fetch';
    branchStatusBar.text = '$(source-control)'; // Git/source control icon
    branchStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    branchStatusBar.show();
    context.subscriptions.push(branchStatusBar);
    console.log('GitForge: Icon button created');
    updateBranchStatusBar();

    context.subscriptions.push(...commands);
    
    // Register tree data providers
    vscode.window.registerTreeDataProvider('gitforge.mergeChanges', mergePanel.getTreeDataProvider());
    vscode.window.registerTreeDataProvider('gitforge.conflicts', conflictResolver.getTreeDataProvider());
    vscode.window.registerTreeDataProvider('gitforge.blameHistory', blameController.getHistoryProvider());

    // Start conflict watcher - checks for new conflicts every 2 seconds
    startConflictWatcher();
    
    // Also watch for file changes in .git folder
    const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/**');
    gitWatcher.onDidChange(() => checkForNewConflicts());
    gitWatcher.onDidCreate(() => checkForNewConflicts());
    context.subscriptions.push(gitWatcher);

    // Watch for document opens (to detect conflict markers)
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            checkDocumentForConflicts(doc);
        })
    );

    // Check currently open documents
    vscode.workspace.textDocuments.forEach(doc => {
        checkDocumentForConflicts(doc);
    });

    console.log('GitForge: Extension activated successfully!');
    vscode.window.showInformationMessage('GitForge: Ready! Right-click for Git menu.');
}

async function updateBranchStatusBar() {
    if (!branchStatusBar || !gitService) return;
    
    try {
        const branch = await gitService.getCurrentBranch();
        // Always show the flame icon
        branchStatusBar.text = '$(source-control)';
        branchStatusBar.tooltip = branch 
            ? `GitForge: ${branch}\n─────────────\n• New Branch\n• Merge\n• Rename\n• Push / Pull / Fetch`
            : 'GitForge - Click for branch actions';
        branchStatusBar.show();
    } catch {
        branchStatusBar.text = '$(source-control)';
        branchStatusBar.show();
    }
}

function startConflictWatcher() {
    // Poll for conflicts every 2 seconds
    conflictWatcher = setInterval(async () => {
        await checkForNewConflicts();
        await updateBranchStatusBar();
    }, 2000);
}

async function checkForNewConflicts() {
    if (!gitService || !conflictResolver) return;
    
    const hasConflicts = await gitService.hasConflicts();
    vscode.commands.executeCommand('setContext', 'gitforge.hasConflicts', hasConflicts);
    
    // If conflicts just appeared (state changed from false to true)
    if (hasConflicts && !lastConflictState) {
        console.log('GitForge: New conflicts detected!');
        
        const config = vscode.workspace.getConfiguration('gitforge');
        if (config.get('conflictResolver.autoOpen')) {
            // Show notification with option to open resolver
            const action = await vscode.window.showWarningMessage(
                '⚔️ Merge conflicts detected!',
                'Open Resolver',
                'Dismiss'
            );
            
            if (action === 'Open Resolver') {
                conflictResolver.open();
            }
        }
    }
    
    lastConflictState = hasConflicts;
}

function checkDocumentForConflicts(doc: vscode.TextDocument) {
    if (doc.uri.scheme !== 'file') return;
    
    const text = doc.getText();
    if (text.includes('<<<<<<<') && text.includes('=======') && text.includes('>>>>>>>')) {
        console.log('GitForge: Conflict markers found in', doc.fileName);
        
        // Add decoration to show it's a conflicted file
        const config = vscode.workspace.getConfiguration('gitforge');
        if (config.get('conflictResolver.autoOpen')) {
            // Ask user if they want to open the resolver
            vscode.window.showWarningMessage(
                `⚔️ Conflict markers found in ${doc.fileName.split('/').pop()}`,
                'Open Resolver'
            ).then(action => {
                if (action === 'Open Resolver' && conflictResolver) {
                    conflictResolver.open();
                }
            });
        }
    }
}

export function deactivate() {
    console.log('GitForge: Deactivating...');
    
    if (conflictWatcher) {
        clearInterval(conflictWatcher);
    }
    
    if (blameController) {
        blameController.dispose();
    }
    if (conflictResolver) {
        conflictResolver.dispose();
    }
    if (mergePanel) {
        mergePanel.dispose();
    }
    if (gitOperations) {
        gitOperations.dispose();
    }
    if (compareBranchPanel) {
        compareBranchPanel.dispose();
    }
}
