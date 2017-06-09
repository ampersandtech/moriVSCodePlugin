/**
* Copyright 2017-present Mori, Inc.
*
*/

import * as vscode from 'vscode';
import * as path from 'path';

import { GetImportLines, SortImports, AliasLabel, GetFileCache } from './helpers';

let gAlias = {
    DB: {reg: /.*([Dd][Bb])(?:[A-Z]|$)+.*/, replace: ["DB"]},
    Util: {reg: /^((?:[Cc]lient)?(?:[Ss]erver)?)Util$/, replace: [""]},
    Log: {reg: /^[Ll]og(Common)$/, replace:[""]},
    React: {reg: /^react(Dom)$/, replace:["DOM"]},
    CS: {reg: /^([Cc]s)[A-Z].*/, replace:["CS"]},
};

export async function SortImportsCommand() {
  const curText = vscode.window.activeTextEditor.document.getText().split('\n');
  const importBlock = GetImportLines(curText);

  SortImports(importBlock.imports);

  vscode.window.activeTextEditor.edit(function(edit) {
    edit.replace(importBlock.range, importBlock.imports.join('\n') + '\n');
  });
}

export async function InsertImportLine(importLine) {
  const curText = vscode.window.activeTextEditor.document.getText().split('\n');
  const importBlock = GetImportLines(curText);

  importBlock.imports.push(importLine);

  SortImports(importBlock.imports);

  vscode.window.activeTextEditor.edit(function(edit) {
      edit.replace(importBlock.range, importBlock.imports.join('\n') + '\n');
  });
}

export async function ImportModule() {
  var fileName = vscode.window.activeTextEditor.document.fileName;
  if (fileName.lastIndexOf('.') === -1) {
      vscode.window.showErrorMessage('Unable to use import until an extension is specified');
      return;
  }

  const ext = fileName.slice(fileName.lastIndexOf('.')+1);

  let isTS = false;
  if (ext.match(/jsx?/)) {

  } else if (ext.match(/tsx?/)) {
      isTS = true;
  } else {
      vscode.window.showErrorMessage('Unable to use import on files with extension of ' + ext);
      return;
  }

  const files = GetFileCache();

  let result = await vscode.window.showQuickPick(files, {matchOnDetail: true});

  if (!result) {
    return;
  }

  if (!result.detail || result.detail === 'dependency') {
    let label = AliasLabel(result.label);
    if (label === 'react') {
      label = 'React';
    }
    if (label === 'reactDom') {
      label = 'ReactDOM';
    }
    let importLine;

    if (ext.match(/tsx?/)) {
      importLine = `import * as ${label} from '${result.label}';`;
    } else {
      importLine = `var ${label} = require('${result.label}');`;
    }
    InsertImportLine(importLine);
    return;
  }

  const fileExports = [];

  fileExports.push({
    label: '*',
    description: 'import all',
    detail: '',
  });

  const importExt = result.label.slice(result.label.lastIndexOf('.'));
  const fullFileName = path.join(vscode.workspace.rootPath, result.detail);
  let importFileName = result.detail;

  if (importFileName.match('\.[jt]s$')) {
    importFileName = importFileName.slice(0, importFileName.lastIndexOf('.'));
  }

  if (importExt.match(/\.tsx?/)) {
    const doc = await vscode.workspace.openTextDocument(fullFileName);
    const text = doc ? doc.getText().split('\n') : [];

    for (let i=0;i<text.length;i++) {
      const line = text[i];
      const match = line.match(/^\s*export(?: default)?\W+([^\W]*)\W+([\w]*)(.*)/);
      if (match) {
        fileExports.push({
          label: match[2],
          description: `line ${i+1} of ${result.label}`,
          detail: match[0],
        });
      }
    }
  } else if (importExt.match(/\.jsx?/)) {
    const doc = await vscode.workspace.openTextDocument(fullFileName);
    const text = doc ? doc.getText().split('\n') : [];

    for (let i=0;i<text.length;i++) {
      const line = text[i];
      const match = line.match(/^\s*(?:module\.)?exports\.?(\w+)\s+=\s+.*/);
      if (match) {
        fileExports.push({
          label: match[1],
          description: `line ${i+1} of ${result.label}`,
          detail: match[0],
        });
      }
    }
  } else {
    let label = AliasLabel(importFileName);
    if (ext.match(/tsx?/)) {
      InsertImportLine(`const ${label} = appRequire('${importFileName}');`);
    } else {
      InsertImportLine(`var ${label} = appRequire('${importFileName}');`);
    }
    return;
  }

  const exportResult = await vscode.window.showQuickPick(fileExports, {matchOnDescription: true, matchOnDetail: true});

  if (!exportResult) {
    return;
  }

  let importLine;


  if (exportResult.label === '*') {
    let label = result.label.slice(0, result.label.indexOf('.'));

    for (var id in gAlias) {
      var m = gAlias[id].reg.exec(label);
      if (m) {
        for (var i=0;i<gAlias[id].replace.length;i++) {
          var index = label.indexOf(m[i+1]);
          if (index > -1) {
            label = `${label.slice(0, index)}${gAlias[id].replace[i]}${label.slice(index+m[i+1].length)}`;
          }
        }
        break;
      }
    }

    if (ext.match(/tsx?/)) {
      importLine = `import * as ${label[0].toUpperCase() + label.slice(1)} from '${importFileName}';`;
    } else {
      importLine = `var ${label[0].toUpperCase() + label.slice(1)} = appRequire('${importFileName}');`;
    }

  } else {
    if (ext.match(/tsx?/)) {
      importLine = `import { ${exportResult.label} } from '${importFileName}';`
    } else {
      importLine = `var ${exportResult.label[0].toUpperCase() + exportResult.label.slice(1)} = appRequire('${importFileName}').${exportResult.label};`;
    }
  }

  InsertImportLine(importLine);
}