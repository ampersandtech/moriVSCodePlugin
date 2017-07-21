/**
* Copyright 2017-present Ampersand, Inc.
*
*/

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { HeaderFlip } from './headerFlip';
import { AliasLabel, GetFileCache, FindAllFiles, GetImportLines, SortImports } from './helpers';
import { SortImportsCommand, ImportModule } from './importModule';

import * as fs from 'fs';
import * as moment from 'moment';
import * as path from 'path';
import * as vscode from 'vscode';


let gRegs = {
    js: {
        module: /var\W+([a-z]\w*)\W+=\W+require\('([\w./\//]+)'\).*;/,
        file: /var\W+([A-Z]\w*)\W+=\W+(?:app)?[rR]equire\('([\w./\//]+)'\).*;/,
        moduleStatement: function(moduleName, filePath) {
            return `var ${moduleName} = require('${filePath}');\n`;
        },
        fileStatement: function(moduleName, filePath) {
            return `var ${moduleName} = appRequire('${filePath}');\n`
        },
    },
    ts: {
        module: /import\s+(?:\*\s+as\s+([a-z]\w+))?(?:{\s*[a-z][^}]+})?\s+from\s+'([^']+)';/,
        file: /import\s+(?:\*\s+as\s+([A-Z]\w+))?(?:{\s*[A-Z][^}]+})?\s+from\s+'([^']+)';/,
        moduleStatement: function(moduleName, filePath) {
            return `import * as ${moduleName} from '${filePath}';\n`;
        },
        fileStatement: function(moduleName, filePath) {
            return `import * as ${moduleName} from '${filePath}';\n`;
        },
    },
};

function readDirPromise(path) {
    return new Promise((resolve, reject) => {
        try {
            fs.readdir(path, (items) => {
                resolve(items);
            });
        } catch(e) {
            reject(e);
        }
    })
}

const gIgnoreDirs = [
    'node_modules',
    'backups',
    'builds',
    'branding',
    'tmp',
    'cache',
    'clientcache',
    'ios',
    's3mirror',
    'dist', // ignore old dist folder
    'testdist', // ignore old testdist folder
    '**/dist', // ignore new dist folders
    '.*', // ignore hidden directories (like .vscode/)
];

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    FindAllFiles(vscode.workspace.rootPath, gIgnoreDirs);

    fs.watch(vscode.workspace.rootPath, {recursive: true}, (e, filename) => {
        if (filename[0] === '.') {
            return;
        }

        var file = filename.toString();

        if (gIgnoreDirs.indexOf(file.slice(0, file.indexOf('/')-1)) !== -1) {
            return;
        }

        if (e === 'rename') {
            FindAllFiles(vscode.workspace.rootPath, gIgnoreDirs);
        }
    });

    vscode.workspace.onWillSaveTextDocument((e) => {
        if (!e.document.fileName.match(/\.[tj]sx?$/)) {
            return;
        }

        let config = vscode.workspace.getConfiguration('ampersandvscode');

        if (!config || !config.get('sortImportsOnSave')) {
            return;
        }

        var curText = e.document.getText().split('\n');
        var importBlock = GetImportLines(curText);
        var oldBlock = importBlock.imports.slice();
        var sortIt = false;

        SortImports(importBlock.imports);

        if (oldBlock.length === importBlock.imports.length) {
            for (let i=0;i<oldBlock.length;i++) {
                if (oldBlock[i] !== importBlock.imports[i]) {
                    sortIt = true;
                    break;
                }
            }
        } else {
            sortIt = true;
        }

        if (sortIt) {
            const addLine = curText[importBlock.range.end.line+1] ? true : false;

            vscode.window.activeTextEditor.edit(function(edit) {
                edit.replace(importBlock.range, importBlock.imports.join('\n') + (addLine ? '\n' : ''));
            });

            const disp = vscode.window.setStatusBarMessage('ampersandVSCode: I sorted your imports for you. You\'re welcome!', 3000);
        }
    });

    function modifyCurrentDocument(pos: vscode.Position | vscode.Range, content: string) {
        if (!vscode.window.activeTextEditor) {
            vscode.window.showErrorMessage('No current document');
            return;
        }

        vscode.window.activeTextEditor.edit(function(edit) {
            edit.replace(pos, content);
        });
    }

    function getCurrentExt() : string {
        var fileName = vscode.window.activeTextEditor.document.fileName;

        return fileName ? fileName.slice(fileName.lastIndexOf('.')+1) : '';
    }

    let headerFlip = vscode.commands.registerCommand('ampersand.headerFlip', async() => {
        await HeaderFlip();
    });

    let coprightHeader = vscode.commands.registerCommand('ampersand.copyrightHeader', async () => {
        var year = moment(Date.now()).year();
        var copy = `/**\n* Copyright ${year}-present Ampersand Technologies, Inc.\n*\n*/\n`
        var ext = getCurrentExt();
        if (ext === 'js' || ext ==='jsx') {
            copy += `'use strict';\n\n`;
        } else {
            copy += `\n`;
        }
        return modifyCurrentDocument(new vscode.Position(0,0), copy);
    });

    let importSort = vscode.commands.registerCommand('ampersand.importSort', SortImportsCommand);

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let importAndRequire = vscode.commands.registerCommand('ampersand.importAndRequire', async () => {
        return ImportModule();
    });

    let convertToTS = vscode.commands.registerCommand('ampersand.convertToTS', async () => {
        let curFile = vscode.window.activeTextEditor.document.fileName;

        if (!curFile.match(/\.tsx?$/)) {
            if (!curFile.match(/\.jsx?$/)) {
                vscode.window.showErrorMessage('Unable to format this kind of file. Choose a JS or TS file');
                return;
            }

            let nextFile = curFile.slice(0, curFile.lastIndexOf('.')) + '.ts';
            if (curFile[curFile.length-1] === 'x') {
                nextFile += 'x';
            }

            let term = vscode.window.createTerminal("git rename", "bash", []);

            await term.sendText(`git mv ${curFile} ${nextFile}`);

            let c = 0;
            let found = false;
            let currentDoc = null;

            while(c < 100) {
                let nextFileURI = vscode.Uri.file(nextFile);

                if (nextFileURI) {
                    let found = true;

                    vscode.commands.executeCommand('workbench.action.closeActiveEditor');

                    try {
                        currentDoc = await vscode.workspace.openTextDocument(nextFileURI);
                    } catch(e) {
                        c++;
                        found = false;
                    } finally {

                        if (found) {
                            await vscode.window.showTextDocument(currentDoc);
                            break;
                        }
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        interface regMatch {
            match: RegExp;
            replace?: (match) => string;
            deleteLine?: boolean;
        }
        await vscode.window.activeTextEditor.edit(function(edit) {
            let regs: regMatch[] = [
                {match: /var\s+([^\s]*)\s+=\s+require\('([^']*)'\);/, replace: (match) => {return `import * as ${match[1]} from '${match[2]}';`}},
                {match: /var\s+([^\s]*)\s+=\s+appRequire\('([^']*.jsx)'\);/, replace: (match) => {return `const ${match[1]} = require('${match[2]}');`}},
                {match: /var\s+([^\s]*)\s+=\s+appRequire\('([^']*.svg)'\);/, replace: (match) => {return `const ${match[1]} = require('${match[2]}');`}},
                {match: /var\s+([^\s]*)\s+=\s+appRequire\('([^']*)'\);/, replace: (match) => {return `import * as ${match[1]} from '${match[2]}';`}},
                {match: /(^|\s*)var\s/, replace: (match) => {return `${match[1]}const `}},
                {match: /(^|\s*)if (\(.*\)) ([^{}]*);/, replace: (match) => {return `${match[1]}if ${match[2]} { ${match[3]}; }`}},
                {match: /'use strict';/, deleteLine: true},
            ];

            let doc = vscode.window.activeTextEditor.document;
            let funcLines = {};

            for (var i=0;i<doc.lineCount;i++) {
                let line = doc.lineAt(i);
                let match;

                for (var r=0;r<regs.length;r++) {
                    match = line.text.match(regs[r].match);
                    if (match) {
                        var reg = regs[r];



                        if (reg.deleteLine) {
                            var range = new vscode.Range(line.range.start.line, 0, line.range.start.line+1, 0);
                            edit.delete(range);
                        } else if (reg.replace) {
                            var range = new vscode.Range(
                                new vscode.Position(line.range.start.line, line.range.start.character + match.index),
                                new vscode.Position(line.range.start.line, line.range.start.character + match.index + match[0].length));

                            edit.replace(range, reg.replace(match));
                        }

                        break;
                    }
                }

                //store all named functions
                match = line.text.match(/(?:^)function ([^\s()]+)\([^)]*\) {/);
                if (match) {
                    funcLines[match[1]] = {line: i, character: match.index};
                }

                match = line.text.match(/(?:module\.)?exports\.?([^\s]+)? = ([^\s]+);/);
                if (match) {
                    let funcLine = funcLines[match[2]];
                    if (funcLine) {
                        if (match[1] === match[2]) {
                            if (funcLine) {
                                edit.replace(new vscode.Position(funcLine.line, funcLine.character), 'export ');
                            }
                            edit.delete(line.range);
                        } else if (!match[1]) {
                            if (funcLine.deleteConst) {
                                edit.delete(new vscode.Selection(
                                    new vscode.Position(funcLine.line, funcLine.character),
                                    new vscode.Position(funcLine.line, funcLine.character + 5)
                                ));
                            }
                            edit.replace(new vscode.Position(funcLine.line, funcLine.character), 'export default ');
                            edit.delete(line.range);
                        } else {
                            console.log('unable to find a match');
                        }
                    }

                }
            }
        });

        await vscode.window.activeTextEditor.edit((edit) => {
            let doc = vscode.window.activeTextEditor.document;
            let match;

            let componentName :string;
            let tabVal :string;
            let lines :string[];
            let lineStart = 0;
            let closingTab :string;
            let hasProps = false;
            let inInterface = false;
            let interfaceLines = [];

            for (let i=0;i<doc.lineCount;i++) {
                let line = doc.lineAt(i);

                match = line.text.match(/(\s*)const\s+(\w+)\s+=\s+React.createClass\({/);
                if (match) {
                    lineStart = i;
                    componentName = match[2];
                    tabVal = match[1];
                    lines = [];
                    interfaceLines = [];

                    lines.push(`${tabVal}class ${match[2]} extends React.Component<{}, {}> {`);
                    continue;
                }

                if (componentName) {
                    match = line.text.match(/^(\s*)}\);/);
                    if (match) {
                        if (match[1] === tabVal) {
                            lines.push(`${tabVal}};`);
                            let range = new vscode.Range(
                                new vscode.Position(lineStart, 0),
                                new vscode.Position(i+1,0),
                            );
                            if (hasProps) {
                                edit.replace(range, `${interfaceLines.join('\n')}\n\n${lines.join('\n')}\n`)
                            } else {
                                edit.replace(range, lines.join('\n')+'\n')
                            }

                            componentName = null;
                            lines = null;
                            interfaceLines = null;
                            lineStart = 0;
                            continue;
                        }
                    }

                    match = line.text.match(/(\s*)propTypes:\s*{/);
                    if (match && match[1].length === tabVal.length + 2) {
                        hasProps = true;
                        inInterface = true;
                        interfaceLines.push(`${tabVal}interface ${componentName}Props {`);
                        lines[0] = `${tabVal}class ${componentName} extends React.Component<${componentName}Props, {}> {`;
                        //Don't continue here, allow for the prop strucutre to remain
                    }


                    match = line.text.match(/(\s*)(\w+):\s+function(\([^)]*\))\s+{/);
                    if (match && match[1].length === tabVal.length + 2) {
                        lines.push(`${match[1]}${match[2]}${match[3]} {`);
                        continue;
                    }

                    match = line.text.match(/(\s*)},/);
                    if (match && match[1].length === tabVal.length + 2) {
                        lines.push(`${match[1]}}`);
                        if (inInterface) {
                            interfaceLines.push('};');
                            inInterface = false;
                        }
                        continue;
                    }

                    if (closingTab) {
                        match = line.text.match(/([^,])+,\s*$/);
                        if (match && match[1] === closingTab) {
                            lines.push(`${match[2]};`);
                            closingTab = null;
                            continue;
                        }
                    }

                    match = line.text.match(/(\s+)([\w]+):\s*([^,]*)?(,)?$/);
                    if (match && match[1].length === tabVal.length + 2) {
                        let staticLine = `${match[1]}static ${match[2]}`;
                        if (match[3]) {
                            staticLine += ` = ${match[3]}`;
                        }
                        if (match[4]) {
                            staticLine += ';';
                        } else {
                            closingTab = match[1];
                        }
                        lines.push(staticLine);
                        continue;
                    }

                    if (inInterface) {
                        interfaceLines.push(line.text.slice(tabVal.length+2));
                    }

                    lines.push(line.text);
                }
            }
        });
    });

    context.subscriptions.push(convertToTS);
    context.subscriptions.push(importAndRequire);
    context.subscriptions.push(coprightHeader);
    context.subscriptions.push(headerFlip);
}

// this method is called when your extension is deactivated
export function deactivate() {
}