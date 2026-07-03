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
        title: (link.textContent || '').trim(),
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
