/**
* Copyright 2017-present Mori, Inc.
*
*/

import * as vscode from 'vscode';

let gSelections = {};

const reqRegex = /(?:var|const|let)\W+([A-Za-z]\w*)\W+=\W+(?:app)?[rR]equire\('([\w./\\]+)'\).*/;
const impRegex = /import\s+(?:\*\s+as\s+(\w+))?(?:{\s*[^}]+})?\s+from\s+'([^']+)';/

export function HeaderFlip() {
  const doc = vscode.window.activeTextEditor.document;
  let headerStart = -1;
  let headerEnd = -1;

  let lastSelections = gSelections[doc.fileName];

  function isImport(text:string) {
    if (text.match(reqRegex) || text.match(impRegex)) {
      return true;
    }
    return false;
  }

  for (let i=0;i<doc.lineCount;i++) {
    const text = doc.lineAt(i).text;

    if (!text.trim()) {
      continue;
    }
    if (isImport(text)) {
      if (headerStart === -1) {
        headerStart = i;
      }
    } else {
      if (headerStart !== -1) {
        headerEnd = i-1;
        break;
      }
    }
  }

  if (headerStart === -1) {
    vscode.window.showWarningMessage('Unable to find an import or require block');
    return;
  }
  const headerRange = new vscode.Range(headerStart,0,headerEnd+1,0);

  if (headerRange.contains(vscode.window.activeTextEditor.selections[0])) {
    if (lastSelections) {
      vscode.window.activeTextEditor.selections = lastSelections;
    }
  } else {
    gSelections[doc.fileName] = vscode.window.activeTextEditor.selections;
    vscode.window.activeTextEditor.selections = [
      new vscode.Selection(headerStart, 0, headerStart, 0)
    ];
  }

  vscode.window.activeTextEditor.revealRange(vscode.window.activeTextEditor.selections[0], vscode.TextEditorRevealType.InCenter);
}