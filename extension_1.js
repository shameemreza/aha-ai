const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

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
      }
    });
  }

  getHtmlForWebview() {
    return `
      <html>
        <style>
          body {
            font-family: sans-serif;
            padding: 1rem;
            margin: 0;
          }
          #prompt {
            width: 100%;
            padding: 0.5rem;
            font-size: 1rem;
            border: 1px solid #ccc;
            border-radius: 6px;
            margin-bottom: 0.5rem;
          }
          button {
            background: #007acc;
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            font-size: 1rem;
            border-radius: 4px;
            cursor: pointer;
          }
          pre {
            white-space: pre-wrap;
            background: #1e1e1e;
            color: #e0e0e0;
            padding: 1rem;
            border-radius: 6px;
            margin-top: 1rem;
            max-height: 400px;
            overflow-y: auto;
            font-size: 0.9rem;
          }
          #status {
            font-size: 0.85rem;
            color: #999;
            margin-top: 0.5rem;
          }
        </style>
        <body>
          <h3>Aha Chat</h3>
          <textarea id="prompt" rows="4" placeholder="Ask something about your WordPress code..."></textarea><br>
          <button onclick="askGPT()">Ask</button>
          <div id="status"></div>
          <pre id="response"></pre>
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
            window.addEventListener('message', event => {
              const msg = event.data;
              if (msg.type === 'response') {
                document.getElementById('status').textContent = '';
                document.getElementById('response').textContent = msg.text;
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
}

async function getWorkspaceCodeSample() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return '';
  const folderPath = folders[0].uri.fsPath;
  let snippet = '';

  try {
    const files = await vscode.workspace.findFiles('**/*.{php,js,ts}', '**/node_modules/**', 5);
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
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a WordPress and WooCommerce code assistant. Read project files to identify and fix bugs, suggest features, write or improve code, validate support responses, and contribute to WordPress and WooCommerce. Help build themes, plugins, blocks, and provide support-accurate, human-friendly responses.'
          },
          { role: 'user', content: prompt }
        ]
      },
      {
        headers: {
          'Authorization': 'Bearer ***REMOVED***',
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
