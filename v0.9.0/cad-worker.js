import initOC from './vendor/replicad_with_exceptions.js';
import { setOC } from './vendor/replicad.js';
import { buildBody } from './cad.js';
import { binarySTL, conformCADMesh } from './mesh.js';

let ready;
function initialize(wasm){
  if(ready)return ready;
  const options=wasm
    ? {wasmBinary:new Uint8Array(wasm)}
    : {locateFile:()=>new URL('./vendor/replicad_with_exceptions.wasm',import.meta.url).href};
  ready=initOC(options).then(oc=>{setOC(oc);return oc;});
  return ready;
}
let queue=Promise.resolve();
self.onmessage=({data})=>{
  if(data.kind==='init-wasm'){initialize(data.wasm);return;}
  queue=queue.then(()=>run(data)).catch(error=>self.postMessage({id:data.id,error:String(error.stack||error)}));
};

async function run({id,params,diagnostic=false}) {
  const oc=await initialize();
  if(diagnostic){self.postMessage({id,keys:Object.keys(oc).filter(k=>/BRepCheck|BRepAlgoAPI_Check|TopExp_Explorer/.test(k))});return;}
  const start=performance.now();
  const {body,p}=buildBody(params,stage=>self.postMessage({id,kind:'progress',stage}));
  try {
    self.postMessage({id,kind:'progress',stage:'Подготовка модели и STL…'});
    let rawMesh;
    try { rawMesh=body.mesh({tolerance:.01,angularTolerance:.15}); }
    catch(error) { throw new Error(`Триангуляция CAD для STL: ${error?.message||error}`); }
    const {mesh,repair}=conformCADMesh(rawMesh);
    const stl=binarySTL(mesh);
    const report={triangles:mesh.triangles.length/3,vertices:mesh.vertices.length/3,repair,
      checksSkipped:true,stlGenerated:true,elapsedMs:Math.round(performance.now()-start)};
    self.postMessage({id,params:p,mesh,report,stl},[stl]);
  } finally {body.delete();}
}
