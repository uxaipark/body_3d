// Multi-channel combining and SNR analysis for the capacitive array.
//
// analyze(channels, ref, oracleGains) operates on decimated, equal-length windows:
//   channels: Float32Array[]  per-electrode ΔC traces
//   ref:      Float32Array    true (simulator) radial arterial pulse, same length
//   oracleGains: number[]     true geometric coupling per channel (optional; "reference beamformer")
//
// Returns per-channel gain/SNR (fit x_i ≈ g_i·ref + n_i against the known truth), the
// blind MRC combiner (weights from a data-driven template, no access to `ref`), the
// oracle/reference combiner (weights ∝ true coupling), best single channel, and SNRs in dB.

function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }

function demean(a) { const m = mean(a); const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - m; return o; }

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

function varOf(a) { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - m; s += d * d; } return a.length ? s / a.length : 0; }

function db(x) { return 10 * Math.log10(Math.max(1e-12, x)); }

// Least-squares gain of x onto template u (both demeaned): g = <x,u>/<u,u>; residual variance.
function fitGain(x, u, uu) {
  const g = uu > 0 ? dot(x, u) / uu : 0;
  let res = 0;
  for (let i = 0; i < x.length; i++) { const e = x[i] - g * u[i]; res += e * e; }
  return { g, resVar: res / Math.max(1, x.length) };
}

// ---------------------------------------------------------------------------------------------
// Artery localisation by beam search (blind — uses only the channel data and electrode geometry).
// For each candidate lateral position x (fine grid across the sheet, beyond the outer columns by
// one pitch) a Gaussian-aperture steering vector w_k(x) = exp(−½((lat_k − x)/σ)²) is applied to the
// channels; the score is the pulsatile power of the beam output normalised by Σw² (so wider
// apertures are not trivially favoured). The peak — refined by parabolic interpolation — is the
// artery estimate x̂ with sub-electrode resolution. Returns the profile, x̂ and the two electrode
// columns it lies between.
//   channels: Float32Array[] (any common rate), positions: [{k, lateral_mm, along_mm, r, c}]
export function beamSearch(channels, positions, { spacingMm = 6, sigmaMm = null, stepMm = 0.25 } = {}) {
  const n = channels.length;
  if (!n || !positions || positions.length !== n) return null;
  const X = channels.map(demean);
  const lats = positions.map((p) => p.lateral_mm);
  const lo = Math.min(...lats) - spacingMm, hi = Math.max(...lats) + spacingMm;
  const sigma = sigmaMm ?? spacingMm * 0.8;
  const L = X[0].length;
  const profile = [];
  const y = new Float32Array(L);
  for (let x = lo; x <= hi + 1e-9; x += stepMm) {
    const w = new Float32Array(n); let ww = 0;
    for (let k = 0; k < n; k++) { const d = (lats[k] - x) / sigma; w[k] = Math.exp(-0.5 * d * d); ww += w[k] * w[k]; }
    y.fill(0);
    for (let k = 0; k < n; k++) { const wk = w[k]; if (wk < 1e-3) continue; const xk = X[k]; for (let s = 0; s < L; s++) y[s] += wk * xk[s]; }
    const score = ww > 0 ? varOf(y) / ww : 0;
    profile.push({ x, score });
  }
  let bi = 0; for (let i = 1; i < profile.length; i++) if (profile[i].score > profile[bi].score) bi = i;
  let xHat = profile[bi].x;
  if (bi > 0 && bi < profile.length - 1) {
    const ym = profile[bi - 1].score, y0 = profile[bi].score, yp = profile[bi + 1].score, den = ym - 2 * y0 + yp;
    if (Math.abs(den) > 1e-12) xHat += 0.5 * (ym - yp) / den * stepMm;
  }
  // Which two columns is it between? (use first row's column lateral positions)
  const colLats = [...new Set(positions.map((p) => p.lateral_mm))].sort((a, b) => a - b);
  let left = null, right = null;
  for (let i = 0; i < colLats.length; i++) { if (colLats[i] <= xHat) left = i; if (colLats[i] >= xHat && right == null) right = i; }
  const steer = (x) => { const w = new Float32Array(n); let s = 0; for (let k = 0; k < n; k++) { const d = (lats[k] - x) / sigma; w[k] = Math.exp(-0.5 * d * d); s += w[k]; } if (s > 0) for (let k = 0; k < n; k++) w[k] /= s; return w; };
  return { profile, xHat, betweenCols: [left, right], colLats, sigma, steer };
}

// Steered beam for one electrode row: Gaussian weights around x̂ applied to that row's channels only.
export function rowBeam(channels, positions, row, xHat, sigma) {
  const idx = positions.filter((p) => p.r === row);
  if (!idx.length) return null;
  const L = channels[0].length, y = new Float32Array(L); let ws = 0;
  for (const p of idx) { const d = (p.lateral_mm - xHat) / sigma; const w = Math.exp(-0.5 * d * d); ws += w; const xk = channels[p.k]; for (let s = 0; s < L; s++) y[s] += w * xk[s]; }
  if (ws > 0) for (let s = 0; s < L; s++) y[s] /= ws;
  return y;
}

// `seed` (optional) = blind-MRC template seed from the core's seed-lock hysteresis (⑤); null = the
// pre-⑤ behaviour, i.e. the highest-variance channel.
export function analyze(channels, ref, oracleGains = null, seed = null) {
  const n = channels.length;
  const L = ref.length;
  if (!n || !L) return null;

  const X = channels.map(demean);
  const R = demean(ref);
  const RR = dot(R, R);
  const refVar = RR / L;

  // --- True per-channel SNR (simulator has the ground truth) ---
  const trueGain = new Float32Array(n), trueSnr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const { g, resVar } = fitGain(X[i], R, RR);
    trueGain[i] = g;
    trueSnr[i] = resVar > 0 ? (g * g * refVar) / resVar : 1e6;
  }

  // --- Blind MRC: template = highest-variance channel, iterate ---
  // PARITY FIX (2026-08-26, audit §6.23): this loop ran TWO iterations and dropped the zero-residual
  // channel (the seed compared against itself), while the Rust core — the operational one since
  // 2026-08-23, of which this file is the legacy parity mirror (README) — runs THREE and substitutes
  // the smallest non-zero residual instead. On the old, near-degenerate array (every channel the same
  // waveform with a positive gain) the two fixed points agreed inside the parity tolerances; with
  // §6.23's signed kernel the array carries near-zero-amplitude channels at the kernel's zero crossing
  // whose fitted gain is poorly determined, and the two implementations then diverged past the `amp`
  // and `pttWF` hard limits. The JS mirror is aligned TO the Rust authority (iteration count and the
  // min-residual substitution), so the SHIPPED algorithm is unchanged and the two are genuinely the
  // same computation rather than merely close on an easy signal.
  let tIdx = 0, tVar = -1;
  for (let i = 0; i < n; i++) { const v = varOf(X[i]); if (v > tVar) { tVar = v; tIdx = i; } }
  if (seed != null && seed >= 0 && seed < n && varOf(X[seed]) > 0) tIdx = seed;
  let template = X[tIdx];
  let w = new Float32Array(n);
  let combined = new Float32Array(L);
  for (let iter = 0; iter < 3; iter++) {
    const TT = dot(template, template);
    let wsum = 0;
    const fits = [];
    for (let i = 0; i < n; i++) fits.push(fitGain(X[i], template, TT));
    let minRes = Infinity;
    for (const f of fits) if (f.resVar > 1e-12 && f.resVar < minRes) minRes = f.resVar;
    for (let i = 0; i < n; i++) {
      const g = fits[i].g;
      const resVar = fits[i].resVar <= 1e-12 ? (isFinite(minRes) ? minRes : 1) : fits[i].resVar;
      // MRC: weight ∝ gain / noise variance (coherent gain over estimated noise power)
      // BUGFIX (2026-08-26, audit §6.23): this used to be `Math.max(0, wi) // keep in-phase channels only`.
      // Maximal-ratio combining is defined as w_i ∝ g_i*/σ_i² and g_i CAN BE NEGATIVE — an anti-phase
      // channel must be weighted negatively so its energy ADDS instead of being discarded. Clamping to 0
      // threw that channel away. The clamp was defensible only while the forward model could not produce
      // an inverted channel (so a negative gain could only be noise); §6.23's volume-conserving coupling
      // kernel breaks that premise — pads outside the kernel's zero crossing are genuinely inverted.
      // The signed form is self-regulating: a noise-only channel has small |g| and large resVar, hence
      // a small |w|. This is a correctness fix, not a tuning choice.
      w[i] = resVar > 0 ? g / resVar : 0;
      wsum += Math.abs(w[i]); // normalise by Σ|w|: Σw would collapse toward 0 (or flip sign) once the
                              // weights carry a sign, which would blow up or invert the combined output.
    }
    if (wsum > 0) for (let i = 0; i < n; i++) w[i] /= wsum;
    combined.fill(0);
    for (let i = 0; i < n; i++) { const wi = w[i]; if (!wi) continue; const xi = X[i]; for (let s = 0; s < L; s++) combined[s] += wi * xi[s]; }
    template = combined;
  }

  // --- Oracle / reference beamformer: weights ∝ true coupling (normalized) ---
  let oracle = null;
  if (oracleGains && oracleGains.length === n) {
    oracle = new Float32Array(L);
    // §6.23: oracleCouplings() is now SIGNED (the depression annulus), so the normaliser must be Σ|g|.
    // With Σg the sum could pass through zero and send the oracle beam to infinity or flip its sign.
    let s = 0; for (const g of oracleGains) s += Math.abs(g);
    for (let i = 0; i < n; i++) { const wi = s > 0 ? oracleGains[i] / s : 0; const xi = X[i]; for (let k = 0; k < L; k++) oracle[k] += wi * xi[k]; }
  }

  // --- SNRs of combined outputs, against truth ---
  const fitC = fitGain(combined, R, RR);
  const mrcSnr = fitC.resVar > 0 ? (fitC.g * fitC.g * refVar) / fitC.resVar : 1e6;
  const fitO = oracle ? fitGain(oracle, R, RR) : null;
  const oracleSnr = fitO ? (fitO.resVar > 0 ? (fitO.g * fitO.g * refVar) / fitO.resVar : 1e6) : null;

  let bestIdx = 0; for (let i = 1; i < n; i++) if (trueSnr[i] > trueSnr[bestIdx]) bestIdx = i;
  const corr = (a, b) => { const ab = dot(a, b), aa = dot(a, a), bb = dot(b, b); return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0; };

  return {
    n, L,
    trueSnr_db: Array.from(trueSnr, db), trueGain: Array.from(trueGain),
    weights: Array.from(w),
    combined, oracle, refDemeaned: R, channelsDemeaned: X,
    combinedGain: fitC.g, oracleGain: fitO ? fitO.g : 0,
    mrcSnr_db: db(mrcSnr), oracleSnr_db: oracleSnr != null ? db(oracleSnr) : null,
    bestIdx, bestSnr_db: db(trueSnr[bestIdx]),
    corrMrc: corr(combined, R), corrBest: corr(X[bestIdx], R),
  };
}
