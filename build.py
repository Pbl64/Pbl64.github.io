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


def render_page(rec):
    title = f"{rec['phrase']} – {CONFIG['site_name']}"
    desc = short_text(rec["meaning"])
    sections = [section("Значение", paragraphs(rec["meaning"]))]
    if rec["appearing"] or rec["date"]:
        date_html = f'<span class="entry__date">{e(rec["date"])}</span>' if rec["date"] else ""
        sections.append(section("Происхождение", paragraphs(rec["appearing"]), date_html))
    if rec["example"]:
        sections.append(section("Пример", f'<p class="example">{e(rec["example"])}</p>'))
    if rec["links"]:
        sections.append(section("Ссылки", render_links(rec["links"])))
    groups_html = ""
    if rec.get("groups"):
        links = ", ".join(f'<a class="link" href="../../group/{e(g["slug"])}/">{e(g["name"])}</a>' for g in rec["groups"])
        label = "Группа" if len(rec["groups"]) == 1 else "Группы"
        groups_html = f'<p class="entry__groups">{label}: {links}</p>'
    aside = ""
    if rec["images"]:
        aside = ('<aside class="entry__aside" aria-labelledby="gallery-title">'
                 '<h2 class="entry__h" id="gallery-title">Галерея</h2>'
                 + render_gallery(rec["images"]) + "</aside>")
    layout_cls = "entry__layout" + (" entry__layout--gallery" if aside else "")
    main = f"""<main class="wrap entry" id="content">
    <nav class="crumbs" aria-label="Навигация">
      <a class="link" id="back" href="../../#all-title">← Ко всем понятиям</a>
    </nav>
    <div class="{layout_cls}">
      <article class="card entry__card {CAT_CLASS.get(rec['category'], '')}">
        <h1 class="entry__title">{e(rec['phrase'])}</h1>
        <span class="tag">{e(rec['category'])}</span>
        {groups_html}
        {''.join(sections)}
      </article>
      {aside}
    </div>
  </main>"""
    return shell(title, desc, f"entry/{rec['slug']}/", main)


def render_group_page(g):
    title = f"{g['name']} – {CONFIG['site_name']}"
    desc = short_text(g["description"]) or f"Группа понятий «{g['name']}»."
    sections = []
    if g["description"]:
        sections.append(section("Описание", paragraphs(g["description"])))
    if g["body"]:
        sections.append(section("Подробнее", paragraphs(g["body"])))
    cards = "".join(
        f'<li class="card {CAT_CLASS.get(r["category"], "")}">'
        f'<h3 class="card__title"><a class="card__link" href="../../entry/{e(r["slug"])}/">{e(r["phrase"])}</a></h3>'
        f'<span class="tag">{e(r["category"])}</span>'
        f'<p class="meaning meaning--clamp">{e(r["meaning"])}</p>'
        f'<p class="more" aria-hidden="true">Подробнее →</p></li>'
        for r in g["members"])
    members = (f'<section class="group-members" aria-labelledby="members-title">'
               f'<h2 id="members-title">Понятия группы ({len(g["members"])})</h2>'
               + (f'<ul class="cards">{cards}</ul>' if cards else "<p>В группе пока нет понятий.</p>")
               + "</section>")
    main = f"""<main class="wrap entry" id="content">
    <nav class="crumbs" aria-label="Навигация">
      <a class="link" id="back" href="../../?view=groups#all-title">← Ко всем группам</a>
    </nav>
    <div class="entry__layout">
      <article class="card entry__card">
        <h1 class="entry__title">{e(g['name'])}</h1>
        <span class="tag">Группа</span>
        {''.join(sections)}
      </article>
    </div>
    {members}
  </main>"""
    return shell(title, desc, f"group/{g['slug']}/", main, "website")


def write_sitemap(records, groups):
    site = CONFIG["site_url"]
    if not site:
        if SITEMAP.exists():
            SITEMAP.unlink()
        return
    today = date.today().isoformat()
    urls = [site + "/"] + [f"{site}/entry/{r['slug']}/" for r in records] + [f"{site}/group/{g['slug']}/" for g in groups]
    body = "".join(f"  <url><loc>{e(u)}</loc><lastmod>{today}</lastmod></url>\n" for u in urls)
    SITEMAP.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n",
        encoding="utf-8")


def main():
    print("Сборка страниц записей…")
    records = load_records()
    groups = load_groups(records)
    if errors:
        print(f"\\nСборка остановлена: ошибок {len(errors)}.")
        return 1

    for d in (OUT_DIR, GROUP_DIR):
        if d.exists():
            shutil.rmtree(d)
    for rec in records:
        folder = OUT_DIR / rec["slug"]
        folder.mkdir(parents=True)
        (folder / "index.html").write_text(render_page(rec), encoding="utf-8")
    for g in groups:
        folder = GROUP_DIR / g["slug"]
        folder.mkdir(parents=True)
        (folder / "index.html").write_text(render_group_page(g), encoding="utf-8")
    write_sitemap(records, groups)

    if not CONFIG["site_url"]:
        warn("site_url не задан: у страниц не будет canonical и og:url, sitemap.xml не создан.")
    print(f"\\nГотово: страниц {len(records)}, групп {len(groups)}, предупреждений {len(warnings)}.")
    return 0
