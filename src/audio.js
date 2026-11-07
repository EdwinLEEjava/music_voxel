import { WATER_Y } from './config.js';
import { noteStep, spanR, view } from './world.js';

// ================= 音效 =================
const sfx = (() => {
  let ctx = null, master = null, wet = null, dry = null, busClear = null, busMuffled = null, muted = false;
  const voices = [], MAX_VOICES = 24, PENTA = [0, 2, 4, 7, 9];
  const TONE_PARTS = [[1, 'sine', 1], [2, 'sine', 0.2], [3, 'triangle', 0.05]];   // 默认白色方块：柔和的水滴音
  const ksCache = new Map();

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    const len = ctx.sampleRate * 3.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    wet = ctx.createGain(); wet.gain.value = 0.45;
    dry = ctx.createGain(); dry.gain.value = 0.8;
    wet.connect(conv); conv.connect(master); dry.connect(master);
    busClear = ctx.createBiquadFilter(); busClear.type = 'lowpass'; busClear.frequency.value = 4500;
    busMuffled = ctx.createBiquadFilter(); busMuffled.type = 'lowpass'; busMuffled.frequency.value = 900;
    for (const b of [busClear, busMuffled]) { b.connect(dry); b.connect(wet); }
  }
  // 登记声部：结束后断开节点；超过上限时淡出最旧的
  function register(g, nodes, sources, end) {
    const now = ctx.currentTime;
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end < now) voices.splice(i, 1);
    while (voices.length >= MAX_VOICES) {
      const old = voices.shift();
      try {
        old.g.gain.cancelScheduledValues(now);
        old.g.gain.setValueAtTime(old.g.gain.value, now);
        old.g.gain.linearRampToValueAtTime(0, now + 0.05);
        old.sources.forEach(s => s.stop(now + 0.06));
      } catch (e) {}
    }
    voices.push({ g, end, sources });
    let left = sources.length;
    sources.forEach(s => s.onended = () => { if (--left === 0) nodes.forEach(n => { try { n.disconnect(); } catch (e) {} }); });
  }
  function out(pan, underwater, nodes) {
    const g = ctx.createGain();
    const bus = underwater ? busMuffled : busClear;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      g.connect(p); p.connect(bus); nodes.push(p);
    } else g.connect(bus);
    nodes.push(g);
    return g;
  }
  function bubble(t, pan, uw, f0 = 260, f1 = 720, vol = 0.35) {
    const nodes = [], g = out(pan, uw, nodes), o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); nodes.push(o);
    o.start(t); o.stop(t + 0.2);
    register(g, nodes, [o], t + 0.2);
  }
  // ———— 乐器 ————
  // 每种乐器用各自的发声原理合成：拨弦算法 / FM 金属 / 敲击 / 弓弦
  function tone(t, freq, pan, uw, vol = 0.22, decay = 1.8, inst = 'tone') {
    const f = INSTRUMENTS[inst] || INSTRUMENTS.tone;
    f(t, freq, pan, uw, vol, decay);
  }

  // 包络增益：起音 a 秒到 vol，再在 d 秒内衰减
  function env(g, t, vol, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function osc(type, freq, t, end, nodes, srcs) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    o.start(t); o.stop(end);
    nodes.push(o); srcs.push(o);
    return o;
  }

  // Karplus-Strong 拨弦：一段噪声在延迟环里反复平均衰减 → 真实的琴弦振动
  function ksBuffer(freq, damp, smooth, dur) {
    const k = `${Math.round(freq)}:${damp}:${smooth}:${dur}`;
    if (ksCache.has(k)) return ksCache.get(k);
    const sr = ctx.sampleRate, N = Math.max(2, Math.round(sr / freq)), len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0), ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    for (let p = 0; p < smooth; p++) for (let i = 1; i < N; i++) ring[i] = (ring[i] + ring[i - 1]) * 0.5;   // 拨片越软，初始噪声越圆润
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const nx = (idx + 1) % N;
      d[i] = ring[idx];
      ring[idx] = damp * 0.5 * (ring[idx] + ring[nx]);
      idx = nx;
    }
    // 归一化 + 末尾淡出
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < len; i++) d[i] = d[i] / (peak || 1) * (i > len - fade ? (len - i) / fade : 1);
    if (ksCache.size > 120) ksCache.delete(ksCache.keys().next().value);
    ksCache.set(k, buf);
    return buf;
  }
  function pluck(t, freq, pan, uw, vol, damp, smooth, dur, tonePart = 0) {
    const nodes = [], srcs = [], g = out(pan, uw, nodes);
    const s = ctx.createBufferSource();
    s.buffer = ksBuffer(freq, damp, smooth, dur);
    g.gain.value = vol;
    s.connect(g); s.start(t); nodes.push(s); srcs.push(s);
    if (tonePart) {   // 给低音加一点纯净的基音，让它更厚
      const o = osc('sine', freq, t, t + dur, nodes, srcs), og = ctx.createGain();
      env(og, t, vol * tonePart, 0.005, dur * 0.7);
      o.connect(og); og.connect(g); nodes.push(og);
    }
    register(g, nodes, srcs, t + dur);
  }

  // FM 合成：调制器频率与载波不成整数比 → 金属的不和谐泛音
  function fm(t, freq, pan, uw, vol, ratio, index, idxDecay, ampDecay, extra = []) {
    const nodes = [], srcs = [], g = out(pan, uw, nodes), end = t + ampDecay + 0.1;
    const car = osc('sine', freq, t, end, nodes, srcs), mod = osc('sine', freq * ratio, t, end, nodes, srcs);
    const mg = ctx.createGain(); nodes.push(mg);
    mg.gain.setValueAtTime(freq * index, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + idxDecay);
    mod.connect(mg); mg.connect(car.frequency);
    env(g, t, vol, 0.003, ampDecay);
    car.connect(g);
    for (const [mul, amp, dec] of extra) {
      const o = osc('sine', freq * mul, t, end, nodes, srcs), og = ctx.createGain();
      env(og, t, amp, 0.003, dec); o.connect(og); og.connect(g); nodes.push(og);
    }
    register(g, nodes, srcs, end);
  }

  const INSTRUMENTS = {
    // 白色方块：柔和的水滴音
    tone(t, freq, pan, uw, vol, decay) {
      const nodes = [], srcs = [], g = out(pan, uw, nodes);
      env(g, t, vol, 0.02, decay);
      for (const [mul, type, v] of TONE_PARTS) {
        const o = osc(type, freq * mul, t, t + decay + 0.1, nodes, srcs), og = ctx.createGain();
        o.detune.value = (Math.random() - 0.5) * 6; og.gain.value = v;
        o.connect(og); og.connect(g); nodes.push(og);
      }
      register(g, nodes, srcs, t + decay + 0.1);
    },
    // 吉他：拨弦，中等阻尼，拨片略软
    pluck(t, freq, pan, uw, vol) { pluck(t, freq, pan, uw, vol * 1.3, 0.994, 2, 1.3); },
    // 竖琴：更亮、余音更长
    harp(t, freq, pan, uw, vol) { pluck(t, freq, pan, uw, vol * 1.2, 0.998, 0, 2.2); },
    // 贝斯：低八度的粗弦，圆润厚实
    bass(t, freq, pan, uw, vol) { pluck(t, freq / 2, pan, uw, vol * 1.5, 0.996, 5, 1.6, 0.5); },
    // 管钟：FM 金属钟，长余音
    bell(t, freq, pan, uw, vol) { fm(t, freq, pan, uw, vol * 0.9, 1.4, 6, 1.8, 3.2, [[2.0, vol * 0.25, 2.2]]); },
    // 钢片琴：清脆短促的金属片
    glass(t, freq, pan, uw, vol) { fm(t, freq * 2 > 1100 ? freq : freq * 2, pan, uw, vol * 0.8, 3.5, 1.6, 0.25, 1.2); },
    // 马林巴：木头共鸣（基音 + 3.9 倍泛音）+ 木槌敲击声
    marimba(t, freq, pan, uw, vol) {
      const nodes = [], srcs = [], g = out(pan, uw, nodes), end = t + 0.9;
      const a = osc('sine', freq, t, end, nodes, srcs), ag = ctx.createGain();
      env(ag, t, vol * 1.3, 0.002, 0.7); a.connect(ag); ag.connect(g);
      const b = osc('sine', freq * 3.93, t, end, nodes, srcs), bg = ctx.createGain();
      env(bg, t, vol * 0.4, 0.001, 0.12); b.connect(bg); bg.connect(g);
      const len = Math.floor(ctx.sampleRate * 0.02), nb = ctx.createBuffer(1, len, ctx.sampleRate), nd = nb.getChannelData(0);
      for (let i = 0; i < len; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const ns = ctx.createBufferSource(); ns.buffer = nb;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * 6; bp.Q.value = 2;
      const ngn = ctx.createGain(); ngn.gain.value = vol * 0.6;
      ns.connect(bp); bp.connect(ngn); ngn.connect(g); ns.start(t);
      nodes.push(ag, bg, ns, bp, ngn); srcs.push(ns);
      g.gain.value = 1;
      register(g, nodes, srcs, end);
    },
    // 弦乐：三把略微失谐的锯齿波 + 低通 + 揉弦，慢起慢收
    pad(t, freq, pan, uw, vol) {
      const nodes = [], srcs = [], g = out(pan, uw, nodes), end = t + 2.8;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(2400, freq * 5); lp.Q.value = 0.7;
      const lfo = osc('sine', 5.2, t, end, nodes, srcs), lg = ctx.createGain(); lg.gain.value = 7;
      lfo.connect(lg); nodes.push(lg, lp);
      for (const dt of [-7, 0, 7]) {
        const o = osc('sawtooth', freq, t, end, nodes, srcs);
        o.detune.value = dt; lg.connect(o.detune); o.connect(lp);
      }
      lp.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * 0.55, t + 0.35);
      g.gain.setValueAtTime(vol * 0.55, t + 1.0);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
      register(g, nodes, srcs, end);
    },
  };

  function splash(t, pan, vol) {
    const len = ctx.sampleRate * 0.35, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const nodes = [], g = out(pan, false, nodes);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.8;
    g.gain.value = vol;
    s.connect(bp); bp.connect(g); nodes.push(s, bp);
    s.start(t);
    register(g, nodes, [s], t + 0.4);
  }
  // 五声音阶，最高限制在第 12 级（约 1kHz）
  function noteFreq(step) {
    step = Math.max(0, Math.min(12, step));
    const oct = Math.floor(step / 5), deg = step % 5;
    return 196 * Math.pow(2, oct + PENTA[deg] / 12);
  }
  const ok = () => ctx && !muted;
  const now = () => ctx.currentTime + 0.02;

  return {
    init,
    toggle() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.6; return !muted; },
    place(v, world) {
      if (!ok()) return;
      const t = now(), uw = world.y < WATER_Y - 0.3, pan = panOf(world);
      bubble(t, pan, uw);
      if (Math.random() < 0.5) bubble(t + 0.06 + Math.random() * 0.08, pan, uw, 400, 900, 0.1);
      tone(t + 0.02, noteFreq(noteStep(v)), pan, uw, 0.22, 1.8, v.inst || 'tone');
      const near = Math.exp(-Math.abs(world.y - WATER_Y) * 0.6);
      if (near > 0.2) splash(t, pan, 0.16 * near);
    },
    // 回响 / 水波经过时的发声；拱门所在列带回声
    play(notes, echo = false) {
      if (!ok() || !notes.length) return;
      const t = now(), vol = 0.16 / Math.sqrt(notes.length), reps = echo ? 3 : 1;
      for (let r = 0; r < reps; r++) {
        const pan0 = echo && r > 0 ? (r % 2 ? 0.5 : -0.5) : 0;
        notes.forEach((n, i) => tone(t + r * 0.23 + i * 0.015, noteFreq(n.step), n.pan + pan0, n.uw || r > 1, vol * (n.vol ?? 1) * Math.pow(0.45, r), 1.3, n.inst));
      }
    },
    bell(step, pan) {
      if (!ok()) return;
      const t = now(), f = noteFreq(step) / 2;
      for (const [mul, amp, dec] of [[1, 1, 5], [2, 0.45, 3.5], [2.76, 0.3, 2.5], [4.07, 0.12, 1.4]]) {
        const nodes = [], g = out(pan, false, nodes), o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f * mul;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.26 * amp, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g); nodes.push(o);
        o.start(t); o.stop(t + dec + 0.1);
        register(g, nodes, [o], t + dec + 0.1);
      }
    },
    spring(pan) {
      if (!ok()) return;
      const t = now();
      for (let i = 0; i < 6; i++) bubble(t + i * 0.07, pan, false, 260 + i * 70, 600 + i * 120, 0.14);
      tone(t + 0.45, noteFreq(11), pan, false, 0.12, 2.4);
      tone(t + 0.45, noteFreq(9), pan, false, 0.09, 2.4);
    },
    chime(pan) {
      if (!ok()) return;
      const t = now();
      for (let r = 0; r < 5; r++) {
        const v = 0.15 * Math.pow(0.5, r), p = pan + (r > 0 ? (r % 2 ? 0.4 : -0.4) : 0);
        tone(t + r * 0.25, noteFreq(8), p, r > 2, v, 1.2);
        tone(t + r * 0.25 + 0.12, noteFreq(10), p, r > 2, v, 1.2);
      }
    },
    arp(n, pan) { if (!ok()) return; const t = now(); for (let i = 0; i < n; i++) tone(t + i * 0.07, noteFreq(3 + i), pan + (i / n - 0.5) * 0.6, false, 0.1, 0.9, 'marimba'); },
    chord(pan) { if (!ok()) return; const t = now(); [0, 2, 4, 5].forEach((st, i) => tone(t + i * 0.09, noteFreq(st), pan, false, 0.12, 3.2)); },
    scale(n, pan) { if (!ok()) return; const t = now(); for (let i = 0; i < n; i++) tone(t + i * 0.13, noteFreq(2 + i), pan, false, 0.13, 1.1, 'harp'); },
    whale(pan) {
      if (!ok()) return;
      const t = now(), nodes = [], g = out(pan, true, nodes), o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(210, t + 0.8);
      o.frequency.exponentialRampToValueAtTime(95, t + 2.6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      o.connect(g); nodes.push(o);
      o.start(t); o.stop(t + 3.1);
      register(g, nodes, [o], t + 3.1);
    },
    // 船的钟声：两下清脆的小钟；far 时经过低通，像隔着雾
    boatBell(pan, far = true) {
      if (!ok()) return;
      const t = now(), v = far ? 0.07 : 0.1;
      fm(t, 659, pan, far, v, 3.5, 2, 0.4, 1.8);
      fm(t + 0.32, 659, pan, far, v * 0.8, 3.5, 2, 0.4, 1.6);
    },
    instNote(inst, step, pan, far = false) { if (ok()) tone(now(), noteFreq(step), pan, far, far ? 0.09 : 0.2, 1.5, inst); },
    tap(pan) { if (!ok()) return; const t = now(); bubble(t, pan, true, 180, 90, 0.3); splash(t, pan, 0.07); },
    tiny(pan) { if (ok()) bubble(now(), pan, false, 420 + Math.random() * 300, 800 + Math.random() * 400, 0.04); },
    undo() { if (ok()) bubble(now(), 0, true, 520, 160, 0.25); },
    // 开场镜头拉近：一段“呼吸”般的风声（扫频的过滤噪声）+ 两个慢慢浮起的高音，空、远、轻
    whoosh(dur = 4) {
      if (!ok()) return;
      const t = now(), nodes = [], srcs = [], g = out(0, false, nodes), end = t + dur + 0.2;
      const len = Math.floor(ctx.sampleRate * (dur + 0.2)), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const ns = ctx.createBufferSource(); ns.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(260, t);
      bp.frequency.exponentialRampToValueAtTime(1500, t + dur * 0.55);
      bp.frequency.exponentialRampToValueAtTime(420, t + dur);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.1, t + dur * 0.5);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      ns.connect(bp); bp.connect(ng); ng.connect(g); ns.start(t); ns.stop(end);
      nodes.push(ns, bp, ng); srcs.push(ns);
      for (const [f, v] of [[587, 0.028], [880, 0.02]]) {      // D5、A5：空灵的五度
        const o = osc('sine', f, t, end, nodes, srcs), og = ctx.createGain();
        o.detune.value = (Math.random() - 0.5) * 8;
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(v, t + dur * 0.6);
        og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
        o.connect(og); og.connect(g); nodes.push(og);
      }
      g.gain.value = 1;
      register(g, nodes, srcs, end);
    },
    // 界面音效：像轻敲玻璃，音量很小、混响很长。open 上行两音、close 下行两音、tap 单音
    ui(kind = 'tap') {
      if (!ok()) return;
      const t = now(), seq = kind === 'open' ? [784, 1175] : kind === 'close' ? [1175, 784] : [988];
      seq.forEach((f, i) => {
        const nodes = [], srcs = [], g = out(0, false, nodes), s = t + i * 0.07, end = s + 0.9;
        const o = osc('sine', f, s, end, nodes, srcs), o2 = osc('sine', f * 2.01, s, end, nodes, srcs), g2 = ctx.createGain();
        g2.gain.value = 0.15; o2.connect(g2); g2.connect(g); nodes.push(g2);
        o.connect(g);
        env(g, s, 0.045, 0.004, 0.8);
        register(g, nodes, srcs, end);
      });
    },
  };
})();
const panOf = w => ((w.x - view.x) - (w.z - view.z)) / Math.max(6, spanR * 2 + 4);

export { sfx, panOf };
