/* ============================================================
 * AI-COC-Keeper · 角色卡 modal (vanilla JS, 无依赖)
 * 流程: DOMContentLoaded → fetch /game/character.json → 注入按钮 + modal
 * 不读 WebGAL 内部 state, 只展示静态角色卡 (V0).
 * ========================================================== */
(function () {
  'use strict';

  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  function secHead(zh, en) {
    const h = el('div', 'cthk-card-sec-h');
    h.appendChild(el('span', 'cc-t', zh));
    h.appendChild(el('span', 'cc-n', en));
    h.appendChild(el('span', 'cc-ln'));
    return h;
  }

  function section(zh, en, body) {
    const s = el('div', 'cthk-card-section');
    s.appendChild(secHead(zh, en));
    s.appendChild(body);
    return s;
  }

  function bigTile(cls, k, v) {
    const t = el('div', 'cc-big ' + cls);
    t.appendChild(el('span', 'cc-k', k));
    t.appendChild(el('span', 'cc-v', v));
    return t;
  }

  function cell(k, v, hi) {
    const c = el('div', 'cc-cell' + (hi ? ' hi' : ''));
    c.appendChild(el('span', 'cc-k', k));
    c.appendChild(el('span', 'cc-v', String(v)));
    return c;
  }

  function renderModalBody(modal, char) {
    // header
    const header = el('div', 'cthk-card-header');
    header.appendChild(el('div', 'cthk-card-title', '探者档案'));
    const close = el('button', 'cthk-card-close', '×');
    close.setAttribute('aria-label', '关闭');
    close.dataset.cthkClose = '1';
    header.appendChild(close);
    modal.appendChild(header);

    if (!char) {
      modal.appendChild(el('div', 'cthk-card-empty', '当前未加载角色'));
      return;
    }

    // 身份 名牌
    const idb = el('div', 'cthk-card-id-block');
    idb.appendChild(el('div', 'cthk-card-kick', (char.scenarioCode || 'CASE') + ' · 探者档案'));
    const gender = char.gender ? `（${char.gender}，${char.age} 岁）` : `（${char.age} 岁）`;
    const idLine = el('div', 'cthk-card-id');
    idLine.innerHTML = `${char.name} <small>${gender}</small>`;
    idb.appendChild(idLine);
    idb.appendChild(el('div', 'cthk-card-id-sub', char.occupation));
    modal.appendChild(idb);

    // 状态: HP/SAN 双联大牌 + 次要四格
    const statWrap = el('div');
    const vital = el('div', 'cthk-card-vital');
    vital.appendChild(bigTile('hp', 'HP 体力', `${char.currentHp}/${char.maxHp}`));
    vital.appendChild(bigTile('san', 'SAN 心智度', `${char.currentSanity}/${char.maxSanity}`));
    statWrap.appendChild(vital);
    const minor = el('div', 'cthk-card-minor');
    minor.appendChild(cell('MP', `${char.currentMp}/${char.maxMp}`));
    minor.appendChild(cell('幸运', char.luck));
    if (char.movement !== undefined) minor.appendChild(cell('移动', char.movement));
    if (char.dodge !== undefined) minor.appendChild(cell('闪避', char.dodge));
    statWrap.appendChild(minor);
    modal.appendChild(section('状态', 'STATUS', statWrap));

    // 属性 8 项 (一体化网格, 高值描金)
    if (char.attributes) {
      const attrs = el('div', 'cthk-card-attrs');
      const order = ['STR', 'DEX', 'INT', 'CON', 'APP', 'POW', 'SIZ', 'EDU'];
      for (const k of order) {
        if (char.attributes[k] !== undefined) attrs.appendChild(cell(k, char.attributes[k], char.attributes[k] >= 80));
      }
      modal.appendChild(section('属性', 'ATTRIBUTES', attrs));
    }

    // 技能 (前 N, 双栏)
    if (Array.isArray(char.topSkills) && char.topSkills.length > 0) {
      const skills = el('div', 'cthk-card-skills');
      for (const sk of char.topSkills) {
        const row = el('div', 'cc-srow');
        row.appendChild(el('span', 'cc-sk-n', sk.name));
        row.appendChild(el('span', 'cc-sk-v', String(sk.value)));
        skills.appendChild(row);
      }
      modal.appendChild(section('主要技能', 'SKILLS', skills));
    }

    // 条件 (临时/长期心智失常等)
    if (Array.isArray(char.conditions) && char.conditions.length > 0) {
      const cond = el('div');
      for (const c of char.conditions) {
        const line = el('div');
        line.style.padding = '7px 0';
        line.style.borderBottom = '1px dashed rgba(58, 46, 28, 0.5)';
        const label = c.type === 'indef_insanity' ? '长期心智失常'
                    : c.type === 'temp_insanity'  ? '临时心智失常'
                    : c.type === 'major_wound'    ? '重伤'
                    : c.type === 'unconscious'    ? '昏迷'
                    : c.type === 'dying'          ? '濒死'
                    : c.type;
        const detail = c.insanityDetail
          ? ` · 《${c.insanityDetail.nameZh}》— ${c.insanityDetail.description.slice(0, 30)}`
          : c.source ? ` · ${c.source}` : '';
        line.textContent = `${label}${detail}`;
        line.style.color = '#c44537';
        cond.appendChild(line);
      }
      modal.appendChild(section('当前状态', 'CONDITIONS', cond));
    }
  }

  /**
   * 判断当前是不是在玩游戏 (排除 splash 和 标题菜单).
   *
   * 关键: WebGAL 的 splash 容器 .html-body__title-enter 不会从 DOM 移除,
   * 只是会被 display:none. 必须用 offsetParent 判断"实际可见", 不能只检查存在.
   *
   *   - splash 可见:    `.html-body__title-enter` 还可见 → 隐藏按钮
   *   - 标题菜单可见:  `[class*="Title_main"]` 存在 (showTitle=true) → 隐藏
   *   - 上面两个都不可见:   游戏中 → 显示按钮
   */
  function isVisible(el) {
    // display:none / visibility:hidden / 父节点 display:none 都让 offsetParent 变 null
    // (固定定位的元素例外, 但 splash 是 absolute, 没问题)
    return !!el && el.offsetParent !== null;
  }
  function isInGameplay() {
    const splash = document.querySelector('.html-body__title-enter');
    if (isVisible(splash)) return false;
    const titleMenu = document.querySelector('[class*="Title_main"]');
    if (isVisible(titleMenu)) return false;
    return true;
  }

  function init() {
    fetch('/game/character.json', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .catch(() => null)
      .then((char) => {
        const btn = el('button', 'cthk-card-btn');
        btn.innerHTML = 'DOSSIER ░ 探者';
        btn.setAttribute('aria-label', '查看角色卡');
        btn.style.display = 'none'; // 默认隐藏, 进游戏后再放出来
        document.body.appendChild(btn);

        const backdrop = el('div', 'cthk-card-backdrop');
        const modal = el('div', 'cthk-card-modal');
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        renderModalBody(modal, char);

        btn.addEventListener('click', () => backdrop.classList.add('open'));
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop || e.target.dataset.cthkClose === '1') {
            backdrop.classList.remove('open');
          }
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') backdrop.classList.remove('open');
        });

        // MutationObserver: 屏幕从 splash → 标题 → 游戏 是 React 异步切换的,
        // 监听 body 的子节点变化, 每次切换都重新算 "现在该不该显示按钮".
        // 进游戏 → 显示. 玩家点 🏠 标题 退回菜单 → 隐藏. 游戏结束 → 隐藏.
        let lastVisible = false;
        const updateVisibility = () => {
          const shouldShow = isInGameplay();
          if (shouldShow !== lastVisible) {
            btn.style.display = shouldShow ? '' : 'none';
            if (!shouldShow) backdrop.classList.remove('open'); // 弹窗在玩家退回菜单时一并收
            lastVisible = shouldShow;
          }
        };
        const observer = new MutationObserver(updateVisibility);
        observer.observe(document.body, { childList: true, subtree: true });
        updateVisibility(); // 首次检查
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
