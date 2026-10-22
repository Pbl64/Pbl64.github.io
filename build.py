#!/usr/bin/env python3
"""Генератор страниц записей для «Словаря мемов Киберкамбека».

Что делает:
  data/phrases.json  →  entry/<slug>/index.html  для каждой записи
                     →  sitemap.xml              (только если указан site_url)

Запуск:  python build.py
Нужен только Python 3.8+, сторонние библиотеки не нужны.

Все данные записи лежат в одном файле data/phrases.json. Кроме основных полей
(id, slug, phrase, meaning, category, appearing, example) у записи есть:

  "date":   "декабрь 2024"          – дата появления, выводится рядом с «Происхождением»
  "links":  [{"text": "Название источника", "url": "https://..."}]
                                      – выводятся в тексте через запятую
  "images": [{"src": "images/memes/slug/1.jpg", "alt": "Описание", "caption": "Подпись"}]
                                      – локальные файлы (путь от корня сайта) или https-ссылки;
                                        width и height необязательны

Пустые поля ("", []) на странице не выводятся.
"""
import json
import re
import shutil
import sys
from datetime import date
from html import escape
from pathlib import Path

# ===== Настройки: меняются один раз =====
CONFIG = {
    # Адрес сайта без слэша на конце, например "https://username.github.io/repo".
    # Нужен для превью ссылок в Telegram/ВК и для sitemap.xml. Пусто — они не создаются.
    "site_url": "https://pbl64.github.io",
    "site_name": "Словарь мемов Киберкамбека",
    # Картинка для превью ссылок (лучше 1200×630), путь от корня сайта, например "images/og.png".
    "og_image": "",
    # Те же значения, что в CONFIG в js/app.js
    "contact_label": "kiberkambek@gmail.com",
    "contact_href": "mailto:kiberkambek@gmail.com",
    "updated": "октябрь 2026",
}

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "phrases.json"
OUT_DIR = ROOT / "entry"
SITEMAP = ROOT / "sitemap.xml"

CAT_CLASS = {"Мем": "card--meme", "Предложение": "card--sentence", "Персонаж": "card--character"}
SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")  # то же правило, что в js/app.js

warnings = []
errors = []


def warn(msg):
    warnings.append(msg)
    print("  ! " + msg)


def fail(msg):
    errors.append(msg)
    print("  ✗ " + msg)


# ===== Вспомогательные функции =====
def e(text):
    return escape(str(text), quote=True)


def clean_str(value):
    return value.strip() if isinstance(value, str) else ""


def short_text(text, limit=160):
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(" ,;:.–-")
    return cut + "…"


def paragraphs(value):
    """Строка (абзацы через пустую строку) → HTML."""
    parts = re.split(r"\n\s*\n", clean_str(value))
    return "".join("<p>" + e(p).replace("\n", "<br>") + "</p>" for p in parts if p)


def asset_url(src):
    """Путь из JSON (от корня сайта) → путь со страницы entry/<slug>/."""
    src = clean_str(src)
    if re.match(r"^https?://", src):
        return src
    return "../../" + src.lstrip("/")


# ===== Чтение данных =====
def clean_links(items, where):
    if items in (None, ""):
        return []
    if not isinstance(items, list):
        warn(f"{where}: links должен быть списком. Пропущено.")
        return []
    out = []
    for it in items:
        text = clean_str(it.get("text")) if isinstance(it, dict) else ""
        url = clean_str(it.get("url")) if isinstance(it, dict) else ""
        if not text or not re.match(r"^(https?://|mailto:)", url):
            warn(f"{where}: ссылка пропущена (нужны text и url, начинающийся с http:// или https://).")
            continue
        out.append({"text": text, "url": url})
    return out


def clean_images(items, where):
    if items in (None, ""):
        return []
    if not isinstance(items, list):
        warn(f"{where}: images должен быть списком. Пропущено.")
        return []
    out = []
    for it in items:
        src = clean_str(it.get("src")) if isinstance(it, dict) else ""
        if not src:
            warn(f"{where}: картинка без src пропущена.")
            continue
        alt = clean_str(it.get("alt"))
        if not alt:
            warn(f"{where}: у картинки {src} нет alt (описания для скринридеров).")
        if not re.match(r"^https?://", src) and not (ROOT / src.lstrip("/")).is_file():
            warn(f"{where}: файл {src} не найден.")
        out.append({"src": src, "alt": alt, "caption": clean_str(it.get("caption")),
                    "width": it.get("width"), "height": it.get("height")})
    return out


def load_records():
    raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    categories = {c["name"] for c in raw.get("categories", []) if isinstance(c, dict) and c.get("name")}
    records, ids, slugs = [], set(), {}

    for i, r in enumerate(raw.get("phrases", []), 1):
        where = f"Запись №{i}" + (f" ({r.get('id')})" if isinstance(r, dict) and r.get("id") else "")
        if not isinstance(r, dict):
            warn(f"{where}: не объект. Пропущена.")
            continue
        missing = [k for k in ("id", "phrase", "meaning", "category") if not clean_str(r.get(k))]
        if missing:
            warn(f"{where}: нет полей {', '.join(missing)}. Пропущена (как и на сайте).")
            continue
        if r["id"] in ids:
            warn(f"{where}: id повторяется. Пропущена.")
            continue
        if r["category"] not in categories:
            warn(f"{where}: категории «{r['category']}» нет в списке. Пропущена.")
            continue
        ids.add(r["id"])

        # slug: поле slug, а если его нет или он неверный — id (так же делает js/app.js)
        slug = clean_str(r.get("slug"))
        if not slug:
            slug = r["id"]
        elif not SLUG_RE.match(slug):
            warn(f"{where}: slug «{slug}» неверный (только a–z, 0–9 и дефисы). Использован id.")
            slug = r["id"]
        if slug in slugs:
            fail(f"{where}: slug «{slug}» уже занят записью {slugs[slug]}.")
            continue
        slugs[slug] = r["id"]

        rec = {k: clean_str(r.get(k)) for k in ("id", "phrase", "meaning", "category", "appearing", "date", "example")}
        rec["slug"] = slug
        rec["links"] = clean_links(r.get("links"), where)
        rec["images"] = clean_images(r.get("images"), where)
        records.append(rec)
    return records


# ===== Шаблон страницы =====
def section(title, inner, extra=""):
    head = f'<h2 class="entry__h">{e(title)}</h2>'
    if extra:
        head = f'<div class="entry__head">{head}{extra}</div>'
    return f'<section class="entry__section">{head}{inner}</section>'


def render_links(links):
    """Ссылки-слова через запятую в одном абзаце."""
    items = [f'<a class="link" href="{e(l["url"])}">{e(l["text"])}</a>' for l in links]
    return '<p class="entry__sources">' + ", ".join(items) + "</p>"


def render_gallery(images):
    figs = []
    for g in images:
        size = ""
        if isinstance(g["width"], int) and isinstance(g["height"], int):
            size = f' width="{g["width"]}" height="{g["height"]}"'
        cap = f"<figcaption>{e(g['caption'])}</figcaption>" if g["caption"] else ""
        figs.append(f'<li><figure><img src="{e(asset_url(g["src"]))}" alt="{e(g["alt"])}"{size} loading="lazy">{cap}</figure></li>')
    return '<ul class="gallery">' + "".join(figs) + "</ul>"


def render_page(rec):
    c = CONFIG
    site = c["site_name"]
    title = f"{rec['phrase']} – {site}"
    desc = short_text(rec["meaning"])
    url = f"{c['site_url']}/entry/{rec['slug']}/" if c["site_url"] else ""

    head_extra = ""
    if url:
        head_extra += f'<link rel="canonical" href="{e(url)}">\n  <meta property="og:url" content="{e(url)}">\n  '
    if c["site_url"] and c["og_image"]:
        head_extra += f'<meta property="og:image" content="{e(c["site_url"] + "/" + c["og_image"].lstrip("/"))}">\n  '

    # Порядок абзацев: Значение → Происхождение (+ дата) → Пример → Ссылки
    sections = [section("Значение", paragraphs(rec["meaning"]))]
    if rec["appearing"] or rec["date"]:
        date_html = f'<span class="entry__date">{e(rec["date"])}</span>' if rec["date"] else ""
        sections.append(section("Происхождение", paragraphs(rec["appearing"]), date_html))
    if rec["example"]:
        sections.append(section("Пример", f'<p class="example">{e(rec["example"])}</p>'))
    if rec["links"]:
        sections.append(section("Ссылки", render_links(rec["links"])))

    aside = ""
    if rec["images"]:
        aside = (
            '<aside class="entry__aside" aria-labelledby="gallery-title">'
            '<h2 class="entry__h" id="gallery-title">Галерея</h2>'
            + render_gallery(rec["images"]) + "</aside>"
        )
    layout_cls = "entry__layout" + (" entry__layout--gallery" if aside else "")

    contact = f'<a data-contact href="{e(c["contact_href"])}">{e(c["contact_label"])}</a>'

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}">
  <meta name="theme-color" content="#111111">
  {head_extra}<meta property="og:type" content="article">
  <meta property="og:site_name" content="{e(site)}">
  <meta property="og:title" content="{e(title)}">
  <meta property="og:description" content="{e(desc)}">
  <meta property="og:locale" content="ru_RU">
  <meta name="twitter:card" content="summary">
  <link rel="icon" href="../../images/favicon.svg" type="image/svg+xml">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Literata:wght@500;700&display=swap">
  <link rel="stylesheet" href="../../css/styles.css">
  <script src="../../js/entry.js" defer></script>
</head>
<body id="top">
  <a class="skip" href="#content">Перейти к содержимому</a>

  <header class="site-head">
    <div class="stripe" aria-hidden="true"></div>
    <div class="wrap site-head__inner">
      <a class="site-head__name" href="../../">{e(site)}</a>
    </div>
  </header>

  <main class="wrap entry" id="content">
    <nav class="crumbs" aria-label="Навигация">
      <a class="link" id="back" href="../../#all-title">← Ко всем понятиям</a>
    </nav>

    <div class="{layout_cls}">
      <article class="card entry__card {CAT_CLASS.get(rec['category'], '')}">
        <h1 class="entry__title">{e(rec['phrase'])}</h1>
        <span class="tag">{e(rec['category'])}</span>
        {''.join(sections)}
      </article>
      {aside}
    </div>
  </main>

  <footer class="footer">
    <div class="stripe" aria-hidden="true"></div>
    <div class="wrap footer__inner">
      <p class="footer__title">Словарь понятий Киберкамбека</p>
      <p class="footer__text">Составлен участниками локальной группы Киберкамбек.</p>
      <p class="footer__text">Названия игр принадлежат их правообладателям. Сайт неофициальный и не связан с ними.</p>
      <nav aria-label="Разделы сайта">
        <ul class="footer__nav">
          <li><a href="../../#search">Поиск</a></li>
          <li><a href="../../#all-title">Все записи</a></li>
          <li><a href="../../#suggest-form">Предложить запись</a></li>
          <li><a href="../../#about">О словаре</a></li>
        </ul>
      </nav>
      <p class="footer__text">Контакт: {contact}</p>
      <p class="footer__text">© Cybercomeback LLC 2026 · Обновлено: {e(c['updated'])}</p>
      <a class="to-top" href="#top">Наверх ↑</a>
    </div>
  </footer>
</body>
</html>
"""


def write_sitemap(records):
    site = CONFIG["site_url"]
    if not site:
        if SITEMAP.exists():
            SITEMAP.unlink()
        return
    today = date.today().isoformat()
    urls = [site + "/"] + [f"{site}/entry/{r['slug']}/" for r in records]
    body = "".join(f"  <url><loc>{e(u)}</loc><lastmod>{today}</lastmod></url>\n" for u in urls)
    SITEMAP.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n",
        encoding="utf-8")


def main():
    print("Сборка страниц записей…")
    records = load_records()
    if errors:
        print(f"\nСборка остановлена: ошибок {len(errors)}.")
        return 1

    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)  # убираем страницы удалённых записей
    for rec in records:
        folder = OUT_DIR / rec["slug"]
        folder.mkdir(parents=True)
        (folder / "index.html").write_text(render_page(rec), encoding="utf-8")
    write_sitemap(records)

    if not CONFIG["site_url"]:
        warn("site_url не задан: у страниц не будет canonical и og:url, sitemap.xml не создан.")
    print(f"\nГотово: страниц {len(records)}, предупреждений {len(warnings)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
