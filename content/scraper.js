/**
 * Referans: asıl tarama mantığı background/service-worker.js içindeki
 * scrapePageInTab fonksiyonunda (executeScript func) çalışır.
 */

(function () {
  const ILAN_PATH = /\/ilan\/[^/?#]+/i;

  function normalizeListingUrl(href) {
    if (!href) return null;
    try {
      const url = new URL(href, window.location.origin);
      if (!url.hostname.includes("sahibinden.com")) return null;
      const match = url.pathname.match(/\/ilan\/([^/]+)/i);
      if (!match) return null;
      const slug = match[1];
      if (slug.length < 8) return null;
      if (/^(vasita|emlak|yedek-parca|ikinci-el|hizmet|ozel-ders)/i.test(slug) && !/-\d{6,}/.test(slug)) {
        return null;
      }
      url.hash = "";
      url.search = "";
      if (!url.pathname.endsWith("/detay")) {
        url.pathname = `/ilan/${slug}/detay`;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  function extractListingUrls() {
    const seen = new Set();
    const urls = [];
    document.querySelectorAll('a[href*="/ilan/"]').forEach((a) => {
      const normalized = normalizeListingUrl(a.getAttribute("href"));
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    });
    return urls;
  }

  function extractNextPageUrl() {
    const selectors = [
      'a[rel="next"]',
      '.prevNextBlock a.next',
      'a.nextPage',
      'a[title="Sonraki"]',
      'a[aria-label="Sonraki"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.href && !el.classList.contains("disabled")) {
        return el.href;
      }
    }
    const links = [...document.querySelectorAll("a")];
    const nextLink = links.find((a) => {
      const t = (a.textContent || "").trim().toLowerCase();
      return (t === "sonraki" || t === "ileri" || t === "›" || t === ">") && a.href;
    });
    return nextLink?.href || null;
  }

  return {
    pageUrl: window.location.href,
    listings: extractListingUrls(),
    nextPageUrl: extractNextPageUrl(),
  };
})();
