const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('apps/indesign/host.jsx', 'utf8').replace(/^#target indesign\r?\n/, '');
const document = {
  id: 8, saved: true, modified: true, fullName: {exists: true, fsName: '/private/book.indd'},
  pages: [{id: 1}], stories: [{id: 2, characters: {length: 5}, contents: 'draft'}],
  allPageItems: [{id: 3, parentPage: {id: 1}, geometricBounds: [0, 0, 100, 100], rotationAngle: 0}],
};
function observe(activeDocument) {
  const fixture = JSON.stringify(activeDocument);
  const app = 'const doc = ' + fixture + '; const app = {documents: doc ? [doc] : [], activeDocument: doc};';
  return JSON.parse(vm.runInNewContext(app + '\n' + script, {}, {timeout: 1000}));
}
const initial = observe(document);
assert.equal(initial.format, 'workproof-indesign-snapshot/1');
assert.equal(initial.saved, false);
assert.deepEqual(initial.metrics, {pages: 1, stories: 1, objects: 1, characters: 5});
assert.notDeepEqual(observe({...document, stories: [{...document.stories[0], contents: 'final'}]}).stories, initial.stories);
assert.notDeepEqual(observe({...document, allPageItems: [{...document.allPageItems[0], rotationAngle: 10}]}).layout, initial.layout);
assert.equal(observe({...document, modified: false}).saved, true);
assert.equal(observe({...document, isCloudDocument: true}).error, 'SAVE_LOCAL_DOCUMENT_FIRST');
assert.equal(observe(null).error, 'NO_ACTIVE_DOCUMENT');
