/* global self */
(function () {
  function norm(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function cleanIlanNo(raw) {
    if (!raw || raw === 'undefined') return null;
    const m = String(raw).match(/\d{6,}/);
    return m ? m[0] : null;
  }

  function ilanNoFromUrl() {
    const m = String(window.location.pathname || '').match(/(\d{6,})\/detay/);
    return m ? m[1] : null;
  }

  /** Sahibinden: <li><strong>Label</strong> value</li> */
  function fieldValue(label) {
    const selectors = [
      '.classifiedInfoList li',
      '.classifiedInfo li',
      '#classifiedProperties li',
      '.uiBoxContainer .classifiedInfo li',
      'ul.classifiedDetailList li',
    ];
    for (const sel of selectors) {
      for (const li of document.querySelectorAll(sel)) {
        const strong = li.querySelector('strong');
        if (!strong) continue;
        const t = norm(strong.textContent);
        if (t !== label) continue;
        const clone = li.cloneNode(true);
        clone.querySelectorAll('strong').forEach((s) => s.remove());
        const val = norm(clone.textContent);
        if (val) return val;
      }
    }
    return null;
  }

  function buildKonum() {
    const il = fieldValue('İl');
    const ilce = fieldValue('İlçe');
    const mahalle = fieldValue('Mahalle');
    const parts = [il, ilce, mahalle].filter(Boolean);
    if (parts.length) return parts.join(' / ');
    const locEl = document.querySelector(
      '.classifiedInfo h2, .classified-detail-location, [class*="location"]'
    );
    const loc = norm(locEl?.textContent);
    if (loc && /\//.test(loc)) return loc;
    return null;
  }

  function extractPageTitle() {
    const h1 = document.querySelector('.classifiedDetailTitle h1');
    if (h1) {
      const t = norm(h1.textContent);
      if (t.length > 5) return t.replace(/\s*#\d{6,}\s*$/i, '').trim();
    }
    const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
    if (og) {
      const t = norm(og)
        .replace(/\s*[-|]\s*sahibinden\.com.*$/i, '')
        .replace(/\s*#\d{6,}\s*$/i, '')
        .trim();
      if (t.length > 5) return t;
    }
    return null;
  }

  function pageSnippets(doc) {
    const root = doc || document;
    const title = norm(root.querySelector('title')?.textContent).toLowerCase();
    const bodyText = norm(root.body?.innerText || root.body?.textContent || '').slice(0, 4000);
    return { title, bodyText };
  }

  /**
   * 403 / captcha / güvenlik engeli — GEÇİCİ.
   * parse-list.js ile aynı mantık. isListingGone'dan ÖNCE çağrılmalı.
   */
  function isAccessBlocked(doc) {
    const { title, bodyText } = pageSnippets(doc);
    if (!title && !bodyText) return false;
    if (title.includes('403') || title.includes('erişim')) return true;
    if (/captcha|robot|güvenlik|cloudflare|access denied|erişiminiz engellendi/i.test(bodyText.slice(0, 2500))) {
      return true;
    }
    // Captcha widget / challenge DOM
    if ((doc || document).querySelector('#captcha, .captcha, [class*="captcha"], iframe[src*="captcha"]')) {
      return true;
    }
    return false;
  }

  /**
   * Yayından kalkmış / 404 / satışta değil — KALICI.
   * Engelli sayfada ASLA true dönmez (false positive koruması).
   */
  function isListingGone(doc) {
    if (isAccessBlocked(doc)) return false;

    const { title, bodyText } = pageSnippets(doc);
    if (/^\s*404\b/.test(title) || /\bnot found\b/i.test(title)) return true;
    // title'da sadece "bulunamadı" yetmez — captcha sayfalarında da geçebilir;
    // body ile birlikte net yayından kalkma ifadeleri aranır.
    if (!bodyText) return false;

    const gonePatterns = [
      /yayından\s+kaldırılmış/i,
      /yayından\s+kalkmış/i,
      /ilan\s+yayından\s+kaldırıldı/i,
      /bu\s+ilan\s+yayından\s+kaldırılmıştır/i,
      /ilan\s+bulunamadı/i,
      /artık\s+satışta\s+değil/i,
      /ilan\s+satışta\s+değil/i,
      /bu\s+ilan\s+yayında\s+değil/i,
      /ilan\s+kaldırıldı/i,
    ];
    return gonePatterns.some((re) => re.test(bodyText));
  }

  function parseDetailPage() {
    // Sıra kritik: 1) engel (geçici) → 2) ölü ilan (kalıcı) → 3) normal parse
    if (isAccessBlocked()) {
      return { accessBlocked: true, ilanNo: ilanNoFromUrl() };
    }
    if (isListingGone()) {
      return { listingGone: true, ilanNo: ilanNoFromUrl() };
    }

    const priceEl = document.querySelector('.classifiedDetailMainPrice, [itemprop="price"]');
    const photos = typeof SahibindenPhotoUrls !== 'undefined'
      ? SahibindenPhotoUrls.collectFromDocument(document)
      : [...document.querySelectorAll('img[src*="shbdn.com/photos"], img[data-src*="shbdn.com/photos"]')]
        .flatMap((img) => [img.getAttribute('src'), img.getAttribute('data-src')].filter(Boolean));

    const gorseller = typeof SahibindenPhotoUrls !== 'undefined'
      ? SahibindenPhotoUrls.buildGorsellerSets(photos)
      : { thumbnail: photos, medium: photos, large: photos, count: photos.length };

    const domPhotoCount = typeof SahibindenPhotoUrls !== 'undefined'
      ? SahibindenPhotoUrls.extractPhotoCount(document)
      : null;
    if (domPhotoCount && domPhotoCount > gorseller.count) {
      gorseller.count = domPhotoCount;
    }

    let jsonLd = null;
    const ldScript = document.querySelector('script[type="application/ld+json"]');
    if (ldScript?.textContent) {
      try {
        const parsed = JSON.parse(ldScript.textContent);
        jsonLd = Array.isArray(parsed)
          ? parsed.find((x) => x['@type'] === 'BreadcrumbList') || parsed[0]
          : parsed;
      } catch {
        jsonLd = null;
      }
    }

    const ilanNo = cleanIlanNo(fieldValue('İlan No')) || ilanNoFromUrl();

    return {
      title: extractPageTitle(),
      ilanNo,
      ilanTarihi: fieldValue('İlan Tarihi'),
      fiyat: priceEl ? norm(priceEl.textContent) : fieldValue('Fiyat'),
      konum: buildKonum(),
      kategori: fieldValue('Kategori'),
      tipi: fieldValue('Tipi'),
      urun: fieldValue('Ürün'),
      aracMarkasi: fieldValue('Araç Markası'),
      aracSerisi: fieldValue('Araç Serisi'),
      urunMarkasi: fieldValue('Ürün Markası'),
      kimden: fieldValue('Kimden'),
      cikmaYedek: fieldValue('Çıkma Yedek Parça'),
      durumu: fieldValue('Durumu'),
      aciklama: norm(document.querySelector('.classifiedDescription')?.textContent),
      gorseller,
      jsonLd,
    };
  }

  self.SahibindenParseDetail = { parseDetailPage, isListingGone, isAccessBlocked };
})();
