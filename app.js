/* Словарь мемов Киберкамбека. Чистый JS (ES2017+), без зависимостей. */
(() => {
  'use strict';

  // ===== Настройки: меняются один раз при запуске сайта =====
  const CONFIG = {
    dataUrl: 'data/phrases.json',            // путь без начального слеша (важно для GitHub Pages)
    debounceMs: 180,                         // задержка поиска при вводе
    contactLabel: 'example@example.com',     // [контакт]: текст ссылки
    contactHref: 'mailto:example@example.com', // [контакт]: адрес ссылки (почта, Telegram и т. д.)
    updated: '[месяц и год]'                 // «Обновлено: …» в футере
  };

  // Класс карточки по названию категории
  const CAT_CLASS = { 'Мем': 'card--meme', 'Предложение': 'card--sentence', 'Персонаж': 'card--character' };
  const DEFAULTS = { q: '', category: '', sort: 'alpha' }; // category '' = «Все»

  const $ = (id) => document.getElementById(id);
  const el = {
    dictionary: $('dictionary'), status: $('status'), heroStats: $('hero-stats'),
    search: $('search'), clear: $('clear'), count: $('count'),
    categories: $('categories'), sort: $('sort'), reset: $('reset'), hint: $('cat-hint'),
    list: $('list'), empty: $('empty'), emptyTitle: $('empty-title'),
    emptyReset: $('empty-reset'), suggest: $('suggest'), start: $('start')
  };

  let categories = [];   // [{name, plural, description}]
  let items = [];        // проверенные записи
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
  const isDefault = () => state.q === DEFAULTS.q && state.category === DEFAULTS.category && state.sort === DEFAULTS.sort;

  // ===== Загрузка и проверка данных (сообщения только в консоль) =====
  async function loadData() {
    const res = await fetch(CONFIG.dataUrl, { cache: 'no-cache' });
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
      const appearing = optional('appearing');
      const example = optional('example');
      result.push({
        id: r.id, phrase: r.phrase.trim(), meaning: r.meaning.trim(), category: r.category,
        appearing, example,
        hay: fold([r.phrase, r.meaning, appearing].join('\n')) // поиск: phrase + meaning + appearing
      });
    });
    return { categories: cats, items: result };
  }

  // ===== Фильтрация и сортировка: категория → поиск → сортировка =====
  function getResults() {
    const tokens = fold(state.q).trim().split(/\s+/).filter(Boolean);
    const list = items.filter((it) =>
      (!state.category || it.category === state.category) && tokens.every((t) => it.hay.includes(t)));

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

  function makeCard(it, headingTag, tokens) {
    const li = make('li', 'card ' + (CAT_CLASS[it.category] || ''));
    li.id = it.id;

    const h = make(headingTag, 'card__title');
    appendHighlighted(h, it.phrase, tokens);
    li.append(h, make('span', 'tag', it.category));

    const meaning = make('p', 'meaning');
    appendHighlighted(meaning, it.meaning, tokens);
    li.append(meaning);

    if (it.appearing) {
      const p = make('p', 'origin');
      p.append(make('span', 'label', 'Происхождение'));
      appendHighlighted(p, it.appearing, tokens);
      li.append(p);
    }
    if (it.example) {
      const p = make('p', 'example');
      p.append(make('span', 'label', 'Пример'), it.example);
      li.append(p);
    }
    return li;
  }

  function makeList(group, headingTag, tokens) {
    const ul = make('ul', 'cards');
    group.forEach((it) => ul.append(makeCard(it, headingTag, tokens)));
    return ul;
  }

  function render() {
    const { list, tokens } = getResults();
    el.list.replaceChildren();

    if (list.length) {
      if (state.sort === 'category') {
        // Группы с заголовками; записи внутри получают h4
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

    // Пустой результат: фильтры остаются на месте
    el.empty.hidden = list.length > 0;
    if (!list.length) {
      const cat = categories.find((c) => c.name === state.category);
      el.emptyTitle.textContent = state.q.trim()
        ? `Ничего не нашлось по запросу «${state.q.trim()}»`
        : `В категории «${cat ? cat.plural : ''}» пока нет записей`;
    }

    // Счётчик
    const total = items.length;
    const filtered = state.q.trim() || state.category;
    el.count.textContent = filtered
      ? `Найдено: ${list.length} из ${total}`
      : `Показаны все ${total} ${plural(total, 'запись', 'записи', 'записей')}`;

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
    el.search.value = state.q;
  }
  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    if (state.sort !== DEFAULTS.sort) p.set('sort', state.sort);
    const s = p.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash); } catch (e) { /* file:// и т. п. */ }
  }

  // ===== События =====
  function resetAll() {
    Object.assign(state, DEFAULTS);
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
    el.sort.addEventListener('change', () => { state.sort = el.sort.value; render(); });
    el.reset.addEventListener('click', resetAll);
    el.emptyReset.addEventListener('click', resetAll);

    // Кнопка в hero: к полю поиска и фокус в него
    el.start.addEventListener('click', () => {
      el.search.scrollIntoView();
      el.search.focus({ preventScroll: true });
    });
  }

  // ===== Контакты, ошибки, запуск =====
  function fillConfigTexts() {
    document.querySelectorAll('[data-contact]').forEach((a) => {
      a.textContent = CONFIG.contactLabel;
      if (a.tagName === 'A') a.href = CONFIG.contactHref;
    });
    document.querySelectorAll('[data-updated]').forEach((s) => { s.textContent = CONFIG.updated; });
    el.suggest.href = CONFIG.contactHref;
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
    try {
      ({ categories, items } = validate(await loadData()));
      if (!items.length) throw new Error('Нет ни одной корректной записи');
    } catch (err) {
      console.error('Не удалось загрузить словарь:', err);
      showError();
      return;
    }

    const n = items.length, c = categories.length;
    el.heroStats.textContent = `${n} ${plural(n, 'запись', 'записи', 'записей')} · ${c} ${plural(c, 'категория', 'категории', 'категорий')}`;
    buildCategoryButtons();
    readUrl();
    render();

    // Переход по якорю вида #ph-001 (карточки появились уже после загрузки страницы)
    try {
      const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target && target.classList.contains('card')) target.scrollIntoView();
    } catch (e) { /* неверный якорь игнорируем */ }
  }

  init();
})();
