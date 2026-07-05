/* global self */
(function () {
  function normalizeListingUrl(href) {
    if (!href) return null;
    try {
      const raw = href.trim();
      const url = new URL(raw.startsWith('http') ? raw : `https://www.sahibinden.com${raw.startsWith('/') ? raw : `/${raw}`}`);
      if (!url.hostname.includes('sahibinden.com')) return null;
      const match = url.pathname.match(/\/ilan\/([^/]+)/i);
      if (!match) return null;
      url.hash = '';
      url.search = '';
      if (!url.pathname.endsWith('/detay')) {
        url.pathname = `/ilan/${match[1]}/detay`;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  function extractIlanId(url) {
    const m = String(url || '').match(/(\d{6,})\/detay/);
    return m ? m[1] : null;
  }

  function cleanListTitle(raw, ilanId) {
    let t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    if (ilanId) t = t.replace(new RegExp(`\\s*#${ilanId}\\s*$`, 'i'), '').trim();
    return t.length > 2 ? t : null;
  }

  function titleFromUrlSlug(href) {
    const m = String(href || '').match(/\/ilan\/(.+)-(\d{6,})\/detay/i);
    if (!m) return null;
    let slug = m[1];
    const cut = slug.lastIndexOf('yedek-parca-');
    if (cut >= 0) slug = slug.slice(cut + 'yedek-parca-'.length);
    const parts = slug.split('-').filter(Boolean);
    if (parts.length < 2) return null;
    const partNo = parts[0].toUpperCase();
    const rest = parts.slice(1).join(' ').toLocaleUpperCase('tr-TR');
    return `${partNo} - ${rest}`;
  }

  function extractRowTitle(row, link) {
    const ilanId = extractIlanId(link.getAttribute('href') || link.href);
    const selectors = [
      'td.searchResultsTitleValue',
      '.searchResultsTitleValue',
      '.classifiedTitle',
      'td[class*="Title"]',
      '[class*="classifiedTitle"]',
    ];
    for (const sel of selectors) {
      const el = row.querySelector(sel);
      const linkInCell = el?.querySelector('a[href*="/ilan/"]') || link;
      const candidates = [
        linkInCell.getAttribute('title'),
        linkInCell.textContent,
        el?.textContent,
      ];
      for (const raw of candidates) {
        const t = cleanListTitle(raw, ilanId);
        if (t && t.length > 5 && !/^https?:/i.test(t)) return t;
      }
    }
    const fromAttr = cleanListTitle(link.getAttribute('title'), ilanId);
    if (fromAttr) return fromAttr;
    const fromLink = cleanListTitle(link.textContent, ilanId);
    if (fromLink) return fromLink;
    return titleFromUrlSlug(link.getAttribute('href') || link.href);
  }

  function collectListItems(root) {
    const doc = root || document;
    const items = [];
    const seen = new Set();

    function pushItem(link, row) {
      const url = normalizeListingUrl(link.getAttribute('href') || link.href);
      if (!url) return;
      const ilanId = extractIlanId(url);
      if (!ilanId || seen.has(ilanId)) return;
      seen.add(ilanId);
      const img = row.querySelector('img');
      const rawThumb = img?.getAttribute('src') || img?.getAttribute('data-src') || img?.src || null;
      const thumbnail = typeof SahibindenPhotoUrls !== 'undefined'
        ? SahibindenPhotoUrls.normalizeThumbnail(rawThumb)
        : rawThumb;
      const tds = row.querySelectorAll('td');
      let price = null;
      let location = null;
      tds.forEach((td) => {
        const t = (td.textContent || '').trim();
        if (!price && /\d[\d.,]*\s*TL/i.test(t)) price = t;
        if (!location && /\s\/\s/.test(t) && t.length < 80) location = t;
      });
      items.push({
        ilanId,
        url,
        title: extractRowTitle(row, link),
        price,
        location,
        thumbnail,
      });
    }

    doc.querySelectorAll('table tr').forEach((tr) => {
      const link = tr.querySelector('a[href*="/ilan/"]');
      if (link) pushItem(link, tr);
    });

    if (!items.length) {
      doc.querySelectorAll('ul li').forEach((li) => {
        const link = li.querySelector('a[href*="/ilan/"]');
        if (link) pushItem(link, li);
      });
    }

    return items;
  }

  function extractTotalPages(root) {
    const doc = root || document;
    const bodyText = doc.body?.textContent || '';
    const pageMatch = bodyText.match(/Toplam\s+([\d.]+)\s+sayfa/i);
    return pageMatch ? parseInt(pageMatch[1].replace(/\./g, ''), 10) : null;
  }

  function parseListPageFromDocument(root) {
    const doc = root || document;
    const title = (doc.title || '').toLowerCase();
    const bodyText = doc.body?.textContent || '';
    const blocked = title.includes('403')
      || title.includes('erişim')
      || /captcha|robot|güvenlik/i.test(bodyText.slice(0, 2000));
    return {
      items: collectListItems(doc),
      totalPages: extractTotalPages(doc),
      blocked,
      pageUrl: doc.location?.href || null,
    };
  }

  function parseListPageHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return {
      items: collectListItems(doc),
      totalPages: extractTotalPages(doc),
      blocked: false,
      pageUrl: null,
    };
  }

  self.SahibindenParseList = {
    parseListPageHtml,
    parseListPageFromDocument,
    normalizeListingUrl,
    extractIlanId,
  };
})();
