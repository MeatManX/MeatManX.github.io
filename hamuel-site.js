(() => {
  'use strict';

  const DATA = window.HAMUEL_AVATAR_DATA;
  if (!DATA) return;

  const $ = (id) => document.getElementById(id);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const rand = (min, max) => min + Math.random() * (max - min);

  function weightedChoice(pool) {
    const total = pool.reduce((sum, item) => sum + item[1], 0);
    let pick = Math.random() * total;
    for (const [name, weight] of pool) {
      pick -= weight;
      if (pick <= 0) return name;
    }
    return pool[pool.length - 1][0];
  }

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  }

  function mixHex(a, b, amount) {
    const ar = hexToRgb(a);
    const br = hexToRgb(b);
    const out = ar.map((v, i) => Math.round(v + (br[i] - v) * clamp(amount, 0, 1)));
    return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
  }

  class HamuelAvatar {
    constructor(canvas, stateLabel, statusLabel) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.stateLabel = stateLabel;
      this.statusLabel = statusLabel;
      this.state = 'idle';
      this.frameIndex = 0;
      this.tick = 0;
      this.lastFrameAt = 0;
      this.returnTimer = null;
      this.lastActivity = performance.now();
      this.nextAmbient = this.lastActivity + DATA.idleAmbientAfter * 1000;
      this.nextStrong = this.lastActivity + DATA.idleStrongAfter * 1000;
      this.lastIdleSequence = '';
      this.typingAttentionUsed = false;
      this.busy = false;
      this.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    isIdleState() {
      return this.state === 'idle' || this.state === 'blink' || this.state === 'attract' || this.state.startsWith('idle_');
    }

    noteActivity() {
      const now = performance.now();
      this.lastActivity = now;
      this.nextAmbient = now + DATA.idleAmbientAfter * 1000;
      this.nextStrong = now + DATA.idleStrongAfter * 1000;
      this.typingAttentionUsed = false;
    }

    setBusy(value) {
      this.busy = Boolean(value);
      if (!this.busy) this.noteActivity();
    }

    setState(state, options = {}) {
      if (!DATA.frames[state]) state = 'idle';
      if (this.returnTimer) {
        clearTimeout(this.returnTimer);
        this.returnTimer = null;
      }
      this.state = state;
      this.frameIndex = 0;
      this.lastFrameAt = 0;
      this.updateLabels();
      if (options.duration) {
        this.returnTimer = setTimeout(() => {
          this.setState(options.returnState || 'idle');
        }, options.duration * 1000);
      }
    }

    updateLabels() {
      const labels = {
        idle: 'IDLE', blink: 'IDLE', typing_attention: 'ATTENTION',
        thinking: 'THINKING', thinking_harder: 'THINKING HARDER',
        thinking_sweaty: 'THINKING VERY HARD', talking: 'TALKING',
        talking_linger: 'TALKING', tools: 'TOOLS', error: 'ERROR',
        attract: 'IDLE', idle_distracted: 'DISTRACTED', idle_mumble: 'MUMBLING',
        idle_whistle: 'WHISTLING', idle_suspicious: 'SUSPICIOUS',
        idle_curious: 'CURIOUS', idle_daydream: 'DAYDREAMING',
        idle_system_check: 'SYSTEM CHECK', idle_screensaver_eye: 'SCREENSAVER',
        idle_prompt_ready: 'READY'
      };
      if (this.stateLabel) this.stateLabel.textContent = labels[this.state] || this.state.toUpperCase();
      if (this.statusLabel && this.statusLabel.dataset.connection !== 'offline') {
        this.statusLabel.textContent = `LIVE // ${labels[this.state] || this.state.toUpperCase()}`;
      }
    }

    typingAttention() {
      if (this.busy || this.typingAttentionUsed || !this.isIdleState()) return;
      this.typingAttentionUsed = true;
      this.setState('typing_attention', { duration: 1.15, returnState: 'idle' });
    }

    startThinking() {
      this.setBusy(true);
      this.thinkingStarted = performance.now();
      this.setState('thinking');
    }

    updateThinking(now) {
      if (!this.busy || !this.thinkingStarted) return;
      const seconds = (now - this.thinkingStarted) / 1000;
      if (seconds >= DATA.thinkingSweatyAfter && this.state !== 'thinking_sweaty') {
        this.setState('thinking_sweaty');
      } else if (seconds >= DATA.thinkingHarderAfter && this.state === 'thinking') {
        this.setState('thinking_harder');
      }
    }

    startTalking() {
      this.thinkingStarted = 0;
      this.setState('talking');
    }

    finishTalking() {
      this.setState('talking_linger', { duration: DATA.talkingLingerSeconds, returnState: 'idle' });
      this.setBusy(false);
    }

    fail() {
      this.thinkingStarted = 0;
      this.setState('error', { duration: 3.2, returnState: 'idle' });
      this.setBusy(false);
    }

    chooseIdle(pool, idleMs) {
      let filtered = pool;
      if (idleMs < 90000) filtered = pool.filter(([name]) => name !== 'attract');
      if (!filtered.length) filtered = pool;
      let choice = weightedChoice(filtered);
      for (let i = 0; i < 3 && choice === this.lastIdleSequence; i++) choice = weightedChoice(filtered);
      this.lastIdleSequence = choice;
      return choice;
    }

    idleDuration(state) {
      if (state === 'idle_screensaver_eye') return rand(4, 6);
      if (state === 'idle_system_check') return rand(3, 5);
      if (state === 'idle_whistle') return rand(5, 8);
      if (state === 'idle_mumble' || state === 'idle_distracted') return rand(3, 5.5);
      if (state === 'attract') return rand(4, 7);
      return rand(3, 6);
    }

    runIdleScheduler(now) {
      if (this.busy || !this.isIdleState() || this.reducedMotion) return;
      const idleMs = now - this.lastActivity;
      if (idleMs >= DATA.idleStrongAfter * 1000 && now >= this.nextStrong) {
        const state = this.chooseIdle(DATA.idleStrongPool, idleMs);
        this.nextStrong = now + rand(DATA.idleStrongMinGap, DATA.idleStrongMinGap + 10) * 1000;
        this.nextAmbient = now + rand(DATA.idleAmbientMinGap, DATA.idleAmbientMinGap + 5) * 1000;
        this.setState(state, { duration: this.idleDuration(state), returnState: 'idle' });
        return;
      }
      if (idleMs >= DATA.idleAmbientAfter * 1000 && now >= this.nextAmbient) {
        const state = this.chooseIdle(DATA.idleAmbientPool, idleMs);
        this.nextAmbient = now + rand(DATA.idleAmbientMinGap, DATA.idleAmbientMinGap + 7) * 1000;
        this.setState(state, { duration: this.idleDuration(state), returnState: 'idle' });
      }
    }

    filteredFrame(frame, config) {
      const out = frame.map((row) => row.split('').map(Number));
      if (this.reducedMotion) return out;
      const crt = DATA.crt;
      const noiseChance = config.noise * crt.noise_mult;
      for (let y = 0; y < DATA.height; y++) {
        for (let x = 0; x < DATA.width; x++) {
          if (out[y][x] === 0 && Math.random() < noiseChance) {
            out[y][x] = Math.random() < crt.noise_sparkle ? 3 : 2;
          }
        }
      }
      if (Math.random() < config.glitch * crt.glitch_mult) {
        const count = this.state === 'error' ? 1 + Math.floor(Math.random() * 3) : 1;
        for (let i = 0; i < count; i++) {
          const y = 3 + Math.floor(Math.random() * (DATA.height - 6));
          let shift = 0;
          while (!shift) shift = Math.floor(rand(-crt.glitch_shift, crt.glitch_shift + 1));
          const row = out[y];
          out[y] = shift > 0
            ? row.slice(-shift).concat(row.slice(0, -shift))
            : row.slice(-shift).concat(row.slice(0, -shift));
        }
      }
      return out;
    }

    render() {
      const config = DATA.stateConfig[this.state] || DATA.stateConfig.idle;
      const palette = DATA.palettes[config.palette];
      const frames = DATA.frames[this.state] || DATA.frames.idle;
      const frame = frames[this.frameIndex % frames.length];
      const pixels = this.filteredFrame(frame, config);
      const w = this.canvas.width / DATA.width;
      const h = this.canvas.height / DATA.height;
      const pulse = this.reducedMotion ? 0 : (Math.sin(this.tick * 0.18) + 1) / 2;
      const screen = mixHex(palette.screen, palette.noise_bright, DATA.crt.glow_pulse * pulse);
      const dim = mixHex(screen, palette.screen_dim, DATA.crt.scanline_strength);
      const scanOffset = Math.floor(this.tick / DATA.crt.scanline_vibrate_speed) % 2;

      this.ctx.fillStyle = screen;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      for (let y = 0; y < DATA.height; y++) {
        const scanDim = DATA.crt.scanlines_enabled && ((Math.floor(y / 2) + scanOffset) % 2);
        for (let x = 0; x < DATA.width; x++) {
          const value = pixels[y][x];
          if (value === 1) this.ctx.fillStyle = palette.face;
          else if (value === 2) this.ctx.fillStyle = palette.noise_dim;
          else if (value === 3) this.ctx.fillStyle = palette.noise_bright;
          else this.ctx.fillStyle = scanDim ? dim : screen;
          this.ctx.fillRect(Math.floor(x * w), Math.floor(y * h), Math.ceil(w), Math.ceil(h));
        }
      }
    }

    loop(now) {
      const config = DATA.stateConfig[this.state] || DATA.stateConfig.idle;
      const interval = (this.reducedMotion ? Math.max(config.interval, 1.5) : config.interval) * 1000;
      if (!this.lastFrameAt || now - this.lastFrameAt >= interval) {
        this.lastFrameAt = now;
        this.frameIndex = (this.frameIndex + 1) % (DATA.frames[this.state] || DATA.frames.idle).length;
        this.tick += 1;
        this.render();
      }
      this.updateThinking(now);
      this.runIdleScheduler(now);
      requestAnimationFrame(this.loop);
    }
  }

  function sessionId() {
    const key = 'hamuel_web_session_v1';
    let value = sessionStorage.getItem(key);
    if (/^[A-Za-z0-9_-]{8,80}$/.test(value || '')) return value;
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    value = 'web_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(key, value);
    return value;
  }

  function init() {
    const terminal = document.querySelector('.hamuel-terminal');
    const canvas = $('hamuel-avatar');
    const form = $('hamuel-form');
    const input = $('hamuel-input');
    const transcript = $('hamuel-transcript');
    const status = $('hamuel-status');
    const stateLabel = $('hamuel-avatar-state');
    if (!terminal || !canvas || !form || !input || !transcript) return;

    const gateway = terminal.dataset.gateway || window.HAMUEL_GATEWAY_URL || '';
    const avatar = new HamuelAvatar(canvas, stateLabel, status);
    const sendButton = form.querySelector('button[type="submit"]');
    const quickButtons = [...document.querySelectorAll('[data-hamuel-question]')];
    let requestInFlight = false;

    function setControls(disabled) {
      requestInFlight = disabled;
      input.disabled = disabled;
      sendButton.disabled = disabled;
      quickButtons.forEach((button) => { button.disabled = disabled; });
    }

    function addLine(label, text, user = false) {
      const p = document.createElement('p');
      p.className = 'hamuel-line' + (user ? ' user' : '');
      const strong = document.createElement('strong');
      strong.textContent = label + ':';
      p.append(strong, document.createTextNode(' ' + text));
      transcript.appendChild(p);
      transcript.scrollTop = transcript.scrollHeight;
      return p;
    }

    async function typeHamuel(text) {
      const p = document.createElement('p');
      p.className = 'hamuel-line';
      const strong = document.createElement('strong');
      strong.textContent = 'HAMUEL:';
      const node = document.createTextNode(' ');
      p.append(strong, node);
      transcript.appendChild(p);
      avatar.startTalking();
      const chunk = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? text.length : 7;
      for (let i = 0; i < text.length; i += chunk) {
        node.textContent += text.slice(i, i + chunk);
        transcript.scrollTop = transcript.scrollHeight;
        if (chunk < text.length) await new Promise((resolve) => setTimeout(resolve, 18));
      }
      avatar.finishTalking();
    }

    async function askHamuel(question) {
      const clean = String(question || '').trim().slice(0, 1000);
      if (!clean || requestInFlight) return;
      avatar.noteActivity();
      addLine('YOU', clean, true);
      input.value = '';
      setControls(true);
      avatar.startThinking();

      if (!gateway) {
        avatar.fail();
        await typeHamuel('My public connection is not online yet. The website interface is ready, but the server gateway still needs to be published.');
        setControls(false);
        input.focus();
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 80000);
      try {
        const response = await fetch(gateway.replace(/\/$/, '') + '/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean, session_id: sessionId() }),
          signal: controller.signal
        });
        let payload = {};
        try { payload = await response.json(); } catch (_) {}
        if (!response.ok || !payload.ok || !payload.response) {
          if (response.status === 429) throw new Error('rate_limited');
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        await typeHamuel(String(payload.response));
      } catch (error) {
        avatar.fail();
        const message = error && error.message === 'rate_limited'
          ? 'That is enough questions for one minute. Give me a moment and try again.'
          : 'I lost the connection to the server. The rest of the site still works; try me again in a minute.';
        addLine('HAMUEL', message);
      } finally {
        clearTimeout(timer);
        setControls(false);
        input.focus();
      }
    }

    input.addEventListener('input', () => {
      avatar.noteActivity();
      if (input.value.trim()) avatar.typingAttention();
    });
    input.addEventListener('focus', () => avatar.noteActivity());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      askHamuel(input.value);
    });
    quickButtons.forEach((button) => {
      button.addEventListener('click', () => askHamuel(button.dataset.hamuelQuestion || ''));
    });

    if (status) {
      if (!gateway) {
        status.dataset.connection = 'offline';
        status.textContent = 'LOCAL PREVIEW';
      } else {
        fetch(gateway.replace(/\/$/, '') + '/health', { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error('offline');
            status.dataset.connection = 'online';
            avatar.updateLabels();
          })
          .catch(() => {
            status.dataset.connection = 'offline';
            status.textContent = 'OFFLINE';
          });
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
