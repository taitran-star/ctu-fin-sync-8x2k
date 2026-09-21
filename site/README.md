# Cattasaurus Dashboard — website riêng có mật khẩu

Thư mục này là website dashboard nội bộ (`https://cattasaurus-dashboard.pages.dev`), chạy trên
**Cloudflare Pages** (miễn phí). Trang chủ `/` là danh sách bảng; bảng P&L ở `/pnl/`, đọc thẳng các file JSON
mà GitHub Actions cập nhật mỗi 30 phút trong repo `taitran-star/ctu-fin-sync-8x2k`. Bảng mới = thêm một
file `public/<tên>.html` và một thẻ trong `public/index.html`.

```
site/
  public/                 -> TẤT CẢ file tĩnh nằm phẳng trong một thư mục (up 1 lần)
    index.html            -> trang chủ: danh sách bảng; tự chuyển tới bảng mở lần trước (/?menu=1 để xem danh sách)
    pnl.html              -> bảng P&L (địa chỉ /pnl) + bộ tải số liệu (fetch /data/*.json rồi mới chạy pnl.js)
    pnl.js                -> toàn bộ logic P&L (sinh từ template bằng build_site.py, không sửa tay)
    shipmonk_invoices.json, klaviyo_invoices.json -> hoá đơn (đọc từ trang billing, cập nhật tay hằng tháng)
    apple-touch-icon.png, icon-192.png, icon-512.png, favicon.png, manifest.webmanifest -> icon app / tab
    img/                  -> logo (1 màu, nền trong: logo-h-pine / logo-h-pistachio / logo-v-pine) + mascot (mascot-*.png)
    fonts/                -> font thương hiệu dạng woff2: Bureau Grot Cond Medium (số liệu lớn), Libre Franklin Regular/SemiBold
                             (chữ, tiêu đề), Fuzzy Bubbles Bold (chữ "highlight")
  functions/
    [[path]].js           -> toàn bộ phần server trong 1 file: cổng mật khẩu (cookie 90 ngày, ký HMAC bằng
                             chính mật khẩu) + /data/<file>.json (lấy từ raw.githubusercontent.com, cache 5 phút,
                             ETag/304, hoặc file hoá đơn trong public/) + trả file tĩnh
```

Không cần mật khẩu (để trang đăng nhập hiện được logo/mascot): `/img/*`, `/fonts/LibreFranklin-*`, `/fonts/FuzzyBubbles-*`,
các icon và `favicon.png`. Font **Bureau Grot** là font thương mại (Monotype) nên chỉ trả sau khi đăng nhập; nếu giấy phép
font của công ty không cho dùng trên web thì xoá `fonts/BureauGrot-CondMedium.woff2` — số liệu sẽ hiện bằng font hệ thống.
Bureau Grot không có dấu tiếng Việt, vì vậy nó chỉ dùng cho **số liệu lớn** (KPI, break-even, ROAS, MER, dòng lợi nhuận ròng);
tiêu đề tiếng Việt dùng Libre Franklin SemiBold (font "sub-headline" theo brand book).

## Cài đặt lần đầu (Cloudflare)

1. cloudflare.com → tạo tài khoản miễn phí → **Workers & Pages** → **Create** → tab **Pages** → **Connect to Git**.
2. Chọn GitHub → cho phép truy cập repo `ctu-fin-sync-8x2k` → **Begin setup**.
3. Project name `cattasaurus-dashboard` · Framework preset **None** · Build command *(để trống)* · Build output directory `public` ·
   **Root directory** (mục nâng cao) `site` → **Save and Deploy**.
4. Sau khi deploy xong: **Settings → Variables and Secrets → Add**: tên `DASH_PASSWORD`, loại **Secret**,
   giá trị = mật khẩu muốn dùng → Save → **Deployments → … → Retry deployment**.
5. **Settings → Build → Build watch paths → Include paths**: `site/*`
   (repo được GitHub Actions push ~16 lần/giờ; không đặt mục này thì Pages build mỗi lần push và hết hạn
   mức 500 build/tháng của gói miễn phí sau ~1 ngày).
6. Mở `https://cattasaurus-dashboard.pages.dev` → nhập mật khẩu. Trên iPhone: Safari → Chia sẻ → *Thêm vào MH chính*.

Tên miền riêng (tuỳ chọn): **Custom domains → Set up a custom domain** → ví dụ `pnl.cattasaurus.com` →
thêm bản ghi CNAME theo hướng dẫn tại nơi quản lý DNS của tên miền.

## Vận hành

* **Đổi mật khẩu**: sửa `DASH_PASSWORD` → Retry deployment. Mọi thiết bị phải đăng nhập lại.
* **Đăng xuất một thiết bị**: mở `/logout`.
* **Sửa bảng P&L**: sửa template `cattasaurus-pnl.html` → chạy `python3 build_site.py` → upload lại
  `pnl.html` và `pnl.js` vào `site/public` trên repo (2 file, ghi đè).
* **Đổi logo / mascot / font**: thay file trong `site-build/assets` (tạo bằng `make_brand_assets.py` từ bộ brand kit) →
  `python3 build_site.py` → upload lại thư mục `site`.
* **Thêm bảng mới**: thêm `public/<tên>.html` (+ `<tên>.js`), thêm thẻ `<a class="card" href="/<tên>">` trong
  `public/index.html`; mật khẩu và `/data/*.json` dùng chung, không phải cài gì thêm.
* **Hoá đơn ShipMonk / Klaviyo mới**: thay 2 file JSON hoá đơn trong `site/public/` → upload lên repo.
* **Repo chuyển sang private**: thêm Secret `GH_TOKEN` (fine-grained token, chỉ quyền Contents: Read của
  repo) — `functions/[[path]].js` tự dùng nó, không cần sửa code.
* Số liệu trên trang là số lúc tải; nút **↻ Cập nhật** (góc dưới phải) hoặc tải lại trang để lấy số mới.
  Mở lại tab/app sau 15 phút thì trang tự tải lại.

## Bảo mật — nói thẳng

* Mật khẩu chỉ bảo vệ **trang dashboard**. Các file JSON số liệu nằm trong repo GitHub **public**
  (`raw.githubusercontent.com/taitran-star/ctu-fin-sync-8x2k/...`) — ai biết đúng đường dẫn vẫn đọc được.
  Tên repo khó đoán là lớp che duy nhất của dữ liệu thô.
* Muốn số liệu thô cũng riêng tư: chuyển phần `data/` sang một repo private (repo public giữ code để
  GitHub Actions vẫn miễn phí), rồi thêm `GH_TOKEN` như trên. Việc này cần sửa bước commit của 8 workflow.
* Sai mật khẩu bị chờ 1,5 giây mỗi lần; nên đặt mật khẩu dài (một câu có dấu cách là tốt nhất).
