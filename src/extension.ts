import * as vscode from 'vscode';
import axios from 'axios';

const SUPABASE_URL = 'https://emzxskvdaserwfmjzrqw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtenhza3ZkYXNlcndmbWp6cnF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTI4MjksImV4cCI6MjA4ODQ4ODgyOX0.DSZQIu_KiC3rm9_WVM-1yPRFU4sQXjh8x61bMs5l-Mc';

let accessToken: string | null = null;
let userId: string | null = null;

async function login(email: string, password: string) {
    const res = await axios.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        email,
        password
    }, {
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
        }
    });
    accessToken = res.data.access_token;
    userId = res.data.user.id;
    return res.data;
}

async function getAiFix(bugId: string) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "🤖 AI is analyzing your bug...",
        cancellable: false
    }, async () => {
        try {
            const res = await axios.post(`${SUPABASE_URL}/functions/v1/ai-bug-solver`, {
                bug_id: bugId
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY
                }
            });

            const solution = res.data.solution;

            const doc = await vscode.workspace.openTextDocument({
                content: solution,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, { preview: false });

            vscode.window.showInformationMessage("✅ AI solution generated and saved!");
        } catch (error: any) {
            const msg = error.response?.data?.error || error.message;
            vscode.window.showErrorMessage("AI Fix failed: " + msg);
        }
    });
}

export function activate(context: vscode.ExtensionContext) {
    // LOGIN
    let loginCmd = vscode.commands.registerCommand('trb.login', async () => {
        const email = await vscode.window.showInputBox({ prompt: 'Email', placeHolder: 'your@email.com' });
        if (!email) return;
        const password = await vscode.window.showInputBox({ prompt: 'Password', password: true });
        if (!password) return;

        try {
            await login(email, password);
            vscode.window.showInformationMessage('Logged in successfully!');
        } catch (error: any) {
            vscode.window.showErrorMessage('Login failed: ' + (error.response?.data?.error_description || error.message));
        }
    });

    // REPORT BUG
    let reportBugCmd = vscode.commands.registerCommand('trb.reportBug', async () => {
        if (!accessToken || !userId) {
            vscode.window.showErrorMessage('Please login first! Run "TRB: Login" command.');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("Please open a file first!");
            return;
        }

        const document = editor.document;
        const selection = editor.selection;
        const selectedCode = document.getText(selection) || "No code highlighted";
        const lineNumber = (selection.active.line + 1).toString();
        const fileName = document.fileName.split(/[\\/]/).pop() || "file";
        const languageId = document.languageId;

        const bugDescription = await vscode.window.showInputBox({
            prompt: "Reporting bug in " + fileName + " (Line " + lineNumber + ")",
            placeHolder: "What is the issue?"
        });

        if (bugDescription) {
            try {
                const res = await axios.post(`${SUPABASE_URL}/rest/v1/bugs`, {
                    user_id: userId,
                    title: `Bug in ${fileName} [${languageId}] Line ${lineNumber}`,
                    description: bugDescription,
                    code_snippet: selectedCode,
                    priority: 'medium',
                    status: 'open',
                    is_public: false
                }, {
                    headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation'
                    }
                });

                const bugId = res.data?.[0]?.id;
                vscode.window.showInformationMessage("Bug reported for line " + lineNumber + "!");

                if (bugId) {
                    const choice = await vscode.window.showInformationMessage(
                        "Want AI to analyze and fix this bug?",
                        "Yes, fix it!", "No thanks"
                    );
                    if (choice === "Yes, fix it!") {
                        await getAiFix(bugId);
                    }
                }
            } catch (error: any) {
                vscode.window.showErrorMessage("Failed: " + (error.response?.data?.message || error.message));
            }
        }
    });

    // AI FIX
    let aiFixCmd = vscode.commands.registerCommand('trb.aiFix', async () => {
        if (!accessToken || !userId) {
            vscode.window.showErrorMessage('Please login first! Run "TRB: Login" command.');
            return;
        }

        try {
            const res = await axios.get(`${SUPABASE_URL}/rest/v1/bugs`, {
                params: {
                    user_id: `eq.${userId}`,
                    status: 'neq.closed',
                    select: 'id,title,priority,status',
                    order: 'created_at.desc',
                    limit: 30
                },
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            const bugs = res.data;
            if (!bugs || bugs.length === 0) {
                vscode.window.showInformationMessage("No open bugs found.");
                return;
            }

            const items = bugs.map((b: any) => ({
                label: `[${b.priority}] ${b.title}`,
                description: b.status,
                bugId: b.id
            }));

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: "Select a bug to get AI solution"
            });

            if (picked) {
                await getAiFix((picked as any).bugId);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage("Failed to fetch bugs: " + error.message);
        }
    });

    context.subscriptions.push(loginCmd, reportBugCmd, aiFixCmd);
}

export function deactivate() {}
