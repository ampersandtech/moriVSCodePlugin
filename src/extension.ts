'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as moment from 'moment';
import * as path from 'path';
import * as fs from 'fs';


let gRegs = {
    js: {
        module: /var\W+([a-z]\w*)\W+=\W+require\('([\w./\//]+)'\);/,
        file: /var\W+([A-Z]\w*)\W+=\W+(?:app)?[rR]equire\('([\w./\//]+)'\);/,
        moduleStatement: function(moduleName, filePath) {
            return `var ${moduleName} = require('${filePath}');\n`;
        },
        fileStatement: function(moduleName, filePath) {
            return `var ${moduleName} = appRequire('${filePath}');\n`
        },
    },
    ts: {
        module: /import\s+(?:\*\s+as\s+([a-z]\w+))?(?:{[a-z][^}]+})?\s+from\s+'([^']+)';/,
        file: /import\s+(?:\*\s+as\s+([A-Z]\w+))?(?:{[A-Z][^}]+})?\s+from\s+'([^']+)';/,
        moduleStatement: function(moduleName, filePath) {
            return `import * as ${moduleName} from '${filePath}';\n`;
        },
        fileStatement: function(moduleName, filePath) {
            return `import * as ${moduleName} from '${filePath}';\n`;
        },
    },
};

const coreModules = [
    "assert",
    "buffer",
    "cluster",
    "child_process",
    "crypto",
    "dgram",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "https",
    "net",
    "npm",
    "os",
    "path",
    "punycode",
    "readline",
    "stream",
    "string_decoder",
    "tls",
    "url",
    "util",
    "vm",
    "zlib",
  ];

let gNodeMods = coreModules.map(mod => {
    return {
        label: mod,
        description: 'core module',
        detail: '',
    };
});

let gAlias = {
    DB: {reg: /.*([Dd][Bb])(?:[A-Z]|$)+.*/, replace: ["DB"]},
    Util: {reg: /^((?:[Cc]lient)?(?:[Ss]erver)?)Util$/, replace: [""]},
    Log: {reg: /^[Ll]og(Common)$/, replace:[""]},
    React: {reg: /^react(Dom)$/, replace:["DOM"]},
    CS: {reg: /^([Cc]s)[A-Z].*/, replace:["CS"]},
};

let gSpecialChar = /([^\W\d_]+)(\d*)([\W_]?)([\w]?)(.*)/; //hmmm... might need a better one... this one goes on forever!

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

    function aliasLabel(label : string) {
        let rtn = label;

        if (rtn.endsWith('.svg')) {
            rtn = 'SVG' + rtn[0].toUpperCase() + rtn.slice(1);
        }

        var dotIndex = rtn.indexOf('.');

        if (dotIndex > -1) {
            rtn = rtn.slice(0, dotIndex);
        }

        for (var id in gAlias) {
            var m = gAlias[id].reg.exec(rtn);
            if (m) {
                for (var i=0;i<gAlias[id].replace.length;i++) {
                    var index = rtn.indexOf(m[i+1]);
                    if (index > -1) {
                        rtn = `${rtn.slice(0, index)}${gAlias[id].replace[i]}${rtn.slice(index+m[i+1].length)}`;
                    }
                }
                break;
            }
        }

        let s = gSpecialChar.exec(rtn);
        let c = 0;
        while(s && c<100) {
            c++;
            rtn = s[1] + s[2] + s[4].toUpperCase() + s[5];
            s = gSpecialChar.exec(rtn);
        }

        return rtn;
    }

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('mori.importAndRequire', async () => {
        // The code you place here will be executed every time your command is executed
        var fileName = vscode.window.activeTextEditor.document.fileName;
        if (fileName.lastIndexOf('.') === -1) {
            vscode.window.showErrorMessage('Unable to use import until an extension is specified');
            return;
        }
        var ext = fileName.slice(fileName.lastIndexOf('.')+1);
        var reg;
        if (ext === 'js' || ext === 'jsx') {
            reg = gRegs.js;
        } else if (ext === 'ts' || ext === 'tsx') {
            reg = gRegs.ts;
        } else {
            vscode.window.showErrorMessage('Unable to use import on files with extension of ' + ext);
            return;
        }

        // this needs to be made faster
        const files = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,svg}', '{node_modules,.*,backups,builds,branding,tmp,cache,clientcache,ios,s3mirror}/**');

        if (!files) {
            vscode.window.showErrorMessage('Unable to find any files! Did you open a project?');
            return;
        }
        
        const root = vscode.workspace.rootPath;
        var pack;
        try {
            pack = JSON.parse(fs.readFileSync(vscode.workspace.rootPath + '/package.json').toString());
        } catch(e) {
            vscode.window.showWarningMessage(`Unable to load ${vscode.workspace.rootPath}/package.json!`, e);
        }
        
        let projectMods = [];

        if (pack && pack.dependencies) {
            for (var dep in pack.dependencies) {
                projectMods.push({
                    label: dep,
                    description: pack.dependencies[dep],
                    detail: 'dependency',
                });
            }
        }
        
        const choices = files.map(file => {
            const lastSlash = file.path.lastIndexOf('/');
            return {
                label: file.path.substr(lastSlash + 1),
                description: '',
                detail: file.path.slice(root.length + 1),
            };
        }).concat(gNodeMods).concat(projectMods).sort(function(a, b) {
            if (a.label === b.label) {
                return 0;
            } else if (a.label > b.label) {
                return 1;
            } else {
                return -1;
            }
        });
        
        let result = await vscode.window.showQuickPick(choices, {matchOnDetail: true});

        if (!result) {
            return;
        }

        var mod = false;
        var statement;
        var label = aliasLabel(result.label);
        let filePath = result.detail;
        if (!result.description) {
            label = label[0].toUpperCase() + label.slice(1);
            let moduleName = `${label}`;
            if (filePath.endsWith('.js')) {
                filePath = filePath.slice(0, -3);
            }
            statement = reg.fileStatement(moduleName, filePath);
        } else {
            // is a module, don't use appRequire
            if (!result.label.startsWith('react')) {
                statement = reg.moduleStatement(label, result.label);
                mod = true;
            } else {
                label = label[0].toUpperCase() + label.slice(1);
                statement = reg.moduleStatement(label, result.label);
            }
        }

        var pos = 0;
        var doc = vscode.window.activeTextEditor.document;
        var foundOthers : boolean = false;

        for (var i=0;i<doc.lineCount;i++) {
            let line = doc.lineAt(i);

            if (line.text === `'use strict';`) {
                pos = i + 1;
            }

            if (line.text.match(/^\/\* eslint-disable.*\*\/$/)) {
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
                        if (m[2] === result.label) {
                            //Already added
                            return;
                        }
                        if (m[1] > result.label) {
                            pos = i;
                            break;
                        } else {
                            pos = i+1;
                        }
                    } else if (foundOthers) {
                        break;
                    }
                } else {
                    var m = line.text.match(reg.file);

                    if (m) {
                        foundOthers = true;
                        if (m[2] === filePath || m[2] === result.detail) {
                            //Already added
                            return;
                        }
                        if (m[1].toLowerCase() > label.toLowerCase()) {
                            pos=i;
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

        const nextLine = pos < doc.lineCount ? doc.lineAt(pos).text.trim() : 'EOF';

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
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(coprightHeader);
}

// this method is called when your extension is deactivated
export function deactivate() {
}