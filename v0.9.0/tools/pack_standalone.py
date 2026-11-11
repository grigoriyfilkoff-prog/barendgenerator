"""Pack the local configurator and all runtime dependencies into one HTML file."""
from __future__ import annotations

import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "BMX_STREET_SLIDE_V0.9.0_TEST.html"


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def js_string(value: str) -> str:
    # HTML parsing ends a script element before JavaScript string parsing.
    return json.dumps(value, ensure_ascii=False).replace("</script", "<\\/script")


def without_imports(source: str) -> str:
    return "\n".join(line for line in source.splitlines() if not line.startswith("import "))


def classic_worker_bundle() -> str:
    oc = text("vendor/replicad_with_exceptions.js").replace("export default Module;", "return Module;")
    replicad = text("vendor/replicad.js").rsplit("\nexport {", 1)[0]
    params = text("parameters.js").replace("export ", "")
    mesh = text("mesh.js").replace("export ", "")
    cad = without_imports(text("cad.js")).replace("export ", "")
    worker = without_imports(text("cad-worker.js")).replace(
        "new URL('./vendor/replicad_with_exceptions.wasm',import.meta.url).href",
        "globalThis.__BMX_WASM_URL",
    )
    return f"""
globalThis.__BMX_WASM_URL=__BMX_WASM_URL__;
const initOC=(()=>{{{oc}}})();
const REPLICAD=(()=>{{{replicad}\nreturn {{setOC,Sketcher,makeHelix,genericSweep,makeBox,getOC,cast}};}})();
const PARAMS=(()=>{{{params}\nreturn {{parameters,axialProfile,rootProfile,threadSeams}};}})();
const MESH=(()=>{{{mesh}\nreturn {{binarySTL,conformCADMesh,validateMesh,readSTL}};}})();
const CAD=(()=>{{
  const {{Sketcher,makeHelix,genericSweep,makeBox,getOC,cast}}=REPLICAD;
  const {{parameters,axialProfile,rootProfile}}=PARAMS;
  {cad}
  return {{buildBody}};
}})();
(()=>{{
  const {{setOC}}=REPLICAD;
  const {{buildBody}}=CAD;
  const {{threadSeams}}=PARAMS;
  const {{binarySTL,conformCADMesh,validateMesh,readSTL}}=MESH;
  {worker}
}})();
"""


html = text("index.html")
html = html.replace(
    '<script type="importmap">{"imports":{"three":"./vendor/three.module.js"}}</script>',
    "",
)
html = html.replace('<script type="module" src="./app.js"></script>', "__STANDALONE_BOOT__")

sources = {
    "three": text("vendor/three.module.js"),
    "trackball": text("vendor/TrackballControls.js"),
    "parameters": text("parameters.js"),
    "preview": text("preview.js"),
    "workerBundle": classic_worker_bundle(),
    "app": text("app.js"),
}
wasm = base64.b64encode((ROOT / "vendor/replicad_with_exceptions.wasm").read_bytes()).decode("ascii")

licenses = "\n\n".join(
    f"===== {name} =====\n{(ROOT / 'vendor' / name).read_text(encoding='utf-8')}"
    for name in [
        "NOTICE.md",
        "THREE-LICENSE.txt",
        "REPLICAD-LICENSE.txt",
        "OCCT-LGPL-2.1.txt",
        "OCCT-LGPL-EXCEPTION.txt",
        "OPENTYPE-LICENSE.txt",
        "FLATBUSH-LICENSE.txt",
        "FLATQUEUE-LICENSE.txt",
    ]
)

boot = f"""<script type="module">
const source = {{
  three: {js_string(sources['three'])},
  trackball: {js_string(sources['trackball'])},
  parameters: {js_string(sources['parameters'])},
  preview: {js_string(sources['preview'])},
  workerBundle: {js_string(sources['workerBundle'])},
  app: {js_string(sources['app'])}
}};
const makeModule = code => URL.createObjectURL(new Blob([code], {{type:'text/javascript'}}));
const replace = (code, entries) => {{
  for (const [from,to] of entries) code=code.split(from).join(to);
  return code;
}};
const three=makeModule(source.three);
const parameters=makeModule(source.parameters);
const trackball=makeModule(replace(source.trackball, [["from 'three'",`from '${{three}}'`]]));
const preview=makeModule(replace(source.preview, [
  ["from 'three'",`from '${{three}}'`],
  ["from './parameters.js'",`from '${{parameters}}'`]
]));
const wasmBytes=Uint8Array.from(atob('{wasm}'),c=>c.charCodeAt(0));
// One classic Worker script: no module imports, data URLs, or fallback path.
const workerEntry=makeModule(source.workerBundle.replace('__BMX_WASM_URL__',JSON.stringify('about:blank')));
globalThis.__BMX_WORKER_FACTORY=()=>{{
  const instance=new Worker(workerEntry);
  const wasmCopy=wasmBytes.slice().buffer;
  instance.postMessage({{kind:'init-wasm',wasm:wasmCopy}},[wasmCopy]);
  return instance;
}};
globalThis.__BMX_WORKER_URL='about:blank';
const app=makeModule(replace(source.app, [
  ["from 'three'",`from '${{three}}'`],
  ["from './vendor/TrackballControls.js'",`from '${{trackball}}'`],
  ["from './parameters.js'",`from '${{parameters}}'`],
  ["from './preview.js'",`from '${{preview}}'`],
  ["new URL('./cad-worker.js',import.meta.url)",'globalThis.__BMX_WORKER_URL']
]));
try {{ await import(app); }} catch (error) {{
  document.getElementById('error').textContent='Ошибка запуска автономного файла: '+(error.stack||error);
  throw error;
}}
</script>
<script type="text/plain" id="thirdPartyLicenses">{licenses.replace('</script', '<\\/script')}</script>"""

OUTPUT.write_text(html.replace("__STANDALONE_BOOT__", boot), encoding="utf-8", newline="\n")
print(f"{OUTPUT.name}: {OUTPUT.stat().st_size} bytes")
