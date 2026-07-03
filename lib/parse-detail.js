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
        if (t !== label && !t.startsWith(label)) continue;
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

  function parseDetailPage() {
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

  self.SahibindenParseDetail = { parseDetailPage };
})();
