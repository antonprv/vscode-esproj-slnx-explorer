import * as vscode from "vscode";
import * as path from "path";
import { SlnxTreeProvider } from "./solutionTreeProvider";

async function findSlnxInWorkspace(): Promise<string | undefined> {
    const found: vscode.Uri[] = await vscode.workspace.findFiles("**/*.slnx", "**/node_modules/**", 5);
    if (found.length === 0) {
        return undefined;
    }
    if (found.length === 1) {
        return found[0].fsPath;
    }

    const picked = await vscode.window.showQuickPick(
        found.map((uri: vscode.Uri) => ({ label: path.basename(uri.fsPath), description: uri.fsPath, uri })),
        { placeHolder: "Выберите .slnx файл" }
    );
    return picked?.uri.fsPath;
}

async function promptForSlnxFile(): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "Solution files": ["slnx"] },
        openLabel: "Открыть solution",
    });
    return picked?.[0]?.fsPath;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const treeProvider: SlnxTreeProvider = new SlnxTreeProvider();
    const treeView: vscode.TreeView<unknown> = vscode.window.createTreeView("slnxExplorer", {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    const refreshCommand = vscode.commands.registerCommand("slnxExplorer.refresh", () => {
        treeProvider.refresh();
    });

    const openSolutionCommand = vscode.commands.registerCommand("slnxExplorer.openSolution", async () => {
        const chosenPath: string | undefined = await promptForSlnxFile();
        if (chosenPath) {
            treeProvider.loadSolution(chosenPath);
            treeView.title = `Solution: ${path.basename(chosenPath)}`;
        }
    });

    const openFileCommand = vscode.commands.registerCommand("slnxExplorer.openFile", async (uri: vscode.Uri) => {
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: true });
    });

    const revealInOsCommand = vscode.commands.registerCommand(
        "slnxExplorer.revealInOs",
        async (entry: { node?: { absolutePath?: string }; absolutePath?: string }) => {
            const target: string | undefined = entry?.node?.absolutePath ?? entry?.absolutePath;
            if (target) {
                await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(target));
            }
        }
    );

    context.subscriptions.push(refreshCommand, openSolutionCommand, openFileCommand, revealInOsCommand);

    // Автозагрузка, если .slnx уже есть в открытой папке.
    const autoDetected: string | undefined = await findSlnxInWorkspace();
    if (autoDetected) {
        treeProvider.loadSolution(autoDetected);
        treeView.title = `Solution: ${path.basename(autoDetected)}`;
    }
}

export function deactivate(): void {
    // Нет ресурсов, требующих явного освобождения.
}
