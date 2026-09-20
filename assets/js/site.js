/* ==========================================================================
   余量 MARGIN — 交互层 v2
   --------------------------------------------------------------------------
   零依赖原生 ES2020。全部功能为渐进增强：脚本失效时页面仍完整可读可导航。

   A 主题（含 View Transitions 圆形扩散转场）
   B 示波器视窗（Canvas 实时波形，含周期性"掉线"）
   C 光标聚光 + 磁吸（桌面端指针增强）
   D 滚动：进度 / 交错进场 / 数字滚动
   E 目录自动生成 + 滚动高亮
   F 归档实时过滤（/ 聚焦，Esc 清空）
   G 代码块复制
   H 抽屉导航（焦点陷阱 + Esc + 遮罩）
   ========================================================================== */
(() => {
  'use strict';

  const doc = document;
  const root = doc.documentElement;
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mqFine = window.matchMedia('(pointer: fine)');
  const reduced = () => mqReduce.matches;
  const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

  /* ======================================================================
     A 主题
     ====================================================================== */
  const THEME_KEY = 'margin-theme';
  const themeButtons = () => doc.querySelectorAll('[data-theme-toggle]');
  const currentTheme = () => (root.getAttribute('data-theme') === 'day' ? 'day' : 'night');

  const paintThemeLabel = () => {
    const isNight = currentTheme() === 'night';
    themeButtons().forEach((btn) => {
      btn.setAttribute('aria-label', isNight ? '切换到明室模式' : '切换到暗房模式');
    });
  };

  const applyTheme = (theme) => {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* 隐私模式忽略 */ }
    paintThemeLabel();
    doc.dispatchEvent(new CustomEvent('margin:theme', { detail: { theme } }));
  };

  const toggleTheme = (origin) => {
    const next = currentTheme() === 'night' ? 'day' : 'night';

    /* 不支持 View Transitions 或要求减弱动效：直接切换 */
    if (!doc.startViewTransition || reduced()) {
      applyTheme(next);
      return;
    }
    /* 扩散圆心 = 点击位置 */
    if (origin) {
      root.style.setProperty('--vt-x', `${origin.x}px`);
      root.style.setProperty('--vt-y', `${origin.y}px`);
    }
    doc.startViewTransition(() => applyTheme(next));
  };

  themeButtons().forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const r = btn.getBoundingClientRect();
      toggleTheme({
        x: e.clientX || r.left + r.width / 2,
        y: e.clientY || r.top + r.height / 2,
      });
    });
  });
  paintThemeLabel();

  /* ======================================================================
     B 示波器视窗
     ====================================================================== */
  const initScope = (host) => {
    const canvas = host.querySelector('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let visible = true;

    /* 三条通道：主信号 / 干扰 / 参考。颜色取自 CSS 变量，随主题实时变化。 */
    const channels = [
      { v: '--phos',  amp: 0.30, freq: 1.60, noise: 0.10, speed: 1.00, width: 1.7, alpha: 0.95 },
      { v: '--amber', amp: 0.16, freq: 3.10, noise: 0.06, speed: 0.72, width: 1.2, alpha: 0.62 },
      { v: '--cyan',  amp: 0.10, freq: 5.40, noise: 0.04, speed: 1.35, width: 1.0, alpha: 0.42 },
    ];

    const cssColor = (name, fallback) => {
      const val = getComputedStyle(root).getPropertyValue(name).trim();
      return val || fallback;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduced()) frame(performance.now() / 1000);
    };

    /* 周期性"掉线"窗口：每 9 秒一次 0.45 秒的静默，呼应站内那篇文章 */
    const silenceAt = (sec) => {
      const phase = sec % 9;
      return phase > 6.6 && phase < 7.05;
    };

    const channelValue = (ch, u, sec) => {
      const p = u * Math.PI * 2 * ch.freq + sec * ch.speed * Math.PI;
      const base = Math.sin(p) * 0.62 + Math.sin(p * 2.3 + 1.1) * 0.24 + Math.sin(p * 5.1) * 0.14;
      const drift = Math.sin(u * Math.PI * 2 * 0.6 + sec * 0.4) * ch.noise;
      return base * ch.amp + drift;
    };

    const frame = (sec) => {
      ctx.clearRect(0, 0, w, h);
      const mid = h / 2;
      const silent = silenceAt(sec);

      channels.forEach((ch, idx) => {
        const color = cssColor(ch.v, '#5EE39B');
        const broken = silent && idx === 0;

        /* 同一路径描两遍：宽而淡 = 辉光，细而实 = 轨迹（比 shadowBlur 快得多） */
        for (let pass = 0; pass < 2; pass += 1) {
          ctx.beginPath();
          ctx.globalAlpha = (pass === 0 ? 0.13 : ch.alpha) * (broken ? 0.25 : 1);
          ctx.strokeStyle = color;
          ctx.lineWidth = pass === 0 ? ch.width * 5 : ch.width;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';

          const step = w < 520 ? 3 : 2;
          for (let x = 0; x <= w; x += step) {
            const u = x / w;
            const v = broken ? 0 : channelValue(ch, u, sec);
            const y = mid - v * mid * 0.92;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        /* 主通道末端游标 */
        if (idx === 0) {
          const v = broken ? 0 : channelValue(ch, 1, sec);
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(w - 3, mid - v * mid * 0.92, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      /* 扫描线：拖尾渐变 + 亮线 */
      const sweepX = ((sec * 0.42) % 1) * w;
      const grad = ctx.createLinearGradient(sweepX - 48, 0, sweepX, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, cssColor('--phos', '#5EE39B'));
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = grad;
      ctx.fillRect(sweepX - 48, 0, 48, h);
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = cssColor('--phos', '#5EE39B');
      ctx.fillRect(sweepX - 1, 0, 1, h);
      ctx.globalAlpha = 1;
    };

    const loop = (now) => {
      frame(now / 1000);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (raf || reduced() || !visible) return;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    /* 仅在实际可见时绘制：省电，低端设备更流畅 */
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          visible = en.isIntersecting;
          if (visible) start(); else stop();
        });
      }, { threshold: 0 }).observe(canvas);
    } else {
      start();
    }

    doc.addEventListener('visibilitychange', () => { if (doc.hidden) stop(); else start(); });
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);

    mqReduce.addEventListener('change', () => {
      if (reduced()) { stop(); frame(performance.now() / 1000); } else start();
    });
    doc.addEventListener('margin:theme', () => {
      if (reduced() || !raf) frame(performance.now() / 1000);
    });

    resize();
    frame(performance.now() / 1000);
    start();

    /* 实时读数：数字在面板里跳动 */
    const readouts = doc.querySelectorAll('[data-scope-live]');
    if (readouts.length) {
      window.setInterval(() => {
        if (doc.hidden) return;
        const sec = performance.now() / 1000;
        const silent = silenceAt(sec);
        readouts.forEach((el) => {
          const kind = el.getAttribute('data-scope-live');
          if (kind === 'freq') {
            el.textContent = silent ? '--.- Hz' : `${(1.6 + Math.sin(sec * 0.7) * 0.06).toFixed(2)} Hz`;
          } else if (kind === 'amp') {
            el.textContent = silent ? '0.00 V' : `${(3.28 + Math.sin(sec * 1.9) * 0.03).toFixed(2)} V`;
          } else if (kind === 'state') {
            el.textContent = silent ? 'NO SIGNAL' : 'LOCKED';
            el.style.color = silent ? 'var(--amber)' : 'var(--phos)';
          }
        });
      }, 240);
    }
  };

  doc.querySelectorAll('[data-scope]').forEach(initScope);

  /* ======================================================================
     C 光标聚光 + 磁吸
     ====================================================================== */
  if (mqFine.matches && !reduced()) {
    const spot = doc.createElement('div');
    spot.className = 'spotlight';
    spot.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(spot);

    let sx = 0;
    let sy = 0;
    let cx = 0;
    let cy = 0;
    let spotRaf = 0;

    const follow = () => {
      cx += (sx - cx) * 0.14;
      cy += (sy - cy) * 0.14;
      spot.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
      if (Math.abs(sx - cx) > 0.4 || Math.abs(sy - cy) > 0.4) spotRaf = requestAnimationFrame(follow);
      else spotRaf = 0;
    };

    window.addEventListener('pointermove', (e) => {
      sx = e.clientX;
      sy = e.clientY;
      spot.classList.add('is-on');
      if (!spotRaf) spotRaf = requestAnimationFrame(follow);
    }, { passive: true });
    window.addEventListener('pointerleave', () => spot.classList.remove('is-on'));

    /* 磁吸：指针靠近时轻微吸附，离开时弹回（直接操纵感） */
    const MAGNET_PULL = 4;
    doc.querySelectorAll('.btn, .icon-btn').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        el.style.transform = `translate3d(${(dx * MAGNET_PULL).toFixed(2)}px, ${(dy * MAGNET_PULL).toFixed(2)}px, 0)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ======================================================================
     D 滚动：进度 / 交错进场 / 数字滚动
     ====================================================================== */
  const progressBar = doc.querySelector('.progress__bar');
  if (progressBar) {
    const target = doc.querySelector('.prose') || doc.body;
    let raf = 0;
    const update = () => {
      const rect = target.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const done = total > 0 ? -rect.top / total : (rect.bottom < window.innerHeight ? 1 : 0);
      progressBar.style.width = `${Math.min(100, Math.max(0, done * 100)).toFixed(2)}%`;
      raf = 0;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /* 交错进场：同容器内元素依次上浮，间隔 70ms */
  const revealEls = doc.querySelectorAll('[data-reveal]');
  if (revealEls.length && 'IntersectionObserver' in window && !reduced()) {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        const group = el.parentElement
          ? [...el.parentElement.querySelectorAll('[data-reveal]')]
          : [el];
        const idx = Math.max(0, group.indexOf(el));
        el.style.transitionDelay = `${Math.min(idx * 70, 420)}ms`;
        el.classList.add('is-in');
        obs.unobserve(el);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-in'));
  }

  /* 数字滚动：进入视口时从 0 数到目标值 */
  const counters = doc.querySelectorAll('[data-count]');
  if (counters.length) {
    const run = (el) => {
      const to = parseFloat(el.getAttribute('data-count')) || 0;
      const dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
      const suffix = el.getAttribute('data-suffix') || '';
      if (reduced()) { el.textContent = to.toFixed(dec) + suffix; return; }
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / 900);
        el.textContent = (to * easeOutExpo(p)).toFixed(dec) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach((en) => {
          if (en.isIntersecting) { run(en.target); obs.unobserve(en.target); }
        });
      }, { threshold: 0.4 });
      counters.forEach((el) => { el.textContent = '0'; io.observe(el); });
    } else {
      counters.forEach(run);
    }
  }

  /* ======================================================================
     E 目录：从 h2 自动生成 + 滚动高亮
     ====================================================================== */
  const tocBox = doc.querySelector('.notes__toc');
  const prose = doc.querySelector('.prose');
  if (tocBox && prose) {
    const heads = [...prose.querySelectorAll('h2')];
    if (heads.length) {
      const used = new Set();
      const slug = (text) => (text || '').trim().toLowerCase()
        .replace(/[\s\u3000]+/g, '-')
        .replace(/[^\w\u4e00-\u9fa5-]/g, '')
        .slice(0, 48) || 'sec';

      const ol = doc.createElement('ol');
      const links = [];
      heads.forEach((h) => {
        /* 标题里的 <span class="h2num">01</span> 只是视觉编号，不进锚点和目录文本 */
        const label = h.textContent.replace(/^\d{2}\s*/, '').trim();
        if (!h.id) {
          const base = slug(label);
          let id = base;
          let n = 2;
          while (used.has(id) || doc.getElementById(id)) { id = `${base}-${n}`; n += 1; }
          used.add(id);
          h.id = id;
        }
        const li = doc.createElement('li');
        const a = doc.createElement('a');
        a.href = `#${h.id}`;
        a.textContent = label;
        li.appendChild(a);
        ol.appendChild(li);
        links.push(a);
      });

      const title = doc.createElement('h4');
      title.textContent = '本文目录';
      tocBox.append(title, ol);

      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((en) => {
            if (!en.isIntersecting) return;
            links.forEach((x) => x.classList.remove('is-active'));
            const active = tocBox.querySelector(`a[href="#${en.target.id}"]`);
            if (active) active.classList.add('is-active');
          });
        }, { rootMargin: '-12% 0px -72% 0px', threshold: 0 });
        heads.forEach((h) => io.observe(h));
      }
    }
  }

  /* ======================================================================
     F 归档实时过滤
     ====================================================================== */
  const input = doc.querySelector('#q');
  if (input) {
    const rows = [...doc.querySelectorAll('[data-search]')];
    const counter = doc.querySelector('#count');
    const emptyBox = doc.querySelector('.empty');
    const years = [...doc.querySelectorAll('.year')];

    const filter = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      rows.forEach((row) => {
        const hit = !q || (row.getAttribute('data-search') || '').toLowerCase().includes(q);
        row.style.display = hit ? '' : 'none';
        if (hit) shown += 1;
      });
      years.forEach((y) => {
        let any = false;
        let n = y.nextElementSibling;
        while (n && !n.classList.contains('year')) {
          if (n.hasAttribute('data-search') && n.style.display !== 'none') { any = true; break; }
          n = n.nextElementSibling;
        }
        y.style.display = any ? '' : 'none';
      });
      if (counter) {
        counter.textContent = q
          ? `匹配 ${shown} / ${rows.length} 篇`
          : `共 ${rows.length} 篇`;
      }
      if (emptyBox) emptyBox.style.display = shown ? 'none' : '';
    };

    input.addEventListener('input', filter);
    doc.addEventListener('keydown', (e) => {
      const tag = (doc.activeElement && doc.activeElement.tagName) || '';
      if (e.key === '/' && doc.activeElement !== input && !/^(INPUT|TEXTAREA)$/.test(tag)) {
        e.preventDefault();
        input.focus();
        input.select();
      } else if (e.key === 'Escape' && doc.activeElement === input) {
        input.value = '';
        filter();
        input.blur();
      }
    });
    filter();
  }

  /* ======================================================================
     G 代码块复制
     ====================================================================== */
  doc.querySelectorAll('.codeblock').forEach((block) => {
    const bar = block.querySelector('.codeblock__bar');
    const pre = block.querySelector('pre');
    if (!bar || !pre) return;

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = '复制';

    btn.addEventListener('click', () => {
      const text = pre.innerText;
      const done = (ok) => {
        btn.textContent = ok ? '已复制' : '失败';
        window.setTimeout(() => { btn.textContent = '复制'; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
      } else {
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:absolute;left:-9999px';
        doc.body.appendChild(ta);
        ta.select();
        try { done(doc.execCommand('copy')); } catch (_) { done(false); }
        doc.body.removeChild(ta);
      }
    });

    bar.appendChild(btn);
  });

  /* ======================================================================
     H 抽屉导航
     ====================================================================== */
  const drawer = doc.querySelector('.drawer');
  const overlay = doc.querySelector('.overlay');
  if (drawer && overlay) {
    let lastFocused = null;

    const open = () => {
      lastFocused = doc.activeElement;
      drawer.classList.add('is-open');
      overlay.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
      doc.body.style.overflow = 'hidden';
      const first = drawer.querySelector('a, button');
      if (first) first.focus();
    };

    const close = () => {
      drawer.classList.remove('is-open');
      overlay.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      doc.body.style.overflow = '';
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    };

    doc.querySelectorAll('[data-drawer-open]').forEach((b) => b.addEventListener('click', open));
    doc.querySelectorAll('[data-drawer-close]').forEach((b) => b.addEventListener('click', close));
    overlay.addEventListener('click', close);

    /* Esc 关闭 + Tab 焦点陷阱：键盘用户不会跑出抽屉 */
    doc.addEventListener('keydown', (e) => {
      if (!drawer.classList.contains('is-open')) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const focusables = [...drawer.querySelectorAll('a[href], button:not([disabled])')];
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    /* 视口回到桌面尺寸时收掉抽屉，避免状态残留 */
    window.matchMedia('(min-width: 941px)').addEventListener('change', (e) => {
      if (e.matches) close();
    });
  }
})();
