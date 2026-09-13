import * as path from "path";
import * as fs from "fs";
import { XMLParser } from "fast-xml-parser";

// #region Types

export type SolutionNodeKind = "folder" | "project";

export interface SolutionNode {
    kind: SolutionNodeKind;
    name: string;
    /** Абсолютный путь: для проекта — файл проекта, для папки — undefined. */
    absolutePath?: string;
    /** Расширение файла проекта, например ".esproj", ".csproj". Только для kind === "project". */
    extension?: string;
    children: SolutionNode[];
}

// #endregion

// #region XML shapes (то, что реально лежит в .slnx)

interface RawProjectElement {
    "@_Path"?: string;
}

interface RawFolderElement {
    "@_Name"?: string;
    Project?: RawProjectElement | RawProjectElement[];
    Folder?: RawFolderElement | RawFolderElement[];
}

interface RawSolutionRoot {
    Solution?: {
        Project?: RawProjectElement | RawProjectElement[];
        Folder?: RawFolderElement | RawFolderElement[];
    };
}

// #endregion

const xmlParser: XMLParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
});

/** Приводит "элемент или массив элементов или undefined" к обычному массиву. */
function toArray<T>(value: T | T[] | undefined): T[] {
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function buildProjectNode(raw: RawProjectElement, solutionDir: string): SolutionNode | undefined {
    const relativePath: string | undefined = raw["@_Path"];
    if (!relativePath) {
        return undefined;
    }

    const absolutePath: string = path.resolve(solutionDir, relativePath);
    const extension: string = path.extname(absolutePath);
    const name: string = path.basename(absolutePath);

    return {
        kind: "project",
        name,
        absolutePath,
        extension,
        children: [],
    };
}

function buildFolderNode(raw: RawFolderElement, solutionDir: string): SolutionNode {
    const children: SolutionNode[] = [];

    for (const rawProject of toArray(raw.Project)) {
        const projectNode: SolutionNode | undefined = buildProjectNode(rawProject, solutionDir);
        if (projectNode) {
            children.push(projectNode);
        }
    }

    for (const rawFolder of toArray(raw.Folder)) {
        children.push(buildFolderNode(rawFolder, solutionDir));
    }

    return {
        kind: "folder",
        name: raw["@_Name"] ?? "Solution Items",
        children,
    };
}

/**
 * Разбирает .slnx файл и возвращает список узлов верхнего уровня
 * (проекты и папки solution, как они объявлены в XML).
 */
export function parseSlnx(slnxFilePath: string): SolutionNode[] {
    const xmlText: string = fs.readFileSync(slnxFilePath, "utf-8");
    const parsed: RawSolutionRoot = xmlParser.parse(xmlText) as RawSolutionRoot;
    const solutionDir: string = path.dirname(slnxFilePath);

    const root = parsed.Solution;
    if (!root) {
        return [];
    }

    const topLevel: SolutionNode[] = [];

    for (const rawProject of toArray(root.Project)) {
        const projectNode: SolutionNode | undefined = buildProjectNode(rawProject, solutionDir);
        if (projectNode) {
            topLevel.push(projectNode);
        }
    }

    for (const rawFolder of toArray(root.Folder)) {
        topLevel.push(buildFolderNode(rawFolder, solutionDir));
    }

    return topLevel;
}

/**
 * Известные типы проектов Visual Studio, для которых у нас есть
 * человекочитаемое описание. Список не влияет на работу расширения —
 * только на подпись в дереве.
 */
export const KNOWN_PROJECT_EXTENSIONS: Record<string, string> = {
    ".esproj": "JavaScript/TypeScript (esproj)",
    ".csproj": "C# / .NET",
    ".vcxproj": "C++",
    ".vbproj": "VB.NET",
    ".pyproj": "Python",
    ".sqlproj": "SQL Server",
    ".shproj": "Shared project",
    ".njsproj": "Node.js (legacy)",
};
