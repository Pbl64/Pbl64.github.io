/* Страница записи: «← Ко всем понятиям» возвращает на главную через историю браузера,
   чтобы сохранились поиск, фильтры и положение прокрутки. */
(() => {
  'use strict';
  const back = document.getElementById('back');
  if (!back) return;
  back.addEventListener('click', (e) => {
    try {
      if (!document.referrer || history.length < 2) return; // откроется обычная ссылка
      const ref = new URL(document.referrer);
      if (ref.origin === location.origin && !ref.pathname.includes('/entry/') && !ref.pathname.includes('/group/')) {
        e.preventDefault();
        history.back();
      }
    } catch (err) { /* остаётся обычная ссылка */ }
  });
})();
