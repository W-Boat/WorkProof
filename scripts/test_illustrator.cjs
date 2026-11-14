// Production ExtendScript runs in an ES3-style mock host; real Illustrator remains separate.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('apps/illustrator/host.jsx','utf8').replace(/^#target illustrator\r?\n/,'');
function doc(items){return {fullName:{exists:true,fsName:'C:\\private\\art.ai'},saved:false,pageItems:items};}
function item(id,changes={}){return {uuid:id,typename:'PathItem',geometricBounds:[0,100,100,0],opacity:100,hidden:false,closed:false,pathPoints:[],parent:{typename:'Layer'},...changes};}
function run(document){return JSON.parse(vm.runInNewContext(code,{app:{documents:document?[document]:[],activeDocument:document}}, {timeout:1000}));}
assert.equal(run(null).error,'NO_ACTIVE_DOCUMENT');
let first=run(doc([item('12345678-1234')]));
assert.equal(first.format,'workproof-illustrator-snapshot/1');
assert.equal(first.metrics.objects,1);
assert.equal(first.metrics.unhidden_objects,1);
assert.deepEqual(first.objects[0][6],[0,100,100,0]);
assert.equal(first.objects[0][1],null);
assert.equal(run(doc([item('12345678-1234'),item('12345678-1234')])).error,'STABLE_OBJECT_ID_UNAVAILABLE');
assert.equal(run(doc([item('')])).error,'STABLE_OBJECT_ID_UNAVAILABLE');
assert.equal(run(doc([item('12345678-1234',{opacity:NaN})])).error,'INVALID_OPACITY');
assert.equal(run(doc([item('12345678-1234',{geometricBounds:[0,Infinity,1,1]})])).error,'INVALID_BOUNDS');
assert.equal(run(doc(Array(4097).fill(item('12345678-1234')))).error,'OBJECT_LIMIT');
let secret=item('12345678-1234');
Object.defineProperty(secret,'name',{get(){throw Error('DO NOT READ LAYER NAME');}});
Object.defineProperty(secret,'contents',{get(){throw Error('DO NOT READ TEXT');}});
assert.equal(run(doc([secret])).format,'workproof-illustrator-snapshot/1');
let changed=run(doc([item('12345678-1234',{geometricBounds:[1,101,101,1]})]));
assert.notDeepEqual(first.objects,changed.objects);
console.log('Illustrator read-only probe: bounds, stable IDs, privacy and unavailable state checks passed; host not exercised');

const point={anchor:[10,10],leftDirection:[8,10],rightDirection:[12,10]};
const initialCurve=run(doc([item('12345678-1234',{pathPoints:[point]})]));
const changedCurve=run(doc([item('12345678-1234',{pathPoints:[{...point,rightDirection:[14,10]}]})]));
assert.equal(initialCurve.metrics.path_points,1);
assert.deepEqual(initialCurve.objects[0][6],changedCurve.objects[0][6]);
assert.notDeepEqual(initialCurve.objects[0][7],changedCurve.objects[0][7]);
assert.equal(run(doc([item('12345678-1234',{pathPoints:Array(8193).fill(point)})])).error,'PATH_POINT_LIMIT');
assert.equal(run(doc([item('12345678-1234',{pathPoints:[{...point,anchor:[]}]})])).error,'PATH_POINT_UNAVAILABLE');
