export const VERSION = '0.9.0';
export const FIXED = Object.freeze({ holeD: 4, slotW: 2, rootR: 1, tipR: 2, rearHeadR: 1, slotOffset: 3,
  entryR: 4, preHoleD: 10, threadD: 8, threadPitch: 1.25, threadLength: 8, coneAngle: 90 });
export const DEFAULTS = Object.freeze({ headD: 30, headH: 8, bodyD: 18.4, bodyL: 19, headR: 2,
  grooveEnabled: true, grooveDepth: 2, grooveW: 2, grooveR: .5 });
export const CONTROLS = [
  ['headD', 'Диаметр головки', 24, 45, .5],
  ['headH', 'Толщина головки', 8, 20, .5],
  ['bodyD', 'Диаметр посадки', 17.5, 35, .1],
  ['bodyL', 'Длина посадки', 12, 27, .5],
  ['headR', 'Передний край головки R', 0, 15, .25],
  ['grooveDepth', 'Глубина выемки', .5, 4, .1],
  ['grooveW', 'Ширина выемки', .5, 6, .1],
  ['grooveR', 'Скругление выемки R', .1, 2, .1],
];

// Reject invalid API input; UI limits are not the geometric safety boundary.
export function parameters(input = DEFAULTS) {
  for (const [key, value] of Object.entries(FIXED)) {
    if (key in input && input[key] !== value) throw new Error(`${key}: фиксированное значение ${value}`);
  }
  const p = { ...DEFAULTS };
  for (const [key, , min, max] of CONTROLS) {
    if (key in input) p[key] = input[key];
    if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max) throw new Error(`${key}: недопустимый размер`);
  }
  if ('grooveEnabled' in input && typeof input.grooveEnabled !== 'boolean') throw new Error('grooveEnabled: недопустимое значение');
  p.grooveEnabled = 'grooveEnabled' in input ? input.grooveEnabled : DEFAULTS.grooveEnabled;
  Object.assign(p, FIXED);
  p.total = p.headH + p.bodyL;
  p.root = p.slotOffset;
  p.slotL = p.bodyL - p.slotOffset;
  p.slotStart = p.headH + p.slotOffset; // nearest point of the R1 arc
  p.grooveCenter = p.slotStart;
  p.grooveStart = p.grooveCenter - p.grooveW/2;
  p.grooveEnd = p.grooveCenter + p.grooveW/2;
  p.ro = p.bodyD / 2;
  p.ri = p.holeD / 2;
  p.rh = p.headD / 2;
  // The thread is centred on the nearest point of the slot root: four
  // millimetres towards the head and four towards the petals.
  p.threadCenter = p.slotStart;
  p.threadStart = p.threadCenter - p.threadLength/2;
  p.threadEnd = p.threadStart + p.threadLength;
  p.threadMinorR = p.threadD/2 - 5*Math.sqrt(3)/16*p.threadPitch;
  p.coneLength = (p.threadD-p.holeD)/2/Math.tan(p.coneAngle*Math.PI/360);
  p.coneEnd = p.threadEnd + p.coneLength;
  p.mouthR = p.preHoleD/2 + p.entryR;
  if (p.headR + p.rearHeadR > p.headH) throw new Error('Переднее и заднее скругления не помещаются по толщине головки');
  if (p.grooveEnabled && p.grooveR > Math.min(p.grooveDepth, p.grooveW)/2) throw new Error('R выемки превышает половину её глубины или ширины');
  if (p.grooveEnabled && p.ro-p.grooveDepth <= p.threadD/2) throw new Error('Выемка пересекает канал M8');
  if (p.mouthR >= p.rh-p.headR) throw new Error('Скругления входа и наружного края головки пересекаются');
  if (p.coneEnd >= p.total-p.tipR) throw new Error('Конус не помещается перед торцевым скруглением');
  return Object.freeze(p);
}

// One exact axial profile drives the CAD solid and its dimensioned section.
// Coordinates: [radius, z]; circular arcs carry their exact midpoint.
export function axialProfile(p) {
  const q = Math.SQRT1_2;
  const seg = [{ kind: 'move', end: [p.mouthR, 0] }, { kind: 'line', end: [p.rh - p.headR, 0] }];
  if (p.headR) seg.push({ kind: 'arc', end: [p.rh, p.headR], mid: [p.rh - p.headR + p.headR * q, p.headR * (1 - q)], radius: p.headR });
  seg.push({ kind: 'line', end: [p.rh, p.headH-p.rearHeadR] },
    { kind: 'arc', end: [p.rh-p.rearHeadR, p.headH], mid: [p.rh-p.rearHeadR+p.rearHeadR*q, p.headH-p.rearHeadR+p.rearHeadR*q], radius: p.rearHeadR },
    { kind: 'line', end: [p.ro, p.headH] },
    { kind: 'line', end: [p.ro, p.grooveStart] });
  if (p.grooveEnabled) seg.push(
    { kind: 'arc', end: [p.ro-p.grooveR, p.grooveStart+p.grooveR], mid: [p.ro-p.grooveR+p.grooveR*q, p.grooveStart+p.grooveR*q], radius: p.grooveR },
    { kind: 'line', end: [p.ro-p.grooveDepth+p.grooveR, p.grooveStart+p.grooveR] },
    { kind: 'arc', end: [p.ro-p.grooveDepth, p.grooveCenter], mid: [p.ro-p.grooveDepth+p.grooveR*(1-q), p.grooveCenter-p.grooveR*q], radius: p.grooveR },
    { kind: 'arc', end: [p.ro-p.grooveDepth+p.grooveR, p.grooveEnd-p.grooveR], mid: [p.ro-p.grooveDepth+p.grooveR*(1-q), p.grooveCenter+p.grooveR*q], radius: p.grooveR },
    { kind: 'line', end: [p.ro-p.grooveR, p.grooveEnd-p.grooveR] },
    { kind: 'arc', end: [p.ro, p.grooveEnd], mid: [p.ro-p.grooveR+p.grooveR*q, p.grooveEnd-p.grooveR*q], radius: p.grooveR });
  else seg.push({ kind: 'line', end: [p.ro, p.grooveEnd] });
  seg.push(
    { kind: 'line', end: [p.ro, p.total - p.tipR] },
    { kind: 'arc', end: [p.ro - p.tipR, p.total], mid: [p.ro - p.tipR + p.tipR * q, p.total - p.tipR + p.tipR * q], radius: p.tipR },
    { kind: 'line', end: [p.ri, p.total] },
    { kind: 'line', end: [p.ri, p.coneEnd] },
    { kind: 'line', end: [p.threadD/2, p.threadEnd] },
    { kind: 'line', end: [p.threadMinorR, p.threadEnd] },
    { kind: 'line', end: [p.threadMinorR, p.threadStart] },
    { kind: 'line', end: [p.threadD/2, p.threadStart] },
    { kind: 'line', end: [p.preHoleD/2, p.entryR] },
    { kind: 'arc', end: [p.mouthR, 0], mid: [p.mouthR-p.entryR*q,p.entryR*(1-q)], radius:p.entryR });
  return seg;
}

// Basic ISO 60-degree internal profile, right-handed, no print compensation.
export function boreRadius(p,z,angle=0) {
  if(z>p.coneEnd)return p.ri;
  if(z>=p.threadEnd)return p.threadD/2-(z-p.threadEnd)*Math.tan(p.coneAngle*Math.PI/360);
  if(z<p.threadStart){
    if(z<p.entryR)return p.mouthR-Math.sqrt(Math.max(0,p.entryR**2-(z-p.entryR)**2));
    const t=(z-p.entryR)/(p.threadStart-p.entryR);
    return p.preHoleD/2+t*(p.threadD-p.preHoleD)/2;
  }
  // A groove centre advances in +Z for increasing angle (right-hand helix).
  const phase=(z-p.threadStart)/p.threadPitch-angle/(2*Math.PI);
  const distance=Math.abs(phase-Math.round(phase))*p.threadPitch;
  return Math.max(p.threadMinorR,p.threadD/2-Math.max(0,distance-p.threadPitch/16)*Math.sqrt(3));
}

export function rootProfile(p) {
  const z = p.slotStart + p.rootR;
  return [
    { kind: 'move', end: [-p.slotW / 2, z] },
    { kind: 'arc', end: [p.slotW / 2, z], mid: [0, p.slotStart], radius: p.rootR },
    { kind: 'line', end: [p.slotW / 2, p.total + 3] },
    { kind: 'line', end: [-p.slotW / 2, p.total + 3] },
  ];
}

// Exact circles and root plateaus used to conform CAD tessellation seams.
export function threadSeams(p){
  return [
    {z:p.threadStart,radius:p.threadD/2,voidHalfAngle:Math.PI/8},
    {z:p.threadEnd,radius:p.threadD/2,voidHalfAngle:Math.PI/8,voidCenterAngle:2*Math.PI*p.threadLength/p.threadPitch},
  ];
}
