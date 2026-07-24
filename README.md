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
4. Backend migration'ları: `011` + `012` + `021` (sahibinden_active)

## Ölü ilan tespiti (v1.5.3+)

Detay/görüntüleme sayfasında sıra kritik:
1. **Captcha/403 engeli** → geçici → `release-detail` / retry — **asla** mark-removed yok
2. **"Yayından kaldırılmış" / 404** → kalıcı → `mark-removed` / `view-failed` (`sahibinden_active=false`)
3. Normal parse / görüntüleme

Backend: `need-detail` ve `claim-view` zaten `WHERE sahibinden_active` filtreler.

## Çoklu makine

Tüm Chrome profilleri **aynı API**'yi kullanmalı. Her birine **benzersiz Makine ID** verin (örn. `sahibinden-GPU-1` … `GPU-10`).

Sunucu merkezi kuyruk yönetir — yeni Chrome açsanız sıfırdan başlamaz:

| İş | Koordinasyon |
|----|--------------|
| Liste sayfası | `claim-list-page` — her makine farklı offset |
| Detay | `need-detail` + satır kilidi — aynı ilan iki kez verilmez |
| Görüntüleme | `claim-view` — dağıtık kuyruk |

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


## Otomatik mola (v1.4.1)

Varsayılan: **10–15 dk çalış** → **20–40 dk mola** (her dilim rastgele). Saatte yaklaşık bir aktif pencere.

Popup → Gelişmiş ayarlar → «Otomatik mola» ile kapatılabilir. Manuel Duraklat hâlâ geçerli.

## Fleet dashboard

## API uçları

- `GET /sahibinden/listings/stats`
- `GET /sahibinden/listings/claim-list-page`
- `POST /sahibinden/listings/complete-list-page`
- `POST /sahibinden/listings/sync-batch`
- `GET /sahibinden/listings/need-detail`
- `POST /sahibinden/listings/:ilanId/detail`
- `POST /sahibinden/listings/:ilanId/release-detail`
- `GET /sahibinden/listings/claim-view`
