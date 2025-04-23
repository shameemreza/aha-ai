let globalWebview = null;
let contextFiles = [];
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

let model = "gpt-4o";
let contextLimit = 5;
let compression = "full";
let recentPrompts = [];
let selectedPaths = [];

class AhaChatSidebarProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView, context, _token) {
    webviewView.webview.options = {
      enableScripts: true,
    };

    const config = vscode.workspace.getConfiguration("ahaAI");
    webviewView.webview.postMessage({
      type: "loadSettings",
      settings: {
        apiKey: config.get("apiKey") || "",
        model: config.get("model") || "gpt-4o",
        contextLimit: config.get("contextLimit") || 5,
        compression: config.get("compression") || "full",
      },
    });

    webviewView.webview.html = this.getHtmlForWebview();
    globalWebview = webviewView.webview;

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === "ask") {
        const projectContext = await getSelectedContext();
        const fullPrompt = `${projectContext}\n\n${message.text}`;
        const response = await sendToGPT(fullPrompt);
        webviewView.webview.postMessage({ type: "response", text: response });
        recentPrompts.unshift({ q: message.text, a: response });
        recentPrompts = recentPrompts.slice(0, 5);
        webviewView.webview.postMessage({
          type: "history",
          history: recentPrompts,
        });
      } else if (message.command === "saveSettings") {
        const apiKey = message.apiKey;
        model = message.model;
        contextLimit = parseInt(message.contextLimit, 10) || 5;
        compression = message.compression || "full";

        await vscode.workspace
          .getConfiguration()
          .update("ahaAI.apiKey", apiKey, true);
        await vscode.workspace
          .getConfiguration()
          .update("ahaAI.model", model, true);
        await vscode.workspace
          .getConfiguration()
          .update("ahaAI.contextLimit", contextLimit, true);
        await vscode.workspace
          .getConfiguration()
          .update("ahaAI.compression", compression, true);
        vscode.window.showInformationMessage("Settings saved.");
      } else if (message.command === "selectFolder") {
        const fileOrFolderUris = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: true,
          canSelectMany: true,
        });
        if (fileOrFolderUris) {
          selectedPaths = fileOrFolderUris.map((f) => f.fsPath);
          vscode.window.showInformationMessage("Folders/files selected.");
          webviewView.webview.postMessage({
            type: "folders",
            paths: selectedPaths,
          });
          // NEW: Trigger context processing so checkboxes render
          await getSelectedContext();
        }
      } else if (message.command === "toggleFile") {
        if (contextFiles[message.index]) {
          contextFiles[message.index].included = message.included;
          await refreshDiagnostics();
        }
      } else if (message.command === "clearSelection") {
        contextFiles = [];
        selectedPaths = [];
      }
    });
  }

  getHtmlForWebview() {
    return `
      <html>
        <style>
          body { font-family: sans-serif; padding: 1rem; margin: 0; }
          input, select, textarea {
            width: 100%; padding: 0.5rem; font-size: 1rem;
            margin-bottom: 0.5rem; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; resize: vertical; overflow-x: hidden;
          }
          button {
            background: #007acc; color: white; border: none;
            padding: 0.5rem 1rem; font-size: 1rem; border-radius: 4px;
            cursor: pointer; margin-bottom: 1rem;
          }
          pre {
            white-space: pre-wrap; background: #1e1e1e; color: #e0e0e0;
            padding: 1rem; border-radius: 6px; max-height: 400px;
            overflow-y: auto; font-size: 0.9rem; word-wrap: break-word;   overflow-wrap: break-word;
          }
          #status { font-size: 0.85rem; color: #999; margin-top: 0.5rem; }
          #settings { display: none; margin-top: 1rem; }
          .collapsible {
            cursor: pointer; padding: 6px; background: #f3f3f3; border-radius: 4px;
            border: 1px solid #ccc; margin-bottom: 5px;
            font-weight: bold; color: #333;
          }
          .content {
            display: none; padding: 0.5rem; background: #f9f9f9;
            border: 1px solid #ddd; border-radius: 6px;
            margin-bottom: 0.75rem; white-space: pre-wrap; font-size: 0.85rem;
          }
        </style>
        <body>
          <textarea id="prompt" rows="4" placeholder="Ask something about your WordPress code..."></textarea>
          <button onclick="askGPT()">Ask</button>
          <div id="status"></div>
          <div id="diagnostics" style="font-size: 0.85rem; color: #666; margin-bottom: 1rem;"></div>
          <div id="fileActions" style="display: none; margin-bottom: 0.5rem;">
          <button onclick="selectAll(true)" style="font-size: 0.8rem; padding: 3px 8px;">Select</button>
          <button onclick="selectAll(false)" style="font-size: 0.8rem; padding: 3px 8px;">Deselect</button>
          <button onclick="clearFolder()" style="font-size: 0.8rem; padding: 3px 8px;">Clear</button>
        </div>
          <div id="contextFiles" style="font-size: 0.85rem; margin-bottom: 1rem;"></div>
          <pre id="response" style="display: none;"></pre>

          <button onclick="toggleSettings()" style="font-size: 0.75rem; padding: 2px 6px; margin-bottom: 0.5rem;">⚙️ Settings</button>
          <div id="settings">
            <input type="password" id="apiKey" placeholder="OpenAI API Key" />
            <select id="model">
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4">gpt-4</option>
              <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
            </select>
            <input type="number" id="contextLimit" placeholder="Number of context files (e.g., 5)" min="1" max="20" />
            <select id="compression">
              <option value="full">Full</option>
              <option value="summary">Light Summary</option>
              <option value="headers">Function Names Only</option>
            </select>
            <button onclick="saveSettings()">Save Settings</button>
            <button onclick="selectFolder()">Select Folders</button>
            <div id="folderList" style="font-size: 0.85rem; margin-top: 0.5rem; color: #555;"></div>
          </div>

          <h4>Recent Prompts</h4>
          <ul id="history" style="padding-left: 0; list-style: none;"></ul>

          <script>
            const vscode = acquireVsCodeApi();
            function selectAll(state) {
  document.querySelectorAll('#contextFiles input[type=checkbox]').forEach(cb => {
    cb.checked = state;
    cb.dispatchEvent(new Event('change'));
  });
}
function clearFolder() {
  document.getElementById('contextFiles').innerHTML = '';
  document.getElementById('fileActions').style.display = 'none';
  document.getElementById('diagnostics').textContent = '';
  document.getElementById('toggleAllFiles').checked = false;
  vscode.postMessage({ command: 'clearSelection' });
}


            function askGPT() {
               const text = document.getElementById('prompt').value;
  const status = document.getElementById('status');
  const responseBox = document.getElementById('response');
  status.textContent = '⏳ Waiting for Aha solution...';
  responseBox.textContent = '';
  responseBox.style.display = 'none';
  vscode.postMessage({ command: 'ask', text });
            }

            function saveSettings() {
             const apiKey = document.getElementById('apiKey').value;
              const model = document.getElementById('model').value;
              const contextLimit = document.getElementById('contextLimit').value;
              const compression = document.getElementById('compression').value;
              vscode.postMessage({ command: 'saveSettings', apiKey, model, contextLimit, compression });
            }

            function toggleSettings() {
              const el = document.getElementById('settings');
              el.style.display = el.style.display === 'none' ? 'block' : 'none';
            }

            function selectFolder() {
              vscode.postMessage({ command: 'selectFolder' });
            }

            window.addEventListener('message', event => {
              const msg = event.data;
              if (msg.type === 'response') {
               document.getElementById('status').textContent = '';
               const box = document.getElementById('response');
  box.textContent = msg.text;
  box.style.display = 'block';
              } else if (msg.type === 'history') {
                const history = msg.history;
                const list = document.getElementById('history');
                list.innerHTML = '';
                history.forEach((entry, idx) => {
                  const li = document.createElement('li');
                  const header = document.createElement('div');
                  header.textContent = 'Q' + (idx + 1) + ': ' + entry.q.substring(0, 40) + '...';
                  header.className = 'collapsible';

                  const content = document.createElement('div');
                  content.className = 'content';
                  content.textContent = entry.a;

                  header.onclick = () => {
                    content.style.display = content.style.display === 'block' ? 'none' : 'block';
                  };

                  li.appendChild(header);
                  li.appendChild(content);
                  list.appendChild(li);
                });
              } else if (msg.type === 'folders') {
                const list = msg.paths.map(f => "<div style='margin-bottom: 4px;'>[Folder] " + f + "</div>").join('');
                document.getElementById('folderList').innerHTML = list;
              }
                else if (msg.type === 'loadSettings') {
  document.getElementById('apiKey').value = msg.settings.apiKey;
  document.getElementById('model').value = msg.settings.model;
  document.getElementById('contextLimit').value = msg.settings.contextLimit;
  document.getElementById('compression').value = msg.settings.compression;
} else if (msg.type === 'diagnostics') {
  const d = msg.data;
  document.getElementById('diagnostics').textContent =
  'Files: ' + d.contextFiles.length + ', Tokens: ~' + d.tokenEstimate + ', Skipped: ' + d.skipped;


  const container = document.getElementById('contextFiles');
  container.innerHTML = '';
  const fileActions = document.getElementById('fileActions');
fileActions.style.display = d.contextFiles.length > 0 ? 'block' : 'none';
  d.contextFiles.forEach((file, index) => {
    const row = document.createElement('div');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = file.included;
    checkbox.dataset.index = index;
    checkbox.onchange = () => {
      vscode.postMessage({ command: 'toggleFile', index, included: checkbox.checked });
    };
    const label = document.createElement('label');
let shortName = file.name.split('/').pop();
if (shortName.length > 20) shortName = shortName.slice(0, 17) + '...';
label.textContent = shortName + ' (~' + file.tokens + ' tokens)';
label.title = file.name;
label.style.marginLeft = '6px';

    row.appendChild(checkbox);
    row.appendChild(label);
    container.appendChild(row);
  });
}
            });
          </script>
        </body>
      </html>
    `;
  }
}

async function sendToGPT(prompt) {
  const apiKey = vscode.workspace.getConfiguration().get("ahaAI.apiKey");
  if (!apiKey) {
    vscode.window.showErrorMessage("No API key set in settings.");
    return "Error: Missing API key.";
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: model,
        messages: [
          {
            role: "system",
            content:
              "You are a WordPress and WooCommerce code assistant. Read project files to identify and fix bugs, suggest features, write or improve code, validate support responses, and contribute to WordPress and WooCommerce. Help build themes, plugins, blocks, and provide support-accurate, human-friendly responses.",
          },
          { role: "user", content: prompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    vscode.window.showErrorMessage("Failed to get response from ChatGPT.");
    console.error("❌ Error details:", error.response?.data || error.message);
    return "Error: Could not get a response.";
  }
}

async function getSelectedContext() {
  contextFiles = [];
  const files = [];
  let totalTokens = 0;
  let skipped = 0;

  for (const p of selectedPaths) {
    const stat = fs.statSync(p);
    if (stat.isFile()) {
      files.push(p);
    } else if (stat.isDirectory()) {
      collectFilesRecursively(p, files);
    }
  }

  const limited = new Set(files.slice(0, contextLimit)); // Use limit only for initial default
  const contents = [];
  contextFiles = [];

  for (const f of files) {
    try {
      const raw = fs.readFileSync(f, "utf-8");
      let chunk = "";

      if (compression === "full") {
        chunk = raw;
      } else {
        const lines = raw.split("\n");
        const headerLines = lines.filter((line) =>
          /^(function|class|\$?[a-zA-Z0-9_]+\s*=\s*function|\s*add_(action|filter))/.test(
            line.trim(),
          ),
        );

        if (compression === "headers") {
          chunk = headerLines.join("\n");
        } else {
          const docblock = [];
          let inComment = false;
          for (const line of lines) {
            if (!inComment && line.trim().startsWith("/**")) inComment = true;
            if (inComment) docblock.push(line);
            if (inComment && line.trim().endsWith("*/")) break;
          }
          chunk = `${docblock.join("\n")}\n\n${headerLines.join("\n")}`;
        }
      }

      contents.push(`// FILE: ${f}\n${chunk}`);
      totalTokens += Math.ceil(chunk.length / 4); // Rough estimate: 1 token ≈ 4 chars
      contextFiles.push({
        name: f,
        tokens: Math.ceil(chunk.length / 4),
        included: limited.has(f)
      });
    } catch {
      skipped++;
    }
  }
 
  // Send diagnostics to UI
  vscode.commands.executeCommand("workbench.view.extension.aha-ai");
  setTimeout(() => {
    vscode.commands.executeCommand("aha-ai.chatView.focus");
    //setTimeout(() => {
    //vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
    //}, 1000);
  }, 100);

  if (globalWebview) {
    globalWebview.postMessage({
      type: "diagnostics",
      data: {
        totalFiles: limited.length,
        tokenEstimate: totalTokens,
        skipped,
        contextFiles,
      },
    });
  }
  const includedFiles = contextFiles
    .filter((f) => f.included)
    .map((f) => f.name);

  // Optional: filter `contents` based on included files
  const includedContents = contents.filter((content) =>
    includedFiles.some((name) => content.startsWith(`// FILE: ${name}`)),
  );
  return includedContents.join("\n\n");

  return contents.join("\n\n");
}

function collectFilesRecursively(dir, fileList) {
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      collectFilesRecursively(fullPath, fileList);
    } else {
      fileList.push(fullPath);
    }
  }
}

async function refreshDiagnostics() {
  const includedFiles = contextFiles.filter((f) => f.included);
  const totalTokens = includedFiles.reduce((sum, f) => sum + f.tokens, 0);
  const skipped = contextFiles.filter((f) => !f.included).length;

  if (globalWebview) {
    globalWebview.postMessage({
      type: "diagnostics",
      data: {
        totalFiles: contextFiles.length,
        tokenEstimate: totalTokens,
        skipped,
        contextFiles,
      },
    });
  }
}

module.exports = {
  activate(context) {
    const provider = new AhaChatSidebarProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("aha-ai.chatView", provider),
    );
    setTimeout(() => {
      vscode.commands.executeCommand("aha-ai.chatView.focus");
    }, 1000);
  },
  deactivate() {},
};