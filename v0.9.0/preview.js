import * as THREE from 'three';
import { parameters, boreRadius } from './parameters.js';

// Interactive display only. The CAD worker remains the sole export authority.
// Analytic sections keep the thread, inlet R4, cone and slots during dragging.
export function previewGeometry(input) {
  const p=parameters(input),positions=[],indices=[];
  const quarter=Math.PI/2, angularSteps=24, arcSteps=12;
  function surface(rows,columns,point,reverse=false){
    const offset=positions.length/3;
    for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++)positions.push(...point(col/columns,row));
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
      const a=offset+row*(columns+1)+col,b=a+1,c=a+columns+1,d=c+1;
      if(reverse)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
    }
  }
  const polar=(r,angle,z)=>[r*Math.cos(angle),r*Math.sin(angle),z];
  const collar=[[p.mouthR,0],[p.rh-p.headR,0]];
  if(p.headR)for(let i=1;i<=arcSteps;i++){
    const a=quarter*i/arcSteps;
    collar.push([p.rh-p.headR+p.headR*Math.sin(a),p.headR*(1-Math.cos(a))]);
  }
  collar.push([p.rh,p.headH-p.rearHeadR]);
  for(let i=1;i<=arcSteps;i++){
    const a=quarter*i/arcSteps;
    collar.push([p.rh-p.rearHeadR+p.rearHeadR*Math.cos(a),p.headH-p.rearHeadR+p.rearHeadR*Math.sin(a)]);
  }
  collar.push([p.ro,p.headH],[p.ro,p.grooveStart]);
  if(p.grooveEnabled){
    for(let i=1;i<=arcSteps;i++){
      const a=quarter*i/arcSteps;
      collar.push([p.ro-p.grooveR+p.grooveR*Math.cos(a),p.grooveStart+p.grooveR*Math.sin(a)]);
    }
    collar.push([p.ro-p.grooveDepth+p.grooveR,p.grooveStart+p.grooveR]);
    for(let i=1;i<=arcSteps;i++){
      const a=quarter*i/arcSteps;
      collar.push([p.ro-p.grooveDepth+p.grooveR-p.grooveR*Math.sin(a),p.grooveCenter-p.grooveR*Math.cos(a)]);
    }
  }else collar.push([p.ro,p.slotStart]);
  // Separate strips preserve sharp normals on the head bearing plane.
  for(let i=0;i<collar.length-1;i++)surface(1,angularSteps*4,(u,row)=>{
    const [r,z]=collar[i+row];return polar(r,u*Math.PI*2,z);
  });
  const lower=[];
  for(let z=0;z<p.slotStart;z+=p.threadPitch/8)lower.push(z);
  lower.push(p.entryR,p.threadStart,p.slotStart);
  lower.sort((a,b)=>a-b);
  lower.reverse();
  surface(lower.length-1,angularSteps*4,(u,row)=>{
    const angle=u*Math.PI*2,z=lower[row];return polar(boreRadius(p,z,angle),angle,z);
  });

  const zs=[];
  for(let i=0;i<=arcSteps;i++)zs.push(p.slotStart+p.rootR*(1-Math.cos(quarter*i/arcSteps)));
  for(let i=0;i<=arcSteps;i++)zs.push(p.total-p.tipR+p.tipR*Math.sin(quarter*i/arcSteps));
  for(let z=p.slotStart;z<p.coneEnd;z+=p.threadPitch/8)zs.push(z);
  zs.push(p.grooveEnd-p.grooveR,p.grooveEnd,p.threadEnd,p.coneEnd);
  const levels=[...new Set(zs)].sort((a,b)=>a-b);
  const outer=z=>{
    if(!p.grooveEnabled)return z<=p.total-p.tipR?p.ro:p.ro-p.tipR+Math.sqrt(Math.max(0,p.tipR**2-(z-(p.total-p.tipR))**2));
    if(z<=p.grooveStart||z>=p.grooveEnd){
      return z<=p.total-p.tipR?p.ro:p.ro-p.tipR+Math.sqrt(Math.max(0,p.tipR**2-(z-(p.total-p.tipR))**2));
    }
    if(z<p.grooveStart+p.grooveR)return p.ro-p.grooveR+Math.sqrt(Math.max(0,p.grooveR**2-(z-p.grooveStart)**2));
    if(z<=p.grooveEnd-p.grooveR)return p.ro-p.grooveDepth+p.grooveR-Math.sqrt(Math.max(0,p.grooveR**2-(z-p.grooveCenter)**2));
    return p.ro-p.grooveR+Math.sqrt(Math.max(0,p.grooveR**2-(z-p.grooveEnd)**2));
  };
  const halfWidth=z=>z>=p.slotStart+p.rootR?p.slotW/2:Math.sqrt(Math.max(0,p.rootR**2-(z-(p.slotStart+p.rootR))**2));
  for(let petal=0;petal<4;petal++){
    const start=petal*quarter,end=start+quarter;
    const boundaries=levels.map(z=>[false,true].map(upper=>{
      const w=halfWidth(z);let lo=0,hi=quarter/2;
      for(let i=0;i<20;i++){
        const gap=(lo+hi)/2,angle=upper?end-gap:start+gap;
        if(Math.sin(gap)*boreRadius(p,z,angle)<w)lo=gap;else hi=gap;
      }
      return upper?end-(lo+hi)/2:start+(lo+hi)/2;
    }));
    function arcPoint(u,row,inner=false){
      const z=levels[row];
      if(inner){const [a,b]=boundaries[row],angle=a+u*(b-a);return polar(boreRadius(p,z,angle),angle,z);}
      const r=outer(z),gap=Math.asin(halfWidth(z)/r);
      return polar(r,start+gap+u*(quarter-2*gap),z);
    }
    surface(levels.length-1,angularSteps,(u,row)=>arcPoint(u,row));
    surface(levels.length-1,angularSteps,(u,row)=>arcPoint(u,row,true),true);
    for(const upper of [false,true])surface(levels.length-1,8,(u,row)=>{
      const z=levels[row],inner=boreRadius(p,z,boundaries[row][upper?1:0]);
      const r=inner+u*(outer(z)-inner),gap=Math.asin(halfWidth(z)/r);
      return polar(r,upper?end-gap:start+gap,z);
    },upper);
    surface(1,angularSteps,(u,row)=>{
      const r=row?p.ri:outer(p.total),gap=Math.asin((p.slotW/2)/r);
      return polar(r,start+gap+u*(quarter-2*gap),p.total);
    });
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();
  return g;
}
