import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { SlnxTreeProvider, TreeEntry } from "./solutionTreeProvider";
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

// #region Terminal reuse

// Общий кэш терминалов по произвольному ключу (тип команды + путь), чтобы
// повторные запуски Build/Clean/npm-скриптов не плодили новые вкладки.
const terminalCache: Map<string, vscode.Terminal> = new Map();

function getOrCreateTerminal(key: string, name: string, cwd: string): vscode.Terminal {
    const existing: vscode.Terminal | undefined = terminalCache.get(key);
    if (existing) {
        return existing;
    }

    const terminal: vscode.Terminal = vscode.window.createTerminal({ name, cwd });
    terminalCache.set(key, terminal);
    return terminal;
}

// #endregion

// #region Build / Clean (свойства из .esproj и т.п.)

type ProjectCommandKind = "build" | "clean";

/** Запускает BuildCommand/CleanCommand проекта (из его .esproj и т.п.) в терминале. */
function runProjectCommand(kind: ProjectCommandKind, node: SolutionNode): void {
    const command: string | undefined = kind === "build" ? node.buildCommand : node.cleanCommand;
    if (!command || !node.absolutePath) {
        return;
    }

    const cwd: string = path.dirname(node.absolutePath);
    const name: string =
        kind === "build" ? vscode.l10n.t("Build: {0}", node.name) : vscode.l10n.t("Clean: {0}", node.name);
    const terminal: vscode.Terminal = getOrCreateTerminal(`${kind}:${node.absolutePath}`, name, cwd);
    terminal.show(false);
    terminal.sendText(command);
}

// #endregion

// #region npm scripts (package.json)

function detectPackageManager(projectDir: string): "pnpm" | "yarn" | "npm" {
    if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
        return "pnpm";
    }
    if (fs.existsSync(path.join(projectDir, "yarn.lock"))) {
        return "yarn";
    }
    return "npm";
}

async function runNpmScriptCommand(entry: { absolutePath?: string }): Promise<void> {
    const packageJsonPath: string | undefined = entry?.absolutePath;
    if (!packageJsonPath) {
        return;
    }

    let scripts: Record<string, string>;
    try {
        const raw: string = fs.readFileSync(packageJsonPath, "utf-8");
        const parsed: { scripts?: Record<string, string> } = JSON.parse(raw);
        scripts = parsed.scripts ?? {};
    } catch {
        vscode.window.showErrorMessage(vscode.l10n.t("Could not read or parse this package.json."));
        return;
    }

    const scriptNames: string[] = Object.keys(scripts);
    if (scriptNames.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('This package.json has no "scripts" entries.'));
        return;
    }

    const picked = await vscode.window.showQuickPick(
        scriptNames.map((scriptName: string) => ({ label: scriptName, description: scripts[scriptName] })),
        { placeHolder: vscode.l10n.t("Select a script to run") }
    );
    if (!picked) {
        return;
    }

    const projectDir: string = path.dirname(packageJsonPath);
    const packageManager: string = detectPackageManager(projectDir);
    const terminal: vscode.Terminal = getOrCreateTerminal(
        `npm-script:${packageJsonPath}:${picked.label}`,
        vscode.l10n.t("npm: {0}", picked.label),
        projectDir
    );
    terminal.show(false);
    terminal.sendText(`${packageManager} run ${picked.label}`);
}

// #endregion

// #region "More" — стандартные операции с файлами/папками

interface FileSystemTarget {
    absolutePath: string;
    isDirectory: boolean;
}

/** Достаёт путь и тип (файл/папка) из любого элемента дерева — solution-узла или файловой записи. */
function resolveEntryTarget(entry: TreeEntry | undefined): FileSystemTarget | undefined {
    if (!entry) {
        return undefined;
    }
    if (entry.source === "solution") {
        return entry.node.absolutePath ? { absolutePath: entry.node.absolutePath, isDirectory: false } : undefined;
    }
    return { absolutePath: entry.absolutePath, isDirectory: entry.isDirectory };
}

async function copyPathCommand(entry: TreeEntry): Promise<void> {
    const target: FileSystemTarget | undefined = resolveEntryTarget(entry);
    if (!target) {
        return;
    }
    await vscode.env.clipboard.writeText(target.absolutePath);
}

async function copyRelativePathCommand(entry: TreeEntry): Promise<void> {
    const target: FileSystemTarget | undefined = resolveEntryTarget(entry);
    if (!target) {
        return;
    }
    await vscode.env.clipboard.writeText(
        vscode.workspace.asRelativePath(vscode.Uri.file(target.absolutePath), false)
    );
}

function openInTerminalCommand(entry: TreeEntry): void {
    const target: FileSystemTarget | undefined = resolveEntryTarget(entry);
    if (!target) {
        return;
    }
    const dir: string = target.isDirectory ? target.absolutePath : path.dirname(target.absolutePath);
    const terminal: vscode.Terminal = getOrCreateTerminal(
        `shell:${dir}`,
        vscode.l10n.t("Terminal: {0}", path.basename(dir)),
        dir
    );
    terminal.show(false);
}

async function newFileCommand(entry: TreeEntry, treeProvider: SlnxTreeProvider): Promise<void> {
    const target: FileSystemTarget | undefined = resolveEntryTarget(entry);
    if (!target || !target.isDirectory) {
        return;
    }
    const fileName: string | undefined = await vscode.window.showInputBox({ prompt: vscode.l10n.t("New file name") });
    if (!fileName) {
        return;
    }
    const filePath: string = path.join(target.absolutePath, fileName);
    if (fs.existsSync(filePath)) {
        vscode.window.showErrorMessage(vscode.l10n.t('"{0}" already exists.', fileName));
        return;
    }
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new Uint8Array());
    treeProvider.refresh();
    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document);
}

async function newFolderCommand(entry: TreeEntry, treeProvider: SlnxTreeProvider): Promise<void> {
    const target: FileSystemTarget | undefined = resolveEntryTarget(entry);
    if (!target || !target.isDirectory) {
        return;
    }
    const folderName: string | undefined = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("New folder name"),
    });
    if (!folderName) {
        return;
    }
    const folderPath: string = path.join(target.absolutePath, folderName);
    if (fs.existsSync(folderPath)) {
        vscode.window.showErrorMessage(vscode.l10n.t('"{0}" already exists.', folderName));
        return;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(folderPath));
    treeProvider.refresh();
}

async function renameCommand(entry: TreeEntry, treeProvider: SlnxTreeProvider): Promise<void> {
    const target: FileSystemTarget | undefined = resolveEntryTarget(entry);
    if (!target) {
        return;
    }
    const oldName: string = path.basename(target.absolutePath);
    const newName: string | undefined = await vscode.window.showInputBox({
        prompt: vscode.l10n.t("New name"),
        value: oldName,
    });
    if (!newName || newName === oldName) {
        return;
    }
    const newPath: string = path.join(path.dirname(target.absolutePath), newName);
    if (fs.existsSync(newPath)) {
        vscode.window.showErrorMessage(vscode.l10n.t('"{0}" already exists.', newName));
        return;
    }
    await vscode.workspace.fs.rename(vscode.Uri.file(target.absolutePath), vscode.Uri.file(newPath));
    treeProvider.refresh();
}

async function deleteCommand(entry: TreeEntry, treeProvider: SlnxTreeProvider): Promise<void> {
    const target: FileSystemTarget | undefined = resolveEntryTarget(entry);
    if (!target) {
        return;
    }
    const name: string = path.basename(target.absolutePath);
    const confirmLabel: string = vscode.l10n.t("Move to Trash");
    const confirmed: string | undefined = await vscode.window.showWarningMessage(
        vscode.l10n.t('Move "{0}" to Trash?', name),
        { modal: true },
        confirmLabel
    );
    if (confirmed !== confirmLabel) {
        return;
    }
    await vscode.workspace.fs.delete(vscode.Uri.file(target.absolutePath), { recursive: true, useTrash: true });
    treeProvider.refresh();
}

interface ClipboardState {
    absolutePath: string;
    mode: "copy" | "cut";
}

let clipboardState: ClipboardState | undefined;

function setClipboard(absolutePath: string, mode: "copy" | "cut"): void {
    clipboardState = { absolutePath, mode };
    void vscode.commands.executeCommand("setContext", "slnxExplorer.hasClipboardItem", true);
}

function copyItemCommand(entry: TreeEntry): void {
    const target: FileSystemTarget | undefined = resolveEntryTarget(entry);
    if (target) {
        setClipboard(target.absolutePath, "copy");
    }
}

function cutItemCommand(entry: TreeEntry): void {
    const target: FileSystemTarget | undefined = resolveEntryTarget(entry);
    if (target) {
        setClipboard(target.absolutePath, "cut");
    }
}

/** Подбирает свободное имя вида "name (copy)", "name (copy 2)", ..., если путь назначения уже занят. */
function resolveUniqueDestination(destinationPath: string): string {
    if (!fs.existsSync(destinationPath)) {
        return destinationPath;
    }

    const dir: string = path.dirname(destinationPath);
    const ext: string = path.extname(destinationPath);
    const baseName: string = path.basename(destinationPath, ext);

    let attempt = 1;
    let candidate: string;
    do {
        attempt += 1;
        const suffix: string = attempt === 2 ? " (copy)" : ` (copy ${attempt - 1})`;
        candidate = path.join(dir, `${baseName}${suffix}${ext}`);
    } while (fs.existsSync(candidate));

    return candidate;
}

async function pasteItemCommand(entry: TreeEntry, treeProvider: SlnxTreeProvider): Promise<void> {
    const target: FileSystemTarget | undefined = resolveEntryTarget(entry);
    if (!target || !clipboardState) {
        return;
    }

    const destinationDir: string = target.isDirectory ? target.absolutePath : path.dirname(target.absolutePath);
    const destinationPath: string = resolveUniqueDestination(
        path.join(destinationDir, path.basename(clipboardState.absolutePath))
    );
    const sourceUri: vscode.Uri = vscode.Uri.file(clipboardState.absolutePath);
    const destinationUri: vscode.Uri = vscode.Uri.file(destinationPath);

    try {
        if (clipboardState.mode === "copy") {
            await vscode.workspace.fs.copy(sourceUri, destinationUri, { overwrite: false });
        } else {
            await vscode.workspace.fs.rename(sourceUri, destinationUri, { overwrite: false });
            clipboardState = undefined;
            void vscode.commands.executeCommand("setContext", "slnxExplorer.hasClipboardItem", false);
        }
    } catch (error) {
        vscode.window.showErrorMessage(vscode.l10n.t("Could not paste: {0}", String(error)));
        return;
    }

    treeProvider.refresh();
}

// #endregion

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    void vscode.commands.executeCommand("setContext", "slnxExplorer.hasClipboardItem", false);

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

    const runNpmScriptCommandDisposable = vscode.commands.registerCommand(
        "slnxExplorer.runNpmScript",
        (entry: { absolutePath?: string }) => runNpmScriptCommand(entry)
    );

    const copyPathCommandDisposable = vscode.commands.registerCommand("slnxExplorer.copyPath", copyPathCommand);
    const copyRelativePathCommandDisposable = vscode.commands.registerCommand(
        "slnxExplorer.copyRelativePath",
        copyRelativePathCommand
    );
    const openInTerminalCommandDisposable = vscode.commands.registerCommand(
        "slnxExplorer.openInTerminal",
        openInTerminalCommand
    );
    const newFileCommandDisposable = vscode.commands.registerCommand("slnxExplorer.newFile", (entry: TreeEntry) =>
        newFileCommand(entry, treeProvider)
    );
    const newFolderCommandDisposable = vscode.commands.registerCommand("slnxExplorer.newFolder", (entry: TreeEntry) =>
        newFolderCommand(entry, treeProvider)
    );
    const renameCommandDisposable = vscode.commands.registerCommand("slnxExplorer.rename", (entry: TreeEntry) =>
        renameCommand(entry, treeProvider)
    );
    const deleteCommandDisposable = vscode.commands.registerCommand("slnxExplorer.delete", (entry: TreeEntry) =>
        deleteCommand(entry, treeProvider)
    );
    const copyItemCommandDisposable = vscode.commands.registerCommand("slnxExplorer.copyItem", copyItemCommand);
    const cutItemCommandDisposable = vscode.commands.registerCommand("slnxExplorer.cutItem", cutItemCommand);
    const pasteItemCommandDisposable = vscode.commands.registerCommand("slnxExplorer.pasteItem", (entry: TreeEntry) =>
        pasteItemCommand(entry, treeProvider)
    );

    // Убираем закрытый пользователем терминал из кэша, чтобы следующий запуск создал новый.
    const terminalCloseListener = vscode.window.onDidCloseTerminal((closedTerminal: vscode.Terminal) => {
        for (const [key, terminal] of terminalCache) {
            if (terminal === closedTerminal) {
                terminalCache.delete(key);
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
        runNpmScriptCommandDisposable,
        copyPathCommandDisposable,
        copyRelativePathCommandDisposable,
        openInTerminalCommandDisposable,
        newFileCommandDisposable,
        newFolderCommandDisposable,
        renameCommandDisposable,
        deleteCommandDisposable,
        copyItemCommandDisposable,
        cutItemCommandDisposable,
        pasteItemCommandDisposable,
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
