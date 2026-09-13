import {arteryTether} from './arteryDeformation.js';
import {atlasArteryAt} from './atlasProfile.js';
import {rotatePatchPoint,patchAlongHalf,normalizePatchAngle} from './patchGeometry.js';
import {isCenterDrag,dragWristOrbit,rotateCameraAroundAxis} from './viewInteraction.js';
import {makeWristSection} from '../bridge/soma-bridge.js';
// 3D wrist close-up: forearm/wrist segment, radial artery (pulsating), FCR & palmaris
// tendons, radius bone, and the flexible electrode sheet with its pads. The sheet can be
// dragged (left-drag) laterally / along the forearm; the model's coupling changes live.
// Right-drag (or ctrl/⌘-drag) orbits, wheel zooms.
//
// Coordinates: forearm axis = world X (proximal −x → distal +x / hand side),
// volar (palm) surface faces +Y, wrist-local `lateral` (+ toward thumb) = world +Z.
// 1 mm = 0.001 world units.

//
// 손/전완 자체의 기하는 `js/wrist3d/models.js` 의 세 모델(0 현행 / A 해부 단면 / E 실사 GLB 손)이
// 소유한다. 이 파일은 조명·요골동맥 튜브·전극 시트/패드·카메라·포인터를 계속 들고 있으므로,
// 모델을 갈아 끼워도 패치 위치와 카메라는 그대로다.

import * as THREE from './vendor/three.module.js';
import { WRIST_ANATOMY } from './capacitiveArray.js';
import { buildModel0, buildModelA, buildModelE } from './wrist3d/nativeAtlas.js';

const MM = 0.001;
// Reference cross-section of this view (the twin's historical constants). The **body-linked**
// geometry is applied as a RATIO on top of these (setWristGeometry), so the reference body
// (170 cm / 70 kg → widthScale = depthScale = 1 exactly) renders pixel-identically to before.
// Honest note: these 56 × 40 mm (2·28 × 2·20) are this view's own drawing constants and differ
// by ≈3 % from the anthropometric width/depth of `anthropometry.deriveWristCrossSection`
// (58 × 40.6 mm at the reference body) — see docs/CLINICAL_AUDIT.md §6.16.
const WRIST_RX = 20; // mm, vertical semi-axis (volar–dorsal half-thickness) @ reference body
const WRIST_RZ = 28; // mm, lateral semi-axis (half-width) @ reference body
const SEG_LEN = 110; // mm, shown forearm length
// Model `along` coordinate: 0 at the wrist crease (hand start, world x = +SEG_LEN/2), negative = proximal.
const X_CREASE_MM = SEG_LEN / 2;
const alongToX = (along_mm) => (X_CREASE_MM + along_mm) * MM;

function snrColor(db) {
  // −5 dB red → 5 dB yellow → 15+ dB green
  const t = Math.max(0, Math.min(1, (db + 5) / 20));
  const c = new THREE.Color();
  if (t < 0.5) c.setRGB(0.95, 0.25 + 1.3 * t, 0.2); else c.setRGB(0.95 - 1.6 * (t - 0.5), 0.85, 0.25);
  return c;
}

export class WristView {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1020);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.005, 5);
    this.target = new THREE.Vector3(0.01, 0.012, 0);
    // Initial azimuth chosen so the hand (+X) points to the screen's north-west:
    // screen-x of +X = cos θ < 0 and screen-up of +X = −sin θ·cos φ > 0 → θ ≈ π + atan(1/cos φ).
    this.orbit = { theta: Math.PI + Math.atan(1 / Math.cos(0.75)), phi: 0.75, radius: 0.165, mode: null, lastX: 0, lastY: 0 };
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    // Live cross-section semi-axes (mm). Driven by setWristGeometry(); start at the reference body.
    this.wristRx = WRIST_RX; this.wristRz = WRIST_RZ;
    this.geomScale = { widthScale: 1, depthScale: 1 };

    this.sheet = { lateral: WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM, along: 0, angle: 0 };
    this.layout = { rows: 0, cols: 0, spacing: 6 };
    this.pads = [];
    this._onSheetMove = null;
    this.arteryLateral = WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM; this.arteryDepth = WRIST_ANATOMY.ARTERY_BASE_DEPTH_MM;

    // 손/전완 모델. 0안은 동기로 만들고, A/E 는 setHandModel()에서 처음 고를 때 만든다.
    // 한 번 만든 모델은 씬에 남겨 두고 visible 만 끈다 — 되돌아올 때 즉시 뜨고, GLB 를 다시 받지 않는다.
    this._handModel = '0';
    this._models = new Map();
    this._modelError = null;
    // 자산 경로 훅 — E안의 GLB 를 다른 위치/다른 모델로 갈아 끼울 때만 설정한다(라이선스 교체용).
    this.assetBase = null;

    this._buildLights();
    this._buildWrist();
    this._bindPointer();
    this.resize();
  }

  /** 현재 손 모델 ('0' | 'A' | 'E'). */
  get handModel() { return this._handModel; }
  /** 마지막 모델 전환에서 생긴 오류 메시지(없으면 null) — 카드 푸터에 띄우는 용도. */
  get handModelError() { return this._modelError; }

  /**
   * 손 모델 전환. E안은 **처음 고를 때만** GLB 를 받는다(지연 로드).
   * 실패하면 콘솔 경고를 남기고 0안으로 되돌린다 — 뷰가 비는 일은 없다.
   * @returns {Promise<string>} 실제로 활성화된 모드
   */
  async setHandModel(mode) {
    const key=['0','A','S','T'].includes(mode)?mode:'A';
    const model=this._models.get('0');
    try{await model.ready;this._modelError=null;}catch(error){this._modelError='해부학 메시 로드 실패. 새로고침해 주세요.';return this._handModel;}
    this._handModel=key;model.setMode(key);model.group.visible=key==='0'||key==='A';
    const section=key==='S'||key==='T';this.renderer.domElement.style.display=section?'none':'';
    if(section&&!this.section){this.sectionHost=document.createElement('div');Object.assign(this.sectionHost.style,{position:'absolute',inset:'0'});this.container.append(this.sectionHost);this.section=makeWristSection(this.sectionHost,Number(document.getElementById('tissueFat')?.value||2.2),atlasArteryAt(this.sheet.along).depth_mm);}
    if(this.sectionHost)this.sectionHost.style.display=section?'':'none';
    if(section){this.section.focus(key==='T'?'top':'full');this.section.resize();}
    this._layoutSheet();return key;
  }

  // ctx 는 세 빌더가 공유하는 시그니처 (js/wrist3d/models.js 참조).
  _modelCtx() {
    return {
      THREE, MM, SEG_LEN, WRIST_ANATOMY,
      arteryMat: this.arteryMat,
      rx: this.wristRx, rz: this.wristRz,
      assetBase: this.assetBase || undefined,
    };
  }

  _installModel(key, model) {
    this._models.set(key, model);
    model.group.visible = false;
    this.scene.add(model.group);
  }

  _showModel(key) {
    for (const [k, m] of this._models) m.group.visible = k === key;
    this._handModel = key;
  }

  onSheetMove(cb) { this._onSheetMove = cb; }

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a1f1a, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(0.1, 0.25, 0.15); key.castShadow = true; this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7aa2ff, 0.8); rim.position.set(-0.1, 0.1, -0.2); this.scene.add(rim);
  }

  // 뷰가 직접 소유하는 것만 만든다: 요골동맥 튜브, 전극 시트 그룹, 그리고 초기 카메라 프레이밍.
  // 전완 껍질·뼈·건·손은 손 모델(js/wrist3d/models.js)이 갖고 있다.
  _buildWrist() {
    // Radial artery — tube along X, deepening proximally (away from the crease)
    const arteryPts = [];
    for (let i = 0; i <= 20; i++) {
      const x = -SEG_LEN / 2 + (SEG_LEN * i) / 20; // mm (world)
      arteryPts.push(new THREE.Vector3(x * MM, 0, 0)); // y/z set in _rebuildArtery
    }
    this._arteryPts = arteryPts;
    this.arteryMat = new THREE.MeshStandardMaterial({ color: 0xff2d3f, emissive: 0xaa0a1c, emissiveIntensity: 0.8, roughness: 0.35 });
    this.artery = null;

    // 손 모델 0안(현행). 손바닥 아치/지동맥이 arteryMat 을 쓰므로 재질을 먼저 만든 뒤에 짓는다.
    this._installModel('0', buildModel0(this._modelCtx()));
    this._showModel('0');this._models.get('0').ready.then(()=>this._layoutSheet()).catch(()=>{});

    this._rebuildArtery(WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM, WRIST_ANATOMY.ARTERY_BASE_DEPTH_MM);

    // Sheet group (curved strip + pads), positioned by _layoutSheet()
    this.sheetGroup = new THREE.Group();
    this.scene.add(this.sheetGroup);
    this.sheetMesh = null;

    // Frame the camera so wrist + sheet stay central with the hand visible distally.
    // 모델 전환에서는 다시 부르지 않는다 — 사용자가 돌려 놓은 카메라를 되돌리면 안 된다.
    this.target.set(0.04, 0.005, 0.0);
    this.orbit.radius = 0.29;
  }

  // Skin surface Y (world) at lateral position (mm) on the volar side of the ellipse.
  _surfaceY(lat_mm,along_mm=this.sheet.along) {
    const native=this._models.get('0')?.surfaceY(lat_mm,along_mm);if(native!=null)return native;
    const zr = Math.max(-0.999, Math.min(0.999, lat_mm / this.wristRz));
    return this.wristRx * Math.sqrt(1 - zr * zr) * MM;
  }
  // Surface normal at lateral position (ellipse gradient), unit vector in YZ plane.
  _surfaceNormal(lat_mm) {
    const a=this._surfaceY(lat_mm-.3),b=this._surfaceY(lat_mm+.3);if(Number.isFinite(a)&&Number.isFinite(b))return new THREE.Vector3(0,1,-(b-a)/.0006).normalize();
    const y = this._surfaceY(lat_mm) / MM, z = lat_mm;
    const n = new THREE.Vector3(0, y / (this.wristRx * this.wristRx), z / (this.wristRz * this.wristRz));
    return n.normalize();
  }

  /**
   * Body-linked cross-section (js/anthropometry.js `deriveWristCrossSection`).
   * `widthScale`/`depthScale` are RATIOS vs the reference body (170 cm / 70 kg → exactly 1), so the
   * default body reproduces the historical drawing bit-for-bit. `width_mm`/`depth_mm`/`volarRadius_mm`
   * are kept for read-out only (the anthropometric absolutes differ ≈3 % from this view's own
   * reference constants — docs/CLINICAL_AUDIT.md §6.16).
   * A wider/flatter body ⇒ larger semi-axes ⇒ the electrode sheet drapes over a flatter arc.
   */
  setWristGeometry({ widthScale = 1, depthScale = 1, width_mm = null, depth_mm = null, volarRadius_mm = null } = {}) {
    const rz = WRIST_RZ * widthScale, rx = WRIST_RX * depthScale;
    this.wristGeom = { width_mm, depth_mm, volarRadius_mm };
    if (rz === this.wristRz && rx === this.wristRx) return; // no-op (reference body → exactly equal)
    this.wristRz = rz; this.wristRx = rx;
    this.geomScale = { widthScale, depthScale };
    this._applyWristGeometry();
  }

  // Re-place every mesh whose position/size depends on the cross-section, then re-drape the sheet.
  // 전완/손 쪽은 활성 모델이 아니라 **만들어 둔 모델 전부**에 적용한다 — 나중에 전환해도 체형이 맞도록.
  _applyWristGeometry() {
    const g = { rx: this.wristRx, rz: this.wristRz };
    for (const m of this._models.values()) m.setGeometry(g);
    this._rebuildArtery(this.arteryLateral, this.arteryDepth);
    this._layoutSheet();
  }

  _rebuildArtery(lateral_mm,depth0_mm){this.arteryLateral=lateral_mm;this.arteryDepth=depth0_mm;}

  // Set each ring's radius from a per-ring pulse value (0..1) — null → resting radius.
  _inflateArtery(ringPulse) {
    const T = this._arteryTube; if (!T) return;
    const pos = T.geo.attributes.position.array;
    let k = 0;
    for (let i = 0; i <= T.N; i++) {
      const p = ringPulse ? ringPulse[i] : 0;
      const r = T.baseR * (1 + 1.1 * p);
      const c = T.centers[i], n = T.normals[i], b = T.binormals[i];
      for (let j = 0; j <= T.R; j++) {
        const th = (j / T.R) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
        pos[k++] = c.x + r * (cs * n.x + sn * b.x);
        pos[k++] = c.y + r * (cs * n.y + sn * b.y);
        pos[k++] = c.z + r * (cs * n.z + sn * b.z);
      }
    }
    T.geo.attributes.position.needsUpdate = true;
    T.geo.computeVertexNormals();
  }

  // Regular grid (rows, cols, spacingMm) or a custom layout from the patch designer
  // ({ sheetW, sheetH, electrodes: [{x, y, w, h, shape}] }, sheet-relative mm, x = lateral(+thumb), y = along(+distal)).
  setLayout(rows, cols, spacingMm, custom = null) {
    const key = custom ? `custom:${custom.id}:${custom.electrodes.length}:${custom.sheetW}x${custom.sheetH}:${custom.electrodes.map((e) => `${e.x},${e.y},${e.w},${e.h},${e.shape}`).join(';')}` : `grid:${rows}x${cols}@${spacingMm}`;
    if (this.layout.key === key) return;
    this.layout = { rows, cols, spacing: spacingMm, key, custom };
    while(this.sheetGroup.children.length){const child=this.sheetGroup.children[0];child.geometry?.dispose();child.material?.map?.dispose();child.material?.dispose();this.sheetGroup.remove(child);}
    this.pads = [];
    // Pad definitions (sheet-relative mm): regular grid or the designed pads
    const padSizeMm = Math.min(4.2, spacingMm * 0.65);
    this.padDefs = custom ? custom.electrodes.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h, shape: e.shape })) : [];
    if (!custom) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) this.padDefs.push({ x: (c - (cols - 1) / 2) * spacingMm, y: (r - (rows - 1) / 2) * spacingMm, w: padSizeMm, h: padSizeMm, shape: 'rect' });
    // Flexible sheet: curved strip following the skin; width = cols*spacing + margin, length = rows*spacing + margin
    const widthMm = custom ? custom.sheetW : cols * spacingMm + 4, lengthMm = custom ? custom.sheetH : rows * spacingMm + 4;
    const segs = Math.min(128,Math.max(24,Math.ceil(widthMm/1.5)));
    const geo = new THREE.PlaneGeometry(lengthMm * MM, widthMm * MM, Math.min(64,Math.max(2,Math.ceil(lengthMm/2))), segs); // x = along, y → mapped to lateral
    const pos = geo.attributes.position;
    // Keep the undeformed local coordinates (along_m, lateralLocal_mm) so re-draping is not cumulative.
    const local = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const along = pos.getX(i), latMm = pos.getY(i) / MM; // local lateral offset (mm) before sheet shift
      local[i * 2] = along; local[i * 2 + 1] = latMm;
      pos.setXYZ(i, along, 0, latMm * MM);
    }
    geo.userData.local = local;
    geo.computeVertexNormals();
    this.sheetMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xfde68a, transparent: true, opacity: 0.45, roughness: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    this.sheetGroup.add(this.sheetMesh);
    this._sheetLocal = { widthMm, lengthMm, segs };

    this.padLabels = [];
    this.padDefs.forEach((d, k) => {
      // Pad geometry: box (w along-x? no: x = lateral → local z, y = along → local x) or a flat cylinder for circles
      const geo = d.shape === 'circle'
        ? new THREE.CylinderGeometry(Math.min(d.w, d.h) / 2 * MM, Math.min(d.w, d.h) / 2 * MM, 0.6 * MM, 32, 1)
        : new THREE.BoxGeometry(d.h * MM, 0.6 * MM, d.w * MM,Math.max(2,Math.ceil(d.h)),1,Math.max(2,Math.ceil(d.w))); // local x = along (h), local z = lateral (w)
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x553300, emissiveIntensity: 0.3, metalness: 0.7, roughness: 0.3 }));
      m.userData = { k };geo.userData.rest=geo.attributes.position.array.slice();
      this.sheetGroup.add(m); this.pads.push(m);
      // Translucent electrode number (1-based) floating just above the pad
      const label = this._makeLabelSprite(String(k + 1));
      const ls = Math.min(d.w, d.h) * 1.8 * MM;
      label.scale.set(ls, ls, 1);
      this.sheetGroup.add(label); this.padLabels.push(label);
    });
    this._layoutSheet();
  }

  // Canvas-textured sprite with a translucent white number; always faces the camera, drawn on top of the pad.
  _makeLabelSprite(text) {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    // Thin, solid (opaque) filled digits with a hairline dark outline for contrast on the bright pad
    ctx.font = '400 40px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(15,23,42,0.9)'; ctx.strokeText(text, 32, 34);
    ctx.fillStyle = '#ffffff'; ctx.fillText(text, 32, 34);
    const tex = new THREE.CanvasTexture(cv); tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const sp = new THREE.Sprite(mat); sp.renderOrder = 10;
    return sp;
  }

  setSheetOffset(lateral_mm, along_mm, silent = true) {
    this.sheet.lateral = lateral_mm; this.sheet.along = along_mm;
    this._layoutSheet();
    if (!silent && this._onSheetMove) this._onSheetMove(lateral_mm, along_mm);
  }

  onSheetAngle(cb){this._onSheetAngle=cb;}
  setSheetAngle(degrees,silent=true){this.sheet.angle=normalizePatchAngle(degrees);this._layoutSheet();if(!silent)this._onSheetAngle?.(this.sheet.angle);}
  _patchPoint(along,lateral,height){
    const q=rotatePatchPoint(lateral,along,this.sheet.angle),a=this.sheet.along+q.along;
    let p=this._models.get('0')?.surfacePoint(this.sheet.lateral,a,q.lateral);
    if(!p){const theta=this.sheet.lateral/this.wristRz+q.lateral/this.wristRz;p={y:this.wristRx*Math.cos(theta),z:this.wristRz*Math.sin(theta),nx:0,ny:Math.cos(theta),nz:Math.sin(theta),dy:0,dz:0};}
    return {base:[(q.along+p.nx*height)*MM,(p.y+p.ny*height)*MM,(p.z+p.nz*height)*MM],field:[0,p.dy*MM,p.dz*MM]};
  }
  // Rest coordinates and unit-pressure displacement are cached on placement
  // changes. A heartbeat only adds a scalar displacement, with no raycasts.
  _layoutSheet() {
    if(!this.sheetMesh)return;
    const map=(geo,point)=>{const p=geo.attributes.position,base=new Float32Array(p.count*3),field=new Float32Array(p.count*3);
      for(let i=0;i<p.count;i++){const q=point(i);base.set(q.base,i*3);field.set(q.field,i*3);p.setXYZ(i,...q.base);}
      geo.userData.wrap={base,field};p.needsUpdate=true;geo.computeVertexNormals();geo.computeBoundingSphere();
    };
    const geo=this.sheetMesh.geometry,local=geo.userData.local;
    map(geo,i=>this._patchPoint(local[i*2]*1000,local[i*2+1],.25));
    this.sheetGroup.position.x=alongToX(this.sheet.along);
    (this.padDefs||[]).forEach((d,k)=>{const pad=this.pads[k];if(!pad)return;
      const g=pad.geometry,r=g.userData.rest;
      map(g,i=>this._patchPoint(d.y+r[i*3]*1000,d.x+r[i*3+2]*1000,.85+r[i*3+1]*1000));
      pad.position.set(0,0,0);pad.rotation.set(0,0,0);
      const label=this.padLabels?.[k];if(label){label.userData.wrap=this._patchPoint(d.y,d.x,1.9);label.position.set(...label.userData.wrap.base);}
    });
    this._pulsePatch(this.patchDrive||0);
  }
  _pulsePatch(drive){
    this.patchDrive=drive;
    for(const mesh of [this.sheetMesh,...this.pads]){const g=mesh?.geometry,w=g?.userData.wrap;if(!w)continue;const a=g.attributes.position.array;
      for(let i=0;i<a.length;i++)a[i]=w.base[i]+w.field[i]*drive;g.attributes.position.needsUpdate=true;mesh.frustumCulled=false;
    }
    for(const label of this.padLabels||[]){const w=label.userData.wrap;if(w)label.position.set(...w.base.map((v,i)=>v+w.field[i]*drive));}
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.tabIndex = 0; // focusable for arrow-key sheet nudging
    this._raycaster = new THREE.Raycaster();
    el.addEventListener('pointerdown', (e) => {
      // Left-click ON the sheet/pads → drag the sheet; left-click elsewhere → orbit.
      // Right button → pan the whole view (camera target); Shift-drag → move the sheet.
      const onSheet = this._hitSheet(e);
      this.orbit.mode = e.button === 2 ? 'pan' : e.altKey ? 'axial' : (e.shiftKey || onSheet) ? 'sheet' : isCenterDrag(e.clientX,e.clientY,el.getBoundingClientRect())?'axial':'orbit';
      this.orbit.lastX = e.clientX; this.orbit.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.focus();
    });
    el.addEventListener('pointermove', (e) => {
      if (this.orbit.mode) return;
      el.style.cursor = this._hitSheet(e) ? 'grab' : 'default';
    });
    el.addEventListener('keydown', (e) => {
      if(e.key===','||e.key==='.'){e.preventDefault();this.setSheetAngle((this.sheet.angle||0)+(e.key==='.'?2.5:-2.5),false);return;}
      // ↑ = toward the fingers (distal), ↓ = proximal, → = thumb side, ← = ulnar side
      const step = e.shiftKey ? 2 : 0.5; // mm
      let lat = this.sheet.lateral, along = this.sheet.along;
      if (e.key === 'ArrowUp') along += step; else if (e.key === 'ArrowDown') along -= step;
      else if (e.key === 'ArrowRight') lat += step; else if (e.key === 'ArrowLeft') lat -= step; else return;
      e.preventDefault();
      this._moveSheet(lat, along);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', () => { this.target.set(0.04, 0.005, 0.0); this.orbit.roll=0; }); // double-click: re-centre the view
    el.addEventListener('pointerup', () => { this.orbit.mode = null; });
    el.addEventListener('pointercancel', () => { this.orbit.mode = null; });
    el.addEventListener('pointermove', (e) => {
      if (!this.orbit.mode) return;
      const dx = e.clientX - this.orbit.lastX, dy = e.clientY - this.orbit.lastY;
      this.orbit.lastX = e.clientX; this.orbit.lastY = e.clientY;
      if(this.orbit.mode==='axial'||this.orbit.mode==='orbit')dragWristOrbit(this.orbit,dx,dy,this.orbit.mode);
      else if (this.orbit.mode === 'pan') {
        // Pan: translate the camera target in the screen plane (camera right/up), scaled with zoom
        const right = new THREE.Vector3(); const up = new THREE.Vector3();
        this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
        const scale = this.orbit.radius * 0.0016; // m per px
        this.target.add(right.multiplyScalar(-dx * scale)).add(up.multiplyScalar(dy * scale));
      } else {
        // Screen-space drag → sheet offsets. Camera-relative mapping: screen-x mostly follows world X
        // (along) when theta≈0; use camera basis to project properly.
        const right = new THREE.Vector3(); const up = new THREE.Vector3();
        this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
        // Move on the tangent plane (X along, Z lateral) by the drag vector expressed in world units.
        const scale = this.orbit.radius * 0.0016; // m per px (tuned)
        const move = right.clone().multiplyScalar(dx * scale).add(up.clone().multiplyScalar(-dy * scale));
        this._moveSheet(this.sheet.lateral + move.z / MM, this.sheet.along + move.x / MM);
      }
    });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.orbit.radius = Math.max(0.05, Math.min(0.5, this.orbit.radius * (1 + e.deltaY * 0.0025))); }, { passive: false });
  }

  // Clamp to the allowed placement range (distal edge ≤ wrist crease, proximal edge within the segment) and apply.
  _moveSheet(lat, along) {
    const half=patchAlongHalf(this._sheetLocal?.widthMm||this.layout.cols*this.layout.spacing+4,this._sheetLocal?.lengthMm||this.layout.rows*this.layout.spacing+4,this.sheet.angle);
    const min = WRIST_ANATOMY.SHEET_ALONG_MIN_MM + half, max = WRIST_ANATOMY.SHEET_ALONG_MAX_MM - half - 1;
    const latC = Math.max(WRIST_ANATOMY.SHEET_LATERAL_MIN_MM, Math.min(WRIST_ANATOMY.SHEET_LATERAL_MAX_MM, lat));
    this.setSheetOffset(latC, Math.max(min, Math.min(max, along)), false);
  }

  // Raycast the pointer against the sheet strip and pads.
  _hitSheet(e) {
    if (!this.sheetMesh) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.camera);
    return this._raycaster.intersectObjects(this.sheetGroup.children.filter((o) => !o.isSprite), false).length > 0;
  }

  // arteryOffset {lateral_mm, depth_mm}; channelNorm Float32Array (0..1 per pad); snrDb number[] (per pad) or null;
  // pulseNorm 0..1 (at the wrist); pulseFn(delay_s) → 0..1 pulse value `delay_s` earlier (for the travelling wave).
  update(arteryOffset, channelNorm, snrDb, pulseNorm = 0, pulseFn = null, tissue = null) {
    const gain=Number(document.getElementById('tissueGain')?.value||1);
    const meter=document.getElementById('tissueReadout');if(meter)meter.textContent=`반경 변화 ${((tissue?.radiusDelta_mm||0)*1000).toFixed(1)} µm · 표면 ${Math.max(0,...(tissue?.displacement_mm||[]).map(Math.abs)).toFixed(4)} mm · 표시 ×${gain}`;
    if(this._handModel==='S'||this._handModel==='T'){
      const w=arteryTether(this.sheet.along).weight,fat=tissue?.fat_mm||2.2,depth=Math.max(1.3,atlasArteryAt(this.sheet.along).depth_mm+(tissue?.arteryDepthShift_mm||0)*w),lateral=(tissue?.arteryLateralShift_mm||0)*w;
      if(this.section&&(Math.abs(this.section.profile.fat-fat)>.05||Math.abs(this.section.profile.arteryDepth-depth)>.05||Math.abs(this.section.profile.arteryX-lateral)>.05)){
        this.section.dispose();this.section=makeWristSection(this.sectionHost,fat,depth,lateral);this.section.focus(this._handModel==='T'?'top':'full');
      }
      this.section?.update({distension:tissue?.radiusDelta_mm||0,respiratory:0,cardiac:0},gain,performance.now()/1000,660,98,false,'reflection');return;
    }
    this._models.get('0')?.update(tissue,gain);
    const geometryKey=`${tissue?.fat_mm}:${Math.round((tissue?.arteryLateralShift_mm||0)*4)}:${Math.round((tissue?.arteryDepthShift_mm||0)*4)}`;
    if(geometryKey!==this._patchGeometryKey){this._patchGeometryKey=geometryKey;this._layoutSheet();}
    this._pulsePatch((tissue?.radiusDelta_mm||0)*gain);

    const lat = WRIST_ANATOMY.ARTERY_BASE_LATERAL_MM + arteryOffset.lateral_mm;
    const depth0 = WRIST_ANATOMY.ARTERY_BASE_DEPTH_MM + (arteryOffset.depth_mm - 1.0);
    // Rebuild the artery path only on a meaningful shift (idle pronation jitter moves it by ~0.1 mm/frame;
    // rebuilding geometry every frame would be wasteful).
    if (Math.abs(lat - this.arteryLateral) > 0.3 || Math.abs(depth0 - this.arteryDepth) > 0.3) this._rebuildArtery(lat, depth0);

    // Travelling pulse: the bulge enters from the proximal (torso) end, runs distally and fades
    // toward the hand. Propagation is slowed for visibility (real local PTT over 11 cm is ~15 ms).
    const T = this._arteryTube;
    if (T) {
      const TRAVEL_S = 0.28; // visual transit time across the shown segment
      if (!this._ring || this._ring.length !== T.N + 1) this._ring = new Float32Array(T.N + 1);
      const ring = this._ring;
      let maxP = 0;
      for (let i = 0; i <= T.N; i++) {
        const f = i / T.N; // 0 = proximal, 1 = distal
        const p = pulseFn ? pulseFn(f * TRAVEL_S) : pulseNorm;
        const taper = 1 - 0.8 * f; // fades toward the hand
        ring[i] = Math.max(0, Math.min(1, p)) * taper;
        if (ring[i] > maxP) maxP = ring[i];
      }
      this._inflateArtery(ring);
      this.arteryMat.emissiveIntensity = 0.5 + 1.4 * maxP;
    }

    for (let k = 0; k < this.pads.length; k++) {
      const pad = this.pads[k];
      const v = channelNorm && channelNorm.length > k ? channelNorm[k] : 0;
      if (snrDb && snrDb.length > k) {
        const c = snrColor(snrDb[k]);
        pad.material.color.copy(c);
        pad.material.emissive.copy(c).multiplyScalar(0.25 + 0.9 * v);
        pad.material.emissiveIntensity = 1;
      } else {
        pad.material.emissive.setRGB(0.9 * v, 0.45 * v, 0.05);
        pad.material.emissiveIntensity = 0.2 + 1.8 * v;
      }
    }

    this._positionCamera();
    this.renderer.render(this.scene, this.camera);
  }

  resetCamera(){
    Object.assign(this.orbit,{theta:Math.PI+Math.atan(1/Math.cos(.75)),phi:.75,radius:.29,roll:0,mode:null});
    this.target.set(.04,.005,0);this.section?.focus('full');this._positionCamera();
  }

  _positionCamera(){
    const o=this.orbit;
    this.camera.position.set(
      this.target.x+o.radius*Math.sin(o.phi)*Math.sin(o.theta),
      this.target.y+o.radius*Math.cos(o.phi),
      this.target.z+o.radius*Math.sin(o.phi)*Math.cos(o.theta)
    );
    this.camera.up.set(0,1,0);
    rotateCameraAroundAxis(this.camera,this.target,{x:1,y:0,z:0},o.roll||0);
  }

  resize() {
    const w = this.container.clientWidth || 400, h = this.container.clientHeight || 260;
    this.renderer.setSize(w, h, false);this.section?.resize();
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
}
