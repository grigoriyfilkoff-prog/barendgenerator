# Vendored dependencies

The application uses unmodified upstream distribution files:

| Component | Version | Source / distribution | License |
| --- | --- | --- | --- |
| Three.js / TrackballControls | 0.164.1 | https://github.com/mrdoob/three.js/tree/r164 · https://cdn.jsdelivr.net/npm/three@0.164.1/ | MIT, `THREE-LICENSE.txt` |
| Replicad | 0.20.5 | https://github.com/sgenoud/replicad · https://cdn.jsdelivr.net/npm/replicad@0.20.5/ | MIT, `REPLICAD-LICENSE.txt` |
| Replicad OpenCascade.js custom build | 0.20.2 | https://github.com/sgenoud/replicad/tree/main/packages/replicad-opencascadejs · https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.20.2/ | Wrapper/build: MIT; OpenCascade: LGPL 2.1 with exception |
| Open CASCADE Technology (compiled into WASM) | Upstream custom build above | https://github.com/Open-Cascade-SAS/OCCT · https://dev.opencascade.org/resources/licensing | `OCCT-LGPL-2.1.txt`, `OCCT-LGPL-EXCEPTION.txt` |
| opentype.js (included in Replicad bundle) | 1.3.4 | https://github.com/opentypejs/opentype.js | MIT, `OPENTYPE-LICENSE.txt` |
| Flatbush / Flatqueue (included in Replicad bundle) | See upstream bundle | https://github.com/mourner/flatbush · https://github.com/mourner/flatqueue | ISC, `FLATBUSH-LICENSE.txt`, `FLATQUEUE-LICENSE.txt` |

Replicad custom-build configuration and rebuilding instructions are in its upstream package. The application uses the `replicad_with_exceptions` loader/WASM variant to support boolean operations on helical geometry; `replicad_single` is retained from the previous implementation. Both are upstream 0.20.2 builds. The WASM and its loader are separate, replaceable files; application code does not modify them. Type declarations are included for API inspection. No fonts or external services are used at runtime.
