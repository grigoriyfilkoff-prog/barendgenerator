import { Sketcher, getOC, cast } from './vendor/replicad.js';
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

function boolean(shape, tool) {
  const oc = getOC(), progress = new oc.Message_ProgressRange_1();
  const op = new oc.BRepAlgoAPI_Cut_3(shape.wrapped, tool.wrapped, progress);
  try {
    op.SetFuzzyValue(1e-7);
    op.Build(progress);
    op.SimplifyResult(true, true, 1e-3);
    return cast(op.Shape());
  } finally { op.delete(); progress.delete(); }
}

export function buildBody(input, onProgress = () => {}) {
  const p = parameters(input);
  let body = sketch(axialProfile(p)).revolve([0, 0, 1]);
  // The groove minimum and the nominal slot root share the same axial plane.
  // A tiny cutter-only overlap prevents a zero-area tangency in OpenCascade;
  // it is below the STL tessellation tolerance and leaves all public nominal
  // dimensions (groove centre, slot start and thread centre) unchanged.
  const booleanOverlap = .005;
  const slotTool = sketch(rootProfile({ ...p, slotStart: p.slotStart - booleanOverlap }), [0, p.ro + 2, 0]).extrude(2 * (p.ro + 2));
  let stage = 'body profile';
  try {
    onProgress('Построение корпуса с фиксированным участком M8…');
    for (const angle of [0, 90]) {
      stage = `slot subtraction ${angle}`;
      const cutter = slotTool.clone().rotate(angle, [0, 0, 0], [0, 0, 1]);
      try {
        const next = boolean(body, cutter);
        body.delete();
        body = next;
      } finally { cutter.delete(); }
    }
    stage = 'shape simplification';
    const simplified = body.simplify();
    body.delete();
    body = simplified;
    return { body, p };
  } catch (error) {
    body.delete();
    throw new Error(`${stage}: ${error.message || error}`);
  } finally { slotTool.delete(); }
}
