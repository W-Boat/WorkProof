// Loaded only when a local document is opened. The library and connected-app
// records do not need the editor schema, syntax grammars or pagination engine.
export {Editor,generateHTML,getMarkRange} from '@tiptap/core';
export {editorExtensions} from './editor-extensions.js';
