const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

// Conform tessellation seams of a *validated CAD body*, within a much smaller
// distance than the 0.01 mm meshing tolerance. Never fill a general mesh hole.
export function conformCADMesh(source,tolerance=.002,{circularSeams=[]}={}){
  const mesh={...source,vertices:[...source.vertices],normals:[...source.normals]}, ids=[],points=[],buckets=new Map();
  const weldTolerance=.0001;
  const repair={weldTolerance,tolerance,maxDeviation:0,collapsedTriangles:0,splitEdges:0,circularSplitEdges:0,maxCircularSagitta:0,removedThreadCapTriangles:0};
  const angleDelta=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
  const onCircle=(p,s)=>Math.abs(p[2]-s.z)<weldTolerance&&Math.abs(Math.hypot(p[0],p[1])-s.radius)<weldTolerance;
  for(let i=0;i<mesh.vertices.length;i+=3){
    const p=mesh.vertices.slice(i,i+3),cell=p.map(v=>Math.floor(v/weldTolerance));let id;
    search:for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const n of buckets.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`)||[]){
      if(Math.hypot(...sub(points[n],p))<=weldTolerance){id=n;break search;}
    }
    if(id===undefined){id=points.length;points.push(p);const k=cell.join(',');if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(id);}
    const q=points[id];repair.maxDeviation=Math.max(repair.maxDeviation,Math.hypot(...sub(p,q)));
    mesh.vertices.splice(i,3,...q);ids.push(id);
  }
  const faces=[];
  for(let i=0;i<source.triangles.length;i+=3){
    const face=source.triangles.slice(i,i+3);
    // A tangent thread cutter can leave a zero-area CAD cap on its major
    // circle. Triangulating that cap fills a circular segment inside the
    // known bore. Remove only caps entirely in the specified root plateau.
    const voidCap=circularSeams.some(s=>s.voidHalfAngle&&face.every(n=>{
      const p=points[ids[n]];
      return onCircle(p,s)&&Math.abs(angleDelta(s.voidCenterAngle||0,Math.atan2(p[1],p[0])))<=s.voidHalfAngle+weldTolerance;
    }));
    if(voidCap){repair.removedThreadCapTriangles++;continue;}
    if(new Set(face.map(n=>ids[n])).size<3)repair.collapsedTriangles++;else faces.push(face);
  }
  for(let pass=0;pass<256;pass++){
    const edges=new Map();
    faces.forEach((f,index)=>{for(let j=0;j<3;j++){
      const a=ids[f[j]],b=ids[f[(j+1)%3]],key=`${Math.min(a,b)},${Math.max(a,b)}`;
      if(!edges.has(key))edges.set(key,[]);edges.get(key).push({index,j,a,b});
    }});
    const boundary=[...edges.values()].filter(e=>e.length===1).map(e=>e[0]);
    const candidates=[...new Set(boundary.flatMap(e=>[e.a,e.b]))];let split=false;
    for(const edge of boundary){
      const face=faces[edge.index],a=points[edge.a],b=points[edge.b],ab=sub(b,a),length2=dot(ab,ab);
      const circle=circularSeams.find(s=>onCircle(a,s)&&onCircle(b,s));
      const startAngle=Math.atan2(a[1],a[0]),sweep=angleDelta(startAngle,Math.atan2(b[1],b[0]));
      const cuts=[];
      for(const id of candidates){
        if(face.some(n=>ids[n]===id))continue;
        const circular=circle&&Math.abs(sweep)<Math.PI/2&&onCircle(points[id],circle);
        const t=circular?angleDelta(startAngle,Math.atan2(points[id][1],points[id][0]))/sweep:dot(sub(points[id],a),ab)/length2;
        if(t<=1e-5||t>=1-1e-5)continue;
        const d=Math.hypot(...sub(points[id],a.map((v,k)=>v+t*ab[k])));
        if(circular||d<=tolerance)cuts.push({id,t,d,circular});
      }
      if(!cuts.length)continue;
      cuts.sort((a,b)=>a.t-b.t);
      const first=face[edge.j],last=face[(edge.j+1)%3],third=face[(edge.j+2)%3],chain=[first];
      for(const cut of cuts){
        const n=mesh.vertices.length/3;mesh.vertices.push(...points[cut.id]);ids.push(cut.id);
        const normal=[0,1,2].map(k=>mesh.normals[first*3+k]*(1-cut.t)+mesh.normals[last*3+k]*cut.t),len=Math.hypot(...normal);
        mesh.normals.push(...normal.map(v=>v/len));chain.push(n);
        if(cut.circular){repair.circularSplitEdges++;repair.maxCircularSagitta=Math.max(repair.maxCircularSagitta,cut.d);}
        else repair.maxDeviation=Math.max(repair.maxDeviation,cut.d);
      }
      chain.push(last);faces[edge.index]=[chain[0],chain[1],third];
      for(let k=1;k<chain.length-1;k++)faces.push([chain[k],chain[k+1],third]);
      repair.splitEdges++;split=true;break; // rebuild adjacency after every split
    }
    if(!split)break;
  }
  mesh.triangles=faces.flat();
  return {mesh,repair};
}

// Separating-axis test, including coplanar edge-normal axes.
function intersects(a, b) {
  const ea = [sub(a[1],a[0]),sub(a[2],a[1]),sub(a[0],a[2])];
  const eb = [sub(b[1],b[0]),sub(b[2],b[1]),sub(b[0],b[2])];
  const na = cross(ea[0],ea[1]), nb = cross(eb[0],eb[1]);
  const axes = [na,nb, ...ea.flatMap(x=>eb.map(y=>cross(x,y))), ...ea.map(e=>cross(na,e)), ...eb.map(e=>cross(nb,e))];
  for (const axis of axes) {
    const length = Math.hypot(...axis);
    if (length < 1e-12) continue;
    const n = axis.map(x=>x/length), aa = a.map(v=>dot(v,n)), bb = b.map(v=>dot(v,n));
    if (Math.max(...aa) < Math.min(...bb)-1e-7 || Math.max(...bb) < Math.min(...aa)-1e-7) return false;
  }
  return true;
}

export function validateMesh(mesh, { checkIntersections = true, details = false } = {}) {
  const { vertices, triangles } = mesh;
  if (!vertices.length || vertices.length % 3 || !triangles.length || triangles.length % 3) throw new Error('Пустая или некорректная сетка');
  if (!vertices.every(Number.isFinite)) throw new Error('Неконечные координаты сетки');
  const points = [], remap = [], unique = new Map(), edges = new Map(), faces = new Set(), ts = [];
  for (let i=0;i<vertices.length;i+=3) {
    const p=vertices.slice(i,i+3), cell=p.map(x=>Math.floor(x/1e-6));
    let match;
    // Match by distance, including neighbouring bins. Rounding alone can
    // split coincident seam vertices that straddle a quantisation boundary.
    search:for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      const bucket=unique.get(`${cell[0]+x},${cell[1]+y},${cell[2]+z}`)||[];
      for(const id of bucket)if(Math.hypot(...sub(points[id],p))<=1e-6){match=id;break search;}
    }
    if(match===undefined){
      match=points.length;points.push(p);
      const key=cell.join(',');if(!unique.has(key))unique.set(key,[]);unique.get(key).push(match);
    }
    remap.push(match);
  }
  let volume=0, degenerate=0, duplicates=0;
  const adjacency=Array.from({length:triangles.length/3},()=>[]);
  for(let i=0;i<triangles.length;i+=3) {
    const raw=triangles.slice(i,i+3);
    if (raw.some(n=>!Number.isInteger(n)||n<0||n>=remap.length)) throw new Error('Некорректный индекс треугольника');
    const ids=raw.map(n=>remap[n]), ps=ids.map(n=>points[n]);
    if(new Set(ids).size!==3 || Math.hypot(...cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])))<1e-10) degenerate++;
    const fk=[...ids].sort((a,b)=>a-b).join(',');
    if(faces.has(fk)) duplicates++;
    faces.add(fk);
    volume+=dot(ps[0],cross(ps[1],ps[2]))/6;
    const t={ids,ps,id:i/3,min:[0,1,2].map(k=>Math.min(...ps.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...ps.map(p=>p[k])))};
    ts.push(t);
    for(let j=0;j<3;j++) {
      const a=ids[j],b=ids[(j+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`;
      if(!edges.has(key)) edges.set(key,[]);
      edges.get(key).push({id:t.id,direction:a<b?1:-1});
    }
  }
  let boundary=0,nonManifold=0,badOrientation=0;
  for(const uses of edges.values()) {
    if(uses.length===1) boundary++;
    else if(uses.length!==2) nonManifold++;
    else {
      if(uses[0].direction===uses[1].direction) badOrientation++;
      adjacency[uses[0].id].push(uses[1].id); adjacency[uses[1].id].push(uses[0].id);
    }
  }
  let components=0; const seen=new Set();
  for(let i=0;i<ts.length;i++) if(!seen.has(i)) {
    components++; const stack=[i]; seen.add(i);
    while(stack.length) for(const n of adjacency[stack.pop()]) if(!seen.has(n)){seen.add(n);stack.push(n);}
  }
  let intersections=0;const intersectionPairs=[];
  if(checkIntersections) {
    const sorted=[...ts].sort((a,b)=>a.min[0]-b.min[0]);
    for(let i=0;i<sorted.length;i++) for(let j=i+1;j<sorted.length;j++) {
      const a=sorted[i],b=sorted[j];
      if(b.min[0]>a.max[0]+1e-7) break;
      if([1,2].some(k=>a.max[k]<b.min[k]-1e-7 || b.max[k]<a.min[k]-1e-7)) continue;
      // Shared vertices/edges are legitimate mesh contacts. CAD validity is
      // checked separately; this scan checks non-adjacent triangle pairs.
      if(a.ids.some(id=>b.ids.includes(id))) continue;
      if(intersects(a.ps,b.ps)){intersections++;if(details&&intersectionPairs.length<30)intersectionPairs.push([a.ps,b.ps]);}
    }
  }
  const result={triangles:ts.length,vertices:points.length,volume,boundary,nonManifold,badOrientation,components,degenerate,duplicates,intersections,
    bounds:{min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))}};
  result.ok=components===1 && volume>0 && !boundary && !nonManifold && !badOrientation && !degenerate && !duplicates && !intersections;
  if(details)result.intersectionPairs=intersectionPairs;
  return result;
}

// Write exactly the mesh that was validated and displayed, in millimetres.
export function binarySTL(mesh) {
  const count=mesh.triangles.length/3, buffer=new ArrayBuffer(84+50*count), view=new DataView(buffer);
  new Uint8Array(buffer,0,80).set(new TextEncoder().encode('BMX STREET SLIDE V0.9.0 | units: mm | validated mesh'));
  view.setUint32(80,count,true);
  for(let t=0;t<count;t++) {
    const ps=mesh.triangles.slice(t*3,t*3+3).map(id=>mesh.vertices.slice(id*3,id*3+3));
    const normal=cross(sub(ps[1],ps[0]),sub(ps[2],ps[0])), len=Math.hypot(...normal);
    const values=[...normal.map(x=>x/len),...ps.flat()];
    values.forEach((v,i)=>view.setFloat32(84+t*50+i*4,v,true));
    view.setUint16(84+t*50+48,0,true);
  }
  return buffer;
}

export function readSTL(buffer) {
  const view=new DataView(buffer), count=view.getUint32(80,true);
  if(buffer.byteLength!==84+50*count) throw new Error('Неверная длина STL');
  const vertices=[],triangles=[];
  for(let t=0;t<count;t++) for(let j=0;j<3;j++) {
    triangles.push(vertices.length/3);
    for(let k=0;k<3;k++) vertices.push(view.getFloat32(84+50*t+12+12*j+4*k,true));
  }
  return {vertices,triangles};
}
