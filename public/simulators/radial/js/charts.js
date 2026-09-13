function drawArteryPath(ctx,path,X,Y,bounds,dpr){
  ctx.save();ctx.beginPath();ctx.rect(...bounds);ctx.clip();ctx.strokeStyle='rgba(255,255,255,0.95)';ctx.setLineDash([]);ctx.lineWidth=2*dpr;ctx.beginPath();
  path.forEach((p,i)=>{const x=X(p.lateral_mm),y=Y(p.along_mm);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();ctx.restore();
}

// Lightweight canvas oscilloscope + heatmap renderers (no external deps).

export class Scope {
  constructor(canvas, { traces, yMin, yMax, windowSec = 3, unit = '', autoScale = false, sweep = false }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.traces = traces; // [{ name, color }]
    this.yMin = yMin;
    this.yMax = yMax;
    this.windowSec = windowSec;
    this.unit = unit;
    this.autoScale = autoScale;
    // sweep = 환자 모니터식 스캔바 표시: 파형이 옆으로 흐르지 않고, 커서(스캔바)가 좌→우로
    // 지나가며 그 자리의 옛 파형을 새 파형으로 덮어쓴다(2026-08-25 사용자 요청).
    // true = 전 트레이스, 배열 = 트레이스별 지정(예: SpO₂ 카드는 진값만 스캔바, 추세는 그대로).
    this.sweep = sweep;
  }

  _fit() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { w, h, dpr };
  }

  // windows: array of Float32Array (one per trace), same ordering as this.traces.
  draw(windows, tEnd = null, dtSample = null) {
    const { w, h, dpr } = this._fit();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    let yMin = this.yMin, yMax = this.yMax;
    if (this.autoScale) {
      let lo = Infinity, hi = -Infinity;
      for (const win of windows) for (let i = 0; i < win.length; i++) { const v = win[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (isFinite(lo) && isFinite(hi)) {
        const pad = (hi - lo) * 0.12 || 1;
        yMin = lo - pad; yMax = hi + pad;
      }
    }
    const span = yMax - yMin || 1;

    // grid
    ctx.strokeStyle = 'rgba(148,163,184,0.12)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = (h * g) / 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // traces (decimate to ~2px per sample step)
    // 스캔바 모드: 샘플의 절대 시각을 창 길이로 나눈 나머지로 x 를 정한다 → 파형은 제자리에 머물고
    // 커서만 이동한다. 커서 바로 앞(가장 오래된 구간)은 비워 두어 "지우며 지나가는" 모습을 만든다.
    const sweepAny = Array.isArray(this.sweep) ? this.sweep.some(Boolean) : !!this.sweep;
    const useSweep = sweepAny && Number.isFinite(tEnd) && windows.length && windows[0].length > 1;
    const sweepFor = (ti) => useSweep && (Array.isArray(this.sweep) ? !!this.sweep[ti] : true);
    const T = this.windowSec;
    const xCur = useSweep ? ((((tEnd % T) + T) % T) / T) * w : 0;
    const gapW = Math.max(3 * dpr, w * 0.02);
    windows.forEach((win, ti) => {
      if (!win.length) return;
      const tr = this.traces[ti];
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      const stride = Math.max(1, Math.floor(win.length / (w / 1.5)));
      if (sweepFor(ti)) {
        // dt 는 **실제 샘플 간격**을 쓴다. 배열 길이에서 유도하면 시작 직후 짧은 배열이 창 전체로
        // 늘어났다가 데이터가 차면서 줄어드는 "줌아웃" 현상이 생긴다(2026-08-25 사용자 보고).
        const L = win.length, dt = Number.isFinite(dtSample) && dtSample > 0 ? dtSample : T / (L - 1);
        let prevX = -1, pen = false;
        for (let i = 0; i < L; i += stride) {
          const tAbs = tEnd - (L - 1 - i) * dt;
          const x = ((((tAbs % T) + T) % T) / T) * w;
          // 시작 전 구간(링버퍼의 0 패딩)은 그리지 않는다 — 초기에는 가로로 늘려 채우지 않고
          // 빈 화면을 스캔바가 지나가며 채운다(2026-08-25 사용자 요청).
          if (tAbs < 0) { pen = false; prevX = x; continue; }
          const ahead = ((x - xCur) + w) % w; // 커서 앞쪽 거리
          if (ahead < gapW) { pen = false; prevX = x; continue; } // 지우개 구간
          const y = h - ((win[i] - yMin) / span) * h;
          if (!pen || x < prevX) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          pen = true; prevX = x;
        }
      } else {
        for (let i = 0, px = 0; i < win.length; i += stride, px++) {
          const x = (i / (win.length - 1)) * w;
          const y = h - ((win[i] - yMin) / span) * h;
          if (px === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });
    if (useSweep) { // 스캔바
      ctx.fillStyle = 'rgba(226,232,240,0.55)';
      ctx.fillRect(xCur, 0, Math.max(1, 1.5 * dpr), h);
    }

    // labels
    ctx.fillStyle = 'rgba(226,232,240,0.85)';
    ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
    ctx.fillText(`${yMax.toFixed(1)} ${this.unit}`, 6 * dpr, 13 * dpr);
    ctx.fillText(`${yMin.toFixed(1)} ${this.unit}`, 6 * dpr, h - 6 * dpr);
    let lx = w - 8 * dpr;
    for (let i = this.traces.length - 1; i >= 0; i--) {
      const tr = this.traces[i];
      const tw = ctx.measureText(tr.name).width;
      lx -= tw + 18 * dpr;
      ctx.fillStyle = tr.color;
      ctx.fillRect(lx, 6 * dpr, 10 * dpr, 10 * dpr);
      ctx.fillStyle = 'rgba(226,232,240,0.9)';
      ctx.fillText(tr.name, lx + 14 * dpr, 15 * dpr);
    }
  }
}

// Multi-channel capacitive view: left third = tiny per-electrode traces laid out like the
// physical grid (coloured by SNR); right two thirds = MRC-combined (beamformed) trace overlaid
// with the reference (true radial pulse) and the oracle/reference beamformer.
export class MultiChannelScope {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); }

  _fit() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr)), h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    return { w, h, dpr };
  }

  _snrColor(db) {
    const t = Math.max(0, Math.min(1, (db + 5) / 20));
    const r = t < 0.5 ? 242 : Math.round(242 - 408 * (t - 0.5));
    const g = t < 0.5 ? Math.round(64 + 330 * t) : 217;
    return `rgb(${r},${g},64)`;
  }

  _polyline(ctx, arr, x0, y0, w, h, lo, hi, color, lw, dpr) {
    if (!arr || !arr.length) return;
    const span = hi - lo || 1;
    ctx.strokeStyle = color; ctx.lineWidth = lw * dpr; ctx.beginPath();
    const stride = Math.max(1, Math.floor(arr.length / (w / 1.2)));
    for (let i = 0, k = 0; i < arr.length; i += stride, k++) {
      const x = x0 + (i / (arr.length - 1)) * w;
      const y = y0 + h - ((arr[i] - lo) / span) * h;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 스캔바(sweep) 폴리라인: 샘플의 절대 시각을 창 길이 T 로 나눈 나머지로 x 를 정한다 →
  // 파형은 제자리에 있고 커서만 좌→우로 이동하며 옛 파형을 덮어쓴다(2026-08-25 사용자 요청).
  // 시뮬 시작 전 구간(링버퍼 0 패딩)과 커서 바로 앞 구간은 그리지 않는다.
  _polylineSweep(ctx, arr, x0, y0, w, h, lo, hi, color, lw, dpr, tEnd, T, dtSample = null) {
    if (!arr || arr.length < 2) return;
    const span = hi - lo || 1, L = arr.length;
    const dt = Number.isFinite(dtSample) && dtSample > 0 ? dtSample : T / (L - 1); // 실제 샘플 간격 우선(초기 줌아웃 방지)
    const xCur = ((((tEnd % T) + T) % T) / T) * w;
    const gapW = Math.max(2 * dpr, w * 0.02);
    ctx.strokeStyle = color; ctx.lineWidth = lw * dpr; ctx.beginPath();
    const stride = Math.max(1, Math.floor(L / (w / 1.2)));
    let prevX = -1, pen = false;
    for (let i = 0; i < L; i += stride) {
      const tAbs = tEnd - (L - 1 - i) * dt;
      const x = ((((tAbs % T) + T) % T) / T) * w;
      if (tAbs < 0 || ((x - xCur) + w) % w < gapW) { pen = false; prevX = x; continue; }
      const y = y0 + h - ((arr[i] - lo) / span) * h;
      if (!pen || x < prevX) ctx.moveTo(x0 + x, y); else ctx.lineTo(x0 + x, y);
      pen = true; prevX = x;
    }
    ctx.stroke();
  }

  _scanBar(ctx, x0, y0, w, h, dpr, tEnd, T) {
    const x = ((((tEnd % T) + T) % T) / T) * w;
    ctx.fillStyle = 'rgba(226,232,240,0.5)';
    ctx.fillRect(x0 + x, y0, Math.max(1, 1.5 * dpr), h);
  }

  draw({ rows, cols, channels, snrDb, weights, combined, oracle, ref, combinedGain, oracleGain, bestIdx, metrics, rowDelayText = null, infoLines = null, infoTo = null, tEnd = null, windowSec = 3, dtSample = null }) {
    const { w, h, dpr } = this._fit();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Layout (of this sub-card's 8/12 share): channel strips 2 | combined waveform 4 | info list 2
    // 채널 스트립과 정보 패널은 **고정 폭**(CSS px 기준)이다 — 이렇게 해야 남는 가운데 "메인 파형"
    // 영역의 폭이 오른쪽 PPG 캔버스와 정확히 같아진다(2026-08-25 사용자 요청; CSS 쪽에서 이 서브에
    // STRIP+INFO+간격 = 342 px 를 더 주고 나머지를 1:1 로 나눈다 — `.sensors .subrow.r53`).
    // 카드가 좁아지면 비율 상한으로 물러선다(모바일 단일 컬럼 등).
    const gap = 8 * dpr;
    const leftW = Math.min(Math.round(150 * dpr), Math.floor(w * 0.30));
    // infoTo(DOM 컨테이너)가 주어지면 캔버스 안 정보 패널을 그리지 않고 HTML 로 내보낸다
    // — 파형이 그만큼 넓어지고 숫자가 잘리지 않는다(2026-08-25 사용자 요청).
    const infoW = infoTo ? 0 : Math.min(Math.round(176 * dpr), Math.floor(w * 0.32));
    const font = (px) => `${px * dpr}px ui-monospace, Menlo, monospace`;

    // ---- Left: all channels as low, wide strips stacked top→bottom (r0c0, r0c1, … row-major) ----
    if (channels && channels.length) {
      const n = channels.length;
      const top = 14 * dpr, labelW = 34 * dpr;
      const stripH = (h - top - 2 * dpr) / n;
      ctx.fillStyle = 'rgba(226,232,240,0.7)'; ctx.font = font(9.5);
      ctx.fillText(`${n}ch  #번호 · SNR(dB, 진값 대비) · 색=SNR`, 4 * dpr, 10 * dpr);
      for (let k = 0; k < n; k++) {
        const arr = channels[k]; if (!arr) continue;
        const y0 = top + k * stripH, sh = Math.max(2 * dpr, stripH - 1.5 * dpr);
        const x0 = labelW, sw = leftW - labelW - gap;
        ctx.fillStyle = k === bestIdx ? 'rgba(251,191,36,0.14)' : (k % 2 ? 'rgba(148,163,184,0.05)' : 'rgba(148,163,184,0.09)');
        ctx.fillRect(x0, y0, sw, sh);
        let lo = Infinity, hi = -Infinity; for (let i = 0; i < arr.length; i++) { if (arr[i] < lo) lo = arr[i]; if (arr[i] > hi) hi = arr[i]; }
        const pad = (hi - lo) * 0.12 || 0.05;
        const color = snrDb ? this._snrColor(snrDb[k]) : '#fbbf24';
        const lwS = stripH > 8 * dpr ? 1.1 : 0.8;
        if (Number.isFinite(tEnd)) this._polylineSweep(ctx, arr, x0 + 1 * dpr, y0 + 1 * dpr, sw - 2 * dpr, sh - 2 * dpr, lo - pad, hi + pad, color, lwS, dpr, tEnd, windowSec, dtSample);
        else this._polyline(ctx, arr, x0 + 1 * dpr, y0 + 1 * dpr, sw - 2 * dpr, sh - 2 * dpr, lo - pad, hi + pad, color, lwS, dpr);
        if (stripH >= 7 * dpr) {
          const r = cols ? Math.floor(k / cols) : 0, c = cols ? k % cols : k;
          ctx.fillStyle = 'rgba(203,213,225,0.85)'; ctx.font = font(Math.min(9, Math.max(6.5, stripH / dpr * 0.6)));
          ctx.fillText(`#${k + 1}${snrDb ? ` ${snrDb[k].toFixed(0)}` : ''}`, 2 * dpr, y0 + sh * 0.5 + 3 * dpr);
        }
      }
    }

    // ---- Divider ----
    ctx.fillStyle = 'rgba(148,163,184,0.25)'; ctx.fillRect(leftW, 0, 1, h);

    // ---- Middle: combined vs reference (no overlays inside the plot) ----
    const rx = leftW + gap, rw = w - rx - infoW - gap, ry = 8 * dpr, rh = h - ry - 6 * dpr;
    ctx.strokeStyle = 'rgba(148,163,184,0.12)'; ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) { const y = ry + (rh * g) / 4; ctx.beginPath(); ctx.moveTo(rx, y); ctx.lineTo(rx + rw, y); ctx.stroke(); }
    if (combined && ref) {
      // Normalize: scale the reference by the fitted gain so amplitudes are comparable
      const refScaled = new Float32Array(ref.length); for (let i = 0; i < ref.length; i++) refScaled[i] = ref[i] * (combinedGain || 1);
      let lo = Infinity, hi = -Infinity;
      for (const a of [combined, refScaled, oracle]) { if (!a) continue; for (let i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; } }
      const pad = (hi - lo) * 0.12 || 0.05; lo -= pad; hi += pad;
      // Ideal (true) radial pulse: thick translucent pink underneath; MRC: thin yellow on top.
      // When the beamformer is good the yellow rides exactly on the pink band.
      if (Number.isFinite(tEnd)) {
        this._polylineSweep(ctx, refScaled, rx, ry, rw, rh, lo, hi, 'rgba(244,114,182,0.6)', 4.0, dpr, tEnd, windowSec, dtSample);
        this._polylineSweep(ctx, combined, rx, ry, rw, rh, lo, hi, '#fbbf24', 1.4, dpr, tEnd, windowSec, dtSample);
      } else {
        this._polyline(ctx, refScaled, rx, ry, rw, rh, lo, hi, 'rgba(244,114,182,0.6)', 4.0, dpr);
        this._polyline(ctx, combined, rx, ry, rw, rh, lo, hi, '#fbbf24', 1.4, dpr);
      }
      if (Number.isFinite(tEnd)) this._scanBar(ctx, rx, ry, rw, rh, dpr, tEnd, windowSec);
    }
    // ---- Right: info list (legend + metrics) ----
    const ix = rx + rw + gap, iw = w - ix - 4 * dpr;
    if (!infoTo) { ctx.fillStyle = 'rgba(148,163,184,0.25)'; ctx.fillRect(ix - gap / 2, 0, 1, h); }
    const lines = [];
    lines.push({ swatch: '#fbbf24', text: 'MRC 빔포밍 결합' });
    lines.push({ swatch: 'rgba(244,114,182,0.8)', text: '시뮬레이터 진값 요골동맥 맥파' });
    if (metrics) {
      lines.push({ text: `MRC SNR ${metrics.mrcSnr_db.toFixed(1)} dB (진값 대비)` });
      lines.push({ text: `best ch #${(metrics.bestIdx ?? 0) + 1} ${metrics.bestSnr_db.toFixed(1)} dB` });
      lines.push({ text: `ρ(MRC, ideal) ${metrics.corrMrc.toFixed(3)}` });
    }
    if (infoLines) for (const t of infoLines) lines.push({ text: t });
    else if (rowDelayText) for (const t of rowDelayText.split(' · ')) lines.push({ text: t });
    if (infoTo) {
      // HTML 로 렌더 — 옵션 오른쪽 넓은 공간에 배치되며, 값이 길어져도 잘리지 않는다.
      const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const html = lines.map((l) => (l.swatch
        ? `<span class="ci lg"><i style="background:${l.swatch}"></i>${esc(l.text)}</span>`
        : `<span class="ci">${esc(l.text)}</span>`)).join('');
      if (infoTo.__html !== html) { infoTo.innerHTML = html; infoTo.__html = html; }
    } else {
    const lh = Math.max(12, Math.min(17, (h - 8 * dpr) / Math.max(1, lines.length) / dpr)) * dpr; // fit all lines
    let fs = Math.min(12.5, lh / dpr * 0.8); ctx.font = font(12.5);
    // shrink font until the longest line fits the column
    const longest = Math.max(...lines.map((l) => ctx.measureText(l.text).width + (l.swatch ? 16 * dpr : 0)));
    while (longest * (fs / 12.5) > iw - 4 * dpr && fs > 8) { fs -= 0.5; }
    ctx.font = font(fs);
    let y = 6 * dpr + lh * 0.8;
    ctx.save(); ctx.beginPath(); ctx.rect(ix, 0, iw, h); ctx.clip();
    for (const l of lines) {
      let x = ix + 2 * dpr;
      if (l.swatch) { ctx.fillStyle = l.swatch; ctx.fillRect(x, y - fs * dpr * 0.8, 10 * dpr, 10 * dpr); x += 15 * dpr; }
      ctx.fillStyle = 'rgba(226,232,240,0.92)'; ctx.fillText(l.text, x, y);
      y += lh;
    }
    ctx.restore();
    }
  }
}

// Per-electrode pulse-arrival timing map: each cell shows the measured delay (ms) of that electrode's
// pulse relative to the most proximal row, with the model truth underneath; colour = measured delay.
export class TimingGrid {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); }
  draw({ rows, cols, measured, model, pwv, spacingMm, capFs, arteryLateral_mm = 0, arteryPath = null, estLateral_mm = null, custom = null }) {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr)), h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const ctx = this.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
    const font = (px) => `${px * dpr}px ui-monospace, Menlo, monospace`;
    const top = 16 * dpr, bottom = 16 * dpr;
    ctx.fillStyle = 'rgba(226,232,240,0.8)'; ctx.font = font(10);
    ctx.fillText(`셀: 추정 Δt(위) / m=모델 진값 Δt(아래) · 색 = 지연`, 4 * dpr, 11 * dpr);
    if (custom) return this._drawCustom(ctx, w, h, dpr, top, bottom, font, { measured, model, pwv, capFs, arteryLateral_mm, arteryPath, estLateral_mm, custom });
    if (!rows || !cols) return;
    // Same physical layout as the heatmap: square cells at the electrode pitch, centred
    const cell = Math.min(w / cols, (h - top - bottom) / rows);
    const gx = (w - cell * cols) / 2, gy = top + ((h - top - bottom) - cell * rows) / 2;
    const maxModel = Math.max(0.1, ...(model || [0]));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const mv = measured && measured[k] != null && isFinite(measured[k]) ? measured[k] : null;
      const md = model ? model[k] : 0;
      // Same orientation as the wrist view / heatmap: proximal row 0 (#1…) at the bottom, distal at the top
      const x0 = gx + c * cell + 2 * dpr, y0 = gy + (rows - 1 - r) * cell + 2 * dpr, cwi = cell - 4 * dpr, chi = cell - 4 * dpr;
      const t = Math.max(0, Math.min(1, (mv ?? md) / (maxModel * 1.3 || 1)));
      ctx.fillStyle = `rgba(${Math.round(56 + 180 * t)},${Math.round(189 - 120 * t)},${Math.round(248 - 200 * t)},0.85)`;
      ctx.fillRect(x0, y0, cwi, chi);
      // Text centred in the cell; font scales with the cell (so 1×1 … 8×6 arrays all stay legible)
      const cellPx = chi / dpr; // CSS px
      const fMain = Math.max(8, Math.min(26, cellPx * 0.2));   // measured Δt
      const fSub = Math.max(7, Math.min(16, cellPx * 0.12));   // model Δt
      const fNum = Math.max(7, Math.min(14, cellPx * 0.11));   // electrode number
      const cx = x0 + cwi / 2;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(11,16,32,0.8)'; ctx.font = font(fNum);
      ctx.fillText(`#${k + 1}`, cx, y0 + fNum * dpr + 3 * dpr);
      ctx.fillStyle = '#0b1020'; ctx.font = font(fMain);
      const t1 = mv != null ? `${mv >= 0 ? '+' : ''}${mv.toFixed(2)} ms` : '– ms';
      ctx.fillText(t1, cx, y0 + chi * 0.55);
      ctx.fillStyle = 'rgba(11,16,32,0.85)'; ctx.font = font(fSub);
      ctx.fillText(`모델 ${md.toFixed(2)}`, cx, y0 + chi * 0.55 + (fMain * 0.75 + 4) * dpr);
      ctx.textAlign = 'left';
    }
    // Same overlays as the heatmap so the two panels read as one physical layout
    const centerCol = (cols - 1) / 2 + arteryLateral_mm / spacingMm;
    const ax = gx + (centerCol + 0.5) * cell;
    if(arteryPath)drawArteryPath(ctx,arteryPath,x=>gx+cell*cols/2+x/spacingMm*cell,y=>gy+cell*rows/2-y/spacingMm*cell,[gx,gy,cell*cols,cell*rows],dpr);
    else if (ax >= gx - cell && ax <= gx + cell * (cols + 1)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(ax, gy - 3 * dpr); ctx.lineTo(ax, gy + cell * rows + 3 * dpr); ctx.stroke(); ctx.setLineDash([]);
    }
    if (estLateral_mm != null) {
      const ex = gx + ((cols - 1) / 2 + estLateral_mm / spacingMm + 0.5) * cell;
      ctx.strokeStyle = 'rgba(251,191,36,0.95)'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(ex, gy - 3 * dpr); ctx.lineTo(ex, gy + cell * rows + 3 * dpr); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = font(9.5);
    ctx.fillText('distal', 4 * dpr, gy + 9 * dpr);
    ctx.fillText('proximal (#1)', 4 * dpr, gy + cell * rows - 3 * dpr);
    ctx.fillStyle = 'rgba(148,163,184,0.9)'; ctx.font = font(9.5);
    ctx.fillText(`행 간격 ${spacingMm} mm · 모델 국소 PWV ${pwv.toFixed(1)} m/s → 행당 ${(spacingMm / 1000 / pwv * 1000).toFixed(2)} ms · 샘플 주기 ${(1000 / capFs).toFixed(2)} ms`, 4 * dpr, h - 5 * dpr);
  }

  // Custom (designed) layout: pads drawn at their true positions on the sheet, distal at the top.
  _drawCustom(ctx, w, h, dpr, top, bottom, font, { measured, model, pwv, capFs, arteryLateral_mm, arteryPath, estLateral_mm, custom }) {
    const { sheetW, sheetH, electrodes } = custom;
    const s = Math.min(w / sheetW, (h - top - bottom) / sheetH); // px per mm
    const gx = (w - sheetW * s) / 2, gy = top + ((h - top - bottom) - sheetH * s) / 2;
    const X = (mm) => gx + (mm + sheetW / 2) * s, Y = (mm) => gy + (sheetH / 2 - mm) * s;
    ctx.strokeStyle = 'rgba(253,230,138,0.5)'; ctx.lineWidth = 1 * dpr; ctx.strokeRect(gx, gy, sheetW * s, sheetH * s);
    const maxModel = Math.max(0.1, ...(model || [0]));
    electrodes.forEach((e, k) => {
      const mv = measured && measured[k] != null && isFinite(measured[k]) ? measured[k] : null;
      const md = model ? model[k] : 0;
      const t = Math.max(0, Math.min(1, (mv ?? md) / (maxModel * 1.3 || 1)));
      ctx.fillStyle = `rgba(${Math.round(56 + 180 * t)},${Math.round(189 - 120 * t)},${Math.round(248 - 200 * t)},0.9)`;
      const x0 = X(e.x - e.w / 2), y0 = Y(e.y + e.h / 2), pw = e.w * s, ph = e.h * s;
      ctx.beginPath();
      if (e.shape === 'circle') ctx.ellipse(x0 + pw / 2, y0 + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
      else if (e.shape === 'round' && ctx.roundRect) ctx.roundRect(x0, y0, pw, ph, Math.min(pw, ph) * 0.3);
      else ctx.rect(x0, y0, pw, ph);
      ctx.fill();
      const fMain = Math.max(7, Math.min(18, Math.min(pw, ph) / dpr * 0.28)), fNum = Math.max(6, fMain * 0.6);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(11,16,32,0.85)'; ctx.font = font(fNum); ctx.fillText(`#${k + 1}`, x0 + pw / 2, y0 + fNum * dpr + 1 * dpr);
      ctx.fillStyle = '#0b1020'; ctx.font = font(fMain); ctx.fillText(mv != null ? `${mv >= 0 ? '+' : ''}${mv.toFixed(2)}` : '–', x0 + pw / 2, y0 + ph * 0.62);
      if (ph / dpr > 26) { ctx.fillStyle = 'rgba(11,16,32,0.85)'; ctx.font = font(Math.max(6, fMain * 0.6)); ctx.fillText(`m ${md.toFixed(2)}`, x0 + pw / 2, y0 + ph * 0.62 + fMain * 0.75 * dpr); }
      ctx.textAlign = 'left';
    });
    const ax = X(arteryLateral_mm);
    if(arteryPath)drawArteryPath(ctx,arteryPath,X,Y,[gx,gy,sheetW*s,sheetH*s],dpr);
    else if (ax >= gx - 10 * dpr && ax <= gx + sheetW * s + 10 * dpr) { ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.moveTo(ax, gy - 3 * dpr); ctx.lineTo(ax, gy + sheetH * s + 3 * dpr); ctx.stroke(); ctx.setLineDash([]); }
    if (estLateral_mm != null) { const ex = X(estLateral_mm); ctx.strokeStyle = 'rgba(251,191,36,0.95)'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(ex, gy - 3 * dpr); ctx.lineTo(ex, gy + sheetH * s + 3 * dpr); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = font(9.5);
    ctx.fillText('distal', 4 * dpr, gy + 9 * dpr);
    ctx.fillText('proximal (#1)', 4 * dpr, gy + sheetH * s - 3 * dpr);
    ctx.fillStyle = 'rgba(148,163,184,0.9)';
    ctx.fillText(`사용자 레이아웃 ${electrodes.length}전극 · 시트 ${sheetW}×${sheetH} mm · 모델 국소 PWV ${pwv.toFixed(1)} m/s · 샘플 주기 ${(1000 / capFs).toFixed(2)} ms`, 4 * dpr, h - 5 * dpr);
  }
}

// Filled contour (등고선) map of the electrode grid: bilinear upsampling between electrode
// centres, colour bands per level and iso-lines via marching squares. Same orientation and
// numbering as the heatmap (proximal row #1 at the bottom, thumb side on the right).
export class ContourMap {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); }

  _colormap(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [[30, 41, 99], [56, 189, 248], [250, 204, 21], [239, 68, 68]];
    const s = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), f = s - i;
    const a = stops[i], b = stops[i + 1];
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
  }

  draw(grid, { arteryLateral_mm = 0, arteryPath = null, spacingMm = 6, estLateral_mm = null, levels = 9, vMin = null, vMax = null, custom = null } = {}) {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr)), h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const ctx = this.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!grid || !grid.length) return;
    const rows = grid.length, cols = grid[0].length;
    let lo = vMin, hi = vMax;
    if (lo == null || hi == null) { lo = Infinity; hi = -Infinity; for (const r of grid) for (const v of r) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    const span = hi - lo || 1;

    // Physical layout: square cells at the electrode pitch, centred
    // Same inner margins as the Δt table (16 px top/bottom for labels) so both grids are the same
    // size and vertically aligned side by side.
    const top = 16 * dpr, bottom = 16 * dpr;
    const cell = Math.min(w / cols, (h - top - bottom) / rows);
    const gx = (w - cell * cols) / 2, gy = top + ((h - top - bottom) - cell * rows) / 2;
    // Field between electrode centres, upsampled (bilinear); extrapolated by half a cell at the borders
    const UP = 10;
    const W = cols * UP, H = rows * UP;
    const field = new Float32Array(W * H);
    const at = (r, c) => grid[Math.max(0, Math.min(rows - 1, r))][Math.max(0, Math.min(cols - 1, c))];
    for (let j = 0; j < H; j++) {
      const fr = (j + 0.5) / UP - 0.5; // fractional row index (0 at centre of row 0)
      const r0 = Math.floor(fr), t = fr - r0;
      for (let i = 0; i < W; i++) {
        const fc = (i + 0.5) / UP - 0.5;
        const c0 = Math.floor(fc), u = fc - c0;
        const v = (1 - t) * ((1 - u) * at(r0, c0) + u * at(r0, c0 + 1)) + t * ((1 - u) * at(r0 + 1, c0) + u * at(r0 + 1, c0 + 1));
        field[j * W + i] = Math.max(0, Math.min(1, (v - lo) / span));
      }
    }
    // Colour bands (quantised to `levels`)
    const px = cell / UP;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const q = Math.floor(field[j * W + i] * levels) / levels;
      ctx.fillStyle = this._colormap(q + 0.5 / levels);
      const x = gx + i * px, y = gy + (H - 1 - j) * px; // row 0 at the bottom
      ctx.fillRect(x, y, px + 0.6, px + 0.6);
    }
    // Iso-lines (marching squares) at level boundaries
    ctx.strokeStyle = 'rgba(15,23,42,0.75)'; ctx.lineWidth = 1 * dpr; ctx.beginPath();
    const X = (i) => gx + (i + 0.5) * px, Y = (j) => gy + (H - 1 - j + 0.5) * px;
    for (let L = 1; L < levels; L++) {
      const iso = L / levels;
      for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
        const a = field[j * W + i], b = field[j * W + i + 1], c = field[(j + 1) * W + i + 1], d = field[(j + 1) * W + i];
        const idx = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const lerp = (p, q) => (iso - p) / ((q - p) || 1e-9);
        const top = [X(i) + lerp(a, b) * px, Y(j)], right = [X(i + 1), Y(j) - lerp(b, c) * px], bottom = [X(i) + lerp(d, c) * px, Y(j + 1)], left = [X(i), Y(j) - lerp(a, d) * px];
        const seg = (p, q) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
        switch (idx) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 10: seg(top, right); seg(left, bottom); break;
        }
      }
    }
    ctx.stroke();
    // Electrode centres + numbers, artery lines, labels
    const font = (p) => `${p * dpr}px ui-monospace, Menlo, monospace`;
    if (custom) drawCustomPads(ctx, custom, gx, gy, cell / spacingMm, dpr, font, (t) => this._colormap(t), (v) => Math.max(0, Math.min(1, (v - lo) / span)));
    else for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cx = gx + (c + 0.5) * cell, cy = gy + (rows - 1 - r + 0.5) * cell;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(cx, cy, 2.2 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(11,16,32,0.85)'; ctx.font = font(Math.min(10, Math.max(7, cell / dpr * 0.2)));
      ctx.fillText(`#${r * cols + c + 1}`, cx + 4 * dpr, cy - 4 * dpr);
    }
    const centerCol = (cols - 1) / 2 + arteryLateral_mm / spacingMm, ax = gx + (centerCol + 0.5) * cell;
    if(arteryPath)drawArteryPath(ctx,arteryPath,x=>gx+cell*cols/2+x/spacingMm*cell,y=>gy+cell*rows/2-y/spacingMm*cell,[gx,gy,cell*cols,cell*rows],dpr);
    else if (ax >= gx - cell && ax <= gx + cell * (cols + 1)) { ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.moveTo(ax, gy - 4 * dpr); ctx.lineTo(ax, gy + cell * rows + 4 * dpr); ctx.stroke(); ctx.setLineDash([]); }
    if (estLateral_mm != null) { const ex = gx + ((cols - 1) / 2 + estLateral_mm / spacingMm + 0.5) * cell; ctx.strokeStyle = 'rgba(251,191,36,0.95)'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(ex, gy - 4 * dpr); ctx.lineTo(ex, gy + cell * rows + 4 * dpr); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = font(10);
    ctx.fillText('distal (손가락)', 4 * dpr, 11 * dpr);
    ctx.fillText('proximal (#1 행)', 4 * dpr, h - 4 * dpr);
    ctx.fillStyle = 'rgba(203,213,225,0.8)';
    const tag = custom ? `등고선 ${levels}단계 · 사용자 레이아웃 ${custom.electrodes.length}전극 (IDW 보간)` : `등고선 ${levels}단계 · ${cols}×${rows} @ ${spacingMm} mm`;
    ctx.fillText(tag, w - 4 * dpr - ctx.measureText(tag).width, h - 4 * dpr);
  }
}

// Outline + number of each designed pad on top of a dense (interpolated) field. pxPerMm = cell/cellMm;
// the field's origin (gx, gy) is the sheet's proximal-ulnar... no: top-left = (−sheetW/2, +sheetH/2).
// When `custom.values` + `colorOf(norm)` are given the pads are FILLED with their own value colour (same
// reading as the regular-grid cells: one colour per electrode); the interpolated field behind them is
// only context.
function drawCustomPads(ctx, custom, gx, gy, pxPerMm, dpr, font, colorOf = null, norm = null) {
  const { sheetW, sheetH, electrodes, values } = custom;
  const X = (mm) => gx + (mm + sheetW / 2) * pxPerMm, Y = (mm) => gy + (sheetH / 2 - mm) * pxPerMm;
  electrodes.forEach((e, k) => {
    const x0 = X(e.x - e.w / 2), y0 = Y(e.y + e.h / 2), pw = e.w * pxPerMm, ph = e.h * pxPerMm;
    ctx.beginPath();
    if (e.shape === 'circle') ctx.ellipse(x0 + pw / 2, y0 + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
    else if (e.shape === 'round' && ctx.roundRect) ctx.roundRect(x0, y0, pw, ph, Math.min(pw, ph) * 0.3);
    else ctx.rect(x0, y0, pw, ph);
    if (values && colorOf && norm && values[k] != null) { ctx.fillStyle = colorOf(norm(values[k])); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
    ctx.fillStyle = 'rgba(11,16,32,0.85)'; ctx.font = font(Math.max(6, Math.min(10, Math.min(pw, ph) / dpr * 0.3)));
    ctx.textAlign = 'center'; ctx.fillText(`#${k + 1}`, x0 + pw / 2, y0 + ph / 2 + 3 * dpr); ctx.textAlign = 'left';
  });
}

export class Heatmap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  // grid: number[rows][cols]; arteryLateralMm + spacing for overlay of estimated artery line.
  draw(grid, { arteryLateral_mm = 0, arteryPath = null, spacingMm = 6, vMin, vMax, estLateral_mm = null, custom = null } = {}) {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    if (!grid || !grid.length) return;

    const rows = grid.length, cols = grid[0].length;
    let lo = vMin ?? Infinity, hi = vMax ?? -Infinity;
    if (vMin == null || vMax == null) {
      for (const r of grid) for (const v of r) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    const span = hi - lo || 1;
    // Cells laid out to the physical electrode pitch (square cells, grid centred in the canvas)
    // Same inner margins as the Δt table (16 px top/bottom for labels) so both grids are the same
    // size and vertically aligned side by side.
    const top = 16 * dpr, bottom = 16 * dpr;
    const cell = Math.min(w / cols, (h - top - bottom) / rows);
    const gx = (w - cell * cols) / 2, gy = top + ((h - top - bottom) - cell * rows) / 2;

    // Orientation matches the wrist 3D view: distal (fingers) at the TOP, proximal row 0 (#1…) at the BOTTOM,
    // thumb-side column on the right.
    for (let r = 0; r < rows; r++) {
      const yr = rows - 1 - r;
      for (let c = 0; c < cols; c++) {
        const n = Math.max(0, Math.min(1, (grid[r][c] - lo) / span));
        ctx.fillStyle = this._colormap(n);
        if (custom) { ctx.globalAlpha = 0.45; ctx.fillRect(gx + c * cell, gy + yr * cell, Math.ceil(cell) + 0.5, Math.ceil(cell) + 0.5); ctx.globalAlpha = 1; continue; }
        ctx.fillRect(gx + c * cell + 1, gy + yr * cell + 1, Math.ceil(cell) - 2, Math.ceil(cell) - 2);
        // Electrode number (#k, k = r·cols + c) — same numbering as the channels / Δt table / wrist pads
        ctx.fillStyle = 'rgba(11,16,32,0.8)'; ctx.font = `${Math.min(10, Math.max(7, cell / dpr * 0.2)) * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(`#${r * cols + c + 1}`, gx + c * cell + 4 * dpr, gy + yr * cell + 10 * dpr);
      }
    }
    if (custom) drawCustomPads(ctx, custom, gx, gy, cell / spacingMm, dpr, (p) => `${p * dpr}px ui-monospace, Menlo, monospace`, (t) => this._colormap(t), (v) => Math.max(0, Math.min(1, (v - lo) / span)));

    // Estimated artery center overlay
    const centerCol = (cols - 1) / 2 + arteryLateral_mm / spacingMm;
    const x = gx + (centerCol + 0.5) * cell;
    if(arteryPath)drawArteryPath(ctx,arteryPath,x=>gx+cell*cols/2+x/spacingMm*cell,y=>gy+cell*rows/2-y/spacingMm*cell,[gx,gy,cell*cols,cell*rows],dpr);
    else if (x >= gx - cell && x <= gx + cell * (cols + 1)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(x, gy - 4 * dpr); ctx.lineTo(x, gy + cell * rows + 4 * dpr); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Beam-search artery estimate (yellow solid)
    if (estLateral_mm != null) {
      const ex = gx + ((cols - 1) / 2 + estLateral_mm / spacingMm + 0.5) * cell;
      ctx.strokeStyle = 'rgba(251,191,36,0.95)'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(ex, gy - 4 * dpr); ctx.lineTo(ex, gy + cell * rows + 4 * dpr); ctx.stroke();
      ctx.fillStyle = 'rgba(251,191,36,0.95)'; ctx.font = `${9 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText('x̂', ex + 3 * dpr, gy + 10 * dpr);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
    ctx.fillText('distal (손가락)', 4 * dpr, 11 * dpr);
    ctx.fillText('proximal (#1 행)', 4 * dpr, h - 4 * dpr);
    ctx.fillStyle = 'rgba(203,213,225,0.8)';
    { const tag = custom ? `사용자 레이아웃 ${custom.electrodes.length}전극 · ${custom.sheetW}×${custom.sheetH} mm (IDW 보간)` : `${cols}×${rows} @ ${spacingMm} mm`; ctx.fillText(tag, w - 4 * dpr - ctx.measureText(tag).width, h - 4 * dpr); }
    // Pulse propagation direction marker (proximal → distal = bottom → top) in the left margin
    if (gx > 14 * dpr) {
      const ax = gx - 8 * dpr, y1 = gy + cell * rows - 6 * dpr, y2 = gy + 6 * dpr;
      ctx.strokeStyle = 'rgba(251,191,36,0.9)'; ctx.fillStyle = 'rgba(251,191,36,0.9)'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(ax, y1); ctx.lineTo(ax, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax, y2 - 2 * dpr); ctx.lineTo(ax - 4 * dpr, y2 + 6 * dpr); ctx.lineTo(ax + 4 * dpr, y2 + 6 * dpr); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.translate(ax - 5 * dpr, (y1 + y2) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
      ctx.font = `${9 * dpr}px ui-monospace, Menlo, monospace`; ctx.fillText('맥파 진행 방향', 0, 0); ctx.restore();
    }
  }

  _colormap(t) {
    // blue -> cyan -> yellow -> red
    t = Math.max(0, Math.min(1, t));
    const stops = [[30, 41, 99], [56, 189, 248], [250, 204, 21], [239, 68, 68]];
    const s = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(s));
    const f = s - i;
    const a = stops[i], b = stops[i + 1];
    const r = Math.round(a[0] + (b[0] - a[0]) * f);
    const g = Math.round(a[1] + (b[1] - a[1]) * f);
    const bl = Math.round(a[2] + (b[2] - a[2]) * f);
    return `rgb(${r},${g},${bl})`;
  }
}
