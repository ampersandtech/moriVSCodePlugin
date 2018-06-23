import { InsertImportLine } from './importModule';

import * as fs from 'fs';
import * as path from 'path';
import { start } from 'repl';
import * as tslint from 'tslint';
import * as ts from 'typescript';
import * as vscode from 'vscode';

interface regMatch {
  match: RegExp;
  replace?: (match) => string | null | undefined;
  deleteLine?: boolean;
}

let importLines = [];

export async function makeEdits() {
  importLines = [];
  await vscode.window.activeTextEditor.edit(edit_stage1);
  await vscode.window.activeTextEditor.edit(edit_stage2);
  await vscode.window.activeTextEditor.edit(edit_stage3);

  for (let i = 0; i < importLines.length; i++) {
    await InsertImportLine(importLines[i]);
  }

}

async function edit_stage1(edit) {
    let regs: regMatch[] = [
        {match: /var\s+([^\s]*)\s+=\s+require\('([^']*)'\);/, replace: (match) => {return `import * as ${match[1]} from '${match[2]}';`}},
        {match: /var\s+([^\s]*)\s+=\s+appRequire\('([^']*.jsx)'\);/, replace: (match) => {return `const ${match[1]} = require('${match[2]}');`}},
        {match: /var\s+([^\s]*)\s+=\s+appRequire\('([^']*.svg)'\);/, replace: (match) => {return `const ${match[1]} = require('${match[2]}');`}},
        {match: /var\s+([^\s]*)\s+=\s+appRequire\('([^']*)'\);/, replace: (match) => {return `import * as ${match[1]} from '${match[2]}';`}},
        {match: /var\s+([^\s]*)\s+=\s+(?:app)?[rR]equire\('([^']*)'\)\.([^;]+);/, replace: (match) => {
          if (match[1] === match[3]) {
            return `import { ${match[1]} } from '${match[2]}';`
          }
          return `import { ${match[1]} as ${match[3]} } from '${match[2]}';`
        }},
        {match: /for \(var ([^\s]+[^;]+);([^;]+);([^)]+)\) {/, replace: (match) => {return `for (let ${match[1]}; ${match[2]}; ${match[3]}) {`}},
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

                    const newLine = reg.replace(match);

                    if (newLine === undefined) {
                        //Keep the line as is
                    } else if (newLine === null) {
                        edit.delete(range);
                    } else {
                        edit.replace(range, reg.replace(match));
                    }
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
}

async function edit_stage2(edit) {
  let doc = vscode.window.activeTextEditor.document;
  let match;

  let componentName: string;
  let tabVal: string;
  let lines: string[];
  let lineStart = 0;
  let closingTab: string;
  let hasProps = false;
  let inInterface = false;
  let interfaceLines = [];
  let extendsVal = 'React.Component';

  function buildLine0() {
    lines[0] = `${tabVal}class ${componentName} extends ${extendsVal}<${hasProps ? componentName + 'Props' : '{}'}, {}> {`;
  }

  for (let i=0;i<doc.lineCount;i++) {
      let line = doc.lineAt(i);

      match = line.text.match(/(\s*)const\s+(\w+)\s+=\s+(?:React.)?createClass\({/);
      if (match) {
          lineStart = i;
          componentName = match[2];
          tabVal = match[1];
          lines = [];
          interfaceLines = [];
          extendsVal = 'React.Component';
          hasProps = false;
          buildLine0();
          continue;
      }

      if (componentName) {
          match = line.text.match(/^(\s*)}\);/);
          if (match) {
              if (match[1] === tabVal) {
                  lines.push(`${tabVal}}`);
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

          match = line.text.match(/^(\s+)mixins:\s+\[(.*)\],/);
          if (match && match[1].length === tabVal.length + 2) {
            if (match[2].trim() === 'DataWatchMixin') {
              extendsVal = 'DataWatcher';
              const importLine = 'import { DataWatcher } from \'overlib/client/components/DataWatcher.tsx\';';
              if (importLines.indexOf(importLine) === -1) {
                importLines.push(importLine)
              }
              buildLine0();
            }
            continue;
          }

          match = line.text.match(/(\s*)propTypes:\s*{/);
          if (match && match[1].length === tabVal.length + 2) {
              hasProps = true;
              inInterface = true;
              interfaceLines.push(`${tabVal}interface ${componentName}Props {`);
              buildLine0();
              //Don't continue here, allow for the prop strucutre to remain
          }


          match = line.text.match(/(\s*)(\w+):\s+function(\([^)]*\))\s+{/);
          if (match && match[1].length === tabVal.length + 2) {
            switch (match[2]) {
              case 'getInitalState': {
                lines.push('//DONOTCHECKIN unable to figure out what to do with inital state, please make approproate updates');
                break;
              }
              case 'getDefaultProps': {
                lines.push('//DONOTCHECKIN unable to parse default props function, please make approproate changes')
                break;
              }
              case 'render':
              case 'getDerivedStateFromProps':
              case 'componentWillMount':
              case 'componentDidMount':
              case 'componentWillRecieveProps':
              case 'shouldComponentUpdate':
              case 'componentWillUpdate':
              case 'getSnapshotBeforeUpdate':
              case 'componentDidUpdate':
              case 'componentWillUnmount':
              case 'componentDidCatch':
                lines.push(`${match[1]}${match[2]}${match[3]} {`);
                continue;
              default:
                lines.push(`${match[1]}${match[2]} = ${match[3]} => {`)
                continue;
            }


          }

          match = line.text.match(/(\s*)},/);
          if (match && match[1].length === tabVal.length + 2) {
              lines.push(`${match[1]}}`);
              if (inInterface) {
                  interfaceLines.push('}');
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
}

function findConstCallForKey(source: ts.Node, key: string, start: number): ts.Node | null {
  switch(source.kind) {
    case ts.SyntaxKind.VariableDeclarationList:
      const list: ts.VariableDeclarationList = <ts.VariableDeclarationList>source;
      for (let i = 0; i < list.declarations.length; i++) {
        if (list.declarations[i].name.getText() === key) {
          return list;
        }
      }
    case ts.SyntaxKind.Block:
    case ts.SyntaxKind.FunctionDeclaration:
      if (source.getStart() > start || source.getEnd() < start) {
        return null;
      }
    default:
      const children = source.getChildren();

      for (let i = 0; i < children.length; i++) {
        const found = findConstCallForKey(children[i], key, start);

        if (found) {
          return found;
        }
      }
  }
}

async function edit_stage3(edit: vscode.TextEditorEdit) {
  const host = ts.createCompilerHost({}, true);
  const source = vscode.window.activeTextEditor.document.getText();
  let sourceNode: ts.SourceFile;
  host.getSourceFile = (fileName, target) => {
    if (fileName === vscode.window.activeTextEditor.document.fileName) {
      sourceNode = ts.createSourceFile(fileName, source, target, true);
      return sourceNode;
    }
    const contents = fs.readFileSync(fileName).toString();
    return ts.createSourceFile(fileName, contents, target, true);
  }
  const compilerOptions = {
    noEmit: true,
  }
  const program = ts.createProgram([vscode.window.activeTextEditor.document.fileName], compilerOptions, host);
  let allDiagnostics = ts.getPreEmitDiagnostics(program).concat(program.emit().diagnostics);

  const foundConsts = {};

  for (let i = 0; i < allDiagnostics.length; i++) {
    if (allDiagnostics[i].code === 2540) {
      const match = (<string>allDiagnostics[i].messageText).match(/Cannot assign to '([^']+)' because it is a constant or a read-only property\./);

      if (match) {
        const keyNode = findConstCallForKey(allDiagnostics[i].file, match[1], allDiagnostics[i].start);

        if (keyNode) {
          const pos = sourceNode.getLineAndCharacterOfPosition(keyNode.getStart());
          foundConsts[`${pos.line}:${match[1]}`] = true;
        }
      }
    }
  }

  const lintOpts = {
      fix: false,
      formatter: "json",
      rulesDirectory: "customRules/",
      formattersDirectory: "customFormatters/"
  };
  const linter = new tslint.Linter(lintOpts);
  const rawConfig = {
    rules: {
      "whitespace": [
        true,
        "check-branch",
        "check-decl",
        "check-operator",
        "check-module",
        "check-separator",
        "check-type",
        "check-typecast"
      ],
    },
  };
  const configuration = tslint.Configuration.parseConfigFile(rawConfig);
  linter.lint(vscode.window.activeTextEditor.document.fileName, source, configuration);
  const result = linter.getResult()

  for (let error of result.failures) {
    if (error.getFailure() === 'missing whitespace') {
      const startPos = error.getStartPosition();
      const pos = vscode.window.activeTextEditor.document.positionAt(startPos.getPosition());

      edit.insert(pos, ' ');
    }
  }

  for (let key in foundConsts) {
    const vals = key.split(':');
    const line = vscode.window.activeTextEditor.document.lineAt(parseInt(vals[0]));
    const match = line.text.match(/const\s/);

    if (match) {
      const range = new vscode.Range(line.lineNumber, match.index, line.lineNumber, match.index + 5);
      edit.replace(range, `let`);
    }
  }

  console.log(foundConsts);
}