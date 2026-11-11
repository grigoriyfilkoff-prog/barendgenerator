import initOC from './vendor/replicad_with_exceptions.js';
import { setOC } from './vendor/replicad.js';
import { buildBody } from './cad.js';
import { threadSeams } from './parameters.js';
import { binarySTL, conformCADMesh, validateMesh, readSTL } from './mesh.js';

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

async function run({id,params,diagnostic=false,verify=false,debug=false}) {
  const oc=await initialize();
  if(diagnostic){self.postMessage({id,keys:Object.keys(oc).filter(k=>/BRepCheck|BRepAlgoAPI_Check|TopExp_Explorer/.test(k))});return;}
  const start=performance.now();
  const {body,p}=buildBody(params,stage=>self.postMessage({id,kind:'progress',stage}),{verify});
  try {
    self.postMessage({id,kind:'progress',stage:'Подготовка модели и STL…'});
    let rawMesh;
    oc.BRepTools.Clean(body.wrapped,true);
    try { rawMesh=body.mesh({tolerance:.01,angularTolerance:.15}); }
    catch(error) { throw new Error(`Триангуляция CAD для STL: ${error?.message||error}`); }
    const {mesh,repair}=conformCADMesh(rawMesh,.002,{circularSeams:threadSeams(p)});
    const stl=binarySTL(mesh);
    const report={triangles:mesh.triangles.length/3,vertices:mesh.vertices.length/3,repair,
      checksSkipped:true,stlGenerated:true,elapsedMs:Math.round(performance.now()-start)};
    // Expensive verification is opt-in for the regression suite only.
    if(verify){
      const analyzer=new oc.BRepCheck_Analyzer(body.wrapped,true,false);
      const solids=new oc.TopExp_Explorer_2(body.wrapped,oc.TopAbs_ShapeEnum.TopAbs_SOLID,oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      try {
        report.cadValid=analyzer.IsValid_2();report.solids=0;
        for(;solids.More();solids.Next())report.solids++;
      } finally {analyzer.delete();solids.delete();}
      Object.assign(report,validateMesh(mesh));
      report.stlValid=validateMesh(readSTL(stl)).ok;
      report.checksSkipped=false;
      report.ok=report.ok&&report.cadValid&&report.solids===1&&report.stlValid;
      report.elapsedMs=Math.round(performance.now()-start);
    }
    self.postMessage({id,params:p,mesh,report,stl,...(debug&&!report.ok?{debugMesh:rawMesh,debugBody:body.serialize()}:{})},[stl]);
  } finally {body.delete();}
}
