/**
* Copyright 2017-present Mori, Inc.
*
*/

import * as vscode from 'vscode';
import * as fs from 'fs';

let fileCache: Thenable<{ label: string, description: string, detail: string }[]> | { label: string, description: string, detail: string }[];

var gRecheckFiles: Boolean = false;
var gCheckingFiles: Boolean = false;

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

export function GetFileCache() {
    return fileCache;
}

export function FindAllFiles(rootPath, ignoreDirs) {
    if (gCheckingFiles) {
        gRecheckFiles = true;
        return;
    }
    gCheckingFiles = true;
    fileCache = new Promise((resolve, reject) => {
        var pack;

        try {
            pack = JSON.parse(fs.readFileSync(rootPath + '/package.json').toString());
        } catch (e) {
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

        var gIgnorePath = `{${ignoreDirs.join(',')}}/**`;
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
            FindAllFiles(rootPath, ignoreDirs);
            gRecheckFiles = false;
        }
    });
}

let gAlias = {
    DB: { reg: /.*([Dd][Bb])(?:[A-Z]|$)+.*/, replace: ["DB"] },
    Util: { reg: /^((?:[Cc]lient)?(?:[Ss]erver)?)Util$/, replace: [""] },
    Log: { reg: /^[Ll]og(Common)$/, replace: [""] },
    React: { reg: /^react(Dom)$/, replace: ["DOM"] },
    CS: { reg: /^([Cc]s)[A-Z].*/, replace: ["CS"] },
};

let gSpecialChar = /([^\W\d_]+)(\d*)([\W_]?)([\w]?)(.*)/; //hmmm... might need a better one... this one goes on forever!

const reqRegex = /(?:var|const|let)\W+([A-Za-z]\w*)\W+=\W+(?:app)?[rR]equire\('([^']+)'\).*/;
const impRegex = /import\s+(?:\*\s+as\s+([^\s]+)\s+)?(?:{[^}]+}\s+)?from\s+'([^']+)';/;

export function GetImportLines(curText) {
    const imports = [];
    let headerStart = -1;
    let headerEnd = -1;
    let blanks = 0;

    for (let i = 0; i < curText.length; i++) {
        const line = curText[i];

        if (line.trim() === '') {
            if (headerStart !== -1) {
                imports.push('');
                blanks++;
            }
            continue;
        }

        if (line.match(reqRegex) || line.match(impRegex)) {
            imports.push(line);
            if (headerStart === -1) {
                headerStart = i;
            }
        } else {
            if (headerStart !== -1) {
                headerEnd = i - blanks - 1;
                if (blanks) {
                    imports.splice(imports.length - blanks, 1);
                }
                break;
            }
        }

        blanks = 0;
    }

    return { imports: imports, range: new vscode.Range(headerStart, 0, headerEnd + 1, 0) };
}

export function SortImports(imports: string[]) {
    //add a bunch of blank lines to seperate blocks
    imports.push('1:<br>');
    imports.push('2:<br>');
    imports.push('3:<br>');
    imports.push('4:<br>');

    imports.sort(function(a, b) {
        function getValue(s): string {
            if (s.trim() === '') {
                return '0';
            }

            if (s.match(/^\d:<br>$/)) {
                return s;
            };

            const requireMatch = s.match(/^(?:var|let|const)\s+([^\W]*)/);
            if (requireMatch) {
                if (requireMatch[1].match(/^[A-Z]/)) {
                    return '3:' + requireMatch[1].toLowerCase();
                } else {
                    return '2:' + requireMatch[1].toLowerCase();
                }
            } else {
                const importMatch = s.match(/import\s+(?:\*\s+as\s+([^\s]+)\s+)?(?:{([^}]+)}\s+)?from\s+'([^']+)';.*$/);
                if (!importMatch[1] || !importMatch[2]) {
                    return '0:'; //DO NOT ADD STRING, this takes care of import from 'file', where order in the file matters.
                }
                if (!importMatch) {
                    return '0:' + s;
                }

                return '1:' + importMatch[3].toLowerCase();
            }
        }

        return getValue(a).localeCompare(getValue(b));
    });

    //convert those brs to spaces
    for (let i = 0; i < imports.length; i++) {
        if (imports[i].match(/^\d:<br>$/) || imports[i].trim() === '') {
            if (i === 0 || i === imports.length - 1) {
                imports.splice(i, 1);
                if (i === 0) {
                    i--;
                } else {
                    i = i - 2;
                    //recheck the last one to make sure it's also not blank
                }
                continue;
            }
            imports[i] = '';
        }
    }

    //Remove duplicates
    for (let i = 0; i < imports.length - 1; i++) {
        const nextLine = imports[i + 1];

        if (imports[i] === nextLine) {
            imports.splice(i, 1);
            i--;
            continue;
        }

        const reg = /import\s+{([^}]+)}\s+from\s+'([^']+)';(.*)$/;
        const match = imports[i].match(reg);
        const nextMatch = nextLine.match(reg);

        if (match && nextMatch && match[2] === nextMatch[2]) {
            let tags = match[1].split(',');
            tags = tags.concat(nextMatch[1].split(','));
            const tagobj = {};

            for (const tag of tags) {
                tagobj[tag.trim()] = 1;
            }

            const strTags = Object.keys(tagobj).sort().join(', ');
            imports.splice(i, 1);
            imports[i] = `import { ${strTags} } from '${match[2]}';${match[3]}`;
            i--;
        }
    }
}

export function AliasLabel(label: string) {
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
            for (var i = 0; i < gAlias[id].replace.length; i++) {
                var index = rtn.indexOf(m[i + 1]);
                if (index > -1) {
                    rtn = `${rtn.slice(0, index)}${gAlias[id].replace[i]}${rtn.slice(index + m[i + 1].length)}`;
                }
            }
            break;
        }
    }

    let s = gSpecialChar.exec(rtn);
    let c = 0;
    while (s && c < 100) {
        c++;
        rtn = s[1] + s[2] + s[4].toUpperCase() + s[5];
        s = gSpecialChar.exec(rtn);
    }

    return rtn;
}