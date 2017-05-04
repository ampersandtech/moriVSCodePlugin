'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as moment from 'moment';
import * as path from 'path';
import * as fs from 'fs';


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

let fileCache : Thenable<{label: string, description: string, detail: string}[]> | {label: string, description: string, detail: string}[];

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

const gIgnoreDirs = ['node_modules', 'backups', 'builds', 'branding', 'tmp', 'cache', 'clientcache', 'ios', 's3mirror', 'dist', 'testdist'];
var gRecheckFiles : Boolean = false;
var gCheckingFiles : Boolean = false;

function findAllFiles(rootPath) {
    if (gCheckingFiles) {
        gRecheckFiles = true;
        return;
    }
    gCheckingFiles = true;
    fileCache = new Promise((resolve, reject) => {
        var pack;

        try {
            pack = JSON.parse(fs.readFileSync(rootPath + '/package.json').toString());
        } catch(e) {
            vscode.window.showWarningMessage(`Unable to load ${rootPath}/package.json!`, e);
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

        var gIgnorePath = `{${gIgnoreDirs.join(',')},.*}/**`;
        var filePromise = vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,svg}', gIgnorePath);

        filePromise.then(files => {
            resolve(files.map(file => {
                const lastSlash = file.path.lastIndexOf('/');
                return {
                    label: file.path.substr(lastSlash + 1),
                    description: '',
                    detail: file.path.slice(rootPath.length + 1),
                };
            }).concat(gNodeMods).concat(projectMods).sort(function(a, b) {
                if (a.label === b.label) {
                    return 0;
                } else if (a.label > b.label) {
                    return 1;
                } else {
                    return -1;
                }
            }));
        });
    });

    fileCache.then(() => {
        gCheckingFiles = false;

        if (gRecheckFiles) {
            findAllFiles(rootPath);
            gRecheckFiles = false;
        }
    });
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    findAllFiles(vscode.workspace.rootPath);

    fs.watch(vscode.workspace.rootPath, {recursive: true}, (e, filename) => {
        if (filename[0] === '.') {
            return;
        }

        var file = filename.toString();

        if (gIgnoreDirs.indexOf(file.slice(0, file.indexOf('/')-1)) !== -1) {
            return;
        }

        if (e === 'rename') {
            findAllFiles(vscode.workspace.rootPath);
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

    let coprightHeader = vscode.commands.registerCommand('mori.copyrightHeader', async () => {
        var year = moment(Date.now()).year();
        var copy = `/**\n* Copyright ${year}-present Mori, Inc.\n*\n*/\n`
        var ext = getCurrentExt();
        if (ext === 'js' || ext ==='jsx') {
            copy += `use strict';\n\n`;
        } else {
            copy += `\n`;
        }
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
    let importAndRequire = vscode.commands.registerCommand('mori.importAndRequire', async () => {
        var time = Date.now();
        // The code you place here will be executed every time your command is executed
        var fileName = vscode.window.activeTextEditor.document.fileName;
        if (fileName.lastIndexOf('.') === -1) {
            vscode.window.showErrorMessage('Unable to use import until an extension is specified');
            return;
        }

        var ext = fileName.slice(fileName.lastIndexOf('.')+1);
        var reg;
        var isTS = false;
        if (ext === 'js' || ext === 'jsx') {
            reg = gRegs.js;
        } else if (ext === 'ts' || ext === 'tsx') {
            reg = gRegs.ts;
            isTS = true;
        } else {
            vscode.window.showErrorMessage('Unable to use import on files with extension of ' + ext);
            return;
        }

        const files = fileCache;
        
        let result = await vscode.window.showQuickPick(fileCache, {matchOnDetail: true});

        if (!result) {
            return;
        }

        var mod = false;
        var statement;
        var label = aliasLabel(result.label);
        var sortName;
        let filePath = result.detail;

        if (!result.description) {
            label = label[0].toUpperCase() + label.slice(1);
            let moduleName = `${label}`;
            if (filePath.endsWith('.js') || filePath.endsWith('.ts')) {
                filePath = filePath.slice(0, -3);
            }
            if (isTS) {
                sortName = filePath;
            } else {
                sortName = moduleName;
            }
            
            statement = reg.fileStatement(moduleName, filePath);
        } else {
            // is a module, don't use appRequire
            if (!result.label.startsWith('react')) {
                statement = reg.moduleStatement(label, result.label);
                sortName = result.label;
                mod = true;
            } else {
                label = label[0].toUpperCase() + label.slice(1);
                statement = reg.moduleStatement(label, result.label);
                sortName = result.label;
            }
        }

        var pos = 0;
        var inComment = false;
        var doc = vscode.window.activeTextEditor.document;
        var foundOthers : boolean = false;
        var foundCode : boolean = false;

        function checkSorted(a, b) {
            if (a.indexOf('.') === -1) {
                a += '.js';
            }
            if (b.indexOf('.') === -1) {
                b += '.js';
            }
            return a.slice(a.lastIndexOf('/')+1).toLowerCase() > b.slice(b.lastIndexOf('/')+1).toLowerCase();
        }

        for (var i=0;i<doc.lineCount;i++) {
            let line = doc.lineAt(i);

            if (line.text.trim() === '') {
                continue;
            }

            if (line.text === `'use strict';`) {
                pos = i + 1;
                continue;
            }

            if (!foundCode && line.text.match(/\s*\\\*/)) {
                inComment = true;
                continue;
            }

            if (inComment && line.text.match(/\*\//)) {
                inComment = false;
                pos = i + 1;
                continue;
            }

            if (!foundCode && line.text.match(/\s*\/\//)) {
                pos = i + 1;
                continue;
            }

            if (pos === 0 && line.text.trim() === '*/') {
                pos = i + 1;
                continue;
            }

            if (line.text.match(/^\/\* eslint-disable.*\*\/$/)) {
                pos = i + 1;
                continue;
            }

            foundCode = true;

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
                        var sortBy;

                        if (isTS) {
                            sortBy = m[2];
                        } else {
                            sortBy = m[1]
                        }
                        foundOthers = true;
                        if (m[2] === result.label) {
                            //Already added
                            return;
                        }
                        if (sortBy > sortName.label) {
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
                        var sortBy;

                        if (isTS) {
                            sortBy = m[2];
                        } else {
                            sortBy = m[1]
                        }
                        
                        foundOthers = true;
                        if (m[2] === filePath || m[2] === result.detail) {
                            //Already added
                            return;
                        }
                        if (checkSorted(sortBy,sortName)) {
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

    let convertToTS = vscode.commands.registerCommand('mori.convertToTS', async () => {
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

        await vscode.window.activeTextEditor.edit(function(edit) {
            let regs = [
                {match: /var\s+([^\s]*)\s+=\s+require\('([^']*)'\);/, replace: (match) => {return `import * as ${match[1]} from '${match[2]}';`}},
                {match: /var\s+([^\s]*)\s+=\s+appRequire\('([^']*.jsx)'\);/, replace: (match) => {return `const ${match[1]} = require('${match[2]}');`}},
                {match: /var\s+([^\s]*)\s+=\s+appRequire\('([^']*.svg)'\);/, replace: (match) => {return `const ${match[1]} = require('${match[2]}');`}},
                {match: /var\s+([^\s]*)\s+=\s+appRequire\('([^']*)'\);/, replace: (match) => {return `import * as ${match[1]} from '${match[2]}';`}},
                {match: /(^|\s*)var\s/, replace: (match) => {return `${match[1]}const `}},
                {match: /(^|\s*)if (\(.*\)) ([^{}]*);/, replace: (match) => {return `${match[1]}if ${match[2]} {${match[3]}};`}}
            ];

            let doc = vscode.window.activeTextEditor.document;
            let funcLines = {};

            for (var i=0;i<doc.lineCount;i++) {
                let line = doc.lineAt(i);
                let match;

                for (var r=0;r<regs.length;r++) {
                    match = line.text.match(regs[r].match);
                    if (match) {
                        
                        var range = new vscode.Range(
                            new vscode.Position(line.range.start.line, line.range.start.character + match.index),
                            new vscode.Position(line.range.start.line, line.range.start.character + match.index + match[0].length));

                        edit.replace(range, regs[r].replace(match));
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
}

// this method is called when your extension is deactivated
export function deactivate() {
}