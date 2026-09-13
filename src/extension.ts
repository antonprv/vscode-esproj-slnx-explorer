import * as vscode from "vscode";
import * as path from "path";
import { SlnxTreeProvider } from "./solutionTreeProvider";
import { SolutionNode } from "./solutionModel";

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
        { placeHolder: vscode.l10n.t("Select a .slnx file") }
    );
    return picked?.uri.fsPath;
}

async function promptForSlnxFile(): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { [vscode.l10n.t("Solution files")]: ["slnx"] },
        openLabel: vscode.l10n.t("Open Solution"),
    });
    return picked?.[0]?.fsPath;
}

type ProjectCommandKind = "build" | "clean";

// Переиспользуем терминал на пару (тип команды, проект), чтобы повторные
// запуски Build/Clean не плодили новые вкладки терминала.
const projectTerminals: Map<string, vscode.Terminal> = new Map();

function getOrCreateProjectTerminal(kind: ProjectCommandKind, node: SolutionNode): vscode.Terminal {
    const key = `${kind}:${node.absolutePath}`;
    const existing: vscode.Terminal | undefined = projectTerminals.get(key);
    if (existing) {
        return existing;
    }

    const cwd: string = path.dirname(node.absolutePath as string);
    const name: string =
        kind === "build" ? vscode.l10n.t("Build: {0}", node.name) : vscode.l10n.t("Clean: {0}", node.name);
    const terminal: vscode.Terminal = vscode.window.createTerminal({ name, cwd });
    projectTerminals.set(key, terminal);
    return terminal;
}

/** Запускает BuildCommand/CleanCommand проекта (из его .esproj и т.п.) в терминале. */
function runProjectCommand(kind: ProjectCommandKind, node: SolutionNode): void {
    const command: string | undefined = kind === "build" ? node.buildCommand : node.cleanCommand;
    if (!command || !node.absolutePath) {
        return;
    }

    const terminal: vscode.Terminal = getOrCreateProjectTerminal(kind, node);
    terminal.show(false);
    terminal.sendText(command);
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
            treeView.title = vscode.l10n.t("Solution: {0}", path.basename(chosenPath));
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

    const buildProjectCommand = vscode.commands.registerCommand(
        "slnxExplorer.buildProject",
        (entry: { node?: SolutionNode }) => {
            if (entry?.node) {
                runProjectCommand("build", entry.node);
            }
        }
    );

    const cleanProjectCommand = vscode.commands.registerCommand(
        "slnxExplorer.cleanProject",
        (entry: { node?: SolutionNode }) => {
            if (entry?.node) {
                runProjectCommand("clean", entry.node);
            }
        }
    );

    const buildSolutionCommand = vscode.commands.registerCommand("slnxExplorer.buildSolution", () => {
        const buildableProjects: SolutionNode[] = treeProvider.getAllProjects().filter((node) => node.buildCommand);
        if (buildableProjects.length === 0) {
            vscode.window.showInformationMessage(
                vscode.l10n.t("No project in the solution defines a BuildCommand.")
            );
            return;
        }
        for (const node of buildableProjects) {
            runProjectCommand("build", node);
        }
    });

    const cleanSolutionCommand = vscode.commands.registerCommand("slnxExplorer.cleanSolution", () => {
        const cleanableProjects: SolutionNode[] = treeProvider.getAllProjects().filter((node) => node.cleanCommand);
        if (cleanableProjects.length === 0) {
            vscode.window.showInformationMessage(
                vscode.l10n.t("No project in the solution defines a CleanCommand.")
            );
            return;
        }
        for (const node of cleanableProjects) {
            runProjectCommand("clean", node);
        }
    });

    // Убираем закрытый пользователем терминал из кэша, чтобы следующий Build/Clean создал новый.
    const terminalCloseListener = vscode.window.onDidCloseTerminal((closedTerminal: vscode.Terminal) => {
        for (const [key, terminal] of projectTerminals) {
            if (terminal === closedTerminal) {
                projectTerminals.delete(key);
                break;
            }
        }
    });

    context.subscriptions.push(
        refreshCommand,
        openSolutionCommand,
        openFileCommand,
        revealInOsCommand,
        buildProjectCommand,
        cleanProjectCommand,
        buildSolutionCommand,
        cleanSolutionCommand,
        terminalCloseListener
    );

    // Автозагрузка, если .slnx уже есть в открытой папке.
    const autoDetected: string | undefined = await findSlnxInWorkspace();
    if (autoDetected) {
        treeProvider.loadSolution(autoDetected);
        treeView.title = vscode.l10n.t("Solution: {0}", path.basename(autoDetected));
    }
}

export function deactivate(): void {
    // Нет ресурсов, требующих явного освобождения.
}
