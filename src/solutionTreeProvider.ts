import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { SolutionNode, parseSlnx, KNOWN_PROJECT_EXTENSIONS } from "./solutionModel";

// #region Tree item kinds

/**
 * Элемент дерева — либо узел solution (папка/проект из .slnx),
 * либо обычный файл/директория на диске внутри папки проекта.
 */
type TreeEntry =
    | { source: "solution"; node: SolutionNode }
    | { source: "filesystem"; absolutePath: string; isDirectory: boolean };

const DIRECTORIES_TO_SKIP: ReadonlySet<string> = new Set([
    "node_modules",
    "bin",
    "obj",
    ".git",
]);

// #endregion

export class SlnxTreeProvider implements vscode.TreeDataProvider<TreeEntry> {
    private readonly onDidChangeTreeDataEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeTreeData: vscode.Event<void> = this.onDidChangeTreeDataEmitter.event;

    private slnxFilePath: string | undefined;
    private topLevelNodes: SolutionNode[] = [];

    public getSolutionPath(): string | undefined {
        return this.slnxFilePath;
    }

    public loadSolution(slnxFilePath: string): void {
        this.slnxFilePath = slnxFilePath;
        this.topLevelNodes = parseSlnx(slnxFilePath);
        this.refresh();
    }

    public refresh(): void {
        if (this.slnxFilePath && fs.existsSync(this.slnxFilePath)) {
            this.topLevelNodes = parseSlnx(this.slnxFilePath);
        }
        this.onDidChangeTreeDataEmitter.fire();
    }

    // #region TreeDataProvider

    public getTreeItem(entry: TreeEntry): vscode.TreeItem {
        if (entry.source === "solution") {
            return this.buildSolutionTreeItem(entry.node);
        }
        return this.buildFilesystemTreeItem(entry.absolutePath, entry.isDirectory);
    }

    public getChildren(entry?: TreeEntry): TreeEntry[] {
        if (!entry) {
            return this.topLevelNodes.map((node: SolutionNode) => ({ source: "solution", node }));
        }

        if (entry.source === "solution") {
            return this.getChildrenOfSolutionNode(entry.node);
        }

        return this.getChildrenOfDirectory(entry.absolutePath);
    }

    // #endregion

    // #region private helpers

    private getChildrenOfSolutionNode(node: SolutionNode): TreeEntry[] {
        if (node.kind === "folder") {
            return node.children.map((child: SolutionNode) => ({ source: "solution", node: child }));
        }

        // Проект: подгружаем реальные файлы из его каталога на диске,
        // независимо от того, есть ли отдельная поддержка типа проекта.
        if (node.absolutePath) {
            const projectDir: string = path.dirname(node.absolutePath);
            return this.getChildrenOfDirectory(projectDir);
        }

        return [];
    }

    private getChildrenOfDirectory(directoryPath: string): TreeEntry[] {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(directoryPath, { withFileTypes: true });
        } catch {
            return [];
        }

        const visible: fs.Dirent[] = entries.filter(
            (entry: fs.Dirent) => !entry.name.startsWith(".") || entry.name === ".vscode"
        );

        const directories: TreeEntry[] = visible
            .filter((entry: fs.Dirent) => entry.isDirectory() && !DIRECTORIES_TO_SKIP.has(entry.name))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((entry: fs.Dirent) => ({
                source: "filesystem" as const,
                absolutePath: path.join(directoryPath, entry.name),
                isDirectory: true,
            }));

        const files: TreeEntry[] = visible
            .filter((entry: fs.Dirent) => entry.isFile())
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((entry: fs.Dirent) => ({
                source: "filesystem" as const,
                absolutePath: path.join(directoryPath, entry.name),
                isDirectory: false,
            }));

        return [...directories, ...files];
    }

    private buildSolutionTreeItem(node: SolutionNode): vscode.TreeItem {
        if (node.kind === "folder") {
            const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = "slnxFolder";
            item.iconPath = new vscode.ThemeIcon("folder-library");
            return item;
        }

        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = "slnxProject";
        item.resourceUri = node.absolutePath ? vscode.Uri.file(node.absolutePath) : undefined;
        item.iconPath = new vscode.ThemeIcon("package");

        const friendlyType: string | undefined = node.extension
            ? KNOWN_PROJECT_EXTENSIONS[node.extension]
            : undefined;
        item.description = friendlyType ?? node.extension ?? "";
        item.tooltip = node.absolutePath;

        return item;
    }

    private buildFilesystemTreeItem(absolutePath: string, isDirectory: boolean): vscode.TreeItem {
        const name: string = path.basename(absolutePath);

        if (isDirectory) {
            const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Collapsed);
            item.resourceUri = vscode.Uri.file(absolutePath);
            item.contextValue = "slnxDirectory";
            item.iconPath = vscode.ThemeIcon.Folder;
            return item;
        }

        const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
        item.resourceUri = vscode.Uri.file(absolutePath);
        item.contextValue = "slnxFile";
        item.iconPath = vscode.ThemeIcon.File;
        item.command = {
            command: "slnxExplorer.openFile",
            title: "Открыть файл",
            arguments: [vscode.Uri.file(absolutePath)],
        };
        return item;
    }

    // #endregion
}
