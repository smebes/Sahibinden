/* global self */
(function () {
  function cleanIlanNo(raw) {
    if (!raw) return null;
    const m = String(raw).match(/\d{6,}/);
    return m ? m[0] : String(raw).trim().slice(0, 64) || null;
  }

  function valueAfterStrong(label) {
    const strongs = document.querySelectorAll('strong');
    for (const el of strongs) {
      const t = (el.textContent || '').trim();
      if (t !== label && !t.startsWith(label)) continue;
      const sibling = el.nextSibling;
      if (sibling?.textContent?.trim()) return sibling.textContent.trim();
      const parentNext = el.parentElement?.nextElementSibling;
      if (parentNext?.textContent?.trim()) return parentNext.textContent.trim();
    }
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
        jsonLd = JSON.parse(ldScript.textContent);
      } catch {
        jsonLd = null;
      }
    }

    const breadcrumbLinks = [...document.querySelectorAll('.classifiedInfo h2 a, .classifiedDetailTitle a, nav a')]
      .map((a) => (a.textContent || '').trim())
      .filter(Boolean);
    const konum = breadcrumbLinks.slice(-3).join(' / ') || valueAfterStrong('İl');

    return {
      ilanNo: cleanIlanNo(valueAfterStrong('İlan No')),
      ilanTarihi: valueAfterStrong('İlan Tarihi'),
      fiyat: priceEl ? (priceEl.textContent || '').trim() : null,
      konum,
      kategori: valueAfterStrong('Kategori'),
      tipi: valueAfterStrong('Tipi'),
      urun: valueAfterStrong('Ürün'),
      aracMarkasi: valueAfterStrong('Araç Markası'),
      aracSerisi: valueAfterStrong('Araç Serisi'),
      urunMarkasi: valueAfterStrong('Ürün Markası'),
      kimden: valueAfterStrong('Kimden'),
      cikmaYedek: valueAfterStrong('Çıkma Yedek Parça'),
      durumu: valueAfterStrong('Durumu'),
      aciklama: (document.querySelector('.classifiedDescription')?.textContent || '').trim(),
      gorseller,
      jsonLd,
    };
  }

  self.SahibindenParseDetail = { parseDetailPage };
})();
