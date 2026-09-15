
import {t as translateUI,html as localizeHTML} from '../../../i18n/locale.js';
// Session data export — CSV / JSONL + a JSON parameter sidecar (ROADMAP §2.3-14).
//
// WHAT IS EXPORTED
//   ① 분석 창 결과 (analysis windows, ~4–8 Hz): one row per AnalysisCore result — t, HR, amp,
//      RI, tRefl, 국소 PWV, x̂, 어레이 BP, PPG BP, 신뢰도, 부착 상태, SpO₂ (+ the simulator's
//      set-point BP as `true_*`, which is a SIMULATION ground truth, not a measurement).
//   ② 원파형 (optional): the capacitive channels + PPG Red/IR + the true radial pulse at the
//      CAPACITANCE sample rate. The engine keeps only 4 s of ring buffer, so raw export needs a
//      rolling capture buffer that is OFF by default (memory) and holds the last N seconds.
//   ③ 사이드카 JSON: every parameter needed to reproduce the run (array geometry/layout, body,
//      cardiac/hemodynamic state, artefacts, PPG optics, calibration, the active scenario
//      definition) + a column dictionary + the limitations that must travel with the numbers.
//
// PARQUET IS OUT OF SCOPE IN-BROWSER. Writing real Parquet (column chunks, dictionary/RLE
// encodings, Thrift footer) needs a multi-hundred-kB dependency; this app ships no external
// libraries. We therefore emit CSV and JSONL — both load in one line of pandas:
//     pd.read_csv('dt_windows_*.csv')            /  pd.read_json('…​.jsonl', lines=True)
//     df.to_parquet('…​.parquet')                # convert offline if Parquet is wanted
//
// DOWNLOAD PATH. Where the browser offers the File System Access API the file is written
// through a WritableStream chunk by chunk (nothing but one chunk is in memory at a time);
// otherwise the chunks are joined into a Blob and downloaded normally.

const nz = (v, d = 3) => (v == null || !isFinite(v) ? '' : (+v).toFixed(d));
const ni = (v) => (v == null || !isFinite(v) ? '' : String(Math.round(v)));
const ns = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

// column dictionary — the SAME list drives the CSV header, the JSONL keys and the sidecar docs
export const WINDOW_COLUMNS = [
  { k: 't_s', u: 's', f: (r) => nz(r.t, 3), d: '시뮬레이션 시각 (엔진 t)' },
  { k: 'scenario', u: '', f: (r) => ns(r.scenario), d: '활성 시나리오 이름 (없으면 빈칸)' },
  { k: 'scenario_t_s', u: 's', f: (r) => nz(r.scenarioT, 2), d: '시나리오 타임라인 시각' },
  { k: 'hr_bpm', u: 'bpm', f: (r) => nz(r.hr, 2), d: '분석 창의 박동 검출 HR (어레이 우선, 없으면 PPG)' },
  { k: 'amp', u: 'a.u.', f: (r) => nz(r.amp, 5), d: 'MRC 결합 파형의 앙상블 박동 진폭 (∝ PP/(tone·stiff))' },
  { k: 'ri', u: '', f: (r) => nz(r.ri, 4), d: '어레이 반사지수 RI' },
  { k: 't_refl_ms', u: 'ms', f: (r) => nz(r.tRefl, 2), d: '어레이 반사파 시각 (foot 기준)' },
  { k: 'pwv_local_m_s', u: 'm/s', f: (r) => nz(r.pwv, 3), d: '어레이 행/클러스터 간 국소 PWV 추정' },
  { k: 'ptt_local_ms', u: 'ms', f: (r) => nz(r.pttLocal, 3), d: '근위–원위 빔 국소 PTT' },
  { k: 'sqi', u: '', f: (r) => nz(r.sqi, 4), d: '창 신호품질 지수 (0–1)' },
  { k: 'xhat_mm', u: 'mm', f: (r) => nz(r.xhat, 3), d: '빔서치 동맥 측방 추정 x̂ (시트 중심 기준)' },
  { k: 'cap_sbp', u: 'mmHg', f: (r) => nz(r.capSbp, 2), d: '정전용량 어레이 단독 추정 SBP' },
  { k: 'cap_dbp', u: 'mmHg', f: (r) => nz(r.capDbp, 2), d: '정전용량 어레이 단독 추정 DBP' },
  { k: 'cap_map', u: 'mmHg', f: (r) => nz(r.capMap, 2), d: '어레이 추정 MAP' },
  { k: 'cap_x', u: '×', f: (r) => nz(r.capX, 4), d: '어레이 추정 긴장도×경직도 (분리 불가)' },
  { k: 'cap_conf', u: '', f: (r) => nz(r.capConf, 4), d: '어레이 추정 신뢰도 0–1' },
  { k: 'cap_clamped', u: '', f: (r) => (r.capClamped ? '1' : '0'), d: '생리 범위 클램프 여부' },
  { k: 'ppg_sbp', u: 'mmHg', f: (r) => nz(r.ppgSbp, 2), d: '검지 PPG 단독 추정 SBP' },
  { k: 'ppg_dbp', u: 'mmHg', f: (r) => nz(r.ppgDbp, 2), d: '검지 PPG 단독 추정 DBP' },
  { k: 'ppg_map', u: 'mmHg', f: (r) => nz(r.ppgMap, 2), d: 'PPG 추정 MAP' },
  { k: 'ppg_x', u: '×', f: (r) => nz(r.ppgX, 4), d: 'PPG 추정 긴장도 지수' },
  { k: 'ppg_conf', u: '', f: (r) => nz(r.ppgConf, 4), d: 'PPG 추정 신뢰도 0–1' },
  { k: 'fusion_sbp', u: 'mmHg', f: (r) => nz(r.fusSbp, 2), d: '융합 추정 SBP (참고용)' },
  { k: 'fusion_dbp', u: 'mmHg', f: (r) => nz(r.fusDbp, 2), d: '융합 추정 DBP (참고용)' },
  { k: 'spo2_pct', u: '%', f: (r) => nz(r.spo2, 2), d: 'R-ratio 재계산 SpO₂ (분석 코어)' },
  { k: 'spo2_model_pct', u: '%', f: (r) => nz(r.spo2Model, 2), d: '시뮬레이터 SpO₂ 진값' },
  { k: 'attach_state', u: '', f: (r) => ns(r.attach), d: '부착 상태 (stable/transient/shifted/detached/uncalibrated)' },
  { k: 'attach_recal', u: '', f: (r) => (r.attachRecal ? '1' : '0'), d: '재캘리브레이션 요구 플래그' },
  { k: 'calibrated', u: '', f: (r) => (r.calibrated ? '1' : '0'), d: '커프 캘리브레이션 적용 여부' },
  { k: 'true_sbp', u: 'mmHg', f: (r) => nz(r.trueSbp, 1), d: '⚠ 시뮬레이터 설정 중심 SBP (모델 진값 — 실측 아님; 실측 기록 재생 중에는 빈칸)' },
  { k: 'true_dbp', u: 'mmHg', f: (r) => nz(r.trueDbp, 1), d: '⚠ 시뮬레이터 설정 중심 DBP (동일)' },
  { k: 'true_hr', u: 'bpm', f: (r) => nz(r.trueHr, 1), d: '⚠ 시뮬레이터 설정 HR' },
  { k: 'hydrostatic_mmHg', u: 'mmHg', f: (r) => nz(r.hydro, 2), d: '손목 정수압 오프셋' },
  { k: 'posture', u: '', f: (r) => ns(r.posture), d: '신체 자세' },
  { k: 'arm', u: '', f: (r) => ns(r.arm), d: '팔 위치' },
  { k: 'contact', u: '', f: (r) => nz(r.contact, 3), d: '접촉 압력 (0–1)' },
  { k: 'tone', u: '×', f: (r) => nz(r.tone, 3), d: '설정 혈관 긴장도' },
  { k: 'stiff', u: '×', f: (r) => nz(r.stiff, 3), d: '설정 혈관 경직도' },
  { k: 'n_ch', u: '', f: (r) => ni(r.nCh), d: '활성 전극 채널 수' },
  { k: 'cap_fs_hz', u: 'Hz', f: (r) => ni(r.capFs), d: '정전용량 샘플링' },
];

export class ExportBuffer {
  constructor({ maxWindows = 40000, rawSeconds = 60 } = {}) {
    this.maxWindows = maxWindows; this.rawSeconds = rawSeconds;
    this.windows = [];
    this.raw = [];          // [{ t0, fs, nCh, n, ch: Float32Array(nCh*n), red, ir, ref }]
    this.rawOn = false;
    this.rawBytes = 0;
    this.dropped = 0;
  }
  pushWindow(row) {
    this.windows.push(row);
    if (this.windows.length > this.maxWindows) { this.windows.shift(); this.dropped++; }
  }
  setRaw(on) { this.rawOn = !!on; if (!on) this.clearRaw(); }
  clearRaw() { this.raw.length = 0; this.rawBytes = 0; }
  clear() { this.windows.length = 0; this.dropped = 0; this.clearRaw(); }
  /**
   * Decimate one engine frame (16 kHz, channel-major) down to the capacitance rate and keep it.
   * `startTotal` = engine.totalSamples BEFORE the frame, used to stay on the global cap grid
   * (the capacitive front-end converts when totalSamples % capDecim === 0, ZOH in between).
   */
  pushRaw(fr, startTotal, capDecim, masterFs) {
    if (!this.rawOn || !fr || !fr.n) return;
    const d = Math.max(1, capDecim | 0);
    const first = (d - (startTotal % d)) % d;
    const m = first < fr.n ? Math.floor((fr.n - 1 - first) / d) + 1 : 0;
    if (!m) return;
    const nCh = fr.nCh | 0;
    const ch = new Float32Array(nCh * m);
    for (let c = 0; c < nCh; c++) { const off = c * fr.n; for (let j = 0; j < m; j++) ch[c * m + j] = fr.cap[off + first + j * d]; }
    const pick = (src) => { if (!src) return null; const o = new Float32Array(m); for (let j = 0; j < m; j++) o[j] = src[first + j * d]; return o; };
    const chunk = { t0: fr.t0 + first / masterFs, fs: masterFs / d, nCh, n: m, ch, red: pick(fr.red), ir: pick(fr.ir), ref: pick(fr.ref) };
    this.raw.push(chunk);
    this.rawBytes += ch.byteLength + 3 * m * 4;
    // rolling window: drop the oldest chunks beyond rawSeconds
    while (this.raw.length > 1) {
      const span = (this.raw[this.raw.length - 1].t0 + this.raw[this.raw.length - 1].n / this.raw[this.raw.length - 1].fs) - this.raw[0].t0;
      if (span <= this.rawSeconds) break;
      const c0 = this.raw.shift();
      this.rawBytes -= c0.ch.byteLength + 3 * c0.n * 4;
    }
  }
  stats() {
    const w = this.windows;
    const rawN = this.raw.reduce((a, c) => a + c.n, 0);
    const rawSpan = this.raw.length ? (this.raw[this.raw.length - 1].t0 + this.raw[this.raw.length - 1].n / this.raw[this.raw.length - 1].fs) - this.raw[0].t0 : 0;
    return {
      windows: w.length, dropped: this.dropped,
      span_s: w.length ? w[w.length - 1].t - w[0].t : 0,
      rawOn: this.rawOn, rawSamples: rawN, rawSpan_s: rawSpan, rawBytes: this.rawBytes,
      rawCh: this.raw.length ? this.raw[this.raw.length - 1].nCh : 0,
      csvBytes: Math.round(w.length * 230), rawCsvBytes: Math.round(rawN * ((this.raw.length ? this.raw[this.raw.length - 1].nCh : 0) + 4) * 9),
    };
  }
}

// ---- writers (generators → one chunk per ~256 rows, so nothing large is ever built at once)
export function* windowsCsv(buf) {
  yield '# Radial Artery Digital Twin — 분석 창 결과 (시뮬레이션 값, 임상 측정 아님)\n';
  yield `# generated=${new Date().toISOString()} rows=${buf.windows.length}\n`;
  yield WINDOW_COLUMNS.map((c) => c.k).join(',') + '\n';
  let out = [];
  for (const r of buf.windows) {
    out.push(WINDOW_COLUMNS.map((c) => c.f(r)).join(','));
    if (out.length >= 256) { yield out.join('\n') + '\n'; out = []; }
  }
  if (out.length) yield out.join('\n') + '\n';
}
export function* windowsJsonl(buf) {
  let out = [];
  for (const r of buf.windows) {
    const o = {};
    for (const c of WINDOW_COLUMNS) { const s = c.f(r); o[c.k] = s === '' ? null : (/^-?\d+(\.\d+)?$/.test(s) ? +s : s); }
    out.push(JSON.stringify(o));
    if (out.length >= 256) { yield out.join('\n') + '\n'; out = []; }
  }
  if (out.length) yield out.join('\n') + '\n';
}
export function* rawCsv(buf) {
  const nCh = buf.raw.length ? buf.raw[buf.raw.length - 1].nCh : 0;
  yield '# Radial Artery Digital Twin — 원파형 (정전용량 샘플링 레이트, 시뮬레이션 값)\n';
  yield `# ch* = 전극 정전용량 [pF] · ppg_red/ppg_ir = 무차원 a.u. · radial_p_mmHg = 시뮬레이터 진값 요골 동맥압\n`;
  yield ['t_s', ...Array.from({ length: nCh }, (_, i) => `ch${i + 1}_pF`), 'ppg_red', 'ppg_ir', 'radial_p_mmHg'].join(',') + '\n';
  let out = [];
  for (const c of buf.raw) {
    for (let j = 0; j < c.n; j++) {
      const row = [(c.t0 + j / c.fs).toFixed(5)];
      for (let k = 0; k < c.nCh; k++) row.push(c.ch[k * c.n + j].toFixed(5));
      for (let k = c.nCh; k < nCh; k++) row.push('');
      row.push(c.red ? c.red[j].toFixed(6) : '', c.ir ? c.ir[j].toFixed(6) : '', c.ref ? c.ref[j].toFixed(3) : '');
      out.push(row.join(','));
      if (out.length >= 256) { yield out.join('\n') + '\n'; out = []; }
    }
  }
  if (out.length) yield out.join('\n') + '\n';
}
export function sidecarJson(buf, meta) {
  const s = buf.stats();
  return JSON.stringify({
    format: 'radial-artery-digital-twin/export', version: 1,
    generated: new Date().toISOString(),
    disclaimer: '이 파일의 모든 수치는 파라메트릭 시뮬레이션 결과이며 임상 측정·검증 데이터가 아닙니다. true_* 열은 시뮬레이터의 설정값(모델 진값)이고, 추정기는 같은 트윈의 생성 관계를 역산하므로 오차 수치는 "모델 일치 상한"입니다.',
    session: { windows: s.windows, windowsDropped: s.dropped, span_s: +s.span_s.toFixed(2), rawSeconds: +s.rawSpan_s.toFixed(2), rawSampleRate_Hz: buf.raw.length ? buf.raw[0].fs : null },
    ...meta,
    columns: WINDOW_COLUMNS.map((c) => ({ name: c.k, unit: c.u, description: c.d })),
    rawColumns: { t_s: 's', 'ch<i>_pF': 'pF (전극 정전용량)', ppg_red: 'a.u.', ppg_ir: 'a.u.', radial_p_mmHg: 'mmHg (시뮬레이터 진값)' },
    pandas: ["import pandas as pd", "w = pd.read_csv('dt_windows_….csv', comment='#')", "raw = pd.read_csv('dt_raw_….csv', comment='#')", "# Parquet 은 브라우저에서 만들지 않습니다 — 필요하면 여기서 w.to_parquet(...)"],
  }, null, 2);
}

// ---- download (streamed when the browser allows it)
export async function saveStream(filename, chunks, mime = 'text/csv') {
  if (typeof window !== 'undefined' && window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: filename });
      const w = await h.createWritable();
      for (const c of chunks) await w.write(c);
      await w.close();
      return 'stream';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel';
      // fall through to the Blob path (e.g. picker blocked without a user gesture)
    }
  }
  const parts = [];
  for (const c of chunks) parts.push(c);
  const blob = new Blob(parts, { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  return 'blob';
}

const pad = (n) => String(n).padStart(2, '0');
export function stamp(d = new Date()) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
const mb = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1e3))} kB`);

// ---- dialog
let modal = null, refreshFn = null;
export function openExportDialog({ buffer, meta, onStatus }) {
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = translateUI(x); return e; };
  if (!modal) {
    modal = el('div', 'modal hidden export'); modal.id = 'exportModal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    const box = el('div', 'modal-box'); box.style.width = '560px';
    box.appendChild(el('h3', null, '데이터 내보내기 (CSV / JSONL + 파라미터 JSON)'));
    const stats = el('div', 'exp-grid'); box.appendChild(stats);
    const opts = el('div', 'exp-opts');
    const mkChk = (id, label, checked, title) => {
      const l = el('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.id = id; i.checked = checked;
      l.append(i, el('span', null, label)); if (title) l.title = translateUI(title); opts.appendChild(l); return i;
    };
    const cWin = mkChk('expWin', '분석 창 결과 CSV (t · HR · amp · RI · tRefl · PWV · x̂ · 어레이/PPG BP · 신뢰도 · 부착 · SpO₂)', true);
    const cJsonl = mkChk('expJsonl', '같은 내용을 JSONL 로도 저장 (pandas: read_json(lines=True))', false);
    const cSide = mkChk('expSide', '파라미터·시나리오·캘리브레이션 사이드카 JSON', true);
    const cRawOn = mkChk('expRawOn', `원파형 롤링 캡처 켜기 (최근 ${buffer.rawSeconds} s, 정전용량 레이트)`, buffer.rawOn, '켜면 지금부터 정전용량 샘플링 레이트로 채널·PPG·기준 맥파를 링버퍼에 모읍니다. 엔진 자체는 4 s 이력만 갖고 있으므로 과거로 소급되지 않습니다.');
    const cRaw = mkChk('expRaw', '원파형 CSV 내보내기 (아래 크기 경고 확인)', false);
    box.appendChild(opts);
    const warn = el('p', 'exp-warn'); box.appendChild(warn);
    const note = el('p', 'exp-note');
    note.innerHTML = localizeHTML('Parquet 은 <b>브라우저에서 생성하지 않습니다</b>(외부 라이브러리 없이 정직하게 만들 수 없어 흉내내지 않음) — CSV/JSONL 로 내보낸 뒤 <code>pd.read_csv(…, comment=\'#\')</code> → <code>df.to_parquet(…)</code> 로 변환하십시오. 전체 세션 원파형이 필요하면 도구 &gt; 기록(<code>.dtrec</code>)이 정확한 16 kHz 프레임을 저장합니다. <b>true_* 열은 시뮬레이터 설정값</b>이며 임상 기준이 아닙니다.');
    box.appendChild(note);
    const actions = el('div', 'modal-actions');
    const bClear = el('button', 'btn', '버퍼 비우기'); bClear.type = 'button';
    const bClose = el('button', 'btn', '닫기'); bClose.type = 'button';
    const bGo = el('button', 'btn primary', '내보내기'); bGo.type = 'button';
    actions.append(bClear, bClose, bGo); box.appendChild(actions);
    modal.appendChild(box); document.body.appendChild(modal);

    refreshFn = () => {
      const s = buffer.stats();
      stats.innerHTML = localizeHTML('');
      const add = (k, v, title) => { const a = el('span', null, k); const b = el('b', null, v); if (title) { a.title = translateUI(title); b.title = translateUI(title); } stats.append(a, b); };
      add('분석 창', `${s.windows.toLocaleString()} 행 · ${s.span_s.toFixed(1)} s${s.dropped ? ` (오래된 ${s.dropped} 행 폐기)` : ''}`, `버퍼 상한 ${buffer.maxWindows.toLocaleString()} 행 — 넘으면 오래된 행부터 버립니다`);
      add('창 CSV 예상 크기', mb(s.csvBytes));
      add('원파형 캡처', s.rawOn ? `켜짐 · ${s.rawSpan_s.toFixed(1)} s · ${s.rawCh} ch · 메모리 ${mb(s.rawBytes)}` : '꺼짐');
      add('원파형 CSV 예상', s.rawOn ? mb(s.rawCsvBytes) : '–', '표본당 채널 수 × ~9 B 로 추정한 값입니다');
      warn.textContent = translateUI(cRaw.checked && s.rawOn && s.rawCsvBytes > 20e6
        ? `⚠ 원파형 CSV 가 약 ${mb(s.rawCsvBytes)} 입니다 — 브라우저 다운로드/후처리가 느려질 수 있습니다. 캡처 길이를 줄이거나 .dtrec 기록을 쓰십시오.`
        : (cRaw.checked && !s.rawOn ? '⚠ 원파형 캡처가 꺼져 있어 내보낼 원파형이 없습니다. 위 체크박스로 켠 뒤 몇 초 모으십시오.' : ''));
    };
    for (const c of [cRaw, cRawOn]) c.addEventListener('change', refreshFn);
    cRawOn.addEventListener('change', () => { buffer.setRaw(cRawOn.checked); refreshFn(); });
    bClear.addEventListener('click', () => { buffer.clear(); refreshFn(); });
    bClose.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    bGo.addEventListener('click', async () => {
      const tag = stamp();
      const m = typeof meta === 'function' ? meta() : (meta || {});
      let n = 0;
      try {
        if (cWin.checked) { await saveStream(`dt_windows_${tag}.csv`, windowsCsv(buffer), 'text/csv'); n++; }
        if (cJsonl.checked) { await saveStream(`dt_windows_${tag}.jsonl`, windowsJsonl(buffer), 'application/x-ndjson'); n++; }
        if (cRaw.checked && buffer.raw.length) { await saveStream(`dt_raw_${tag}.csv`, rawCsv(buffer), 'text/csv'); n++; }
        if (cSide.checked) { await saveStream(`dt_meta_${tag}.json`, [sidecarJson(buffer, m)], 'application/json'); n++; }
        onStatus && onStatus(`내보내기 완료 — ${n} 개 파일 (${tag})`);
      } catch (e) { onStatus && onStatus('내보내기 실패: ' + (e && e.message || e)); }
      refreshFn();
    });
    // keep the numbers alive while the dialog is open
    setInterval(() => { if (modal && !modal.classList.contains('hidden')) refreshFn(); }, 700);
  }
  refreshFn();
  modal.classList.remove('hidden');
}
export function closeExportDialog() { if (modal) modal.classList.add('hidden'); }
