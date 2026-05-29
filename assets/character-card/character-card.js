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

  function statRow(label, value) {
    const wrap = el('div', 'cthk-card-stat');
    wrap.appendChild(el('span', 'cthk-card-stat-name', label));
    wrap.appendChild(el('span', 'cthk-card-stat-val', value));
    return wrap;
  }

  function attrCell(name, value) {
    const wrap = el('div', 'cthk-card-attr');
    wrap.appendChild(el('span', 'cthk-card-attr-name', name));
    wrap.appendChild(el('span', 'cthk-card-attr-val', String(value)));
    return wrap;
  }

  function skillRow(name, value) {
    const wrap = el('div', 'cthk-card-skill');
    wrap.appendChild(el('span', 'cthk-card-skill-name', name));
    wrap.appendChild(el('span', 'cthk-card-skill-val', String(value)));
    return wrap;
  }

  function section(title, body) {
    const s = el('div', 'cthk-card-section');
    s.appendChild(el('h3', null, title));
    s.appendChild(body);
    return s;
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

    // 身份
    const id = el('div');
    const gender = char.gender ? `（${char.gender}, ${char.age} 岁）` : `（${char.age} 岁）`;
    id.appendChild(el('div', 'cthk-card-id', `${char.name} ${gender}`));
    id.appendChild(el('div', 'cthk-card-id-sub', char.occupation));
    modal.appendChild(section('身份', id));

    // 状态数值
    const stats = el('div', 'cthk-card-stats');
    stats.appendChild(statRow('HP', `${char.currentHp}/${char.maxHp}`));
    stats.appendChild(statRow('心智度', `${char.currentSanity}/${char.maxSanity}`));
    stats.appendChild(statRow('MP', `${char.currentMp}/${char.maxMp}`));
    stats.appendChild(statRow('幸运', String(char.luck)));
    if (char.movement !== undefined) stats.appendChild(statRow('移动', String(char.movement)));
    if (char.dodge !== undefined) stats.appendChild(statRow('闪避', String(char.dodge)));
    modal.appendChild(section('状态', stats));

    // 属性 8 项
    if (char.attributes) {
      const attrs = el('div', 'cthk-card-attrs');
      const order = ['STR', 'DEX', 'INT', 'CON', 'APP', 'POW', 'SIZ', 'EDU'];
      for (const k of order) {
        if (char.attributes[k] !== undefined) attrs.appendChild(attrCell(k, char.attributes[k]));
      }
      modal.appendChild(section('属性', attrs));
    }

    // 技能 (前 N)
    if (Array.isArray(char.topSkills) && char.topSkills.length > 0) {
      const skills = el('div', 'cthk-card-skills');
      for (const sk of char.topSkills) skills.appendChild(skillRow(sk.name, sk.value));
      modal.appendChild(section('主要技能', skills));
    }

    // 条件 (临时/长期心智失常等)
    if (Array.isArray(char.conditions) && char.conditions.length > 0) {
      const cond = el('div');
      for (const c of char.conditions) {
        const line = el('div');
        line.style.padding = '4px 0';
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
      modal.appendChild(section('当前状态', cond));
    }
  }

  /**
   * 判断当前是不是在玩游戏 (排除 splash 和 标题菜单).
   *   - splash:    `.title-enter__container` 还在 (静态 HTML, JS 启动后才移除)
   *   - 标题菜单:  `[class*="Title_main"]` 存在 (React 渲染的开始/读档/选项菜单)
   *   - 游戏中:    上面两个都不在
   */
  function isInGameplay() {
    const splashLeft = document.querySelector('.title-enter__container');
    if (splashLeft) return false;
    const titleMenu = document.querySelector('[class*="Title_main"]');
    if (titleMenu) return false;
    return true;
  }

  function init() {
    fetch('/game/character.json', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .catch(() => null)
      .then((char) => {
        const btn = el('button', 'cthk-card-btn');
        btn.innerHTML = '📜 角色卡';
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
