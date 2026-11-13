/* Словарь мемов Киберкамбека. Чистый JS (ES2017+), без зависимостей. */
(() => {
  'use strict';

  // ===== Настройки: меняются один раз при запуске сайта =====
  const CONFIG = {
    dataUrl: 'data/phrases.json',            // путь без начального слеша (важно для GitHub Pages)
    groupsUrl: 'data/groups.json',
    debounceMs: 180,                         // задержка поиска при вводе
    formEndpoint: 'https://api.web3forms.com/submit', // сервис приёма форм Web3Forms
    formKey: 'bc55497d-6004-4245-83db-1caeb8e25ed8',   // публичный ключ Web3Forms (его можно хранить в коде)
    contactLabel: 'kiberkambek@gmail.com',     // [контакт]: текст ссылки
    contactHref: 'mailto:kiberkambek@gmail.com', // [контакт]: адрес ссылки (почта, Telegram и т. д.)
    updated: 'октябрь 2026'                 // «Обновлено: …» в футере
  };

  // Класс карточки по названию категории
  const CAT_CLASS = { 'Мем': 'card--meme', 'Предложение': 'card--sentence', 'Персонаж': 'card--character' };
  const DEFAULTS = { q: '', category: '', sort: 'alpha', view: 'all', group: '' }; // category '' = «Все»

  const $ = (id) => document.getElementById(id);
  const el = {
    dictionary: $('dictionary'), status: $('status'), heroStats: $('hero-stats'),
    search: $('search'), clear: $('clear'), count: $('count'),
    categories: $('categories'), sort: $('sort'), reset: $('reset'), hint: $('cat-hint'),
    list: $('list'), empty: $('empty'), emptyTitle: $('empty-title'),
    emptyReset: $('empty-reset'), suggest: $('suggest'), start: $('start'),
    allTitle: $('all-title'), views: $('views'), viewWrap: $('view-wrap'), groupChip: $('group-chip')
  };

  let categories = [];   // [{name, plural, description}]
  let items = [];        // проверенные записи
  let groups = [];
  const state = { ...DEFAULTS };
  const collator = new Intl.Collator('ru');

  // ===== Вспомогательные функции =====
  // Нижний регистр и «ё» → «е» (длина строки не меняется)
  const fold = (s) => s.toLowerCase().replace(/ё/g, 'е');
  const plural = (n, one, few, many) => {
    const m = n % 100, d = n % 10;
    if (m > 10 && m < 20) return many;
    if (d === 1) return one;
    if (d >= 2 && d <= 4) return few;
    return many;
  };
  const isDefault = () => state.q === DEFAULTS.q && state.category === DEFAULTS.category
    && state.sort === DEFAULTS.sort && state.group === DEFAULTS.group;

  // ===== Загрузка и проверка данных (сообщения только в консоль) =====
  async function loadData(url = CONFIG.dataUrl) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function validate(data) {
    if (!data || !Array.isArray(data.categories) || !Array.isArray(data.phrases)) {
      throw new Error('Неверная структура файла: нужны массивы categories и phrases');
    }
    const cats = data.categories
      .filter((c) => c && typeof c.name === 'string' && c.name.trim())
      .map((c) => ({ name: c.name, plural: c.plural || c.name, description: c.description || '' }));
    if (!cats.length) throw new Error('Список categories пуст');

    const catNames = new Set(cats.map((c) => c.name));
    const ids = new Set();
    const slugs = new Set();
    const phraseKeys = new Map();
    const result = [];

    data.phrases.forEach((r, i) => {
      const where = `Запись №${i + 1}` + (r && r.id ? ` (${r.id})` : '');
      if (!r || typeof r !== 'object') { console.error(`${where}: не объект. Пропущена.`); return; }

      const missing = ['id', 'phrase', 'meaning', 'category'].filter((k) => typeof r[k] !== 'string' || !r[k].trim());
      if (missing.length) { console.error(`${where}: нет обязательных полей: ${missing.join(', ')}. Пропущена.`); return; }
      if (ids.has(r.id)) { console.error(`${where}: id повторяется. Пропущена.`); return; }
      if (!catNames.has(r.category)) { console.error(`${where}: категории «${r.category}» нет в списке categories. Пропущена.`); return; }
      ids.add(r.id);

      // Предупреждения: запись остаётся на сайте
      if (!/^ph-\d{3,}$/.test(r.id)) console.warn(`${where}: id лучше писать как ph-001.`);
      if (r.phrase.length < 2 || r.phrase.length > 80) console.warn(`${where}: phrase должна быть 2–80 символов.`);
      if (/\.\s*$/.test(r.phrase)) console.warn(`${where}: в phrase не нужна точка в конце.`);
      if (r.meaning.length > 250) console.warn(`${where}: meaning длиннее 250 символов.`);
      const key = fold(r.phrase).replace(/\s+/g, ' ').trim();
      if (phraseKeys.has(key)) console.warn(`${where}: phrase совпадает с записью ${phraseKeys.get(key)}.`);
      else phraseKeys.set(key, r.id);

      // Необязательные поля: пустые не выводятся
      const optional = (k) => {
        if (r[k] == null) return '';
        if (typeof r[k] !== 'string') { console.warn(`${where}: поле ${k} должно быть строкой.`); return ''; }
        return r[k].trim();
      };
      // slug – часть адреса страницы (entry/<slug>/). Нет или неверный – берём id, как build.py
      let slug = optional('slug');
      if (!slug) slug = r.id;
      else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) { console.warn(`${where}: slug «${slug}» неверный (только a–z, 0–9 и дефисы). Взят id.`); slug = r.id; }
      if (slugs.has(slug)) console.warn(`${where}: slug «${slug}» уже занят другой записью.`);
      slugs.add(slug);
      const appearing = optional('appearing');
      const example = optional('example');
      result.push({
        id: r.id, slug, phrase: r.phrase.trim(), meaning: r.meaning.trim(), category: r.category,
        appearing, example,
        hay: fold([r.phrase, r.meaning, appearing].join('\n')) // поиск: phrase + meaning + appearing
      });
    });
    return { categories: cats, items: result };
  }

  function validateGroups(data, all) {
    if (!data || !Array.isArray(data.groups)) return [];
    const bySlug = new Map(all.map((it) => [it.slug, it]));
    const seen = new Set();
    const out = [];
    data.groups.forEach((g, i) => {
      const where = `Группа №${i + 1}`;
      if (!g || typeof g.name !== 'string' || !g.name.trim() || typeof g.slug !== 'string'
          || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(g.slug)) {
        console.error(`${where}: нужны name и slug (a–z, 0–9, дефисы). Пропущена.`); return;
      }
      if (seen.has(g.slug)) { console.error(`${where}: slug «${g.slug}» повторяется. Пропущена.`); return; }
      seen.add(g.slug);
      const members = [];
      (Array.isArray(g.members) ? g.members : []).forEach((s) => {
        const it = bySlug.get(s);
        if (!it) console.warn(`${where} (${g.name}): понятие «${s}» не найдено.`);
        else if (!members.includes(it)) members.push(it);
      });
      const description = typeof g.description === 'string' ? g.description.trim() : '';
      out.push({
        slug: g.slug, name: g.name.trim(), description, items: members,
        hay: fold([g.name, description, ...members.map((m) => m.phrase)].join('\n'))
      });
    });
    return out;
  }

  // ===== Фильтрация и сортировка: категория → поиск → сортировка =====
  function getResults() {
    const tokens = fold(state.q).trim().split(/\s+/).filter(Boolean);
    const grp = state.group ? groups.find((g) => g.slug === state.group) : null;
    const ids = grp ? new Set(grp.items.map((it) => it.id)) : null;
    const list = items.filter((it) =>
      (!ids || ids.has(it.id)) && (!state.category || it.category === state.category)
      && tokens.every((t) => it.hay.includes(t)));

    const order = new Map(categories.map((c, i) => [c.name, i]));
    list.sort((a, b) => {
      if (state.sort === 'category' && a.category !== b.category) return order.get(a.category) - order.get(b.category);
      return collator.compare(a.phrase, b.phrase);
    });
    return { list, tokens };
  }

  // ===== Отрисовка =====
  // Добавляет текст в узел, подсвечивая найденные слова
  function appendHighlighted(parent, text, tokens) {
    const low = fold(text);
    if (!tokens.length || low.length !== text.length) { parent.append(text); return; }
    const marks = new Array(text.length).fill(false);
    tokens.forEach((t) => {
      let i = low.indexOf(t);
      while (i !== -1) {
        for (let k = i; k < i + t.length; k++) marks[k] = true;
        i = low.indexOf(t, i + t.length);
      }
    });
    let buf = '', on = false;
    const flush = () => {
      if (!buf) return;
      if (on) { const m = document.createElement('mark'); m.textContent = buf; parent.append(m); }
      else parent.append(buf);
      buf = '';
    };
    for (let k = 0; k < text.length; k++) {
      if (marks[k] !== on) { flush(); on = marks[k]; }
      buf += text[k];
    }
    flush();
  }

  function make(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text) n.textContent = text;
    return n;
  }

  // Адрес страницы записи (файлы создаёт build.py). Относительный путь работает и на GitHub Pages
  const entryUrl = (it) => 'entry/' + encodeURIComponent(it.slug) + '/';

  function makeCard(it, headingTag, tokens) {
    const li = make('li', 'card ' + (CAT_CLASS[it.category] || ''));

    // Обычная ссылка в том же окне (без target). CSS растягивает её на всю карточку
    const a = make('a', 'card__link');
    a.href = entryUrl(it);
    appendHighlighted(a, it.phrase, tokens);
    const h = make(headingTag, 'card__title');
    h.append(a);
    li.append(h, make('span', 'tag', it.category));

    const meaning = make('p', 'meaning meaning--clamp'); // текст обрезается в CSS
    appendHighlighted(meaning, it.meaning, tokens);
    li.append(meaning);

    // Происхождение на карточке не показываем, кроме случая, когда запрос найден именно в нём
    if (it.appearing && tokens.some((t) => fold(it.appearing).includes(t))) {
      const p = make('p', 'origin origin--clamp');
      p.append(make('span', 'label', 'Происхождение'));
      appendHighlighted(p, it.appearing, tokens);
      li.append(p);
    }

    const more = make('p', 'more', 'Подробнее →');
    more.setAttribute('aria-hidden', 'true'); // ссылка уже есть в заголовке
    li.append(more);
    return li;
  }

  function makeList(group, headingTag, tokens) {
    const ul = make('ul', 'cards');
    group.forEach((it) => ul.append(makeCard(it, headingTag, tokens)));
    return ul;
  }

  function getGroupResults() {
    const tokens = fold(state.q).trim().split(/\s+/).filter(Boolean);
    return { list: groups.filter((g) => tokens.every((t) => g.hay.includes(t))), tokens };
  }

  const groupUrl = (g) => 'group/' + encodeURIComponent(g.slug) + '/';

  function makeGroupRow(g, tokens) {
    const li = make('li', 'group-row');
    const main = make('div', 'group-row__main');
    const head = make('div', 'group-row__head');
    const h = make('h3', 'group-row__title');
    appendHighlighted(h, g.name, tokens);
    const n = g.items.length;
    head.append(h, make('p', 'group-row__count', `${n} ${plural(n, 'понятие', 'понятия', 'понятий')}`));
    main.append(head);
    if (g.description) {
      const desc = make('p', 'group-row__desc');
      appendHighlighted(desc, g.description, tokens);
      main.append(desc);
    }
    const actions = make('div', 'group-row__actions');
    const show = make('button', 'btn btn--primary', 'Показать понятия');
    show.type = 'button';
    show.dataset.showGroup = g.slug;
    show.setAttribute('aria-label', 'Показать понятия группы ' + g.name);
    const about = make('a', 'btn btn--ghost', 'О группе');
    about.href = groupUrl(g);
    about.setAttribute('aria-label', 'О группе ' + g.name);
    actions.append(show, about);
    li.append(main, actions);
    return li;
  }

  function render() {
    const inGroups = state.view === 'groups';
    const { list, tokens } = inGroups ? getGroupResults() : getResults();
    el.list.replaceChildren();
    el.allTitle.textContent = inGroups ? 'Группы понятий' : 'Все понятия';

    if (list.length) {
      if (inGroups) {
        const ul = make('ul', 'groups');
        list.forEach((g) => ul.append(makeGroupRow(g, tokens)));
        el.list.append(ul);
      } else if (state.sort === 'category') {
        categories.forEach((c) => {
          const group = list.filter((it) => it.category === c.name);
          if (!group.length) return;
          const wrap = make('div', 'group ' + (CAT_CLASS[c.name] || ''));
          wrap.append(make('h3', 'group__title', `${c.plural} (${group.length})`), makeList(group, 'h4', tokens));
          el.list.append(wrap);
        });
      } else {
        el.list.append(makeList(list, 'h3', tokens));
      }
    }

    el.empty.hidden = list.length > 0;
    if (!list.length) {
      const cat = categories.find((c) => c.name === state.category);
      const grp = groups.find((g) => g.slug === state.group);
      el.emptyTitle.textContent = state.q.trim()
        ? `Ничего не нашлось по запросу «${state.q.trim()}»`
        : grp ? `В группе «${grp.name}» нет записей в выбранной категории`
        : `В категории «${cat ? cat.plural : ''}» пока нет записей`;
    }

    const total = inGroups ? groups.length : items.length;
    const filtered = state.q.trim() || (!inGroups && (state.category || state.group));
    const noun = inGroups ? ['группа', 'группы', 'групп'] : ['запись', 'записи', 'записей'];
    el.count.textContent = filtered
      ? `Найдено: ${list.length} из ${total}`
      : `Показаны все ${total} ${plural(total, ...noun)}`;

    updateControls();
    syncUrl();
  }

  function updateControls() {
    el.categories.querySelectorAll('.seg').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.cat === state.category)));
    el.sort.value = state.sort;
    el.reset.disabled = isDefault();
    el.clear.hidden = !el.search.value;
    const cat = categories.find((c) => c.name === state.category);
    el.hint.textContent = cat ? cat.description : '';

    el.views.querySelectorAll('.seg').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    el.dictionary.classList.toggle('is-groups', state.view === 'groups');
    const g = groups.find((x) => x.slug === state.group);
    el.groupChip.hidden = !g || state.view === 'groups';
    if (g) {
      el.groupChip.textContent = `Группа: ${g.name} ×`;
      el.groupChip.setAttribute('aria-label', `Группа: ${g.name}. Нажмите, чтобы убрать фильтр`);
    }
  }

  function buildCategoryButtons() {
    const defs = [{ name: '', label: 'Все', count: items.length }].concat(
      categories.map((c) => ({ name: c.name, label: c.plural, count: items.filter((it) => it.category === c.name).length })));
    defs.forEach((d) => {
      const b = make('button', 'seg');
      b.type = 'button';
      b.dataset.cat = d.name;
      b.setAttribute('aria-pressed', 'false');
      b.append(make('span', '', d.label), make('span', '', `(${d.count})`));
      el.categories.append(b);
    });
  }

  // ===== Адрес страницы: ?q=…&category=…&sort=… =====
  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.q = (p.get('q') || '').slice(0, 100);
    const cat = p.get('category') || '';
    state.category = categories.some((c) => c.name === cat) ? cat : '';
    state.sort = p.get('sort') === 'category' ? 'category' : 'alpha';
    state.view = p.get('view') === 'groups' && groups.length ? 'groups' : 'all';
    const g = p.get('group') || '';
    state.group = state.view === 'all' && groups.some((x) => x.slug === g) ? g : '';
    el.search.value = state.q;
  }
  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    if (state.sort !== DEFAULTS.sort) p.set('sort', state.sort);
    if (state.view !== DEFAULTS.view) p.set('view', state.view);
    if (state.group) p.set('group', state.group);
    const s = p.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash); } catch (e) { /* file:// и т. п. */ }
  }

  // ===== Положение прокрутки при возврате со страницы записи =====
  const SCROLL_KEY = 'kk-list-scroll';
  function saveScroll() {
    try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ search: location.search, y: window.scrollY })); } catch (e) { /* хранилище недоступно */ }
  }
  function restoreScroll() {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (!nav || nav.type !== 'back_forward') return; // только «Назад/Вперёд»
      const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null');
      if (saved && saved.search === location.search) window.scrollTo({ top: saved.y, behavior: 'instant' });
    } catch (e) { /* ничего страшного */ }
  }

  // ===== События =====
  function resetAll() {
    const view = state.view;
    Object.assign(state, DEFAULTS, { view });
    el.search.value = '';
    render();
  }

  let timer;
  function bindEvents() {
    el.search.addEventListener('input', () => {
      el.clear.hidden = !el.search.value;
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = el.search.value; render(); }, CONFIG.debounceMs);
    });
    el.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.search.value) {
        e.preventDefault();
        clearTimeout(timer);
        el.search.value = ''; state.q = ''; render();
      }
    });
    el.clear.addEventListener('click', () => {
      clearTimeout(timer);
      el.search.value = ''; state.q = ''; render();
      el.search.focus();
    });
    el.categories.addEventListener('click', (e) => {
      const b = e.target.closest('.seg');
      if (!b) return;
      state.category = b.dataset.cat;
      render();
    });
    el.list.addEventListener('click', (e) => {
      if (e.target.closest('.card__link, .group-row a')) { saveScroll(); return; }
      const b = e.target.closest('[data-show-group]');
      if (!b) return;
      clearTimeout(timer);
      Object.assign(state, DEFAULTS, { view: 'all', group: b.dataset.showGroup });
      el.search.value = '';
      render();
      el.allTitle.scrollIntoView();
      el.groupChip.focus({ preventScroll: true });
    });
    el.views.addEventListener('click', (e) => {
      const b = e.target.closest('.seg');
      if (!b) return;
      state.view = b.dataset.view;
      if (state.view === 'groups') state.group = '';
      render();
    });
    el.groupChip.addEventListener('click', () => {
      state.group = '';
      render();
      el.categories.querySelector('.seg').focus();
    });
    el.sort.addEventListener('change', () => { state.sort = el.sort.value; render(); });
    el.reset.addEventListener('click', resetAll);
    el.emptyReset.addEventListener('click', resetAll);

    // Кнопка в hero: к полю поиска и фокус в него
    el.start.addEventListener('click', () => {
      el.search.scrollIntoView();
      el.search.focus({ preventScroll: true });
    });
  }

  // ===== Форма «Предложить запись» (Web3Forms) =====
  function initSuggestForm() {
    const form = $('proposal');
    if (!form) return;
    const statusEl = $('form-status');
    const btn = $('submit-btn');
    const COOLDOWN_MS = 30000; // пауза после успешной отправки
    let sending = false;

    // Поля формы: id, название поля в письме, обязательность
    const fields = [
      { id: 'f-phrase', name: 'Название', required: true },
      { id: 'f-category', name: 'Категория', required: true },
      { id: 'f-meaning', name: 'Значение', required: true },
      { id: 'f-appearing', name: 'Происхождение' },
      { id: 'f-example', name: 'Пример' },
      { id: 'f-author', name: 'Автор' }
    ];
    fields.forEach((f) => { f.input = $(f.id); f.error = $(f.id + '-error'); });

    function setError(f, msg) {
      f.error.textContent = '⚠ ' + msg; // значок, чтобы ошибка была видна не только цветом
      f.error.hidden = false;
      f.input.setAttribute('aria-invalid', 'true');
    }
    function clearError(f) {
      f.error.textContent = '';
      f.error.hidden = true;
      f.input.removeAttribute('aria-invalid');
    }
    // Возвращает текст ошибки или пустую строку
    function check(f) {
      const v = f.input.value.trim();
      if (f.required && !v) return f.id === 'f-category' ? 'Выберите категорию.' : 'Заполните это поле.';
      if (f.id === 'f-phrase') {
        if (v.length < 2) return 'Название должно быть не короче 2 символов.';
        if (/\.$/.test(v)) return 'Уберите точку в конце названия.';
      }
      return '';
    }
    function showStatus(type, msg) {
      statusEl.className = 'form-status form-status--' + type;
      statusEl.setAttribute('role', type === 'ok' ? 'status' : 'alert');
      statusEl.textContent = (type === 'ok' ? '✓ ' : '⚠ ') + msg;
    }
    function clearStatus() {
      statusEl.className = 'form-status';
      statusEl.textContent = '';
    }

    // Ошибка пропадает, когда человек начинает исправлять поле
    fields.forEach((f) => {
      f.input.addEventListener('input', () => { clearError(f); if (f.id === 'f-meaning') updateCounter(); });
      f.input.addEventListener('change', () => clearError(f));
    });

    // Пустой результат поиска: «Предложить запись» ведёт к форме и подставляет запрос
    el.suggest.addEventListener('click', (e) => {
      e.preventDefault();
      const q = state.q.trim();
      if (q && !fields[0].input.value) { fields[0].input.value = q.slice(0, 80); }
      $('suggest-form').scrollIntoView();
      fields[0].input.focus({ preventScroll: true });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (sending) return;
      clearStatus();

      // Проверка на стороне браузера; фокус на первое ошибочное поле
      let firstBad = null;
      fields.forEach((f) => {
        const msg = check(f);
        if (msg) { setError(f, msg); firstBad = firstBad || f; } else clearError(f);
      });
      if (firstBad) { firstBad.input.focus(); return; }

      // Ловушка для ботов: делаем вид, что всё прошло, но ничего не отправляем
      if ($('botcheck').checked) { showStatus('ok', 'Спасибо! Предложение отправлено на проверку.'); form.reset(); updateCounter(); return; }

      const payload = {
        access_key: CONFIG.formKey,
        subject: 'Новое предложение в Словарь мемов Киберкамбека',
        from_name: 'Словарь мемов Киберкамбека'
      };
      fields.forEach((f) => { const v = f.input.value.trim(); if (v) payload[f.name] = v; }); // пустые поля не шлём

      sending = true;
      btn.disabled = true;
      btn.textContent = 'Отправляем…';
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15000);
      let ok = false;
      try {
        const res = await fetch(CONFIG.formEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal
        });
        const data = await res.json().catch(() => ({}));
        ok = res.ok && data.success === true;
        if (!ok) console.error('Web3Forms вернул ошибку:', res.status, data);
      } catch (err) {
        console.error('Не удалось отправить форму:', err);
      } finally {
        clearTimeout(timeout);
      }

      sending = false;
      if (ok) {
        showStatus('ok', 'Спасибо! Предложение отправлено на проверку.');
        form.reset();
        updateCounter();
        // Пауза, чтобы форму не отправляли подряд
        btn.textContent = 'Подождите немного…';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Отправить'; }, COOLDOWN_MS);
      } else {
        // Введённые данные сохраняются, можно попробовать ещё раз
        showStatus('error', 'Не получилось отправить. Проверьте соединение и попробуйте ещё раз.');
        btn.disabled = false;
        btn.textContent = 'Отправить';
      }
    });
  }

  // ===== Контакты, ошибки, запуск =====
  function fillConfigTexts() {
    document.querySelectorAll('[data-contact]').forEach((a) => {
      a.textContent = CONFIG.contactLabel;
      if (a.tagName === 'A') a.href = CONFIG.contactHref;
    });
    document.querySelectorAll('[data-updated]').forEach((s) => { s.textContent = CONFIG.updated; });
    el.suggest.href = '#suggest-form';
  }

  function showError() {
    el.dictionary.classList.add('is-failed');
    el.status.setAttribute('role', 'alert');
    const a = make('a', 'link', CONFIG.contactLabel);
    a.href = CONFIG.contactHref;
    el.status.replaceChildren('Записи не загрузились. Попробуйте обновить страницу. Если ошибка повторяется, сообщите нам: ', a);
  }

  async function init() {
    fillConfigTexts();
    bindEvents(); // кнопка «Начать поиск» работает сразу
    initSuggestForm(); // форма работает независимо от загрузки словаря
    try {
      ({ categories, items } = validate(await loadData()));
      if (!items.length) throw new Error('Нет ни одной корректной записи');
    } catch (err) {
      console.error('Не удалось загрузить словарь:', err);
      showError();
      return;
    }

    let rawGroups = null;
    try { rawGroups = await loadData(CONFIG.groupsUrl); }
    catch (err) { console.warn('Группы не загружены:', err); }
    groups = validateGroups(rawGroups, items);
    el.viewWrap.hidden = !groups.length;

    // Старые ссылки вида #ph-001 ведут на страницу записи
    const old = location.hash.length > 1 && items.find((it) => '#' + it.id === location.hash);
    if (old) { location.replace(entryUrl(old)); return; }

    const n = items.length, c = categories.length;
    el.heroStats.textContent = `${n} ${plural(n, 'запись', 'записи', 'записей')} · ${c} ${plural(c, 'категория', 'категории', 'категорий')}`;
    buildCategoryButtons();
    readUrl();
    render();

    restoreScroll();
  }

  init();
})();
