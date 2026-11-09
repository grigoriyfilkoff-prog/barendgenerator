import * as THREE from 'three';
import { TrackballControls } from './vendor/TrackballControls.js';
import { DEFAULTS, CONTROLS, FIXED, parameters, VERSION } from './parameters.js';
import { previewGeometry } from './preview.js';

const $=id=>document.getElementById(id);
const fixedGeometryNote=$('slotSafety')?.nextElementSibling;
if(fixedGeometryNote)fixedGeometryNote.innerHTML='<b>Фиксировано:</b> наружная кромка головки со стороны руля скруглена R1; опорная часть задней плоскости остаётся плоской. Центр кольцевой выемки глубиной 2 мм и шириной 2 мм совпадает с началом прорезей лепестков; все кромки выемки скруглены R0,5. Участок M8 имеет постоянную длину 8 мм и центрируется по началу прорезей; винтовые витки в STL не рассчитываются, участок представлен каналом Ø8. У наружного входа головки отверстие Ø10 с R4 плавно сужается до Ø8; после участка M8 — конус 90° Ø8→Ø4 и канал Ø4 до торца. Ближайшая точка корневого R1 четырёх прорезей находится в 3 мм от задней плоскости головки; прорези шириной 2 мм идут до открытого торца. Наружные торцы лепестков — R2.';
if(fixedGeometryNote)fixedGeometryNote.innerHTML='<b>Настраивается отдельно:</b> кольцевую выемку можно полностью отключить; при включении доступны глубина, ширина и R всех её кромок. Центр выемки всегда совпадает с началом прорезей. <b>Остальное фиксировано:</b> задняя кромка головки R1; участок M8 длиной 8 мм представлен каналом Ø8 без расчёта витков; далее конус 90° Ø8→Ø4 и канал Ø4. Четыре прорези шириной 2 мм начинаются в 3 мм от головки, корень R1, наружные торцы лепестков R2.';
const asideNotes=document.querySelectorAll('aside .note');
if(asideNotes.length)asideNotes[asideNotes.length-1].innerHTML='<b>Автоматическая проверка отключена.</b> Конфигуратор строит модель и STL без проверки замкнутости, самопересечений и повторного чтения STL. Перед печатью проверяйте экспорт в слайсере.';
$('export').textContent='Подготовить STL';
let values={...DEFAULTS}, result=null, revision=0, active=false, pending=null, previewNeeded=false, buildTimer,watchdogTimer;
function createWorker(){
  const next=typeof globalThis.__BMX_WORKER_FACTORY==='function'
    ? globalThis.__BMX_WORKER_FACTORY()
    : new Worker(new URL('./cad-worker.js',import.meta.url),{type:'module'});
  next.onmessage=e=>{if(worker===next)receive(e);};
  next.onerror=e=>{if(worker===next)workerFailed(e);};return next;
}
let worker=null;
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x0d1420);
$('canvas').append(renderer.domElement);
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(40,1,.1,500);
const controls=new TrackballControls(camera,renderer.domElement);
Object.assign(controls,{rotateSpeed:3,zoomSpeed:1.15,panSpeed:.75,staticMoving:false,dynamicDampingFactor:.12});
scene.add(new THREE.HemisphereLight(0xffffff,0x35536b,2.5));
const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(25,30,30);scene.add(light);
const group=new THREE.Group();group.rotation.x=-Math.PI/2;scene.add(group);
const material=new THREE.MeshStandardMaterial({color:0x52b9e9,metalness:.08,roughness:.52});
let bodyMesh=null;
function fit(){
  const p=parameters(values),center=p.total/2,dist=Math.max(48,Math.hypot(p.rh,p.total/2)*3.8);
  controls.target.set(0,center,0);camera.up.set(0,1,0);camera.position.set(dist*.75,center+dist*.6,dist*.85);camera.updateProjectionMatrix();controls.update();
}
function resize(){const el=$('canvas'),w=Math.max(1,el.clientWidth),h=Math.max(1,el.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();controls.handleResize();}
new ResizeObserver(resize).observe($('canvas'));window.addEventListener('resize',resize);
function limits(){
  const mouthR=FIXED.preHoleD/2+FIXED.entryR;
  const maxHeadR=Math.max(0,Math.min(15,values.headH-FIXED.rearHeadR,values.headD/2-mouthR-.25));
  values.headR=Math.min(values.headR,maxHeadR);
  $('headR').max=maxHeadR;
  const maxGrooveR=Math.max(.1,Math.min(2,values.grooveDepth/2,values.grooveW/2));
  values.grooveR=Math.min(values.grooveR,maxGrooveR);
  $('grooveR').max=maxGrooveR;
  for(const [key] of CONTROLS){$(key).value=values[key];$(key+'v').textContent=values[key]+' мм';}
  $('grooveEnabled').checked=values.grooveEnabled;
  for(const key of ['grooveDepth','grooveW','grooveR'])$(key).disabled=!values.grooveEnabled;
  $('slotSafety').textContent=`Прорези: начало 3 мм от головки, длина ${(values.bodyL-FIXED.slotOffset).toFixed(1)} мм до открытого торца.`;
}
for(const [key,label,min,max,step] of CONTROLS){
  if(key==='grooveDepth'){
    const title=document.createElement('div');title.className='control-title';title.textContent='Кольцевая выемка';$('controls').append(title);
    const toggle=document.createElement('label');toggle.className='toggle';toggle.innerHTML='<span>Включить выемку</span><input id="grooveEnabled" type="checkbox" checked>';$('controls').append(toggle);
    $('grooveEnabled').addEventListener('change',()=>{values.grooveEnabled=$('grooveEnabled').checked;limits();requestBuild();});
  }
  const wrap=document.createElement('div');
  wrap.innerHTML=`<label for="${key}">${label}<b id="${key}v"></b></label><input id="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${values[key]}">`;
  $('controls').append(wrap);
  $(key).addEventListener('input',()=>{values[key]=Number($(key).value);limits();requestBuild();});
}
function requestBuild(){
  clearTimeout(buildTimer);
  clearTimeout(watchdogTimer);
  // Cancel outdated work instead of making the newest dimensions wait.
  if(active){worker?.terminate();worker=null;active=false;}
  result=null;pending=null;$('export').disabled=false;$('export').textContent='Подготовить STL';
  // Keep the current model visible until the next animation frame replaces it.
  previewNeeded=true;
  $('canvas').setAttribute('aria-busy','false');
  revision++;
  $('error').textContent='Предпросмотр готов. Точный CAD и STL строятся только по кнопке.';
}
function showGeometry(geometry,kind,id){
  if(bodyMesh){const old=bodyMesh.geometry;bodyMesh.geometry=geometry;old.dispose();}
  else {bodyMesh=new THREE.Mesh(geometry,material);group.add(bodyMesh);}
  group.visible=true;
  // Also used by the browser regression test to observe rendered revisions.
  $('canvas').dataset.geometry=kind;$('canvas').dataset.revision=String(id);
}
function dispatch(){
  if(active||!pending)return;
  if(!worker)worker=createWorker();
  active=true;const job=pending;pending=null;worker.postMessage(job);
  watchdogTimer=setTimeout(()=>workerFailed({message:'превышено время расчёта CAD (240 с)'}),240000);
}
function receive({data}){
  if(data.kind==='progress'){if(data.id===revision)$('error').textContent=data.stage;return;}
  clearTimeout(watchdogTimer);
  active=false;
  if(data.id!==revision){dispatch();return;}
  if(data.error){$('canvas').setAttribute('aria-busy','false');$('export').disabled=false;$('export').textContent='Повторить подготовку STL';$('error').textContent='Предпросмотр сохранён. Ошибка подготовки STL: '+data.error.split('\n')[0];return;}
  result=data;previewNeeded=false;
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.mesh.vertices,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.mesh.normals,3));
  geometry.setIndex(data.mesh.triangles);
  showGeometry(geometry,'cad',data.id);
  $('canvas').setAttribute('aria-busy','false');
  $('export').disabled=false;$('export').textContent='Скачать STL';
  $('error').textContent=`Модель построена: ${data.report.triangles} треугольников. Автоматическая проверка модели и STL отключена. ${data.report.elapsedMs} мс.`;
  window.dispatchEvent(new CustomEvent('bmx-ready',{detail:data.report}));
}
function workerFailed(e){
  clearTimeout(watchdogTimer);active=false;result=null;
  const detail=e?.message||e?.error?.message||e?.type||'неизвестная ошибка Worker';
  worker?.terminate();worker=null;$('export').disabled=false;$('export').textContent='Повторить подготовку STL';
  pending=null;$('canvas').setAttribute('aria-busy','false');
  $('error').textContent='Предпросмотр сохранён. Ошибка CAD-модуля: '+detail+'. Нажмите «Сброс размеров» для нового расчёта.';
}
function download(data,type,name){
  const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.type=type;a.style.display='none';
  document.body.appendChild(a);
  try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  return blob.size;
}
$('export').onclick=()=>{
  if(!result?.report.stlGenerated){
    if(active)return;
    pending={id:revision,params:{...values}};
    $('export').disabled=true;$('export').textContent='Построение STL…';
    $('canvas').setAttribute('aria-busy','true');
    $('error').textContent='Построение точного CAD и STL…';
    dispatch();return;
  }
  try{
    const name=`BMX_STREET_SLIDE_V${VERSION}.stl`,size=download(result.stl,'application/octet-stream',name);
    $('error').textContent=`STL передан браузеру для сохранения: ${name}, ${size.toLocaleString('ru-RU')} байт.`;
  }catch(error){$('error').textContent='Ошибка экспорта STL: '+(error?.message||error);}
};
$('fit').onclick=fit;
$('reset').onclick=()=>{values={...DEFAULTS};limits();requestBuild();fit();};
limits();resize();fit();requestBuild();
renderer.setAnimationLoop(()=>{
  let preview=null;
  if(previewNeeded){
    previewNeeded=false;
    const start=performance.now();
    showGeometry(previewGeometry(values),'preview',revision);
    preview={revision,params:{...values},elapsedMs:performance.now()-start};
  }
  controls.update();renderer.render(scene,camera);
  if(preview)window.dispatchEvent(new CustomEvent('bmx-preview',{detail:preview}));
});
