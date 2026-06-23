import './index.css';
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { OpenWebContainer } from './vendor/open-web-container-core.js';
import { createDefaultWorkspaceFiles } from './default-sandbox-files.mjs';
import {
  buildWorkspaceManifest,
  buildWorkspaceSignaturePayload,
  ensureWorkspacePrefix,
  normalizeWorkspaceFiles,
  packWorkspaceFiles,
  sha256Hex,
  unpackWorkspaceArchive
} from './workspace-asset.mjs';

const TOOL_TITLE = '前端沙箱';
const DEFAULT_TRANSCRIPT = 'Initializing OpenWebContainer...\r\n';
const MAX_TRANSCRIPT_LENGTH = 24000;
const SANDBOX_PIPELINE_NAME = 'sandbox-assetize';

function toDirtyPayload(data) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    transcript: typeof source.transcript === 'string' ? source.transcript : '',
    files: source.files && typeof source.files === 'object' ? source.files : {}
  };
}

function dirtyPayloadSignature(data) {
  try {
    return JSON.stringify(toDirtyPayload(data));
  } catch (_) {
    return '';
  }
}

function getQNotesApp() {
  if (typeof window === 'undefined') return null;
  return window.QNotesApp && typeof window.QNotesApp === 'object' ? window.QNotesApp : null;
}

function findPreviousBlockByIndex(app, index) {
  if (!app || !app.state || !app.state.lastRenderedEditorData || !Array.isArray(app.state.lastRenderedEditorData.blocks)) {
    return null;
  }
  if (!Number.isInteger(index) || index < 0) return null;
  return app.state.lastRenderedEditorData.blocks[index] || null;
}

function cloneAssetRef(asset) {
  if (!asset || typeof asset !== 'object') return null;
  const url = typeof asset.url === 'string' ? asset.url : '';
  if (!url) return null;
  return {
    url,
    name: typeof asset.name === 'string' ? asset.name : '',
    size: Number.isFinite(Number(asset.size)) ? Number(asset.size) : 0,
    mime: typeof asset.mime === 'string' ? asset.mime : 'application/zip',
    sha256: typeof asset.sha256 === 'string' ? asset.sha256 : ''
  };
}

function normalizeFileManifest(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const path = item && typeof item.path === 'string' ? ensureWorkspacePrefix(item.path) : '';
      if (!path) return null;
      return {
        path,
        size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0
      };
    })
    .filter(Boolean);
}

async function fetchWorkspaceFilesFromAsset(asset) {
  const assetUrl = asset && typeof asset.url === 'string' ? asset.url.trim() : '';
  if (!assetUrl) return {};

  const response = await fetch(assetUrl, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`failed to fetch sandbox asset: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return unpackWorkspaceArchive(buffer);
}

function buildInitialFiles(savedFiles, noteContextText) {
  const files = normalizeWorkspaceFiles(savedFiles);
  const defaultFiles = createDefaultWorkspaceFiles(noteContextText);
  Object.keys(defaultFiles).forEach((path) => {
    if (!files[path]) {
      files[path] = defaultFiles[path];
    }
  });

  return files;
}

async function assetizeSandboxBlock(app, block, index) {
  if (!block || block.type !== 'sandbox') {
    return block;
  }

  const fn = app && app.fn ? app.fn : null;
  if (!fn || typeof fn.uploadAttachmentBlobAsQNotes !== 'function') {
    return block;
  }

  const data = block.data && typeof block.data === 'object' ? { ...block.data } : {};
  const previousBlock = findPreviousBlockByIndex(app, index);
  const previousData = previousBlock && previousBlock.data && typeof previousBlock.data === 'object'
    ? previousBlock.data
    : {};
  const files = normalizeWorkspaceFiles(data.files);
  const manifest = buildWorkspaceManifest(files);
  const currentAsset = cloneAssetRef(data.asset);
  const previousAsset = cloneAssetRef(previousData.asset);
  const existingAsset = currentAsset || previousAsset;
  const existingSha = typeof data.filesSha256 === 'string' && data.filesSha256
    ? data.filesSha256
    : (existingAsset && typeof existingAsset.sha256 === 'string' ? existingAsset.sha256 : '');

  if (!manifest.length) {
    return {
      ...block,
      data: {
        ...data,
        files: {},
        asset: null,
        filesSha256: '',
        fileManifest: [],
      }
    };
  }

  const signaturePayload = buildWorkspaceSignaturePayload(files);
  const sha256 = await sha256Hex(signaturePayload);

  if (existingAsset && existingAsset.url && existingSha === sha256) {
    return {
      ...block,
      data: {
        ...data,
        files: {},
        asset: existingAsset,
        filesSha256: sha256,
        fileManifest: manifest,
      }
    };
  }

  const uploadCache = app.__sandboxAssetUploadCache = app.__sandboxAssetUploadCache || Object.create(null);
  if (uploadCache[sha256]) {
    return {
      ...block,
      data: {
        ...data,
        files: {},
        asset: uploadCache[sha256],
        filesSha256: sha256,
        fileManifest: manifest,
      }
    };
  }

  const zipBytes = packWorkspaceFiles(files);
  const filename = `sandbox-${sha256}.zip`;
  const blob = new Blob([zipBytes], { type: 'application/zip' });
  const uploadResult = await fn.uploadAttachmentBlobAsQNotes(blob, filename, { sha256 });
  if (!uploadResult || !uploadResult.file || !uploadResult.file.url) {
    throw new Error('Failed to upload sandbox workspace asset');
  }

  const asset = {
    url: String(uploadResult.file.url),
    name: typeof uploadResult.file.name === 'string' ? uploadResult.file.name : filename,
    size: Number.isFinite(Number(uploadResult.file.size)) ? Number(uploadResult.file.size) : zipBytes.byteLength,
    mime: 'application/zip',
    sha256,
  };
  uploadCache[sha256] = asset;

  return {
    ...block,
    data: {
      ...data,
      files: {},
      asset,
      filesSha256: sha256,
      fileManifest: manifest,
    }
  };
}

function ensureSandboxCommitPipelineRegistered() {
  const app = getQNotesApp();
  if (!app || !app.fn || typeof app.fn.registerBeforeCommitPipeline !== 'function') {
    return;
  }

  if (app.__sandboxCommitPipelineRegistered) {
    return;
  }

  app.fn.registerBeforeCommitPipeline(
    SANDBOX_PIPELINE_NAME,
    async (data) => {
      const editorData = data && typeof data === 'object' ? data : {};
      const blocks = Array.isArray(editorData.blocks) ? editorData.blocks : [];
      if (!blocks.length) {
        return editorData;
      }

      const nextBlocks = [];
      for (let index = 0; index < blocks.length; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        nextBlocks.push(await assetizeSandboxBlock(app, blocks[index], index));
      }

      return {
        ...editorData,
        blocks: nextBlocks,
      };
    }
  );

  app.__sandboxCommitPipelineRegistered = true;
}

function clipTranscript(text) {
  const value = String(text || '');
  if (value.length <= MAX_TRANSCRIPT_LENGTH) return value;
  return value.slice(value.length - MAX_TRANSCRIPT_LENGTH);
}

class SandboxTool {
  static get toolbox() {
    return {
      title: TOOL_TITLE,
      icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 7.5C4 6.11929 5.11929 5 6.5 5H17.5C18.8807 5 20 6.11929 20 7.5V16.5C20 17.8807 18.8807 19 17.5 19H6.5C5.11929 19 4 17.8807 4 16.5V7.5Z" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 9.5L10 12L7.5 14.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15H16.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get sanitize() {
    return {
      transcript: {},
      files: {},
      status: {},
      lastInput: {},
      asset: false,
      filesSha256: false,
      fileManifest: false
    };
  }

  constructor({ data, config, readOnly }) {
    ensureSandboxCommitPipelineRegistered();

    this.config = config || {};
    this.readOnly = !!readOnly;
    this.data = {
      transcript: typeof data?.transcript === 'string' ? data.transcript : DEFAULT_TRANSCRIPT,
      files: data?.files && typeof data.files === 'object' ? data.files : {},
      status: typeof data?.status === 'string' ? data.status : '',
      lastInput: typeof data?.lastInput === 'string' ? data.lastInput : '',
      asset: cloneAssetRef(data?.asset),
      filesSha256: typeof data?.filesSha256 === 'string' ? data.filesSha256 : '',
      fileManifest: normalizeFileManifest(data?.fileManifest)
    };

    this.wrapper = null;
    this.terminalHostEl = null;
    this.statusEl = null;
    this.resetBtnEl = null;
    this.clearBtnEl = null;

    this.container = null;
    this.shellProcess = null;
    this.shellListeners = [];
    this.initialized = false;
    this.busy = false;

    this.terminal = null;
    this.fitAddon = null;
    this.resizeHandler = null;
    this.suspendDataChange = false;
    this.lastDirtyPayloadSignature = dirtyPayloadSignature(this.data);
    this.handleWheelWithinSandbox = this.handleWheelWithinSandbox.bind(this);
  }

  render() {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'cdx-sandbox';
    this.wrapper.innerHTML = `
      <div class="cdx-sandbox__header">
        <div class="cdx-sandbox__title">
          <strong>${TOOL_TITLE}</strong>
          <span class="cdx-sandbox__status"></span>
        </div>
        <div class="cdx-sandbox__actions">
          <button type="button" class="cdx-sandbox__button" data-role="clear">Clear Output</button>
          <button type="button" class="cdx-sandbox__button" data-role="reset">Reset Sandbox</button>
        </div>
      </div>
      <div class="cdx-sandbox__terminal">
        <div class="cdx-sandbox__terminal-host"></div>
      </div>
    `;

    this.terminalHostEl = this.wrapper.querySelector('.cdx-sandbox__terminal-host');
    this.statusEl = this.wrapper.querySelector('.cdx-sandbox__status');
    this.resetBtnEl = this.wrapper.querySelector('[data-role="reset"]');
    this.clearBtnEl = this.wrapper.querySelector('[data-role="clear"]');

    this.resetBtnEl.addEventListener('click', () => {
      void this.bootSandbox(true);
    });
    this.clearBtnEl.addEventListener('click', () => {
      this.data.transcript = '';
      this.resetTerminalSurface();
      this.notifyDataChange('clear-output');
    });

    this.initTerminal();
    this.applyReadOnly();
    this.setStatus(this.data.status || 'Preparing browser sandbox...');
    void this.bootSandbox(false);

    return this.wrapper;
  }

  initTerminal() {
    if (!this.terminalHostEl || this.terminal) return;

    this.terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"Cascadia Mono", "Fira Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      theme: {
        background: '#020617',
        foreground: '#e5eefb',
        cursor: '#7dd3fc',
        black: '#020617',
        brightBlack: '#334155',
        green: '#86efac',
        brightGreen: '#bbf7d0',
        red: '#fca5a5',
        brightRed: '#fecaca',
        cyan: '#7dd3fc',
        brightCyan: '#bae6fd'
      }
    });
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.terminalHostEl);
    this.wrapper.addEventListener('wheel', this.handleWheelWithinSandbox, { passive: true });
    this.fitTerminal();
    this.resetTerminalSurface();

    this.terminal.onData((data) => {
      this.data.lastInput = data;
      if (this.readOnly || this.busy || !this.shellProcess) return;
      try {
        this.shellProcess.writeInput(data);
        if (data === '\r') {
          window.setTimeout(() => {
            this.data.files = this.snapshotFiles();
            this.data.fileManifest = buildWorkspaceManifest(this.data.files);
            this.notifyDataChange('terminal-enter');
          }, 80);
        }
      } catch (error) {
        const message = error && error.message ? error.message : String(error || 'Terminal input failed');
        this.setStatus(message, true);
      }
    });

    this.resizeHandler = () => {
      this.fitTerminal();
    };
    window.addEventListener('resize', this.resizeHandler);
  }

  fitTerminal() {
    if (!this.fitAddon) return;
    try {
      this.fitAddon.fit();
    } catch (_) {}
  }

  resetTerminalSurface() {
    if (!this.terminal) return;
    this.terminal.clear();
    if (this.data.transcript) {
      this.terminal.write(this.data.transcript);
    }
    this.terminal.scrollToBottom();
    this.fitTerminal();
  }

  async bootSandbox(forceReset) {
    if (this.busy) return;
    this.busy = true;
    this.suspendDataChange = true;
    this.setStatus(forceReset ? 'Resetting sandbox...' : 'Starting sandbox...');
    try {
      await this.disposeContainer();
      this.initialized = false;
      this.container = new OpenWebContainer({
        qnotesBridge: this.createQNotesBridge()
      });

      const noteContextText = typeof this.config.getCurrentNoteContext === 'function'
        ? await this.config.getCurrentNoteContext()
        : '';
      let persistedFiles = normalizeWorkspaceFiles(this.data.files);
      if (!Object.keys(persistedFiles).length && this.data.asset && this.data.asset.url) {
        try {
          persistedFiles = await fetchWorkspaceFilesFromAsset(this.data.asset);
        } catch (error) {
          const message = error && error.message ? error.message : String(error || 'Failed to load sandbox asset');
          this.appendOutput(`\r\n[Sandbox asset] ${message}\r\n`);
        }
      }
      const files = buildInitialFiles(persistedFiles, noteContextText);

      try {
        this.container.createDirectory('/workspace');
      } catch (_) {}
      Object.keys(files).forEach((path) => {
        this.container.writeFile(path, files[path]);
      });

      if (forceReset) {
        this.data.transcript = '';
      }
      this.resetTerminalSurface();

      this.shellProcess = await this.container.spawn('sh', ['--osc'], undefined, { cwd: '/workspace' });
      this.attachShellListeners(this.shellProcess);
      this.data.files = this.snapshotFiles();
      this.data.fileManifest = buildWorkspaceManifest(this.data.files);
      this.suspendDataChange = false;
      if (forceReset) {
        this.notifyDataChange('reset-sandbox');
      }
      this.initialized = true;
      this.fitTerminal();
      this.setStatus('Sandbox ready. Type directly in the terminal.');
    } catch (error) {
      this.suspendDataChange = false;
      const message = error && error.message ? error.message : String(error || 'Failed to start sandbox');
      this.setStatus(message, true);
      this.appendOutput(`\r\n[Sandbox error] ${message}\r\n`);
    } finally {
      this.suspendDataChange = false;
      this.busy = false;
      this.applyReadOnly();
    }
  }

  createQNotesBridge() {
    const bridge = this.config && this.config.qnotesBridge && typeof this.config.qnotesBridge === 'object'
      ? this.config.qnotesBridge
      : null;

    if (!bridge || typeof bridge.call !== 'function') {
      return null;
    }

    return {
      call: async (method, payload) => bridge.call(method, payload)
    };
  }

  attachShellListeners(process) {
    if (!process || typeof process.addEventListener !== 'function') return;

    const onMessage = (payload) => {
      if (payload && typeof payload.stdout === 'string') this.appendOutput(payload.stdout);
      if (payload && typeof payload.stderr === 'string') this.appendOutput(payload.stderr);
    };
    const onError = (payload) => {
      const message = payload && payload.error && payload.error.message
        ? payload.error.message
        : 'Shell process error';
      this.setStatus(message, true);
      this.appendOutput(`\r\n[Shell error] ${message}\r\n`);
    };
    const onExit = (payload) => {
      const exitCode = payload && payload.exitCode != null ? payload.exitCode : 'unknown';
      this.initialized = false;
      this.setStatus(`Shell exited with code ${exitCode}`, exitCode !== 0);
      this.data.files = this.snapshotFiles();
      this.data.fileManifest = buildWorkspaceManifest(this.data.files);
    };

    process.addEventListener('message', onMessage);
    process.addEventListener('error', onError);
    process.addEventListener('exit', onExit);
    this.shellListeners = [
      { event: 'message', handler: onMessage },
      { event: 'error', handler: onError },
      { event: 'exit', handler: onExit }
    ];
  }

  snapshotFiles() {
    if (!this.container) return this.data.files || {};
    const nextFiles = {};
    try {
      const paths = this.container.listFiles('/workspace') || [];
      paths.forEach((path) => {
        try {
          const text = this.container.readFile(path);
          if (typeof text === 'string') {
            nextFiles[path] = text;
          }
        } catch (_) {}
      });
    } catch (_) {}
    return nextFiles;
  }

  appendOutput(chunk) {
    const text = String(chunk || '');
    this.data.transcript = clipTranscript((this.data.transcript || '') + text);
    this.notifyDataChange('terminal-output');
    if (this.terminal) {
      this.terminal.write(text);
      this.terminal.scrollToBottom();
    }
  }

  setStatus(message, isError) {
    this.data.status = String(message || '');
    if (!this.statusEl) return;
    this.statusEl.textContent = this.data.status;
    this.statusEl.classList.toggle('is-error', !!isError);
  }

  handleWheelWithinSandbox(event) {
    if (!this.wrapper || !this.wrapper.contains(event.target)) return;
    event.stopPropagation();
  }

  notifyDataChange(reason) {
    if (this.suspendDataChange) return;
    const signature = dirtyPayloadSignature(this.data);
    if (!signature || signature === this.lastDirtyPayloadSignature) return;
    this.lastDirtyPayloadSignature = signature;
    if (this.config && typeof this.config.onDataChange === 'function') {
      try {
        this.config.onDataChange({ reason, data: toDirtyPayload(this.data) });
      } catch (_) {}
    }
  }

  applyReadOnly() {
    if (this.resetBtnEl) this.resetBtnEl.disabled = this.busy;
    if (this.clearBtnEl) this.clearBtnEl.disabled = false;
  }

  async disposeContainer() {
    if (this.shellProcess && Array.isArray(this.shellListeners) && typeof this.shellProcess.removeEventListener === 'function') {
      this.shellListeners.forEach(({ event, handler }) => {
        try {
          this.shellProcess.removeEventListener(event, handler);
        } catch (_) {}
      });
    }
    this.shellListeners = [];

    if (this.container && typeof this.container.dispose === 'function') {
      try {
        await this.container.dispose();
      } catch (_) {}
    }
    this.container = null;
    this.shellProcess = null;
  }

  save() {
    this.data.files = this.snapshotFiles();
    this.data.fileManifest = buildWorkspaceManifest(this.data.files);
    this.data.transcript = clipTranscript(this.data.transcript || '');
    this.lastDirtyPayloadSignature = dirtyPayloadSignature(this.data);
    return {
      transcript: this.data.transcript,
      files: this.data.files,
      status: this.data.status,
      lastInput: this.data.lastInput,
      asset: this.data.asset,
      filesSha256: this.data.filesSha256,
      fileManifest: this.data.fileManifest
    };
  }

  validate(savedData) {
    return !!savedData && typeof savedData === 'object';
  }

  destroyed() {
    void this.disposeContainer();
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.terminal) {
      try {
        this.terminal.dispose();
      } catch (_) {}
      this.terminal = null;
    }
    if (this.wrapper) {
      try {
        this.wrapper.removeEventListener('wheel', this.handleWheelWithinSandbox);
      } catch (_) {}
    }
    this.fitAddon = null;
  }
}

if (typeof window !== 'undefined') {
  window.SandboxTool = SandboxTool;
}

export default SandboxTool;
