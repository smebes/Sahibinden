# FixParts Görüntüleme Botu

Sahibinden’de **sizin belirlediğiniz** ilan linklerine giderek görüntüleme yapan Chrome eklentisi.

## Nasıl çalışır?

1. Popup’taki **İlan listesi** alanına linkleri yapıştırın (her satır bir ilan).
2. **Bu çalıştırmada en fazla kaç ilan** ile sınır koyun (varsayılan: **100**).
3. **Başlat** — sadece listedeki (ve limite uyan) ilanlar açılır.

Örnek: 150 link yapıştırıp limiti 100 yaparsanız, yalnızca **ilk 100** ilan ziyaret edilir.

## İsteğe bağlı: Mağazadan listeye ekle

Tüm mağazayı otomatik görüntülemez; yalnızca **listeyi doldurmanıza** yardım eder:

1. “Mağazadan listeye ekle” bölümünü açın.
2. **En fazla kaç ilan** alanını ayarlayın (ör. **80**).
3. **Mağazadan listeye ekle** — limit dolana kadar **sayfa sayfa** ilerler (sayfa başı ~20 ilan ise 80 için ~4 sayfa).
4. “Limit yok — tüm sayfaları tara” yalnızca mağazadaki **tüm** ilanları istediğinizde işaretleyin.
5. **Başlat** — listedeki ilanlardan (limit kadar) görüntüleme yapılır.

## Kurulum

1. Chrome → `chrome://extensions` → Geliştirici modu.
2. **Paketlenmemiş öğe yükle** → `GoruntulemeBot` klasörü.
3. Sahibinden’e giriş yapmış profilde kullanın.

## Ayarlar

| Ayar | Açıklama |
|------|----------|
| İlan listesi | Manuel linkler (satır satır) |
| En fazla kaç ilan | Bir çalıştırmada işlenecek üst sınır (1–500) |
| Bekleme / kalma süresi | İlanlar arası ve sayfada kalma süresi |

## Link formatı

```
https://www.sahibinden.com/ilan/arac-...-1234567890/detay
```

`/detay` olmasa da eklenti düzeltir. Virgül veya noktalı virgülle ayrılmış tek satır da kabul edilir.
