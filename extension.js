const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

let apiKey = '';
let model = 'gpt-4o';
let contextLimit = 5;
let recentPrompts = [];

class AhaChatSidebarProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView, context, _token) {
    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.html = this.getHtmlForWebview();

    webviewView.webview.onDidReceiveMessage(async message => {
      if (message.command === 'ask') {
        const projectContext = await getWorkspaceCodeSample();
        const fullPrompt = `${projectContext}\n\n${message.text}`;
        const response = await sendToGPT(fullPrompt);
        webviewView.webview.postMessage({ type: 'response', text: response });
        recentPrompts.unshift({ q: message.text, a: response });
        recentPrompts = recentPrompts.slice(0, 5);
        webviewView.webview.postMessage({ type: 'history', history: recentPrompts });
      } else if (message.command === 'saveSettings') {
        apiKey = message.apiKey;
        model = message.model;
        contextLimit = parseInt(message.contextLimit, 10) || 5;
        vscode.workspace.getConfiguration().update('ahaAI.apiKey', apiKey, true);
        vscode.workspace.getConfiguration().update('ahaAI.model', model, true);
        vscode.workspace.getConfiguration().update('ahaAI.contextLimit', contextLimit, true);
        vscode.window.showInformationMessage('Settings saved.');
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
            margin-bottom: 0.5rem; border: 1px solid #ccc; border-radius: 6px;
          }
          button {
            background: #007acc; color: white; border: none;
            padding: 0.5rem 1rem; font-size: 1rem; border-radius: 4px;
            cursor: pointer; margin-bottom: 1rem;
          }
          pre {
            white-space: pre-wrap; background: #1e1e1e; color: #e0e0e0;
            padding: 1rem; border-radius: 6px; max-height: 400px;
            overflow-y: auto; font-size: 0.9rem;
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
          <h3>Aha Chat</h3>
          <textarea id="prompt" rows="4" placeholder="Ask something about your WordPress code..."></textarea>
          <button onclick="askGPT()">Ask</button>
          <div id="status"></div>
          <pre id="response"></pre>

          <button onclick="toggleSettings()">⚙️ Settings</button>
          <div id="settings">
            <input type="text" id="apiKey" placeholder="OpenAI API Key" />
            <select id="model">
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4">gpt-4</option>
              <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
            </select>
            <input type="number" id="contextLimit" placeholder="Number of context files (e.g., 5)" min="1" max="20" />
            <button onclick="saveSettings()">Save Settings</button>
          </div>

          <h4>Recent Prompts</h4>
          <ul id="history" style="padding-left: 0; list-style: none;"></ul>

          <script>
            const vscode = acquireVsCodeApi();

            function askGPT() {
              const text = document.getElementById('prompt').value;
              const status = document.getElementById('status');
              const responseBox = document.getElementById('response');
              status.textContent = '⏳ Waiting for Aha solution...';
              responseBox.textContent = '';
              vscode.postMessage({ command: 'ask', text });
            }

            function saveSettings() {
              const apiKey = document.getElementById('apiKey').value;
              const model = document.getElementById('model').value;
              const contextLimit = document.getElementById('contextLimit').value;
              vscode.postMessage({ command: 'saveSettings', apiKey, model, contextLimit });
            }

            function toggleSettings() {
              const el = document.getElementById('settings');
              el.style.display = el.style.display === 'none' ? 'block' : 'none';
            }

            window.addEventListener('message', event => {
              const msg = event.data;
              if (msg.type === 'response') {
                document.getElementById('status').textContent = '';
                document.getElementById('response').textContent = msg.text;
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
              }
            });
          </script>
        </body>
      </html>
    `;
  }
}

function activate(context) {
  console.log('✅ Aha AI Extension Activated');
  const filePromptCommand = vscode.commands.registerCommand('aha-ai.askChatGPT', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open a file to ask questions about.');
      return;
    }

    const fileText = editor.document.getText();
    const fileName = path.basename(editor.document.fileName);

    const userPrompt = await vscode.window.showInputBox({
      prompt: 'Ask ChatGPT about this file (bug fix, improvement, validation...)'
    });

    if (!userPrompt) return;

    const fullPrompt = `File: ${fileName}\n\n${fileText.substring(0, 3000)}\n\nQuestion: ${userPrompt}`;
    sendToGPT(fullPrompt);
  });

  console.log('📦 Registering AhaChatSidebarProvider...');
  const sidebarProvider = new AhaChatSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('aha-ai.chatView', sidebarProvider)
  );
  console.log('🎯 Sidebar Provider Registered');

  context.subscriptions.push(filePromptCommand);

  const config = vscode.workspace.getConfiguration();
  apiKey = config.get('ahaAI.apiKey') || '';
  model = config.get('ahaAI.model') || 'gpt-4o';
  contextLimit = config.get('ahaAI.contextLimit') || 5;
}

async function getWorkspaceCodeSample() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return '';
  const folderPath = folders[0].uri.fsPath;
  let snippet = '';

  try {
    const files = await vscode.workspace.findFiles('**/*.{php,js,ts}', '**/node_modules/**', contextLimit);
    for (const file of files) {
      const content = fs.readFileSync(file.fsPath, 'utf-8');
      snippet += `\n\nFile: ${file.fsPath.replace(folderPath, '')}\n\n${content.substring(0, 1000)}`;
    }
  } catch (err) {
    console.error('Error reading project files:', err);
  }
  return snippet;
}

async function sendToGPT(prompt) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a WordPress and WooCommerce code assistant. Read project files to identify and fix bugs, suggest features, write or improve code, validate support responses, and contribute to WordPress and WooCommerce. Help build themes, plugins, blocks, and provide support-accurate, human-friendly responses.'
          },
          { role: 'user', content: prompt.substring(0, 10000) }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    vscode.window.showErrorMessage('Failed to get response from ChatGPT.');
    console.error('❌ Error details:', error.response?.data || error.message);
    return 'Error: Could not get a response.';
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
