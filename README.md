# FixParts Mağaza Botu

Sahibinden mağazasındaki ilanları **3 aşamalı pipeline** ile işler ve veriyi sunucuya kaydeder.

## Akış

| Aşama | Ne yapar | DB tablosu |
|-------|----------|------------|
| 1 · Liste | Mağaza sayfalarını tarar | `as_sahibinden_links` + `as_sahibinden_listing_general` |
| 2 · Detay | Detayı olmayan ilanları açar | `as_sahibinden_listing_detail` |
| 3 · Görüntüleme | Detayı tamamlanan ilanları ziyaret eder | `view_count` (her 10 görüntülemede 1 favori) |

Zaten taranmış ilanlarda yalnızca görüntüleme yapılır; link ve genel bilgi tekrar çekilmez.

## Kurulum

1. Chrome → `chrome://extensions` → Geliştirici modu.
2. **Paketlenmemiş öğe yükle** → `bots/goruntuleme` klasörü.
3. Sahibinden’e giriş yapmış profilde kullanın.
4. Backend’de migration `011_sahibinden_listings.sql` çalışmış olmalı.

## Popup

- **API sunucusu** ve **Makine ID** zorunlu (örn. `sahibinden-GPU-1`).
- **Başlat** → liste → detay → görüntüleme döngüsü.
- Üst satır: veritabanındaki toplam link / genel / detay / görüntüleme sayıları.
- Alt satır: bu oturumdaki işlem sayıları.

## Görsel URL'leri

Resimler **yerele indirilmez**; CDN (`i0.shbdn.com`) URL'leri doğrudan saklanır.

Detay kaydında `gorseller` alanı:

```json
{
  "thumbnail": [".../thmb_...jpg"],
  "medium":    [".../x5_...jpg"],
  "large":     [".../big_...jpg"],
  "count": 3
}
```

Prefix dönüşümü: `thmb` (~3 KB), `x5` (~33 KB), `big` (~74 KB).


`http://<api>:3009/fleet?bot=sahibinden` — canlı makine durumu ve uzaktan başlat/durdur.

## API uçları

- `GET /sahibinden/listings/stats`
- `POST /sahibinden/listings/sync-batch`
- `GET /sahibinden/listings/need-detail`
- `POST /sahibinden/listings/:ilanId/detail`
- `GET /sahibinden/listings/claim-view`
