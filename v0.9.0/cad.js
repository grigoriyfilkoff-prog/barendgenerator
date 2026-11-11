import { Sketcher, makeHelix, genericSweep, makeBox, getOC, cast } from './vendor/replicad.js';
import { parameters, axialProfile, rootProfile } from './parameters.js';

function sketch(segments, origin = 0) {
  const s = new Sketcher('XZ', origin).movePointerTo(segments[0].end);
  for (const seg of segments.slice(1)) {
    if (seg.kind === 'arc') s.threePointsArcTo(seg.end, seg.mid);
    else s.lineTo(seg.end);
  }
  const last = segments.at(-1).end, first = segments[0].end;
  return last[0] === first[0] && last[1] === first[1] ? s.done() : s.close();
}

function boolean(shape, tool, kind='Cut') {
  const oc = getOC(), progress = new oc.Message_ProgressRange_1();
  const op = new oc[`BRepAlgoAPI_${kind}_3`](shape.wrapped, tool.wrapped, progress);
  try {
    op.SetFuzzyValue(1e-5);
    op.Build(progress);
    if(!op.IsDone()||op.HasErrors())throw new Error(`CAD ${kind} operation failed`);
    return cast(op.Shape());
  } finally { op.delete(); progress.delete(); }
}

export function buildBody(input, onProgress = () => {}, {verify=false}={}) {
  const p = parameters(input);
  function check(shape,label){
    if(!verify)return;
    const analyzer=new (getOC().BRepCheck_Analyzer)(shape.wrapped,true,false);
    try {if(!analyzer.IsValid_2())throw new Error(`Invalid CAD: ${label}`);}
    finally {analyzer.delete();}
  }
  let body = sketch(axialProfile(p)).revolve([0, 0, 1]);
  check(body,'axial profile');
  // The groove minimum and the nominal slot root share the same axial plane.
  // A tiny cutter-only overlap prevents a zero-area tangency in OpenCascade;
  // it is below the STL tessellation tolerance and leaves all public nominal
  // dimensions (groove centre, slot start and thread centre) unchanged.
  const booleanOverlap = .005;
  const slotTool = sketch(rootProfile({ ...p, slotStart: p.slotStart - booleanOverlap }), [0, p.ro + 2, 0]).extrude(2 * (p.ro + 2));
  let stage = 'body profile';
  try {
    // Clip to the exact 8 mm span. Meshing conforms the known circular seams
    // where the thread root meets the inlet and the downstream cone.
    const limit = sketch([
      {kind:'move',end:[0,p.threadStart]},
      {kind:'line',end:[p.threadD/2+1,p.threadStart]},
      {kind:'line',end:[p.threadD/2+1,p.threadEnd]},
      {kind:'line',end:[0,p.threadEnd]},
    ]).revolve([0,0,1]);
    try {
      const halves=[];
      try {
        // Full periodic cylinders can retain an untrimmed bore after a helical
        // cut. Cut two nonperiodic halves, then reunite them into one solid.
        for(const side of [-1,1]){
          const box=makeBox([-p.rh-1,side<0?-p.rh-1:0,-1],[p.rh+1,side<0?0:p.rh+1,p.total+1]);
          try {halves.push(body.intersect(box));}finally{box.delete();}
        }
        const pitch=p.threadPitch, overlap=.05, inner=p.threadMinorR-overlap;
        const halfWidth=3*pitch/8+overlap/Math.sqrt(3);
        // Short overlapping sweeps avoid lost turns when trimming a long
        // multi-turn spline against the cylindrical bore.
        for(let turn=-1;turn<Math.ceil(p.threadLength/pitch);turn++){
          stage=`M8 thread turn ${turn+2}`;
          onProgress(`Резьба M8×1,25: ${Math.round(100*(turn+2)/(Math.ceil(p.threadLength/pitch)+1))}%…`);
          const z=p.threadStart+turn*pitch, height=pitch*1.05;
          const profile=sketch([
            {kind:'move',end:[inner,z-halfWidth]},
            {kind:'line',end:[p.threadD/2,z-pitch/16]},
            {kind:'line',end:[p.threadD/2,z+pitch/16]},
            {kind:'line',end:[inner,z+halfWidth]},
          ]);
          const helix=makeHelix(pitch,height,inner,[0,0,z]);
          const auxiliary=makeHelix(pitch,height,inner+1,[0,0,z]);
          let swept,cutter;
          try {
            swept=genericSweep(profile.wire,helix,{auxiliarySpine:auxiliary});
            check(swept,`${stage} sweep`);
            cutter=swept.intersect(limit);
            check(cutter,`${stage} clipped cutter`);
            for(let i=0;i<halves.length;i++){
              const next=boolean(halves[i],cutter);
              halves[i].delete();halves[i]=next;
              check(next,`${stage} half ${i+1}`);
            }
          } finally {cutter?.delete();swept?.delete();auxiliary.delete();helix.delete();profile.delete();}
        }
        const joined=boolean(halves[0],halves[1],'Fuse');
        body.delete();body=joined;
        check(body,'threaded body');
      } finally {halves.forEach(half=>half.delete());}
    } finally {limit.delete();}
    for (const angle of [0, 90]) {
      stage = `slot subtraction ${angle}`;
      onProgress(`Построение прорезей ${angle===0?1:2} из 2…`);
      const cutter = slotTool.clone().rotate(angle, [0, 0, 0], [0, 0, 1]);
      try {
        const next = boolean(body, cutter);
        body.delete();
        body = next;
        check(body,stage);
      } finally { cutter.delete(); }
    }
    return { body, p };
  } catch (error) {
    body.delete();
    throw new Error(`${stage}: ${error.message || error}`);
  } finally { slotTool.delete(); }
}
