import { clamp, smooth, lerp, fmt } from './util.js';

/* ---------------------------------------------------------------- */
/* Chapters and their scroll linked steps                            */
/* ---------------------------------------------------------------- */
export function collectChapters() {
  return [...document.querySelectorAll('.chapter[data-pin]')].map((el) => {
    const steps = [...el.querySelectorAll('.step')].map((s, i, all) => ({
      el: s,
      at: parseFloat(s.dataset.at || '0'),
      until: parseFloat(s.dataset.until || '0'),
      first: i === 0,
      last: i === all.length - 1,
      part: s.dataset.part || null,
      a: -1,
    }));
    return { id: el.id, el, stage: el.querySelector('.stage'), steps, model: el.dataset.model || null, top: 0, height: 0, unit: 1, span: 0 };
  });
}

export function measure(chapters) {
  const sy = window.scrollY;
  for (const c of chapters) {
    const r = c.el.getBoundingClientRect();
    c.top = r.top + sy;
    c.height = r.height;
    c.unit = c.stage ? c.stage.offsetHeight || window.innerHeight : window.innerHeight;
    c.span = Math.max(1, c.height - c.unit) / c.unit;
  }
}

// local position in stage heights, 0 when the chapter pins, span when it lets go
export const localU = (c, y) => (y - c.top) / c.unit;

const FADE = 0.22;
export function stepAlpha(s, u) {
  const inA = s.first ? 1 : smooth(clamp((u - (s.at - FADE)) / FADE));
  const outA = s.last ? 1 : 1 - smooth(clamp((u - s.until) / FADE));
  return { a: Math.min(inA, outA), dir: u < s.at ? 1 : u > s.until ? -1 : 0, enter: inA, exit: outA };
}

export function updateSteps(chapters, y, vh) {
  for (const c of chapters) {
    const u = localU(c, y);
    const near = u > -1.2 && u < c.span + 1.2;
    for (const s of c.steps) {
      let a = 0, off = 0;
      if (near) {
        const r = stepAlpha(s, u);
        a = r.a;
        off = r.enter < 1 ? (1 - r.enter) * 26 : r.exit < 1 ? -(1 - r.exit) * 26 : 0;
      }
      if (a === s.a || (Math.abs(a - s.a) < 0.002 && a > 0 && a < 1)) continue;
      s.a = a;
      s.el.style.opacity = a.toFixed(3);
      s.el.style.transform = off ? `translate3d(0, ${off.toFixed(1)}px, 0)` : '';
      const live = a > 0.02;
      if (live !== s.el.classList.contains('live')) s.el.classList.toggle('live', live);
    }
  }
}

/* ---------------------------------------------------------------- */
/* Labels that follow points in 3D                                   */
/* ---------------------------------------------------------------- */
export function createLabels() {
  const overlay = document.getElementById('overlay');
  const svg = document.getElementById('leaders');
  const NS = 'http://www.w3.org/2000/svg';
  const items = new Map();
  let used = new Set();
  function get(id, text, cls, opts) {
    let it = items.get(id);
    if (!it) {
      const el = document.createElement(opts.href ? 'a' : 'div');
      el.className = 'tag ' + (cls || '');
      if (opts.href) { el.href = opts.href; el.classList.add('link'); el.tabIndex = -1; }
      el.innerHTML = text;
      overlay.appendChild(el);
      const pin = document.createElement('div');
      pin.className = 'pin';
      overlay.appendChild(pin);
      const line = document.createElementNS(NS, 'line');
      svg.appendChild(line);
      it = { el, pin, line, a: -1, pa: -1, la: -1, w: 0, h: 0, text };
      items.set(id, it);
    }
    return it;
  }
  const setA = (it, a, pa, la) => {
    if (a !== it.a) { it.el.style.opacity = a; it.el.style.visibility = a > 0 ? 'visible' : 'hidden'; it.a = a; }
    if (pa !== it.pa) { it.pin.style.opacity = pa; it.pa = pa; }
    if (la !== it.la) { it.line.style.opacity = la; it.la = la; }
  };
  // a tag offset from its anchor (ax, ay) by (dx, dy), with a pin and a leader line
  function place(id, text, cls, ax, ay, alpha, dx = 0, dy = -26, opts = {}) {
    const it = get(id, text, cls, opts);
    used.add(id);
    if (it.text !== text) { it.el.innerHTML = text; it.text = text; it.w = 0; }
    const a = clamp(alpha);
    if (a > 0 && !it.w) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; }
    setA(it, a, opts.pin === false ? 0 : a, opts.pin === false || opts.line === false ? 0 : a * 0.75);
    if (a <= 0) return;
    // flip to the other side rather than run into the words or the photos
    if (opts.maxX != null && dx > 4 && ax + dx + it.w > opts.maxX) dx = -dx;
    else if (opts.minX != null && dx < -4 && ax + dx - it.w < opts.minX) dx = -dx;
    const lx = ax + dx, ly = ay + dy;
    const left = dx < -4 ? lx - it.w : dx > 4 ? lx : lx - it.w / 2;
    const top = ly - it.h / 2;
    it.el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
    it.pin.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0)`;
    const ex = Math.abs(dx) > 4 ? lx : ax;
    const ey = Math.abs(dx) > 4 ? ly : dy < 0 ? top + it.h : top;
    it.line.setAttribute('x1', ax.toFixed(1)); it.line.setAttribute('y1', ay.toFixed(1));
    it.line.setAttribute('x2', ex.toFixed(1)); it.line.setAttribute('y2', ey.toFixed(1));
  }
  // just a pin
  function dot(id, ax, ay, alpha) {
    const it = get(id, '', 'pin-only', {});
    used.add(id);
    const a = clamp(alpha);
    setA(it, 0, a, 0);
    if (a > 0) it.pin.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0)`;
  }
  function begin() { used = new Set(); }
  function end() { for (const [id, it] of items) if (!used.has(id)) setA(it, 0, 0, 0); }
  return { place, dot, begin, end, items };
}

/* ---------------------------------------------------------------- */
/* Mini SRC datapath                                                 */
/* ---------------------------------------------------------------- */
const hex = (v) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
const short = (v) => '0x' + (v >>> 0).toString(16).toUpperCase();
/* Control steps taken from our Verilog control unit (CPUProject on GitHub).
   Fetch is one clock because instructions come from their own memory. */
const FETCH = { t: 'T0', sig: ['PCout', 'PCin', 'IRin'], fetch: true };
const PROGS = {
  add: {
    pc: 0x10, instr: 'add R3, R4, R5',
    regs: { R1: 0x00, R2: 0x20, R3: 0x00, R4: 0x12, R5: 0x1e },
    steps: [
      { ...FETCH, say: 'Fetch. Our instructions live in their own memory, so in one clock the instruction drops straight into IR and PC moves on to the next address. The textbook version needs three clocks for this.' },
      { t: 'T1', sig: ['Grb', 'Rout', 'Yin'], out: 'R4', in: ['Y'],
        say: 'R4 goes onto the bus and waits in Y. The ALU needs two inputs at once, and the bus only carries one value at a time.' },
      { t: 'T2', sig: ['Grc', 'Rout', 'ADD', 'Zin'], out: 'R5', in: [], alu: 'ADD',
        say: 'R5 goes onto the bus as the second input. The ALU, which was my part, adds it to Y with a carry lookahead adder, and the sum lands in Z.' },
      { t: 'T3', sig: ['Zout', 'Gra', 'Rin'], out: 'Z', in: ['R3'],
        say: 'The sum leaves Z and goes into R3. 0x12 plus 0x1E is 0x30, done in four clocks.' },
    ],
  },
  ld: {
    pc: 0x11, instr: 'ld R1, 0x55(R2)', C: 0x55,
    regs: { R1: 0x00, R2: 0x20, R3: 0x30, R4: 0x12, R5: 0x1e },
    steps: [
      { ...FETCH, say: 'Fetch, the same single clock every instruction starts with.' },
      { t: 'T1', sig: ['Grb', 'Rout', 'Yin'], out: 'R2', in: ['Y'],
        say: 'R2 holds the base address, so it goes into Y. If the base were R0, BAout would put a zero on the bus instead.' },
      { t: 'T2', sig: ['Cout', 'ADD', 'Zin'], out: 'C', in: [], alu: 'ADD',
        say: 'The offset 0x55 comes straight out of the instruction, sign extended to 32 bits, and the ALU adds it to the base. 0x20 plus 0x55 is 0x75.' },
      { t: 'T3', sig: ['Zout', 'MARin'], out: 'Z', in: ['MAR'],
        say: 'That address goes from Z into MAR.' },
      { t: 'T4', sig: ['Read', 'MDRin'], read: true,
        say: 'Data memory reads address 0x75 into MDR.' },
      { t: 'T5', sig: ['MDRout', 'Gra', 'Rin'], out: 'MDR', in: ['R1'],
        say: 'MDR goes onto the bus and into R1. Loads and stores were one of my pieces.' },
    ],
  },
  br: {
    pc: 0x12, instr: 'brzr R2, 3', C: 3,
    regs: { R1: 0x4b, R2: 0x00, R3: 0x30, R4: 0x12, R5: 0x1e },
    steps: [
      { ...FETCH, say: 'Fetch again. PC is now 0x13.' },
      { t: 'T1', sig: ['Gra', 'Rout', 'CONin'], out: 'R2', in: ['CON'],
        say: 'R2 goes onto the bus and the CON FF looks at it. For brzr it asks one question: is every bit zero? It is, so CON is set. I built this circuit.' },
      { t: 'T2', sig: ['PCout', 'Yin'], out: 'PC', in: ['Y'],
        say: 'PC goes into Y, ready to be the base of the jump.' },
      { t: 'T3', sig: ['Cout', 'ADD', 'Zin'], out: 'C', in: [], alu: 'ADD',
        say: 'The offset from the instruction is added to PC. 0x13 plus 3 is 0x16.' },
      { t: 'T4', sig: ['Zout', 'PCin if CON'], out: 'Z', in: ['PC'], branch: true,
        say: 'CON is set, so PC takes the new address from Z and the program jumps. Had R2 not been zero, PC would just carry on to the next instruction.' },
    ],
  },
};

export function createSRC() {
  const svg = document.getElementById('src-svg');
  if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  const txt = (x, y, s, cls, anchor = 'start', parent = svg) => { const e = mk('text', { x, y, class: cls, 'text-anchor': anchor }, parent); e.textContent = s; return e; };
  const BUS = 330;
  const boxes = {};
  const wires = {};
  const gW = mk('g', {});
  const path = (id, d, cls = 'dp-wire') => { wires[id] = mk('path', { d, class: cls }, gW); return wires[id]; };
  // wires that meet the bus
  path('busR', `M260 76 H${BUS}`);
  path('busC', `M260 158 H${BUS}`);
  path('busMAR', `M260 200 H${BUS}`);
  path('busMDR', `M260 242 H${BUS}`);
  path('busY', `M${BUS} 47 H400`);
  path('busZ', `M410 213 H${BUS}`);
  path('busCON', `M${BUS} 258 H400`);
  path('busPC', `M${BUS} 304 H400`);
  path('aluB', `M${BUS} 90 H552 V104`);
  path('aluA', 'M460 64 V104');
  path('aluZ', 'M480 168 V196');
  // memory paths that never touch the bus
  path('memA', 'M30 200 H16 V288 H30');
  path('memD', 'M30 242 H22 V280 H30');
  path('pcIM', 'M500 320 V334');
  path('imIR', 'M400 357 H260');
  const bus = mk('line', { x1: BUS, y1: 16, x2: BUS, y2: 322, class: 'dp-bus' });
  txt(BUS, 12, 'Bus', 'dp-sig', 'middle');
  const box = (id, x, y, w, h, label) => {
    const r = mk('rect', { x, y, width: w, height: h, rx: 3, class: 'dp-box' });
    const l = txt(x + 10, y + h / 2 + 4.5, label, 'dp-label');
    const v = txt(x + w - 10, y + h / 2 + 4.5, '', 'dp-val', 'end');
    boxes[id] = { r, l, v, x, y, w, h, cy: y + h / 2 };
    return boxes[id];
  };
  const reg = mk('rect', { x: 30, y: 20, width: 230, height: 112, rx: 3, class: 'dp-box' });
  txt(40, 38, 'Registers, R0 to R15', 'dp-label');
  const regRows = {};
  ['R1', 'R2', 'R3', 'R4', 'R5'].forEach((r, i) => {
    const y = 58 + i * 17;
    const bg = mk('rect', { x: 36, y: y - 12, width: 218, height: 16, rx: 2, class: 'dp-box', opacity: 0 });
    txt(46, y, r, 'dp-val');
    regRows[r] = { bg, v: txt(248, y, '', 'dp-val', 'end') };
  });
  boxes.REG = { r: reg };
  box('C', 30, 142, 230, 32, 'C, sign extended');
  box('MAR', 30, 184, 230, 32, 'MAR');
  box('MDR', 30, 226, 230, 32, 'MDR');
  box('MEM', 30, 268, 230, 40, 'Data memory');
  box('IR', 30, 340, 230, 34, 'IR');
  box('Y', 400, 30, 120, 34, 'Y');
  box('Z', 410, 196, 140, 34, 'Z');
  box('CON', 400, 244, 140, 28, 'CON FF');
  box('PC', 400, 288, 200, 32, 'PC');
  // a long name, so its contents go on a second line
  const im = box('IM', 400, 334, 200, 46, 'Instruction memory');
  im.l.setAttribute('y', 334 + 18);
  im.v.setAttribute('y', 334 + 37);
  const alu = mk('path', { d: 'M380 104 H580 L540 168 H420 Z', class: 'dp-box' });
  const aluT = txt(480, 141, 'ALU', 'dp-label', 'middle');
  boxes.ALU = { r: alu };
  const sigT = txt(600, 47, '', 'dp-sig', 'end');
  const pulse = mk('circle', { r: 5, class: 'dp-pulse', cx: -20, cy: -20 });

  const stepsEl = document.getElementById('src-steps');
  const explain = document.getElementById('src-explain');
  let progKey = 'add', idx = -1, timer = null, anim = 0;
  let S = {};

  function reset() {
    const P = PROGS[progKey];
    S = { PC: P.pc, IR: '', C: 0, MAR: 0, MDR: null, Y: 0, Z: 0, CON: null, regs: { ...P.regs } };
    stepsEl.innerHTML = '';
    P.steps.forEach((st, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<b>${st.t}</b><span>${st.sig.join(', ')}</span>`;
      li.addEventListener('click', () => { stop(); go(i); });
      stepsEl.appendChild(li);
    });
  }
  function apply(st) {
    const P = PROGS[progKey];
    if (st.fetch) { S.IR = P.instr; S.PC += 1; S.C = P.C || 0; return; }
    const val = (n) => (n === 'PC' ? S.PC : n === 'Z' ? S.Z : n === 'MDR' ? S.MDR : n === 'C' ? S.C : S.regs[n]);
    const b = st.out ? val(st.out) : null;
    if (st.alu === 'ADD') S.Z = S.Y + b;
    if (st.read) S.MDR = 0x4b;
    for (const d of st.in || []) {
      if (d === 'MAR') S.MAR = b;
      else if (d === 'PC') { if (!st.branch || S.CON) S.PC = b; }
      else if (d === 'Y') S.Y = b;
      else if (d === 'CON') S.CON = b === 0 ? 1 : 0;
      else S.regs[d] = b;
    }
  }
  function render(st) {
    const P = PROGS[progKey];
    const show = (id, v) => { boxes[id].v.textContent = v == null ? '' : v; };
    show('PC', hex(S.PC));
    show('IR', S.IR);
    show('C', S.IR && P.C != null ? hex(S.C) : '');
    show('MAR', hex(S.MAR));
    show('MDR', S.MDR == null ? '' : hex(S.MDR));
    show('Y', hex(S.Y));
    show('Z', hex(S.Z));
    show('CON', S.CON == null ? '' : String(S.CON));
    show('MEM', progKey === 'ld' && S.MAR === 0x75 ? 'M[0x75] = 0x4B' : '');
    show('IM', `M[${short(P.pc)}] = ${P.instr.split(' ')[0]}`);
    for (const r in regRows) regRows[r].v.textContent = hex(S.regs[r]);
    Object.values(boxes).forEach((bx) => bx.r.classList.remove('out', 'in'));
    Object.values(regRows).forEach((rr) => rr.bg.setAttribute('opacity', 0));
    Object.values(wires).forEach((w) => w.classList.remove('live', 'in', 'mem'));
    bus.classList.toggle('live', !!(st && st.out));
    aluT.textContent = st && st.alu ? st.alu : 'ALU';
    sigT.textContent = st ? st.t : '';
    if (!st) { pulse.setAttribute('cx', -20); return; }
    const mark = (id, cls) => {
      if (/^R\d$/.test(id)) {
        boxes.REG.r.classList.add(cls);
        regRows[id].bg.setAttribute('opacity', 1);
        regRows[id].bg.setAttribute('class', 'dp-box ' + cls);
        wires.busR.classList.add(cls === 'out' ? 'live' : 'in');
        return;
      }
      if (boxes[id]) boxes[id].r.classList.add(cls);
      const w = wires['bus' + id];
      if (w) w.classList.add(cls === 'out' ? 'live' : 'in');
    };
    if (st.fetch) {
      ['pcIM', 'imIR'].forEach((k) => wires[k].classList.add('mem'));
      boxes.IM.r.classList.add('out'); boxes.IR.r.classList.add('in'); boxes.PC.r.classList.add('in');
      movePulse([[500, 320], [500, 340], [500, 357], [260, 357]]);
      return;
    }
    if (st.out) mark(st.out, 'out');
    (st.in || []).forEach((d) => mark(d, 'in'));
    if (st.alu) {
      boxes.ALU.r.classList.add('in'); boxes.Z.r.classList.add('in');
      wires.aluA.classList.add('in'); wires.aluB.classList.add('live'); wires.aluZ.classList.add('in');
    }
    if (st.read) {
      wires.memA.classList.add('mem'); wires.memD.classList.add('mem');
      boxes.MEM.r.classList.add('out'); boxes.MDR.r.classList.add('in');
      movePulse([[30, 288], [22, 288], [22, 242], [30, 242]]);
      return;
    }
    const y = (id) => (/^R\d$/.test(id) ? 76 : boxes[id] ? boxes[id].cy : 0);
    const edge = (id) => (/^R\d$/.test(id) || ['C', 'MAR', 'MDR', 'MEM', 'IR'].includes(id) ? 260 : id === 'Z' ? 410 : 400);
    const dest = (st.in && st.in[0]) || (st.alu ? 'ALU' : null);
    const sx = edge(st.out), sy = y(st.out);
    const dx = dest === 'ALU' ? 552 : dest === 'Y' ? 400 : dest ? edge(dest) : sx;
    const dy = dest === 'ALU' ? 90 : dest === 'Y' ? 47 : dest ? y(dest) : sy;
    movePulse([[sx, sy], [BUS, sy], [BUS, dy], [dx, dy]]);
  }
  function movePulse(pts) {
    cancelAnimationFrame(anim);
    const segs = [0];
    for (let i = 1; i < pts.length; i++) segs.push(segs[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const t0 = performance.now();
    const step = (now) => {
      const k = clamp((now - t0) / 900);
      const L = segs[segs.length - 1] * smooth(k);
      let i = 1;
      while (i < segs.length - 1 && segs[i] < L) i++;
      const f = (L - segs[i - 1]) / Math.max(1e-6, segs[i] - segs[i - 1]);
      pulse.setAttribute('cx', lerp(pts[i - 1][0], pts[i][0], f).toFixed(1));
      pulse.setAttribute('cy', lerp(pts[i - 1][1], pts[i][1], f).toFixed(1));
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function go(target) {
    const P = PROGS[progKey];
    target = clamp(target, -1, P.steps.length - 1);
    reset();
    for (let i = 0; i <= target; i++) apply(P.steps[i]);
    idx = target;
    [...stepsEl.children].forEach((li, i) => { li.classList.toggle('now', i === idx); li.classList.toggle('done', i < idx); });
    render(idx >= 0 ? P.steps[idx] : null);
    explain.textContent = idx >= 0 ? P.steps[idx].say : IDLE;
    nextBtn.textContent = idx >= P.steps.length - 1 ? 'Start over' : 'Next step';
  }
  const IDLE = 'Press Next step to watch the instruction run, one clock at a time.';
  const nextBtn = document.getElementById('src-next');
  function next() { const P = PROGS[progKey]; go(idx >= P.steps.length - 1 ? -1 : idx + 1); }
  nextBtn.addEventListener('click', () => { stop(); next(); });
  document.getElementById('src-back').addEventListener('click', () => { stop(); go(idx - 1); });

  // On screen it plays by itself: ld, then add, then brzr, and round again. Pause and Play stop and
  // restart that loop, picking an instruction jumps to it, and Next, Back or a step in the list
  // stop the loop so you can step by hand.
  const playBtn = document.getElementById('src-play');
  const progBtns = [...document.querySelectorAll('[data-prog]')];
  const ORDER = progBtns.map((b) => b.dataset.prog);
  const BEAT = 2400;
  let looping = true, onScreen = false;
  function pick(key) {
    progKey = key;
    progBtns.forEach((x) => x.setAttribute('aria-pressed', x.dataset.prog === key ? 'true' : 'false'));
  }
  // the next clock, or the next instruction once this one has finished
  function beat() {
    if (idx >= PROGS[progKey].steps.length - 1) { pick(ORDER[(ORDER.indexOf(progKey) + 1) % ORDER.length]); go(0); }
    else next();
  }
  function schedule(wait = BEAT) {
    clearTimeout(timer);
    timer = looping && onScreen ? setTimeout(() => { beat(); schedule(); }, wait) : null;
  }
  function setLoop(on) {
    looping = on;
    playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    playBtn.textContent = on ? 'Pause' : 'Play';
    // read the words out when stepping by hand, not every few seconds while it plays
    explain.setAttribute('aria-live', on ? 'off' : 'polite');
  }
  function stop() { setLoop(false); schedule(); }
  playBtn.addEventListener('click', () => {
    if (looping) return stop();
    setLoop(true);
    beat();
    schedule();
  });
  progBtns.forEach((b) => b.addEventListener('click', () => {
    pick(b.dataset.prog);
    if (looping) { go(0); schedule(); } else go(-1);
  }));
  const panel = svg.closest('.src');
  if ('IntersectionObserver' in window && panel) {
    new IntersectionObserver(([e]) => {
      const on = e.intersectionRatio >= 0.3;
      if (on === onScreen) return;
      onScreen = on;
      schedule(idx < 0 ? 600 : BEAT);
    }, { threshold: [0, 0.3, 0.6] }).observe(panel);
  } else {
    onScreen = true;
  }

  // The loop changes the list and the words every few seconds, so the side column is held at its
  // tallest and the buttons at their widest, and nothing below or beside them jumps.
  const side = stepsEl.parentElement;
  function reserve() {
    for (const [btn, words] of [[nextBtn, ['Next step', 'Start over']], [playBtn, ['Play', 'Pause']]]) {
      const keep = btn.textContent;
      btn.style.minWidth = '';
      let w = 0;
      for (const t of words) { btn.textContent = t; w = Math.max(w, btn.getBoundingClientRect().width); }
      btn.textContent = keep;
      if (w) btn.style.minWidth = Math.ceil(w) + 'px';
    }
    side.style.minHeight = '';
    const width = side.getBoundingClientRect().width;
    if (!width) return;
    const probe = side.cloneNode(true);
    probe.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = `position:absolute;left:-9999px;top:0;width:${width}px;visibility:hidden`;
    document.body.appendChild(probe);
    const list = probe.querySelector('.src-steps'), say = probe.querySelector('.src-explain');
    let h = 0;
    for (const k of ORDER) {
      list.innerHTML = PROGS[k].steps.map((st) => `<li><b>${st.t}</b><span>${st.sig.join(', ')}</span></li>`).join('');
      for (const t of [IDLE, ...PROGS[k].steps.map((st) => st.say)]) { say.textContent = t; h = Math.max(h, probe.offsetHeight); }
    }
    probe.remove();
    side.style.minHeight = Math.ceil(h) + 'px';
  }
  let resizeT = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(reserve, 150); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(reserve);
  window.addEventListener('load', reserve);

  pick(ORDER[0]);
  setLoop(true);
  go(-1);
  reserve();
}

/* ---------------------------------------------------------------- */
/* Skills graph                                                      */
/* ---------------------------------------------------------------- */
const SKILLS = [
  ['Code', [
    ['C', ['courses'], "Systems and embedded courses at Queen's."],
    ['C++', ['ace', 'disp', 'courses'], 'ACE and the fluid and powder dispenser, both running on Arduino, plus course work.'],
    ['Python', ['navinst', 'classifier', 'duck', 'calian'], 'Calibration tools at NavINST, the activity classifier, the line follower, and tools at Calian.'],
    ['Java', ['fgc', 'courses'], "My team's FIRST Global robot code in 2022, and Queen's courses."],
    ['C#', ['side', 'courses'], 'Course work and side projects.'],
    ['Rust', ['side'], 'Side projects on my GitHub.'],
    ['R', ['classifier', 'side'], 'Statistics and data work.'],
    ['MATLAB', ['courses', 'navinst'], 'Signals and controls courses, and data work at NavINST.'],
    ['Verilog', ['src'], 'The Mini SRC processor: the ALU, loads and stores, and the branch logic.'],
    ['Linux and Bash', ['calian', 'navinst', 'duck'], 'Linux runs on every robot I have worked on, and so do the scripts around it.'],
    ['Qt', ['side'], 'Desktop interfaces for side projects.'],
    ['PowerShell', ['side'], 'Scripting on Windows.'],
  ]],
  ['Web', [
    ['HTML and CSS', ['site', 'web', 'logic'], 'This site, websites for local businesses, and the Logic Lab game.'],
    ['JavaScript', ['ace', 'site', 'logic', 'web'], 'The ACE web interface, this site, Logic Lab, and websites for local businesses.'],
    ['React', ['web', 'side'], 'Web apps and business websites.'],
    ['Node.js', ['web', 'side'], 'The servers behind web apps.'],
    ['Next.js', ['web', 'side'], 'Web apps and business websites.'],
    ['PHP', ['web'], 'Server code for local business websites.'],
    ['SQL', ['web', 'courses'], 'Databases behind the business websites, and course work.'],
    ['Firebase', ['web', 'side'], 'Sign in, databases and hosting for web apps.'],
    ['Google Cloud', ['side'], 'Hosting and services for side projects.'],
  ]],
  ['Robotics', [
    ['ROS 2', ['navinst', 'calian'], 'Moving sensor logs to ROS 2 at NavINST, and robots at Calian.'],
    ['GNSS and RTK', ['calian'], 'Positioning work at Calian.'],
    ['Sensor fusion', ['calian', 'navinst'], 'Combining satellite, inertial and other sensor data into one answer.'],
    ['IMUs', ['calian', 'navinst'], 'Inertial sensors that track turns and tilt between satellite fixes.'],
    ['SLAM', ['navinst'], "Benchmarking SLAM in places GPS can't reach, at NavINST."],
    ['Sensor calibration', ['navinst'], 'LiDAR, radar and stereo cameras merged into one point cloud at NavINST.'],
    ['LiDAR and radar', ['navinst'], 'Calibrating and benchmarking them at NavINST.'],
    ['Computer vision', ['navinst', 'duck'], 'Stereo cameras at NavINST, and reading AprilTag signs on the line follower.'],
    ['Navigation', ['calian', 'duck'], 'Robots that find their own way, by waypoints or by following a line.'],
    ['Motor control', ['knights', 'fgc', 'duck'], 'Driving mecanum, omni and plain wheels on three different robots.'],
    ['PX4', ['qadt'], 'Tuning a VTOL prototype with the Aerospace Design Team.'],
    ['Avionics', ['qadt'], 'Propulsion and flight electronics for the VTOL prototype.'],
  ]],
  ['Hardware', [
    ['Arduino', ['ace', 'disp'], 'ACE and the fluid and powder dispenser.'],
    ['Raspberry Pi', ['calian', 'duck'], 'The brains of the Quackston line follower, and robots at Calian.'],
    ['STM32', ['knights', 'courses'], 'Microcontroller boards for robots and labs.'],
    ['FPGA', ['src'], 'Running the Mini SRC on a DE0 CV board, built in Quartus.'],
    ['Embedded systems', ['ace', 'disp', 'src', 'knights'], 'Every project here with a microcontroller or an FPGA inside.'],
    ['KiCad and PCB design', ['ace', 'knights'], 'The ACE circuit boards, and boards for Knights Robotics.'],
    ['Power electronics', ['knights'], 'Capacitor banks, battery protection, MOSFETs and IGBTs at Knights Robotics.'],
    ['Battery management', ['knights'], 'Protection for our battery management system.'],
    ['Soldering and wiring', ['knights', 'duck', 'ace', 'sparq'], 'Harnesses, connectors and boards on every robot here.'],
    ['Sensors', ['duck', 'lunar', 'ace'], 'Ultrasonic, grayscale, soil and climate sensors.'],
    ['REV robotics kit', ['fgc'], 'The parts every FIRST Global robot is built from.'],
    ['3D printing', ['lunar', 'sparq'], 'The lunar rover body, and training people on the printers at SparQ.'],
    ['Test equipment', ['sparq', 'knights', 'courses'], 'Oscilloscopes, multimeters and bench supplies.'],
    ['Shop tools', ['sparq'], 'Laser cutters and power tools at SparQ.'],
  ]],
  ['Data', [
    ['NumPy and pandas', ['classifier', 'navinst'], 'Cleaning and segmenting sensor data.'],
    ['scikit learn', ['classifier'], 'The logistic regression model that tells walking from jumping.'],
    ['Matplotlib', ['classifier', 'navinst'], 'Plotting sensor data before and after processing.'],
    ['Signal processing', ['classifier', 'navinst'], 'Filtering and segmenting accelerometer and sensor logs.'],
    ['Data analysis', ['navinst', 'calian', 'classifier'], 'Turning sensor logs into plots and numbers.'],
    ['PyTorch', ['side'], 'Neural network experiments on my GitHub.'],
    ['TensorFlow', ['side'], 'Model training experiments on my GitHub.'],
  ]],
  ['Design', [
    ['SOLIDWORKS', ['lunar', 'disp'], 'The lunar rover and the dispenser.'],
    ['Technical drawings', ['disp', 'lunar'], 'Drawings like the dispenser sheet, ready to build from.'],
    ['Graphic design', ['ece'], 'Event graphics for the ECE Club.'],
    ['Figma', ['site', 'ece', 'side'], 'Layouts for sites and event graphics.'],
    ['LaTeX', ['courses', 'src'], 'Lab reports, including the Mini SRC write up.'],
    ['Git and GitHub', ['src', 'site', 'side'], 'Everything here that has code, including this site.'],
  ]],
  ['People', [
    ['Leading teams', ['ace', 'disp', 'lunar'], 'I led the ACE, dispenser and lunar rover projects.'],
    ['Mentoring', ['fgc'], 'FIRST Global teams, every year since 2022.'],
    ['Teaching', ['sparq', 'ece'], 'Training people on the printers at SparQ, and running academics for the ECE Club.'],
    ['Volunteering', ['fgc'], 'The Flying Squad at FIRST Global, fixing robots between matches.'],
  ]],
];
const PLACES = [
  ['Work', [['calian', 'Calian'], ['navinst', 'NavINST Lab'], ['sparq', 'SparQ Labs'], ['web', 'Local businesses']]],
  ['Teams', [['knights', 'Knights Robotics'], ['qadt', 'Aerospace Design Team'], ['ece', 'ECE Club'], ['fgc', 'FIRST Global']]],
  ['Projects', [['src', 'Mini SRC processor'], ['ace', 'ACE planter'], ['disp', 'Dispenser'], ['lunar', 'Lunar rover'], ['duck', 'Line follower'], ['classifier', 'Activity classifier'], ['logic', 'Logic Lab game'], ['site', 'This site'], ['side', 'Side projects'], ['courses', "Queen's courses"]]],
];

export function createGraph() {
  const root = document.getElementById('graph');
  if (!root) return { layout() {} };
  const colS = document.getElementById('graph-skills');
  const colP = document.getElementById('graph-places');
  const svg = document.getElementById('graph-lines');
  const note = document.getElementById('graph-note');
  const NS = 'http://www.w3.org/2000/svg';
  const skillNodes = [], placeNodes = new Map(), links = [];
  const joinWords = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  for (const [g, list] of SKILLS) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-group';
    wrap.innerHTML = `<h3>${g}</h3><ul></ul>`;
    const ul = wrap.querySelector('ul');
    for (const [name, places, text] of list) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'node'; b.textContent = name;
      b.setAttribute('aria-pressed', 'false');
      li.appendChild(b); ul.appendChild(li);
      skillNodes.push({ el: b, name, places, text });
    }
    colS.appendChild(wrap);
  }
  for (const [g, list] of PLACES) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-group';
    wrap.innerHTML = `<h3>${g}</h3><ul></ul>`;
    const ul = wrap.querySelector('ul');
    for (const [id, name] of list) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'node'; b.setAttribute('aria-pressed', 'false');
      li.appendChild(b); ul.appendChild(li);
      placeNodes.set(id, { el: b, id, name, skills: [] });
    }
    colP.appendChild(wrap);
  }
  for (const s of skillNodes) for (const p of s.places) {
    const pn = placeNodes.get(p);
    pn.skills.push(s.name);
    const path = document.createElementNS(NS, 'path');
    svg.appendChild(path);
    links.push({ s, p: pn, path });
  }
  for (const pn of placeNodes.values()) pn.el.innerHTML = `${pn.name}<span class="n">${pn.skills.length}</span>`;
  const idle = `${skillNodes.length} skills, ${placeNodes.size} places. Pick one.`;
  note.textContent = idle;
  let pinned = null;
  function show(sel) {
    const on = new Set(), lit = new Set();
    if (sel && sel.kind === 's') { on.add(sel.node.el); sel.node.places.forEach((p) => lit.add(placeNodes.get(p).el)); }
    if (sel && sel.kind === 'p') { on.add(sel.node.el); skillNodes.filter((s) => s.places.includes(sel.node.id)).forEach((s) => lit.add(s.el)); }
    const all = [...skillNodes.map((s) => s.el), ...[...placeNodes.values()].map((p) => p.el)];
    all.forEach((el) => {
      el.classList.toggle('on', on.has(el) || lit.has(el));
      el.classList.toggle('off', !!sel && !on.has(el) && !lit.has(el));
      el.setAttribute('aria-pressed', on.has(el) ? 'true' : 'false');
    });
    links.forEach((l) => {
      const hit = sel && ((sel.kind === 's' && l.s === sel.node) || (sel.kind === 'p' && l.p === sel.node));
      l.path.classList.toggle('on', !!hit);
      l.path.classList.toggle('off', !!sel && !hit);
    });
    if (!sel) note.textContent = idle;
    else if (sel.kind === 's') note.innerHTML = `<strong>${sel.node.name}.</strong> ${sel.node.text}`;
    else note.innerHTML = `<strong>${sel.node.name}.</strong> ${joinWords(sel.node.skills)}.`;
  }
  const bind = (node, kind) => {
    const sel = { kind, node };
    node.el.addEventListener('mouseenter', () => { if (!pinned) show(sel); });
    node.el.addEventListener('mouseleave', () => { if (!pinned) show(null); });
    node.el.addEventListener('focus', () => { if (!pinned) show(sel); });
    node.el.addEventListener('blur', () => { if (!pinned) show(null); });
    node.el.addEventListener('click', () => {
      pinned = pinned && pinned.node === node ? null : sel;
      show(pinned || sel);
      if (!pinned) show(null);
    });
  };
  skillNodes.forEach((s) => bind(s, 's'));
  placeNodes.forEach((p) => bind(p, 'p'));
  function layout() {
    const R = root.getBoundingClientRect();
    if (R.width < 10) return;
    svg.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`);
    links.forEach((l) => {
      const a = l.s.el.getBoundingClientRect(), b = l.p.el.getBoundingClientRect();
      const x1 = a.right - R.left, y1 = a.top + a.height / 2 - R.top;
      const x2 = b.left - R.left, y2 = b.top + b.height / 2 - R.top;
      const mx = (x1 + x2) / 2;
      l.path.setAttribute('d', `M${x1.toFixed(1)} ${y1.toFixed(1)} C${mx.toFixed(1)} ${y1.toFixed(1)}, ${mx.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    });
  }
  layout();
  return { layout };
}

/* ---------------------------------------------------------------- */
/* Work timeline                                                     */
/* ---------------------------------------------------------------- */
const ROWS = [
  ['Jobs and research', [
    ['Robotics and Systems Engineering Intern', 'Calian, Ottawa', [2026, 5], null, 'Calian', null,
      "Robotics and positioning work with GNSS and ROS 2. Most of it stays inside the building, so that's the short version."],
    ['Research Intern', 'NavINST Lab, Royal Military College', [2025, 5], [2025, 8], null, 'pictures/NAV.jpg',
      "Moved more than 10,000 sensor logs from ROS 1 to ROS 2 so the lab could use them in its navigation research. I calibrated LiDAR, radar and stereo cameras into one point cloud, wrote Python tools that cut calibration setup time by about 40 percent, and benchmarked SLAM and perception in places GPS can't reach."],
    ['Workshop Supervisor', "SparQ Labs, Queen's", [2024, 9], [2025, 5], null, 'pictures/Sparq.png',
      'Ran the makerspace day to day and helped students with hardware and fabrication. I trained people on oscilloscopes, 3D printers, laser cutters and power tools, and standardized the safety and maintenance routines so the machines stayed up.'],
    ['Web Developer', 'Local businesses, remote', [2020, 1], [2024, 7], null, 'pictures/LOCALB.jpg',
      'Built and maintained websites for small local businesses, working remotely.'],
  ]],
  ['Teams and clubs', [
    ['Electrical Engineer', "Queen's Knights Robotics", [2024, 9], null, null, 'pictures/KnightsRoboticslogo.png',
      "I design high energy capacitor banks and the protection for our battery management system, and I choose MOSFETs and IGBTs to match the motor loads so the robot holds up when it's pushed hard."],
    ['Research Team', "Queen's Aerospace Design Team", [2025, 9], [2026, 1], 'QADT', null,
      'Worked on the design and testing of a VTOL prototype, mostly propulsion integration, avionics setup and flight stability. With the mechanical, electrical and software subteams I tuned PX4 and the sensor configuration so it could hover steadily and fly on its own.'],
    ['Vice President of Academics', "Queen's ECE Club", [2025, 5], [2026, 5], 'ECE', null,
      'Represented electrical and computer engineering students in department and curriculum meetings, worked with faculty to improve courses and the program structure, and managed the BED Fund that buys new equipment for students.'],
    ['Team Executive', 'Canadian Space Agency team', [2025, 1], [2025, 5], null, 'pictures/CSA.png',
      'Designed rover subsystems for harsh environments with the team, integrated the electronics and tested traction ideas. I also prototyped control software and test tools to catch failure modes early.'],
    ['Computer Engineering Rep and Communications Coordinator', "Queen's ECE Club", [2024, 5], [2025, 5], 'ECE', null,
      "As the Computer Engineering representative I carried feedback from students to the department and the club. As communications coordinator I ran the club's social media and designed the graphics for its events."],
    ['Mentor and volunteer', 'FIRST Global Challenge', [2022, 1], null, null, 'pictures/FGCLogo.png',
      "Competed in Geneva in 2022 as my team's software programmer, then volunteered on the Flying Squad in Singapore, Athens and Panama City. I've mentored teams every year since 2022."],
  ]],
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function createTimeline() {
  const root = document.getElementById('tl');
  if (!root) return;
  const now = new Date();
  const y0 = 2020, y1 = now.getFullYear() + 1;
  const total = (y1 - y0) * 12;
  const pos = (y, m) => ((y - y0) * 12 + (m - 1)) / total;
  const nowX = clamp(((now.getFullYear() - y0) * 12 + now.getMonth() + now.getDate() / 31) / total);
  root.style.setProperty('--now', nowX.toFixed(4));
  let years = '';
  for (let y = y0; y < y1; y++) years += `<span style="--x:${((y - y0) / (y1 - y0)).toFixed(4)}">${y}</span>`;
  years += `<span class="now" style="--x:${nowX.toFixed(4)}">Now</span>`;
  const grid = Array.from({ length: y1 - y0 + 1 }, (_, i) => `<i style="--x:${(i / (y1 - y0)).toFixed(4)}"></i>`).join('');
  let html = `<div class="tl-scale" aria-hidden="true"><span></span><span class="tl-years">${years}</span><span></span></div>`;
  let n = 0;
  for (const [group, rows] of ROWS) {
    html += `<h3 class="tl-group">${group}</h3><ol class="tl-rows">`;
    for (const [title, org, s, e, word, img, detail] of rows) {
      const id = 'tl-' + n++;
      const sx = pos(s[0], s[1]);
      const ex = e ? pos(e[0], e[1]) : nowX;
      const date = `${MONTHS[s[1] - 1]} ${s[0]} to ${e ? MONTHS[e[1] - 1] + ' ' + e[0] : 'now'}`;
      const logo = img ? `<span class="logo"><img src="${img}" alt="" loading="lazy"></span>` : `<span class="logo logo-word" aria-hidden="true">${word}</span>`;
      html += `<li class="tl-row" style="--s:${sx.toFixed(4)};--e:${ex.toFixed(4)}">
        <button type="button" class="tl-btn" aria-expanded="false" aria-controls="${id}">
          <span class="tl-label">${logo}<span class="tl-text"><span class="tl-title">${title}</span><span class="tl-org">${org}</span><span class="tl-date">${date}</span></span></span>
          <span class="tl-track" aria-hidden="true">${grid}<span class="tl-now"></span><span class="tl-bar"></span></span>
          <span class="tl-plus" aria-hidden="true"></span>
        </button>
        <div class="tl-detail" id="${id}"><div><p>${detail}</p></div></div>
      </li>`;
    }
    html += '</ol>';
  }
  root.innerHTML = html;
  root.querySelectorAll('.tl-btn').forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('.tl-row');
    const open = !row.classList.contains('open');
    row.classList.toggle('open', open);
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }));
}

/* ---------------------------------------------------------------- */
/* Small things                                                      */
/* ---------------------------------------------------------------- */
export function initBits() {
  // copy email
  const btn = document.getElementById('copy-email');
  const done = document.getElementById('copy-done');
  const email = 'fayezismail2025@gmail.com';
  if (btn) btn.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(email); ok = true; } catch (e) {
      const t = document.createElement('textarea');
      t.value = email; document.body.appendChild(t); t.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      t.remove();
    }
    done.textContent = ok ? 'Copied' : 'Select the address to copy it';
    setTimeout(() => (done.textContent = ''), 2400);
  });
  // menu
  const menu = document.getElementById('menu-btn');
  const nav = document.getElementById('site-nav');
  if (menu) {
    menu.addEventListener('click', () => {
      const open = !nav.classList.contains('open');
      nav.classList.toggle('open', open);
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); }));
  }
  // photo viewer
  const dlg = document.getElementById('viewer');
  const img = document.getElementById('viewer-img');
  document.querySelectorAll('.real-btn, .shot-btn').forEach((b) => b.addEventListener('click', () => {
    const src = b.dataset.full || b.querySelector('img').src;
    img.src = src;
    img.alt = b.querySelector('img').alt;
    if (dlg.showModal) dlg.showModal(); else window.open(src, '_blank');
  }));
  if (dlg) dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  // loupe on the dispenser drawing
  document.querySelectorAll('[data-loupe]').forEach((box) => {
    const im = box.querySelector('img');
    const lens = document.createElement('div');
    lens.className = 'loupe';
    box.appendChild(lens);
    const Z = 2.6;
    box.addEventListener('mousemove', (e) => {
      const r = box.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      lens.style.left = x - 95 + 'px';
      lens.style.top = y - 95 + 'px';
      lens.style.backgroundImage = `url("${im.currentSrc || im.src}")`;
      lens.style.backgroundSize = `${r.width * Z}px ${r.height * Z}px`;
      lens.style.backgroundPosition = `${-(x * Z - 95)}px ${-(y * Z - 95)}px`;
    });
  });
}

export function setNav(id) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === id));
}

export { fmt };
