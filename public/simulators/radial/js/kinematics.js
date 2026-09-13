// Posture / kinematics model: single source of truth for joint angles AND whole-body
// (torso) motion, shared by the 3D avatar renderer and the physiology engine
// (EMG, IMU, artery displacement) so animation and signals stay consistent.
//
// Body postures: standing, sitting, walking (gait-driven, no idle sliders),
// lying/supine (arm at side, no torso sway).
//
// Two independent idle-motion sources (standing / sitting; arm-only when lying):
//   1. armIdle  — small joint-angle jitter/drift of the instrumented arm
//   2. bodyIdle — whole-torso postural sway (AP/ML), breathing lift, small tilt
// The wrist IMU sees the vector combination of both (see imu.js).

import {WALK_STRIDE_SECONDS} from './gaitTiming.js';

function noise2(seed, t) {
  // Smooth deterministic pseudo-noise via summed incommensurate sines (cheap Perlin-ish).
  return (
    Math.sin(t * 0.9 + seed * 12.9) * 0.5 +
    Math.sin(t * 2.3 + seed * 4.7) * 0.3 +
    Math.sin(t * 5.1 + seed * 1.3) * 0.2
  );
}

export const BODY_POSTURES = {
  standing: { label: '서있는 자세', armSelectable: true, armIdle: true, bodyIdle: true },
  sitting: { label: '앉아있는 자세', armSelectable: true, armIdle: true, bodyIdle: true },
  walking: { label: '걷는 자세', armSelectable: false, armIdle: false, bodyIdle: false },
  lying: { label: '누운 자세 (앙와위)', armSelectable: false, armIdle: true, bodyIdle: false },
};

export const ARM_POSITIONS = {
  // shoulderAbd = forward flexion of upper arm from hanging (deg); elbowFlex = elbow bend (deg).
  // Chosen so the avatar's hand lands at the intended height relative to the heart.
  heart_level: { label: '심장 높이 (커프 자세)', shoulderAbd: 30, elbowFlex: 95, wristPron: 0, wristFlex: 0 },
  // 책상 높이(아바타 상판 0.74 m)에 팔뚝이 실제로 얹히도록 낮춘 값(2026-08-26 사용자 요청).
  // 이전 20/85는 손목이 상판보다 20 cm 위에 떠 있었다 — 앉은 자세에서 어깨가 1.17 m 이므로
  // 0.32·cos(어깨) + 0.27·cos(어깨+팔꿈치) = 0.38 을 만족해야 손목이 상판+팔뚝반지름에 닿는다.
  table_height: { label: '테이블 높이', shoulderAbd: 12, elbowFlex: 64, wristPron: 15, wristFlex: 5 },
  down: { label: '아래로 내림', shoulderAbd: 5, elbowFlex: 8, wristPron: 30, wristFlex: 0 },
  raised: { label: '심장보다 위로 거상', shoulderAbd: 95, elbowFlex: 20, wristPron: -10, wristFlex: -5 },
};

// Segment mass (kg) and length (m) used for simple pendulum-torque EMG estimation.
export const SEGMENT_INERTIA = {
  upperArm: { mass: 2.1, length: 0.30 },
  forearmHand: { mass: 1.7, length: 0.45 },
};

// Link lengths for the wrist forward kinematics (model assumptions, adult ~1.75 m):
//   upper arm (glenohumeral joint → elbow) 0.30 m, forearm (elbow → wrist / sensor) 0.26 m
//   (SEGMENT_INERTIA.forearmHand 0.45 m includes the hand and is only used for torque),
//   shoulder joint centre ≈ 0.11 m above the heart (mid-sternum / 4th intercostal level).
// With these the posture presets land at: heart_level 0 cm, table_height +24.6, down +44,
// raised −25 cm.
// table_height 주의: 팔뚝이 책상 상판에 실제로 닿도록 각도를 낮추면(2026-08-26) 정수압 오프셋이
// 이전 +10.5 cm 에서 +24.6 cm 로 커진다 — 아바타의 앉은 자세 심장 높이 1.04 m 와 상판 0.74 m 의
// 차이가 그만큼이기 때문이고, 실제로도 "책상에 팔을 얹은 좌위"는 심장보다 20~30 cm 아래다
// (커프 혈압의 대표적 자세 오차원). 이전 값은 팔이 공중에 떠 있던 상태의 수치였다.
export const ARM_GEOMETRY = { upperArm_m: 0.30, forearmToWrist_m: 0.26, shoulderAboveHeart_m: 0.11 };

// The acquisition and avatar clocks use the whole-body twin's captured stride.
export const GAIT = { cadence_Hz: 2 / WALK_STRIDE_SECONDS, stride_Hz: 1 / WALK_STRIDE_SECONDS, armSwing_deg: 22, hipSwing_deg: 25, kneeFlex_deg: 40 };

// Torso sway components: amplitude (m or deg) at full intensity, frequency (Hz), phase.
// Standing quiet-stance sway is typically a few mm at 0.2–1 Hz; breathing ~0.25 Hz.
const SWAY_AP = [ { A: 0.006, f: 0.32, ph: 0.4 }, { A: 0.0025, f: 0.81, ph: 2.1 }, { A: 0.001, f: 1.7, ph: 0.9 } ]; // z (forward/back)
const SWAY_ML = [ { A: 0.004, f: 0.27, ph: 1.3 }, { A: 0.0018, f: 0.66, ph: 0.2 }, { A: 0.0008, f: 1.4, ph: 2.7 } ]; // x (left/right)
const BREATH_V = [ { A: 0.003, f: 0.25, ph: 0 } ]; // y (vertical lift)
const TILT_PITCH = [ { A: 0.8, f: 0.32, ph: 0.4 }, { A: 0.3, f: 0.81, ph: 2.1 } ]; // deg about X (forward/back lean)
const TILT_ROLL = [ { A: 0.6, f: 0.27, ph: 1.3 }, { A: 0.25, f: 0.66, ph: 0.2 } ]; // deg about Z (side lean)

// Walking: trunk oscillation at cadence (ML, roll) and 2× cadence (vertical bob, AP, pitch).
// Amplitudes chosen so wrist acceleration lands in the ~0.3–0.5 g range typical of walking.
const f1 = GAIT.stride_Hz, f2 = GAIT.cadence_Hz; // stride-rate (ML sway, roll, arm swing) vs step-rate (bob, AP, pitch)
const WALK_ML = [ { A: 0.020, f: f1, ph: 0 } ];
const WALK_V = [ { A: 0.008, f: f2, ph: Math.PI / 2 } ];
const WALK_AP = [ { A: 0.006, f: f2, ph: 0 } ];
const WALK_PITCH = [ { A: 1.5, f: f2, ph: 0 } ];
const WALK_ROLL = [ { A: 2.0, f: f1, ph: 0 } ];

function sumSin(comps, t, scale) {
  let v = 0; for (const c of comps) v += c.A * scale * Math.sin(2 * Math.PI * c.f * t + c.ph); return v;
}
function sumSinD1(comps, t, scale) {
  let v = 0; for (const c of comps) { const w = 2 * Math.PI * c.f; v += c.A * scale * w * Math.cos(w * t + c.ph); } return v;
}
function sumSinD2(comps, t, scale) {
  let v = 0; for (const c of comps) { const w = 2 * Math.PI * c.f; v += -c.A * scale * w * w * Math.sin(w * t + c.ph); } return v;
}

export class PostureController {
  constructor() {
    this.bodyPosture = 'standing';
    this.armPosition = 'heart_level';
    this.armIdleIntensity = 0.4; // 0..1 — arm joint micro-motion
    this.bodyIdleIntensity = 0.4; // 0..1 — whole-torso sway / breathing / tilt
    this.t = 0;

    this.angles = { shoulderAbd: 30, elbowFlex: 95, wristPron: 0, wristFlex: 0 };
    this.angularVel = { shoulderAbd: 0, elbowFlex: 0, wristPron: 0, wristFlex: 0 };
    this._prevAngles = { ...this.angles };
    this._target = { ...this.angles };

    this.torso = {
      pos: [0, 0, 0], vel: [0, 0, 0], acc: [0, 0, 0], // m, m/s, m/s² (world frame, x=ML, y=vertical, z=AP)
      basePitch_deg: 0, // structural orientation: 0 upright, -90 supine
      tiltPitch_deg: 0, tiltRoll_deg: 0, // micro-motion about X, about Z
      angVel_degPerS: [0, 0, 0], // about X, Y, Z
      gaitPhase: 0, walking: false, // 0..1 within one stride cycle
    };
  }

  setBodyPosture(name) {
    if (!BODY_POSTURES[name]) return;
    this.bodyPosture = name;
    if (name === 'walking') {
      const p = ARM_POSITIONS.down; // arm along the side
      this._target = { shoulderAbd: p.shoulderAbd, elbowFlex: p.elbowFlex, wristPron: p.wristPron, wristFlex: p.wristFlex };
    } else if (name === 'lying') {
      // Supine: arm rests on the mattress beside the body → slight shoulder extension
      // (negative flexion) so the hand drops to the bed, palm up (supinated).
      this._target = { shoulderAbd: -16, elbowFlex: 5, wristPron: -20, wristFlex: 0 };
    } else {
      this.setArmPosition(this.armPosition);
    }
  }

  setArmPosition(name) {
    if (ARM_POSITIONS[name]) {
      this.armPosition = name;
      if (this.bodyPosture === 'walking' || this.bodyPosture === 'lying') return; // arm is posture-driven
      const p = ARM_POSITIONS[name];
      this._target = { shoulderAbd: p.shoulderAbd, elbowFlex: p.elbowFlex, wristPron: p.wristPron, wristFlex: p.wristFlex };
    }
  }

  setArmIdleIntensity(v) { this.armIdleIntensity = Math.max(0, Math.min(1, v)); }
  setBodyIdleIntensity(v) { this.bodyIdleIntensity = Math.max(0, Math.min(1, v)); }
  // Back-compat: sets both.
  setIdleIntensity(v) { this.setArmIdleIntensity(v); this.setBodyIdleIntensity(v); }

  // Advance simulation by dt seconds.
  update(dt) {
    this.t += dt;
    this._prevAngles = { ...this.angles };
    const t = this.t;
    const def = BODY_POSTURES[this.bodyPosture];
    const T = this.torso;

    if (this.bodyPosture === 'walking') {
      // Gait-driven arm swing (contralateral to the leg), applied directly — no smoothing lag.
      const phi = 2 * Math.PI * GAIT.stride_Hz * t;
      T.gaitPhase = (GAIT.stride_Hz * t) % 1;
      T.walking = true;
      const desired = {
        shoulderAbd: 5 + GAIT.armSwing_deg * Math.sin(phi),
        elbowFlex: 15 + 12 * Math.max(0, Math.sin(phi)),
        wristPron: 30,
        wristFlex: 0,
      };
      const smoothing = 1 - Math.exp(-dt * 12.0);
      for (const k of Object.keys(desired)) this.angles[k] += (desired[k] - this.angles[k]) * smoothing;

      T.pos = [sumSin(WALK_ML, t, 1), sumSin(WALK_V, t, 1), sumSin(WALK_AP, t, 1)];
      T.vel = [sumSinD1(WALK_ML, t, 1), sumSinD1(WALK_V, t, 1), sumSinD1(WALK_AP, t, 1)];
      T.acc = [sumSinD2(WALK_ML, t, 1), sumSinD2(WALK_V, t, 1), sumSinD2(WALK_AP, t, 1)];
      T.basePitch_deg = 0;
      T.tiltPitch_deg = 2.0 + sumSin(WALK_PITCH, t, 1); // slight forward lean + bob
      T.tiltRoll_deg = sumSin(WALK_ROLL, t, 1);
      T.angVel_degPerS = [sumSinD1(WALK_PITCH, t, 1), 0, sumSinD1(WALK_ROLL, t, 1)];
    } else {
      T.walking = false;
      T.gaitPhase = 0;
      const smoothing = 1 - Math.exp(-dt * 3.0); // ~critically damped approach to target
      const idleAmp = def.armIdle ? this.armIdleIntensity : 0;
      for (const key of Object.keys(this._target)) {
        const base = this._target[key];
        const micro = idleAmp * (2.2 * noise2(key.length + (key.charCodeAt(0) % 7), t * 0.6) + 0.35 * Math.sin(t * 9.5 + key.charCodeAt(0)));
        this.angles[key] += (base + micro - this.angles[key]) * smoothing;
      }

      if (def.bodyIdle) {
        // Seated sway is much smaller (pelvis supported), breathing unchanged.
        const swayScale = this.bodyIdleIntensity * (this.bodyPosture === 'sitting' ? 0.35 : 1.0);
        const breathScale = this.bodyIdleIntensity;
        T.pos = [sumSin(SWAY_ML, t, swayScale), sumSin(BREATH_V, t, breathScale), sumSin(SWAY_AP, t, swayScale)];
        T.vel = [sumSinD1(SWAY_ML, t, swayScale), sumSinD1(BREATH_V, t, breathScale), sumSinD1(SWAY_AP, t, swayScale)];
        T.acc = [sumSinD2(SWAY_ML, t, swayScale), sumSinD2(BREATH_V, t, breathScale), sumSinD2(SWAY_AP, t, swayScale)];
        T.tiltPitch_deg = sumSin(TILT_PITCH, t, swayScale);
        T.tiltRoll_deg = sumSin(TILT_ROLL, t, swayScale);
        T.angVel_degPerS = [sumSinD1(TILT_PITCH, t, swayScale), 0, sumSinD1(TILT_ROLL, t, swayScale)];
      } else {
        T.pos = [0, 0, 0]; T.vel = [0, 0, 0]; T.acc = [0, 0, 0];
        T.tiltPitch_deg = 0; T.tiltRoll_deg = 0; T.angVel_degPerS = [0, 0, 0];
      }
      T.basePitch_deg = this.bodyPosture === 'lying' ? -90 : 0;
    }

    for (const key of Object.keys(this.angles)) {
      this.angularVel[key] = dt > 0 ? (this.angles[key] - this._prevAngles[key]) / dt : 0;
    }
  }

  getAngles() { return { ...this.angles }; }
  getAngularVelocities() { return { ...this.angularVel }; }
  getTorsoState() {
    const T = this.torso;
    return {
      pos: [...T.pos], vel: [...T.vel], acc: [...T.acc],
      basePitch_deg: T.basePitch_deg, tiltPitch_deg: T.tiltPitch_deg, tiltRoll_deg: T.tiltRoll_deg,
      angVel_degPerS: [...T.angVel_degPerS], gaitPhase: T.gaitPhase, walking: T.walking,
    };
  }

  // Radial artery lateral/depth offset (mm) as a function of forearm pronation and
  // wrist flexion — simplified parametric approximation of how the artery shifts
  // beneath the skin surface with forearm rotation, used by the capacitive array model.
  // Model assumptions (no direct literature values): lateral shift 3.2·sin(pronation) mm; depth
  // 1.0 mm + 0.6·|sin(pronation)| mm; wrist flexion is SIGNED (wristFlex > 0 = palmar flexion):
  // palmar flexion lets the artery sink under the relaxing flexor retinaculum/skin (+0.15 mm per 10°),
  // dorsiflexion (extension) stretches the volar skin over the radius and makes the artery slightly
  // shallower and more fixed (−0.05 mm per 10°), floored at 0.8 mm (audit 2026-08-23 §2.1).
  getArteryOffset_mm() {
    const pron = this.angles.wristPron; // degrees, - supination .. + pronation
    const flex = this.angles.wristFlex; // degrees, + palmar flexion .. - extension (dorsiflexion)
    const lateral_mm = 3.2 * Math.sin((pron * Math.PI) / 180);
    const flexTerm = flex >= 0 ? 0.15 * flex / 10 : -0.05 * Math.abs(flex) / 10;
    const depth_mm = Math.max(0.8, 1.0 + 0.6 * Math.abs(Math.sin((pron * Math.PI) / 180)) + flexTerm);
    return { lateral_mm, depth_mm };
  }

  // Height of the wrist relative to heart (cm, + below heart), from two-link forward kinematics of
  // the current (smoothed) joint angles: shoulder flexion θs from hanging, elbow flexion θe; the
  // forearm continues the rotation (θs + θe from vertical-down), so
  //   drop below shoulder = Lu·cos θs + Lf·cos(θs + θe),  Δh = drop − shoulderAboveHeart.
  // Walking therefore follows the gait arm swing automatically (≈ +31 … +44 cm). Seated posture uses
  // the same arm geometry (no extra offset). Supine is NOT taken from the chain (the torso is pitched
  // −90° and the arm rests on the mattress): fixed +5 cm (mid-chest heart vs bed-level arm; model
  // assumption).
  getWristHeightDelta_cm() {
    if (this.bodyPosture === 'lying') return 5; // supine, arm resting on the bed: slightly below the heart (mid-chest)
    const { upperArm_m: Lu, forearmToWrist_m: Lf, shoulderAboveHeart_m: hs } = ARM_GEOMETRY;
    const ts = (this.angles.shoulderAbd * Math.PI) / 180;
    const te = (this.angles.elbowFlex * Math.PI) / 180;
    const drop_m = Lu * Math.cos(ts) + Lf * Math.cos(ts + te);
    return (drop_m - hs) * 100;
  }
}
