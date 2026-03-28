// src/process/base/event-emmiter.ts
var BrowserEventEmitter = class {
  constructor() {
    this.events = {};
    this.maxListeners = 10;
  }
  setMaxListeners(n) {
    this.maxListeners = n;
    return this;
  }
  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    if (this.events[event].length >= this.maxListeners) {
      console.warn(`MaxListenersExceededWarning: Possible memory leak detected. ${this.events[event].length} listeners added.`);
    }
    this.events[event].push(listener);
    return this;
  }
  off(event, listener) {
    return this.removeListener(event, listener);
  }
  emit(event, ...args) {
    if (!this.events[event]) return false;
    this.events[event].forEach((listener) => listener(...args));
    return true;
  }
  removeListener(event, listener) {
    if (!this.events[event]) return this;
    this.events[event] = this.events[event].filter((l) => l !== listener);
    return this;
  }
};

// src/process/base/types.ts
var ProcessState = /* @__PURE__ */ ((ProcessState2) => {
  ProcessState2["CREATED"] = "created";
  ProcessState2["RUNNING"] = "running";
  ProcessState2["COMPLETED"] = "completed";
  ProcessState2["FAILED"] = "failed";
  ProcessState2["TERMINATED"] = "terminated";
  return ProcessState2;
})(ProcessState || {});
var ProcessEvent = /* @__PURE__ */ ((ProcessEvent3) => {
  ProcessEvent3["START"] = "start";
  ProcessEvent3["EXIT"] = "exit";
  ProcessEvent3["ERROR"] = "error";
  ProcessEvent3["MESSAGE"] = "message";
  ProcessEvent3["SPAWN_CHILD"] = "spawn_child";
  return ProcessEvent3;
})(ProcessEvent || {});

// src/process/base/process.ts
var Process = class extends BrowserEventEmitter {
  constructor(pid, type, executablePath, args = [], parentPid, cwd, env) {
    super();
    this.env = /* @__PURE__ */ new Map();
    this.inputBuffer = [];
    this.inputCallbacks = [];
    this.terminated = false;
    this.pid = pid;
    this.type = type;
    this._state = "created" /* CREATED */;
    this._exitCode = null;
    this.executablePath = executablePath;
    this.args = args;
    this.parentPid = parentPid;
    this.cwd = cwd || "/";
    this.env = env || /* @__PURE__ */ new Map([
      ["PATH", "/bin:/usr/bin"],
      ["HOME", "/home"],
      ["PWD", cwd || "/"]
    ]);
    this.setMaxListeners(100);
  }
  /**
   * Process state getters
   */
  get state() {
    return this._state;
  }
  get exitCode() {
    return this._exitCode;
  }
  get uptime() {
    if (!this.startTime) return null;
    const endTime = this.endTime || /* @__PURE__ */ new Date();
    return endTime.getTime() - this.startTime.getTime();
  }
  /**
   * Get process statistics
   */
  getStats() {
    return {
      pid: this.pid,
      ppid: this.parentPid,
      type: this.type,
      state: this._state,
      exitCode: this._exitCode,
      executablePath: this.executablePath,
      args: this.args,
      startTime: this.startTime,
      endTime: this.endTime
    };
  }
  /**
   * Process input handling
   */
  writeInput(input) {
    if (this._state !== "running" /* RUNNING */) {
      throw new Error("Cannot write input to non-running process");
    }
    this.inputBuffer.push(input);
    this.processNextInput();
  }
  async readInput() {
    if (this.inputBuffer.length > 0) {
      return this.inputBuffer.shift();
    }
    return new Promise((resolve) => {
      this.inputCallbacks.push(resolve);
    });
  }
  processNextInput() {
    while (this.inputCallbacks.length > 0 && this.inputBuffer.length > 0) {
      const callback = this.inputCallbacks.shift();
      const input = this.inputBuffer.shift();
      callback(input);
    }
  }
  /**
   * Process lifecycle methods
   */
  async start() {
    try {
      if (this.state !== "created" /* CREATED */) {
        throw new Error(`Cannot start process in state: ${this.state}`);
      }
      this._state = "running" /* RUNNING */;
      this.startTime = /* @__PURE__ */ new Date();
      this.emit("start" /* START */, { pid: this.pid });
      await this.execute();
      if (!this.terminated) {
        this._state = "completed" /* COMPLETED */;
        this._exitCode = 0;
      }
    } catch (error) {
      this._state = "failed" /* FAILED */;
      this._exitCode = 1;
      this.emit("error" /* ERROR */, { pid: this.pid, error });
    } finally {
      this.endTime = /* @__PURE__ */ new Date();
      this.emit("exit" /* EXIT */, {
        pid: this.pid,
        exitCode: this._exitCode,
        uptime: this.uptime
      });
    }
  }
  async terminate() {
    if (this.state !== "running" /* RUNNING */) {
      return;
    }
    this.terminated = true;
    this._state = "terminated" /* TERMINATED */;
    this._exitCode = -1;
    this.endTime = /* @__PURE__ */ new Date();
    await this.onTerminate();
    this.emit("exit" /* EXIT */, {
      pid: this.pid,
      exitCode: this._exitCode,
      uptime: this.uptime
    });
  }
  async onTerminate() {
  }
  /**
   * Helper methods for child processes
   */
  async spawnChild(executable, args = [], env = {}) {
    return new Promise((resolve) => {
      this.emit("spawn_child" /* SPAWN_CHILD */, {
        payload: {
          executable,
          args,
          env
        },
        callback: resolve
      });
    });
  }
  /**
   * Helper methods for process output
   */
  emitOutput(stdout) {
    this.emit("message" /* MESSAGE */, { stdout });
  }
  emitError(stderr) {
    this.emit("message" /* MESSAGE */, { stderr });
  }
  emitMessage(message) {
    this.emit("message" /* MESSAGE */, message);
  }
  addEventListener(event, listener) {
    this.on(event, listener);
  }
  removeEventListener(event, listener) {
    this.off(event, listener);
  }
};

// src/process/executors/registry.ts
var ProcessRegistry = class {
  constructor() {
    this.executors = /* @__PURE__ */ new Map();
  }
  registerExecutor(type, executor) {
    this.executors.set(type, executor);
  }
  findExecutor(executable) {
    for (const [, executor] of this.executors.entries()) {
      if (executor.canExecute(executable)) {
        return executor;
      }
    }
    return void 0;
  }
};

// src/shell/commands/registry.ts
var CommandRegistry = class {
  constructor() {
    this.commands = /* @__PURE__ */ new Map();
  }
  register(name, commandClass) {
    this.commands.set(name, commandClass);
  }
  get(name) {
    return this.commands.get(name);
  }
  has(name) {
    return this.commands.has(name);
  }
  getAll() {
    return Array.from(this.commands.keys());
  }
};

// src/shell/commands/base.ts
var ShellCommand = class {
  constructor(options) {
    this.cwd = options.cwd;
    this.fileSystem = options.fileSystem;
    this.env = options.env || /* @__PURE__ */ new Map();
    this.process = options.process;
  }
  success(stdout = "") {
    return {
      stdout: stdout ? stdout + "\n" : "",
      stderr: "",
      exitCode: 0
    };
  }
  error(message, code = 1) {
    return {
      stdout: "",
      stderr: message + "\n",
      exitCode: code
    };
  }
  resolvePath(path) {
    if (path.startsWith("/")) {
      return path;
    }
    return `${this.cwd}/${path}`.replace(/\/+/g, "/");
  }
  showHelp() {
    const { name, description, usage, examples } = this.help;
    let output = `${name} - ${description}

`;
    output += `Usage: ${usage}

`;
    if (examples.length > 0) {
      output += "Examples:\n";
      examples.forEach((example) => {
        output += `  ${example}
`;
      });
    }
    return this.success(output);
  }
};

// src/shell/commands/curl.ts
var CurlCommand = class extends ShellCommand {
  get help() {
    return {
      name: "curl",
      description: "Transfer data from or to a server",
      usage: "curl [options] URL\nOptions:\n  -X <method>  HTTP method\n  -H <header>  Custom header\n  -o <file>    Output to file",
      examples: [
        "curl https://api.example.com",
        'curl -X POST -H "Content-Type: application/json" https://api.com',
        "curl -o output.json https://api.com/data"
      ]
    };
  }
  async execute(args) {
    try {
      const urlIndex = args.findIndex((arg) => !arg.startsWith("-"));
      if (urlIndex === -1) {
        return {
          stdout: "",
          stderr: "curl: URL required",
          exitCode: 1
        };
      }
      const url = args[urlIndex];
      const options = args.slice(0, urlIndex);
      const method = options.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
      const headers = {};
      const outputFile = options.includes("-o") ? args[args.indexOf("-o") + 1] : void 0;
      const followRedirects = !options.includes("--no-follow");
      const insecure = options.includes("-k") || options.includes("--insecure");
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-H" && args[i + 1]) {
          const headerStr = args[i + 1];
          const [key, ...valueParts] = headerStr.split(":");
          const value = valueParts.join(":").trim();
          headers[key.trim()] = value;
          i++;
        }
      }
      try {
        const response = await fetch(url, {
          method,
          headers: {
            ...headers,
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br"
          },
          redirect: followRedirects ? "follow" : "manual",
          // Ignore SSL certificate errors if -k flag is used
          mode: "cors"
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const responseText = await response.text();
        if (outputFile) {
          this.fileSystem.writeFile(this.resolvePath(outputFile), responseText);
          return {
            stdout: `  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                   Dload  Upload   Total   Spent    Left  Speed
100  ${responseText.length}  100  ${responseText.length}    0     0   ${Math.floor(responseText.length / 0.1)}      0  0:00:01 --:--:--  0:00:01 ${Math.floor(responseText.length / 0.1)}
`,
            stderr: "",
            exitCode: 0
          };
        }
        return {
          stdout: responseText + "\n",
          stderr: "",
          exitCode: 0
        };
      } catch (error) {
        return {
          stdout: "",
          stderr: `curl: (6) Could not resolve host: ${error.message}
`,
          exitCode: 6
        };
      }
    } catch (error) {
      return {
        stdout: "",
        stderr: `curl: ${error.message}
`,
        exitCode: 1
      };
    }
  }
};

// src/shell/commands/unzip.ts
import { unzip, inflate, gunzip } from "fflate";
var UnzipCommand = class extends ShellCommand {
  constructor(options) {
    super(options);
  }
  get help() {
    return {
      name: "unzip",
      description: "Extract compressed zip or tgz files",
      usage: `Usage: unzip [options] <file.zip|file.tgz> [destination]

Options:
  -l    List contents without extracting
  -v    Verbose mode showing file details
  -q    Quiet mode, suppress output
  -d    Extract files into directory
  --help Show this help message`,
      examples: [
        "unzip archive.zip",
        "unzip file.tgz output/",
        "unzip -l archive.zip",
        "unzip -v package.tgz",
        "unzip -d /target/dir archive.zip"
      ]
    };
  }
  async execute(args) {
    try {
      if (args.includes("--help")) {
        return this.showHelp();
      }
      if (args.length === 0) {
        return this.error("unzip: filename required");
      }
      const options = {
        listOnly: args.includes("-l"),
        verbose: args.includes("-v"),
        quiet: args.includes("-q")
      };
      let destination = ".";
      const cleanArgs = args.filter((arg, index) => {
        if (arg === "-d" && args[index + 1]) {
          destination = args[index + 1];
          return false;
        }
        return !arg.startsWith("-");
      });
      const filename = cleanArgs[0];
      destination = cleanArgs[1] || destination;
      const filepath = this.resolvePath(filename);
      const content = this.fileSystem.readBuffer(filepath);
      if (!content) {
        return this.error(`unzip: cannot find ${filename}`);
      }
      const uint8Array = new Uint8Array(content?.buffer, 0, content.length);
      if (filename.endsWith(".tgz") || filename.endsWith(".tar.gz")) {
        return this.handleTarGz(filename, uint8Array, destination, options);
      } else {
        return this.handleZip(filename, uint8Array, destination, options);
      }
    } catch (error) {
      return this.error(`unzip: ${error.message}`);
    }
  }
  async handleTarGz(filename, content, destination, options) {
    try {
      const inflated = await new Promise((resolve, reject) => {
        gunzip(content, (err, result) => {
          if (err) {
            inflate(content, (err2, result2) => {
              if (err2) {
                reject(new Error("Cannot decompress file. File may be corrupted."));
              } else {
                resolve(result2);
              }
            });
          } else {
            resolve(result);
          }
        });
      });
      if (!inflated || inflated.length === 0) {
        return this.error(`Decompressed file is empty: ${filename}`);
      }
      const files = this.parseTar(inflated);
      const outputLines = [];
      if (!options.quiet) {
        outputLines.push(`Archive:  ${filename}`);
      }
      if (options.listOnly) {
        outputLines.push("  Length      Date    Time    Name");
        outputLines.push("---------  ---------- -----   ----");
        let totalSize = 0;
        let totalFiles = 0;
        for (const file of files) {
          if (file.type === "file") {
            totalSize += file.size;
            totalFiles++;
            const date = file.mtime || /* @__PURE__ */ new Date();
            const dateStr = date.toISOString().split("T")[0];
            const timeStr = date.toTimeString().slice(0, 5);
            outputLines.push(
              `${file.size.toString().padStart(9)}  ${dateStr} ${timeStr}   ${file.name}`
            );
          }
        }
        outputLines.push("---------                     -------");
        outputLines.push(`${totalSize.toString().padStart(9)}                     ${totalFiles} file${totalFiles !== 1 ? "s" : ""}`);
        return this.success(outputLines.join("\n"));
      }
      let extractedCount = 0;
      const destPath = this.resolvePath(destination);
      for (const file of files) {
        const fullPath = `${destPath}/${file.name}`.replace(/\/+/g, "/");
        if (file.type === "directory") {
          this.fileSystem.createDirectory(fullPath);
          if (options.verbose && !options.quiet) {
            outputLines.push(`   creating: ${file.name}/`);
          }
        } else {
          const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
          if (parentDir) {
            this.fileSystem.createDirectory(parentDir);
          }
          const content2 = this.uint8ArrayToBase64(file.content);
          this.fileSystem.writeFile(fullPath, content2);
          if (!options.quiet) {
            if (options.verbose) {
              outputLines.push(` extracting: ${file.name}`);
            } else {
              this.log(".", false);
            }
          }
          extractedCount++;
        }
      }
      if (!options.quiet) {
        if (!options.verbose) {
          outputLines.push("");
        }
        outputLines.push(`${extractedCount} file${extractedCount !== 1 ? "s" : ""} extracted`);
      }
      return this.success(outputLines.join("\n"));
    } catch (error) {
      return this.error(`Cannot expand tar.gz: ${error.message}`);
    }
  }
  uint8ArrayToBase64(array) {
    const CHUNK_SIZE = 32 * 1024;
    let base64 = "";
    for (let i = 0; i < array.length; i += CHUNK_SIZE) {
      const chunk = array.slice(i, Math.min(i + CHUNK_SIZE, array.length));
      const binaryString = Array.from(chunk).map((byte) => String.fromCharCode(byte)).join("");
      base64 += btoa(binaryString);
    }
    return base64;
  }
  handleZip(filename, content, destination, options) {
    return new Promise((resolve, reject) => {
      unzip(content, (err, unzipped) => {
        if (err) {
          resolve(this.error(`Cannot expand zip: ${err.message}`));
          return;
        }
        const outputLines = [];
        if (!options.quiet) {
          outputLines.push(`Archive:  ${filename}`);
        }
        if (options.listOnly) {
          outputLines.push("  Length      Date    Time    Name");
          outputLines.push("---------  ---------- -----   ----");
          let totalSize = 0;
          let totalFiles = 0;
          for (const [path, file] of Object.entries(unzipped)) {
            const fileSize = file.length;
            totalSize += fileSize;
            totalFiles++;
            const date = /* @__PURE__ */ new Date();
            const dateStr = date.toISOString().split("T")[0];
            const timeStr = date.toTimeString().slice(0, 5);
            outputLines.push(
              `${fileSize.toString().padStart(9)}  ${dateStr} ${timeStr}   ${path}`
            );
          }
          outputLines.push("---------                     -------");
          outputLines.push(`${totalSize.toString().padStart(9)}                     ${totalFiles} file${totalFiles !== 1 ? "s" : ""}`);
          resolve(this.success(outputLines.join("\n")));
          return;
        }
        let extractedCount = 0;
        const destPath = this.resolvePath(destination);
        try {
          for (const [path, file] of Object.entries(unzipped)) {
            const fullPath = `${destPath}/${path}`.replace(/\/+/g, "/");
            const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
            if (parentDir) {
              this.fileSystem.createDirectory(parentDir);
            }
            const content2 = this.uint8ArrayToBase64(file);
            this.fileSystem.writeFile(fullPath, content2);
            if (!options.quiet) {
              if (options.verbose) {
                outputLines.push(` extracting: ${path} (${this.formatSize(file.length)})`);
              } else {
                this.log(".", false);
              }
            }
            extractedCount++;
          }
          if (!options.quiet) {
            if (!options.verbose) {
              outputLines.push("");
            }
            outputLines.push(`${extractedCount} file${extractedCount !== 1 ? "s" : ""} extracted`);
          }
          resolve(this.success(outputLines.join("\n")));
        } catch (error) {
          resolve(this.error(`Error extracting files: ${error.message}`));
        }
      });
    });
  }
  parseTar(buffer) {
    const files = [];
    let offset = 0;
    while (offset < buffer.length - 512) {
      const header = buffer.slice(offset, offset + 512);
      if (header.every((byte) => byte === 0)) {
        break;
      }
      const name = this.parseString(header, 0, 100).replace(/\0/g, "");
      const mode = parseInt(this.parseString(header, 100, 8), 8);
      const size = parseInt(this.parseString(header, 124, 12).trim(), 8);
      const mtime = new Date(parseInt(this.parseString(header, 136, 12).trim(), 8) * 1e3);
      const typeflag = String.fromCharCode(header[156]);
      const linkname = this.parseString(header, 157, 100).replace(/\0/g, "");
      offset += 512;
      if (typeflag === "5") {
        files.push({
          name,
          size: 0,
          type: "directory",
          content: new Uint8Array(0),
          mode,
          mtime
        });
      } else if (typeflag === "0" || typeflag === "" || typeflag === "7") {
        const content = buffer.slice(offset, offset + size);
        files.push({
          name,
          size,
          type: "file",
          content,
          mode,
          mtime
        });
        offset += Math.ceil(size / 512) * 512;
      }
    }
    return files;
  }
  parseString(buffer, offset, size) {
    return Array.from(buffer.slice(offset, offset + size)).map((byte) => String.fromCharCode(byte)).join("");
  }
  formatSize(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }
  log(message, newline = true) {
    this.process.emit("message" /* MESSAGE */, { stdout: message + (newline ? "\n" : "") });
  }
};

// src/shell/commands/wget.ts
var WgetCommand = class extends ShellCommand {
  get help() {
    return {
      name: "wget",
      description: "Download files from the web",
      usage: "wget [options] URL\nOptions:\n  -O <file>  Save to specific file\n  -q         Quiet mode\n  --header   Add custom header",
      examples: [
        "wget https://example.com/file.txt",
        "wget -O custom.txt https://example.com/file.txt",
        'wget --header "Authorization: Bearer token" https://api.com/data'
      ]
    };
  }
  async execute(args) {
    if (args.length === 0) {
      return {
        stdout: "",
        stderr: "wget: missing URL\nUsage: wget [options] URL\n",
        exitCode: 1
      };
    }
    const options = { headers: {} };
    const urls = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case "-O":
          options.outputFilename = args[++i];
          break;
        case "-q":
          options.quiet = true;
          break;
        case "--no-check-certificate":
          options.noCheck = true;
          options.noCheckCertificate = true;
          break;
        case "-c":
          options.continue = true;
          break;
        case "--debug":
          options.debug = true;
          break;
        case "--header":
        case "-H":
          const headerStr = args[++i];
          const [key, ...valueParts] = headerStr.split(":");
          const value = valueParts.join(":").trim();
          options.headers[key.trim()] = value;
          break;
        case "--timeout":
          options.timeout = parseInt(args[++i]) * 1e3;
          break;
        case "-t":
          options.retries = parseInt(args[++i]);
          break;
        default:
          if (!arg.startsWith("-")) {
            urls.push(arg);
          } else {
            return {
              stdout: "",
              stderr: `wget: unknown option ${arg}
`,
              exitCode: 1
            };
          }
      }
    }
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    for (const url of urls) {
      try {
        const result = await this.downloadFile(url, options);
        stdout += result.stdout;
        stderr += result.stderr;
        if (result.exitCode !== 0) exitCode = result.exitCode;
      } catch (error) {
        stderr += `wget: ${error.message}
`;
        exitCode = 1;
      }
    }
    return { stdout, stderr, exitCode };
  }
  async downloadFile(url, options) {
    const debugLog = [];
    const debug = (msg) => {
      if (options.debug) {
        const timestamp = (/* @__PURE__ */ new Date()).toISOString();
        const logMessage = `[DEBUG ${timestamp}] ${msg}`;
        debugLog.push(logMessage);
        this.log(logMessage);
      }
    };
    try {
      debug("Starting download process");
      debug(`URL: ${url}`);
      debug(`Options: ${JSON.stringify(options, null, 2)}`);
      let response = null;
      let proxyUsed = null;
      try {
        debug("Attempting direct fetch...");
        const fetchOptions = {
          headers: {
            "User-Agent": "wget/1.21.3",
            ...options.headers
          }
        };
        debug(`Fetch options: ${JSON.stringify(fetchOptions, null, 2)}`);
        response = await fetch(url, fetchOptions);
        debug(`Direct fetch response status: ${response.status}`);
        if (response.ok) {
          debug("Direct fetch successful");
        } else {
          debug(`Direct fetch failed with status ${response.status}`);
          response = null;
        }
      } catch (error) {
        debug(`Direct fetch failed: ${error.message}`);
        debug("Falling back to CORS proxies");
        response = null;
      }
      if (!response || !response.ok) {
        const corsProxies = [
          "https://corsproxy.io/?",
          "https://api.allorigins.win/raw?url=",
          "https://cors-anywhere.herokuapp.com/"
        ];
        for (const proxy of corsProxies) {
          const proxyUrl = `${proxy}${encodeURIComponent(url)}`;
          debug(`Attempting proxy: ${proxy}`);
          debug(`Full proxy URL: ${proxyUrl}`);
          try {
            response = await fetch(proxyUrl, {
              headers: {
                "User-Agent": "wget/1.21.3",
                ...options.headers
              }
            });
            debug(`Proxy response status: ${response.status}`);
            if (response.ok) {
              proxyUsed = proxy;
              debug(`Successfully connected using proxy: ${proxy}`);
              break;
            } else {
              debug(`Proxy ${proxy} returned status ${response.status}`);
            }
          } catch (e) {
            debug(`Proxy ${proxy} failed with error: ${e.message}`);
            continue;
          }
        }
      }
      if (!response || !response.ok) {
        debug("All fetch attempts failed");
        throw new Error(`Failed to fetch (HTTP ${response?.status || "unknown"})`);
      }
      let filename = options.outputFilename;
      const contentDisposition = response.headers.get("content-disposition");
      debug(`Content-Disposition: ${contentDisposition}`);
      if (!filename) {
        if (contentDisposition) {
          const matches = /filename=["']?([^"']+)["']?/.exec(contentDisposition);
          if (matches?.[1]) {
            filename = matches[1];
            debug(`Filename from Content-Disposition: ${filename}`);
          }
        }
        if (!filename) {
          filename = new URL(url).pathname.split("/").pop() || "index.html";
          debug(`Filename from URL: ${filename}`);
        }
      }
      const contentLength = response.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      debug(`Expected content length: ${total} bytes`);
      let received = 0;
      debug("Starting chunked download...");
      const chunks = [];
      const reader = response.body?.getReader();
      if (!reader) {
        debug("Failed to get response body reader");
        throw new Error("Unable to read response");
      }
      const startTime = Date.now();
      let lastProgressUpdate = startTime;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          debug("Download complete");
          break;
        }
        chunks.push(value);
        received += value.length;
        const now = Date.now();
        if (!options.quiet && now - lastProgressUpdate > 100) {
          const percent = total ? Math.round(received / total * 100) : 0;
          const speed = received / (now - startTime) * 1e3;
          this.log(`\rProgress: ${percent}% of ${this.formatSize(total)} at ${this.formatSpeed(speed)}`, false);
          lastProgressUpdate = now;
        }
        if (options.debug && received % (1024 * 1024) === 0) {
          debug(`Downloaded ${this.formatSize(received)} so far`);
        }
      }
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combinedArray = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combinedArray.set(chunk, offset);
        offset += chunk.length;
      }
      const fullPath = this.resolvePath(filename);
      this.fileSystem.writeBuffer(fullPath, combinedArray);
      const duration = (Date.now() - startTime) / 1e3;
      const finalSpeed = received / duration;
      if (!options.quiet) {
        this.log("\n");
        this.log(`Saved to: '${filename}'`);
        this.log(`100% [${this.formatSize(received)}] ${this.formatSpeed(finalSpeed)}`);
        this.log(`Total time: ${duration.toFixed(2)}s`);
        if (proxyUsed) {
          this.log(`Note: Used CORS proxy due to browser restrictions`);
        }
      }
      debug(`Download completed in ${duration.toFixed(2)} seconds`);
      debug(`Average speed: ${this.formatSpeed(finalSpeed)}`);
      return this.success();
    } catch (error) {
      debug(`Fatal error: ${error.message}`);
      if (error.stack) debug(`Error stack: ${error.stack}`);
      if (options.debug) {
        return this.error([
          `Download failed: ${error.message}`,
          "",
          "=== Debug Log ===",
          ...debugLog
        ].join("\n"));
      }
      return this.error(`Download failed: ${error.message}`);
    }
  }
  uint8ArrayToBase64(array) {
    const chunkSize = 32 * 1024;
    let base64 = "";
    for (let i = 0; i < array.length; i += chunkSize) {
      const chunk = array.slice(i, i + chunkSize);
      base64 += btoa(
        Array.from(chunk).map((byte) => String.fromCharCode(byte)).join("")
      );
    }
    return base64;
  }
  formatSize(bytes) {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return `${size.toFixed(1)}${units[unit]}`;
  }
  formatSpeed(bytesPerSecond) {
    return `${this.formatSize(bytesPerSecond)}/s`;
  }
  log(message, newline = true) {
    this.process.emit("message" /* MESSAGE */, { stdout: message + (newline ? "\n" : "") });
  }
};

// src/shell/shell.ts
var Shell = class {
  constructor(fileSystem, options) {
    this.commandHistory = [];
    this.historyIndex = -1;
    this.oscMode = false;
    this.buildInCommands = /* @__PURE__ */ new Map();
    this.fileSystem = fileSystem;
    this.env = options.env || /* @__PURE__ */ new Map([
      ["PATH", "/bin:/usr/bin"],
      ["HOME", "/home"],
      ["PWD", "/"]
    ]);
    this.currentDirectory = this.env.get("PWD") || "/";
    this.process = options.process;
    this.oscMode = options.oscMode || false;
    this.commandRegistry = new CommandRegistry();
    this.registerAllBuiltInCommands();
    this.registerAllExternalCommands();
  }
  registerBuiltInCommand(name, command) {
    this.buildInCommands.set(name, command);
  }
  registerExternalCommand(name, commandClass) {
    this.commandRegistry.register(name, commandClass);
  }
  registerAllBuiltInCommands() {
    this.registerBuiltInCommand("cd", this.cd.bind(this));
    this.registerBuiltInCommand("ls", this.ls.bind(this));
    this.registerBuiltInCommand("pwd", this.pwd.bind(this));
    this.registerBuiltInCommand("cat", this.cat.bind(this));
    this.registerBuiltInCommand("echo", this.echo.bind(this));
    this.registerBuiltInCommand("mkdir", this.mkdir.bind(this));
    this.registerBuiltInCommand("rm", this.rm.bind(this));
    this.registerBuiltInCommand("rmdir", this.rmdir.bind(this));
    this.registerBuiltInCommand("touch", this.touch.bind(this));
  }
  registerAllExternalCommands() {
    this.registerExternalCommand("curl", CurlCommand);
    this.registerExternalCommand("unzip", UnzipCommand);
    this.registerExternalCommand("wget", WgetCommand);
  }
  formatOscOutput(type, content) {
    if (!this.oscMode) return content;
    switch (type) {
      case "file":
        return `\x1B[34m${content}\x1B[0m`;
      case "directory":
        return `\x1B[1;34m${content}/\x1B[0m`;
      case "executable":
        return `\x1B[32m${content}*\x1B[0m`;
      case "error":
        return `\x1B[31m${content}\x1B[0m`;
      case "success":
        return `\x1B[32m${content}\x1B[0m`;
      case "info":
        return `\x1B[90m${content}\x1B[0m`;
      case "warning":
        return `\x1B[33m${content}\x1B[0m`;
      case "path":
        return `\x1B[36m${content}\x1B[0m`;
      case "command":
        return `\x1B[1;35m${content}\x1B[0m`;
      default:
        return content;
    }
  }
  getFileType(path) {
    try {
      if (this.fileSystem.isDirectory(path)) {
        return "directory";
      }
      if (path.endsWith(".js")) {
        return "executable";
      }
      return "file";
    } catch {
      return "file";
    }
  }
  success(stdout = "", type = "success") {
    return {
      stdout: this.oscMode ? this.formatOscOutput(type, stdout) : stdout,
      stderr: "",
      exitCode: 0
    };
  }
  failure(stderr) {
    return {
      stdout: "",
      stderr: this.oscMode ? this.formatOscOutput("error", stderr) : stderr,
      exitCode: 1
    };
  }
  formatCommandOutput(command, output) {
    if (!this.oscMode) return output;
    switch (command) {
      case "ls":
        return output.split("\n").map((entry) => {
          if (!entry.trim()) return entry;
          const type = this.getFileType(this.resolvePath(entry));
          return this.formatOscOutput(type, entry);
        }).join("\n");
      case "pwd":
        return this.formatOscOutput("path", output);
      case "echo":
        return this.formatOscOutput("info", output);
      case "cat":
        if (output.startsWith("{") || output.startsWith("[")) {
          try {
            JSON.parse(output);
            return this.formatOscOutput("info", output);
          } catch {
          }
        }
        return output;
      case "mkdir":
      case "touch":
      case "rm":
      case "rmdir":
      case "cp":
      case "mv":
        return this.formatOscOutput("success", output);
      default:
        return output;
    }
  }
  // Add these new methods for history management
  getNextCommand() {
    if (this.historyIndex < this.commandHistory.length - 1) {
      this.historyIndex++;
      return this.commandHistory[this.historyIndex];
    }
    this.historyIndex = this.commandHistory.length;
    return "";
  }
  getPreviousCommand() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      return this.commandHistory[this.historyIndex];
    } else if (this.historyIndex === 0) {
      return this.commandHistory[0];
    }
    return "";
  }
  getCurrentHistoryIndex() {
    return this.historyIndex;
  }
  getHistoryLength() {
    return this.commandHistory.length;
  }
  getWorkingDirectory() {
    return this.currentDirectory;
  }
  setWorkingDirectory(path) {
    const resolvedPath = this.resolvePath(path);
    if (!this.fileSystem.isDirectory(resolvedPath)) {
      throw new Error(`Directory not found: ${path}`);
    }
    this.currentDirectory = resolvedPath;
    this.env.set("PWD", resolvedPath);
  }
  hasCommand(command) {
    return this.buildInCommands.has(command) || this.commandRegistry.has(command);
  }
  resolvePath(path) {
    if (path.startsWith("/")) {
      return path;
    }
    return `${this.currentDirectory}/${path}`.replace(/\/+/g, "/");
  }
  parseCommand(args) {
    const result = {
      command: "",
      args: [],
      redirects: []
    };
    let i = 0;
    while (i < args.length) {
      const arg = args[i];
      if (arg === ">" || arg === ">>") {
        if (i + 1 >= args.length) {
          throw new Error(`Syntax error: missing file for redirection ${arg}`);
        }
        result.redirects.push({
          type: arg,
          file: args[i + 1]
        });
        i += 2;
      } else {
        if (!result.command) {
          result.command = arg;
        } else {
          result.args.push(arg);
        }
        i++;
      }
    }
    return result;
  }
  handleRedirection(output, redirects) {
    for (const redirect of redirects) {
      const filePath = this.resolvePath(redirect.file);
      try {
        if (redirect.type === ">>") {
          const existingContent = this.fileSystem.readFile(filePath) || "";
          this.fileSystem.writeFile(filePath, existingContent + output);
        } else {
          this.fileSystem.writeFile(filePath, output);
        }
      } catch (error) {
        throw new Error(`Failed to redirect to ${redirect.file}: ${error.message}`);
      }
    }
  }
  // Modified execute method to include history
  async execute(command, args) {
    try {
      if (!command) {
        return this.success();
      }
      this.commandHistory.push(command);
      const parsedCommand = this.parseCommand([command, ...args]);
      const result = await this.executeCommand(
        parsedCommand.command,
        parsedCommand.args
      );
      if (result.exitCode === 0 && parsedCommand.redirects.length > 0) {
        try {
          this.handleRedirection(result.stdout, parsedCommand.redirects);
          result.stdout = "";
        } catch (error) {
          let ret = {
            stdout: "",
            stderr: error.message,
            exitCode: 1
          };
          if (this.oscMode && ret.stderr) {
            ret.stderr = this.formatOscOutput("error", ret.stderr);
          }
          return ret;
        }
      }
      if (result.exitCode === 0 && result.stdout) {
        result.stdout = this.formatCommandOutput(command, result.stdout);
      }
      if (this.oscMode && result.stderr) {
        result.stderr = this.formatOscOutput("error", result.stderr);
      }
      return result;
    } catch (error) {
      return this.failure(error.message);
    }
  }
  async executeBuiltin(command, args) {
    switch (command) {
      case "ls":
        return this.ls(args);
      case "mkdir":
        return this.mkdir(args);
      case "rm":
        return this.rm(args);
      case "rmdir":
        return this.rmdir(args);
      case "touch":
        return this.touch(args);
      case "pwd":
        return this.pwd();
      case "cd":
        return this.cd(args);
      case "echo":
        return this.echo(args);
      case "cat":
        return this.cat(args);
      case "cp":
        return this.cp(args);
      case "mv":
        return this.mv(args);
      // case 'env':
      //     return this.env_(args);
      default:
        return {
          stdout: "",
          stderr: `Command not found: ${command}`,
          exitCode: 127
        };
    }
  }
  // Built-in command implementations
  async ls(args) {
    try {
      const path = args[0] || this.currentDirectory;
      const resolvedPath = this.resolvePath(path);
      const entries = this.fileSystem.listDirectory(resolvedPath);
      console.log(entries);
      return this.success(entries.join("\n"));
    } catch (error) {
      return this.failure(error.message);
    }
  }
  async cat(args) {
    if (args.length === 0) {
      return this.failure("No file specified");
    }
    try {
      const content = this.fileSystem.readFile(this.resolvePath(args[0]));
      if (content === void 0) {
        return this.failure(`File not found: ${args[0]}`);
      }
      return this.success(content);
    } catch (error) {
      return this.failure(error.message);
    }
  }
  async mkdir(args) {
    if (args.length === 0) {
      return this.failure("No directory specified");
    }
    try {
      this.fileSystem.createDirectory(this.resolvePath(args[0]));
      return this.success();
    } catch (error) {
      return this.failure(error.message);
    }
  }
  async rm(args) {
    if (args.length === 0) {
      return this.failure("No file specified");
    }
    try {
      const recursive = args.includes("-r") || args.includes("-rf");
      const files = args.filter((arg) => !arg.startsWith("-"));
      for (const file of files) {
        this.fileSystem.deleteFile(this.resolvePath(file), recursive);
      }
      return this.success();
    } catch (error) {
      return this.failure(error.message);
    }
  }
  async rmdir(args) {
    if (args.length === 0) {
      return this.failure("No directory specified");
    }
    try {
      this.fileSystem.deleteDirectory(this.resolvePath(args[0]));
      return this.success();
    } catch (error) {
      return this.failure(error.message);
    }
  }
  async touch(args) {
    if (args.length === 0) {
      return this.failure("No file specified");
    }
    try {
      this.fileSystem.writeFile(this.resolvePath(args[0]), "");
      return this.success();
    } catch (error) {
      return this.failure(error.message);
    }
  }
  async pwd() {
    return this.success(this.currentDirectory);
  }
  async cd(args) {
    try {
      const path = args[0] || "/";
      const newPath = this.resolvePath(path);
      if (!this.fileSystem.isDirectory(newPath)) {
        return this.failure(`Directory not found: ${path}`);
      }
      this.currentDirectory = newPath;
      this.env.set("PWD", newPath);
      return this.success();
    } catch (error) {
      return this.failure(error.message);
    }
  }
  async echo(args) {
    return this.success(args.join(" ") + "\n");
  }
  async cp(args) {
    if (args.length < 2) {
      return this.failure("Source and destination required");
    }
    try {
      const [src, dest] = args;
      const content = this.fileSystem.readFile(this.resolvePath(src));
      if (content === void 0) {
        return this.failure(`Source file not found: ${src}`);
      }
      this.fileSystem.writeFile(this.resolvePath(dest), content);
      return this.success();
    } catch (error) {
      return this.failure(error.message);
    }
  }
  async mv(args) {
    if (args.length < 2) {
      return this.failure("Source and destination required");
    }
    try {
      const [src, dest] = args;
      const content = this.fileSystem.readFile(this.resolvePath(src));
      if (content === void 0) {
        return this.failure(`Source file not found: ${src}`);
      }
      this.fileSystem.writeFile(this.resolvePath(dest), content);
      this.fileSystem.deleteFile(this.resolvePath(src));
      return this.success();
    } catch (error) {
      return this.failure(error.message);
    }
  }
  async executeCommand(command, args) {
    if (this.buildInCommands.has(command)) {
      return this.buildInCommands.get(command)(args);
    }
    if (this.commandRegistry.has(command)) {
      let commandClass = this.commandRegistry.get(command);
      let commandObject = new commandClass({
        cwd: this.currentDirectory,
        fileSystem: this.fileSystem,
        env: this.env,
        process: this.process
      });
      return commandObject.execute(args);
    }
    return this.executeBuiltin(command, args);
  }
};

// src/process/executors/shell/process.ts
var ShellProcess = class extends Process {
  constructor(pid, executablePath, args, fileSystem, parentPid, cwd, env) {
    super(pid, "shell" /* SHELL */, executablePath, args, parentPid, cwd, env);
    this.currentLine = "";
    this.running = true;
    this.commandHistory = [];
    this.historyIndex = -1;
    // Add readline state
    this.cursorPosition = 0;
    this.lineBuffer = [];
    this.fileSystem = fileSystem;
    const oscMode = args.includes("--osc");
    this.filteredArgs = args.filter((arg) => arg !== "--osc");
    this.shell = new Shell(fileSystem, { oscMode, process: this, env: this.env });
    this.prompt = oscMode ? "\x1B[1;32m$\x1B[0m " : "$ ";
  }
  async execute() {
    try {
      if (this.filteredArgs.length > 0) {
        const result = await this.executeCommand(this.filteredArgs.join(" "));
        if (result.stdout) {
          this.emitOutput(result.stdout + "\n");
        }
        if (result.stderr) {
          this.emitError(result.stderr + "\n");
        }
        this._exitCode = result.exitCode;
        return;
      }
      this.emitOutput(this.prompt);
      while (this.running && this.state === "running" /* RUNNING */) {
        const input = await this.readInput();
        await this.handleInput(input);
      }
    } catch (error) {
      this.emitError(`Shell error: ${error.message}
`);
      throw error;
    }
  }
  async onTerminate() {
    this.running = false;
    this.emitOutput("\nShell terminated.\n");
  }
  async handleInput(input) {
    if (input.length > 1 && !input.startsWith("\x1B")) {
      await this.handlePaste(input);
      return;
    }
    switch (input) {
      case "\r":
        await this.handleEnterKey();
        break;
      case "\x7F":
      // Backspace
      case "\b":
        this.handleBackspace();
        break;
      case "\x1B[A":
        this.handleUpArrow();
        break;
      case "\x1B[B":
        this.handleDownArrow();
        break;
      case "\x1B[C":
        this.handleRightArrow();
        break;
      case "\x1B[D":
        this.handleLeftArrow();
        break;
      case "	":
        this.handleTabCompletion();
        break;
      case "":
        this.handleCtrlC();
        break;
      case "":
        this.handleCtrlD();
        break;
      default:
        if (input.length === 1 && input >= " ") {
          this.handleCharacterInput(input);
        }
        break;
    }
  }
  async handlePaste(pastedText) {
    const lines = pastedText.split(/\r?\n/);
    const firstLine = lines[0];
    const before = this.currentLine.slice(0, this.cursorPosition);
    const after = this.currentLine.slice(this.cursorPosition);
    this.currentLine = before + firstLine + after;
    this.cursorPosition += firstLine.length;
    this.emitOutput(firstLine);
    if (after) {
      this.emitOutput(after);
      this.emitOutput(`\x1B[${after.length}D`);
    }
    if (lines.length > 1) {
      for (let i = 1; i < lines.length; i++) {
        await this.handleEnterKey();
        const line = lines[i];
        if (line.length > 0) {
          this.currentLine = line;
          this.cursorPosition = line.length;
          this.emitOutput(line);
        }
      }
    }
  }
  async handleEnterKey() {
    this.emitOutput("\n");
    const commandLine = this.currentLine.trim();
    if (commandLine) {
      this.commandHistory.push({
        command: commandLine,
        timestamp: /* @__PURE__ */ new Date()
      });
      this.historyIndex = this.commandHistory.length;
      const result = await this.executeCommand(commandLine);
      if (result.stdout) {
        this.emitOutput(result.stdout);
        if (!result.stdout.endsWith("\n")) {
          this.emitOutput("\n");
        }
      }
      if (result.stderr) {
        this.emitError(result.stderr);
        if (!result.stderr.endsWith("\n")) {
          this.emitOutput("\n");
        }
      }
    }
    this.currentLine = "";
    this.cursorPosition = 0;
    this.emitOutput(this.prompt);
  }
  handleBackspace() {
    if (this.cursorPosition > 0) {
      const before = this.currentLine.slice(0, this.cursorPosition - 1);
      const after = this.currentLine.slice(this.cursorPosition);
      this.currentLine = before + after;
      this.cursorPosition--;
      this.emitOutput("\b \b");
      if (after) {
        this.emitOutput(after + "\x1B[K");
        this.emitOutput(`\x1B[${after.length}D`);
      }
    }
  }
  handleUpArrow() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.updateInputLine(this.commandHistory[this.historyIndex].command);
    }
  }
  handleDownArrow() {
    if (this.historyIndex < this.commandHistory.length - 1) {
      this.historyIndex++;
      this.updateInputLine(this.commandHistory[this.historyIndex].command);
    } else {
      this.historyIndex = this.commandHistory.length;
      this.updateInputLine("");
    }
  }
  handleLeftArrow() {
    if (this.cursorPosition > 0) {
      this.cursorPosition--;
      this.emitOutput("\x1B[D");
    }
  }
  handleRightArrow() {
    if (this.cursorPosition < this.currentLine.length) {
      this.cursorPosition++;
      this.emitOutput("\x1B[C");
    }
  }
  handleCtrlC() {
    this.currentLine = "";
    this.cursorPosition = 0;
    this.emitOutput("^C\n" + this.prompt);
  }
  handleCtrlD() {
    if (this.currentLine.length === 0) {
      this.emitOutput("exit\n");
      this.running = false;
      this._exitCode = 0;
    }
  }
  handleCharacterInput(char) {
    const before = this.currentLine.slice(0, this.cursorPosition);
    const after = this.currentLine.slice(this.cursorPosition);
    this.currentLine = before + char + after;
    this.cursorPosition++;
    this.emitOutput(char);
    if (after) {
      this.emitOutput(after);
      this.emitOutput(`\x1B[${after.length}D`);
    }
  }
  handleTabCompletion() {
    const beforeCursor = this.currentLine.slice(0, this.cursorPosition);
    const afterCursor = this.currentLine.slice(this.cursorPosition);
    const endsWithSpace = /\s$/.test(beforeCursor);
    const tokenMatch = beforeCursor.match(/(\S+)$/);
    const token = tokenMatch ? tokenMatch[1] : "";
    const tokenStart = tokenMatch ? beforeCursor.length - token.length : beforeCursor.length;
    const commandPart = beforeCursor.slice(0, tokenStart);
    const commandTokens = commandPart.trim().split(/\s+/).filter(Boolean);
    const isCommandCompletion = commandTokens.length === 0 && !endsWithSpace;
    const candidates = isCommandCompletion ? this.getCommandCompletionCandidates(token) : this.getPathCompletionCandidates(token);
    if (candidates.length === 0) {
      return;
    }
    if (candidates.length === 1) {
      const completedToken = candidates[0];
      const nextLine = beforeCursor.slice(0, tokenStart) + completedToken + afterCursor;
      this.updateInputLine(nextLine);
      return;
    }
    const commonPrefix = this.getLongestCommonPrefix(candidates);
    if (commonPrefix && commonPrefix !== token) {
      const nextLine = beforeCursor.slice(0, tokenStart) + commonPrefix + afterCursor;
      this.updateInputLine(nextLine);
      return;
    }
    this.emitOutput("\n" + candidates.join("  ") + "\n");
    this.emitOutput(this.prompt + this.currentLine);
    if (afterCursor) {
      this.emitOutput(`\x1B[${afterCursor.length}D`);
    }
  }
  getCommandCompletionCandidates(prefix) {
    const buildIn = Array.from(this.shell.buildInCommands.keys());
    const external = this.shell.commandRegistry.getAll();
    const pathExecutables = [];
    const PATH = this.env.get("PATH");
    if (PATH) {
      PATH.split(":").forEach((path) => {
        try {
          const entries = this.fileSystem.listDirectory(path) || [];
          entries.forEach((entry) => {
            const executablePath = this.fileSystem.resolvePath(entry, path);
            if (this.fileSystem.fileExists(executablePath)) {
              pathExecutables.push(entry);
            }
          });
        } catch (_) {
        }
      });
    }
    return Array.from(new Set([...buildIn, ...external, ...pathExecutables])).filter((name) => name.startsWith(prefix)).sort();
  }
  getPathCompletionCandidates(token) {
    const rawToken = token || "";
    const lastSlashIndex = rawToken.lastIndexOf("/");
    const pathPrefix = lastSlashIndex >= 0 ? rawToken.slice(0, lastSlashIndex + 1) : "";
    const namePrefix = lastSlashIndex >= 0 ? rawToken.slice(lastSlashIndex + 1) : rawToken;
    const baseDir = pathPrefix ? this.fileSystem.resolvePath(pathPrefix, this.shell.currentDirectory) : this.shell.currentDirectory;
    let entries = [];
    try {
      entries = this.fileSystem.listDirectory(baseDir) || [];
    } catch (_) {
      return [];
    }
    return entries.filter((entry) => entry.startsWith(namePrefix)).map((entry) => {
      const fullPath = this.fileSystem.resolvePath(entry, baseDir);
      const isDir = this.fileSystem.isDirectory(fullPath);
      return `${pathPrefix}${entry}${isDir ? "/" : " "}`;
    }).sort();
  }
  getLongestCommonPrefix(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return "";
    }
    let prefix = values[0];
    for (let i = 1; i < values.length; i++) {
      while (prefix && !values[i].startsWith(prefix)) {
        prefix = prefix.slice(0, -1);
      }
      if (!prefix) {
        return "";
      }
    }
    return prefix;
  }
  updateInputLine(newLine) {
    this.emitOutput("\r\x1B[K");
    this.emitOutput(this.prompt + newLine);
    this.currentLine = newLine;
    this.cursorPosition = newLine.length;
  }
  async executeCommand(commandLine) {
    const args = commandLine.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const processedArgs = args.map((arg) => arg.replace(/^["'](.+)["']$/, "$1"));
    if (processedArgs.length === 0) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    const [command, ...cmdArgs] = processedArgs;
    switch (command) {
      case "exit":
        this.running = false;
        this._exitCode = 0;
        return { stdout: "", stderr: "", exitCode: 0 };
      case "history":
        const historyOutput = this.commandHistory.map((entry, index) => `${index + 1}: [${entry.timestamp.toISOString()}] ${entry.command}`).join("\n");
        return { stdout: historyOutput, stderr: "", exitCode: 0 };
      default:
        try {
          if (this.shell.hasCommand(command)) {
            return await this.shell.execute(command, cmdArgs);
          } else if (command === "node") {
            const result = await this.spawnChild(command, cmdArgs);
            return result;
          } else {
            let PATH = this.env.get("PATH");
            if (PATH) {
              const paths = PATH.split(":");
              for (const path of paths) {
                const executablePath = this.fileSystem.resolvePath(command, path);
                if (this.fileSystem.fileExists(executablePath)) {
                  return await this.spawnChild(executablePath, cmdArgs);
                }
              }
            }
            let content = this.fileSystem.readFile(command);
            if (content) {
              const shebang = content.match(/^#!(.*)/);
              if (shebang) {
                const interpreterName = shebang[1];
                let name = interpreterName.split(" ")[0];
                if (name == "/usr/bin/env") {
                  let tokens = interpreterName.split(" ");
                  if (tokens.length == 1)
                    throw "executor not specified";
                  let newCommand = tokens[1];
                  return await this.spawnChild(newCommand, [command, ...cmdArgs]);
                }
              }
            }
          }
          return await this.shell.execute(command, cmdArgs);
        } catch (error) {
          return {
            stdout: "",
            stderr: error.message,
            exitCode: 1
          };
        }
    }
  }
};

// src/process/executors/shell/executor.ts
var ShellProcessExecutor = class {
  constructor(fileSystem) {
    this.fileSystem = fileSystem;
  }
  canExecute(executable) {
    return executable === "sh";
  }
  async execute(payload, pid, parantPid) {
    return new ShellProcess(
      pid,
      payload.executable,
      payload.args,
      this.fileSystem,
      parantPid,
      payload.cwd
    );
  }
};

// src/process/executors/node/process.ts
import { newQuickJSAsyncWASMModuleFromVariant } from "quickjs-emscripten";
import variant from "@jitl/quickjs-singlefile-browser-release-asyncify";

// src/process/executors/node/modules/network-module.ts
var NetworkModule = class {
  constructor(context, onServerListen, onServerClose, debug = false) {
    this.servers = /* @__PURE__ */ new Map();
    this.sockets = /* @__PURE__ */ new Map();
    this.nextSocketId = 1;
    this.debug = false;
    this.context = context;
    this.debug = debug;
    this.onServerListen = onServerListen;
    this.onServerClose = onServerClose;
    this.onServerCrash = onServerClose;
  }
  log(scope, message, data) {
    if (!this.debug) return;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    if (data) {
      console.log(`[${timestamp}] [NetworkSystem:${scope}] ${message}`, data);
    } else {
      console.log(`[${timestamp}] [NetworkSystem:${scope}] ${message}`);
    }
  }
  createNetModule() {
    this.log("createNetModule", "Creating network module");
    const netModule = this.context.newObject();
    const createServerHandle = this.context.newFunction("createServer", (optionsOrCallback) => {
      this.log("createServer", "Creating new TCP server");
      const serverObj = this.context.newObject();
      let connectionCallback = null;
      if (this.context.typeof(optionsOrCallback) === "function") {
        connectionCallback = optionsOrCallback;
      }
      const listenHandle = this.context.newFunction("listen", (portHandle, hostHandle, backlogOrCallback) => {
        const port = this.context.getNumber(portHandle);
        const host = hostHandle && hostHandle !== this.context.undefined ? this.context.getString(hostHandle) : "localhost";
        this.log("listen", `Server listening on ${host}:${port}`);
        let callback = backlogOrCallback;
        if (this.context.typeof(hostHandle) === "function") {
          callback = hostHandle;
        }
        this.servers.set(`${host}:${port}`, {
          port,
          host,
          connectionCallback
        });
        if (callback && callback !== this.context.undefined) {
          this.context.callFunction(callback, serverObj, []);
        }
        this.onServerListen(port);
        return serverObj;
      });
      this.context.setProp(serverObj, "listen", listenHandle);
      listenHandle.dispose();
      const closeHandle = this.context.newFunction("close", (callbackHandle) => {
        this.log("close", "Closing TCP server");
        const serverKey = Array.from(this.servers.entries()).find(([_, server]) => server.connectionCallback === connectionCallback)?.[0];
        if (serverKey) {
          this.servers.delete(serverKey);
        }
        if (callbackHandle && callbackHandle !== this.context.undefined) {
          this.context.callFunction(callbackHandle, serverObj, []);
        }
        return serverObj;
      });
      this.context.setProp(serverObj, "close", closeHandle);
      closeHandle.dispose();
      return serverObj;
    });
    this.context.setProp(netModule, "createServer", createServerHandle);
    createServerHandle.dispose();
    const connectHandle = this.context.newFunction("connect", (options, connectListener) => {
      const opts = this.context.dump(options);
      const port = typeof opts === "number" ? opts : opts.port;
      const host = typeof opts === "string" ? opts : opts.host || "localhost";
      const serverKey = `${host}:${port}`;
      this.log("connect", `Attempting connection to ${serverKey}`);
      const server = this.servers.get(serverKey);
      if (!server) {
        throw new Error(`Cannot connect to ${serverKey}: no server listening`);
      }
      const { socketObj: clientSocket, socket: clientSocketData } = this.createSocketObj(
        host,
        port,
        "localhost",
        49152 + Math.floor(Math.random() * 16384)
      );
      const { socketObj: serverSocket, socket: serverSocketData } = this.createSocketObj(
        "localhost",
        clientSocketData.localPort,
        host,
        port
      );
      this.linkSockets(clientSocketData, serverSocketData);
      this.linkSockets(serverSocketData, clientSocketData);
      if (server.connectionCallback) {
        this.log("connect", "Calling server connection callback");
        this.context.callFunction(server.connectionCallback, this.context.undefined, [serverSocket]);
      }
      if (connectListener && connectListener !== this.context.undefined) {
        this.context.callFunction(connectListener, clientSocket, []);
      }
      serverSocket.dispose();
      return clientSocket;
    });
    this.context.setProp(netModule, "connect", connectHandle);
    this.context.setProp(netModule, "createConnection", connectHandle);
    connectHandle.dispose();
    return netModule;
  }
  linkSockets(source, target) {
    this.log("linkSockets", `Linking socket ${source.id} to ${target.id}`);
    source.eventHandlers.data = source.eventHandlers.data.concat(
      (data) => target.eventHandlers.data.forEach((h) => h(data))
    );
    source.eventHandlers.end = source.eventHandlers.end.concat(
      () => target.eventHandlers.end.forEach((h) => h())
    );
    source.eventHandlers.close = source.eventHandlers.close.concat(
      () => target.eventHandlers.close.forEach((h) => h())
    );
    source.eventHandlers.error = source.eventHandlers.error.concat(
      (err) => target.eventHandlers.error.forEach((h) => h(err))
    );
  }
  createHttpModule() {
    this.log("createHttpModule", "Creating HTTP module");
    const httpModule = this.context.newObject();
    const createServerHandle = this.context.newFunction("createServer", (handlerHandle) => {
      this.log("createHttpServer", "Creating new HTTP server");
      const serverObj = this.context.newObject();
      const serverHandlerHandle = handlerHandle.dup();
      let serverObjDup = serverObj.dup();
      let serverKey;
      const listenHandle = this.context.newFunction("listen", (portHandle, callbackHandle) => {
        const port = this.context.getNumber(portHandle);
        const host = "localhost";
        serverKey = `${host}:${port}`;
        this.log("listen", `HTTP server listening on ${serverKey}`);
        this.servers.set(serverKey, {
          port,
          host,
          requestHandler: (reqObjHandle, resObjHandle) => {
            this.log("requestHandler", "Processing incoming HTTP request");
            let reqObj = reqObjHandle.dup();
            let resObj = resObjHandle.dup();
            try {
              let reqDup = reqObj.dup();
              let resDup = resObj.dup();
              let serverHandlerHandleDup = serverHandlerHandle.dup();
              this.context.callFunction(serverHandlerHandleDup, this.context.undefined, [reqDup, resDup]);
            } catch (error) {
              this.log("requestHandler", "Error in request handler", error);
              this.onServerCrash(port);
            } finally {
              reqObj.dispose();
              resObj.dispose();
            }
          }
        });
        if (callbackHandle && callbackHandle !== this.context.undefined) {
          try {
            this.log("listen", "Executing server listen callback");
            let callbackHandleDup = callbackHandle.dup();
            let serverObjCallbackDup = serverObjDup.dup();
            this.context.callFunction(callbackHandleDup, serverObjCallbackDup.dup(), []);
          } catch (error) {
            this.log("listen", "Error Executing Listen Callback: ", error);
          }
        }
        this.log("listen", "Emit Server Registar Event");
        this.onServerListen(port);
        this.log("listen", "Server Registar Event Emitted");
        this.log("listen", "Returning server object");
        return serverObjDup;
      });
      this.context.setProp(serverObj, "listen", listenHandle);
      listenHandle.dispose();
      const closeHandle = this.context.newFunction("close", (callbackHandle) => {
        if (serverKey == void 0) {
          this.log("close", "Server Not started");
          throw new Error("Server not started");
        }
        let server = this.servers.get(serverKey);
        if (server == void 0) {
          this.log("close", "Server not found");
          throw new Error("Server not found");
        }
        this.log("close", "Closing HTTP server");
        serverHandlerHandle.dispose();
        if (callbackHandle && callbackHandle !== this.context.undefined) {
          let callbackHandleDup = callbackHandle.dup();
          let serverObjCallbackDup = serverObjDup.dup();
          this.context.callFunction(callbackHandleDup, serverObjCallbackDup.dup(), []);
        }
        this.onServerClose(server.port);
        this.log("close", "Returning server object");
        return serverObjDup;
      });
      this.context.setProp(serverObj, "close", closeHandle);
      closeHandle.dispose();
      return serverObj;
    });
    this.context.setProp(httpModule, "createServer", createServerHandle);
    createServerHandle.dispose();
    const requestHandle = this.context.newFunction("request", (reqObj, callbackHandle) => {
      const options = this.context.dump(reqObj);
      const serverKey = `${options.hostname || "localhost"}:${options.port}`;
      this.log("request", `Making HTTP request to ${serverKey}`, options);
      const server = this.servers.get(serverKey);
      if (!server) {
        this.log("request", `No server found at ${serverKey}`);
        const errorObj = this.context.newError(`No server listening on ${serverKey}`);
        this.context.callFunction(callbackHandle, this.context.undefined, [errorObj]);
        errorObj.dispose();
        return;
      }
      let { resObj: resObjHandle, eventHandlers } = this.makeRequestRespObj();
      const resObj = resObjHandle.dup();
      try {
        let resObjDup = resObj.dup();
        this.context.callFunction(callbackHandle, this.context.undefined, [resObjDup]);
      } catch (error) {
        this.log("request", "Error in request callback", error);
      }
      try {
        let resObjDup = resObj.dup();
        server.requestHandler?.(reqObj, resObjDup);
      } catch (error) {
        this.log("request", "Error in server request handler", error);
      }
    });
    this.context.setProp(httpModule, "request", requestHandle);
    requestHandle.dispose();
    return httpModule.dup();
  }
  makeRequestRespObj() {
    this.log("makeRequestRespObj", "Creating response object");
    const resObj = this.context.newObject();
    const eventHandlers = {
      data: [],
      end: []
    };
    let resForHandlers = resObj.dup();
    const onHandle = this.context.newFunction("on", (eventHandle, listenerHandle) => {
      const event = this.context.getString(eventHandle);
      const resObjDup2 = resForHandlers.dup();
      const listenerHandleDup = listenerHandle.dup();
      if (event === "data") {
        this.log("responseEvent", "Attaching data handler");
        eventHandlers.data.push((chunk) => {
          try {
            const chunkHandle = this.context.newString(chunk);
            this.context.callFunction(listenerHandleDup.dup(), resObjDup2.dup(), [chunkHandle]);
            chunkHandle.dispose();
          } catch (error) {
            this.log("responseEvent", "Error in data handler", error);
          }
        });
      } else if (event === "end") {
        this.log("responseEvent", "Attaching end handler");
        eventHandlers.end.push(() => {
          try {
            this.context.callFunction(listenerHandleDup.dup(), resObjDup2.dup(), []);
          } catch (error) {
            this.log("responseEvent", "Error in end handler", error);
          }
        });
      }
      return resObj;
    });
    this.context.setProp(resObj, "on", onHandle);
    onHandle.dispose();
    let resObjDup = resObj.dup();
    const writeHeadHandle = this.context.newFunction("writeHead", (statusHandle, headersHandle) => {
      this.log("responseWrite", "Setting response headers");
      const status = this.context.getNumber(statusHandle);
      const headers = this.context.dump(headersHandle);
      this.context.setProp(resObjDup, "statusCode", this.context.newNumber(status));
      const responseHeadersObj = this.context.newObject();
      for (const [key, value] of Object.entries(headers)) {
        this.context.setProp(responseHeadersObj, key, this.context.newString(value));
      }
      this.context.setProp(resObjDup, "headers", responseHeadersObj);
      responseHeadersObj.dispose();
      return resObjDup;
    });
    this.context.setProp(resObj, "writeHead", writeHeadHandle);
    writeHeadHandle.dispose();
    const writeHandle = this.context.newFunction("write", (dataHandle) => {
      const chunk = this.context.getString(dataHandle);
      this.log("responseWrite", "Writing response chunk");
      eventHandlers.data.forEach((handler) => handler(chunk));
      return resObj.dup();
    });
    this.context.setProp(resObj, "write", writeHandle);
    writeHandle.dispose();
    const endHandle = this.context.newFunction("end", (dataHandle) => {
      this.log("responseEnd", "Ending response");
      if (dataHandle) {
        const finalChunk = this.context.getString(dataHandle);
        eventHandlers.data.forEach((handler) => handler(finalChunk));
      }
      eventHandlers.end.forEach((handler) => handler());
      return resObj.dup();
    });
    this.context.setProp(resObj, "end", endHandle);
    endHandle.dispose();
    return { resObj, eventHandlers };
  }
  createSocketObj(remoteAddress, remotePort, localAddress, localPort) {
    const socketId = `socket_${this.nextSocketId++}`;
    const socketObj = this.context.newObject();
    const socket = {
      id: socketId,
      eventHandlers: {
        data: [],
        end: [],
        close: [],
        error: []
      },
      remoteAddress,
      remotePort,
      localAddress,
      localPort,
      destroyed: false
    };
    this.sockets.set(socketId, socket);
    this.context.setProp(socketObj, "remoteAddress", this.context.newString(remoteAddress));
    this.context.setProp(socketObj, "remotePort", this.context.newNumber(remotePort));
    this.context.setProp(socketObj, "localAddress", this.context.newString(localAddress));
    this.context.setProp(socketObj, "localPort", this.context.newNumber(localPort));
    const onHandle = this.context.newFunction("on", (eventHandle, listenerHandle) => {
      const event = this.context.getString(eventHandle);
      switch (event) {
        case "data":
          socket.eventHandlers.data.push((chunk) => {
            const chunkHandle = this.context.newString(chunk);
            this.context.callFunction(listenerHandle, socketObj, [chunkHandle]);
            chunkHandle.dispose();
          });
          break;
        case "end":
          socket.eventHandlers.end.push(() => {
            this.context.callFunction(listenerHandle, socketObj, []);
          });
          break;
        case "close":
          socket.eventHandlers.close.push(() => {
            this.context.callFunction(listenerHandle, socketObj, []);
          });
          break;
        case "error":
          socket.eventHandlers.error.push((error) => {
            const errorHandle = this.context.newError(error.message);
            this.context.callFunction(listenerHandle, socketObj, [errorHandle]);
            errorHandle.dispose();
          });
          break;
      }
      return socketObj;
    });
    this.context.setProp(socketObj, "on", onHandle);
    onHandle.dispose();
    const writeHandle = this.context.newFunction("write", (dataHandle, encodingHandle, callbackHandle) => {
      const data = this.context.getString(dataHandle);
      const highWaterMark = 16384;
      const shouldApplyBackpressure = data.length > highWaterMark;
      setTimeout(() => {
        socket.eventHandlers.data.forEach((handler) => handler(data));
        if (callbackHandle && callbackHandle !== this.context.undefined) {
          this.context.callFunction(callbackHandle, socketObj, []);
        }
      }, 0);
      return !shouldApplyBackpressure ? this.context.true : this.context.false;
    });
    this.context.setProp(socketObj, "write", writeHandle);
    writeHandle.dispose();
    const endHandle = this.context.newFunction("end", (dataHandle) => {
      if (dataHandle && dataHandle !== this.context.undefined) {
        const finalData = this.context.getString(dataHandle);
        socket.eventHandlers.data.forEach((handler) => handler(finalData));
      }
      socket.eventHandlers.end.forEach((handler) => handler());
      socket.eventHandlers.close.forEach((handler) => handler());
      socket.destroyed = true;
      return socketObj;
    });
    this.context.setProp(socketObj, "end", endHandle);
    endHandle.dispose();
    const destroyHandle = this.context.newFunction("destroy", (errorHandle) => {
      if (errorHandle && errorHandle !== this.context.undefined) {
        const error = new Error(this.context.getString(errorHandle));
        socket.eventHandlers.error.forEach((handler) => handler(error));
      }
      socket.destroyed = true;
      socket.eventHandlers.close.forEach((handler) => handler());
      this.sockets.delete(socketId);
      return socketObj;
    });
    this.context.setProp(socketObj, "destroy", destroyHandle);
    destroyHandle.dispose();
    return { socketObj, socket };
  }
  static hostRequestToHandle(context, request) {
    const newRequestOptions = {
      method: request.method || "GET",
      hostname: request.hostname || "localhost",
      path: request.path || "",
      port: request.port || 80,
      headers: request.headers || {},
      body: request.body
    };
    newRequestOptions.url = `http://${newRequestOptions.hostname}:${newRequestOptions.port}${newRequestOptions.path}`;
    const reqHandle = context.newObject();
    try {
      for (const [key, value] of Object.entries(newRequestOptions)) {
        if (value === void 0) continue;
        if (key === "headers" && typeof value === "object") {
          const headersHandle = context.newObject();
          for (const [headerKey, headerValue] of Object.entries(value)) {
            const valueHandle = context.newString(headerValue);
            context.setProp(headersHandle, headerKey, valueHandle);
            valueHandle.dispose();
          }
          context.setProp(reqHandle, key, headersHandle);
          headersHandle.dispose();
        } else {
          const valueHandle = typeof value === "string" ? context.newString(value) : typeof value === "number" ? context.newNumber(value) : context.newString(JSON.stringify(value));
          context.setProp(reqHandle, key, valueHandle);
          valueHandle.dispose();
        }
      }
      return reqHandle;
    } catch (error) {
      reqHandle.dispose();
      throw error;
    }
  }
  dispose() {
    this.log("dispose", "Disposing network system");
    this.servers.clear();
    this.sockets.clear();
  }
};
var statusCodeToStatusText = (statusCode) => {
  switch (statusCode) {
    case 100:
      return "Continue";
    case 101:
      return "Switching Protocols";
    case 102:
      return "Processing";
    case 200:
      return "OK";
    case 201:
      return "Created";
    case 202:
      return "Accepted";
    case 203:
      return "Non-Authoritative Information";
    case 204:
      return "No Content";
    case 205:
      return "Reset Content";
    case 206:
      return "Partial Content";
    case 207:
      return "Multi-Status";
    case 208:
      return "Already Reported";
    case 226:
      return "IM Used";
    case 300:
      return "Multiple Choices";
    case 301:
      return "Moved Permanently";
    case 302:
      return "Found";
    case 303:
      return "See Other";
    case 304:
      return "Not Modified";
    case 305:
      return "Use Proxy";
    case 307:
      return "Temporary Redirect";
    case 308:
      return "Permanent Redirect";
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 402:
      return "Payment Required";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 405:
      return "Method Not Allowed";
    case 406:
      return "Not Acceptable";
    case 407:
      return "Proxy Authentication Required";
    case 408:
      return "Request Timeout";
    case 409:
      return "Conflict";
    case 410:
      return "Gone";
    case 411:
      return "Length Required";
    case 412:
      return "Precondition Failed";
    case 413:
      return "Payload Too Large";
    case 414:
      return "URI Too Long";
    case 415:
      return "Unsupported Media Type";
    case 416:
      return "Range Not Satisfiable";
    case 417:
      return "Expectation Failed";
    case 418:
      return "I'm a teapot";
    case 421:
      return "Misdirected Request";
    case 422:
      return "Unprocessable Entity";
    case 423:
      return "Locked";
    case 424:
      return "Failed Dependency";
    case 426:
      return "Upgrade Required";
    case 428:
      return "Precondition Required";
    case 429:
      return "Too Many Requests";
    case 431:
      return "Request Header Fields Too Large";
    case 451:
      return "Unavailable For Legal Reasons";
    case 500:
      return "Internal Server Error";
    case 501:
      return "Not Implemented";
    case 502:
      return "Bad Gateway";
    case 503:
      return "Service Unavailable";
    case 504:
      return "Gateway Timeout";
    case 505:
      return "HTTP Version Not Supported";
    case 506:
      return "Variant Also Negotiates";
    case 507:
      return "Insufficient Storage";
    case 508:
      return "Loop Detected";
    case 510:
      return "Not Extended";
    case 511:
      return "Network Authentication Required";
    default:
      return "Unknown Status Code";
  }
};

// src/process/executors/node/process.ts
var NodeProcess = class extends Process {
  constructor(pid, executablePath, args, fileSystem, networkManager, parantPid, cwd) {
    super(pid, "javascript" /* JAVASCRIPT */, executablePath, args, parantPid, cwd);
    this.fileSystem = fileSystem;
    this.networkManager = networkManager;
  }
  async execute() {
    try {
      const QuickJS = await newQuickJSAsyncWASMModuleFromVariant(variant);
      const runtime = QuickJS.newRuntime();
      runtime.setModuleLoader((moduleName, ctx) => {
        try {
          const resolvedPath = this.fileSystem.resolveModulePath(moduleName, this.cwd);
          const content = this.fileSystem.readFile(resolvedPath);
          if (content === void 0) {
            return { error: new Error(`Module not found: ${moduleName}`) };
          }
          return { value: content };
        } catch (error) {
          return { error };
        }
      }, (baseModuleName, requestedName) => {
        try {
          let basePath = baseModuleName ? baseModuleName.substring(0, baseModuleName.lastIndexOf("/")) : this.cwd;
          basePath = this.fileSystem.normalizePath(basePath || this.cwd || "/");
          const resolvedPath = this.fileSystem.resolveModulePath(requestedName, basePath);
          return { value: resolvedPath };
        } catch (error) {
          return { error };
        }
      });
      const context = runtime.newContext();
      this.context = context;
      this.networkModule = new NetworkModule(context, (port) => {
        console.log("registering server", port);
        this.networkManager.registerServer(this.pid, port, "http", { host: "0.0.0.0" });
      }, (port) => {
        this.networkManager.unregisterServer(port, "http");
      }, true);
      this.httpModule = this.networkModule.createHttpModule();
      this.setupRequire(context);
      const consoleObj = context.newObject();
      const logFn = context.newFunction("log", (...args) => {
        const output = args.map((arg) => `${context.dump(arg)}`).join(" ") + "\n";
        this.emit("message" /* MESSAGE */, { stdout: output });
      });
      context.setProp(consoleObj, "log", logFn);
      const debugFn = context.newFunction("debug", (...args) => {
        const output = args.map((arg) => `${context.dump(arg)}`).join(" ") + "\n";
        this.emit("message" /* MESSAGE */, { stderr: output });
      });
      context.setProp(consoleObj, "debug", debugFn);
      const errorFn = context.newFunction("error", (...args) => {
        const output = args.map((arg) => `${context.dump(arg)}`).join(" ") + "\n";
        this.emit("message" /* MESSAGE */, { stderr: output });
      });
      context.setProp(consoleObj, "error", errorFn);
      context.setProp(context.global, "console", consoleObj);
      logFn.dispose();
      errorFn.dispose();
      consoleObj.dispose();
      const processObj = context.newObject();
      const argvArray = context.newArray();
      const fullArgs = ["node", this.executablePath, ...this.args];
      for (let i = 0; i < fullArgs.length; i++) {
        const argHandle = context.newString(fullArgs[i]);
        context.setProp(argvArray, i, argHandle);
        argHandle.dispose();
      }
      context.setProp(processObj, "argv", argvArray);
      context.setProp(context.global, "process", processObj);
      argvArray.dispose();
      processObj.dispose();
      try {
        let content = this.fileSystem.readFile(this.executablePath);
        if (!content) {
          throw new Error(`File not found: ${this.executablePath}`);
        }
        let firstLine = content.split("\n")[0];
        if (firstLine.startsWith("#!")) {
          content = content.split("\n").slice(1).join("\n");
        }
        const result = context.evalCode(content, this.executablePath, { type: "module" });
        while (runtime.hasPendingJob()) {
          const jobResult = runtime.executePendingJobs(10);
          if (jobResult.error) {
            throw context.dump(jobResult.error);
          }
        }
        if (result.error) {
          throw context.dump(result.error);
        }
        result.value.dispose();
        this._exitCode = 0;
        this._state = "completed" /* COMPLETED */;
      } catch (error) {
        this._exitCode = 1;
        this._state = "failed" /* FAILED */;
        this.emit("message" /* MESSAGE */, { stderr: JSON.stringify(error, null, 2) });
      } finally {
        context.dispose();
        this.emit("exit" /* EXIT */, { pid: this.pid, exitCode: this._exitCode });
      }
    } catch (error) {
      this._state = "failed" /* FAILED */;
      this._exitCode = 1;
      this.emit("error" /* ERROR */, { pid: this.pid, error: JSON.stringify(error, null, 2) });
      this.emit("exit" /* EXIT */, { pid: this.pid, exitCode: this._exitCode });
    }
  }
  setupRequire(context) {
    const requireFn = context.newFunction("require", (moduleId) => {
      const id = context.getString(moduleId);
      if (context.getString(moduleId) === "http" && this.networkModule) {
        this.httpModule = this.networkModule.createHttpModule();
        return this.httpModule.dup();
      }
      try {
        let modulePath = id;
        if (!id.startsWith("./") && !id.startsWith("/")) {
          modulePath = `/node_modules/${id}`;
        }
        const result = context.evalCode(
          `import('${modulePath}').then(m => m.default || m)`,
          "dynamic-import.js",
          { type: "module" }
        );
        if (result.error) {
          throw new Error(`Failed to load module ${id}: ${context.dump(result.error)}`);
        }
        const promiseState = context.getPromiseState(result.value);
        result.value.dispose();
        if (promiseState.type === "fulfilled") {
          return promiseState.value;
        } else if (promiseState.type === "rejected") {
          const error = context.dump(promiseState.error);
          promiseState.error.dispose();
          throw new Error(`Module load failed: ${error}`);
        } else {
          throw new Error(`Module loading is pending: ${id}`);
        }
      } catch (error) {
        throw new Error(`Cannot find module '${id}': ${error.message}`);
      }
    });
    context.setProp(context.global, "require", requireFn);
    requireFn.dispose();
    const moduleObj = context.newObject();
    const exportsObj = context.newObject();
    context.setProp(moduleObj, "exports", exportsObj);
    context.setProp(context.global, "module", moduleObj);
    context.setProp(context.global, "exports", exportsObj);
    moduleObj.dispose();
    exportsObj.dispose();
  }
  async handleHttpRequest(request) {
    return new Promise((resolve, reject) => {
      try {
        if (this.httpModule === void 0) {
          reject(new Error("HTTP module not initialized"));
          return;
        }
        if (this.context == void 0) {
          reject(new Error("No context found"));
          return;
        }
        let reqObj = NetworkModule.hostRequestToHandle(this.context, {
          port: request.port,
          path: request.path,
          method: request.method,
          headers: request.headers,
          body: request.body
        });
        const callbackHandle = this.context.newFunction("callback", (resHandle) => {
          try {
            if (this.context == void 0) {
              reject(new Error("No context found"));
              return;
            }
            let responseData = "";
            let resObj = resHandle.dup();
            const onHandle = this.context.getProp(resObj, "on");
            const dataListenerHandle = this.context.newFunction("dataListener", (chunkHandle) => {
              const chunk = this.context?.getString(chunkHandle);
              responseData += chunk;
            });
            const endListenerHandle = this.context.newFunction("endListener", () => {
              if (this.context == void 0) {
                reject(new Error("No context found"));
                return;
              }
              let resObjDup = resObj.dup();
              let res = this.context.dump(resObjDup);
              resolve(new Response(responseData, {
                status: res.status,
                statusText: statusCodeToStatusText(res.status),
                headers: res.headers
              }));
              dataListenerHandle?.dispose();
              endListenerHandle?.dispose();
            });
            let resObjDataDup = resObj.dup();
            this.context.callFunction(onHandle, resObjDataDup, [
              this.context.newString("data"),
              dataListenerHandle
            ]);
            let resObjEndDup = resObj.dup();
            this.context.callFunction(onHandle, resObjEndDup, [
              this.context.newString("end"),
              endListenerHandle
            ]);
            onHandle.dispose();
          } catch (error) {
            reject(error);
          }
        });
        const httpHandle = this.context.getProp(this.context.global, "http");
        const requestHandle = this.context.getProp(httpHandle, "request");
        this.context.callFunction(requestHandle, this.context.undefined, [reqObj, callbackHandle]);
        requestHandle.dispose();
        httpHandle.dispose();
        callbackHandle.dispose();
        reqObj.dispose();
      } catch (error) {
        reject(error);
      }
    });
  }
  async terminate() {
    if (this._state !== "running" /* RUNNING */) {
      return;
    }
    this._state = "terminated" /* TERMINATED */;
    this._exitCode = -1;
    this.emit("exit" /* EXIT */, { pid: this.pid, exitCode: this._exitCode });
  }
};

// src/process/executors/node/executor.ts
var NodeProcessExecutor = class {
  constructor(fileSystem, networkManager) {
    this.fileSystem = fileSystem;
    this.networkManager = networkManager;
  }
  canExecute(executable) {
    return executable === "node" || executable.endsWith(".js");
  }
  async execute(payload, pid, parentPid) {
    let executablePath = payload.executable;
    let args = payload.args;
    let cwd = payload.cwd || "/";
    if (executablePath === "node") {
      if (args.length === 0) {
        throw new Error("No JavaScript file specified");
      }
      executablePath = args[0];
      args = args.slice(1);
    }
    if (executablePath && !executablePath.startsWith("/")) {
      executablePath = this.fileSystem.resolvePath(executablePath, cwd);
    }
    return new NodeProcess(
      pid,
      executablePath,
      args,
      this.fileSystem,
      this.networkManager,
      parentPid,
      cwd
    );
  }
};

// src/process/manager/manager.ts
var ProcessManager = class {
  constructor() {
    this.processes = /* @__PURE__ */ new Map();
    this.nextPid = 1;
  }
  getNextPid() {
    return this.nextPid++;
  }
  addProcess(process) {
    this.processes.set(process.pid, process);
  }
  getProcess(pid) {
    return this.processes.get(pid);
  }
  removeProcess(pid) {
    return this.processes.delete(pid);
  }
  listProcesses() {
    return Array.from(this.processes.values());
  }
  async killAll() {
    const processes = this.listProcesses();
    await Promise.all(processes.map((process) => process.terminate()));
    this.processes.clear();
  }
};

// src/filesystem/zenfs-core.ts
import { fs, normalizePath } from "@zenfs/core";
var ZenFSCore = class {
  constructor() {
    this.fs = fs;
  }
  readBuffer(path) {
    return this.fs.readFileSync(path);
  }
  writeBuffer(path, buffer) {
    return this.fs.writeFileSync(path, buffer);
  }
  normalizePath(path) {
    return normalizePath(path);
  }
  writeFile(path, content) {
    this.fs.writeFileSync(path, content, { encoding: "utf-8" });
  }
  readFile(path) {
    return this.fs.readFileSync(path, "utf-8");
  }
  deleteFile(path, recursive = false) {
    this.fs.rmSync(path, {
      recursive
    });
  }
  listFiles(basePath = "/") {
    const files = [];
    const items = fs.readdirSync(basePath, { withFileTypes: true });
    if (basePath.endsWith("/")) basePath = basePath.slice(0, -1);
    for (const item of items) {
      if (item.isDirectory()) {
        files.push(...this.listFiles(`${basePath}/${item.name}`));
      } else {
        files.push(`${basePath}/${item.name}`);
      }
    }
    return files;
  }
  resolvePath(path, basePath = "") {
    const rawPath = String(path || "");
    const normalizedBasePath = normalizePath(basePath || "/");
    if (!rawPath) {
      return normalizedBasePath;
    }
    if (rawPath.startsWith("/")) {
      return normalizePath(rawPath);
    }
    const normalizedPath = rawPath.replace(/\\/g, "/").replace(/^\.?\//, "");
    return normalizePath(`${normalizedBasePath}/${normalizedPath}`);
  }
  fileExists(path) {
    return this.fs.existsSync(path);
  }
  resolveModulePath(specifier, basePath = "") {
    const normalizedBasePath = normalizePath(basePath);
    let resolvedPath;
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const baseDir = normalizedBasePath.endsWith("/") ? normalizedBasePath : normalizedBasePath + "/";
      const baseSegments = baseDir.split("/").filter(Boolean);
      const specSegments = specifier.split("/").filter(Boolean);
      const resultSegments = [...baseSegments];
      for (const segment of specSegments) {
        if (segment === "..") {
          if (resultSegments.length === 0) {
            throw new Error(`Invalid path: ${specifier} goes beyond root from ${basePath}`);
          }
          resultSegments.pop();
        } else if (segment !== ".") {
          resultSegments.push(segment);
        }
      }
      resolvedPath = "/" + resultSegments.join("/");
    } else {
      resolvedPath = normalizePath(specifier);
    }
    if (this.fs.existsSync(resolvedPath)) {
      let stat = this.fs.lstatSync(resolvedPath);
      if (stat.isFile()) return resolvedPath;
      else if (stat.isDirectory()) {
        let indexPath = normalizePath(`${resolvedPath}/index`);
        let exts = [".js", ".mjs"];
        exts.forEach((ext) => {
          let withExt = `${indexPath}${ext}`;
          if (this.fileExists(withExt)) {
            return withExt;
          }
        });
      }
    }
    for (const ext of [".js", ".mjs"]) {
      const withExt = `${resolvedPath}${ext}`;
      if (this.fileExists(withExt)) {
        return withExt;
      }
    }
    throw new Error(`Module not found: ${specifier} (resolved to ${resolvedPath})`);
  }
  createDirectory(path) {
    this.fs.mkdirSync(path, { recursive: true });
  }
  deleteDirectory(path) {
    this.fs.rmdirSync(path);
  }
  listDirectory(path) {
    return this.fs.readdirSync(path);
  }
  isDirectory(path) {
    return this.fs.lstatSync(path).isDirectory();
  }
};

// src/network/manager.ts
var NetworkManager = class {
  constructor(options) {
    this.servers = /* @__PURE__ */ new Map();
    this.serverStats = /* @__PURE__ */ new Map();
    this.connections = /* @__PURE__ */ new Map();
    this.requestLog = [];
    // Stats tracking
    this.stats = {
      totalRequests: 0,
      failedRequests: 0,
      totalConnections: 0,
      activeConnections: 0,
      totalBytes: { rx: 0, tx: 0 }
    };
    this.getProcess = options.getProcess;
    setInterval(() => this.cleanupRequestLog(), 6e4);
    this.onServerListen = options.onServerListen;
    this.onServerClose = options.onServerClose;
  }
  cleanupRequestLog() {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1e3;
    this.requestLog = this.requestLog.filter((log) => log.timestamp > fiveMinutesAgo);
  }
  getServerId(port, type = "http") {
    return `${type}:${port}`;
  }
  registerServer(pid, port, type, options = {}) {
    const serverId = this.getServerId(port, type);
    if (this.servers.has(serverId)) {
      throw new Error(`${type.toUpperCase()} server on port ${port} is already in use`);
    }
    this.servers.set(serverId, {
      pid,
      port,
      type,
      status: "running",
      options
    });
    this.serverStats.set(serverId, {
      requestsTotal: 0,
      requestsSuccess: 0,
      requestsFailed: 0,
      bytesReceived: 0,
      bytesSent: 0,
      connections: 0,
      startTime: /* @__PURE__ */ new Date()
    });
    if (this.onServerListen) {
      this.onServerListen(port);
    }
    return serverId;
  }
  unregisterServer(port, type) {
    const serverId = this.getServerId(port, type);
    this.servers.delete(serverId);
    for (const [connId, conn] of this.connections.entries()) {
      if (conn.serverId === serverId) {
        this.connections.delete(connId);
        this.stats.activeConnections--;
        if (this.onServerClose) {
          this.onServerClose(port);
        }
      }
    }
  }
  getServer(port, type = "http") {
    return this.servers.get(this.getServerId(port, type));
  }
  // Log a request completion
  logRequest(serverId, duration, success, bytesReceived, bytesSent) {
    this.requestLog.push({
      timestamp: Date.now(),
      duration,
      serverId,
      success,
      bytesReceived,
      bytesSent
    });
    const stats = this.serverStats.get(serverId);
    if (stats) {
      stats.requestsTotal++;
      if (success) {
        stats.requestsSuccess++;
      } else {
        stats.requestsFailed++;
      }
      stats.bytesReceived += bytesReceived;
      stats.bytesSent += bytesSent;
    }
  }
  getNetworkStats() {
    const now = Date.now();
    const oneMinuteAgo = now - 6e4;
    const recentRequests = this.requestLog.filter((log) => log.timestamp > oneMinuteAgo);
    const requestsPerMinute = recentRequests.length;
    const traffic = this.requestLog.reduce((acc, log) => ({
      bytesReceived: acc.bytesReceived + log.bytesReceived,
      bytesSent: acc.bytesSent + log.bytesSent,
      requestsTotal: acc.requestsTotal + 1,
      requestsSuccess: acc.requestsSuccess + (log.success ? 1 : 0),
      requestsFailed: acc.requestsFailed + (log.success ? 0 : 1),
      totalDuration: acc.totalDuration + log.duration
    }), {
      bytesReceived: 0,
      bytesSent: 0,
      requestsTotal: 0,
      requestsSuccess: 0,
      requestsFailed: 0,
      totalDuration: 0
    });
    const serversByType = Array.from(this.servers.values()).reduce((acc, server) => {
      acc[server.type] = (acc[server.type] || 0) + 1;
      return acc;
    }, {});
    const connectionsByServer = Array.from(this.serverStats.entries()).reduce((acc, [serverId, stats]) => {
      acc[serverId] = stats.connections;
      return acc;
    }, {});
    return {
      servers: {
        total: this.servers.size,
        active: Array.from(this.servers.values()).filter((s) => s.status === "running").length,
        byType: serversByType
      },
      connections: {
        total: Array.from(this.serverStats.values()).reduce((sum, stats) => sum + stats.connections, 0),
        active: Array.from(this.serverStats.values()).reduce((sum, stats) => sum + stats.connections, 0),
        byServer: connectionsByServer
      },
      traffic: {
        bytesReceived: traffic.bytesReceived,
        bytesSent: traffic.bytesSent,
        requestsTotal: traffic.requestsTotal,
        requestsSuccess: traffic.requestsSuccess,
        requestsFailed: traffic.requestsFailed,
        avgResponseTime: traffic.requestsTotal > 0 ? traffic.totalDuration / traffic.requestsTotal : 0
      },
      requestsPerMinute
    };
  }
  listServers() {
    return Array.from(this.servers.values()).map((server) => ({
      ...server,
      stats: this.serverStats.get(this.getServerId(server.port, server.type))
    }));
  }
  async handleRequest(request, port) {
    const server = this.getServer(port, "http");
    if (!server || server.status !== "running") {
      return new Response("Service Unavailable", { status: 503 });
    }
    const process = this.getProcess(server.pid);
    if (!process || !(process instanceof NodeProcess)) {
      return new Response("Internal Server Error", { status: 500 });
    }
    if (!request.url) {
      request.url = request.path || "/";
    }
    const serverId = this.getServerId(port);
    const startTime = Date.now();
    let bytesReceived = 0;
    let bytesSent = 0;
    bytesReceived += request.url.length;
    Object.entries(request.headers || {}).forEach(([key, value]) => {
      bytesReceived += key.length + value.length;
    });
    if (request.body) {
      const body = request.body;
      bytesReceived += body.length;
    }
    try {
      this.stats.totalRequests++;
      let headers = {};
      const response = await process.handleHttpRequest({
        port,
        path: request.path,
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body
      });
      response.headers.forEach((value, key) => {
        bytesSent += key.length + value.length;
      });
      const responseBody = await response.clone().text();
      bytesSent += responseBody.length;
      this.logRequest(
        serverId,
        Date.now() - startTime,
        response.ok,
        bytesReceived,
        bytesSent
      );
      return response;
    } catch (error) {
      this.stats.failedRequests++;
      this.logRequest(
        serverId,
        Date.now() - startTime,
        false,
        bytesReceived,
        0
      );
      return new Response(
        error instanceof Error ? error.message : "Internal Server Error",
        { status: 500 }
      );
    }
  }
  createConnection(serverId, remotePort) {
    const id = Math.random().toString(36).substr(2, 9);
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error("Server not found");
    }
    this.connections.set(id, {
      id,
      serverId,
      remoteAddress: "127.0.0.1",
      remotePort,
      localAddress: "127.0.0.1",
      localPort: server.port
    });
    this.stats.totalConnections++;
    this.stats.activeConnections++;
    return id;
  }
  closeConnection(connectionId) {
    if (this.connections.delete(connectionId)) {
      this.stats.activeConnections--;
    }
  }
  dispose() {
    this.servers.clear();
    this.connections.clear();
  }
};

// src/container.ts
var OpenWebContainer = class {
  constructor(options = {}) {
    this.outputCallbacks = [];
    this.debugMode = options.debug || false;
    this.fileSystem = new ZenFSCore();
    this.processManager = new ProcessManager();
    this.processRegistry = new ProcessRegistry();
    this.networkManager = new NetworkManager({
      getProcess: (pid) => this.processManager.getProcess(pid),
      onServerListen: (port) => {
        if (options.onServerListen) {
          options.onServerListen(port);
        }
      },
      onServerClose: (port) => {
        if (options.onServerClose) {
          options.onServerClose(port);
        }
      }
    });
    this.processRegistry.registerExecutor(
      "javascript",
      new NodeProcessExecutor(this.fileSystem, this.networkManager)
    );
    this.processRegistry.registerExecutor(
      "shell",
      new ShellProcessExecutor(this.fileSystem)
    );
    this.debugLog("Container initialized");
  }
  debugLog(...args) {
    if (this.debugMode) {
      console.log("[Container]", ...args);
    }
  }
  /**
   * Network Operations
   */
  async handleHttpRequest(request, port) {
    this.debugLog(`HTTP Request: ${request.method} ${request.url} (Port: ${port})`);
    try {
      const response = await this.networkManager.handleRequest(request, port);
      this.debugLog(`HTTP Response: ${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      this.debugLog(`HTTP Error:`, error);
      return new Response(
        error instanceof Error ? error.message : "Internal Server Error",
        { status: 500 }
      );
    }
  }
  registerServer(pid, port, type, options = {}) {
    this.debugLog(`Registering ${type} server on port ${port} for process ${pid}`);
    return this.networkManager.registerServer(pid, port, type, options);
  }
  unregisterServer(port, type) {
    this.debugLog(`Unregistering server ${type}:${port}`);
    this.networkManager.unregisterServer(port, type);
  }
  getNetworkStats() {
    return this.networkManager.getNetworkStats();
  }
  listServers() {
    return this.networkManager.listServers();
  }
  /**
   * File system operations
   */
  writeFile(path, content) {
    this.fileSystem.writeFile(path, content);
  }
  readFile(path) {
    return this.fileSystem.readFile(path);
  }
  deleteFile(path) {
    this.fileSystem.deleteFile(path);
  }
  listFiles(basePath = "/") {
    return this.fileSystem.listFiles(basePath);
  }
  createDirectory(path) {
    this.fileSystem.createDirectory(path);
  }
  deleteDirectory(path) {
    this.fileSystem.deleteDirectory(path);
  }
  listDirectory(path) {
    return this.fileSystem.listDirectory(path);
  }
  /**
   * Process operations
   */
  async spawn(executablePath, args = [], parentPid, options = {}) {
    const executor = this.processRegistry.findExecutor(executablePath);
    if (!executor) {
      throw new Error(`No executor found for: ${executablePath}`);
    }
    const pid = this.processManager.getNextPid();
    const process = await executor.execute({
      executable: executablePath,
      args,
      cwd: options.cwd || "/",
      env: options.env || {}
    }, pid, parentPid);
    this.setupProcessEventHandlers(process);
    this.setupChildProcessSpawning(process);
    this.processManager.addProcess(process);
    process.start().catch(console.error);
    return process;
  }
  setupProcessEventHandlers(process) {
    process.addEventListener("message" /* MESSAGE */, (data) => {
      if (data.stdout) {
        this.notifyOutput(data.stdout);
      }
      if (data.stderr) {
        this.notifyOutput(data.stderr);
      }
    });
    process.addEventListener("error" /* ERROR */, (data) => {
      if (data.error) {
        this.notifyOutput(`Error: ${data.error.message}
`);
      }
    });
    process.addEventListener("exit" /* EXIT */, (data) => {
      if (data.exitCode) {
        this.notifyOutput(`Process exited with code: ${data.exitCode}
`);
      }
    });
  }
  registerProcessExecutor(type, executor) {
    this.processRegistry.registerExecutor(type, executor);
  }
  /**
   * Register an output callback
   */
  onOutput(callback) {
    this.outputCallbacks.push(callback);
    return () => {
      this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback);
    };
  }
  notifyOutput(output) {
    this.outputCallbacks.forEach((callback) => callback(output));
  }
  getProcess(pid) {
    return this.processManager.getProcess(pid);
  }
  listProcesses() {
    return this.processManager.listProcesses();
  }
  /**
   * Get information about a process
   */
  getProcessInfo(process) {
    const stats = process.getStats();
    return {
      pid: stats.pid,
      ppid: stats.ppid,
      type: stats.type,
      state: stats.state,
      executablePath: stats.executablePath,
      args: stats.args,
      startTime: stats.startTime,
      endTime: stats.endTime,
      uptime: process.uptime ?? void 0
    };
  }
  // Add method to get child processes
  getChildProcesses(parentPid) {
    return this.processManager.listProcesses().filter((process) => process.parentPid === parentPid);
  }
  /**
   * Get process tree for a given process
   */
  getProcessTree(pid) {
    const process = this.processManager.getProcess(pid);
    if (!process) {
      throw new Error(`Process ${pid} not found`);
    }
    return {
      info: this.getProcessInfo(process),
      children: this.getChildProcesses(pid).map((child) => this.getProcessTree(child.pid))
    };
  }
  /**
   * Get full process tree starting from init process
   */
  getFullProcessTree() {
    const topLevelProcesses = this.processManager.listProcesses().filter((process) => !process.parentPid);
    return topLevelProcesses.map((process) => this.getProcessTree(process.pid));
  }
  /**
   * Print process tree (useful for debugging)
   */
  printProcessTree(tree, indent = "") {
    const { info } = tree;
    let output = `${indent}${info.pid} ${info.executablePath} (${info.state})`;
    if (info.uptime !== void 0) {
      output += ` - uptime: ${info.uptime}ms`;
    }
    output += "\n";
    for (const child of tree.children) {
      output += this.printProcessTree(child, indent + "  ");
    }
    return output;
  }
  /**
   * Terminate a process and all its children
   */
  async terminateProcessTree(pid) {
    const children = this.getChildProcesses(pid);
    await Promise.all(
      children.map((child) => this.terminateProcessTree(child.pid))
    );
    const process = this.processManager.getProcess(pid);
    if (process) {
      await process.terminate();
      this.processManager.removeProcess(pid);
    }
  }
  setupChildProcessSpawning(process) {
    process.addEventListener("spawn_child" /* SPAWN_CHILD */, (data) => {
      this.spawnChildProcess(process.pid, data.payload, data.callback);
    });
  }
  async spawnChildProcess(parentPid, payload, callback) {
    let childPid = null;
    try {
      const parentProcess = this.processManager.getProcess(parentPid);
      if (!parentProcess) {
        throw new Error(`Parent process ${parentPid} not found`);
      }
      const childCwd = parentProcess && parentProcess.shell && parentProcess.shell.currentDirectory
        ? parentProcess.shell.currentDirectory
        : parentProcess.cwd;
      const childProcess = await this.spawn(
        payload.executable,
        payload.args,
        parentPid,
        {
          cwd: childCwd || "/",
          env: parentProcess.env
        }
      );
      childPid = childProcess.pid;
      childProcess.addEventListener("message" /* MESSAGE */, (data) => {
        parentProcess.emit("message" /* MESSAGE */, { ...data });
      });
      childProcess.addEventListener("error" /* ERROR */, (data) => {
        if (data.error) {
          parentProcess.emit("message" /* MESSAGE */, { stderr: data.error.message + "\n" });
        }
      });
      childProcess.addEventListener("exit" /* EXIT */, (data) => {
        callback({
          stdout: "",
          stderr: "",
          exitCode: data.exitCode ?? 1
        });
        this.processManager.removeProcess(childProcess.pid);
      });
    } catch (error) {
      if (childPid) {
        this.processManager.removeProcess(childPid);
      }
      callback({
        stdout: "",
        stderr: error.message,
        exitCode: 1
      });
    }
  }
  /**
   * Container Lifecycle
   */
  async dispose() {
    this.debugLog("Disposing container");
    for (const server of this.listServers()) {
      this.networkManager.unregisterServer(server.port, server.type);
    }
    await this.processManager.killAll();
    this.outputCallbacks = [];
    this.networkManager.dispose();
    this.debugLog("Container disposed");
  }
};
export {
  OpenWebContainer,
  Process,
  ProcessEvent,
  ProcessManager,
  ProcessRegistry,
  ProcessState,
  ShellProcess
};
//# sourceMappingURL=index.js.map
