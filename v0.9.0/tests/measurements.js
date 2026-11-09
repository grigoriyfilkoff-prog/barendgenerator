function assert(value,msg){if(!value)throw new Error(msg);}
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function rayDistance(mesh,origin,direction){
  let nearest=Infinity;
  for(let i=0;i<mesh.triangles.length;i+=3){
    const [a,b,c]=mesh.triangles.slice(i,i+3).map(n=>mesh.vertices.slice(3*n,3*n+3));
    const e1=sub(b,a),e2=sub(c,a),h=cross(direction,e2),det=dot(e1,h);
    if(Math.abs(det)<1e-10)continue;
    const s=sub(origin,a),u=dot(s,h)/det;if(u<0||u>1)continue;
    const q=cross(s,e1),v=dot(direction,q)/det;if(v<0||u+v>1)continue;
    const distance=dot(e2,q)/det;if(distance>1e-7)nearest=Math.min(nearest,distance);
  }
  return nearest;
}
export function inspectDimensions(mesh,p){
  const points=[];for(let i=0;i<mesh.vertices.length;i+=3)points.push(mesh.vertices.slice(i,i+3));
  const rootPoints=points.filter(([x,y,z],i)=>z>=p.slotStart-1e-7&&z<p.slotStart+.99&&Math.min(Math.abs(x),Math.abs(y))<1.001
    &&Math.hypot(x,y)>p.threadD/2+.1&&Math.abs(mesh.normals[3*i+2])>.001);
  assert(rootPoints.length>12,'root arc samples');
  const nearest=Math.min(...rootPoints.map(v=>v[2]));
  assert(Math.abs(nearest-p.slotStart)<.011 && Math.abs(nearest-p.headH-3)<.011,'fixed 3 mm slot start');
  for(const [x,y,z] of rootPoints)assert(Math.abs(Math.hypot(Math.min(Math.abs(x),Math.abs(y)),z-(p.slotStart+1))-1)<1e-5,'actual root radius R1');
  const tipPoints=points.filter(([x,y,z])=>z>p.total-2+1e-5&&Math.hypot(x,y)>p.ro-2+1e-5);
  assert(tipPoints.length>12,'tip arc samples');
  for(const [x,y,z] of tipPoints)assert(Math.abs(Math.hypot(Math.hypot(x,y)-(p.ro-2),z-(p.total-2))-2)<1e-5,'actual toroidal R2');
  for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2])for(const radial of [3,5.5,p.ro-.5])for(const z of [p.slotStart+1.2,(p.slotStart+p.total)/2,p.total-2.2]){
    const radialDirection=[Math.cos(angle),Math.sin(angle),0],side=[-Math.sin(angle),Math.cos(angle),0];
    const origin=[radial*radialDirection[0],radial*radialDirection[1],z];
    const width=rayDistance(mesh,origin,side)+rayDistance(mesh,origin,side.map(v=>-v));
    assert(Math.abs(width-2)<1e-5,`actual slot width ${width} at r=${radial}, z=${z}`);
  }
  const angle=Math.PI/4,ray=[Math.cos(angle),Math.sin(angle),0];
  for(const [z,expected,name] of [
    [1,p.mouthR-Math.sqrt(p.entryR**2-(1-p.entryR)**2),'R4 inlet'],
    [p.entryR+.5,p.preHoleD/2+.5/(p.threadStart-p.entryR)*(p.threadD-p.preHoleD)/2,'diameter 10 to 8 pre-thread taper'],
    ...Array.from({length:Math.floor(p.threadLength/p.threadPitch)},(_,i)=>[p.threadStart+3*p.threadPitch/8+.05/Math.sqrt(3)+i*p.threadPitch+p.threadPitch/8,p.threadD/2,`M8 major radius, turn ${i+1}`]),
    ...Array.from({length:Math.floor(p.threadLength/p.threadPitch)-1},(_,i)=>[p.threadStart+3*p.threadPitch/8+.05/Math.sqrt(3)+i*p.threadPitch+5*p.threadPitch/8,p.threadMinorR,`M8 minor radius, turn ${i+1}`]),
    [p.threadEnd+.5,2.5,'90 degree cone'],[p.coneEnd+1,2,'diameter 4 channel'],
  ]){
    const actual=rayDistance(mesh,[0,0,z],ray);
    assert(Math.abs(actual-expected)<.015,`${name} actual radius: ${actual}, expected ${expected}, z ${z}`);
  }
}
