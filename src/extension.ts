/**
* Copyright 2017-present Ampersand, Inc.
*
*/

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as ConvertToTS from './convertToTS';
import { CreateTemplate } from './createTemplate';
import { HeaderFlip } from './headerFlip';
import { FindAllFiles, GetImportLines, SortImports } from './helpers';
import { SortImportsCommand, ImportModule } from './importModule';

import * as fs from 'fs';
import * as moment from 'moment';
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

  vscode.workspace.onWillSaveTextDocument(async (e) => {
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

      await vscode.window.activeTextEditor.edit(function(edit) {
        edit.replace(importBlock.range, importBlock.imports.join('\n') + (addLine ? '\n' : ''));
      });

      const disp = vscode.window.setStatusBarMessage('ampersandVSCode: I sorted your imports for you. You\'re welcome!', 3000);
    }
  });

  async function modifyCurrentDocument(pos: vscode.Position | vscode.Range, content: string) {
    if (!vscode.window.activeTextEditor) {
      vscode.window.showErrorMessage('No current document');
      return;
    }

    await vscode.window.activeTextEditor.edit(function(edit) {
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

  const createTemplate = vscode.commands.registerCommand('ampersand.createTemplate', async () => {
    await CreateTemplate();
  });

  let coprightHeader = vscode.commands.registerCommand('ampersand.copyrightHeader', async () => {
    var year = moment(Date.now()).year();
    var copy = `/**\n* Copyright ${year}-present Ampersand Technologies, Inc.\n*/\n`

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
  // Now provide the implementation of the command with registerCommand
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
    await ConvertToTS.makeEdits();
  });

  context.subscriptions.push(convertToTS);
  context.subscriptions.push(importAndRequire);
  context.subscriptions.push(coprightHeader);
  context.subscriptions.push(headerFlip);
  context.subscriptions.push(createTemplate);

  const bracketPairs = {
    '{': '}',
    '[': ']',
    '(': ')',
  };

  let breakOnComma = vscode.commands.registerCommand('ampersand.breakOnComma', async () => {
    for (const selection of vscode.window.activeTextEditor.selections) {
      await vscode.window.activeTextEditor.edit((edit) => {
        const text = vscode.window.activeTextEditor.document.getText(selection);
        let newText = text.replace(/,/g, ',\n');

        const first = newText.charAt(0);
        let closeBracket = null;

        if (first in bracketPairs) {
          closeBracket = bracketPairs[first];
          newText = first + '\n' + newText.substr(1);

          if (newText.endsWith(closeBracket)) {
            newText = newText.substr(0, newText.length - 1) + ',\n' + closeBracket;
          }
        }

        edit.replace(selection, newText);
      });
    }
    await vscode.commands.executeCommand("editor.action.formatSelection");
  });
  context.subscriptions.push(breakOnComma);
}

// this method is called when your extension is deactivated
export function deactivate() {
}