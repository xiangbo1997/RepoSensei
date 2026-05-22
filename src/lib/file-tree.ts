export interface FileEntry {
  path: string;
  size: number;
}

export interface FileListing {
  root: string;
  files: FileEntry[];
}

export interface FileContent {
  path: string;
  size: number;
  content: string;
}

export type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string; size: number };

/**
 * Build a nested tree from a flat list of file paths ("a/b/c.ts").
 * Directories are sorted before files; both alphabetically.
 */
export function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { kind: "dir", name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let cursor: TreeNode = root;
    for (let i = 0; i < parts.length; i++) {
      if (cursor.kind !== "dir") break;
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join("/");
      let next: TreeNode | undefined = cursor.children.find(
        (c) => c.name === name,
      );
      if (!next) {
        next = isLast
          ? { kind: "file", name, path: childPath, size: file.size }
          : { kind: "dir", name, path: childPath, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
  }
  sortTree(root);
  return root;
}

function sortTree(node: TreeNode) {
  if (node.kind !== "dir") return;
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) sortTree(c);
}

/**
 * Map file extension to a shiki language id. Returns "text" when unknown so
 * the highlighter still works (just no colors).
 */
export function languageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    mdx: "markdown",
    rs: "rust",
    py: "python",
    go: "go",
    java: "java",
    kt: "kotlin",
    rb: "ruby",
    php: "php",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    hpp: "cpp",
    cs: "csharp",
    swift: "swift",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    fish: "shell",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    xml: "xml",
    vue: "vue",
    svelte: "svelte",
    sql: "sql",
    dockerfile: "docker",
  };
  const byExt = map[ext];
  if (byExt) return byExt;
  // Special filenames
  const base = path.split("/").pop()?.toLowerCase() ?? "";
  if (base === "dockerfile") return "docker";
  if (base === "makefile") return "makefile";
  return "text";
}
