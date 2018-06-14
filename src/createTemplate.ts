/**
* Copyright 2018-present Ampersand Technologies, Inc.
*/

/**
* Copyright 2018-present Ampersand Technologies, Inc.
*/


import { InsertImportLine } from './importModule';

import * as path from 'path';
import * as vscode from 'vscode';

const templateBoilerPlate = `
interface BoilerContext {
}

export class Boiler extends DataWatcher<{}, {}> {
  static contextSchema: StashOf<Types.Schema> = {
  };

  render() {
    const context: BoilerContext = {
    };

    return <FixedTemplate template='Boiler' context={context} />;
  }
}

registerContextSchema(module, 'Boiler', Boiler.contextSchema);

`;

const templateBoilerPlateImports = [
    `import { FixedTemplate, registerContextSchema } from 'clientjs/components/FixedTemplate.tsx';`,
    `import { DataWatcher } from 'overlib/client/components/DataWatcher.tsx';`,
    `import * as Types from 'overlib/shared/types';`,
    `import * as React from 'react';`,
];

async function insertFixedTemplateIfUnique(newTemplateName: string): Promise<(string | null)> {
    const fixedTemplatesPath = path.join(vscode.workspace.rootPath, 'clientjs/shared/fixedTemplates.ts');

    let fixedTemplates: vscode.TextDocument;
    try {
        fixedTemplates = await vscode.workspace.openTextDocument(vscode.Uri.file(fixedTemplatesPath));
    } catch (e) {
        return 'Got error opening fixed templates:' + e;
    }

    const ftLines = fixedTemplates.getText().split('\n');
    let start = null;
    let end;
    // Find template line range and gather the template lines
    for (let lineNum = 0; lineNum < ftLines.length; ++lineNum) {
        const line = ftLines[lineNum];
        if (start === null) {
            if (line.startsWith('export type FixedTemplateName')) {
                start = lineNum + 1;
            }
        } else {
            if (line.indexOf(';') >= 0) {
                end = lineNum;
                break;
            }
        }
    }
    const templatesRange = new vscode.Range(new vscode.Position(start, 0), new vscode.Position(end, 0));

    const templateLines = ftLines.slice(start, end);
    console.log(templateLines);

    const templates = {};
    for (const templateLine of templateLines) {
        // Extract template names
        const match = templateLine.match(/'(.*)'/);
        if (!match) {
            continue; // drop it
        }
        const templateName = match[1];
        templates[templateName] = 1;
    }

    if (templates[newTemplateName]) {
        return `${newTemplateName} is already a fixed template name. Aborting...`;
    }
    templates[newTemplateName] = 1;

    const allTemplates = Object.keys(templates);
    allTemplates.sort();
    let output = '';
    for (let i = 0; i < allTemplates.length; ++i) {
        output += `  '${allTemplates[i]}'`;
        if (i !== (allTemplates.length -1)) {
            // if not last one
            output += ' |';
        }
        output += '\n';
    }


    const curDoc = vscode.window.activeTextEditor.document;
    await vscode.window.showTextDocument(fixedTemplates);
    await vscode.window.activeTextEditor.edit(function (edit) {
        edit.replace(templatesRange, output);
    }, {
        undoStopBefore: true,
        undoStopAfter: false,
    });

    // Show the fixed doc changes but switch back
    await vscode.window.showTextDocument(curDoc);

    return null;
}

// this is copy-pasta of the above function, but there are enough subtle differences to not make it worth generalizing
async function insertTemplateImportList(newTemplatePath: string): Promise<(string | null)> {
    const templateImportsPath = path.join(vscode.workspace.rootPath, 'clientjs/components/TemplateImportList.ts');

    let templateImportList: vscode.TextDocument;
    try {
        templateImportList = await vscode.workspace.openTextDocument(vscode.Uri.file(templateImportsPath));
    } catch (e) {
        return 'Got error opening Template Import List:' + e;
    }

    const tilLines = templateImportList.getText().split('\n');
    let start = null;
    let end;
    // Find template line range and gather the template lines
    for (let lineNum = 0; lineNum < tilLines.length; ++lineNum) {
        const line = tilLines[lineNum];
        if (start === null) {
            if (line.startsWith('// Templates:')) {
                start = lineNum + 1;
            }
        } else {
            if (!line.startsWith('import')) {
                end = lineNum;
                break;
            }
        }
    }
    const importsRange = new vscode.Range(new vscode.Position(start, 0), new vscode.Position(end, 0));

    const importLines = tilLines.slice(start, end);

    const imports = {};
    for (const importLine of importLines) {
        imports[importLine] = 1;
    }

    const newImportLine = `import '${newTemplatePath}';`;
    imports[newImportLine] = 1;

    const allImports = Object.keys(imports);
    allImports.sort();
    allImports.push(''); // extra carriage return line

    const curDoc = vscode.window.activeTextEditor.document;
    await vscode.window.showTextDocument(templateImportList);
    await vscode.window.activeTextEditor.edit(function (edit) {
        edit.replace(importsRange, allImports.join('\n'));
    }, {
        undoStopBefore: true,
        undoStopAfter: false,
    });

    // Show the fixed doc changes but switch back
    await vscode.window.showTextDocument(curDoc);

    return null;
}


export async function CreateTemplate() {
    if (!vscode.window.activeTextEditor) {
        vscode.window.showErrorMessage('Must open a document where you want template created.');
        return;
    }


    // First, get the name of the template
    let templateName = await vscode.window.showInputBox({
        prompt: 'What should the name of your template be?',
        placeHolder: 'MyCoolTemplate',
        validateInput: (value: string): string => {
            if (value.indexOf(' ') >= 0) {
                return 'NoSpacesPlease';
            }
            return '';
        },
    });
    if (!templateName) {
        // cancellation
        return;
    }

    const position = vscode.window.activeTextEditor.selection.active;
    const filePath = vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.fileName);

    // Look up the fixed templates and make sure the name is unique, and insert it into the list
    let errMsg = await insertFixedTemplateIfUnique(templateName);
    if (errMsg) {
        await vscode.window.showErrorMessage(errMsg);
        return;
    }

    // Insert the boiler plate
    await vscode.window.activeTextEditor.edit(function (edit) {
        edit.replace(position, templateBoilerPlate.replace(/Boiler/g, templateName));
    }, {
        undoStopBefore: false,
        undoStopAfter: false,
    });

    // Import everything we need to
    for (let i = 0; i < templateBoilerPlateImports.length; ++i) {
        await InsertImportLine(templateBoilerPlateImports[i], {
            undoStopAfter: false,
            undoStopBefore: false,
        });
    }

    errMsg = await insertTemplateImportList(filePath);
    if (errMsg) {
        await vscode.window.showErrorMessage(errMsg);
        return;
    }
    vscode.window.showInformationMessage(`${templateName} created successfully!`);
}