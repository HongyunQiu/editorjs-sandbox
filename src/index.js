import './index.css';
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { OpenWebContainer } from './vendor/open-web-container-core.js';

const TOOL_TITLE = '前端沙箱';
const DEFAULT_TRANSCRIPT = 'Initializing OpenWebContainer...\r\n';
const MAX_TRANSCRIPT_LENGTH = 24000;

function ensureWorkspacePrefix(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/workspace/')) return raw;
  if (raw.startsWith('/')) return '/workspace' + raw;
  return '/workspace/' + raw.replace(/^\.?\//, '');
}

function buildInitialFiles(data, noteContextText) {
  const files = {};
  const savedFiles = data && data.files && typeof data.files === 'object' ? data.files : {};
  Object.keys(savedFiles).forEach((path) => {
    const normalizedPath = ensureWorkspacePrefix(path);
    if (!normalizedPath) return;
    files[normalizedPath] = String(savedFiles[path] == null ? '' : savedFiles[path]);
  });

  if (!files['/workspace/README.md']) {
    files['/workspace/README.md'] = [
      '# QNotes Sandbox',
      '',
      'This is a browser sandbox block backed by OpenWebContainer.',
      '',
      'Try typing directly in the terminal:',
      '- ls',
      '- pwd',
      '- cat README.md',
      '- cat note-context.md',
      '- node hello.js'
    ].join('\n');
  }

  if (!files['/workspace/hello.js']) {
    files['/workspace/hello.js'] = [
      "console.log('Hello from QNotes sandbox');",
      "console.log('Terminal input is now connected directly to the shell process.');"
    ].join('\n');
  }

  if (noteContextText && !files['/workspace/note-context.md']) {
    files['/workspace/note-context.md'] = String(noteContextText);
  }

  return files;
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
      lastInput: {}
    };
  }

  constructor({ data, config, readOnly }) {
    this.config = config || {};
    this.readOnly = !!readOnly;
    this.data = {
      transcript: typeof data?.transcript === 'string' ? data.transcript : DEFAULT_TRANSCRIPT,
      files: data?.files && typeof data.files === 'object' ? data.files : {},
      status: typeof data?.status === 'string' ? data.status : '',
      lastInput: typeof data?.lastInput === 'string' ? data.lastInput : ''
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
    this.setStatus(forceReset ? 'Resetting sandbox...' : 'Starting sandbox...');
    try {
      await this.disposeContainer();
      this.initialized = false;
      this.container = new OpenWebContainer();

      const noteContextText = typeof this.config.getCurrentNoteContext === 'function'
        ? await this.config.getCurrentNoteContext()
        : '';
      const files = buildInitialFiles(this.data, noteContextText);

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
      this.initialized = true;
      this.fitTerminal();
      this.setStatus('Sandbox ready. Type directly in the terminal.');
    } catch (error) {
      const message = error && error.message ? error.message : String(error || 'Failed to start sandbox');
      this.setStatus(message, true);
      this.appendOutput(`\r\n[Sandbox error] ${message}\r\n`);
    } finally {
      this.busy = false;
      this.applyReadOnly();
    }
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
    this.data.transcript = clipTranscript(this.data.transcript || '');
    return {
      transcript: this.data.transcript,
      files: this.data.files,
      status: this.data.status,
      lastInput: this.data.lastInput
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
    this.fitAddon = null;
  }
}

if (typeof window !== 'undefined') {
  window.SandboxTool = SandboxTool;
}

export default SandboxTool;
