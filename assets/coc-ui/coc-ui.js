/* ============================================================
 * coc-ui.js ·《卷宗》方案 B — 注入驱动 (vanilla, 无依赖, 不动 WebGAL 源码)
 * 提供: 状态 HUD / 登记角标 / 动态登记条 / 选项编号 / 作废·崩溃全屏
 * 部署: 复制到 dist/game/coc-ui.js, post-build 注入 <script> (在 character-card.js 旁)
 *
 * 数据来源 (任选其一, 优先级从上到下):
 *   1. window.CocUI.setState({hp,maxHp,san,maxSan,entry,investigator,occupation})
 *      ── 推荐: 在 builder 的 setVar 钩子里调一次, 即可实时驱动 HUD / 登记条 / 自动作废
 *   2. /game/character.json  ── 初始值兜底 (同 character-card.js 读的那份)
 *
 * 约束: 所有元素 z-index ≤ 11; HUD/角标在 splash/标题/intro 时自动隐藏, 不盖章节卡
 * ========================================================== */
(function () {
  'use strict';
  console.log('%c[coc-ui] script loaded · build=v3-marker-debug', 'color: #c44537; font-weight: bold');

  var els = {};                 // 注入的 DOM 引用
  var state = {                 // 当前玩家状态
    hp: null, maxHp: null, san: null, maxSan: null,
    entry: '调查记录', investigator: '', occupation: '',
    scenarioCode: 'CASE', revealPace: 1,
  };
  var voidShown = false;
  var rollTimer = null, rollTimeouts = [];
  var hudInited = false;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function visible(node) { return !!node && node.offsetParent !== null; }

  /* ---------- 建立注入元素 ---------- */
  function build() {
    // HUD
    var hud = el('div', 'cthk-hud');
    hud.innerHTML =
      '<button class="cthk-hud-toggle" aria-label="收起">‹</button>' +
      '<div class="cthk-hud-stat" data-stat="hp"><span class="cthk-hud-label">体力</span>' +
        '<span class="cthk-hud-bar"><span class="cthk-hud-fill hp"></span></span>' +
        '<span class="cthk-hud-num" data-num="hp">—</span></div>' +
      '<div class="cthk-hud-stat" data-stat="san"><span class="cthk-hud-label">心智</span>' +
        '<span class="cthk-hud-bar"><span class="cthk-hud-fill san"></span></span>' +
        '<span class="cthk-hud-num" data-num="san">—</span></div>';
    document.body.appendChild(hud);
    hud.querySelector('.cthk-hud-toggle').addEventListener('click', function () {
      var c = hud.classList.toggle('collapsed');
      this.textContent = c ? '›' : '‹';
    });
    els.hud = hud;

    // 登记角标
    var reg = el('div', 'cthk-regmark');
    reg.setAttribute('aria-hidden', 'true');
    reg.innerHTML = '<span class="rm tl"></span><span class="rm tr"></span>' +
                    '<span class="rm bl"></span><span class="rm br"></span><span class="rm-id"></span>';
    document.body.appendChild(reg);
    els.reg = reg;

    // 作废 / 崩溃 全屏
    var v = el('div', 'cthk-void');
    v.innerHTML = '<div class="void-inner"><div class="void-kicker"></div>' +
      '<div class="void-stamp"></div><div class="void-title"></div>' +
      '<div class="void-reason"></div><div class="void-foot"></div></div>';
    document.body.appendChild(v);
    els.void = v;

    // 骰检中央揭示
    var DIE = '<svg class="die" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"><path d="M50 4 L92 40 L50 96 L8 40 Z"/><path d="M8 40 L50 26 L92 40"/><path d="M50 4 L50 26"/><path d="M50 26 L28 56 L50 96"/><path d="M50 26 L72 56 L50 96"/><path d="M8 40 L28 56"/><path d="M92 40 L72 56"/></g></svg>';
    var roll = el('div', 'cthk-roll');
    roll.innerHTML =
      '<div class="roll-burst" aria-hidden="true"></div><div class="roll-ring" aria-hidden="true"></div>' +
      '<div class="roll-card"><div class="roll-dice" aria-hidden="true">' + DIE + DIE + '</div>' +
      '<div class="roll-skill"></div>' +
      '<div class="roll-figures"><span class="roll-roll"></span><span class="roll-vs">/</span><span class="roll-target"></span></div>' +
      '<div class="roll-outcome"></div><div class="roll-effects"></div></div>';
    document.body.appendChild(roll);
    els.roll = roll;
  }

  /* ---------- HUD / 登记条渲染 ---------- */
  function renderHud() {
    if (!els.hud) return;
    var hpFill = els.hud.querySelector('.cthk-hud-fill.hp');
    var sanFill = els.hud.querySelector('.cthk-hud-fill.san');
    if (state.hp != null && state.maxHp) {
      hpFill.style.transform = 'scaleX(' + Math.max(0, state.hp / state.maxHp) + ')';
      tweenNum(els.hud.querySelector('[data-num="hp"]'), state.hp, state.maxHp, 750, !hudInited);
    }
    if (state.san != null && state.maxSan) {
      sanFill.style.transform = 'scaleX(' + Math.max(0, state.san / state.maxSan) + ')';
      tweenNum(els.hud.querySelector('[data-num="san"]'), state.san, state.maxSan, 750, !hudInited);
    }
    // 危急: ≤30% 持续告警
    var hpStat = els.hud.querySelector('.cthk-hud-stat[data-stat="hp"]');
    var sanStat = els.hud.querySelector('.cthk-hud-stat[data-stat="san"]');
    if (hpStat) hpStat.classList.toggle('low', state.hp != null && state.maxHp && state.hp / state.maxHp <= 0.3);
    if (sanStat) sanStat.classList.toggle('low', state.san != null && state.maxSan && state.san / state.maxSan <= 0.3);
    hudInited = true;
  }
  // 数值补间滚动 (easeOutCubic; noAnim 或后台节流时直接落终值)
  function tweenNum(node, to, max, dur, noAnim) {
    if (!node) return;
    var cur = parseInt((node.textContent || '').split('/')[0], 10);
    var from = isNaN(cur) ? to : cur;
    if (node._numRAF) cancelAnimationFrame(node._numRAF);
    if (node._numTO) clearTimeout(node._numTO);
    if (noAnim || from === to) { node.textContent = to + '/' + max; return; }
    node._numTO = setTimeout(function () { node.textContent = to + '/' + max; }, dur + 140);
    var t0 = performance.now();
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      node.textContent = Math.round(from + (to - from) * e) + '/' + max;
      if (k < 1) node._numRAF = requestAnimationFrame(step);
    })(t0);
  }
  function flash(stat) {
    var node = els.hud && els.hud.querySelector('.cthk-hud-stat[data-stat="' + stat + '"]');
    if (!node) return;
    node.classList.remove('flash-dmg'); void node.offsetWidth; node.classList.add('flash-dmg');
  }

  // 把登记条注入当前 textbox (若还没注入过); 仅在内容变化时写, 避免 observer 死循环
  function ensureManifest() {
    var box = document.querySelector('[class*="TextBox_main"]');
    if (!box) return;
    var m = box.querySelector('.tb-manifest');
    if (!m) {
      m = el('div', 'tb-manifest', '<span class="m-l"></span><span class="m-r"></span>');
      box.insertBefore(m, box.firstChild);
    }
    var lTxt = state.scenarioCode + ' · ' + state.entry;
    var rTxt = state.investigator
      ? state.investigator + (state.occupation ? ' — ' + state.occupation : '') : '';
    var lEl = m.querySelector('.m-l'), rEl = m.querySelector('.m-r');
    if (lEl.textContent !== lTxt) lEl.textContent = lTxt;
    if (rEl.textContent !== rTxt) rEl.textContent = rTxt;
  }

  /* ---------- 骰检 marker 拦截 (builder 在 narrate 里嵌入 __COC_ROLL__<base64>__, 触发中央揭示) ----------
   * 数据流:
   *   1. 生成端 (gen:ai-game 或 inject-roll-markers.py) 输出一行: `__COC_ROLL__<base64>__;`
   *   2. WebGAL 显示这条 narrate, textbox 文字 = marker
   *   3. 这里 MutationObserver 抓到 marker, 隐藏 textbox, 调 showRoll 演中央动画
   *   4. 动画结束 → 自动模拟点击 #FullScreenClick 推进到下一条 narrate (真正叙事文字) */
  var pendingRollMarker = null;  // 防重复触发同一条 marker
  var rollDebugLogged = false;
  var rollAnimating = false;     // showRoll 在播时不再重入
  // WebGAL 每个字符渲染 3 遍 (本字 + outer/inner 描边),
  // textContent 拿到的是 "______COCCOC..." 三倍展开. 处理:
  //   1) 优先取每个 .zhanwei 包装的首个文本节点 (= 真字)
  //   2) fallback: 直接 textContent 上正则 (regex 加大 1-3 倍重复匹配兜底)
  function extractRealText(root) {
    if (!root) return '';
    var wraps = root.querySelectorAll('[class*="zhanwei"]');
    if (!wraps.length) return root.textContent || '';
    var s = '';
    for (var i = 0; i < wraps.length; i++) {
      var first = wraps[i].firstChild;
      if (first && first.nodeType === 3) s += first.nodeValue;
    }
    return s;
  }
  function findRollMarker(box) {
    // 先试 zhanwei 提取
    var clean = extractRealText(box);
    var m = /__COC_ROLL__([A-Za-z0-9+/=]+)__/.exec(clean);
    if (m) return m;
    // 兜底: 拿 textContent (含 3 倍重复) 上正则 — 把每字 1-3 次重复都吃下
    var raw = box.textContent || '';
    // 每个真字 c 在 raw 里是 ccc / cc / c, 所以 c{1,3} 任意重复
    var pat = /_{1,3}C{1,3}O{1,3}C{1,3}_{1,3}R{1,3}O{1,3}L{1,3}L{1,3}_{1,3}((?:[A-Za-z0-9+/=]{1,3})+)_{1,3}/;
    var m2 = pat.exec(raw);
    if (!m2) return null;
    // m2[1] 是 base64 部分, 每字符也是 1-3 倍重复, 需要去重
    var b64 = m2[1].replace(/(.)\1{1,2}/g, '$1');
    return ['__COC_ROLL__' + b64 + '__', b64];
  }
  function maybeTriggerRollMarker() {
    if (rollAnimating) return;  // 动画在播, 别重复触发
    // 全 document 找 zhanwei (不限 textbox: WebGAL 有时多个 textbox 同时存在, querySelector 选错那个)
    var clean = '';
    var wraps = document.querySelectorAll('[class*="zhanwei"]');
    for (var i = 0; i < wraps.length; i++) {
      var first = wraps[i].firstChild;
      if (first && first.nodeType === 3) clean += first.nodeValue;
    }
    var m = /__COC_ROLL__([A-Za-z0-9+/=]+)__/.exec(clean);
    var box = document.querySelector('[class*="TextBox_main"]');
    if (!box) return;
    if (!rollDebugLogged && (clean.indexOf('COC') >= 0 || clean.indexOf('ROLL') >= 0)) {
      console.log('[coc-ui] marker detected, clean="' + clean.slice(0,80) + '"');
      rollDebugLogged = true;
    }
    if (!m) {
      // 不是 marker, 恢复 textbox 可见
      box.classList.remove('cthk-roll-marker-active');
      return;
    }
    if (pendingRollMarker === m[0]) return;  // 这条已经触发过, 等 WebGAL 推进
    pendingRollMarker = m[0];

    // 隐藏 textbox (避免玩家看到 base64 字符串)
    box.classList.add('cthk-roll-marker-active');

    var data;
    try {
      var json = atob(m[1]);
      // base64 出的是 utf-8 bytes 的 binary string; 解为 utf-8
      data = JSON.parse(decodeURIComponent(escape(json)));
    } catch (e) {
      console.error('[coc-ui] roll marker 解码失败:', e, m[1]);
      pendingRollMarker = null;
      box.classList.remove('cthk-roll-marker-active');
      return;
    }
    // 调中央揭示动画, 结束后程序模拟点击推进 WebGAL
    rollAnimating = true;
    showRoll(
      { skill: data.skill, roll: data.roll, target: data.target, outcome: data.outcome },
      data.effects || [],
      function () {
        var clk = document.getElementById('FullScreenClick');
        if (clk) clk.click();
        // 推进后 textbox 会刷新到下一条 narrate, 不是 marker 了 → classList 在下次轮询时被移除
        pendingRollMarker = null;
        rollAnimating = false;
      }
    );
  }

  /* ---------- 角色名浮层 (从 textbox 子元素"领养"到 body, 放屏幕左侧空位) ----------
   * WebGAL 的 .TextBox_showName 是 position:absolute; top:-68px 钉死在 textbox 上方,
   * 用 CSS 怎么挪都会跟 textbox 抢位置或被父容器边界切. 这里直接读它的文字, 写到独立浮层. */
  function ensureSpeakerOverlay() {
    var box = document.querySelector('[class*="TextBox_main"]');
    var visible = box && getComputedStyle(box).display !== 'none' && box.offsetParent !== null;
    var src = box && box.querySelector('[class*="TextBox_showName"]:not([class*="TextBox_ShowName_Background"])');
    var raw = (src && src.textContent || '').trim();
    var speaker = document.querySelector('.cthk-speaker');
    if (!speaker) {
      speaker = el('div', 'cthk-speaker', '<span class="cthk-speaker-bracket">［</span><span class="cthk-speaker-name"></span><span class="cthk-speaker-bracket">］</span>');
      document.body.appendChild(speaker);
    }
    // 隐藏 WebGAL 原生 showName (位置控制不了, 让浮层接管)
    // 不写在 CSS 是为了便于 ensureSpeakerOverlay 失效时回退看到原生
    if (box) {
      box.querySelectorAll('[class*="TextBox_showName"]').forEach(function (n) {
        n.style.visibility = 'hidden';
      });
    }
    var nameSlot = speaker.querySelector('.cthk-speaker-name');
    if (nameSlot.textContent !== raw) nameSlot.textContent = raw;
    speaker.hidden = !(visible && raw && inGameplay());
  }

  /* ---------- 选项编号 (data-idx 兜底, CSS counter 失效时用) ---------- */
  function numberChoices() {
    var items = document.querySelectorAll('[class*="Choose_item"]');
    var n = 0;
    items.forEach(function (it) {
      if (it.className.indexOf('disabled') > -1) return;
      n++;
      it.setAttribute('data-idx', ('0' + n).slice(-2));
    });
  }

  /* ---------- 作废 / 崩溃 ---------- */
  var VOID_CFG = {
    death: { stamp: '作废', reason: 'HP 归零 · 调查员已殁', foot: 'ENTRY TERMINATED · 档案封存' },
    insanity: { stamp: '失常', reason: '心智度归零 · 永久性疯狂', foot: 'MIND LOST · 调查员移交收容' },
  };
  function showVoid(type) {
    if (!els.void) return;
    var cfg = VOID_CFG[type] || VOID_CFG.death;
    els.void.dataset.kind = type || 'death';
    els.void.querySelector('.void-kicker').textContent = 'CASE FILE · ' + state.scenarioCode;
    els.void.querySelector('.void-stamp').textContent = cfg.stamp;
    els.void.querySelector('.void-title').textContent = state.investigator
      ? state.investigator + (state.occupation ? ' — ' + state.occupation : '') : '调查员';
    els.void.querySelector('.void-reason').textContent = cfg.reason;
    els.void.querySelector('.void-foot').textContent = cfg.foot;
    els.void.classList.add('show');
    voidShown = true;
  }
  function hideVoid() { if (els.void) { els.void.classList.remove('show'); voidShown = false; } }

  /* ---------- 骰检中央揭示 (builder 在 check 结算时调 CocUI.showRoll) ---------- */
  function clearRollTimers() {
    if (rollTimer) { clearInterval(rollTimer); rollTimer = null; }
    rollTimeouts.forEach(clearTimeout); rollTimeouts = [];
  }
  function showRoll(check, effects, done) {
    if (!els.roll || !check) { if (done) done(); return; }
    clearRollTimers();
    var R = els.roll, q = function (s) { return R.querySelector(s); };
    var elRoll = q('.roll-roll'), elTarget = q('.roll-target'), elOut = q('.roll-outcome'),
        elSkill = q('.roll-skill'), elFx = q('.roll-effects');
    var hasNum = check.target > 0;
    R.className = 'cthk-roll';                  // 重置 (清掉 show/stamped/crit/figures-on/rolling)
    R.dataset.outcome = check.outcome || '';
    elSkill.textContent = check.skill || '检定';
    elOut.textContent = check.outcome || '';
    elFx.innerHTML = '';
    if (hasNum) { R.classList.add('figures-on'); elTarget.textContent = check.target; elRoll.textContent = '00'; }
    else { elRoll.textContent = ''; elTarget.textContent = ''; }
    R.classList.add('show');
    if (hasNum) R.classList.add('rolling');
    var pace = state.revealPace || 1, finished = false, closed = false;
    function settle() {
      if (finished) return; finished = true; clearRollTimers();
      R.classList.remove('rolling');
      if (hasNum) elRoll.textContent = ('0' + check.roll).slice(-2);
      R.classList.add('stamped');
      var oc = check.outcome || '';
      if (oc.indexOf('大成功') >= 0) R.classList.add('crit', 'crit-success');
      else if (oc.indexOf('大失败') >= 0) R.classList.add('crit', 'crit-fail');
      if (effects && effects.length) {
        effects.forEach(function (ef) {
          var name = ef.stat === 'hp' ? '体力' : ef.stat === 'san' ? '心智' : ef.stat;
          elFx.appendChild(el('div', 'roll-fx',
            '<span class="fx-name">' + name + '</span><span class="fx-delta">' +
            (ef.delta > 0 ? '+' : '') + ef.delta + '</span><span class="fx-to">→ ' + ef.to + '/' + ef.max + '</span>'));
          if (ef.stat === 'hp' && ef.to != null) window.CocUI.setState({ hp: ef.to, maxHp: ef.max });
          if (ef.stat === 'san' && ef.to != null) window.CocUI.setState({ san: ef.to, maxSan: ef.max });
        });
      }
      rollTimeouts.push(setTimeout(close, 1250 * pace));
    }
    function close() {
      if (closed) return; closed = true; clearRollTimers();
      R.classList.remove('show'); R.onclick = null;
      rollTimeouts.push(setTimeout(function () { R.className = 'cthk-roll'; if (done) done(); }, 430));
    }
    R.onclick = function () { if (!finished) settle(); else close(); };
    if (hasNum) {
      rollTimer = setInterval(function () { elRoll.textContent = ('0' + (Math.floor(Math.random() * 99) + 1)).slice(-2); }, 55);
      rollTimeouts.push(setTimeout(settle, 680 * pace));
    } else {
      rollTimeouts.push(setTimeout(settle, 380 * pace));
    }
  }

  /* ---------- 可见性: splash / 标题 / intro 时隐藏 HUD+角标 ---------- */
  function inGameplay() {
    var splash = document.querySelector('.html-body__title-enter');
    if (visible(splash)) return false;
    if (visible(document.querySelector('[class*="Title_main"]'))) return false;
    if (visible(document.querySelector('#introContainer'))) return false; // 章节卡/回顾时让位
    return true;
  }
  function updateChrome() {
    var show = inGameplay();
    if (els.hud) els.hud.hidden = !show;
    if (els.reg) els.reg.hidden = !show;
  }

  /* ---------- 对外 API ---------- */
  window.CocUI = {
    setState: function (s) {
      var prevHp = state.hp, prevSan = state.san;
      for (var k in s) if (s.hasOwnProperty(k)) state[k] = s[k];
      renderHud();
      ensureManifest();
      if (prevHp != null && state.hp != null && state.hp < prevHp) flash('hp');
      if (prevSan != null && state.san != null && state.san < prevSan) flash('san');
      if (!voidShown) {
        if (state.hp != null && state.hp <= 0) showVoid('death');
        else if (state.san != null && state.san <= 0) showVoid('insanity');
      }
      return this;
    },
    showVoid: showVoid,
    hideVoid: hideVoid,
    showRoll: function (check, effects, done) { showRoll(check, effects, done); return this; },
    setRevealPace: function (m) { state.revealPace = m || 1; return this; },
    state: state,
  };

  /* ---------- 初始化 ---------- */
  function init() {
    build();
    // 初始值兜底: 读 character.json (同 character-card.js)
    fetch('/game/character.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (c) {
        if (c) {
          window.CocUI.setState({
            hp: c.currentHp, maxHp: c.maxHp, san: c.currentSanity, maxSan: c.maxSanity,
            investigator: c.name, occupation: c.occupation,
            scenarioCode: c.scenarioCode || state.scenarioCode,
          });
        }
        renderHud();
      });
    // WebGAL 是异步 React 渲染: 监听 body 子树, 每次切换都重算 chrome 可见性 + 重注登记条/编号
    // 用 rAF 节流, 避免打字机逐字 mutation 时反复触发
    var pending = false;
    function onMutate() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () {
        pending = false;
        updateChrome();
        ensureManifest();
        ensureSpeakerOverlay();
        maybeTriggerRollMarker();
        numberChoices();
        if (voidShown && inGameplay()) hideVoid(); // 回到游戏 → 收起作废画面
      });
    }
    var mo = new MutationObserver(onMutate);
    mo.observe(document.body, { childList: true, subtree: true });
    updateChrome();
    // 双保险: 250ms 轮询 marker (MutationObserver 在某些时机 fire 不到 / rAF throttle 错过)
    setInterval(function () {
      try { maybeTriggerRollMarker(); } catch (e) { console.error('[coc-ui] poll err', e); }
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
