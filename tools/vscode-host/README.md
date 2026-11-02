# Real VS Code host acceptance

`vscode-host.yml` builds and installs the real VSIX into an isolated current-stable Linux VS Code downloaded from Microsoft's official update API. Its archive SHA-256 must match the API metadata. The executable is only used on the Actions runner; it is not included in public artifacts.

Playwright connects to the local Chromium debugger of the isolated workbench inside Xvfb. It uses the real command palette, Chinese recording confirmation button, editor keyboard input, pause action and VS Code's built-in simple save dialog. No `vscode` API module is mocked and the extension has no test-only bypass. Workspace trust is disabled only for the disposable fixture profile. Neither a real user's profile nor their extensions directory is opened.

The exported certificate must verify against the actual saved file using the Rust CLI. A modified artifact must be refused. The evidence records official VS Code version/commit, archive hash, WorkProof source commit and UI screenshots. It covers this Linux stable runtime, not all platforms, historical versions, or native system file dialogs.

Sources: [Microsoft extension testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension), [Microsoft simple file dialog implementation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/dialogs/browser/simpleFileDialog.ts).

The disposable profile uses Chromium's basic password store because the runner has no interactive OS keyring; OS credential-store integration is outside this check. That profile is deleted and never uploaded.

Source prepared only. Compilation and UI execution must happen in Actions; no local test has been run.
