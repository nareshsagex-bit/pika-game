// Little Pika Run — a Chrome-dino style endless runner.
(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const muteBtn = document.getElementById("mute");

  // The play strip spans the full window width at a fixed height of H px;
  // the world just gets wider on wider screens. Narrow (phone) screens
  // shrink the strip so at least MIN_W of road stays visible.
  const H = 340;
  const MIN_W = 640;
  const GROUND = H - 60;
  let W = 960;
  let pxScale = 1;
  const topPad = 0;
  const viewH = H;

  function resize() {
    const vw = canvas.clientWidth || window.innerWidth;
    const cssH = Math.min(H, (vw * H) / MIN_W);
    W = Math.round((vw * H) / cssH);
    canvas.style.height = cssH + "px";
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(cssH * dpr);
    pxScale = canvas.width / W;
    initScenery();
  }

  const GRAVITY = 2700;
  const JUMP_VEL = -920;
  const START_SPEED = 300; // 1.0x
  const SPEED_STEP = 0.1; // +0.1x ...
  const STEP_EVERY = 15; // ... every 15 seconds
  const MAX_MULT = 3;

  // ---------- assets ----------
  const img = (src) => {
    const i = new Image();
    i.src = src;
    return i;
  };
  const pikaImg = img("assets/pika.png");
  const rocketImg = img("assets/rocket.png");

  // ---------- storage ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
  };

  // ---------- audio (all synthesized, no files needed) ----------
  const Sound = {
    ctx: null,
    master: null,
    music: null,
    sfx: null,
    muted: store.get("pika-muted", "0") === "1",
    playing: false,
    step: 0,
    nextTime: 0,
    timer: null,
    noiseBuf: null,
    bpm: 132,

    init() {
      if (this.ctx) {
        if (this.ctx.state === "suspended") this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0.45;
      this.music.connect(this.master);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.7;
      this.sfx.connect(this.master);

      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    },

    setMuted(m) {
      this.muted = m;
      store.set("pika-muted", m ? "1" : "0");
      if (this.master) {
        this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
      }
    },

    tone(type, f0, f1, t, dur, vol, dest) {
      const c = this.ctx;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dest || this.sfx);
      o.start(t);
      o.stop(t + dur + 0.02);
    },

    noise(t, dur, vol, filterType, freq, dest) {
      const c = this.ctx;
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(dest || this.sfx);
      s.start(t);
      s.stop(t + dur + 0.02);
    },

    // --- sound effects ---
    jump() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.tone("square", 380, 900, t, 0.14, 0.18);
    },
    duck() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.tone("triangle", 300, 140, t, 0.1, 0.25);
    },
    point() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.tone("square", 988, 988, t, 0.09, 0.12);
      this.tone("square", 1319, 1319, t + 0.09, 0.2, 0.12);
    },
    crash() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.noise(t, 0.35, 0.6, "lowpass", 1400);
      this.tone("sawtooth", 440, 60, t, 0.5, 0.25);
      // little "pika..." sad melody
      [659, 523, 392, 330].forEach((f, i) =>
        this.tone("triangle", f, f, t + 0.45 + i * 0.16, 0.18, 0.2)
      );
    },
    start() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [523, 659, 784, 1047].forEach((f, i) =>
        this.tone("square", f, f, t + i * 0.07, 0.12, 0.1)
      );
    },
    hurt() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.noise(t, 0.15, 0.4, "lowpass", 1200);
      this.tone("square", 520, 220, t, 0.25, 0.18);
    },
    rocketAlert() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.tone("sawtooth", 600, 900, t, 0.12, 0.08);
      this.tone("sawtooth", 600, 900, t + 0.15, 0.12, 0.08);
    },

    // --- background beat: kick / snare / hats / bass / arp ---
    // Chord roots per bar (A minor, F, C, G) as MIDI notes.
    progression: [45, 41, 48, 43],
    melody: [
      // 16 steps per bar, semitone offsets above the chord root (null = rest)
      [24, null, 19, null, 24, 27, null, 24, null, 19, 22, null, 24, null, 19, null],
      [24, null, 19, 21, null, 24, null, 28, null, 24, 19, null, 21, null, 24, null],
      [24, null, 28, null, 31, null, 28, 24, null, 28, null, 31, 33, null, 31, null],
      [26, null, 23, null, 19, null, 23, 26, null, 31, null, 26, 23, null, 19, 21],
    ],

    startMusic() {
      if (!this.ctx || this.playing) return;
      this.playing = true;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.05;
      this.music.gain.cancelScheduledValues(this.ctx.currentTime);
      this.music.gain.setValueAtTime(0.45, this.ctx.currentTime);
      this.timer = setInterval(() => this.schedule(), 25);
    },

    stopMusic() {
      if (!this.playing) return;
      this.playing = false;
      clearInterval(this.timer);
      const t = this.ctx.currentTime;
      this.music.gain.setTargetAtTime(0, t, 0.08);
    },

    schedule() {
      const stepDur = 60 / this.bpm / 4;
      while (this.nextTime < this.ctx.currentTime + 0.12) {
        this.playStep(this.step, this.nextTime, stepDur);
        this.nextTime += stepDur;
        this.step = (this.step + 1) % 64;
      }
    },

    playStep(step, t, dur) {
      const s = step % 16;
      const bar = Math.floor(step / 16);
      const root = this.progression[bar];
      const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
      const m = this.music;

      // kick
      if (s % 4 === 0) this.tone("sine", 150, 45, t, 0.18, 0.9, m);
      // snare
      if (s === 4 || s === 12) {
        this.noise(t, 0.14, 0.45, "bandpass", 1800, m);
        this.tone("triangle", 220, 180, t, 0.08, 0.25, m);
      }
      // hats (off-beats louder, little swing)
      if (s % 2 === 1) this.noise(t + 0.008, 0.04, 0.18, "highpass", 8000, m);
      else this.noise(t, 0.025, 0.07, "highpass", 9000, m);
      // bass: root on the beat, octave bounce on off-beats
      if (s % 4 === 0) this.tone("triangle", hz(root), hz(root), t, dur * 1.8, 0.45, m);
      else if (s % 4 === 2) this.tone("triangle", hz(root + 12), hz(root + 12), t, dur * 0.9, 0.3, m);
      // lead
      const n = this.melody[bar][s];
      if (n !== null) this.tone("square", hz(root + n), hz(root + n), t, dur * 1.6, 0.07, m);
    },
  };

  // ---------- game state ----------
  let state = "ready"; // ready | running | over
  let speed = START_SPEED;
  let distance = 0;
  let score = 0;
  let hiScore = parseInt(store.get("pika-hi", "0"), 10) || 0;
  let lastMilestone = 0;
  let spawnTimer = 0;
  let obstacles = [];
  let particles = [];
  let clouds = [];
  let hills = [];
  let pebbles = [];
  let flash = 0;
  let shake = 0;
  let deathCause = "";
  let time = 0;
  let overTime = 0;
  let runTime = 0;
  let speedMult = 1;
  let speedToast = 0;
  const MAX_LIVES = 3;
  const INVULN_TIME = 1.6;
  let lives = MAX_LIVES;
  let invuln = 0;
  let lostHeart = 0; // pop animation for the heart just lost

  const pika = {
    x: 80,
    y: 0, // feet offset above ground (0 = on ground, positive = up)
    vy: 0,
    w: 92,
    h: 80,
    ducking: false,
    onGround: true,
  };

  function resetWorld() {
    speed = START_SPEED;
    runTime = 0;
    speedMult = 1;
    lives = MAX_LIVES;
    invuln = 0;
    lostHeart = 0;
    speedToast = 0;
    distance = 0;
    score = 0;
    lastMilestone = 0;
    spawnTimer = 0.9;
    obstacles = [];
    particles = [];
    pika.y = 0;
    pika.vy = 0;
    pika.ducking = false;
    pika.onGround = true;
    deathCause = "";
  }

  function initScenery() {
    clouds = [];
    for (let i = 0; i < Math.ceil(W / 190); i++) {
      clouds.push({ x: Math.random() * W, y: 30 + Math.random() * 90, s: 0.6 + Math.random() * 0.6 });
    }
    hills = [];
    for (let i = 0; i < Math.ceil(W / 220) + 2; i++) {
      hills.push({ x: i * 220 + Math.random() * 60, w: 220 + Math.random() * 160, h: 40 + Math.random() * 50 });
    }
    pebbles = [];
    for (let i = 0; i < Math.ceil(W / 25); i++) {
      pebbles.push({ x: Math.random() * W, y: GROUND + 8 + Math.random() * (H - GROUND - 14), w: 2 + Math.random() * 6 });
    }
  }

  // ---------- obstacles ----------
  function makeHurdle(x) {
    const h = 38 + Math.floor(Math.random() * 3) * 10;
    return { kind: "hurdle", x, w: 34, h, y: GROUND - h };
  }

  function spawn() {
    const roll = Math.random();
    const x = W + 20;

    if (score > 350 && roll < 0.2) {
      // Team Rocket in their Meowth balloon — duck under the basket!
      const rh = 66;
      const rw = rh * (rocketImg.naturalWidth / rocketImg.naturalHeight || 1.27);
      obstacles.push({
        kind: "balloon",
        x,
        w: rw,
        h: rh,
        y: GROUND - 58 - rh,
        bob: Math.random() * 6,
        extra: 40,
      });
      Sound.rocketAlert();
    } else if (score > 120 && roll < 0.5) {
      // Team Rocket on foot — jump over them!
      const rh = 64;
      const rw = rh * (rocketImg.naturalWidth / rocketImg.naturalHeight || 1.27);
      obstacles.push({
        kind: "rocket",
        x,
        w: rw,
        h: rh,
        y: GROUND - rh,
        bob: Math.random() * 6,
        extra: 70,
        quote: QUOTES[Math.floor(Math.random() * QUOTES.length)],
      });
      Sound.rocketAlert();
    } else {
      // 1–3 hurdles in a row
      const count = score > 250 && Math.random() < 0.35 ? (Math.random() < 0.5 ? 2 : 3) : 1;
      for (let i = 0; i < count; i++) obstacles.push(makeHurdle(x + i * 40));
    }

    // gap scales with speed so jumps stay fair
    const minGap = 0.55 + 220 / speed;
    spawnTimer = minGap + Math.random() * 0.9;
  }

  const QUOTES = ["Prepare for trouble!", "Make it double!", "Meowth, that's right!", "Gimme that Pikachu!"];

  // ---------- hitboxes ----------
  function pikaBox() {
    const h = pika.ducking ? pika.h * 0.6 : pika.h;
    return {
      x: pika.x + 14,
      y: GROUND - pika.y - h + 8,
      w: pika.w - 30,
      h: h - 12,
    };
  }

  function obstacleBox(o) {
    if (o.kind === "hurdle") return { x: o.x + 2, y: o.y + 2, w: o.w - 4, h: o.h - 2 };
    const y = o.y + Math.sin(o.bob) * (o.kind === "balloon" ? 4 : 2);
    return { x: o.x + o.w * 0.12, y: y + o.h * 0.1, w: o.w * 0.76, h: o.h * 0.88 };
  }

  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ---------- input ----------
  function jump() {
    if (state !== "running") return startGame();
    if (pika.onGround) {
      pika.vy = -JUMP_VEL;
      pika.onGround = false;
      Sound.jump();
      for (let i = 0; i < 8; i++) puff(pika.x + 30, GROUND, -1);
    }
  }

  function setDuck(on) {
    if (state !== "running") return;
    if (on && !pika.ducking) Sound.duck();
    pika.ducking = on;
    // fast-fall when ducking mid-air, like the dino
    if (on && !pika.onGround && pika.vy > -300) pika.vy = -700;
  }

  function startGame() {
    if (state === "over" && time - overTime < 0.5) return; // avoid instant restart
    Sound.init();
    resetWorld();
    state = "running";
    Sound.start();
    Sound.startMusic();
  }

  function gameOver(cause) {
    state = "over";
    overTime = time;
    deathCause = cause;
    shake = 0.35;
    flash = 1;
    Sound.stopMusic();
    Sound.crash();
    if (score > hiScore) {
      hiScore = score;
      store.set("pika-hi", String(hiScore));
    }
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
      e.preventDefault();
      if (!e.repeat) jump();
    } else if (e.code === "ArrowDown" || e.code === "KeyS") {
      e.preventDefault();
      setDuck(true);
    } else if (e.code === "KeyM") {
      toggleMute();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowDown" || e.code === "KeyS") setDuck(false);
  });

  // Touch: tap upper/most of canvas to jump, hold lower-right quarter to duck.
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const rx = (e.clientX - r.left) / r.width;
    const ry = (e.clientY - r.top) / r.height;
    if (state === "running" && rx > 0.75 && ry > 0.6) setDuck(true);
    else jump();
  });
  window.addEventListener("pointerup", () => setDuck(false));

  function toggleMute() {
    Sound.setMuted(!Sound.muted);
    muteBtn.textContent = Sound.muted ? "🔇" : "🔊";
  }
  muteBtn.textContent = Sound.muted ? "🔇" : "🔊";
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    Sound.init();
    toggleMute();
    muteBtn.blur();
  });

  // ---------- particles ----------
  function puff(x, y, dir) {
    particles.push({
      x,
      y,
      vx: dir * (40 + Math.random() * 120),
      vy: -20 - Math.random() * 80,
      life: 0.4 + Math.random() * 0.3,
      max: 0.7,
      r: 3 + Math.random() * 4,
    });
  }

  // ---------- update ----------
  function update(dt) {
    time += dt;
    if (shake > 0) shake -= dt;
    if (flash > 0) flash -= dt * 3;
    if (lostHeart > 0) lostHeart -= dt;

    const moving = state === "running";
    const sceneSpeed = moving ? speed : state === "ready" ? 120 : 0;

    // scenery always drifts a bit
    for (const c of clouds) {
      c.x -= sceneSpeed * 0.08 * dt + 6 * dt;
      if (c.x < -120) {
        c.x = W + 40;
        c.y = 30 + Math.random() * 90;
      }
    }
    for (const h of hills) {
      h.x -= sceneSpeed * 0.25 * dt;
      if (h.x + h.w < 0) {
        h.x = Math.max(...hills.map((o) => o.x + o.w)) - 40;
        h.w = 220 + Math.random() * 160;
        h.h = 40 + Math.random() * 50;
      }
    }
    for (const p of pebbles) {
      p.x -= sceneSpeed * dt;
      if (p.x < -10) p.x += W + 20;
    }

    for (const p of particles) {
      p.x += p.vx * dt - sceneSpeed * 0.4 * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    if (!moving) return;

    // step up by 0.1x every 15 seconds, easing into the new speed
    runTime += dt;
    const target = Math.min(MAX_MULT, 1 + SPEED_STEP * Math.floor(runTime / STEP_EVERY));
    if (target > speedMult + 1e-9) {
      speedMult = target;
      speedToast = 1.6;
      Sound.point();
    }
    if (speedToast > 0) speedToast -= dt;
    speed += (START_SPEED * speedMult - speed) * Math.min(1, dt * 2);
    distance += speed * dt;
    score = Math.floor(distance / 40);

    if (Math.floor(score / 100) > lastMilestone) {
      lastMilestone = Math.floor(score / 100);
      Sound.point();
    }

    // pika physics
    if (!pika.onGround) {
      pika.vy -= GRAVITY * dt;
      pika.y += pika.vy * dt;
      if (pika.y <= 0) {
        pika.y = 0;
        pika.vy = 0;
        pika.onGround = true;
        for (let i = 0; i < 6; i++) puff(pika.x + 40, GROUND, -1);
      }
    } else if (Math.random() < dt * 25) {
      puff(pika.x + 6, GROUND - 6, -1); // scooter exhaust dust
    }

    // obstacles
    spawnTimer -= dt;
    if (spawnTimer <= 0) spawn();

    for (const o of obstacles) {
      o.x -= (speed + (o.extra || 0)) * dt;
      if (o.bob !== undefined) o.bob += dt * 10;
    }
    obstacles = obstacles.filter((o) => o.x + o.w > -60);

    if (invuln > 0) invuln -= dt;
    const pb = pikaBox();
    for (const o of obstacles) {
      if (invuln <= 0 && hit(pb, obstacleBox(o))) {
        lives--;
        if (lives <= 0) {
          gameOver(o.kind);
        } else {
          // lose a heart, blink for a moment and carry on
          invuln = INVULN_TIME;
          shake = 0.25;
          flash = 0.6;
          lostHeart = 0.6;
          Sound.hurt();
        }
        break;
      }
    }
  }

  // ---------- drawing ----------
  const INK = "#3a2a2a";

  function drawSky() {
    // sky slowly warms toward sunset as the score climbs, then loops
    const phase = (Math.sin(score / 400) + 1) / 2;
    const g = ctx.createLinearGradient(0, -topPad, 0, GROUND);
    g.addColorStop(0, lerpColor([255, 232, 150], [255, 170, 120], phase));
    g.addColorStop(1, lerpColor([253, 224, 128], [255, 205, 130], phase));
    ctx.fillStyle = g;
    ctx.fillRect(-10, -topPad - 10, W + 20, viewH + 20);

    // sun
    ctx.fillStyle = "rgba(255,255,240,0.75)";
    ctx.beginPath();
    ctx.arc(W - 150, 70 + phase * 30, 32, 0, Math.PI * 2);
    ctx.fill();
  }

  function lerpColor(a, b, t) {
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function drawClouds() {
    ctx.fillStyle = "rgba(255,250,235,0.85)";
    for (const c of clouds) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(c.s, c.s);
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.arc(22, -8, 22, 0, Math.PI * 2);
      ctx.arc(46, 0, 18, 0, Math.PI * 2);
      ctx.rect(0, 0, 46, 18);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawHills() {
    ctx.fillStyle = "rgba(230,180,90,0.55)";
    for (const h of hills) {
      ctx.beginPath();
      ctx.moveTo(h.x, GROUND);
      ctx.quadraticCurveTo(h.x + h.w / 2, GROUND - h.h * 2, h.x + h.w, GROUND);
      ctx.fill();
    }
  }

  function drawGround() {
    ctx.fillStyle = "#e9b866";
    ctx.fillRect(-10, GROUND, W + 20, viewH);
    ctx.fillStyle = INK;
    ctx.fillRect(-10, GROUND, W + 20, 3);
    ctx.fillStyle = "rgba(120,70,60,0.5)";
    for (const p of pebbles) ctx.fillRect(p.x, p.y, p.w, 2);
  }

  function drawHurdle(o) {
    const { x, y, w, h } = o;
    ctx.fillStyle = INK;
    // legs
    ctx.fillRect(x + 2, y + 4, 5, h - 4);
    ctx.fillRect(x + w - 7, y + 4, 5, h - 4);
    // feet
    ctx.fillRect(x - 4, GROUND - 4, 16, 4);
    ctx.fillRect(x + w - 12, GROUND - 4, 16, 4);
    // striped bar
    ctx.fillRect(x - 2, y - 2, w + 4, 14);
    const stripes = 4;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? "#ffffff" : "#d8333b";
      ctx.fillRect(x + (i * w) / stripes, y, w / stripes, 10);
    }
  }

  function drawRocket(o) {
    const bobY = Math.sin(o.bob) * (o.kind === "balloon" ? 4 : 2);
    const y = o.y + bobY;

    if (o.kind === "balloon") {
      const cx = o.x + o.w / 2;
      const by = y - 74;
      // ropes
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 28, by + 30);
      ctx.lineTo(o.x + 12, y + 8);
      ctx.moveTo(cx + 28, by + 30);
      ctx.lineTo(o.x + o.w - 12, y + 8);
      ctx.stroke();
      // Meowth-style balloon
      ctx.fillStyle = "#f3e2b8";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, by, 46, 40, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // ears
      ctx.beginPath();
      ctx.moveTo(cx - 38, by - 18);
      ctx.lineTo(cx - 44, by - 50);
      ctx.lineTo(cx - 18, by - 36);
      ctx.moveTo(cx + 38, by - 18);
      ctx.lineTo(cx + 44, by - 50);
      ctx.lineTo(cx + 18, by - 36);
      ctx.fill();
      ctx.stroke();
      // charm
      ctx.fillStyle = "#f2c94c";
      ctx.beginPath();
      ctx.ellipse(cx, by - 22, 9, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // eyes + grin
      ctx.fillStyle = INK;
      ctx.fillRect(cx - 18, by - 4, 8, 4);
      ctx.fillRect(cx + 10, by - 4, 8, 4);
      ctx.beginPath();
      ctx.arc(cx, by + 10, 14, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      // basket
      ctx.fillStyle = "#a56a3a";
      ctx.fillRect(o.x + 6, y + o.h * 0.55, o.w - 12, o.h * 0.45);
      ctx.strokeRect(o.x + 6, y + o.h * 0.55, o.w - 12, o.h * 0.45);
    }

    if (rocketImg.complete && rocketImg.naturalWidth) {
      ctx.drawImage(rocketImg, o.x, y, o.w, o.h);
    }

    if (o.kind === "balloon") {
      // basket front lip over their legs
      ctx.fillStyle = "#8b552c";
      ctx.fillRect(o.x + 6, y + o.h * 0.72, o.w - 12, o.h * 0.28);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.strokeRect(o.x + 6, y + o.h * 0.72, o.w - 12, o.h * 0.28);
    }

    if (o.quote && state === "running" && o.x < W - 40 && o.x > pika.x + 120) {
      speechBubble(o.quote, o.x + o.w / 2, y - 12);
    }
  }

  function speechBubble(text, x, y) {
    ctx.font = "bold 13px 'Trebuchet MS', sans-serif";
    const tw = ctx.measureText(text).width;
    const bw = tw + 16;
    const bh = 24;
    const bx = Math.min(W - bw - 4, x - bw / 2);
    const byy = y - bh;
    ctx.fillStyle = "#fffaf0";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, byy, bw, bh, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + 8, byy + bh / 2 + 1);
  }

  function drawPika() {
    const ducking = pika.ducking && state === "running";
    const bob = pika.onGround && state !== "over" ? Math.sin(time * 30) * 1.2 : 0;
    const h = ducking ? pika.h * 0.62 : pika.h;
    const w = ducking ? pika.w * 1.12 : pika.w;
    const footY = GROUND - pika.y + bob;

    // shadow
    const sh = Math.max(0.3, 1 - pika.y / 200);
    ctx.fillStyle = "rgba(90,50,60,0.25)";
    ctx.beginPath();
    ctx.ellipse(pika.x + pika.w / 2, GROUND + 2, 36 * sh, 5 * sh, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(pika.x + w / 2, footY - h / 2);
    let rot = 0;
    if (!pika.onGround) rot = -Math.max(-0.25, Math.min(0.25, pika.vy / 3500));
    if (state === "over") rot = 0.5;
    ctx.rotate(rot);
    if (invuln > 0 && state === "running" && Math.floor(time * 12) % 2) ctx.globalAlpha = 0.3;
    if (pikaImg.complete && pikaImg.naturalWidth) {
      ctx.drawImage(pikaImg, -w / 2, -h / 2, w, h);
    }
    ctx.restore();

    if (state === "over") {
      // dizzy stars
      for (let i = 0; i < 3; i++) {
        const a = time * 5 + (i * Math.PI * 2) / 3;
        star(pika.x + pika.w / 2 + Math.cos(a) * 28, footY - h - 6 + Math.sin(a) * 7, 6);
      }
    }
  }

  function star(x, y, r) {
    ctx.fillStyle = "#ffd23f";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.fillStyle = `rgba(200,150,110,${Math.max(0, p.life / p.max) * 0.7})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHUD() {
    ctx.fillStyle = INK;
    ctx.font = "bold 20px 'Courier New', monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const pad = (n) => String(n).padStart(5, "0");
    const blink = state === "running" && score > 0 && score % 100 < 6 && Math.floor(time * 8) % 2;
    ctx.fillText(`HI ${pad(hiScore)}  ${blink ? "     " : pad(score)}`, W - 120, 18);

    ctx.textAlign = "left";
    ctx.font = "bold 16px 'Courier New', monospace";
    ctx.fillText(`SPEED ${speedMult.toFixed(1)}x`, 18, 20);

    for (let i = 0; i < MAX_LIVES; i++) {
      const full = i < lives;
      let s = 1;
      if (!full && i === lives && lostHeart > 0) s = 1 + lostHeart; // pop as it empties
      heart(30 + i * 28, 54, 10 * s, full);
    }

    if (speedToast > 0 && state === "running") {
      const a = Math.min(1, speedToast);
      ctx.globalAlpha = a;
      centerText([[`Speed up! ${speedMult.toFixed(1)}x`, 24, "#c8323a", 70 - (1.6 - speedToast) * 10]]);
      ctx.globalAlpha = 1;
    }
  }

  function heart(x, y, r, full) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, r * 0.9);
    ctx.bezierCurveTo(-r * 1.4, -r * 0.1, -r * 0.8, -r * 1.2, 0, -r * 0.45);
    ctx.bezierCurveTo(r * 0.8, -r * 1.2, r * 1.4, -r * 0.1, 0, r * 0.9);
    ctx.closePath();
    ctx.fillStyle = full ? "#e0303a" : "rgba(255,246,216,0.6)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (full) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(-r * 0.45, -r * 0.35, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function centerText(lines) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach(([text, size, color, y]) => {
      ctx.font = `bold ${size}px 'Trebuchet MS', sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#fff6d8";
      ctx.strokeText(text, W / 2, y);
      ctx.fillStyle = color;
      ctx.fillText(text, W / 2, y);
    });
  }

  function draw() {
    ctx.setTransform(pxScale, 0, 0, pxScale, 0, topPad * pxScale);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6);

    drawSky();
    drawClouds();
    drawHills();
    drawGround();
    for (const o of obstacles) (o.kind === "hurdle" ? drawHurdle : drawRocket)(o);
    drawParticles();
    drawPika();
    ctx.save();
    ctx.translate(0, -topPad + Math.min(topPad, 30)); // keep the HUD near the top of tall screens
    drawHUD();
    ctx.restore();

    if (state === "ready") {
      centerText([
        ["Little Pika Run", 38, "#c8323a", 105],
        ["Press Space or tap to ride!", 20, INK, 150],
      ]);
    } else if (state === "over") {
      const msg =
        deathCause === "hurdle"
          ? "Bonk! Tripped on a hurdle"
          : "Team Rocket caught Pika!";
      centerText([
        ["GAME OVER", 40, "#c8323a", 95],
        [msg, 20, INK, 138],
        [score >= hiScore && score > 0 ? `New best: ${score}!` : `Score: ${score}`, 18, INK, 168],
        ["Space / tap to try again", 16, INK, 196],
      ]);
    }
    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.6})`;
      ctx.fillRect(-10, -topPad - 10, W + 20, viewH + 20);
    }
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  resetWorld();
  requestAnimationFrame(frame);

  // pause music when tab hidden
  document.addEventListener("visibilitychange", () => {
    if (!Sound.ctx) return;
    if (document.hidden) Sound.ctx.suspend();
    else Sound.ctx.resume();
  });
})();
