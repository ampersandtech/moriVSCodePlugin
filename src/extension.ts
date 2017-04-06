'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as moment from 'moment';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    function modifyCurrentDocument(pos: vscode.Position, content: string) {
        if (!vscode.window.activeTextEditor) {
            vscode.window.showErrorMessage('No current document');
            return;
        }

        vscode.window.activeTextEditor.edit(function(edit) {
            edit.replace(pos, content);
        });
    }

    let coprightHeader = vscode.commands.registerCommand('mori.copyrightHeader', async () => {
        var year = moment(Date.now()).year();
        var copy = `/**\n* Copyright ${year}-present Mori, Inc.\n*\n*/\n'use strict';\n\n`
        return modifyCurrentDocument(new vscode.Position(0,0), copy);
    });

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('mori.importAndRequire', async () => {
        // The code you place here will be executed every time your command is executed
        const files = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,svg}', '**/node_modules/**');

        if (!files) {
            vscode.window.showErrorMessage('Unable to find any files! Did you open a project?');
            return;
        }

        const root = vscode.workspace.rootPath;
        const choices = files.map(file => {
            const lastSlash = file.path.lastIndexOf('/');
            return {
                label: file.path.substr(lastSlash + 1),
                description: '',
                detail: file.path,
            };
        });

        let result = await vscode.window.showQuickPick(choices, {matchOnDetail: true});

        if (!result) {
            return;
        }
        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World! ' + vscode.workspace.rootPath + ': ' + JSON.stringify(result));
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(coprightHeader);
}

// this method is called when your extension is deactivated
export function deactivate() {
}