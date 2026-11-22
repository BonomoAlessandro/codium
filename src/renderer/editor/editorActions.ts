// Welche Aktion von Monaco ein Befehl der zentralen Tastenbelegung im Editor auslöst. Ohne Monaco, nur die Namen.

import type { EditorCommand } from '../keymap';

export const EDITOR_ACTIONS: Readonly<Record<EditorCommand, string>> = {
  'editor.find': 'actions.find',
  'editor.replace': 'editor.action.startFindReplaceAction',
  'editor.gotoLine': 'editor.action.gotoLine',
  'editor.duplicateLine': 'editor.action.copyLinesDownAction',
  'editor.deleteLine': 'editor.action.deleteLines',
  'editor.toggleComment': 'editor.action.commentLine',
  'editor.expandSelection': 'editor.action.smartSelect.expand',
  'editor.shrinkSelection': 'editor.action.smartSelect.shrink',
  'editor.moveLineUp': 'editor.action.moveLinesUpAction',
  'editor.moveLineDown': 'editor.action.moveLinesDownAction',
  'editor.undo': 'undo',
  'editor.redo': 'redo',
  // Ctrl + B: Definition; steht der Cursor auf der Deklaration, zeigt Monaco stattdessen die Verwendungen
  // (`gotoLocation.alternativeDefinitionCommand`).
  'editor.gotoDeclaration': 'editor.action.revealDefinition',
  'editor.gotoImplementation': 'editor.action.goToImplementation',
  'editor.quickDoc': 'editor.action.showHover',
};
