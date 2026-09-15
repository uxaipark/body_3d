# Wrist sensing performance analysis and changes

2026-09-13 source, local-asset, and Node.js CPU measurements. Browser FPS, GPU time, and network load time were not measured.

## Findings

A separate lightweight avatar for wrist experiments can reduce initial loading and rendering work. Currently, the preview loads the full body's anatomical assets. Hiding unused systems does not remove download, decoding, or memory costs.

| Item | Local measurement | Meaning |
|---|---:|---|
| Six body GLBs | 11.40 MiB; 2,610,679 triangles | Full anatomy used for a small posture preview |
| Wrist GLB | 5.37 MiB | Loaded separately from the body |
| Shared 3D bridge | About 3.04 MiB uncompressed | Body engine, motion, skin-section code, Three |
| Wrist Three module | 0.55 MiB plus core dependency | Shared bridge also contains Three |

The source files' 2,338 primitives are not actual draw calls; the body loader merges geometry. Overlapping translucent systems also increase pixel workload. Triangle counts alone do not determine FPS.

Historical single-run Node.js references after initial optimization: wrist GLB parsing/setup about 132 ms; mean tissue CPU update across 120 iterations about 0.42 ms/update; nine-channel signal engine about 1.07 ms CPU per 16 ms simulated interval. These were not remeasured after subsequent native artery restoration, bending subdivision, and rotation changes. They exclude GPU/rendering/browser/WASM analysis and depend on device/settings; they do not establish current performance or its bottleneck.

## Applied optimizations

- Offscreen or collapsed body/wrist views stop updating; signal-worker timing continues.
- Section/contour modes avoid deforming hidden anatomical meshes and patches every frame.
- Skin perimeter is prepared at initialization. Patch placement/rotation caches positions and unit pulse displacement, then adds small per-frame displacement without repeated skin raycasts.
- Wrist renderer maximum DPR fell from 2 to 1.5: 43.75% fewer maximum pixels at equal CSS size, not a measured speedup percentage.
- Replacing patch layouts disposes previous geometry, materials, and number textures.
- Interleaved GLB positions/normals are separated to prevent deformation from overwriting normals.

## Next priorities

1. Create a dedicated low-resolution body GLB retaining the skin silhouette and bones/right arm/main vessels needed to understand motion. Keep the same HumanRig and captured walking data; avoid requesting unnecessary organs and detailed nerves.
2. Load full anatomical detail only on demand while retaining the detailed wrist model.
3. Share Three and split bridge modules so body/section code loads when needed.
4. Profile real devices: download, decode, rigging, shader compilation, CPU/GPU frame time, and translucent overdraw. Set LOD/resolution from measurements.

Separate lightweight assets and real-browser profiling in priorities 1–4 were not implemented in this change.

## Behavior and model limits

Body and wrist previews use the same capture and 1.1166667-second walking cycle. Patches wrap along skin perimeter arc length; comma/period rotate by 2.5°. Rotated coordinates also reach the signal model. Dragging center empty space or Option/Alt plus horizontal drag rolls around the vessel long axis (native X; tissue-section Z). Rightward top drag turns clockwise, rightward bottom drag counterclockwise; leftward drag reverses these. Top/bottom vertical drag tilts about the current screen horizontal axis. Side drags follow the displayed object; central arterial-axis rotation also resolves sign from current projection. Reset restores display, vessel, patch, and camera defaults. The 3D area is square; controls use separate height. The introduction header was removed and the experiment summary can collapse.

The short detached radial tube was replaced by its native atlas course continuing to the palmar arch. Endpoints remain anchored while a quintic easing field blends middle-position offsets. Connected arteries share the field; bending regions receive extra subdivision and corrected normals. The tissue model's 1.1 mm radius is representative, not fitted to a patient's vessel diameter. Spatial bending approximates elasticity, not material FEM or recomputed flow. Lateral/depth controls drive signals, 3D vessels, surrounding tissue, and sections. Existing causal pressure-dependent radius changes drive pulsation.

Skin perimeter is approximated from mesh slices sampled every 3 mm and shared by 3D placement and snapshots. Electrode surface height contributes to local artery depth. Pad transfer remains a local tissue approximation, not patient-specific contact/deep-anatomy/FEM validation around the entire wrist. Patch compliance remains in sensor coupling while the view depicts a flexible patch.

The snapshot's white artery line uses the actual atlas centerline transformed into skin arc length and inverse patch rotation, replacing a fixed lateral reference. Heatmaps, contours, delay maps, 3D bars, and surface views share this course. The yellow beam-search line is an estimate; inverse-model validation for rotated arrays remains separate work.
