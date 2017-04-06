'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as moment from 'moment';
import * as path from 'path';


let gRegs = {
    js: {
        module: /var\W+([A-Za-z]+)\W+=\W+require\('[\w./\//]+'\);/,
        file: /var\W+([A-Za-z]+)\W+=\W+appRequire\('([\w./\//]+)'\);/,
    },
};

let gNodeMods = ['fs', 'path', 'react'].map(mod => {
    return {
        label: mod,
        description: 'module',
        detail: '',
    };
});

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
        const files = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,svg}', '/node_modules/**');

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
                detail: file.path.slice(root.length + 2),
            };
        }).concat(gNodeMods);
        

        let result = await vscode.window.showQuickPick(choices, {matchOnDetail: true});

        if (!result) {
            return;
        }

        var mod = false;
        var statement; 
        if (result.detail) {
            let moduleName = `${result.label[0].toUpperCase()}${result.label.slice(1, result.label.indexOf('.'))}`;
            statement = `var ${moduleName} = appRequire('${result.detail}');\n`
        } else {
            // is a module, don't use appRequire
            statement = `var ${result.label} = require('${result.label}');`
            if (!result.label.startsWith('react')) {
                mod = true;
            }
        }

        var pos = 0;
        var doc = vscode.window.activeTextEditor.document;
        var foundOthers : boolean = false;
        var reg = gRegs.js;

        for (var i=0;i<doc.lineCount;i++) {
            let line = doc.lineAt(i);

            if (line.text === `'use strict';`) {
                pos = i + 1;
            }

            if (line.text.trim() === '') {
                if (foundOthers) {
                    break;
                } else {
                    continue;
                }
            } else {
                if (mod) {
                    var m = line.text.match(reg.module);

                    if (m) {
                        foundOthers = true;
                        if (m[1] > result.label) {
                            break;
                        } else {
                            pos = i+1;
                        }
                    }
                } else {
                    var m = line.text.match(reg.file);

                    if (m) {
                        foundOthers = true;
                        if (m[2] === result.detail) {
                            //Already found
                            return;
                        }
                        if (m[1].toLowerCase() > result.label.toLowerCase()) {
                            break;
                        } else {
                            pos = i+1;
                        }
                    } else if (!foundOthers) {
                        m = line.text.match(reg.module);

                        if (m) {
                            pos = i+1;
                        }
                    }
                }
            }
        }

        const nextLine = pos < doc.lineCount ? doc.lineAt(pos+1).text.trim() : 'EOF';
        if (nextLine !== '') {
            var expr = mod ? reg.module : reg.file;
            if (!nextLine.match(expr)) {
                statement = statement + '\n';
            }
        }

        const prevLine = pos > 0 ? doc.lineAt(pos-1).text.trim() : 'BOF';
        if (prevLine !== '') {
            var expr = mod ? reg.module : reg.file;
            if (!prevLine.match(expr)) {
                statement = '\n' + statement;
            }
        }

        modifyCurrentDocument(doc.lineAt(pos).range.start, statement);
        
        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World! ' + vscode.workspace.rootPath + ': ' + JSON.stringify(result));
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(coprightHeader);
}

// this method is called when your extension is deactivated
export function deactivate() {
}