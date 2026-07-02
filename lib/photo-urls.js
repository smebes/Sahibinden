/* global self */
(function () {
  const PHOTO_HOST_RE = /shbdn\.com\/photos\//i;
  const PREFIX_RE = /\/(thmb|x5|big)_/i;

  function isPhotoUrl(url) {
    return !!url && PHOTO_HOST_RE.test(url);
  }

  function withPrefix(url, prefix) {
    return String(url).replace(PREFIX_RE, `/${prefix}_`);
  }

  function toBig(url) {
    return withPrefix(url, 'big');
  }

  function toThumb(url) {
    return withPrefix(url, 'thmb');
  }

  function toMedium(url) {
    return withPrefix(url, 'x5');
  }

  function photoKey(url) {
    const m = String(url).match(/\/(thmb|x5|big)_([^/?#]+)/i);
    return m ? m[2] : null;
  }

  function collectFromDocument(doc) {
    const root = doc || document;
    const raw = [];
    root.querySelectorAll('img[src*="shbdn.com/photos"], img[data-src*="shbdn.com/photos"]').forEach((img) => {
      const src = img.getAttribute('src') || img.src;
      const dataSrc = img.getAttribute('data-src');
      if (isPhotoUrl(src)) raw.push(src);
      if (isPhotoUrl(dataSrc)) raw.push(dataSrc);
    });
    return [...new Set(raw.filter((u) => u.includes('/photos/')))];
  }

  function dedupeByPhotoKey(urls) {
    const byKey = new Map();
    for (const url of urls) {
      const key = photoKey(url);
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing || /\/x5_/i.test(url)) {
        byKey.set(key, url);
      }
    }
    return [...byKey.values()];
  }

  function buildGorsellerSets(urls) {
    const baseUrls = dedupeByPhotoKey(urls);
    const thumbnail = [];
    const medium = [];
    const large = [];
    for (const url of baseUrls) {
      const med = /\/x5_/i.test(url) ? url : toMedium(url);
      thumbnail.push(toThumb(med));
      medium.push(med);
      large.push(toBig(med));
    }
    return {
      thumbnail,
      medium,
      large,
      count: thumbnail.length,
    };
  }

  function normalizeThumbnail(url) {
    if (!isPhotoUrl(url)) return url;
    return toThumb(url);
  }

  function extractPhotoCount(doc) {
    const root = doc || document;
    const el = root.querySelector('[class*="photoCount"], .classified-photos-count');
    if (!el) return null;
    const m = (el.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    return m ? parseInt(m[2], 10) : null;
  }

  self.SahibindenPhotoUrls = {
    isPhotoUrl,
    toBig,
    toThumb,
    toMedium,
    collectFromDocument,
    buildGorsellerSets,
    normalizeThumbnail,
    extractPhotoCount,
  };
})();
