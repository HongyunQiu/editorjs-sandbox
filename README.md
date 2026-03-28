# editorjs-sandbox

`editorjs-sandbox` is an Editor.js block tool used by QNotes to embed a browser-side terminal sandbox inside a note.

The block is backed by `OpenWebContainer` and is designed for lightweight frontend experiments directly inside the editor. The current workspace root inside the sandbox is `/workspace`.

## Features

- Interactive terminal inside an Editor.js block
- Persistent workspace files stored in block data
- Default starter files such as `README.md`, `hello.js`, and `note-context.md`
- Browser-side JavaScript execution via the bundled sandbox runtime
- Reset and clear actions for fast iteration

## Project Structure

- `src/index.js`: Editor.js block tool implementation
- `src/index.css`: block styles
- `src/vendor/open-web-container-core.js`: embedded sandbox runtime
- `test/path-resolution.test.cjs`: regression tests for sandbox path handling
- `build_dist_copy.bat`: builds the plugin and copies the UMD bundle into QNotes

## Development

Install dependencies:

```bash
npm install
```

Run the Vite dev build:

```bash
npm run dev
```

Build the plugin:

```bash
npm run build
```

Run regression tests:

```bash
npm test
```

## Copy To QNotes

This plugin is consumed by the main QNotes app through the built UMD bundle.

Build and copy in one step on Windows:

```bat
build_dist_copy.bat
```

That command writes:

- `dist/sandbox.umd.js`
- `../../QNotes/public/vendor/editorjs-sandbox/sandbox.umd.js`

## Notes

- `dist/` and `node_modules/` are intentionally ignored in git.
- The QNotes app must also register the `sandbox` tool key in its editor tool registry and supported block whitelist.
- A path-resolution regression test is included because ZenFS normalizes relative paths like `hello.js` to `/hello.js` unless the sandbox resolves them against the current working directory first.
