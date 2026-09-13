# SLNX Solution Explorer

A minimal VS Code / VSCodium extension that opens Visual Studio `.slnx`
solution files and shows a tree of the projects inside — including
project types VS Code has no native support for (`.esproj`, and in
general anything that isn't `.csproj`).

Instead of trying to understand a project type's own MSBuild internals
(which are undocumented for types like `.esproj`), the extension takes
a simpler approach: it parses the `.slnx` XML itself to find each
project's path, then shows the real folder contents next to that
project file. This means it works with *any* project type declared in
a `.slnx`, not just the ones someone has written a dedicated VS Code
extension for.

The extension's own UI is available in **English and Russian**.

## Prerequisites

`@vscode/vsce` (the packaging tool) depends on a version of `undici`
that requires Node.js **20.18.1 or newer** — it crashes with
`ReferenceError: File is not defined` on Node 18. Check your version
first:

```bash
node -v
```

If it's below 20.18.1, install a newer Node using the instructions for
your OS below before continuing.

### Installing Node 20+ on Linux

Use `nvm` so you don't touch your system-wide Node install (no `sudo`
needed, and other projects that rely on the system Node keep working):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc        # or open a new terminal
nvm install 20
nvm use 20
node -v                 # should print v20.x
```

`nvm use 20` only affects the current terminal session. Switch back to
your system Node with `nvm use 18` (or whatever version) when you need
it. To avoid switching manually every time you work on this project,
drop a `.nvmrc` file containing `20` in the project root — then a bare
`nvm use` picks up the right version automatically.

### Installing Node 20+ on Windows

Use `nvm-windows` (a different tool from `nvm`, made specifically for
Windows):

1. Download the installer from
   [github.com/coreybutler/nvm-windows/releases](https://github.com/coreybutler/nvm-windows/releases)
   (`nvm-setup.exe`).
2. Run it and finish the setup wizard.
3. Open a **new** PowerShell or Command Prompt window and run:

   ```powershell
   nvm install 20
   nvm use 20
   node -v
   ```

   `node -v` should print `v20.x`. If PowerShell refuses to run `nvm`
   due to execution policy, run PowerShell as Administrator once and
   allow it, or use Command Prompt instead.
4. Switch back to another installed version later with `nvm use 18`
   (or whichever version number) if needed.

## Installing vsce (both platforms, once Node 20+ is active)

```bash
npm install -g @vscode/vsce
```

No need to pin a specific version — recent `@vscode/vsce` releases
expect Node 20+ anyway, so once Node is upgraded this installs and
runs cleanly. Verify with:

```bash
vsce --version
```

If you previously installed `@vscode/vsce` globally while on Node 18
(especially via `sudo npm install -g ...` on Linux), remove that
broken install to avoid confusion about which one actually runs:

```bash
sudo npm uninstall -g @vscode/vsce
```

## Project setup

Clone or extract the project, then from its root folder:

```bash
npm install
```

This pulls in `fast-xml-parser` (used to parse `.slnx`), TypeScript,
and the VS Code type definitions.

## Building the project (compiling TypeScript)

```bash
npm run compile
```

This produces the `out/` folder with the compiled `extension.js`. The
extension won't run without it. Use `npm run watch` instead during
active development to recompile on every save.

## Building the extension package (.vsix)

From the project root, with Node 20+ and `vsce` active:

```bash
vsce package
```

This produces `slnx-explorer-0.1.0.vsix` in the project folder. If
`vsce` warns about a missing `repository` field or similar metadata,
that's just a warning — the `.vsix` is still built correctly.

## Installing the extension in Visual Studio Code

Either:

- Open the **Extensions** view (`Ctrl+Shift+X`), click the `...` menu
  in the top-right of the panel, choose **Install from VSIX...**, and
  select `slnx-explorer-0.1.0.vsix`.

Or from a terminal:

```bash
code --install-extension slnx-explorer-0.1.0.vsix
```

## Installing the extension in VSCodium

Same idea, different command name since VSCodium ships its own CLI:

- Open the **Extensions** view (`Ctrl+Shift+X`), click the `...` menu,
  choose **Install from VSIX...**, and select the same `.vsix` file.

Or from a terminal:

```bash
codium --install-extension slnx-explorer-0.1.0.vsix
```

After installing, restart VS Code / VSCodium if it doesn't prompt you
to reload automatically.

## Using it

Open the folder containing your `.slnx` file (`File → Open Folder...`).
The extension detects it automatically and adds a **SLNX Solution**
icon to the activity bar. If multiple `.slnx` files are found, or none
are auto-detected, use the **SLNX: Open .slnx file...** command from
the view's title bar.

## Possible future improvements

- File-type-specific icons in the tree (currently uses generic
  `ThemeIcon`s).
- Commands for creating/renaming/deleting files directly from the
  tree — currently browse-and-open only.
- Watching the `.slnx` file for external changes (currently only a
  manual **Refresh** button).
- A distinct icon or badge per project extension (`.esproj`,
  `.csproj`, etc.) instead of a plain text description.
