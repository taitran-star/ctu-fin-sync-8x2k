// Cattasaurus P&L dashboard — built from the template by build_site.py (build 709edbb973).
// Data arrives in window.__LIVE (see the loader in index.html); do not edit by hand, rebuild instead.

  // Brand icon set: 24px grid, 2px round strokes with a 16% tint fill (the mascot's line style); colour = currentColor.
  const BRAND_ICONS = {
    check: '<circle class="f" cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/>',
    clock: '<circle class="f" cx="12" cy="12" r="9.5"/><path d="M12 7v5l3.5 2"/>',
    plug:  '<path d="M9 3v4M15 3v4"/><path class="f" d="M6 7h12v3.5a6 6 0 0 1-12 0z"/><path d="M12 16.5V21"/>',
    warn:  '<path class="f" d="M10.7 4.3a1.5 1.5 0 0 1 2.6 0l7.8 13.9a1.5 1.5 0 0 1-1.3 2.3H4.2a1.5 1.5 0 0 1-1.3-2.3z"/><path d="M12 9.5v4.5"/><circle class="dot" cx="12" cy="17" r="1.1"/>',
    info:  '<circle class="f" cx="12" cy="12" r="9.5"/><path d="M12 11v5.5"/><circle class="dot" cx="12" cy="8" r="1.1"/>',
    filter:'<path class="f" d="M4 5h16l-6.5 7.5V19l-3 1.5v-8z"/>',
  };
  function bicon(name, cls){
    return `<svg class="bi${cls?' '+cls:''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BRAND_ICONS[name]||''}</g></svg>`;
  }
  document.querySelectorAll('i[data-icon]').forEach(el=>{ el.outerHTML = bicon(el.dataset.icon); });
(function(){
  "use strict";
  function sum(arr){ return arr.reduce((a,b)=>a+b,0); }
  // ---------- V10: language (English default, Vietnamese on toggle) ----------
  let LANG = 'en';
  try{ const l0 = localStorage.getItem('ctu_lang'); if(l0==='vi' || l0==='en') LANG = l0; }catch(e){}
  document.documentElement.lang = LANG;
  const L = {en:{}, vi:{}};   // filled below (L.en / L.vi); a missing key falls back to the other language, then to the key itself
  function tx(key, vars){
    let s = (L[LANG] && L[LANG][key]!==undefined) ? L[LANG][key] : (L.en[key]!==undefined ? L.en[key] : (L.vi[key]!==undefined ? L.vi[key] : key));
    if(vars) Object.keys(vars).forEach(v=>{ s = s.split('{'+v+'}').join(vars[v]); });
    return s;
  }
  const tv = (en, vi) => LANG==='vi' ? vi : en;   // inline pair for one-off strings
  const dayWord = n => n===1 ? 'day' : 'days';   // English plural for day counts (Vietnamese strings carry their own 'ngày')
  function setLang(l){ if(l!=='vi' && l!=='en') return; LANG = l; try{ localStorage.setItem('ctu_lang', l); }catch(e){} document.documentElement.lang = l; renderStatic(); renderAll(); if(window.__ctuReloadOnLang!==false) location.reload(); }   // reload so the loader / top-bar strings written before pnl.js follow too
  function renderStatic(){
    document.querySelectorAll('[data-i18n]').forEach(el=>{ el.innerHTML = tx(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title = tx(el.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.placeholder = tx(el.dataset.i18nPh); });
    document.querySelectorAll('[data-lang]').forEach(b=>{ b.classList.toggle('active', b.dataset.lang===LANG); b.setAttribute('aria-pressed', b.dataset.lang===LANG ? 'true' : 'false'); });
  }
  Object.assign(L.en, {
    'nav.exec':'Overview', 'nav.sales':'Sales &amp; customers', 'nav.marketing':'Marketing', 'nav.pnl':'P&amp;L', 'nav.inventory':'Products &amp; inventory', 'nav.opex':'Fixed costs &amp; cash', 'nav.data':'Data',
    'mode.day':'Day', 'mode.week':'Week', 'mode.month':'Month', 'mode.range':'Custom',
    'tb.loadedAt':'When the numbers were loaded (your clock)', 'tb.reload':'Reload the latest numbers', 'tb.install':'Install', 'tb.installTitle':'Install as an app', 'tb.theme':'Light / dark', 'tb.signout':'Sign out',
    'brief.summary':'In brief', 'brief.moved':'What moved profit', 'brief.risks':'Biggest risks', 'brief.decide':'Decide this week', 'brief.title':'Brief & actions', 'brief.todo':'What to do', 'brief.why':'Why profit moved',
    'rev.title':'Revenue performance', 'rev.daily':'Daily', 'rev.weekly':'Weekly', 'rev.monthly':'Monthly', 'rev.peak':'Peak', 'rev.note':'Net revenue and CM3 · best {day}: {best}', 'rev.caption':'Net revenue = gross − discounts − refunds, by order date (Los Angeles). CM3 = contribution after product cost, fulfillment, fees and all marketing. Hover for orders and ad spend.',
    'chan.title':'Sales channels', 'chan.note':'{total} across {n} channels', 'chan.avgDay':'Average day', 'chan.perOrder':'Revenue per order',
    'pl.title':'Product lines', 'pl.line':'Product line', 'pl.share':'Share', 'pl.vsPrior':'vs prior', 'pl.cover':'Days of cover', 'pl.dollar':'Where each $100 of net revenue goes',
    'pl.note':'{n} lines on {ch}{cov}', 'pl.caption':'Revenue, fees and ads are allocated to a line by its share of gross sales in each channel; fulfillment by units. Days of cover = FBA fulfillable + ShipMonk available ÷ units sold per day (last 30 days). Lines come from data/products.json.',
    'pl.realCost':'Product cost from FIFO receipt lots (data/cogs_lots.json) or data/cogs_skus.json for {n}/{of} SKUs; the rest is estimated.', 'pl.estCost':'Product cost is the estimate until data/cogs_skus.json is filled in.',
    'd.productCost':'Product cost', 'd.fulfillment':'Fulfillment', 'd.fees':'Marketplace & payment fees', 'd.marketing':'Marketing', 'd.opex':'Operating costs', 'd.keep':'EBITDA kept',
    'm.netRevenue':'Net revenue', 'm.orders':'Orders', 'm.adSpend':'Ad spend', 'm.units':'Units',
    'u.days':'days', 'u.d':'d', 'u.noData':'No data', 'u.waiting':'Waiting for data', 'u.total':'Total', 'u.daysWithSku':'days with SKU data',
    'risk.stockout':'{n} SKUs run out within 30 days', 'risk.stockoutNote':'{list} — revenue at risk over the next 30 days', 'risk.stockoutAction':'Place or expedite POs for: {list}',
    'lots.title':'Receipt lots — FIFO landed cost',
    'page.exec':'Overview', 'page.sales':'Sales & customers', 'page.marketing':'Marketing', 'page.pnl':'Profit & loss', 'page.inventory':'Products & inventory', 'page.opex':'Fixed costs & cash', 'page.data':'Data sources',
    'ctx.vs':'vs {cmp}', 'ctx.today':'includes today (not final)',
  });
  Object.assign(L.vi, {
    'nav.exec':'Điều hành', 'nav.sales':'Bán hàng &amp; khách', 'nav.marketing':'Marketing', 'nav.pnl':'Lãi lỗ (P&amp;L)', 'nav.inventory':'Sản phẩm &amp; tồn kho', 'nav.opex':'Chi phí cố định &amp; tiền', 'nav.data':'Dữ liệu',
    'mode.day':'Ngày', 'mode.week':'Tuần', 'mode.month':'Tháng', 'mode.range':'Tuỳ chọn',
    'tb.loadedAt':'Giờ tải số liệu (giờ trên máy bạn)', 'tb.reload':'Tải lại số liệu mới nhất', 'tb.install':'Cài app', 'tb.installTitle':'Cài như app lên máy / điện thoại', 'tb.theme':'Sáng / tối', 'tb.signout':'Đăng xuất',
    'brief.summary':'Tóm tắt kỳ này', 'brief.moved':'Điều gì làm lợi nhuận đổi', 'brief.risks':'Rủi ro lớn nhất', 'brief.decide':'Cần quyết tuần này', 'brief.title':'Tóm tắt & việc cần làm', 'brief.todo':'Việc cần làm', 'brief.why':'Vì sao lợi nhuận đổi',
    'rev.title':'Doanh thu theo thời gian', 'rev.daily':'Ngày', 'rev.weekly':'Tuần', 'rev.monthly':'Tháng', 'rev.peak':'Đỉnh', 'rev.note':'Doanh thu thuần và CM3 · cao nhất {day}: {best}', 'rev.caption':'Doanh thu thuần = gộp − giảm giá − hoàn tiền, theo ngày đặt (giờ Los Angeles). CM3 = lợi nhuận đóng góp sau giá vốn, fulfillment, phí và toàn bộ marketing. Rê chuột để xem số đơn và chi quảng cáo.',
    'chan.title':'Kênh bán', 'chan.note':'{total} trên {n} kênh', 'chan.avgDay':'Trung bình mỗi ngày', 'chan.perOrder':'Doanh thu mỗi đơn',
    'pl.title':'Dòng sản phẩm', 'pl.line':'Dòng sản phẩm', 'pl.share':'Tỷ trọng', 'pl.vsPrior':'so kỳ trước', 'pl.cover':'Ngày còn hàng', 'pl.dollar':'Mỗi $100 doanh thu thuần đi đâu',
    'pl.note':'{n} dòng trên {ch}{cov}', 'pl.caption':'Doanh thu, phí và quảng cáo phân bổ cho dòng theo tỷ trọng doanh thu gộp của từng kênh; fulfillment theo units. Ngày còn hàng = FBA bán được + ShipMonk sẵn bán ÷ units bán mỗi ngày (30 ngày gần nhất). Dòng sản phẩm lấy từ data/products.json.',
    'pl.realCost':'Giá vốn theo lô nhập FIFO (data/cogs_lots.json) hoặc data/cogs_skus.json cho {n}/{of} SKU; còn lại ước tính.', 'pl.estCost':'Giá vốn đang ước tính cho đến khi điền data/cogs_skus.json.',
    'd.productCost':'Giá vốn sản phẩm', 'd.fulfillment':'Fulfillment', 'd.fees':'Phí sàn & thanh toán', 'd.marketing':'Marketing', 'd.opex':'Chi phí hoạt động', 'd.keep':'EBITDA giữ lại',
    'm.netRevenue':'Doanh thu thuần', 'm.orders':'Đơn hàng', 'm.adSpend':'Chi quảng cáo', 'm.units':'Units',
    'u.days':'ngày', 'u.d':'ng', 'u.noData':'Chưa có dữ liệu', 'u.waiting':'Chờ dữ liệu', 'u.total':'Tổng', 'u.daysWithSku':'ngày có dữ liệu SKU',
    'risk.stockout':'{n} SKU hết hàng trong 30 ngày', 'risk.stockoutNote':'{list} — doanh thu có nguy cơ mất trong 30 ngày tới', 'risk.stockoutAction':'Đặt hoặc đẩy nhanh PO cho: {list}',
    'lots.title':'Lô nhập — giá vốn FIFO',
    'page.exec':'Điều hành', 'page.sales':'Bán hàng & khách', 'page.marketing':'Marketing', 'page.pnl':'Lãi lỗ', 'page.inventory':'Sản phẩm & tồn kho', 'page.opex':'Chi phí cố định & tiền', 'page.data':'Nguồn dữ liệu',
    'ctx.vs':'so {cmp}', 'ctx.today':'gồm hôm nay (chưa chốt)',
  });
  Object.assign(L.en, {
    'smk.title':'ShipMonk warehouses — stock by SKU', 'smk.waiting':'ShipMonk sync 1.4 writes a stock snapshot per SKU and warehouse (NV3, PA2, TO1). Upload fetch_shipmonk.py and wait for the next run; a 401/403 on the inventory step means the API key needs product read access.',
    'smk.note':'Snapshot {as_of} · warehouses {wh} · {n} SKUs · velocity = Shopify units per day, last 30 days', 'smk.available':'Available', 'smk.onHand':'on hand', 'smk.allocated':'allocated', 'smk.incoming':'Incoming', 'smk.receivings':'in receivings', 'smk.backordered':'Backordered SKUs', 'smk.unitsShort':'units short', 'smk.noBackorder':'All open orders covered', 'smk.tagBack':'backordered', 'smk.byWarehouse':'By warehouse',
    'smk.caption':'Available = units ShipMonk can allocate to new orders (capped at on hand − quarantined − unavailable). Allocated = reserved for open orders. Incoming = open receivings (expected − received). Stock-out dates use the Shopify sales velocity of the last 30 days; POs with destination "shipmonk" in data/purchase_orders.json are added on their ETA.',
    'inv.soon':'Run out within 30 days', 'inv.earliest':'earliest', 'inv.outStock':'Stock-out (stock)', 'inv.outAll':'Stock-out (stock + incoming + PO)', 'inv.tagNoSales':'no sales', 'inv.tagOut':'out of stock', 'inv.tagSoon':'runs out — order now', 'inv.tagWaiting':'waiting on inbound', 'inv.tagOk':'ok', 'inv.showing':'Showing 60 of {n} SKUs.',
    'u.product':'Product', 'u.day':'day', 'u.status':'Status',
  });
  Object.assign(L.vi, {
    'smk.title':'Kho ShipMonk — tồn theo SKU', 'smk.waiting':'Script ShipMonk 1.4 ghi snapshot tồn kho theo SKU và kho (NV3, PA2, TO1). Up fetch_shipmonk.py rồi chờ lần chạy kế tiếp; nếu bước inventory báo 401/403 thì API key cần quyền đọc Products.',
    'smk.note':'Snapshot {as_of} · kho {wh} · {n} SKU · tốc độ bán = units Shopify mỗi ngày, 30 ngày gần nhất', 'smk.available':'Sẵn bán', 'smk.onHand':'trong kho', 'smk.allocated':'đã giữ', 'smk.incoming':'Đang về', 'smk.receivings':'theo phiếu nhận', 'smk.backordered':'SKU thiếu hàng cho đơn', 'smk.unitsShort':'units thiếu', 'smk.noBackorder':'Mọi đơn mở đều đủ hàng', 'smk.tagBack':'thiếu hàng cho đơn', 'smk.byWarehouse':'Theo kho',
    'smk.caption':'Sẵn bán = units ShipMonk có thể gán cho đơn mới (không vượt trong kho − cách ly − không dùng được). Đã giữ = dành cho đơn đang mở. Đang về = phiếu nhận còn mở (dự kiến − đã nhận). Ngày hết hàng tính theo tốc độ bán Shopify 30 ngày gần nhất; PO đích "shipmonk" trong data/purchase_orders.json cộng vào đúng ngày về.',
    'inv.soon':'Hết hàng trong 30 ngày', 'inv.earliest':'sớm nhất', 'inv.outStock':'Hết hàng (tồn)', 'inv.outAll':'Hết hàng (tồn + về + PO)', 'inv.tagNoSales':'không bán', 'inv.tagOut':'hết hàng', 'inv.tagSoon':'sắp hết — đặt ngay', 'inv.tagWaiting':'chờ hàng về', 'inv.tagOk':'ổn', 'inv.showing':'Hiện 60/{n} SKU.',
    'u.product':'Sản phẩm', 'u.day':'ngày', 'u.status':'Trạng thái',
  });
  window.__ctu = {setLang: l=>setLang(l)};
  const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DOW_EN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  // ---------- V10 dictionary (keys used by tx()) ----------
  Object.assign(L.en, {
    'f.market':'Market', 'f.product':'Product', 'f.channel':'Channel', 'f.allMarkets':'All markets', 'f.allProducts':'All products', 'f.otherProducts':'Other / unmapped', 'f.allChannels':'All channels', 'f.channelsN':'channels',
    'f.bn.channel':'Channel: {ch}', 'f.bn.market':'Market: {m}', 'f.bn.product':'Product: {p}',
    'f.bn.alloc':'Every page shows only this selection. Shared costs (G&A, ShipMonk warehousing, D&A / interest / tax) are allocated by net-revenue share — {pct}% in this period — and marked “allocated”; company plans are not compared while filtering.',
    'f.bn.unknown':'{n} of {of} days in this period have no market / product split yet (synced before the split existed) and are excluded.',
    'f.bn.productNote':'Walmart and TikTok Shop carry per-SKU data only from the day their syncs started recording it (October 2026); earlier days of those channels are excluded from product filters. Ads and fees are allocated to the product by its share of gross sales.',
    'f.bn.clear':'Clear filters',
  });
  Object.assign(L.vi, {
    'f.market':'Thị trường', 'f.product':'Sản phẩm', 'f.channel':'Kênh', 'f.allMarkets':'Mọi thị trường', 'f.allProducts':'Mọi sản phẩm', 'f.otherProducts':'Khác / chưa gán', 'f.allChannels':'Mọi kênh', 'f.channelsN':'kênh',
    'f.bn.channel':'Kênh: {ch}', 'f.bn.market':'Thị trường: {m}', 'f.bn.product':'Sản phẩm: {p}',
    'f.bn.alloc':'Mọi trang chỉ tính phần đang chọn. Chi phí chung (G&A, kho bãi ShipMonk, khấu hao / lãi vay / thuế) được phân bổ theo tỷ trọng doanh thu thuần — {pct}% trong kỳ này — và ghi “phân bổ”; kế hoạch tổng công ty không so sánh khi đang lọc.',
    'f.bn.unknown':'{n}/{of} ngày trong kỳ chưa có dữ liệu tách thị trường / sản phẩm (đồng bộ trước khi có) nên bị loại.',
    'f.bn.productNote':'Walmart và TikTok Shop chỉ có dữ liệu theo SKU từ khi sync bắt đầu ghi (10/2026); những ngày trước đó của hai kênh này bị loại khi lọc sản phẩm. Quảng cáo và phí được phân bổ cho sản phẩm theo tỷ trọng doanh thu gộp.',
    'f.bn.clear':'Bỏ lọc',
  });
  // ---------- V10 dictionary, part A: period picker, P&L statement tags and other strings reused across renderers ----------
  Object.assign(L.en, {
    'pr.today':'Today', 'pr.yesterday':'Yesterday', 'pr.d7':'Last 7 days', 'pr.d30':'Last 30 days', 'pr.d90':'Last 90 days', 'pr.d365':'Last 365 days', 'pr.wtd':'This week', 'pr.mtd':'This month', 'pr.qtd':'This quarter', 'pr.ytd':'This year', 'pr.lastm':'Last month', 'pr.m12':'Last 12 months', 'pr.lasty':'Last year', 'pr.custom':'Custom',
    'cmp.prev':'Previous period', 'cmp.year':'Same period last year', 'cmp.none':'No comparison', 'cmp.vs':'Compare to', 'cmp.pickRange':'Choose a date range', 'cmp.pickCmp':'Choose the comparison period', 'cmp.view':'View',
    'u.orders':'orders', 'u.pts':'pts', 'u.vsPrev':'vs previous period', 'u.notConnected':'Not connected', 'u.notEntered':'not entered', 'u.perDay':'/day',
    'tag.var':'Variable', 'tag.fix':'Fixed', 'tag.gap':'Not connected ($0)', 'tag.gapManual':'Not entered ($0)', 'tag.real':'Actual', 'tag.manual':'Manual entry', 'tag.est':'Includes estimate', 'tag.estDefault':'Part of it is an estimate for Amazon orders whose fees are not posted yet — replaced by the actual figure once Amazon posts it',
    'st.outsideSync':' ({n} {d} outside the sync window = $0)', 'st.byOrderDate':'by order date', 'st.byShipDate':'by ship date', 'st.noInvoiceDays':' ({n} {d} without an invoice yet)', 'st.perInvoice':' — per ShipMonk invoice', 'st.manualMonthly':' — manual monthly entry', 'st.notEntered':' — not entered', 'st.notConnected':' — not connected',
    'st.alloc':' — {pct}% allocated (net-revenue share of {sel})',
    'cc.txnFees':'Transaction selling fees', 'cc.fulfil':'Fulfillment & warehousing', 'cc.mktOn':'Marketplace marketing', 'cc.shipmonkPerOrder':'ShipMonk per order',
  });
  Object.assign(L.vi, {
    'pr.today':'Hôm nay', 'pr.yesterday':'Hôm qua', 'pr.d7':'7 ngày qua', 'pr.d30':'30 ngày qua', 'pr.d90':'90 ngày qua', 'pr.d365':'365 ngày qua', 'pr.wtd':'Tuần này', 'pr.mtd':'Tháng này', 'pr.qtd':'Quý này', 'pr.ytd':'Năm nay', 'pr.lastm':'Tháng trước', 'pr.m12':'12 tháng qua', 'pr.lasty':'Năm trước', 'pr.custom':'Tuỳ chọn',
    'cmp.prev':'Kỳ liền trước', 'cmp.year':'Cùng kỳ năm trước', 'cmp.none':'Không so sánh', 'cmp.vs':'So với', 'cmp.pickRange':'Chọn khoảng thời gian', 'cmp.pickCmp':'Chọn kỳ so sánh', 'cmp.view':'Xem',
    'u.orders':'đơn', 'u.pts':'đpt', 'u.vsPrev':'so kỳ trước', 'u.notConnected':'Chưa kết nối', 'u.notEntered':'chưa nhập', 'u.perDay':'/ngày',
    'tag.var':'Biến đổi', 'tag.fix':'Cố định', 'tag.gap':'Chưa kết nối ($0)', 'tag.gapManual':'Chưa nhập ($0)', 'tag.real':'Số thật', 'tag.manual':'Nhập tay', 'tag.est':'Có ước tính', 'tag.estDefault':'Một phần là ước tính cho đơn Amazon chưa ghi phí — tự thay bằng số thật khi Amazon ghi',
    'st.outsideSync':' ({n} ngày ngoài cửa sổ đồng bộ = $0)', 'st.byOrderDate':'theo ngày đặt hàng', 'st.byShipDate':'theo ngày ship', 'st.noInvoiceDays':' ({n} ngày chưa có hoá đơn)', 'st.perInvoice':' — theo hoá đơn ShipMonk', 'st.manualMonthly':' — nhập tay theo tháng', 'st.notEntered':' — chưa nhập', 'st.notConnected':' — chưa kết nối',
    'st.alloc':' — phân bổ {pct}% (tỷ trọng doanh thu thuần của {sel})',
    'cc.txnFees':'Phí bán hàng theo giao dịch', 'cc.fulfil':'Fulfillment & kho', 'cc.mktOn':'Marketing trên sàn', 'cc.shipmonkPerOrder':'ShipMonk theo đơn',
  });
  // ---------- V10 dictionary, part A: static text of pnl.html (data-i18n="h.*"); VI values = the original innerHTML byte for byte ----------
  Object.assign(L.en, {
    'h.matrixTitle':'Sales channels',
    'h.matrixNote':'Net revenue by order date, one row per channel · vs the same days of the previous period &amp; last year · plan compared per group (Shopify + TikTok Shop vs the Shopify net-sales plan, Amazon + Walmart vs the Amazon gross-sales plan)',
    'h.bridgeTitle':'Profit bridge — what moved CM3',
    'h.alertTitle':'Alerts',
    'h.alertNote':'Computed from the selected period · threshold shown next to each line',
    'h.defsSummary':'Definitions used on this page',
    'h.def1':'<b>Net revenue</b> = gross sales − discounts − refunds, excluding tax. By order date, Los Angeles time.',
    'h.def2':'<b>Product cost</b> = the accountant\'s monthly figure per channel in <code>data/cogs_monthly.json</code> where filled in; otherwise FIFO by receipt lot: every unit sold (units per SKU per day) takes the landed cost (EXW + freight/unit + duties/unit) of the oldest lot still on hand in its stock pool (Amazon = FBA/AWD, Shopify / TikTok / Walmart = ShipMonk + SAT), lots from <code>data/cogs_lots.json</code> (Notion Reorder Tracker); sales without units per SKU = net revenue × the estimate rate in <code>data/targets_monthly.json</code>. Currently: <span id="defCogs"></span>.',
    'h.def3':'<b>Gross profit</b> = net revenue − product cost − fulfillment (FBA, ShipMonk, postage, packaging).',
    'h.def4':'<b>CM2</b> = gross profit − marketplace fees − payment processing fees. <b>CM3 (contribution margin)</b> = CM2 − all marketing (ads, affiliates, creators).',
    'h.def5':'<b>EBITDA</b> = CM3 − operating costs (warehousing, manually entered G&amp;A, Klaviyo, Snowball).',
    'h.def6':'<b>MER</b> = net revenue ÷ total ad spend (Meta, Google, Amazon Ads, TikTok Ads, AppLovin, Walmart Connect), counting only days on which every source has reported. <b>Break-even MER</b> = 1 ÷ (CM2 ÷ net revenue).',
    'h.def7':'<b>nCAC (Shopify)</b> = D2C ads (Meta + Google + AppLovin) ÷ new Shopify customers per the order journey. Marketplaces do not report new customers, so it is not computed for Amazon/Walmart/TikTok.',
    'h.def8':'<b>vs previous period</b> = the same days of the previous month/week (1st–15th of the month vs 1st–15th of last month). <b>vs last year</b> = the same date range in 2025 (weeks/days go back 52 weeks so the weekday matches).',
    'h.trendCaption':'Net revenue, <b>variable costs</b> (product cost + fulfillment + transaction fees + ads + commissions… — rise and fall with revenue), <b>operating costs</b> (warehousing &amp; logistics + G&amp;A, dashed line — salaries, office… not entered yet, so this line is still low) and operating profit (EBITDA) per period, same definitions as the P&amp;L table. Click a name in the legend to hide/show a line (hide revenue to see the costs clearly). The selected period is shaded; an unfinished period is drawn with a hollow point. Hover for the figures and the cost-to-revenue ratios.',
    'h.funnelTitle':'Order funnel — placed → paid → delivered → cancelled / refunded',
    'h.returnsTitle':'Returns by SKU',
    'h.attrTitle':'Sales channels by last touch — Shopify orders',
    'h.attrNote':'Shopify customer journey stored per order (visits in the 30 days before the order) · channel = last visit excluding direct · net revenue by order date',
    'h.loopTitle':'Recurring subscriptions — Loop Subscriptions',
    'h.reconTitle':'Shopify — reconciliation with Shopify Analytics',
    'h.reconNote':'Same definitions as Shopify\'s "Sales over time" report · days in store time (LA)',
    'h.reconCaption':'The "Shopify" line in the P&amp;L table above is <b>Gross sales</b> (list price × quantity, before discounts) — exactly as Shopify defines it, so it is much larger than "Total sales" on the Analytics page because the store discounts deeply (B1G2F, affiliate codes…). The dashboard\'s net revenue = Net sales = Gross − Discounts − Returns. In Shopify: Analytics → Reports → "Sales over time" (has all of these columns).',
    'h.roasTitle':'ROAS by channel &amp; blended MER',
    'h.roasNote':'ROAS = revenue attributed to the channel ÷ that channel\'s spend (may overlap across touchpoints)',
    'h.merLabel':'<b>MER (Marketing Efficiency Ratio)</b> = total net revenue ÷ total ad spend (Meta, Google, Amazon Ads, TikTok Ads, AppLovin, Walmart Connect). Only days on which every ad source has reported are counted. Unlike ROAS it uses actual revenue (including organic/halo), so MER is usually lower than the sum of per-channel ROAS — use MER to judge overall marketing efficiency, ROAS to optimise each channel.',
    'h.adsCapAmazon':'* Amazon Ads is waiting for Amazon to approve Advertising API access → $0 spend and not counted in MER. ',
    'h.metaTitle':'Meta Ads by product &amp; campaign',
    'h.metaCaption':'Product / market / stage are parsed from the campaign name ("Peekaboo - Bidcap - Control - Low Bid - CA"). Frequency ≈ impressions ÷ total daily reach (slightly lower than Ads Manager over several days). CPA = spend ÷ attributed orders; ROAS = attributed revenue ÷ spend. Alert thresholds: ROAS &lt; 1.5 or CPA &gt; $90.',
    'h.googleTitle':'Google Ads by product &amp; campaign',
    'h.googleCaption':'Campaign type (Search / Shopping / Performance Max / Demand Gen) comes from Google; the product is parsed from the campaign name or the alias table in the workflow ("PKC" = Peekaboo). "Conv." are conversions per the Google Ads account settings (by default including purchases counted in the conversions column), attributed revenue = conversions_value. Same alert thresholds as Meta: ROAS &lt; 1.5 or CPA &gt; $90.',
    'h.snowballTitle':'Snowball — influencer/affiliate commissions',
    'h.snowballNote':'Computed from Shopify orders Snowball tags "Referral - SS - &lt;program&gt;" · 45-day sync window · commission = order value × program %, reversed on refund',
    'h.ueTitle':'Unit economics — what one order earns',
    'h.sensTitle':'Sensitivity — how much CM3 changes if…',
    'h.stmtTitle':'Profit &amp; loss (P&amp;L statement)',
    'h.stmtNote':'% of each column\'s net revenue · click a section row to collapse/expand · the 6 previous periods are added to compare the trend on most lines (a few detail lines whose structure changes by period — fee-type mix, warehouse breakdown by billing period, reconciliation lines — show for the selected period only)',
    'h.stmtCaption':'Lines tagged <span class="tag gap" style="margin-left:0;"><span class="d"></span>Not connected ($0)</span> have no data source yet, so they stay at $0 (no estimate). Therefore <b>gross profit / contribution / EBITDA above are profit BEFORE</b> the items still carrying that tag (product cost, Walmart/TikTok marketplace fees, Afterpay fees, G&amp;A…) — they correct themselves as each source is connected. Lines tagged <span class="tag gap" style="margin-left:0;"><span class="d"></span>Not entered ($0)</span> are costs without an API (salaries, office, depreciation, interest, income tax): enter them per month in <code>data/opex_monthly.json</code> on GitHub; the table reads the file and spreads them evenly per day; a month not closed yet is estimated (tagged <span class="tag info" style="margin-left:0;"><span class="d"></span>Includes estimate</span>): Vietnam costs = average of the last 6 closed months, software (Slash) &amp; Upwork = actual to date.',
    'h.takeTitle':'Cost to sell through each channel (take rate)',
    'h.takeNote':'Of each $1 of the channel\'s net revenue, how much the channel and its services take — before product cost and G&amp;A',
    'h.takeCaption':'Same figures as the P&amp;L table, regrouped by channel. <b>Marketplace commissions / payment processing</b> are a fixed % of every order (like a retailer\'s margin) — the standard D2C management P&amp;L puts them under <i>transaction selling fees</i> (before CM2); <b>ads &amp; affiliates</b> are discretionary demand-generation costs, under <i>marketing</i> (before CM3) — kept apart so ACOS/TACOS stay readable. The two together plus fulfillment and storage = the channel\'s <b>take rate</b> ("how many % Amazon takes"). Klaviyo and the Social Snowball plan sit under G&amp;A on the P&amp;L; here they count for the D2C channel because they only serve that channel.<span id="channelCostNote"></span>',
    'h.beTitle':'Break-even point',
    'h.beNote':'Based on the variable-cost ratio &amp; operating costs (warehousing, G&amp;A) of the selected period',
    'h.taxTitle':'Sales tax collected',
    'h.taxNote':'Pass-through liability — not part of the P&amp;L above · actual figures from Shopify; not split by state yet (tax filing source needed)',
    'h.taxCh':'Channel',
    'h.taxCollected':'Collected',
    'h.taxRemitted':'Remitted',
    'h.taxOwed':'Owed',
    'h.taxStatus':'Status',
    'h.amzGapTitle':'Amazon — costs not fully captured yet',
    'h.amzGapNote':'From the latest SP-API sync log · does not change the figures shown above except where stated',
    'h.invTitle':'Amazon FBA inventory by SKU',
    'h.prodTitle':'Profit by product — CM3 per SKU',
    'h.poTitle':'Purchase orders (PO) — manual entry',
    'h.smTitle':'ShipMonk — fulfillment cost per order',
    'h.smNote':'ShipMonk\'s estimate per order (carrier postage + pick &amp; pack + packaging materials) · booked on the order date (LA time), including orders not shipped yet — same day as the revenue',
    'h.smCaption':'Figures from the ShipMonk API (<code>order_costs</code>: estimated shipping / pick &amp; pack / packaging) for every order ShipMonk receives — the Shopify store as well as Amazon FBM. Unshipped orders use ShipMonk\'s estimate and are refreshed every 30 minutes as they ship. ShipMonk\'s weekly invoice can differ slightly (postage adjustments, surcharges). <b>Not yet included:</b> storage, receiving, returns handling and items that only appear on the invoice — added once the invoice file exists.',
    'h.invGapsTitle':'Not on this page yet',
    'h.invGapsNote':'More sources needed',
    'h.opexTitle':'Operating costs (OpEx) for the selected period',
    'h.opexNote2':'Warehousing (ShipMonk, FBA storage &amp; services) + G&amp;A (manual entry, Klaviyo, Snowball) · below contribution margin',
    'h.opexManTitle':'Manually entered costs (monthly OpEx)',
    'h.opexManNote':'No API — enter per month in <code>data/opex_monthly.json</code> on GitHub; the month not closed yet is estimated (≈): Vietnam costs = average of the last 6 closed months, software (Slash) &amp; Upwork = actual to date',
    'h.cashTitle':'Cash &amp; runway',
    'h.cashNote':'No source yet',
    'h.liveBanner':'Connecting live data…',
    'h.syncBanner':'<b>Note on the latest day:</b> the selected range includes today (LA time), so that day is not final — Amazon posts fees/settlements 24–48h late, the other sources sync every few hours.',
    'h.healthTitle':'Data health by source',
    'h.healthNote':'Automation status of each source · dot colour = age of the latest sync (Green &lt; 4h · Yellow 4–48h · Red over 48h or not connected) · "N/14 days" = days with actual data in the last 14 days (today excluded, since today is not final)',
    'h.gapsTitle':'What\'s missing on the P&amp;L',
    'h.gapsNote':'Collected from the "Not connected/Not entered ($0)" lines scattered across the P&amp;L table and ROAS — to know what to connect next',
    'h.foot':'Every source is synced to the same day calendar: the America/Los_Angeles timezone (Shopify, Amazon and Amazon Ads already report in it; Meta &amp; Google are converted from hourly data) · Cattasaurus Finance',
    'h.adsCapRest':'TikTok Ads = TikTok Shop\'s GMV Max ("Attributed revenue" is the TikTok Shop revenue GMV Max claims for itself). Amazon Ads (when available): daily Sponsored Products / Brands / Display spend; "Attributed revenue" is the Amazon revenue attributed to ads (not added to revenue).',
  });
  Object.assign(L.vi, {
    'h.matrixTitle':'Kênh bán',
    'h.matrixNote':'Doanh thu thuần theo ngày đặt, mỗi kênh một dòng · so cùng số ngày kỳ trước &amp; năm trước · kế hoạch so theo nhóm (Shopify + TikTok Shop so kế hoạch Shopify thuần; Amazon + Walmart so kế hoạch Amazon gộp)',
    'h.bridgeTitle':'Cầu lợi nhuận — CM3 đổi vì đâu',
    'h.alertTitle':'Cảnh báo',
    'h.alertNote':'Tự tính từ kỳ đang xem · ngưỡng ghi cạnh mỗi dòng',
    'h.defsSummary':'Định nghĩa dùng trên trang này',
    'h.def1':'<b>Doanh thu thuần</b> = doanh thu gộp − giảm giá − hoàn tiền, không gồm thuế. Theo ngày đặt hàng, giờ Los Angeles.',
    'h.def2':'<b>Giá vốn sản phẩm</b> = số kế toán theo tháng/kênh trong <code>data/cogs_monthly.json</code> nếu đã điền; nếu không thì FIFO theo lô nhập: mỗi unit bán ra (units theo SKU mỗi ngày) lấy giá landed (EXW + cước/unit + thuế/unit) của lô cũ nhất còn trong kho của nó (Amazon = FBA/AWD, Shopify / TikTok / Walmart = ShipMonk + SAT), lô lấy từ <code>data/cogs_lots.json</code> (Notion Reorder Tracker); doanh số không có units theo SKU = doanh thu thuần × tỷ lệ ước tính trong <code>data/targets_monthly.json</code>. Hiện: <span id="defCogs"></span>.',
    'h.def3':'<b>Lợi nhuận gộp</b> = doanh thu thuần − giá vốn sản phẩm − fulfillment (FBA, ShipMonk, cước, bao bì).',
    'h.def4':'<b>CM2</b> = lợi nhuận gộp − hoa hồng sàn − phí cổng thanh toán. <b>CM3 (LN đóng góp)</b> = CM2 − toàn bộ marketing (quảng cáo, affiliate, creator).',
    'h.def5':'<b>EBITDA</b> = CM3 − chi phí hoạt động (kho bãi, G&amp;A nhập tay, Klaviyo, Snowball).',
    'h.def6':'<b>MER</b> = doanh thu thuần ÷ tổng chi quảng cáo (Meta, Google, Amazon Ads, TikTok Ads, AppLovin, Walmart Connect), chỉ tính ngày mọi nguồn đã có số. <b>MER hoà vốn</b> = 1 ÷ (CM2 ÷ doanh thu thuần).',
    'h.def7':'<b>nCAC (Shopify)</b> = quảng cáo D2C (Meta + Google + AppLovin) ÷ số khách mới Shopify theo hành trình đơn. Sàn không cho biết khách mới nên không tính cho Amazon/Walmart/TikTok.',
    'h.def8':'<b>So kỳ trước</b> = cùng số ngày của tháng/tuần liền trước (tháng 1–15 so với tháng trước 1–15). <b>So năm trước</b> = cùng khoảng ngày năm 2025 (tuần/ngày lùi 52 tuần để cùng thứ).',
    'h.trendCaption':'Doanh thu thuần, <b>chi phí biến đổi</b> (giá vốn + fulfillment + phí giao dịch + quảng cáo + hoa hồng… — tăng giảm theo doanh thu), <b>chi phí hoạt động</b> (kho bãi & logistics + G&amp;A, đường đứt nét — lương, văn phòng… chưa nhập nên đường này còn thấp) và lợi nhuận hoạt động (EBITDA) của từng kỳ, cùng định nghĩa với bảng P&amp;L. Bấm tên trong chú giải để ẩn/hiện một đường (ẩn doanh thu để nhìn rõ chi phí). Kỳ đang xem được tô nền; kỳ chưa kết thúc vẽ điểm rỗng. Rê chuột để xem số và tỷ lệ chi phí trên doanh thu.',
    'h.funnelTitle':'Funnel đơn hàng — đặt → thanh toán → giao → huỷ / hoàn',
    'h.returnsTitle':'Trả hàng theo SKU',
    'h.attrTitle':'Kênh bán theo điểm chạm cuối — đơn Shopify',
    'h.attrNote':'Hành trình khách Shopify lưu cho từng đơn (các lượt ghé trong 30 ngày trước đơn) · kênh = lượt ghé cuối không kể direct · doanh thu thuần theo ngày đặt',
    'h.loopTitle':'Đăng ký định kỳ — Loop Subscriptions',
    'h.reconTitle':'Shopify — đối chiếu với Shopify Analytics',
    'h.reconNote':'Cùng định nghĩa với báo cáo "Sales over time" của Shopify · ngày theo giờ cửa hàng (LA)',
    'h.reconCaption':'Dòng "Shopify" trong bảng P&amp;L ở trên là <b>Gross sales</b> (giá niêm yết × số lượng, trước giảm giá) — đúng như Shopify định nghĩa, nên lớn hơn nhiều so với "Total sales" trên trang Analytics vì cửa hàng giảm giá sâu (B1G2F, mã affiliate…). Doanh thu thuần của dashboard = Net sales = Gross − Discounts − Returns. Xem trong Shopify: Analytics → Reports → "Sales over time" (có đủ các cột này).',
    'h.roasTitle':'ROAS theo kênh &amp; MER toàn marketing',
    'h.roasNote':'ROAS = doanh thu quy về kênh ÷ chi phí kênh đó (có thể trùng lặp do đa chạm)',
    'h.merLabel':'<b>MER (Marketing Efficiency Ratio)</b> = Doanh thu thuần toàn bộ ÷ Tổng chi tiêu quảng cáo (Meta, Google, Amazon Ads, TikTok Ads, AppLovin, Walmart Connect). Chỉ tính những ngày mọi nguồn quảng cáo đã có số. Khác ROAS ở chỗ dùng doanh thu thật (kể cả organic/halo), nên MER thường thấp hơn tổng ROAS cộng dồn từng kênh — dùng MER để đánh giá hiệu quả marketing tổng thể, dùng ROAS để tối ưu từng kênh.',
    'h.adsCapAmazon':'* Amazon Ads chờ Amazon duyệt quyền Advertising API → chi $0 và không tính vào MER. ',
    'h.metaTitle':'Meta Ads theo sản phẩm &amp; chiến dịch',
    'h.metaCaption':'Sản phẩm / thị trường / giai đoạn tách từ tên campaign ("Peekaboo - Bidcap - Control - Low Bid - CA"). Frequency ≈ impressions ÷ tổng reach theo ngày (thấp hơn Ads Manager một chút khi xem nhiều ngày). CPA = chi ÷ đơn quy về; ROAS = doanh thu quy về ÷ chi. Ngưỡng cảnh báo: ROAS &lt; 1.5 hoặc CPA &gt; $90.',
    'h.googleTitle':'Google Ads theo sản phẩm &amp; chiến dịch',
    'h.googleCaption':'Loại campaign (Search / Shopping / Performance Max / Demand Gen) lấy từ Google; sản phẩm tách từ tên campaign hoặc bảng alias trong workflow ("PKC" = Peekaboo). "Conv." là conversions theo cài đặt tài khoản Google Ads (mặc định gồm mua hàng đã tính vào cột conversions), DT quy về = conversions_value. Cùng ngưỡng cảnh báo với Meta: ROAS &lt; 1.5 hoặc CPA &gt; $90.',
    'h.snowballTitle':'Snowball — hoa hồng influencer/affiliate',
    'h.snowballNote':'Tính từ đơn Shopify được Snowball gắn tag "Referral - SS - &lt;program&gt;" · cửa sổ đồng bộ 45 ngày · hoa hồng = giá trị đơn × % program, trừ lại khi hoàn tiền',
    'h.ueTitle':'Kinh tế đơn vị — một đơn kiếm được gì',
    'h.sensTitle':'Độ nhạy — CM3 đổi bao nhiêu nếu…',
    'h.stmtTitle':'Báo cáo lãi lỗ (P&amp;L statement)',
    'h.stmtNote':'% tính trên Doanh thu thuần của từng cột · bấm dòng nhóm để thu gọn/mở rộng · có thêm 6 kỳ liền trước để so xu hướng ở hầu hết các dòng (một vài dòng phụ có cấu trúc đổi theo kỳ — mix loại phí, breakdown kho theo kỳ hoá đơn, dòng đối chiếu — chỉ hiện cho kỳ đang xem)',
    'h.stmtCaption':'Dòng gắn nhãn <span class="tag gap" style="margin-left:0;"><span class="d"></span>Chưa kết nối ($0)</span> chưa có nguồn dữ liệu nên để $0 (không ước tính). Vì vậy <b>Lợi nhuận gộp / đóng góp / EBITDA ở trên là lợi nhuận TRƯỚC</b> các khoản còn gắn nhãn đó (giá vốn sản phẩm, phí sàn Walmart/TikTok, phí Afterpay, G&amp;A…) — sẽ tự đúng dần khi từng nguồn được nối vào. Dòng gắn nhãn <span class="tag gap" style="margin-left:0;"><span class="d"></span>Chưa nhập ($0)</span> là chi phí không có API (lương, văn phòng, khấu hao, lãi vay, thuế TNDN): điền theo tháng vào file <code>data/opex_monthly.json</code> trên GitHub, bảng tự đọc và rải đều theo ngày; tháng chưa chốt sổ được tạm tính (nhãn <span class="tag info" style="margin-left:0;"><span class="d"></span>Có ước tính</span>): chi phí VN = TB 6 tháng đã chốt gần nhất, phần mềm (Slash) &amp; Upwork = số thực tế tới nay.',
    'h.takeTitle':'Chi phí để bán qua từng kênh (take rate)',
    'h.takeNote':'Mỗi $1 doanh thu thuần của kênh, kênh và dịch vụ đi kèm lấy bao nhiêu — trước giá vốn sản phẩm và G&amp;A',
    'h.takeCaption':'Cùng số với bảng P&amp;L, chỉ xếp lại theo kênh. <b>Hoa hồng &amp; phí sàn / cổng thanh toán</b> là % cố định trên mỗi đơn (như margin của nhà bán lẻ) — chuẩn P&amp;L quản trị D2C xếp vào <i>phí bán hàng theo giao dịch</i> (trước CM2); <b>quảng cáo &amp; affiliate</b> là chi phí tuỳ chọn để tạo nhu cầu, xếp vào <i>marketing</i> (trước CM3) — không gộp chung để còn đọc được ACOS/TACOS. Tổng của cả hai cộng fulfillment và lưu kho = <b>take rate</b> của kênh ("Amazon lấy bao nhiêu %"). Klaviyo và gói Social Snowball trên P&amp;L nằm ở G&amp;A, ở đây tính cho kênh D2C vì chỉ phục vụ kênh đó.<span id="channelCostNote"></span>',
    'h.beTitle':'Điểm hoà vốn (break-even)',
    'h.beNote':'Dựa trên tỷ lệ chi phí biến đổi &amp; chi phí hoạt động (kho bãi, G&amp;A) của kỳ đang xem',
    'h.taxTitle':'Sales tax thu hộ',
    'h.taxNote':'Khoản thu hộ (pass-through liability) — không nằm trong P&amp;L ở trên · số thật từ Shopify; chưa tách theo bang (cần nối nguồn nộp thuế)',
    'h.taxCh':'Kênh',
    'h.taxCollected':'Đã thu',
    'h.taxRemitted':'Đã nộp',
    'h.taxOwed':'Còn nợ',
    'h.taxStatus':'Trạng thái',
    'h.amzGapTitle':'Amazon — chi phí chưa capture đầy đủ',
    'h.amzGapNote':'Từ log lần đồng bộ SP-API gần nhất · không đổi số đã hiển thị ở trên ngoài phần được ghi rõ',
    'h.invTitle':'Tồn kho Amazon FBA theo SKU',
    'h.prodTitle':'Lãi theo sản phẩm — CM3 từng SKU',
    'h.poTitle':'Hàng đang đặt (PO) — nhập tay',
    'h.smTitle':'ShipMonk — chi phí fulfillment theo từng đơn',
    'h.smNote':'Ước tính của ShipMonk cho từng đơn (cước carrier + pick &amp; pack + vật liệu đóng gói) · ghi theo ngày đặt hàng (giờ LA), gồm cả đơn chưa ship — cùng ngày với doanh thu',
    'h.smCaption':'Số lấy từ ShipMonk API (<code>order_costs</code>: estimated shipping / pick &amp; pack / packaging) cho mọi đơn ShipMonk nhận — store Shopify lẫn Amazon FBM. Đơn chưa ship dùng ước tính của ShipMonk và được cập nhật lại mỗi 30 phút khi ship. Hoá đơn tuần của ShipMonk có thể lệch nhỏ (điều chỉnh cước, surcharge). <b>Chưa gồm</b> phí lưu kho, receiving, xử lý hàng trả và các khoản chỉ có trên hoá đơn — sẽ thêm khi có file hoá đơn.',
    'h.invGapsTitle':'Chưa có trên trang này',
    'h.invGapsNote':'Cần thêm nguồn',
    'h.opexTitle':'Chi phí hoạt động (OpEx) kỳ đang xem',
    'h.opexNote2':'Kho bãi (ShipMonk, FBA lưu kho &amp; dịch vụ) + G&amp;A (nhập tay, Klaviyo, Snowball) · dưới lợi nhuận đóng góp',
    'h.opexManTitle':'Chi phí nhập tay (OpEx theo tháng)',
    'h.opexManNote':'Không có API — điền theo tháng vào <code>data/opex_monthly.json</code> trên GitHub; tháng chưa chốt sổ được tạm tính (≈): chi phí VN = TB 6 tháng đã chốt gần nhất, phần mềm (Slash) &amp; Upwork = số thực tế tới nay',
    'h.cashTitle':'Tiền mặt &amp; runway',
    'h.cashNote':'Chưa có nguồn',
    'h.liveBanner':'Đang kết nối dữ liệu thật…',
    'h.syncBanner':'<b>Lưu ý ngày gần nhất:</b> khoảng xem gồm ngày hôm nay (giờ LA) nên số ngày đó chưa chốt — Amazon ghi nhận phí/settlement muộn 24–48h, các nguồn khác tự đồng bộ vài giờ một lần.',
    'h.healthTitle':'Sức khoẻ dữ liệu theo nguồn',
    'h.healthNote':'Trạng thái tự động hoá của từng nguồn · chấm màu = tuổi lần đồng bộ gần nhất (Xanh &lt; 4h · Vàng 4–48h · Đỏ quá 48h hoặc chưa kết nối) · "N/14 ngày" = số ngày có số liệu thật trong 14 ngày gần nhất (không tính hôm nay, vì hôm nay chưa chốt)',
    'h.gapsTitle':'Còn thiếu gì trên P&amp;L',
    'h.gapsNote':'Gom lại từ các dòng "Chưa kết nối/Chưa nhập ($0)" đang rải rác trong bảng P&amp;L và ROAS — để biết cần nối gì tiếp theo',
    'h.foot':'Mọi nguồn được đồng bộ về cùng một lịch ngày: múi giờ America/Los_Angeles (Shopify, Amazon, Amazon Ads báo cáo sẵn theo giờ này; Meta &amp; Google được quy đổi từ dữ liệu theo giờ) · Cattasaurus Finance',
    'h.adsCapRest':'TikTok Ads = GMV Max của TikTok Shop ("DT quy về" là doanh thu TikTok Shop mà GMV Max tự nhận). Amazon Ads (khi có số): chi phí Sponsored Products / Brands / Display theo ngày, "DT quy về" là doanh thu Amazon gán cho quảng cáo (không cộng vào doanh thu).',
  });
  function money(v, opts){
    opts = opts||{};
    const abs = Math.abs(v);
    const sign = v<0 ? '-' : (opts.plusSign && v>0 ? '+' : '');
    if(opts.compact){
      if(abs>=1000000) return sign+'$'+(abs/1000000).toFixed(2)+'M';
      if(abs>=1000) return sign+'$'+(abs/1000).toFixed(1)+'k';
    }
    // Exact to the cent so every figure can be checked against Seller Central / Sellerboard / Ads Manager.
    return sign+'$'+abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  function pctStr(v){ return (v>=0?'':'') + v.toFixed(1)+'%'; }
  function pct1(a,b){ return b>0 ? (100*a/b).toFixed(1)+'%' : '—'; }
  function pct0(a,b){ return b>0 ? Math.round(100*a/b)+'%' : '—'; }
  function intFmt(n){ return Math.round(n).toLocaleString('en-US'); }
  function resolveVar(v){
    const probe = document.createElement('span');
    probe.style.color = v; document.body.appendChild(probe);
    const c = getComputedStyle(probe).color; probe.remove(); return c;
  }
  function fmtDate(d){ return LANG==='vi' ? d.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit'}) : MONTHS_EN[d.getMonth()]+' '+d.getDate(); }
  function fmtDateLong(d){ return LANG==='vi' ? d.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}) : MONTHS_EN[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear(); }
  // Calendar date in the viewer's local timezone (NOT toISOString, which converts to UTC and
  // shifts every key one day early for UTC+ viewers, so real data landed on the wrong chip).
  function isoDate(d){ const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  const DOW_VI = ['CN','T2','T3','T4','T5','T6','T7'];
  const DOW = new Proxy(DOW_VI, {get: (o, i) => (LANG==='vi' ? DOW_VI : DOW_EN)[i]});

  // ---------- report calendar ----------
  // Every synced source buckets its days in REPORT_TZ (America/Los_Angeles - the Shopify
  // store / Amazon US calendar), so "today" and the day chips follow that calendar too,
  // whatever timezone the viewer is in.
  const REPORT_TZ = 'America/Los_Angeles';
  function todayInTz(tz){
    try{
      const parts = new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
      const g = t => parseInt(parts.find(p=>p.type===t).value,10);
      return new Date(g('year'), g('month')-1, g('day'));
    }catch(e){ const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  }

  const CH_KEYS = ['shopify','amazon','walmart','tiktok'];
  const CH_LABEL = {shopify:'Shopify', amazon:'Amazon', walmart:'Walmart', tiktok:'TikTok Shop'};
  const CH_COLOR = {shopify:'var(--series-1)', amazon:'var(--series-2)', walmart:'var(--series-3)', tiktok:'var(--series-4)'};
  // V10.3: reporting groups — Walmart rolls into Amazon, TikTok Shop into Shopify (plans, matrix, channel card, pacing, filter).
  // The group's plan is the plan of its first member (Amazon plan = gross, Shopify plan = net); the P&L page still shows the 4 channels.
  const CH_GROUPS = [{id:'shopify', members:['shopify','tiktok']}, {id:'amazon', members:['amazon','walmart']}];
  const GROUP_OF = {}; CH_GROUPS.forEach(g=>g.members.forEach(k=>{ GROUP_OF[k] = g.id; }));
  const groupLabel = (g, full) => { const grp = CH_GROUPS.find(x=>x.id===g); let live = grp.members.filter(k=> !_chAvail || _chAvail.includes(k)); if(!full){ const on = live.filter(k=>CH_MASK[k]); if(on.length) live = on; } return live.map(k=>CH_LABEL[k]).join(' + '); };

  // Amazon SP-API Finances data, injected here at publish time by the automated sync
  // (GitHub Actions fetches from Amazon -> Claude scheduled task republishes this artifact
  // with the block below replaced). Do not rename this line; the sync matches it exactly.
  const AMAZON_LIVE_DATA = (window.__LIVE && window.__LIVE["amazon"]) || null; /*AMAZON_DATA_INJECT*/

  let amazonMeta = null;
  let amazonFeeEstRates = null;   // {refRate, fbaPerUnit, settledDays} once estimateUnpostedAmazonFees has run
  const AMZ_FEE_EST_SETTLE_DAYS = 14, AMZ_FEE_EST_WINDOW_DAYS = 21;   // days Amazon needs to post fees / how far back the top-up applies
  let amazonOrderBasisDays = 0;  let amazonFeeBasisOrderedDays = 0;   // days whose Amazon revenue comes from the order-date report (script schema 3)
  let shopifyMeta = null;   // full data/shopify_pnl.json when baked in (see SHOPIFY_DATA_INJECT)

  // Meta Ads (Facebook/Instagram) daily spend + attributed purchases from the Meta
  // Marketing API, injected the same way as AMAZON_LIVE_DATA above by the hourly sync
  // (GitHub Actions fetch_meta_ads.py -> data/meta_ads.json). Do not rename this line.
  const META_ADS_LIVE_DATA = (window.__LIVE && window.__LIVE["meta"]) || null; /*META_ADS_DATA_INJECT*/

  // Shopify daily sales (Admin GraphQL, bucketed by the shop's timezone) + Snowball
  // affiliate commissions derived from Snowball's order tags, injected the same way by
  // the hourly sync (GitHub Actions fetch_shopify_pnl.py -> data/shopify_pnl.json).
  // Do not rename this line.
  const SHOPIFY_LIVE_DATA = (window.__LIVE && window.__LIVE["shopify"]) || null; /*SHOPIFY_DATA_INJECT*/

  // Google Ads daily spend + conversions (Google Ads API, campaign level), injected the
  // same way by the sync (GitHub Actions fetch_google_ads.py -> data/google_ads.json).
  // Do not rename this line.
  const GOOGLE_ADS_LIVE_DATA = (window.__LIVE && window.__LIVE["google"]) || null; /*GOOGLE_ADS_DATA_INJECT*/
  // ShipMonk (3PL) per-order fulfillment charges - data/shipmonk.json from the ShipMonk sync.
  let SHIPMONK_INVENTORY = null;   // sync v1.4+: {as_of, warehouses[], skus{}, totals{}} (set by applyShipmonkRows)
  let SHIPMONK_BOM = null;         // V11.1 / sync v1.5+: {as_of, bundles{bundle_sku:{component_sku: qty}}} = ShipMonk's own bundle table (what the warehouse picks per SKU sold)
  let shipmonkBoxCoverage = null;  // V11.1.1: per month {boxes, packages} from the sync's packaging_items; months under 50% coverage keep the purchase line
  const SHIPMONK_LIVE_DATA = (window.__LIVE && window.__LIVE["shipmonk"]) || null; /*SHIPMONK_DATA_INJECT*/
  let shipmonkMeta = null;
  // ShipMonk INVOICES (storage, receiving, returns, packaging purchases, credits...) - read from the
  // billing page of app.shipmonk.com (no public API for billing); data/shipmonk_invoices.json.
  const SHIPMONK_INVOICES_LIVE_DATA = (window.__LIVE && window.__LIVE["shipmonk_invoices"]) || null; /*SHIPMONK_INVOICES_INJECT*/
  let shipmonkInvMeta = null;
  // PayPal fees (Transaction Search API) - data/paypal.json from the PayPal sync.
  const PAYPAL_LIVE_DATA = (window.__LIVE && window.__LIVE["paypal"]) || null; /*PAYPAL_DATA_INJECT*/
  let paypalMeta = null;
  // Klaviyo (email + SMS): Klaviyo-attributed orders/revenue per day, campaign + flow performance -
  // data/klaviyo.json from the Klaviyo sync (fetch_klaviyo.py). Do not rename this line.
  const KLAVIYO_LIVE_DATA = (window.__LIVE && window.__LIVE["klaviyo"]) || null; /*KLAVIYO_DATA_INJECT*/
  let klaviyoMeta = null;
  // Klaviyo INVOICES (plan + SMS + prorated upgrades + flex overage) read from the billing page (no billing
  // API) and booked per billing cycle (19th -> 18th), spread per day - data/klaviyo_invoices.json.
  const KLAVIYO_INVOICES_LIVE_DATA = (window.__LIVE && window.__LIVE["klaviyo_invoices"]) || null; /*KLAVIYO_INVOICES_INJECT*/
  let klaviyoInvMeta = null;
  // ShipMonk storage fee per DAY and warehouse (Reports > Storage Fees Breakdown, read by Claude's browser):
  // the exact amount the semi-monthly invoice will charge for that day - data/shipmonk_storage_daily.json.
  const SHIPMONK_STORAGE_LIVE_DATA = (window.__LIVE && window.__LIVE["shipmonk_storage"]) || null; /*SHIPMONK_STORAGE_INJECT*/
  let shipmonkStorageMeta = null;
  // Amazon FBA inventory snapshot + monthly storage fee reports + a per-day storage estimate for months Amazon has not
  // billed yet - data/amazon_storage.json from fetch_amazon_storage.py (hourly). Do not rename this line.
  const AMAZON_STORAGE_LIVE_DATA = (window.__LIVE && window.__LIVE["amazon_storage"]) || null; /*AMAZON_STORAGE_INJECT*/
  let amazonStorageMeta = null;
  // Monthly OpEx entered by hand (no API): payroll, software, office, accounting, insurance, other (G&A, above EBITDA)
  // and depreciation, interest, income tax (below EBITDA) - data/opex_monthly.json in the repo, USD per month,
  // spread evenly over the days of the month. V11.7: a month still open (status "open") or not entered yet is estimated —
  // Vietnam costs = average of the last 6 closed months, software (Slash) & Upwork = actual to date (see applyOpexRows).
  const OPEX_MONTHLY_LIVE_DATA = (window.__LIVE && window.__LIVE["opex"]) || null; /*OPEX_MONTHLY_INJECT*/
  // Monthly plan + COGS estimate (data/targets_monthly.json, edited by hand on GitHub): the executive page compares
  // the period with its plan, and product cost = net revenue x cogs_estimate.rate until COGS per SKU exists.
  const TARGETS_LIVE_DATA = (window.__LIVE && window.__LIVE["targets"]) || null;
  let COGS_EST = null;                       // {rate, basis, as_of} or null (= product cost $0, "chưa kết nối")
  let PLAN = {months:{}, note:'', updated_at:null};
  function applyTargets(data){
    if(!data || typeof data!=='object') return false;
    const num = v => (v===null || v===undefined || v==='') ? null : (isFinite(parseFloat(v)) ? parseFloat(v) : null);
    const ce = data.cogs_estimate;
    if(ce && ce.enabled!==false && num(ce.rate)>0 && num(ce.rate)<1) COGS_EST = {rate: num(ce.rate), basis: ce.basis||'', as_of: ce.as_of||null};
    const months = {};
    Object.keys(data.months||{}).forEach(m=>{
      if(!/^\d{4}-\d{2}$/.test(m) || !data.months[m] || typeof data.months[m]!=='object') return;
      const v = data.months[m], ch = {};
      Object.keys(v.channels||{}).forEach(k=>{ if(CH_KEYS.includes(k) && v.channels[k]) ch[k] = {gross: num(v.channels[k].gross_sales), grossLY: num(v.channels[k].gross_sales_2025), net: num(v.channels[k].net_sales)}; });
      months[m] = {net_revenue: num(v.net_revenue), marketing: num(v.marketing), orders: num(v.orders), cm3: num(v.cm3), channels: ch, note: v.note||''};
    });
    PLAN = {months, note: data.plans_note||data.note||'', updated_at: data.updated_at||null};
    return Object.keys(months).length>0 || !!COGS_EST;
  }
  const daysInMonth = m => new Date(Date.UTC(+m.slice(0,4), +m.slice(5,7), 0)).getUTCDate();
  // ---- real product cost per month per channel (data/cogs_monthly.json, from the accountant's inventory report) ----
  // A month+channel with a number here REPLACES the estimate: the monthly figure is spread over the days in
  // proportion to that channel's net revenue, so day / week / custom ranges stay meaningful.
  const COGS_LIVE_DATA = (window.__LIVE && window.__LIVE["cogs"]) || null;
  let COGS_ACTUAL = {months:{}, updated_at:null};
  // V11: receipt lots (data/cogs_lots.json <- Notion Reorder Tracker) for FIFO product cost; parsed lazily after boot
  const COGS_LOTS_LIVE_DATA = (window.__LIVE && window.__LIVE["cogs_lots"]) || null;
  let LOTS = null, _fifo = null;
  function applyCogsActual(data){
    if(!data || typeof data!=='object') return false;
    const num = v => (v===null || v===undefined || v==='') ? null : (isFinite(parseFloat(v)) ? parseFloat(v) : null);
    const months = {};
    Object.keys(data.months||{}).forEach(m=>{
      if(!/^\d{4}-\d{2}$/.test(m) || !data.months[m] || typeof data.months[m]!=='object') return;
      const v = data.months[m], ch = {};
      CH_KEYS.forEach(k=>{ const x = num(v[k]); if(x!==null && x>=0) ch[k] = x; });
      if(Object.keys(ch).length) months[m] = {channels: ch, note: v.note||''};
    });
    COGS_ACTUAL = {months, updated_at: data.updated_at||null};
    return Object.keys(months).length>0;
  }
  // whole-month net revenue of one channel (denominator when spreading a monthly COGS figure over days)
  const _monthNetCache = {};
  function monthChannelNet(m, k){
    const ck = m+'|'+k;
    if(_monthNetCache[ck]===undefined){
      const rs = monthMap[m] || [];
      _monthNetCache[ck] = rs.reduce((t,r)=> t + (r.channels[k]||0) - (r.discounts[k]||0) - (r.refunds[k]||0), 0);
    }
    return _monthNetCache[ck];
  }
  // product cost for a set of day rows, per channel: real where the month+channel is filled in, else the estimate
  function productCostFor(rows, estRate){
    const by = {}; CH_KEYS.forEach(k=>by[k]=0);
    let actual = 0, estimated = 0, anyEst = false, anyActual = false, lots = 0, fallback = 0, lotUnits = 0, fbUnits = 0, estUnits = 0, units = 0;
    const F = fifoState();   // V11: FIFO by receipt lot for days + channels that carry units per SKU
    const byMonth = {};
    rows.forEach(r=>{ const m = r.iso.slice(0,7); (byMonth[m] = byMonth[m] || []).push(r); });
    Object.keys(byMonth).forEach(m=>{
      const rs = byMonth[m], am = COGS_ACTUAL.months[m];
      CH_KEYS.forEach(k=>{
        const real = am && am.channels[k]!==undefined ? am.channels[k] : null;
        if(real!==null){
          const net = rs.reduce((t,r)=> t + (r.channels[k]||0) - (r.discounts[k]||0) - (r.refunds[k]||0), 0);
          const whole = monthChannelNet(m, k);
          const v = whole>0.005 ? real * (net/whole) : real * (rs.length/daysInMonth(m));
          actual += v; anyActual = true; by[k] += v;
          return;
        }
        rs.forEach(r=>{
          const net = (r.channels[k]||0) - (r.discounts[k]||0) - (r.refunds[k]||0);
          const fd = F && F.ok && F.day[r.iso] && F.day[r.iso][k], sk = r.sku && r.sku[k];
          let v;
          if(fd && sk){
            const x = fifoCostOfSku(fd, sk);
            const e = estRate>0 ? Math.max(0, net)*estRate*x.estShare : 0;
            v = x.lot + x.fb + e; lots += x.lot; fallback += x.fb; estimated += e; if(e>0.005) anyEst = true;
            lotUnits += x.lotUnits; fbUnits += x.fbUnits; estUnits += x.estUnits; units += x.units;
          } else {
            v = estRate>0 ? Math.max(0, net)*estRate : 0;
            estimated += v; if(estRate>0) anyEst = true;
          }
          by[k] += v;
        });
      });
    });
    return {by, total: actual+estimated+lots+fallback, actual, estimated, anyEst, anyActual, lots, fallback, lotUnits, fbUnits, estUnits, units};
  }
  // plan prorated over a set of day rows: null when any month touched has no number for that field
  function planForRows(rows, getter, perChannel){
    if(!perChannel && maskPartial()) return null;   // V8: a company plan is not comparable with one channel
    let total = 0, any = false;
    for(const r of rows){
      const m = r.iso.slice(0,7), p = PLAN.months[m];
      const v = p ? getter(p) : null;
      if(v===null || v===undefined) return null;
      total += v/daysInMonth(m); any = true;
    }
    return any ? total : null;
  }
  let opexMeta = null;
  const OPEX_GA_KEYS = ['salary','software','office','accounting','insurance','other'];
  const OPEX_BELOW_KEYS = ['depreciation','interest','income_tax'];
  const OPEX_AVG_MONTHS = 6;   // V11.7: open / missing month = average of the last 6 closed months
  const OPEX_EST_TITLE = () => tv('Month not closed yet — estimated until its actual figures are entered: Vietnam costs = average of the last 6 closed months; software (Slash card) and Upwork contractors = actual charges to date, spread per day. Replaced automatically once the month is entered in data/opex_monthly.json', 'Tháng chưa chốt sổ — tạm tính tới khi nhập số thật: chi phí VN = trung bình 6 tháng đã chốt gần nhất; phần mềm (thẻ Slash) và Upwork = số thực tế tới nay, rải theo ngày. Tự thay khi nhập tháng vào data/opex_monthly.json');
  // Amazon Ads spend per day (SP / SB / SD). Today: exported from Sellerboard (which pulls the Amazon Ads API);
  // later: data/amazon_ads.json from the Amazon Ads API workflow once Amazon approves access. Same shape either way.
  const AMAZON_ADS_LIVE_DATA = (window.__LIVE && window.__LIVE["amazon_ads"]) || null; /*AMAZON_ADS_DATA_INJECT*/
  // Loop Subscriptions (Shopify subscription app): new subscriptions/subscribers/checkout revenue per day (real,
  // from Loop's Admin API) + mrr_estimate (run-rate from active subs' billing schedule, NOT period-actual
  // recurring revenue - Loop has no endpoint to list orders store-wide) - data/loop_subscriptions.json.
  const LOOP_LIVE_DATA = (window.__LIVE && window.__LIVE["loop_subscriptions"]) || null; /*LOOP_SUBSCRIPTIONS_INJECT*/
  let loopMeta = null;
  // Afterpay merchant fee: Shopify exposes no fee for the Afterpay gateway, so it is ESTIMATED = captured amount x pct + orders x fixed.
  // Assumed US list rate 6% + $0.30 per order - replace with the rate in the Afterpay merchant agreement / settlement report.
  const AFTERPAY_FEE = {pct:0.06, fixed:0.30};
  // TikTok Shop (Open API, data/tiktok_shop.json schema 2): orders by ORDER date (LA) + real fees of settled orders.
  const TIKTOK_SHOP_LIVE_DATA = (window.__LIVE && window.__LIVE["tiktok_shop"]) || null; /*TIKTOK_SHOP_INJECT*/
  let tiktokMeta = null;
  // Walmart Marketplace (data/walmart.json schema 1): orders by ORDER date (LA) + real commission from the reconciliation report.
  const WALMART_LIVE_DATA = (window.__LIVE && window.__LIVE["walmart"]) || null; /*WALMART_INJECT*/
  let walmartMeta = null;
  // AppLovin (Reporting API, data/applovin.json schema 1): daily advertiser cost + platform-attributed sales.
  const APPLOVIN_LIVE_DATA = (window.__LIVE && window.__LIVE["applovin"]) || null; /*APPLOVIN_INJECT*/
  // TikTok Ads (Marketing API v1.3, data/tiktok_ads.json schema 1): daily cost of GMV Max (TikTok Shop) + other auction ads,
  // with the orders / gross revenue GMV Max attributes to itself (platform-reported, never added to revenue).
  const TIKTOK_ADS_LIVE_DATA = (window.__LIVE && window.__LIVE["tiktok_ads"]) || null;

  // Last-touch channels (Shopify customer journey, sync v1.8+): fixed order, fixed colors.
  // Full-strength hues = one entity each; lighter mixes = the organic / untagged sibling of that hue.
  const ATTR_CH = [
    {key:'email', label:'Email (Klaviyo)', color:'var(--series-3)', ink:'#fff', cost:'klaviyo'},
    {key:'sms', label:'SMS (Klaviyo)', color:'color-mix(in srgb, var(--series-3) 55%, var(--surface-card))', cost:'klaviyo'},
    {key:'email_other', get label(){ return tv('Other email (no Klaviyo UTM)', 'Email khác (không có UTM Klaviyo)'); }, color:'color-mix(in srgb, var(--series-3) 28%, var(--surface-card))'},
    {key:'meta_paid', label:'Meta Ads', color:'var(--series-1)', ink:'#fff', cost:'meta'},
    {key:'meta_organic', get label(){ return tv('Meta without UTM (FB/IG referrer)', 'Meta không UTM (FB/IG referrer)'); }, color:'color-mix(in srgb, var(--series-1) 45%, var(--surface-card))'},
    {key:'meta_shop', get label(){ return tv('Bought in Facebook / Instagram Shop', 'Mua trong Facebook / Instagram Shop'); }, color:'color-mix(in srgb, var(--series-1) 70%, var(--surface-card))', ink:'#fff'},
    {key:'google_ads', label:'Google Ads', color:'var(--series-2)', ink:'#fff', cost:'google'},
    {key:'organic_search', get label(){ return tv('Organic search (Google, Bing…)', 'Tìm kiếm organic (Google, Bing…)'); }, color:'var(--series-4)', ink:'#fff'},
    {key:'tiktok_ads', label:'TikTok Ads', color:'var(--series-5)', ink:'#fff', cost:'tiktokads'},
    {key:'tiktok_organic', label:'TikTok organic', color:'color-mix(in srgb, var(--series-5) 45%, var(--surface-card))'},
    {key:'tiktok_shop', label:'TikTok Shop', color:'color-mix(in srgb, var(--series-5) 70%, var(--surface-card))', ink:'#fff'},
    {key:'applovin', label:'AppLovin', color:'var(--series-7)', ink:'#fff', cost:'applovin'},
    {key:'snowball', label:'Snowball / creator / affiliate', color:'var(--series-6)', ink:'#fff', cost:'snowball'},
    {key:'other_paid', get label(){ return tv('Other paid ads', 'Quảng cáo trả tiền khác'); }, color:'color-mix(in srgb, var(--series-7) 45%, var(--surface-card))'},
    {key:'social_other', get label(){ return tv('Other social', 'Mạng xã hội khác'); }, color:'color-mix(in srgb, var(--series-2) 45%, var(--surface-card))'},
    {key:'ai_search', label:'AI (ChatGPT, Perplexity…)', color:'color-mix(in srgb, var(--series-4) 45%, var(--surface-card))'},
    {key:'referral', get label(){ return tv('Referring websites', 'Website giới thiệu'); }, color:'var(--ink-muted)', ink:'#fff'},
    {key:'other_utm', get label(){ return tv('Other UTM', 'UTM khác'); }, color:'color-mix(in srgb, var(--ink-muted) 55%, var(--surface-card))'},
    {key:'shop_app', label:'Shop app (Shopify)', color:'color-mix(in srgb, var(--series-6) 45%, var(--surface-card))'},
    {key:'other_channel', get label(){ return tv('Other sales channels (POS, app, draft…)', 'Kênh bán khác (POS, app, draft…)'); }, color:'color-mix(in srgb, var(--ink-muted) 40%, var(--surface-card))'},
    {key:'direct', get label(){ return tv('Direct (typed link / bookmark)', 'Direct (gõ link / bookmark)'); }, color:'var(--baseline)'},
    {key:'unknown', get label(){ return tv('No journey (web, no cookie)', 'Không có hành trình (web, không cookie)'); }, color:'var(--gridline)'},
  ];
  const ATTR_BY_KEY = {}; ATTR_CH.forEach(c=>ATTR_BY_KEY[c.key]=c);
  const ATTR_PAID = {meta_paid:true, google_ads:true, tiktok_ads:true, applovin:true, other_paid:true};
  const ATTR_LABEL = k => (ATTR_BY_KEY[k] ? ATTR_BY_KEY[k].label : k);

  const AD_KEYS = ['meta','google','tiktokads','applovin','amazonads'];
  const AD_LABEL = {meta:'Meta Ads', google:'Google Ads', tiktokads:'TikTok Ads', applovin:'AppLovin', amazonads:'Amazon Ads'};
  const AD_COLOR = {meta:'var(--series-1)', google:'var(--series-2)', tiktokads:'var(--series-4)', applovin:'var(--series-3)', amazonads:'var(--series-5)'};
  // G&A: only confirmed monthly fees carry a number (real:true). Everything else is $0 until
  // the accounting source is connected - no seeded estimates anywhere on this page.
  const GA_ITEMS = [
    {key:'salary', get label(){ return tv('Salaries & staff — indirect (operations, management; contractors via Upwork)', 'Lương & nhân sự gián tiếp (vận hành, quản lý; nhân sự thuê ngoài Upwork)'); }, monthly:0},
    {key:'software', get label(){ return tv('Software & tools', 'Phần mềm & công cụ'); }, monthly:0},
    {key:'snowball_sub', get label(){ return tv('Social Snowball — affiliate software (Blizzard plan, no % of commissions)', 'Social Snowball — phần mềm affiliate (gói Blizzard, không thu % hoa hồng)'); }, monthly:350, real:true},
    {key:'office', get label(){ return tv('Office & operations', 'Văn phòng & vận hành'); }, monthly:0},
    {key:'accounting', get label(){ return tv('Accounting & legal', 'Kế toán & pháp lý'); }, monthly:0},
    {key:'insurance', get label(){ return tv('Insurance', 'Bảo hiểm'); }, monthly:0},
    {key:'other', get label(){ return tv('Other', 'Khác'); }, monthly:0},
  ];
  const INVENTORY_MONTHLY = 0;   // holding cost: no source connected yet
  const META_ROAS_WARN = 1.5, META_CPA_WARN = 90;   // thresholds for the Meta campaign table

  // ---------- date window: first day any live source covers .. today (REPORT_TZ) ----------
  // Nothing is seeded outside the synced window any more, so June/July would only be rows of
  // zeros - the page starts where the real data starts (45-day sync window).
  const END_DATE = todayInTz(REPORT_TZ);
  function earliestLiveDay(){
    let min = null;
    [AMAZON_LIVE_DATA, META_ADS_LIVE_DATA, SHOPIFY_LIVE_DATA, GOOGLE_ADS_LIVE_DATA].forEach(d=>{
      if(!d || !d.daily) return;
      Object.keys(d.daily).forEach(iso=>{ if(/^\d{4}-\d{2}-\d{2}$/.test(iso) && (!min || iso<min)) min = iso; });
    });
    return min;
  }
  const FIRST_LIVE_DAY = earliestLiveDay();
  const START_DATE = FIRST_LIVE_DAY
    ? new Date(parseInt(FIRST_LIVE_DAY.slice(0,4),10), parseInt(FIRST_LIVE_DAY.slice(5,7),10)-1, parseInt(FIRST_LIVE_DAY.slice(8,10),10))
    : new Date(END_DATE.getFullYear(), END_DATE.getMonth(), END_DATE.getDate()-44);
  const TOTAL_DAYS = Math.max(1, Math.round((END_DATE-START_DATE)/86400000)+1);
  function dateAt(i){ const d = new Date(START_DATE); d.setDate(d.getDate()+i); return d; }

  // Every day starts at $0 for every channel and ad platform; the apply*() functions below
  // fill in whatever the synced sources cover. Unconnected sources simply stay at $0.
  const days = [];
  for(let i=0;i<TOTAL_DAYS;i++){
    const d = dateAt(i);
    const row = {date:d, iso:isoDate(d), channels:{}, refunds:{}, orders:{}, discounts:{}, ads:{}, adsAttr:{}, amazonReal:null, metaReal:null, googleReal:null, shopifyReal:null, snowballReal:null, shipmonkReal:null, shipmonkInv:null, paypalReal:null, shopifyAttr:null, klaviyoReal:null, klaviyoCost:null, loopReal:null, tiktokReal:null, walmartReal:null, applovinReal:null, funnel:null, sku:null, markets:null};
    CH_KEYS.forEach(k=>{ row.channels[k]=0; row.refunds[k]=0; row.orders[k]=0; row.discounts[k]=0; });
    AD_KEYS.forEach(k=>{ row.ads[k]=0; row.adsAttr[k]=0; });
    days.push(row);
  }
  days[TOTAL_DAYS-1]._syncing = true;
  // Channels / ad platforms with no synced source at all (always $0 until connected).
  const CH_UNCONNECTED = {walmart:true, tiktok:true};
  const AD_UNCONNECTED = {tiktokads:true, applovin:true, amazonads:true};   // amazonads flips to false when AMAZON_ADS_LIVE_DATA matches

  // name / age are language-aware until setSource() overwrites age with a live status string (setter keeps that string as-is)
  const mkSource = (key, nameFn, ageFn, level) => ({key, level, _age: undefined, get name(){ return nameFn(); }, get age(){ return this._age!==undefined ? this._age : ageFn(); }, set age(v){ this._age = v; }});
  const NC0 = () => tv('Not connected — $0', 'Chưa kết nối — $0'), NC = () => tv('Not connected', 'Chưa kết nối');
  const SOURCES = [
    mkSource('shopify', () => tv('Shopify (revenue)', 'Shopify (doanh thu)'), NC0, 'c'),
    mkSource('snowball', () => tv('Snowball (influencer commissions)', 'Snowball (hoa hồng influencer)'), () => tv('Not connected — not in the P&L yet', 'Chưa kết nối — chưa có trong P&L'), 'c'),
    mkSource('tiktokshop', () => tv('TikTok Shop (orders)', 'TikTok Shop (đơn hàng)'), NC0, 'c'),
    mkSource('amazon', () => 'Amazon Orders', NC0, 'c'),
    mkSource('walmart', () => 'Walmart Marketplace', NC0, 'c'),
    mkSource('meta', () => 'Meta Ads', NC0, 'c'),
    mkSource('google', () => 'Google Ads', NC0, 'c'),
    mkSource('tiktokads', () => 'TikTok Ads', NC0, 'c'),
    mkSource('applovin', () => 'AppLovin', NC0, 'c'),
    mkSource('amazonads', () => 'Amazon Ads (SP / SB / SD)', () => tv('Waiting for Amazon to approve the Advertising API — $0', 'Chờ Amazon duyệt Advertising API — $0'), 'c'),
    mkSource('amazonfin', () => 'Amazon SP-API Finances', NC0, 'c'),
    mkSource('amazon_storage', () => tv('Amazon FBA inventory & storage fees (Inventory API + report)', 'Amazon FBA tồn kho & phí lưu kho (Inventory API + report)'), () => tv('Not connected — storage as charged by Amazon', 'Chưa kết nối — lưu kho theo số Amazon thu'), 'c'),
    mkSource('shipmonk', () => tv('ShipMonk (per-order fulfillment fees)', 'ShipMonk (phí fulfillment theo đơn)'), NC0, 'c'),
    mkSource('shipmonk_inv', () => tv('ShipMonk invoices (storage, receiving, returns…)', 'ShipMonk hoá đơn (lưu kho, receiving, hàng trả…)'), NC0, 'c'),
    mkSource('paypal', () => tv('PayPal (transaction fees)', 'PayPal (phí giao dịch)'), NC0, 'c'),
    mkSource('klaviyo', () => 'Klaviyo (email & SMS marketing)', NC, 'c'),
    mkSource('loop', () => tv('Loop Subscriptions (recurring subscriptions)', 'Loop Subscriptions (đăng ký định kỳ)'), NC, 'c'),
    mkSource('cogs', () => tv('Product cost (FIFO, Notion receipt lots)', 'Giá vốn (FIFO, lô nhập Notion)'), NC0, 'c'),
    mkSource('ga', () => tv('Accounting (G&A)', 'Kế toán (G&A)'), NC0, 'c'),
  ];

  // ---------- months list ----------
  const monthMap = {};
  days.forEach(d=>{ const m = d.iso.slice(0,7); (monthMap[m] = monthMap[m]||[]).push(d); });
  const MONTHS = Object.keys(monthMap).sort();
  const MONTH_LABEL = m => { const [y,mo] = m.split('-'); return tv(MONTHS_EN[parseInt(mo,10)-1]+' '+y, 'Tháng '+parseInt(mo,10)+'/'+y) + (monthMap[m].length<28? tv(' (to ', ' (đến ')+fmtDate(monthMap[m][monthMap[m].length-1].date)+')' : ''); };
  // ---------- weeks list (Monday - Sunday, keyed by the Monday) ----------
  const weekMap = {};
  days.forEach(d=>{ const dow = (d.date.getDay()+6)%7; const mon = new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate()-dow); const k = isoDate(mon); (weekMap[k] = weekMap[k]||[]).push(d); });
  const WEEKS = Object.keys(weekMap).sort();
  function isoWeekNo(d){ const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dn = t.getUTCDay()||7; t.setUTCDate(t.getUTCDate()+4-dn); const y0 = new Date(Date.UTC(t.getUTCFullYear(),0,1)); return Math.ceil((((t-y0)/86400000)+1)/7); }
  const WEEK_LABEL = k => { const r = weekMap[k]; const mon = new Date(k.slice(0,4), k.slice(5,7)-1, k.slice(8,10)); const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate()+6); return tv('Week ', 'Tuần ')+isoWeekNo(mon)+'/'+mon.getFullYear()+' · '+fmtDate(mon)+' – '+fmtDate(sun) + (r.length<7 ? tv(' ('+r.length+(r.length===1 ? ' day)' : ' days)'), ' (có '+r.length+' ngày)') : ''); };

  // ---------- V10: global filters — channel × market × product line ----------
  // Every number on every page can be narrowed by sales channel, market (country of the order) and product line.
  // Channel: sources that belong to one channel are dropped for the others. Market / product: each channel-day is
  // scaled by the share of that day's gross sales the selection represents (markets[] and sku_sales[] from the syncs,
  // exact per SKU); costs shared by all channels (G&A, ShipMonk warehousing, holding cost, below-EBITDA entries) are
  // allocated by net-revenue share and labelled "allocated". Days without the split (older than the sync's
  // markets_since / sku_units_since) are excluded and counted so the filter banner can say so.
  const CH_MASK = {shopify:true, amazon:true, walmart:true, tiktok:true};
  try{ const m0 = JSON.parse(localStorage.getItem('ctu_ch')||'null'); if(m0 && typeof m0==='object'){ CH_KEYS.forEach(k=>{ CH_MASK[k] = m0[k]!==false; }); } }catch(e){}
  if(!CH_KEYS.some(k=>CH_MASK[k])) CH_KEYS.forEach(k=>CH_MASK[k]=true);
  const FILTER = {market:'all', product:'all'};
  try{ const f0 = JSON.parse(localStorage.getItem('ctu_filter')||'null'); if(f0 && typeof f0==='object'){ if(typeof f0.market==='string') FILTER.market = f0.market; if(typeof f0.product==='string') FILTER.product = f0.product; } }catch(e){}
  const chPartial = () => CH_KEYS.some(k=>!CH_MASK[k]);
  const maskPartial = () => chPartial() || FILTER.market!=='all' || FILTER.product!=='all';
  const AD_CHANNEL = {meta:'shopify', google:'shopify', applovin:'shopify', tiktokads:'tiktok', amazonads:'amazon'};
  const US_ONLY_CH = {walmart:true, tiktok:true};   // sell in the US only and carry no SKU / market split yet
  let _maskVer = 0; const _maskCache = new WeakMap();
  function setChannelMask(next){ CH_KEYS.forEach(k=>{ CH_MASK[k] = next[k]!==false; }); if(!CH_KEYS.some(k=>CH_MASK[k])) CH_KEYS.forEach(k=>CH_MASK[k]=true); _maskVer++; try{ localStorage.setItem('ctu_ch', JSON.stringify(CH_MASK)); }catch(e){} }
  function setFilter(patch){ Object.assign(FILTER, patch); _maskVer++; try{ localStorage.setItem('ctu_filter', JSON.stringify(FILTER)); }catch(e){} }
  const storeChannel = k => /amazon/i.test(k) ? 'amazon' : /walmart/i.test(k) ? 'walmart' : /tiktok/i.test(k) ? 'tiktok' : 'shopify';

  // ---- markets (country of the order) ----
  const MARKET_NAMES = {US:{en:'United States',vi:'Mỹ'}, CA:{en:'Canada',vi:'Canada'}, MX:{en:'Mexico',vi:'Mexico'}, GB:{en:'United Kingdom',vi:'Anh'}, AU:{en:'Australia',vi:'Úc'}, DE:{en:'Germany',vi:'Đức'}, FR:{en:'France',vi:'Pháp'}, XX:{en:'Unknown',vi:'Không rõ'}};
  const marketLabel = cc => cc==='all' ? tx('f.allMarkets') : ((MARKET_NAMES[cc] && MARKET_NAMES[cc][LANG]) || cc);
  let _marketsAvail = null;
  function marketsAvailable(){
    if(_marketsAvail) return _marketsAvail;
    const seen = {US:0};
    days.forEach(r=>{ if(!r.markets) return; CH_KEYS.forEach(k=>{ const mk = r.markets[k]; if(!mk) return; Object.keys(mk).forEach(cc=>{ seen[cc] = (seen[cc]||0) + 1; }); }); });
    _marketsAvail = Object.keys(seen).sort((a,b)=> a==='US' ? -1 : b==='US' ? 1 : (a==='XX' ? 1 : b==='XX' ? -1 : a.localeCompare(b)));
    return _marketsAvail;
  }
  const marketGross = (k, b) => k==='amazon' ? (+(b.ordered_sales!==undefined ? b.ordered_sales : b.gross_sales)||0) : (+b.gross_sales||0);

  // ---- product lines (data/products.json) ----
  const PRODUCTS_LIVE_DATA = (window.__LIVE && window.__LIVE["products"]) || null;
  function parseProducts(data){
    const out = [];
    if(!data || typeof data!=='object' || !Array.isArray(data.lines)) return out;
    data.lines.forEach(l=>{
      if(!l || typeof l!=='object' || !l.id) return;
      const re = []; (Array.isArray(l.match) ? l.match : []).forEach(p=>{ try{ re.push(new RegExp(p, 'i')); }catch(e){} });
      out.push({id: String(l.id), name: (l.name && typeof l.name==='object') ? l.name : {en: String(l.name||l.id), vi: String(l.name||l.id)}, match: re, names: (Array.isArray(l.names) ? l.names : []).map(s=>String(s).toLowerCase()).filter(Boolean), skus: new Set((Array.isArray(l.skus) ? l.skus : []).map(s=>String(s).trim().toUpperCase()))});
    });
    return out;
  }
  const PRODUCT_LINES = parseProducts(PRODUCTS_LIVE_DATA);
  const productLineName = id => id==='all' ? tx('f.allProducts') : id==='other' ? tx('f.otherProducts') : (()=>{ const l = PRODUCT_LINES.find(x=>x.id===id); return l ? (l.name[LANG] || l.name.en || l.name.vi || id) : id; })();
  const _lineCache = {};
  function amazonListingName(sku){ const snap = AMAZON_STORAGE_LIVE_DATA && AMAZON_STORAGE_LIVE_DATA.inventory && AMAZON_STORAGE_LIVE_DATA.inventory.snapshot; return (snap && snap[sku] && snap[sku].name) || ''; }
  function productLineOf(sku){
    if(sku in _lineCache) return _lineCache[sku];
    let s = String(sku||'').trim(), up = s.toUpperCase(), out = 'other';
    if(/^amzn\.gr\./i.test(s)){ const parent = s.slice(8, 20); out = productLineOf(parent); _lineCache[sku] = out; return out; }   // virtual bundle: amzn.gr.<XX-XXXX-XXXX>-…
    const name = amazonListingName(s).toLowerCase();
    for(const l of PRODUCT_LINES){ if(l.skus.has(up)){ out = l.id; break; } }
    if(out==='other') for(const l of PRODUCT_LINES){ if(l.match.some(re=>re.test(s))){ out = l.id; break; } }
    if(out==='other' && name) for(const l of PRODUCT_LINES){ if(l.names.some(n=>name.includes(n))){ out = l.id; break; } }
    _lineCache[sku] = out; return out;
  }
  const productLinesAvailable = () => PRODUCT_LINES.map(l=>l.id).concat(['other']);

  // share of one channel-day the selection represents: 1 = all of it, 0 = none, null = the day lacks the split
  function rowFactor(r, k){
    if(!CH_MASK[k]) return 0;
    const mk = FILTER.market, pl = FILTER.product;
    if(mk==='all' && pl==='all') return 1;
    if(US_ONLY_CH[k]){ if(pl!=='all') return null; return mk==='US' ? 1 : 0; }
    const mks = r.markets && r.markets[k], sd = r.sku && r.sku[k];
    if(pl==='all'){
      if(!mks) return null;
      let tot = 0, sel = 0; Object.keys(mks).forEach(cc=>{ const g = marketGross(k, mks[cc]); tot += g; if(cc===mk) sel += g; });
      return tot>0.005 ? Math.min(1, Math.max(0, sel/tot)) : 0;
    }
    if(!sd) return null;
    let tot = 0; Object.values(sd.sales||{}).forEach(v=>{ tot += +v||0; });
    let src = sd.sales;
    if(mk!=='all'){ if(!mks) return null; const b = mks[mk]; src = b ? (b.sku_sales||{}) : {}; }
    let sel = 0; Object.entries(src||{}).forEach(([s,v])=>{ if(productLineOf(s)===pl) sel += +v||0; });
    return tot>0.005 ? Math.min(1, Math.max(0, sel/tot)) : 0;
  }
  function scaleDeep(o, f){
    if(o===null || o===undefined) return o;
    if(typeof o==='number') return o*f;
    if(Array.isArray(o)) return o.map(x=>scaleDeep(x, f));
    if(typeof o==='object'){ const out = {}; Object.keys(o).forEach(key=>{ out[key] = scaleDeep(o[key], f); }); return out; }
    return o;
  }
  function maskRow(r){
    if(!maskPartial()) return r;
    const c = _maskCache.get(r); if(c && c.ver===_maskVer) return c.row;
    const F = {}; let unknown = false;
    CH_KEYS.forEach(k=>{ let f = rowFactor(r, k); if(f===null){ unknown = true; f = 0; } F[k] = f; });
    const m = Object.assign({}, r); m._unknown = unknown; m._factors = F;
    m.channels = {}; m.refunds = {}; m.orders = {}; m.discounts = {};
    CH_KEYS.forEach(k=>{ const f = F[k]; m.channels[k] = r.channels[k]*f; m.refunds[k] = r.refunds[k]*f; m.orders[k] = r.orders[k]*f; m.discounts[k] = r.discounts[k]*f; });
    m.ads = {}; m.adsAttr = {};
    AD_KEYS.forEach(k=>{ const f = F[AD_CHANNEL[k]]; m.ads[k] = r.ads[k]*f; m.adsAttr[k] = r.adsAttr[k]*f; });
    const sc = (obj, f) => (obj===null || obj===undefined) ? obj : (f>=1 ? obj : (f<=0 ? null : scaleDeep(obj, f)));
    m.amazonReal = sc(r.amazonReal, F.amazon); m.amazonAdsReal = sc(r.amazonAdsReal, F.amazon);
    ['shopifyReal','paypalReal','snowballReal','shopifyAttr','klaviyoReal','klaviyoCost','loopReal','metaReal','googleReal','applovinReal'].forEach(key=>{ m[key] = sc(r[key], F.shopify); });
    m.tiktokReal = sc(r.tiktokReal, F.tiktok); m.tiktokAdsReal = sc(r.tiktokAdsReal, F.tiktok);
    m.walmartReal = sc(r.walmartReal, F.walmart);
    if(r.shipmonkReal){
      // per-order 3PL cost by store -> channel factor; a day without the store split follows the take-rate card (all D2C)
      const bs = r.shipmonkReal.byStore || {}, stores = Object.keys(bs);
      if(stores.length){
        const keep = {}; let orders=0, units=0, shipping=0, packaging=0, pickPack=0, total=0;
        stores.forEach(k=>{ const f = F[storeChannel(k)]; if(f<=0) return; const v = f>=1 ? bs[k] : scaleDeep(bs[k], f); keep[k] = v; orders += v.orders||0; units += v.units||0; shipping += v.shipping_cost||0; packaging += v.packaging_cost||0; pickPack += v.pick_pack_cost||0; total += v.total_cost||0; });
        const f = r.shipmonkReal.orders>0 ? orders/r.shipmonkReal.orders : 0, sx = x => (x||0)*f;
        m.shipmonkReal = Object.assign({}, r.shipmonkReal, {orders, units, shipping, packaging, pickPack, total, byStore: keep, shipped: sx(r.shipmonkReal.shipped), unshipped: sx(r.shipmonkReal.unshipped), onhold: sx(r.shipmonkReal.onhold), missing: sx(r.shipmonkReal.missing), packages: sx(r.shipmonkReal.packages), packagingUnits: sx(r.shipmonkReal.packagingUnits), packagingItems: r.shipmonkReal.packagingItems ? scaleDeep(r.shipmonkReal.packagingItems, f) : null, boxShare: f});
      } else m.shipmonkReal = F.shopify>=1 ? r.shipmonkReal : (F.shopify<=0 ? Object.assign({}, r.shipmonkReal, {orders:0, units:0, shipping:0, packaging:0, pickPack:0, total:0, shipped:0, unshipped:0, onhold:0, missing:0, packages:0, packagingUnits:0, packagingItems:null, boxShare:0}) : Object.assign(scaleDeep(r.shipmonkReal, F.shopify), {boxShare: F.shopify}));
    }
    // the invoice's order-level items (postage true-up, credits, packaging purchases) belong to the D2C store like the
    // take-rate card says; warehousing / receiving / returns stay shared and are allocated inside aggregate()
    if(r.shipmonkInv && F.shopify<1){ const f = F.shopify; m.shipmonkInv = Object.assign({}, r.shipmonkInv, {adjustments: r.shipmonkInv.adjustments*f, credits: r.shipmonkInv.credits*f, packaging_purchases: r.shipmonkInv.packaging_purchases*f, cmpOk: f>0 && r.shipmonkInv.cmpOk, cmpInv: (r.shipmonkInv.cmpInv||0)*f, cmpApi: (r.shipmonkInv.cmpApi||0)*f, trueUp: (r.shipmonkInv.trueUp||0)*f, shipping: (r.shipmonkInv.shipping||0)*f}); }
    // per-SKU data is exact for the selection (market bucket, then the product line's SKUs); funnel counters scale
    if(r.sku){
      m.sku = {};
      CH_KEYS.forEach(k=>{ const d = r.sku[k]; if(!d || F[k]<=0) return; let src = d;
        if(FILTER.market!=='all'){ const b = r.markets && r.markets[k] && r.markets[k][FILTER.market]; src = b ? {units: b.sku_units||{}, sales: b.sku_sales||{}, refunds: b.sku_refund_units||{}} : {units:{}, sales:{}, refunds:{}}; }
        if(FILTER.product!=='all'){ const pick = o => { const out = {}; Object.entries(o||{}).forEach(([s,v])=>{ if(productLineOf(s)===FILTER.product) out[s] = v; }); return out; }; src = {units: pick(src.units), sales: pick(src.sales), refunds: pick(src.refunds)}; }
        m.sku[k] = src; });
    }
    if(r.funnel){ m.funnel = {}; CH_KEYS.forEach(k=>{ const f = r.funnel[k]; if(!f || F[k]<=0) return; m.funnel[k] = F[k]>=1 ? f : scaleDeep(f, F[k]); }); }
    _maskCache.set(r, {ver:_maskVer, row:m});
    return m;
  }
  // human label of the active selection (channel · market · product)
  const chMaskLabel = () => CH_KEYS.filter(k=> CH_MASK[k] && (!_chAvail || _chAvail.includes(k))).map(k=>CH_LABEL[k]).join(' + ');   // V11.3: channels listed one by one
  const maskLabel = (o) => { const p = []; if(chPartial()) p.push(chMaskLabel()); if(o && o.chOnly) return p.join(''); if(FILTER.market!=='all') p.push(marketLabel(FILTER.market)); if(FILTER.product!=='all') p.push(productLineName(FILTER.product)); return p.join(' · '); };

  // ---------- aggregate ----------
  function aggregate(rowsIn){
    const partial = maskPartial();
    const rows = partial ? rowsIn.map(maskRow) : rowsIn;
    const n = rows.length || 1;
    const unknownDays = partial ? rows.filter(r=>r._unknown).length : 0;
    const gross = {}; CH_KEYS.forEach(k=>gross[k]=sum(rows.map(r=>r.channels[k])));
    const refund = {}; CH_KEYS.forEach(k=>refund[k]=sum(rows.map(r=>r.refunds[k])));
    const discountBy = {}; CH_KEYS.forEach(k=>discountBy[k]=sum(rows.map(r=>r.discounts[k])));
    const orders = {}; CH_KEYS.forEach(k=>orders[k]=sum(rows.map(r=>r.orders[k])));
    const ads = {}; AD_KEYS.forEach(k=>ads[k]=sum(rows.map(r=>r.ads[k])));
    const adsAttr = {}; AD_KEYS.forEach(k=>adsAttr[k]=sum(rows.map(r=>r.adsAttr[k])));

    const grossSales = sum(CH_KEYS.map(k=>gross[k]));
    const discount = sum(rows.map(r=>sum(CH_KEYS.map(k=>r.discounts[k]))));
    const refundsTotal = sum(CH_KEYS.map(k=>refund[k]));
    const netRevenue = grossSales - discount - refundsTotal;
    const totalOrders = sum(CH_KEYS.map(k=>orders[k]));
    // V8 channel filter: the selected channels' share of the period's net revenue = allocation key for shared costs
    let allocShare = 1;
    if(partial){ const fullNet = sum(rowsIn.map(r=> sum(CH_KEYS.map(k=> r.channels[k] - r.discounts[k] - r.refunds[k])))); allocShare = fullNet>0.005 ? Math.min(1, Math.max(0, netRevenue)/fullNet) : 0; }

    // ---- Amazon: use real SP-API Finances fees on days we have them, estimate the rest ----
    let amazonOrdersReal=0, amazonOrdersEst=0, amazonRevenueEst=0;
    let amazonFbaFeesReal=0, amazonReferralFeesReal=0, amazonServiceFeesReal=0, amazonInboundFreightReal=0, amazonOtherFeesReal=0, amazonOtherNetReal=0;
    let amazonStorageAlloc=0, amazonStorageMissingDays=0, amazonStoragePosted=0, amazonRefundFeeAdj=0, amazonFeeOrderedDays=0;
    let amazonStorageReportDays=0, amazonStorageEstDays=0, amazonStorageEstAmt=0;
    let amazonFeeEstDays=0, amazonRefEst=0, amazonFbaEst=0, amazonPendSkuDays=0, amazonPendUnits=0;
    rows.forEach(r=>{
      if(r.amazonReal){
        amazonOrdersReal += r.orders.amazon;
        amazonFbaFeesReal += r.amazonReal.fbaFees;
        amazonReferralFeesReal += r.amazonReal.referralFees;
        amazonServiceFeesReal += r.amazonReal.serviceFees;
        amazonInboundFreightReal += r.amazonReal.inboundFreight || 0;
        amazonOtherFeesReal += r.amazonReal.otherFees || 0;
        amazonOtherNetReal += r.amazonReal.otherNet;
        amazonStorageAlloc += r.amazonReal.storageAlloc || 0;
        if(r.amazonReal.storageSrc==='report') amazonStorageReportDays++;
        if(r.amazonReal.storageSrc==='estimate'){ amazonStorageEstDays++; amazonStorageEstAmt += (r.amazonReal.storageAlloc||0); }
        amazonStoragePosted += r.amazonReal.storagePosted || 0;
        amazonRefundFeeAdj += r.amazonReal.refundFeeAdj || 0;
        if(r.amazonReal.feeBasisOrdered){ amazonFeeOrderedDays++; if(!r.amazonReal.storageKnown) amazonStorageMissingDays++; }
        if(r.amazonReal.feeEstimated){ amazonFeeEstDays++; amazonRefEst += r.amazonReal.refEst; amazonFbaEst += r.amazonReal.fbaEst; }
        if(r.amazonReal.pendKnown){ amazonPendSkuDays++; amazonPendUnits += r.amazonReal.pendUnits; }
      } else {
        amazonOrdersEst += r.orders.amazon;
        amazonRevenueEst += r.channels.amazon;
      }
    });
    // NOTE: amazonServiceFeesReal reads 0 while the Finances API returns no ServiceFee events
    // for this account/window (subscription + FBA storage). Net profit is overstated by that
    // amount on real-data days until the sync's diagnostics show where those fees land.

    // No estimates: product cost (needs COGS per SKU) stays $0 until its source is connected.
    // ShipMonk (3PL for the Shopify + Amazon FBM orders) supplies postage, pick & pack and
    // packaging per order, booked on the ORDER date - shipped or not (ShipMonk's own estimate,
    // refreshed as orders ship) - so every order's revenue and fulfillment cost land on the same
    // day. Amazon's own FBAPerUnitFulfillmentFee (pick/pack + ship, real) covers the FBA orders.
    // Product cost: an ESTIMATE (net revenue x rate from data/targets_monthly.json) until COGS per SKU is connected; $0 when no rate.
    const cogsEstRate = (COGS_EST && COGS_EST.rate>0) ? COGS_EST.rate : 0;
    const pc = productCostFor(rows, cogsEstRate);
    const productCost = pc.total;
    const productCostBy = pc.by;
    const productCostEst = pc.anyEst;              // some (or all) of it is the % estimate
    const productCostActual = pc.actual;           // the part that comes from the accountant's book
    const productCostEstAmount = pc.estimated;
    const productCostHasActual = pc.anyActual;
    // V11: FIFO by receipt lot (Notion) + nearest-lot / per-SKU fallback; units split for the labels
    const productCostLots = pc.lots, productCostFallback = pc.fallback, productCostHasLots = (pc.lots + pc.fallback) > 0.005;
    const productCostLotUnits = pc.lotUnits, productCostFbUnits = pc.fbUnits, productCostEstUnits = pc.estUnits, productCostUnits = pc.units;
    const shipmonkRealDays = rows.filter(r=>r.shipmonkReal).length;
    const shipmonkOrders = sum(rows.map(r=> r.shipmonkReal ? r.shipmonkReal.orders : 0));
    const shipmonkUnshipped = sum(rows.map(r=> r.shipmonkReal ? r.shipmonkReal.unshipped : 0));
    const shipmonkUnits = sum(rows.map(r=> r.shipmonkReal ? r.shipmonkReal.units : 0));
    const shipmonkPickPack = sum(rows.map(r=> r.shipmonkReal ? r.shipmonkReal.pickPack : 0));
    const packaging = sum(rows.map(r=> r.shipmonkReal ? r.shipmonkReal.packaging : 0));
    const postage = sum(rows.map(r=> r.shipmonkReal ? r.shipmonkReal.shipping : 0));
    // per ShipMonk store (= sales channel: the Shopify store vs the Amazon FBM store)
    const shipmonkByStore = {};
    rows.forEach(r=>{
      if(!r.shipmonkReal) return;
      const bs = r.shipmonkReal.byStore || {};
      Object.keys(bs).forEach(k=>{
        const t = shipmonkByStore[k] = shipmonkByStore[k] || {orders:0, units:0, shipping:0, packaging:0, pickPack:0, total:0};
        t.orders += bs[k].orders||0; t.units += bs[k].units||0;
        t.shipping += bs[k].shipping_cost||0; t.packaging += bs[k].packaging_cost||0; t.pickPack += bs[k].pick_pack_cost||0; t.total += bs[k].total_cost||0;
      });
    });
    // ShipMonk per-order cost by sales channel (store name -> channel) for the take-rate card: the Amazon FBM store,
    // the Walmart store, everything else (the Shopify store + manual orders) = D2C.
    const shipmonkByChannel = {shopify:0, amazon:0, walmart:0, tiktok:0};
    Object.entries(shipmonkByStore).forEach(([k,v])=>{ const ch = /amazon/i.test(k) ? 'amazon' : /walmart/i.test(k) ? 'walmart' : /tiktok/i.test(k) ? 'tiktok' : 'shopify'; shipmonkByChannel[ch] += v.total; });
    const nonAmazonOrders = orders.shopify + orders.walmart + orders.tiktok;
    const fulfillment = amazonFbaFeesReal;
    // Inbound freight/duty into FBA is landed inventory cost -> COGS. It is booked on the day
    // Amazon invoices it (cash view), so single days can spike; read it on the month view.
    // ShipMonk invoices: everything the per-order estimates do not contain, prorated per day over each
    // semi-monthly billing period. 'shipping' on the invoice is only used to true-up the API estimates.
    const invRows = rows.filter(r=>r.shipmonkInv);
    const smInvDays = invRows.length;
    const smInv = {storage:0, receiving:0, returns:0, packaging_purchases:0, fees_other:0, adjustments:0, credits:0, unallocated:0, shipping:0, total:0};
    invRows.forEach(r=>{ Object.keys(smInv).forEach(k=>{ smInv[k] += r.shipmonkInv[k]||0; }); });
    if(partial) ['storage','receiving','returns','fees_other','unallocated'].forEach(k=>{ smInv[k] *= allocShare; });   // shared warehousing -> allocated
    const smInvOther = smInv.fees_other + smInv.unallocated;                 // minimum fee, late fees, audits + what ShipMonk's sections don't allocate
    const smInvAdjCredits = smInv.adjustments + smInv.credits;               // carrier adjustments + credits (usually negative = money back)
    // true-up: invoiced postage + pick&pack vs the API's estimate, per billing period (precomputed per day in applyShipmonkInvoiceRows)
    let smInvShipCmp = 0, smApiShipCmp = 0, smCmpDays = 0, smTrueUp = 0;
    invRows.forEach(r=>{ if(r.shipmonkInv.cmpOk){ smCmpDays++; smInvShipCmp += r.shipmonkInv.cmpInv; smApiShipCmp += r.shipmonkInv.cmpApi; smTrueUp += r.shipmonkInv.trueUp; } });
    const smCmpMissingDays = smInvDays - smCmpDays;
    // V11.1: shipping boxes. ShipMonk picks one box per package and lists it on the order (sync v1.5+ packaging_items),
    // so the boxes are expensed as USED - FIFO over the Notion box lots, like the products (GAAP ASC 330: packaging
    // supplies are inventory until consumed). Days that carry that data drop the invoice's "custom packaging" purchases
    // (the same boxes, bought earlier - expensing both would count them twice); days before the v1.5 backfill keep the
    // purchase line. The purchases dropped are shown as a memo so cash can still be followed.
    const FX = fifoState();
    let boxCost = 0, boxLots = 0, boxFb = 0, boxUnits = 0, boxLotUnits = 0, boxFbUnits = 0, boxEstUnits = 0, boxDays = 0, smPackagingMemo = 0;
    const boxBySku = {};
    let boxEstDays = 0, boxEstBoxes = 0, boxEstCost = 0;   // V11.2: days where the boxes are an estimate (1 per package)
    rows.forEach(r=>{
      const sr = r.shipmonkReal; if(!sr) return;
      const bd = FX && FX.ok && FX.day[r.iso] && FX.day[r.iso].box;
      if(!sr.packagingItems && !(bd && bd.est)) return;
      boxDays++;
      if(r.shipmonkInv) smPackagingMemo += r.shipmonkInv.packaging_purchases||0;
      if(!bd) return;
      const f = (sr.boxShare===undefined || sr.boxShare===null) ? 1 : sr.boxShare;
      if(bd.est){ boxEstDays++; boxEstBoxes += bd.units*f; boxEstCost += (bd.lot+bd.fb)*f; }
      boxCost += (bd.lot+bd.fb)*f; boxLots += bd.lot*f; boxFb += bd.fb*f; boxUnits += bd.units*f; boxLotUnits += bd.lotU*f; boxFbUnits += bd.fbU*f; boxEstUnits += bd.estU*f;
      Object.keys(bd.c).forEach(x=>{ const t = boxBySku[x] = boxBySku[x] || {n:0, cost:0, est:0}; t.n += bd.c[x].n*f; t.cost += (bd.c[x].lot+bd.c[x].fb)*f; t.est += bd.c[x].estU*f; });
    });
    const boxMode = boxDays>0;
    smInv.packaging_purchases -= smPackagingMemo;   // what is left = purchases on days without the per-package data (still expensed)
    // Invoice items that belong with the per-order shipping cost stay in COGS (true-up, credits); warehousing,
    // receiving, returns handling are operating logistics costs (OpEx), not cost of the order.
    const shipmonkInvoiceExtras = smInvAdjCredits + smTrueUp + smInv.packaging_purchases + boxCost;   // packaging material = COGS: boxes used (FIFO) + purchases on days without box data
    // Storage for days without an invoice yet (open billing period + today): the daily report / carry-forward estimate
    let smStorageOpen = 0, smStorageOpenDays = 0, smStorageCarryDays = 0, smStorageReportDays = 0;
    rows.forEach(r=>{
      if(r.shipmonkInv){ if(r.shipmonkInv.storageSrc==='report') smStorageReportDays++; return; }
      if(r.shipmonkStorage){ smStorageOpen += r.shipmonkStorage.inv; smStorageOpenDays++; if(r.shipmonkStorage.src==='carry') smStorageCarryDays++; }
    });
    if(partial) smStorageOpen *= allocShare;
    smInv.storage += smStorageOpen;
    const shipmonkLogistics = smInv.storage + smInv.receiving + smInv.returns + smInvOther;
    // Inbound freight/duty into FBA is capitalised into inventory (landed cost -> product COGS per SKU),
    // so it is shown as a memo line only and NOT expensed here (user rule 2026-09-20).
    const cogs = productCost + packaging + fulfillment + shipmonkPickPack + postage + shipmonkInvoiceExtras;
    const grossProfit = netRevenue - cogs;

    // Shopify Payments processing fees (sync v1.7+): real per transaction, on the order day.
    // PayPal / gift-card / manual orders expose no fee in Shopify -> $0 until PayPal is connected.
    const feeDays = rows.filter(r=> r.shopifyReal && r.shopifyReal.paymentFees !== null);
    const paymentFeeDays = feeDays.length;
    const paymentFees = sum(feeDays.map(r=>r.shopifyReal.paymentFees));
    const paymentFeeOrders = sum(feeDays.map(r=>r.shopifyReal.paymentFeesOrders));
    const feesMissingOrders = sum(feeDays.map(r=>r.shopifyReal.feesMissingOrders));
    const gatewayMix = {};
    feeDays.forEach(r=>{ Object.entries(r.shopifyReal.gateways).forEach(([g,v])=>{ const t = gatewayMix[g] = gatewayMix[g] || {orders:0, amount:0}; t.orders += v.orders||0; t.amount += v.amount||0; }); });
    const feeTypeMix = {};
    feeDays.forEach(r=>{ Object.entries(r.shopifyReal.feeTypes).forEach(([k,v])=>{ feeTypeMix[k] = (feeTypeMix[k]||0) + (parseFloat(v)||0); }); });
    // PayPal fees (sync data/paypal.json): fee_amount per transaction on the transaction day
    const paypalDays = rows.filter(r=>r.paypalReal).length;
    const paypalFees = sum(rows.map(r=> r.paypalReal ? r.paypalReal.fees : 0));
    const paypalPayments = sum(rows.map(r=> r.paypalReal ? r.paypalReal.payments : 0));
    const paypalPaymentsCount = sum(rows.map(r=> r.paypalReal ? r.paypalReal.paymentsCount : 0));
    // Afterpay (estimate): gateways named afterpay / clearpay
    let afterpayAmount = 0, afterpayOrders = 0;
    Object.entries(gatewayMix).forEach(([g,v])=>{ if(/afterpay|clearpay/i.test(g)){ afterpayAmount += v.amount||0; afterpayOrders += v.orders||0; } });
    const afterpayFees = afterpayAmount*AFTERPAY_FEE.pct + afterpayOrders*AFTERPAY_FEE.fixed;
    const paymentFeesAll = paymentFees + paypalFees + afterpayFees;
    // Cross-check PayPal against Shopify on the days both are live: Shopify's "paypal" gateway
    // captures vs PayPal's own payments. The gap = PayPal payments on cancelled / non-Shopify orders.
    const ppCmpDays = feeDays.filter(r=>r.paypalReal);
    const paypalCompare = ppCmpDays.length ? {
      days: ppCmpDays.length,
      shopify: sum(ppCmpDays.map(r=> (r.shopifyReal.gateways.paypal||{}).amount||0)),
      shopifyOrders: sum(ppCmpDays.map(r=> (r.shopifyReal.gateways.paypal||{}).orders||0)),
      paypal: sum(ppCmpDays.map(r=> r.paypalReal.payments)),
      paypalCount: sum(ppCmpDays.map(r=> r.paypalReal.paymentsCount)),
    } : null;
    const amazonMarketplaceFeesEst = 0;    // Amazon days without SP-API data stay $0 (no estimate)
    const amazonOtherUnclassifiedCost = -amazonOtherNetReal;
    // Per-order selling fees (referral, other per-order fees, adjustments) = marketplace fees; FBA storage and
    // service fees (removal, returns processing, subscription) are logistics / operating costs below the contribution line.
    const amazonMarketplaceFeesReal = amazonReferralFeesReal + amazonOtherFeesReal + amazonOtherUnclassifiedCost;
    const amazonLogistics = amazonServiceFeesReal + amazonStorageAlloc;
    // Walmart: commission real for reconciled orders + estimate for the rest; non-order service fees too; Walmart ads -> marketing.
    const walmartRows = rows.filter(r=>r.walmartReal);
    const walmartDays = walmartRows.length;
    const wk = k => sum(walmartRows.map(r=>r.walmartReal[k]||0));
    const walmartFeesEst = wk('commissionEst');
    const walmartFees = wk('commissionReal') + walmartFeesEst + wk('otherReal');
    const walmartAds = wk('adsReal');
    const walmartSettledOrders = wk('settledOrders'), walmartUnsettledOrders = wk('unsettledOrders');
    // TikTok Shop: selling fees (referral, refund admin) real for settled orders + estimate for unsettled ones;
    // creator/affiliate commission and Smart Promotion (in-marketplace advertising) go to marketing.
    const tiktokRows = rows.filter(r=>r.tiktokReal);
    const tiktokDays = tiktokRows.length;
    const tk = k => sum(tiktokRows.map(r=>r.tiktokReal[k]||0));
    const tiktokFeesEstSelling = tk('sellingEst');
    const tiktokFees = tk('sellingReal') + tiktokFeesEstSelling;
    const tiktokAffiliateEst = tk('affiliateEst'), tiktokSmartEst = tk('smartEst');
    const tiktokAffiliate = tk('affiliateReal') + tiktokAffiliateEst;
    const tiktokSmart = tk('smartReal') + tiktokSmartEst;
    const tiktokSettledOrders = tk('settledOrders'), tiktokUnsettledOrders = tk('unsettledOrders'), tiktokNetUnsettled = tk('netUnsettled');
    const marketplaceFees = amazonMarketplaceFeesEst + amazonMarketplaceFeesReal + walmartFees + tiktokFees;
    const adSpend = sum(AD_KEYS.map(k=>ads[k]));
    // Snowball influencer/affiliate commissions - only from real Shopify sync data (no
    // seeded estimate: the line is hidden until data/shopify_pnl.json is baked in).
    const snowballRealDays = rows.filter(r=>r.snowballReal).length;
    const snowballOrders = sum(rows.map(r=> r.snowballReal ? r.snowballReal.orders : 0));
    const snowballRevenue = sum(rows.map(r=> r.snowballReal ? r.snowballReal.revenue : 0));
    const snowballCommission = sum(rows.map(r=> r.snowballReal ? r.snowballReal.commissionNet : 0));
    const feesTotal = paymentFeesAll + marketplaceFees;               // payment gateways + marketplace selling fees
    const marketingTotal = adSpend + snowballCommission + tiktokAffiliate + tiktokSmart + walmartAds;               // paid ads + affiliate commissions
    const otherVarTotal = feesTotal + marketingTotal;
    const cmBeforeMarketing = grossProfit - feesTotal;                 // CM2: what is left to pay for marketing
    const contributionProfit = cmBeforeMarketing - marketingTotal;     // CM3: after marketing

    // Manual monthly OpEx (data/opex_monthly.json) spread per day: G&A keys join the G&A items, the rest sit below EBITDA.
    const opexDays = rows.filter(r=>r.opex).length;
    const opexCarriedDays = 0;   // V11.7: months are no longer carried — open / missing months are estimated
    const opexEstRows = rows.filter(r=>r.opex && r.opex.est);
    const opexEstDays = opexEstRows.length;
    const opexEstMonths = [...new Set(opexEstRows.map(r=>r.opex.month))].sort();
    const opexEstAmount = sum(opexEstRows.map(r=> OPEX_GA_KEYS.reduce((s,k)=> s+(r.opex.vals[k]||0), 0))) * allocShare;
    const opexEstFor = k => { const t = []; opexEstMonths.forEach(m=>{ const x = opexEstText(m,k); if(x && !t.includes(x)) t.push(x); }); return t.join('; '); };
    const opexSum = k => sum(rows.map(r=> r.opex ? (r.opex.vals[k]||0) : 0));
    const opexHas = k => rows.some(r=> r.opex && r.opex.has[k]);
    const opexNote = (opexDays>0 && opexDays<n ? tv(` (${n-opexDays} days before the first entered month = $0)`, ` (${n-opexDays} ngày trước tháng đầu tiên đã nhập = $0)`) : '');
    const gaItems = GA_ITEMS.map(it=>{
      const manualKey = OPEX_GA_KEYS.includes(it.key);
      const entered = manualKey && opexHas(it.key);
      const est = entered && opexEstRows.some(r=>r.opex.has[it.key]), allEst = est && opexEstDays>=opexDays;
      const estT = est ? opexEstFor(it.key) : '';
      return {...it, value: (it.monthly/30*n + (manualKey ? opexSum(it.key) : 0)) * allocShare, manual: entered, est, allEst,
        label: it.label + (entered ? (allEst ? '' : tx('st.manualMonthly')) + (est ? (allEst ? tv(' — estimated',' — tạm tính') : tv(` — ${opexEstDays} days estimated`, ` — ${opexEstDays} ngày tạm tính`)) + (estT ? ': '+estT : '') : '') + opexNote : '')};
    });
    const salaryEntered = !!gaItems.find(it=>it.key==='salary' && it.manual);
    // Klaviyo: real invoices booked per billing cycle (data/klaviyo_invoices.json), spread per day
    const klaviyoCostDays = rows.filter(r=>r.klaviyoCost).length;
    const klaviyoCost = sum(rows.map(r=> r.klaviyoCost ? r.klaviyoCost.cost : 0));
    const klaviyoCostParts = {platform:0, sms:0, upgrades:0, flex:0};
    rows.forEach(r=>{ if(r.klaviyoCost){ Object.keys(klaviyoCostParts).forEach(k=>{ klaviyoCostParts[k] += r.klaviyoCost[k]||0; }); } });
    if(klaviyoCostDays>0){
      gaItems.push({key:'klaviyo', label: tv('Klaviyo — email & SMS (invoiced per 19→18 billing cycle, spread evenly per day)', 'Klaviyo — email & SMS (hoá đơn theo chu kỳ 19→18, chia đều theo ngày)') + (klaviyoCostDays<n ? tv(` — ${n-klaviyoCostDays} days without an invoice yet`, ` — ${n-klaviyoCostDays} ngày chưa có hoá đơn`) : ''), monthly:0, value: klaviyoCost, real:true});
    }
    const gaTotal = sum(gaItems.map(it=>it.value));
    const inventoryHolding = INVENTORY_MONTHLY/30*n*allocShare;
    const logisticsTotal = shipmonkLogistics + amazonLogistics;        // warehousing, receiving, returns handling, FBA storage & service fees
    const fixedTotal = gaTotal + inventoryHolding + logisticsTotal;    // operating costs (OpEx) below the contribution line
    const netProfit = contributionProfit - fixedTotal;                 // operating profit (EBITDA) - the name is historical; KPIs, trend and break-even use it
    // Below EBITDA (manual monthly entries): D&A -> EBIT, interest -> EBT, income tax -> net income.
    const depreciation = opexSum('depreciation')*allocShare, interest = opexSum('interest')*allocShare;
    const depreciationEntered = opexHas('depreciation'), interestEntered = opexHas('interest'), taxEntered = opexHas('income_tax');
    const taxRate = opexMeta ? opexMeta.tax_rate : 0;
    const ebit = netProfit - depreciation;
    const ebt = ebit - interest;
    const taxGiven = rows.some(r=> r.opex && r.opex.given.income_tax);   // 0 entered = no tax, not "estimate it"
    const incomeTaxEstimated = !taxGiven && taxRate>0;
    const incomeTax = taxEntered ? opexSum('income_tax')*allocShare : (incomeTaxEstimated && ebt>0 ? ebt*taxRate : 0);
    const netIncome = ebt - incomeTax;
    const belowEbitdaEntered = depreciationEntered || interestEntered || taxEntered || incomeTaxEstimated;

    const variableTotal = cogs + otherVarTotal;
    const variableRatio = netRevenue>0 ? variableTotal/netRevenue : 0;
    const cmRatio = 1 - variableRatio;
    const breakEvenRevenue = cmRatio>0 ? fixedTotal/cmRatio : Infinity;
    const blendedAOV = totalOrders>0 ? netRevenue/totalOrders : 0;
    const breakEvenOrders = blendedAOV>0 ? breakEvenRevenue/blendedAOV : 0;

    const merSpend = adSpend + walmartAds;   // every paid-ads dollar whose sales are in netRevenue (ad platforms + Walmart Connect)
    const merValue = merSpend>0 ? netRevenue/merSpend : 0;
    const attrRevenueSum = sum(AD_KEYS.map(k=>adsAttr[k]));

    // Meta Ads: how many of the selected days carry real Marketing API numbers
    // (vs. the seeded estimate). Display-only - the spend itself is already in ads.meta.
    const metaAdsRealDays = rows.filter(r=>r.metaReal).length;
    const metaAdsPurchases = sum(rows.map(r=> r.metaReal ? r.metaReal.purchases : 0));
    const googleAdsRealDays = rows.filter(r=>r.googleReal).length;
    const applovinRealDays = rows.filter(r=>r.applovinReal).length;
    const tiktokAdsRealDays = rows.filter(r=>r.tiktokAdsReal).length;
    const tiktokAdsOrders = sum(rows.map(r=> r.tiktokAdsReal ? r.tiktokAdsReal.orders : 0));
    const applovinPurchases = sum(rows.map(r=> r.applovinReal ? r.applovinReal.conversions : 0));
    const googleAdsPurchases = sum(rows.map(r=> r.googleReal ? r.googleReal.conversions : 0));
    const amazonAdsRealDays = rows.filter(r=>r.amazonAdsReal).length;
    const amazonAdsPurchases = sum(rows.map(r=> r.amazonAdsReal ? r.amazonAdsReal.purchases : 0));
    const amazonAdsSplit = {sp:0, sb:0, sd:0, stv:0};
    rows.forEach(r=>{ if(r.amazonAdsReal){ amazonAdsSplit.sp += r.amazonAdsReal.sp; amazonAdsSplit.sb += r.amazonAdsReal.sb; amazonAdsSplit.sd += r.amazonAdsReal.sd; amazonAdsSplit.stv += r.amazonAdsReal.stv; } });
    const amazonAdsConsoleSpend = sum(rows.map(r=> r.amazonAdsReal ? r.amazonAdsReal.consoleSpend : 0));   // SP+SB+SD = console "Total cost"
    const amazonAdsImpressions = sum(rows.map(r=> r.amazonAdsReal ? r.amazonAdsReal.impressions : 0));
    const amazonAdsClicks = sum(rows.map(r=> r.amazonAdsReal ? r.amazonAdsReal.clicks : 0));
    const amazonAdsProvisionalDays = rows.filter(r=> r.amazonAdsReal && r.amazonAdsReal.provisional).length;   // days the Sellerboard export has not reached yet
    const amazonAdsProvisionalAmt = sum(rows.map(r=> (r.amazonAdsReal && r.amazonAdsReal.provisional) ? r.amazonAdsReal.consoleSpend : 0));
    // Amazon-only ratios (definitions as in the Amazon Ads console / Sellerboard): ACOS = ad spend ÷ ad-attributed sales; TACOS = ALL Amazon ad spend ÷ Amazon gross sales of the period
    // Console "Sales" exist only for days pulled from the PPC dashboard -> ROAS / ACOS use the spend of those same days
    // (spend of days without Sales would drag ROAS down for no reason).
    const amazonAdsSalesDays = rows.filter(r=> r.amazonAdsReal && r.amazonAdsReal.hasSales).length;
    const amazonAdsSalesSpend = sum(rows.map(r=> (r.amazonAdsReal && r.amazonAdsReal.hasSales) ? r.amazonAdsReal.consoleSpend : 0));
    const amazonAcos = adsAttr.amazonads>0 ? amazonAdsSalesSpend/adsAttr.amazonads : 0;
    const amazonTacos = gross.amazon>0 ? ads.amazonads/gross.amazon : 0;
    const amazonRoas = amazonAdsSalesSpend>0 ? adsAttr.amazonads/amazonAdsSalesSpend : 0;

    // tax collected net of tax refunded to customers = Shopify Analytics "Taxes"
    const shopifyTax = sum(rows.map(r=> r.shopifyReal ? r.shopifyReal.tax - r.shopifyReal.refundedTax : 0));
    const shopifyRealDays = rows.filter(r=>r.shopifyReal).length;
    const amazonRealDays = rows.filter(r=>r.amazonReal).length;

    return {n, gross, refund, discountBy, orders, ads, adsAttr, grossSales, discount, refundsTotal, netRevenue, totalOrders, allocShare, maskPartial: partial, unknownDays,
      productCost, productCostEst, cogsEstRate, productCostBy, productCostActual, productCostEstAmount, productCostHasActual, productCostLots, productCostFallback, productCostHasLots, productCostLotUnits, productCostFbUnits, productCostEstUnits, productCostUnits, packaging, fulfillment, postage, cogs, grossProfit, nonAmazonOrders, shopifyTax, shopifyRealDays, amazonRealDays,
      boxCost, boxLots, boxFb, boxUnits, boxLotUnits, boxFbUnits, boxEstUnits, boxDays, boxMode, smPackagingMemo, boxBySku, boxEstDays, boxEstBoxes, boxEstCost,
      shipmonkRealDays, shipmonkOrders, shipmonkUnshipped, shipmonkUnits, shipmonkPickPack, shipmonkByStore, shipmonkByChannel,
      smInvDays, smInv, smInvOther, smInvAdjCredits, smStorageOpen, smStorageOpenDays, smStorageCarryDays, smStorageReportDays, smInvShipCmp, smApiShipCmp, smCmpDays, smCmpMissingDays, smTrueUp, shipmonkInvoiceExtras, shipmonkLogistics, amazonLogistics, logisticsTotal, feesTotal, marketingTotal, cmBeforeMarketing,
      paymentFees, afterpayFees, afterpayAmount, afterpayOrders, paymentFeeDays, paymentFeeOrders, feesMissingOrders, gatewayMix, feeTypeMix, paypalDays, paypalFees, paypalPayments, paypalPaymentsCount, paypalCompare, paymentFeesAll, marketplaceFees, adSpend, otherVarTotal, contributionProfit,
      gaItems, gaTotal, inventoryHolding, fixedTotal, netProfit, klaviyoCost, klaviyoCostDays, klaviyoCostParts,
      opexDays, opexCarriedDays, opexEstDays, opexEstMonths, opexEstAmount, opexNote, salaryEntered, depreciation, interest, depreciationEntered, interestEntered, taxEntered, taxRate, ebit, ebt, incomeTax, incomeTaxEstimated, netIncome, belowEbitdaEntered,
      variableTotal, variableRatio, cmRatio, breakEvenRevenue, blendedAOV, breakEvenOrders,
      merValue, merSpend, attrRevenueSum,
      amazonOrdersReal, amazonReferralFeesReal, amazonServiceFeesReal, amazonInboundFreightReal, amazonOtherFeesReal, amazonOtherUnclassifiedCost, amazonMarketplaceFeesReal, amazonMarketplaceFeesEst, walmartFees, walmartDays, walmartFeesEst, walmartAds, walmartSettledOrders, walmartUnsettledOrders, tiktokFees,
      tiktokDays, tiktokFeesEstSelling, tiktokAffiliate, tiktokAffiliateEst, tiktokSmart, tiktokSmartEst, tiktokSettledOrders, tiktokUnsettledOrders, tiktokNetUnsettled,
      amazonStorageAlloc, amazonStorageMissingDays, amazonStoragePosted, amazonStorageReportDays, amazonStorageEstDays, amazonStorageEstAmt, amazonRefundFeeAdj, amazonFeeOrderedDays, amazonFeeEstDays, amazonRefEst, amazonFbaEst, amazonPendSkuDays, amazonPendUnits,
      metaAdsRealDays, metaAdsPurchases, googleAdsRealDays, applovinRealDays, applovinPurchases, tiktokAdsRealDays, tiktokAdsOrders, googleAdsPurchases, amazonAdsRealDays, amazonAdsPurchases, amazonAdsSalesDays, amazonAdsSalesSpend, amazonAdsSplit, amazonAdsConsoleSpend, amazonAdsImpressions, amazonAdsClicks, amazonAcos, amazonTacos, amazonRoas, amazonAdsProvisionalDays, amazonAdsProvisionalAmt,
      snowballRealDays, snowballOrders, snowballRevenue, snowballCommission};
  }

  // ---------- state ----------
  let mode = 'month';
  try{ const m0 = localStorage.getItem('ctu_mode'); if(['day','week','month','range'].includes(m0)) mode = m0; }catch(e){}
  let selDayIdx = TOTAL_DAYS-1;
  let selMonth = MONTHS[MONTHS.length-1];
  let selWeek = WEEKS[WEEKS.length-1];
  let rangeFrom = days[Math.max(0,TOTAL_DAYS-8)].iso, rangeTo = days[TOTAL_DAYS-1].iso;
  const collapsed = {};

  // ---------- V7: two period states. P&L keeps the day / week / month / custom control; every other page uses a
  // Shopify-style picker (presets + "compare to") that drives the same row selection underneath (mode = 'range').
  const PNL_STATE = {mode, selDayIdx, selWeek, selMonth, rangeFrom, rangeTo};
  const EXEC_STATE = {preset:'mtd', from:null, to:null, cmp:'prev'};
  try{ const s0 = JSON.parse(localStorage.getItem('ctu_exec')||'null'); if(s0 && typeof s0==='object'){ if(s0.preset) EXEC_STATE.preset = s0.preset; if(s0.from) EXEC_STATE.from = s0.from; if(s0.to) EXEC_STATE.to = s0.to; if(['prev','year','none'].includes(s0.cmp)) EXEC_STATE.cmp = s0.cmp; } }catch(e){}
  function saveExecState(){ try{ localStorage.setItem('ctu_exec', JSON.stringify(EXEC_STATE)); }catch(e){} }
  const TODAY_ISO = days[TOTAL_DAYS-1].iso, MIN_ISO = days[0].iso;
  const clampIso = iso => iso < MIN_ISO ? MIN_ISO : (iso > TODAY_ISO ? TODAY_ISO : iso);
  function presetRange(key){
    const t = TODAY_ISO, y = shiftIso(t,1);
    const yr = +t.slice(0,4), mo = +t.slice(5,7), ym = t.slice(0,7);
    const prevM = isoDate(new Date(yr, mo-2, 1)).slice(0,7), lastOfPrev = isoDate(new Date(yr, mo-1, 0));
    const q0 = String(Math.floor((mo-1)/3)*3+1).padStart(2,'0');
    const m11 = isoDate(new Date(yr, mo-12, 1)).slice(0,7);
    const dow = (days[TOTAL_DAYS-1].date.getDay()+6)%7;
    const map = {
      today:[t,t], yesterday:[y,y], d7:[shiftIso(y,6),y], d30:[shiftIso(y,29),y], d90:[shiftIso(y,89),y], d365:[shiftIso(y,364),y],
      wtd:[shiftIso(t,dow), t], mtd:[ym+'-01', t], qtd:[yr+'-'+q0+'-01', t], ytd:[yr+'-01-01', t],
      lastm:[prevM+'-01', lastOfPrev], m12:[m11+'-01', t], lasty:[(yr-1)+'-01-01', (yr-1)+'-12-31'],
    };
    const r = map[key]; return r ? [clampIso(r[0]), clampIso(r[1])] : null;
  }
  // V10: labels are looked up at render time (tx 'pr.*' / 'cmp.*') so the picker follows the language toggle
  const PRESET_KEYS = ['today','yesterday','d7','d30','d90','d365','wtd','mtd','qtd','ytd','lastm','m12','lasty'];
  const presetLabel = k => PRESET_KEYS.includes(k) ? tx('pr.'+k) : undefined;
  const CMP_KEYS = ['prev','year','none'];
  const cmpLabel = k => tx('cmp.'+k);
  function execRange(){ if(EXEC_STATE.preset==='custom' && EXEC_STATE.from && EXEC_STATE.to) return [EXEC_STATE.from, EXEC_STATE.to]; return presetRange(EXEC_STATE.preset) || presetRange('mtd'); }
  function applyExecState(){ const r = execRange(); mode = 'range'; rangeFrom = r[0]; rangeTo = r[1]; }
  function savePnlState(){ PNL_STATE.mode = mode; PNL_STATE.selDayIdx = selDayIdx; PNL_STATE.selWeek = selWeek; PNL_STATE.selMonth = selMonth; PNL_STATE.rangeFrom = rangeFrom; PNL_STATE.rangeTo = rangeTo; }
  function applyPnlState(){ mode = PNL_STATE.mode; selDayIdx = PNL_STATE.selDayIdx; selWeek = PNL_STATE.selWeek; selMonth = PNL_STATE.selMonth; rangeFrom = PNL_STATE.rangeFrom; rangeTo = PNL_STATE.rangeTo; [...document.querySelectorAll('#modeSeg button')].forEach(b=>b.classList.toggle('active', b.dataset.mode===mode)); }
  let currentView = 'exec';
  const onPnl = () => currentView==='pnl';
  // a custom range that is exactly "day 1 of a month -> some day of that month" compares like the month mode does
  function monthLikeRange(){ if(mode!=='range') return null; if(rangeFrom.slice(8)!=='01' || rangeTo.slice(0,7)!==rangeFrom.slice(0,7)) return null; return rangeFrom.slice(0,7); }
  function renderShopPicker(){
    const el = document.getElementById('shopPicker'); if(!el) return;
    const r = execRange();
    const f = new Date(+r[0].slice(0,4), +r[0].slice(5,7)-1, +r[0].slice(8,10)), t = new Date(+r[1].slice(0,4), +r[1].slice(5,7)-1, +r[1].slice(8,10));
    const span = r[0]===r[1] ? fmtDateLong(f) : fmtDate(f)+' – '+fmtDateLong(t);
    const items = PRESET_KEYS.map(k=>`<div class="dditem ${EXEC_STATE.preset===k?'active':''}" data-preset="${k}">${presetLabel(k)}</div>`).join('');
    el.innerHTML = `<div class="dd" id="ddRange"><button class="ddbtn" type="button" title="${tx('cmp.pickRange')}"><span>${presetLabel(EXEC_STATE.preset)||tx('pr.custom')}</span><span class="k">${span}</span><span class="caret">▾</span></button><div class="ddpanel"><div class="ddlist">${items}</div><div class="ddcustom">${tx('pr.custom')} <input type="date" id="exFrom" value="${r[0]}" min="${MIN_ISO}" max="${TODAY_ISO}"> – <input type="date" id="exTo" value="${r[1]}" min="${MIN_ISO}" max="${TODAY_ISO}"> <button class="btn mini" id="exApply" type="button" style="margin-left:0;">${tx('cmp.view')}</button></div></div></div>`
      + `<div class="dd" id="ddCmp"><button class="ddbtn" type="button" title="${tx('cmp.pickCmp')}"><span class="k">${tx('cmp.vs')}</span><span>${cmpLabel(EXEC_STATE.cmp)}</span><span class="caret">▾</span></button><div class="ddpanel" style="min-width:200px;"><div class="ddlist" style="grid-template-columns:1fr;">${CMP_KEYS.map(k=>`<div class="dditem ${EXEC_STATE.cmp===k?'active':''}" data-cmp="${k}">${cmpLabel(k)}</div>`).join('')}</div></div></div>`;
    const closeAll = () => el.querySelectorAll('.dd').forEach(d=>d.classList.remove('open'));
    el.querySelectorAll('.dd > .ddbtn').forEach(b=>b.addEventListener('click', (e)=>{ e.stopPropagation(); const dd = b.parentElement, open = dd.classList.contains('open'); closeAll(); if(!open) dd.classList.add('open'); }));
    el.querySelectorAll('.ddpanel').forEach(pn=>pn.addEventListener('click', e=>e.stopPropagation()));
    el.querySelectorAll('[data-preset]').forEach(i=>i.addEventListener('click', ()=>{ EXEC_STATE.preset = i.dataset.preset; EXEC_STATE.from = null; EXEC_STATE.to = null; saveExecState(); applyExecState(); closeAll(); renderAll(); }));
    el.querySelectorAll('[data-cmp]').forEach(i=>i.addEventListener('click', ()=>{ EXEC_STATE.cmp = i.dataset.cmp; saveExecState(); closeAll(); renderAll(); }));
    const ap = document.getElementById('exApply'); if(ap) ap.addEventListener('click', ()=>{ const f0 = document.getElementById('exFrom').value, t0 = document.getElementById('exTo').value; if(f0 && t0 && f0<=t0){ EXEC_STATE.preset = 'custom'; EXEC_STATE.from = clampIso(f0); EXEC_STATE.to = clampIso(t0); saveExecState(); applyExecState(); closeAll(); renderAll(); } });
  }
  document.addEventListener('click', ()=>{ document.querySelectorAll('#shopPicker .dd.open').forEach(d=>d.classList.remove('open')); });

  function currentRows(){
    if(mode==='day') return [days[selDayIdx]];
    if(mode==='week') return weekMap[selWeek];
    if(mode==='month') return monthMap[selMonth];
    return days.filter(d=> d.iso>=rangeFrom && d.iso<=rangeTo);
  }
  function previousRows(){
    if(mode==='day') return selDayIdx>0 ? [days[selDayIdx-1]] : null;
    if(mode==='week'){ const idx = WEEKS.indexOf(selWeek); return idx>0 ? weekMap[WEEKS[idx-1]] : null; }
    if(mode==='month'){ const idx = MONTHS.indexOf(selMonth); return idx>0 ? monthMap[MONTHS[idx-1]] : null; }
    const cur = currentRows(); const len = cur.length;
    const firstIdx = days.findIndex(d=>d.iso===rangeFrom);
    if(firstIdx<=0) return null;
    return days.slice(Math.max(0,firstIdx-len), firstIdx);
  }

  // ---------- sub-controls per mode ----------
  // V10: Market · Product · Channel dropdowns (every page) + the "filtered" banner
  let _chAvail = null;
  function renderFilterBar(){
    const el = document.getElementById('filterBar'); if(!el) return;
    if(!_chAvail) _chAvail = CH_KEYS.filter(k=> days.some(r=> r.channels[k]>0));
    const chTxt = chPartial() ? maskLabel({chOnly:true}) : tx('f.allChannels');
    const dd = (id, label, value, items, extra) => `<div class="dd fdd" id="${id}"><button class="ddbtn" type="button"><span class="k">${label}</span><span class="v">${value}</span><span class="caret">▾</span></button><div class="ddpanel"><div class="ddlist one">${items}</div>${extra||''}</div></div>`;
    const mkItems = ['all'].concat(marketsAvailable()).map(cc=>`<div class="dditem ${FILTER.market===cc?'active':''}" data-market="${cc}">${marketLabel(cc)}${cc!=='all' && cc!=='US' ? '' : ''}</div>`).join('');
    const plItems = ['all'].concat(productLinesAvailable()).map(id=>`<div class="dditem ${FILTER.product===id?'active':''}" data-product="${id}">${productLineName(id)}</div>`).join('');
    // V11.3: one entry per channel (Shopify, TikTok Shop, Amazon, Walmart); the reporting groups are only used for plans / pacing
    const chItems = `<div class="dditem ${chPartial()?'':'active'}" data-ch="all">${tx('f.allChannels')}</div>` + CH_KEYS.filter(k=>_chAvail.includes(k)).map(k=>`<div class="dditem chk ${CH_MASK[k]?'on':''}" data-ch="${k}"><span class="box">${CH_MASK[k]?'✓':''}</span>${CH_LABEL[k]}</div>`).join('');
    el.innerHTML = dd('ddMarket', tx('f.market'), marketLabel(FILTER.market), mkItems) + dd('ddProduct', tx('f.product'), productLineName(FILTER.product), plItems) + dd('ddChannel', tx('f.channel'), chTxt, chItems);
    const closeAll = () => document.querySelectorAll('.dd.open').forEach(d=>d.classList.remove('open'));
    el.querySelectorAll('.dd > .ddbtn').forEach(b=>b.addEventListener('click', (e)=>{ e.stopPropagation(); const d = b.parentElement, open = d.classList.contains('open'); closeAll(); if(!open) d.classList.add('open'); }));
    el.querySelectorAll('.ddpanel').forEach(pn=>pn.addEventListener('click', e=>e.stopPropagation()));
    el.querySelectorAll('[data-market]').forEach(i=>i.addEventListener('click', ()=>{ setFilter({market: i.dataset.market}); closeAll(); renderAll(); }));
    el.querySelectorAll('[data-product]').forEach(i=>i.addEventListener('click', ()=>{ setFilter({product: i.dataset.product}); closeAll(); renderAll(); }));
    el.querySelectorAll('[data-ch]').forEach(i=>i.addEventListener('click', ()=>{
      const k = i.dataset.ch, next = {...CH_MASK};
      if(k==='all') CH_KEYS.forEach(x=>next[x]=true);
      else { next[k] = !next[k]; if(!CH_KEYS.some(x=>next[x])) CH_KEYS.forEach(x=>next[x]=true); }
      setChannelMask(next); renderAll();
    }));
    renderFilterBanner();
  }
  function renderFilterBanner(){
    const bn = document.getElementById('chBanner'), tx_ = document.getElementById('chBannerTxt'); if(!bn) return;
    const partial = maskPartial(); bn.hidden = !partial; if(!partial || !tx_) return;
    const a = aggregate(currentRows());
    const parts = [];
    if(chPartial()) parts.push(tx('f.bn.channel', {ch: chMaskLabel()}));
    if(FILTER.market!=='all') parts.push(tx('f.bn.market', {m: marketLabel(FILTER.market)}));
    if(FILTER.product!=='all') parts.push(tx('f.bn.product', {p: productLineName(FILTER.product)}));
    let note = tx('f.bn.alloc', {pct: (a.allocShare*100).toFixed(0)});
    if(a.unknownDays>0) note += ' ' + tx('f.bn.unknown', {n: a.unknownDays, of: a.n});
    if(FILTER.product!=='all') note += ' ' + tx('f.bn.productNote');
    tx_.innerHTML = '<b>'+parts.join(' · ')+'.</b> '+note+' <a href="#" id="chClear">'+tx('f.bn.clear')+'</a>';
    const cl = document.getElementById('chClear'); if(cl) cl.addEventListener('click', (e)=>{ e.preventDefault(); const next = {}; CH_KEYS.forEach(x=>next[x]=true); setChannelMask(next); setFilter({market:'all', product:'all'}); renderAll(); });
  }
  document.addEventListener('click', ()=>{ document.querySelectorAll('.dd.open').forEach(d=>d.classList.remove('open')); });
  function renderSubCtl(){
    renderFilterBar();
    const el = document.getElementById('subCtl');
    const seg = document.getElementById('modeSeg'), sp = document.getElementById('shopPicker');
    if(!onPnl()){ if(seg) seg.hidden = true; el.hidden = true; if(sp){ sp.hidden = false; renderShopPicker(); } return; }
    if(seg) seg.hidden = false; el.hidden = false; if(sp) sp.hidden = true;
    if(mode==='day'){
      let html = '<div class="chips">';
      for(let i=TOTAL_DAYS-7;i<TOTAL_DAYS;i++){
        const d = days[i].date;
        html += `<div class="chip ${i===selDayIdx?'active':''}" data-idx="${i}"><span class="dow">${DOW[d.getDay()]}</span>${fmtDate(d)}</div>`;
      }
      html += '</div>';
      html += `<input type="date" id="dayPick" value="${days[selDayIdx].iso}" min="${days[0].iso}" max="${days[TOTAL_DAYS-1].iso}" title="${tv('Pick any day in the history', 'Chọn ngày bất kỳ trong lịch sử')}">`;
      el.innerHTML = html;
      el.querySelectorAll('.chip').forEach(c=>c.addEventListener('click', ()=>{ selDayIdx = parseInt(c.dataset.idx,10); renderAll(); }));
      document.getElementById('dayPick').addEventListener('change', (e)=>{ const idx = days.findIndex(d=>d.iso===e.target.value); if(idx>=0){ selDayIdx = idx; renderAll(); } });
    } else if(mode==='week'){
      const idx = WEEKS.indexOf(selWeek);
      let html = `<button class="chip" id="weekPrev" ${idx<=0?'disabled':''} title="${tv('Previous week', 'Tuần trước')}">‹</button><select id="weekSel">`+WEEKS.map(w=>`<option value="${w}" ${w===selWeek?'selected':''}>${WEEK_LABEL(w)}</option>`).join('')+`</select><button class="chip" id="weekNext" ${idx>=WEEKS.length-1?'disabled':''} title="${tv('Next week', 'Tuần sau')}">›</button>`;
      el.innerHTML = html;
      document.getElementById('weekSel').addEventListener('change', (e)=>{ selWeek = e.target.value; renderAll(); });
      document.getElementById('weekPrev').addEventListener('click', ()=>{ const i = WEEKS.indexOf(selWeek); if(i>0){ selWeek = WEEKS[i-1]; renderAll(); } });
      document.getElementById('weekNext').addEventListener('click', ()=>{ const i = WEEKS.indexOf(selWeek); if(i<WEEKS.length-1){ selWeek = WEEKS[i+1]; renderAll(); } });
    } else if(mode==='month'){
      let html = '<select id="monthSel">'+MONTHS.map(m=>`<option value="${m}" ${m===selMonth?'selected':''}>${MONTH_LABEL(m)}</option>`).join('')+'</select>';
      el.innerHTML = html;
      document.getElementById('monthSel').addEventListener('change', (e)=>{ selMonth = e.target.value; renderAll(); });
    } else {
      const min = days[0].iso, max = days[TOTAL_DAYS-1].iso;
      // presets: trailing 30/90 days, every calendar year in the data, quarters of the latest year
      const presets = [
        {label: tv('30 days', '30 ngày'), from: days[Math.max(0,TOTAL_DAYS-30)].iso, to: max},
        {label: tv('90 days', '90 ngày'), from: days[Math.max(0,TOTAL_DAYS-90)].iso, to: max},
      ];
      const years = [...new Set(days.map(d=>d.iso.slice(0,4)))];
      years.forEach(y=>{ const f = y+'-01-01', t = y+'-12-31'; presets.push({label: tv('Year '+y, 'Năm '+y), from: f<min?min:f, to: t>max?max:t}); });
      const ly = years[years.length-1];
      [['Q1','01-01','03-31'],['Q2','04-01','06-30'],['Q3','07-01','09-30'],['Q4','10-01','12-31']].forEach(([q,a,b])=>{
        const f = ly+'-'+a, t = ly+'-'+b; if(f<=max && t>=min) presets.push({label:q+' '+ly, from: f<min?min:f, to: t>max?max:t});
      });
      const chips = presets.map(p=>`<div class="chip ${p.from===rangeFrom&&p.to===rangeTo?'active':''}" data-from="${p.from}" data-to="${p.to}">${p.label}</div>`).join('');
      el.innerHTML = `<div class="chips">${chips}</div> ${tv('From', 'Từ')} <input type="date" id="fromD" value="${rangeFrom}" min="${min}" max="${max}"> ${tv('to', 'đến')} <input type="date" id="toD" value="${rangeTo}" min="${min}" max="${max}"> <button class="btn" id="applyRange">${tx('cmp.view')}</button>`;
      el.querySelectorAll('.chip').forEach(c=>c.addEventListener('click', ()=>{ rangeFrom=c.dataset.from; rangeTo=c.dataset.to; renderAll(); }));
      document.getElementById('applyRange').addEventListener('click', ()=>{
        const f = document.getElementById('fromD').value, t = document.getElementById('toD').value;
        if(f && t && f<=t){ rangeFrom=f; rangeTo=t; renderAll(); }
      });
    }
  }

  // ---------- KPI ----------
  function renderKpis(){
    const rows = currentRows();
    const cur = aggregate(rows);
    const prevRows = previousRows();
    let prev = prevRows ? aggregate(prevRows) : null;
    if(prev && prev.netRevenue===0) prev = null;   // period before the synced window = no data
    const items = [
      {label: tx('m.netRevenue'), v:cur.netRevenue, pv:prev&&prev.netRevenue},
      {label: tv('Gross profit', 'Lợi nhuận gộp'), v:cur.grossProfit, pv:prev&&prev.grossProfit},
      {label: tv('Contribution margin (after marketing)', 'LN đóng góp (sau marketing)'), v:cur.contributionProfit, pv:prev&&prev.contributionProfit},
      {label: tv('Operating profit (EBITDA)', 'LN hoạt động (EBITDA)'), v:cur.netProfit, pv:prev&&prev.netProfit},
      {label: tv('EBITDA margin', 'Biên EBITDA'), v: cur.netRevenue? cur.netProfit/cur.netRevenue*100:0, pv: prev&&prev.netRevenue? prev.netProfit/prev.netRevenue*100:null, pct:true},
    ];
    if(cur.belowEbitdaEntered) items.push({label: tv('Net profit (after tax)', 'Lợi nhuận ròng (sau thuế)'), v:cur.netIncome, pv:prev&&prev.netIncome});
    document.getElementById('kpiRow').classList.toggle('six', items.length===6);
    document.getElementById('kpiRow').innerHTML = items.map(it=>{
      let deltaHtml = '<div class="delta flat">'+tv('— no data for the previous period', '— kỳ trước không có dữ liệu')+'</div>';
      if(it.pv!==null && it.pv!==undefined){
        const delta = it.pct ? (it.v-it.pv) : (it.pv!==0? (it.v-it.pv)/Math.abs(it.pv)*100 : 0);
        const up = delta>=0;
        deltaHtml = `<div class="delta ${up?'up':'down'}">${up?'▲':'▼'} ${Math.abs(delta).toFixed(1)}${it.pct?' '+tx('u.pts'):'%'} ${tx('u.vsPrev')}</div>`;
      }
      const valStr = it.pct ? it.v.toFixed(1)+'%' : money(it.v);
      return `<div class="kpi"><div class="label">${it.label}</div><div class="value">${valStr}</div>${deltaHtml}</div>`;
    }).join('');

    const rangeLbl = document.getElementById('rangeLbl');
    const first = rows[0].date, last = rows[rows.length-1].date;
    rangeLbl.textContent = rows.length===1 ? fmtDateLong(first) : (fmtDate(first)+' – '+fmtDateLong(last)+' · '+rows.length+' '+tx('u.days'));

    const banner = document.getElementById('syncBanner');
    banner.style.display = rows.some(r=>r._syncing) ? 'flex' : 'none';
  }

  // ---------- statement ----------
  function stLine(label, value, base, tag, key, extra){ return {t:'line', label, value, pct: base? value/base*100:0, tag, key, extra}; }
  function stSection(label, key){ return {t:'section', label, key}; }
  function stGroup(label, value, base, key){ return {t:'group', label, value, pct: base? value/base*100:0, key}; }   // sub-heading inside a section, with the group's subtotal
  function stSub(label, value, base, key){ return {t:'subtotal', label, value, pct: base? value/base*100:0, key}; }
  function stFinal(label, value, base){ return {t:'final', label, value, pct: base? value/base*100:0}; }

  function buildRows(a){
    const nr = a.netRevenue;
    const rows = [];
    const alloc = a.maskPartial ? tx('st.alloc', {pct: (a.allocShare*100).toFixed(0), sel: maskLabel()}) : '';
    rows.push({...stLine(tv('Gross sales', 'Doanh thu gộp (Gross Sales)'), a.grossSales, nr, null, 'gs'), hget: x=>x.grossSales});
    const chState = k => ({
      unconnected: !!CH_UNCONNECTED[k] || (k==='shopify' && !shopifyMatched) || (k==='amazon' && !amazonMatched),
      liveDays: k==='shopify' ? a.shopifyRealDays : k==='amazon' ? a.amazonRealDays : 0,
    });
    const netBy = k => a.gross[k] - a.discountBy[k] - a.refund[k];
    [...CH_KEYS].sort((x,y)=>a.gross[y]-a.gross[x]).forEach(k=>{
      const {unconnected, liveDays} = chState(k);
      let label = CH_LABEL[k]+' · '+a.orders[k].toLocaleString('en-US')+' '+tx('u.orders');
      if(k==='amazon' && liveDays>0) label += amazonOrderBasisDays>0 ? tv(' (by order date — matches Seller Central)', ' (theo ngày đặt hàng — khớp Seller Central)') : tv(' (by ship date — Finances)', ' (theo ngày ship — Finances)');
      if(!unconnected && liveDays>0 && liveDays<a.n) label += tx('st.outsideSync', {n: a.n-liveDays, d: dayWord(a.n-liveDays)});
      rows.push({...stLine(label, a.gross[k], nr, null, 'gs'), detail:true, gap: unconnected, live: !unconnected && liveDays>0, hget: x=>x.gross[k]});
    });
    rows.push({...stLine(tv('Discounts & promotions', 'Giảm giá & khuyến mãi'), -a.discount, nr, 'var', 'disc'), neg:true, hget: x=>-x.discount});
    CH_KEYS.filter(k=>a.discountBy[k]>0).sort((x,y)=>a.discountBy[y]-a.discountBy[x]).forEach(k=>{
      const note = k==='shopify' ? tv(' — discount codes, automatic discounts, B1G2F… (Shopify Analytics: Discounts)', ' — mã giảm giá, KM tự động, B1G2F… (Shopify Analytics: Discounts)') : k==='amazon' ? tv(' — Amazon promotions', ' — promotions Amazon') : '';
      rows.push({...stLine(CH_LABEL[k]+note, -a.discountBy[k], nr, null, 'disc'), detail:true, neg:true, hget: x=>-x.discountBy[k]});
    });
    rows.push({...stLine(tv('Refunds / returns', 'Hoàn tiền / Trả hàng'), -a.refundsTotal, nr, 'var', 'ref'), neg:true, hget: x=>-x.refundsTotal});
    CH_KEYS.filter(k=>a.refund[k]!==0).sort((x,y)=>a.refund[y]-a.refund[x]).forEach(k=>{
      const note = k==='shopify' ? tv(' — returned goods + extra refunds, on the day Shopify processed the refund (= Returns in Shopify Analytics)', ' — hàng trả + tiền hoàn thêm, theo ngày Shopify xử lý hoàn (= Returns trên Shopify Analytics)') : k==='amazon' ? tv(' — booked on the day Amazon refunded', ' — ghi ngày Amazon hoàn tiền') : '';
      rows.push({...stLine(CH_LABEL[k]+note, -a.refund[k], nr, null, 'ref'), detail:true, neg: a.refund[k]>0, hget: x=>-x.refund[k]});
    });
    rows.push({...stSub(tv('= Net revenue', '= Doanh thu thuần (Net Revenue)'), nr, nr, 'nr'), hget: x=>x.netRevenue});
    // Same split as Gross Sales: each channel's net = its gross - its discounts - its refunds; the four add up to the subtotal.
    [...CH_KEYS].sort((x,y)=>netBy(y)-netBy(x)).forEach(k=>{
      const {unconnected, liveDays} = chState(k);
      let label = CH_LABEL[k]+tv(' — net (gross − discounts − refunds)', ' — thuần (gộp − giảm giá − hoàn tiền)');
      if(k==='shopify' && !unconnected) label = tv('Shopify — net = Net sales in Shopify Analytics', 'Shopify — thuần = Net sales trên Shopify Analytics');
      if(k==='amazon' && !unconnected) label = tv('Amazon — net (selling price − promotions − refunds)', 'Amazon — thuần (giá bán − promotions − hoàn tiền)');
      rows.push({...stLine(label, netBy(k), nr, null, 'nr'), detail:true, gap: unconnected, live: !unconnected && liveDays>0, hget: x=>x.gross[k]-x.discountBy[k]-x.refund[k]});
    });

    rows.push(stSection(tv('Cost of goods sold — COGS (product cost + fulfillment)', 'Giá vốn hàng bán — COGS (giá vốn sản phẩm + fulfillment)'),'cogs'));
    if(a.productCostHasLots){
      // V11: FIFO by receipt lot — the label spells out the mix (lots / nearest-lot or per-SKU cost / accounting book / estimate)
      const U = a.productCostLotUnits + a.productCostFbUnits + a.productCostEstUnits, pu = x => U>0 ? Math.round(x/U*100)+'%' : '—';
      const parts = [tv('FIFO by receipt lot (Notion) ','FIFO theo lô nhập (Notion) ')+money(a.productCostLots,{compact:true})+' · '+pu(a.productCostLotUnits)+tv(' of units',' units')];
      if(a.productCostFallback>0.5) parts.push(money(a.productCostFallback,{compact:true})+tv(' nearest-lot / per-SKU cost (',' giá lô gần nhất / giá theo SKU (')+pu(a.productCostFbUnits)+')');
      if(a.productCostActual>0.5) parts.push(money(a.productCostActual,{compact:true})+tv(' per the accountant\'s book',' theo sổ kế toán'));
      if(a.productCostEstAmount>0.5) parts.push(money(a.productCostEstAmount,{compact:true})+tv(' ESTIMATED at ',' ƯỚC TÍNH ')+(a.cogsEstRate*100).toFixed(0)+tv('% (no units per SKU: Walmart, TikTok Shop, items without SKU, days before the SKU data)','% (không có units theo SKU: Walmart, TikTok Shop, hàng không SKU, ngày trước khi có dữ liệu SKU)'));
      rows.push({...stLine(tv('Product cost — ', 'Giá vốn sản phẩm — ')+parts.join(' + '), -a.productCost, nr, 'var', 'cogs'), neg:true, est: a.productCostEstAmount>0.5, estTitle: (COGS_EST&&COGS_EST.basis)||'', hget: x=>-x.productCost});
    } else if(a.productCostHasActual && !a.productCostEst){
      rows.push({...stLine(tv('Product cost — per the accountant\'s inventory book (data/cogs_monthly.json), spread by each day\'s net revenue', 'Giá vốn sản phẩm — theo sổ kho kế toán (data/cogs_monthly.json), rải theo doanh thu thuần từng ngày'), -a.productCost, nr, 'var', 'cogs'), neg:true, hget: x=>-x.productCost});
    } else if(a.productCostHasActual && a.productCostEst){
      rows.push({...stLine(tv('Product cost — ', 'Giá vốn sản phẩm — ')+money(a.productCostActual,{compact:true})+tv(' per the accountant\'s inventory book + ', ' theo sổ kho kế toán + ')+money(a.productCostEstAmount,{compact:true})+tv(' ESTIMATED at ', ' ƯỚC TÍNH ')+(a.cogsEstRate*100).toFixed(0)+tv('% (channel/month without a figure in data/cogs_monthly.json)', '% (kênh/tháng chưa có số trong data/cogs_monthly.json)'), -a.productCost, nr, 'var', 'cogs'), neg:true, est:true, estTitle: (COGS_EST&&COGS_EST.basis)||'', hget: x=>-x.productCost});
    } else if(a.productCostEst){
      rows.push({...stLine(tv('Product cost — ESTIMATED at ', 'Giá vốn sản phẩm — ƯỚC TÍNH ')+(a.cogsEstRate*100).toFixed(0)+tv('% of net revenue (no actual figure yet; enter the accountant\'s figures in data/cogs_monthly.json to replace it)', '% doanh thu thuần (chưa có số thật; điền số kế toán vào data/cogs_monthly.json để thay)'), -a.productCost, nr, 'var', 'cogs'), neg:true, est:true, estTitle: (COGS_EST&&COGS_EST.basis)||'', hget: x=>-x.productCost});
    } else {
      rows.push({...stLine(tv('Product cost (no cost-per-SKU table yet)', 'Giá vốn sản phẩm (chưa có bảng giá vốn theo SKU)'), -a.productCost, nr, 'var', 'cogs'), neg:true, gap:true, hget: x=>-x.productCost});
    }
    const smLive = a.shipmonkRealDays>0;
    const smBasis = shipmonkOrderBasis() ? tx('st.byOrderDate') : tx('st.byShipDate');
    const smNote = smLive ? ' — ShipMonk, ' + smBasis + (a.shipmonkRealDays<a.n ? tx('st.outsideSync', {n: a.n-a.shipmonkRealDays, d: dayWord(a.n-a.shipmonkRealDays)}) : '') : '';
    const smStores = smLive ? Object.entries(a.shipmonkByStore||{}).sort((x,y)=>y[1].total-x[1].total) : [];
    const smStoreRows = (field, what) => {   // one detail row per ShipMonk store (Shopify vs Amazon FBM) when there is more than one
      if(smStores.length<2) return;
      smStores.forEach(([name, t])=>{
        rows.push({...stLine(shipmonkStoreLabel(name)+' — '+what+' ('+t.orders.toLocaleString('en-US')+' '+tx('u.orders')+')', -t[field], nr, null, 'cogs'), detail:true, neg:true, live:true});
      });
    };
    rows.push({...stLine(tv('Packaging', 'Phí đóng gói (packaging)') + (smLive ? tv(' — ShipMonk packaging materials, ', ' — vật liệu đóng gói ShipMonk, ') + smBasis : ''), -a.packaging, nr, 'var', 'cogs'), neg:true, gap: !smLive, live: smLive, hget: x=>-x.packaging});
    smStoreRows('packaging', 'packaging');
    if(a.boxMode){
      // V11.1: boxes used, one per package as ShipMonk picked them, FIFO over the Notion box lots
      const nb = x => Math.round(x).toLocaleString('en-US');
      let bx = tv('Shipping boxes — one per package as ShipMonk picked it, FIFO over the Notion box lots (', 'Hộp đóng gói — theo kiện ShipMonk đã nhặt, FIFO theo lô hộp Notion (')+nb(a.boxUnits)+tv(' boxes', ' hộp');
      if(a.boxFbUnits>0.5) bx += ', '+nb(a.boxFbUnits)+tv(' at nearest-lot cost', ' theo giá lô gần nhất');
      if(a.boxEstUnits>0.5) bx += ', '+nb(a.boxEstUnits)+tv(' with no lot in Notion yet = $0', ' chưa có lô trong Notion = $0');
      if(a.boxEstBoxes>0.5) bx += tv('; of which ', '; trong đó ')+nb(a.boxEstBoxes)+tv(' boxes ESTIMATED at one box per package for ', ' hộp ƯỚC TÍNH 1 hộp/kiện cho ')+a.boxEstDays+tv(' days before ShipMonk listed the box on the order (Large / Jumbo split by the caves sold that day, costed from the Notion box lots)', ' ngày trước khi ShipMonk ghi hộp lên đơn (chia Large / Jumbo theo cave bán trong ngày, giá theo lô hộp Notion)');
      if(a.boxDays<a.n) bx += '; '+(a.n-a.boxDays)+tv(' days without per-package box data', ' ngày chưa có dữ liệu hộp theo kiện')+(shipmonkBoxCoverage && shipmonkBoxCoverage.firstGood ? tv(' (ShipMonk lists the box on the order from ', ' (ShipMonk ghi hộp theo đơn từ ')+shipmonkBoxCoverage.firstGood+')' : '')+tv(' keep the purchase line', ' vẫn tính theo dòng mua');
      bx += ')';
      rows.push({...stLine(bx, -a.boxCost, nr, 'var', 'cogs'), neg:true, live:true, est: a.boxEstUnits>0.5 || a.boxEstBoxes>0.5, estTitle: a.boxEstBoxes>0.5 ? tv('Before 10/2025 ShipMonk did not list the box on the order: one box per package shipped is assumed (user decision 19/10/2026), FIFO over the Notion box lots', 'Trước 10/2025 ShipMonk chưa ghi hộp lên đơn: giả định 1 hộp/kiện đã gửi (user chốt 19/10/2026), FIFO theo lô hộp Notion') : tv('Boxes with no receipt lot in Notion carry $0 until the lot is entered', 'Hộp chưa có lô nhập trong Notion tạm tính $0 tới khi nhập lô'), hget: x=>-x.boxCost});
      Object.entries(a.boxBySku||{}).sort((x,y)=>y[1].cost-x[1].cost).forEach(([sku,t])=>{
        rows.push({...stLine(sku+' — '+nb(t.n)+tv(' boxes', ' hộp')+(t.n>0 ? ' · '+money(t.cost/t.n)+tv('/box', '/hộp') : ''), -t.cost, nr, null, 'cogs'), detail:true, neg:true, live:true});
      });
      if(a.smPackagingMemo!==0) rows.push({...stLine(tv('Memo — custom packaging bought through ShipMonk this period: ', 'Ghi nhớ — bao bì mua qua ShipMonk trong kỳ: ')+money(a.smPackagingMemo)+tv(' (not expensed here: these boxes are inventory until used — counted above per package)', ' (không tính chi phí ở đây: hộp là tồn kho tới khi dùng — đã tính theo kiện ở trên)'), 0, nr, null, 'cogs'), detail:true, live:true});
    }
    const skuPend = a.amazonPendSkuDays>0;
    const fbaEstTxt = a.amazonFbaEst>0.5 ? tv(' — of which ', ' — trong đó ')+money(a.amazonFbaEst)+(skuPend ? tv(' for ', ' cho ')+a.amazonPendUnits.toLocaleString('en-US')+tv(' Amazon units with no fee posted yet, at each SKU\'s actual FBA rate (', ' units Amazon chưa ghi phí, tính theo cước FBA thật của từng SKU (')+a.amazonFeeEstDays+tv(' days; replaced by the actual figure once Amazon posts it)', ' ngày; thay bằng số thật khi Amazon ghi)') : tv(' estimated for Amazon orders with no fee posted yet (', ' ước tính cho đơn Amazon chưa ghi phí (')+a.amazonFeeEstDays+tv(' days, ', ' ngày, ')+(amazonFeeEstRates ? money(amazonFeeEstRates.fbaPerUnit)+tv('/unit based on ', '/unit theo ')+amazonFeeEstRates.settledDays+tv(' settled days', ' ngày đã chốt') : '')+')') : '';
    rows.push({...stLine(tv('FBA fulfillment fee — Amazon pick & pack + ship (FBAPerUnitFulfillmentFee)', 'Phí fulfillment FBA — Amazon pick & pack + ship (FBAPerUnitFulfillmentFee)')+fbaEstTxt, -a.fulfillment, nr, 'var', 'cogs'), neg:true, live: a.amazonRealDays>0, est: a.amazonFbaEst>0.5, hget: x=>-x.fulfillment});
    const smOrdersTxt = a.shipmonkOrders.toLocaleString('en-US')+' '+tx('u.orders') + (a.shipmonkUnshipped>0 ? ', '+a.shipmonkUnshipped.toLocaleString('en-US')+tv(' not shipped yet — at ShipMonk\'s estimate', ' chưa ship — tính theo ước tính ShipMonk') : '') + ', '+a.shipmonkUnits.toLocaleString('en-US')+' units';
    rows.push({...stLine(smLive ? tv('ShipMonk fulfillment fee — pick & pack (', 'Phí fulfillment ShipMonk — pick & pack (')+smOrdersTxt+')' + smNote : tv('ShipMonk / manual warehouse fulfillment fee — Shopify + Amazon FBM orders (ShipMonk not connected)', 'Phí fulfillment ShipMonk / kho thủ công — đơn Shopify + Amazon FBM (chưa kết nối ShipMonk)'), -a.shipmonkPickPack, nr, 'var', 'cogs'), neg:true, gap: !smLive, live: smLive, hget: x=>-x.shipmonkPickPack});
    smStoreRows('pickPack', 'pick & pack');
    rows.push({...stLine(tv('Shipping to customers (postage) — non-FBA orders', 'Phí vận chuyển đến khách (postage) — đơn ngoài FBA') + (smLive ? tv(' — ShipMonk carrier rates estimated per order, ', ' — cước carrier ShipMonk ước tính theo đơn, ') + smBasis : ''), -a.postage, nr, 'var', 'cogs'), neg:true, gap: !smLive, live: smLive, hget: x=>-x.postage});
    smStoreRows('shipping', 'postage');
    if(a.smInvDays>0){
      const invNote = tx('st.perInvoice') + (a.smInvDays<a.n ? tx('st.noInvoiceDays', {n: a.n-a.smInvDays, d: dayWord(a.n-a.smInvDays)}) : '');
      const invLine = (label, v, opts) => rows.push({...stLine(label + invNote, -v, nr, 'var', 'cogs'), neg: v>=0, live:true, ...(opts||{})});
      if(a.smInv.packaging_purchases !== 0) invLine(tv('Packaging bought through ShipMonk — custom packaging, booked when ShipMonk invoices it', 'Mua bao bì riêng qua ShipMonk — custom packaging, ghi khi ShipMonk xuất hoá đơn')+(a.boxMode ? tv(' (days without the per-package box data only)', ' (chỉ các ngày chưa có dữ liệu hộp theo kiện)') : ''), a.smInv.packaging_purchases);
      if(a.smInvAdjCredits !== 0) invLine(tv('ShipMonk postage adjustments & credits — refunds/adjustments on the invoice', 'Điều chỉnh cước & credit ShipMonk — hoàn/điều chỉnh trên hoá đơn'), a.smInvAdjCredits);
      if(a.smCmpDays>0){
        const pct = a.smInvShipCmp ? (Math.min(a.smInvShipCmp, a.smApiShipCmp)/Math.max(a.smInvShipCmp, a.smApiShipCmp)*100) : 100;
        invLine(tv('Invoice − API estimate difference (postage + pick & pack), per billing period', 'Chênh lệch hoá đơn − ước tính API (cước + pick & pack), tính theo từng kỳ hoá đơn'), a.smTrueUp);
        rows.push({...stLine(tv('Reconciliation of ', 'Đối chiếu ')+a.smCmpDays+tv(' days: invoice shows ', ' ngày: hoá đơn ghi ')+money(a.smInvShipCmp)+tv(' postage + pick & pack · API estimate ', ' cước + pick & pack · API ước tính ')+money(a.smApiShipCmp)+tv(' (by ship date) · match ', ' (theo ngày ship) · khớp ')+pct.toFixed(1)+'%', 0, nr, null, 'cogs'), detail:true, live:true});
      } else if(a.smCmpMissingDays>0){
        rows.push({...stLine(tv('Reconciliation of postage + pick & pack against the invoice: not possible yet — the API does not have every ship day of this period yet (waiting for backfill)', 'Đối chiếu cước + pick & pack với hoá đơn: chưa được — API chưa có đủ ngày ship của kỳ này (chờ backfill)'), 0, nr, null, 'cogs'), detail:true});
      }
    }
    if(a.amazonInboundFreightReal !== 0){
      rows.push({...stLine(tv('Memo — inbound freight & duty into FBA ', 'Memo — cước & thuế nhập hàng vào FBA ')+money(a.amazonInboundFreightReal)+tv(' (Amazon Global Logistics, invoice date): capitalised into inventory cost, NOT deducted here', ' (Amazon Global Logistics, ngày hoá đơn): tính vào giá vốn hàng nhập kho, KHÔNG trừ ở đây'), 0, nr, null, 'cogs'), detail:true, live:true});
    }
    rows.push({...stSub(tv('= Total COGS', '= Tổng COGS'), -a.cogs, nr, 'cogs_sub'), hget: x=>-x.cogs});
    rows.push({...stSub(tv('= Gross profit', '= Lợi nhuận gộp (Gross Profit)'), a.grossProfit, nr, 'gp'), hget: x=>x.grossProfit});

    // Variable selling fees = what the channel and the payment processor keep out of every order (a fixed % per
    // transaction, like a retailer's margin) - NOT marketing: ads/affiliates are discretionary demand generation (next section).
    rows.push(stSection(tv('Transaction selling fees — marketplace commissions & payment processing (variable selling fees)', 'Phí bán hàng theo giao dịch — hoa hồng sàn & cổng thanh toán (variable selling fees)'),'opvar'));
    rows.push({...stGroup(tv('<b>Marketplace fees</b> — a fixed % of every order, like a retailer\'s margin; not marketing', '<b>Hoa hồng & phí sàn</b> (marketplace fees) — % cố định trên mỗi đơn, như margin của nhà bán lẻ; không phải marketing'), -a.marketplaceFees, nr, 'opvar'), hget: x=>-x.marketplaceFees});
    if(a.amazonOrdersReal>0){
      const feeOrdered = a.amazonFeeOrderedDays>0;
      const feeBasisTxt = feeOrdered ? tv(' — by order date', ' — theo ngày đặt hàng') + (a.amazonRefEst>0.5 ? tv(', of which ', ', trong đó ')+money(a.amazonRefEst)+(a.amazonPendSkuDays>0 ? tv(' for ', ' cho ')+a.amazonPendUnits.toLocaleString('en-US')+tv(' Amazon units with no fee posted yet, at each SKU\'s actual referral rate (', ' units Amazon chưa ghi phí, tính theo tỷ lệ referral thật của từng SKU (')+a.amazonFeeEstDays+tv(' days; replaced by the actual figure once Amazon posts it)', ' ngày; thay bằng số thật khi Amazon ghi)') : tv(' estimated for Amazon orders with no fee posted yet (', ' ước tính cho đơn Amazon chưa ghi phí (')+a.amazonFeeEstDays+tv(' days, ', ' ngày, ')+(amazonFeeEstRates ? (amazonFeeEstRates.refRate*100).toFixed(1)+tv('% of revenue based on ', '% doanh thu theo ')+amazonFeeEstRates.settledDays+tv(' settled days', ' ngày đã chốt') : '')+tv('; replaced by the actual figure once Amazon posts it)', '; thay bằng số thật khi Amazon ghi)')) : tv(' (Amazon has posted all fees)', ' (Amazon đã ghi phí đủ)')) : tv(' — by ship date (Finances)', ' — theo ngày ship (Finances)');
      rows.push({...stLine(tv('Amazon referral fees', 'Phí giới thiệu Amazon (Referral fees)')+feeBasisTxt, -a.amazonReferralFeesReal, nr, 'var', 'opvar'), neg:true, live: feeOrdered, est: a.amazonRefEst>0.5, hget: x=>-x.amazonReferralFeesReal});
      // Script schema 2 splits the per-order "other" fees out of the catch-all; on older
      // JSON they are still inside the catch-all and this line would be a misleading $0.
      const amazonSchema2 = !!(amazonMeta && amazonMeta.schema >= 2);
      if(amazonSchema2 || a.amazonOtherFeesReal !== 0){
        rows.push({...stLine(tv('Other Amazon fees (sales tax collection, shipping chargeback/holdback, refund administration fee, return-label postage)', 'Phí Amazon khác (thu hộ sales tax, shipping chargeback/holdback, phí xử lý hoàn tiền, postage nhãn trả hàng)') + (feeOrdered ? tv(' — by order date, including fee adjustments on refunds', ' — theo ngày đặt hàng, gồm điều chỉnh phí khi hoàn tiền') : ''), -a.amazonOtherFeesReal, nr, 'var', 'opvar'), neg: a.amazonOtherFeesReal>=0, hget: x=>-x.amazonOtherFeesReal});
        if(feeOrdered && Math.abs(a.amazonRefundFeeAdj) >= 0.01) rows.push({...stLine(tv('… of which fees Amazon returned on refunds (by refund date): ', '… trong đó Amazon trả lại phí khi hoàn tiền (theo ngày hoàn): ')+money(a.amazonRefundFeeAdj), 0, nr, null, 'opvar'), detail:true, live:true});
      }
      const catchAllLabel = amazonSchema2
        ? tv('Adjustments & Amazon reimbursements / unclassified (lost/damaged reimbursements, reserve, liquidation, unmapped items) — positive = money back from Amazon', 'Điều chỉnh & khoản Amazon trả lại / chưa phân loại (reimbursement hàng mất/hỏng, reserve, liquidation, mục chưa map) — số dương = Amazon trả lại tiền')
        : tv('Other / unclassified Amazon fees (gift wrap, sales tax fee, shipping chargeback...)', 'Phí Amazon khác/chưa phân loại (gift wrap, sales tax fee, shipping chargeback...)');
      rows.push({...stLine(catchAllLabel, -a.amazonOtherUnclassifiedCost, nr, 'var', 'opvar'), neg: a.amazonOtherUnclassifiedCost>=0, hget: x=>-x.amazonOtherUnclassifiedCost});
    } else {
      rows.push({...stLine(tv('Amazon marketplace fees (no SP-API data for this period)', 'Phí sàn Amazon (khoảng này chưa có dữ liệu SP-API)'), 0, nr, 'var', 'opvar'), neg:true, gap:true});
    }
    if(a.walmartDays>0){
      const estW = a.walmartFeesEst>0.005;
      rows.push({...stLine(tv('Walmart marketplace fees — commission · ', 'Phí sàn Walmart — hoa hồng · ')+a.walmartSettledOrders.toLocaleString('en-US')+tv(' reconciled orders (actual fees)', ' đơn đã đối soát (phí thật)')+(estW ? ' + '+a.walmartUnsettledOrders.toLocaleString('en-US')+tv(' unreconciled orders (estimate)', ' đơn chưa đối soát (ước tính)') : ''), -a.walmartFees, nr, 'var', 'opvar'), neg: a.walmartFees>=0, live:true, est: estW, estTitle: estW ? tv('Orders not yet in Walmart\'s reconciliation report have no actual fee. ', 'Đơn chưa có trong báo cáo đối soát của Walmart chưa có phí thật. ')+money(a.walmartFeesEst)+tv(' is an estimate = those orders\' revenue × the commission rate measured on reconciled orders; replaced by the actual fee once Walmart adds the orders to the report.', ' là ước tính = doanh thu các đơn đó × tỷ lệ hoa hồng đo trên đơn đã đối soát; tự thay bằng phí thật khi Walmart đưa đơn vào báo cáo.') : '', hget: x=>-x.walmartFees});
    } else {
      rows.push({...stLine(tv('Walmart marketplace fees — ', 'Phí sàn Walmart — ')+(walmartMatched ? tv('this period is outside the Walmart order data', 'khoảng này ngoài dữ liệu đơn Walmart') : tv('not connected', 'chưa kết nối')), -a.walmartFees, nr, 'var', 'opvar'), neg:true, gap:true, hget: x=>-x.walmartFees});
    }
    if(a.tiktokDays>0){
      const estS = a.tiktokFeesEstSelling>0.005;
      rows.push({...stLine(tv('TikTok Shop marketplace fees — referral (6%) + refund administration fee · ', 'Phí sàn TikTok Shop — referral (6%) + phí xử lý hoàn tiền · ')+a.tiktokSettledOrders.toLocaleString('en-US')+tv(' settled orders (actual fees)', ' đơn đã quyết toán (phí thật)')+(estS ? ' + '+a.tiktokUnsettledOrders.toLocaleString('en-US')+tv(' unsettled orders (estimate)', ' đơn chưa quyết toán (ước tính)') : ''), -a.tiktokFees, nr, 'var', 'opvar'), neg: a.tiktokFees>=0, live:true, est: estS, estTitle: estS ? tv('Unsettled orders have no actual fee yet (TikTok settles fees about 8 days after delivery). ', 'Đơn chưa quyết toán chưa có phí thật (TikTok chốt phí khoảng 8 ngày sau khi giao). ')+money(a.tiktokFeesEstSelling)+tv(' is an estimate = those orders\' net revenue × the fee rate measured on settled orders; replaced by the actual fee once the orders settle.', ' là ước tính = doanh thu thuần các đơn đó × tỷ lệ phí đo trên đơn đã quyết toán; tự thay bằng phí thật khi đơn quyết toán.') : '', hget: x=>-x.tiktokFees});
    } else {
      rows.push({...stLine(tv('TikTok Shop marketplace fees — ', 'Phí sàn TikTok Shop — ')+(tiktokMatched ? tv('this period is outside the TikTok order data', 'khoảng này ngoài dữ liệu đơn TikTok') : tv('not connected', 'chưa kết nối')), -a.tiktokFees, nr, 'var', 'opvar'), neg:true, gap:true, hget: x=>-x.tiktokFees});
    }
    rows.push({...stGroup(tv('<b>Payment processing fees</b> — Shopify Payments, PayPal, per transaction', '<b>Phí cổng thanh toán</b> (payment processing) — Shopify Payments, PayPal, theo từng giao dịch'), -a.paymentFeesAll, nr, 'opvar'), hget: x=>-x.paymentFeesAll});
    if(a.paymentFeeDays>0){
      const GW_LABEL = {shopify_payments: tv('Shopify Payments (cards, Shop Pay)', 'Shopify Payments (thẻ, Shop Pay)'), paypal:'PayPal', shop_cash:'Shop Cash', gift_card:'Gift card', manual: tv('Manual', 'Thủ công'), shopify_installments:'Shop Pay Installments', 'afterpay (new)': tv('Afterpay (instalments)', 'Afterpay (trả góp)'), afterpay: tv('Afterpay (instalments)', 'Afterpay (trả góp)')};
      // Gateways that never carry a per-transaction fee: gift cards, Shop Cash rewards and manual/COD orders.
      const GW_NO_FEE = new Set(['gift_card','shop_cash','manual']);
      let lbl = tv('Payment processing fees — Shopify Payments, actual fee per transaction (', 'Phí cổng thanh toán — Shopify Payments, phí thật theo từng giao dịch (')+a.paymentFeeOrders.toLocaleString('en-US')+' '+tx('u.orders')+')';
      if(a.paymentFeeDays<a.n) lbl += tx('st.outsideSync', {n: a.n-a.paymentFeeDays, d: dayWord(a.n-a.paymentFeeDays)});
      rows.push({...stLine(lbl, -a.paymentFees, nr, 'var', 'opvar'), neg:true, live:true, hget: x=>-x.paymentFees});
      Object.entries(a.feeTypeMix).sort((x,y)=>y[1]-x[1]).forEach(([k,v])=>{
        const FT = {domestic_card_not_present: tv('domestic cards 2.25% + $0.30', 'thẻ nội địa 2.25% + $0.30'), premium_domestic_card_not_present: tv('premium cards 2.95% + $0.30', 'thẻ premium 2.95% + $0.30'), amex_card_not_present:'Amex 2.95% + $0.30', international_card_not_present: tv('international cards 3.25% + $0.42', 'thẻ quốc tế 3.25% + $0.42'), foreign_exchange_fee: tv('foreign exchange fee 1.5%', 'phí quy đổi ngoại tệ 1.5%'), amazon_pay_base:'Amazon Pay', amex_international_card_not_present: tv('international Amex', 'Amex quốc tế'), premium_international_card_not_present: tv('premium international cards', 'thẻ premium quốc tế'), shop_pay_installments:'Shop Pay Installments'};
        rows.push({...stLine((FT[k]||k), -v, nr, null, 'opvar'), detail:true, neg:true, live:true});
      });
      Object.entries(a.gatewayMix).filter(([g])=>g!=='shopify_payments' && !(g==='paypal' && a.paypalDays>0) && !/afterpay|clearpay/i.test(g)).sort((x,y)=>y[1].amount-x[1].amount).forEach(([g,v])=>{
        const base = (GW_LABEL[g]||g)+' — '+v.orders.toLocaleString('en-US')+' '+tx('u.orders')+', '+money(v.amount)+tv(' collected through this gateway', ' thu qua cổng này');
        if(GW_NO_FEE.has(g)) rows.push({...stLine(base+tv(' — this gateway charges no transaction fee', ' — cổng này không thu phí giao dịch'), 0, nr, null, 'opvar'), detail:true, live:true});
        else rows.push({...stLine(base+tv(' — fees not connected', ' — phí chưa kết nối'), 0, nr, null, 'opvar'), detail:true, neg:true, gap:true});
      });
      if(a.afterpayOrders>0){
        rows.push({...stLine(tv('Afterpay (instalments) — ', 'Afterpay (trả góp) — ')+a.afterpayOrders.toLocaleString('en-US')+' '+tx('u.orders')+', '+money(a.afterpayAmount)+tv(' collected through this gateway — estimated fee ', ' thu qua cổng này — phí ước tính ')+(AFTERPAY_FEE.pct*100).toFixed(0)+'% + $'+AFTERPAY_FEE.fixed.toFixed(2)+tv('/order', '/đơn'), -a.afterpayFees, nr, null, 'opvar'), detail:true, neg:true, live:true, est:true, estTitle: tv('Shopify does not expose the Afterpay fee. Estimate = amount collected through Afterpay × ', 'Shopify không lộ phí Afterpay. Ước tính = số thu qua Afterpay × ')+(AFTERPAY_FEE.pct*100).toFixed(1)+'% + $'+AFTERPAY_FEE.fixed.toFixed(2)+tv(' × number of orders (public rate card, not the actual fee). Replaced by the actual fee once Afterpay\'s settlement report is available.', ' × số đơn (biểu phí công khai, chưa phải phí thật). Sẽ thay bằng phí thật khi có báo cáo settlement của Afterpay.'), hget: x=>-x.afterpayFees});
      }
    } else if(a.paypalDays===0){
      rows.push({...stLine(tv('Payment processing fees (Shopify Payments / PayPal / ShopPay) — not connected', 'Phí cổng thanh toán (Shopify Payments / PayPal / ShopPay) — chưa kết nối'), -a.paymentFees, nr, 'var', 'opvar'), neg:true, gap:true});
    }
    if(a.paypalDays>0){
      let plbl = tv('PayPal fees — actual fee per transaction (', 'Phí PayPal — phí thật theo từng giao dịch (')+a.paypalPaymentsCount.toLocaleString('en-US')+tv(' payments, ', ' thanh toán, ')+money(a.paypalPayments)+tv(' collected through PayPal)', ' thu qua PayPal)');
      if(a.paypalDays<a.n) plbl += tx('st.outsideSync', {n: a.n-a.paypalDays, d: dayWord(a.n-a.paypalDays)});
      rows.push({...stLine(plbl, -a.paypalFees, nr, 'var', 'opvar'), neg:true, live:true, hget: x=>-x.paypalFees});
      const pc = a.paypalCompare;
      if(pc && pc.shopify>0){
        const gap = pc.paypal - pc.shopify, pct = pc.paypal ? (Math.min(pc.shopify, pc.paypal)/pc.paypal*100) : 0;
        rows.push({...stLine(tv('Reconciliation of ', 'Đối chiếu ')+pc.days+tv(' days with both live: Shopify shows ', ' ngày cả hai cùng live: Shopify ghi ')+money(pc.shopify)+tv(' via PayPal (', ' qua PayPal (')+pc.shopifyOrders.toLocaleString('en-US')+' '+tx('u.orders')+tv(') · PayPal shows ', ') · PayPal ghi ')+money(pc.paypal)+' ('+pc.paypalCount.toLocaleString('en-US')+tv(' payments) · match ', ' thanh toán) · khớp ')+pct.toFixed(1)+'%'+(Math.abs(gap)>=1 ? tv(', difference ', ', chênh ')+money(gap)+tv(' = payments on cancelled / non-Shopify orders', ' = thanh toán của đơn đã huỷ / ngoài Shopify') : ''), 0, nr, null, 'opvar'), detail:true, live:true});
      }
    }
    rows.push({...stSub(tv('= Total transaction selling fees (marketplace commissions + payment processing)', '= Tổng phí bán hàng theo giao dịch (hoa hồng sàn + cổng thanh toán)'), -a.feesTotal, nr, 'opvar_sub'), hget: x=>-x.feesTotal});
    rows.push({...stSub(tv('= Contribution margin before marketing (CM2 — after transaction fees, before ads)', '= Lợi nhuận đóng góp trước marketing (CM2 — sau phí giao dịch, trước quảng cáo)'), a.cmBeforeMarketing, nr, 'cm2'), hget: x=>x.cmBeforeMarketing});

    rows.push(stSection(tv('Marketing & selling (ads + affiliate commissions)', 'Marketing & bán hàng (quảng cáo + hoa hồng affiliate)'),'mkt'));
    AD_KEYS.forEach(k=>{
      let label = tv('Ads — ', 'Quảng cáo — ')+AD_LABEL[k];
      let live = false, gap = false;
      if(k==='amazonads'){
        if(!amazonAdsMatched){ label += tv(' (waiting for Amazon to approve the Advertising API)', ' (chờ Amazon duyệt Advertising API)'); gap = true; }
        else if(a.amazonAdsRealDays===a.n){ live = true; label += ' (SP '+money(a.amazonAdsSplit.sp)+' · SB '+money(a.amazonAdsSplit.sb)+' · SD '+money(a.amazonAdsSplit.sd)+')'+(a.amazonAdsSplit.stv>0.005 ? tv(' — Sellerboard also records ', ' — Sellerboard ghi thêm ')+money(a.amazonAdsSplit.stv)+tv(' "Sponsored TV" that is not in the Ads console: not counted', ' "Sponsored TV" không có trong Ads console: không tính') : ''); }
        else if(a.amazonAdsRealDays>0){ live = true; label += tv(' ('+(a.n-a.amazonAdsRealDays)+' days without figures yet = $0)', ' ('+(a.n-a.amazonAdsRealDays)+' ngày chưa có số = $0)'); }
        else { label += tv(' (no figures for this period yet)', ' (khoảng này chưa có số)'); gap = true; }
      }
      else if(AD_UNCONNECTED[k]){ label += tx('st.notConnected'); gap = true; }
      if(k==='meta'){
        if(a.metaAdsRealDays===a.n){ live = true; }
        else if(a.metaAdsRealDays>0){ live = true; label += tv(' ('+(a.n-a.metaAdsRealDays)+' days outside the Marketing API window = $0)', ' ('+(a.n-a.metaAdsRealDays)+' ngày ngoài cửa sổ Marketing API = $0)'); }
        else { label += metaMatched ? tv(' (this period is outside the Marketing API window)', ' (khoảng này ngoài cửa sổ Marketing API)') : tx('st.notConnected'); gap = true; }
      }
      if(k==='google'){
        if(a.googleAdsRealDays===a.n){ live = true; }
        else if(a.googleAdsRealDays>0){ live = true; label += tv(' ('+(a.n-a.googleAdsRealDays)+' days outside the Google Ads API window = $0)', ' ('+(a.n-a.googleAdsRealDays)+' ngày ngoài cửa sổ Google Ads API = $0)'); }
        else { label += googleMatched ? tv(' (this period is outside the Google Ads API window)', ' (khoảng này ngoài cửa sổ Google Ads API)') : tx('st.notConnected'); gap = true; }
      }
      if(k==='applovin' && applovinMatched){
        if(a.applovinRealDays===a.n){ live = true; }
        else if(a.applovinRealDays>0){ live = true; label += tv(' ('+(a.n-a.applovinRealDays)+' days without figures yet = $0 — the API keeps only 45 days; load an export file for history)', ' ('+(a.n-a.applovinRealDays)+' ngày chưa có số = $0 — API chỉ giữ 45 ngày; nạp file export để có lịch sử)'); }
        else { label += tv(' (no figures for this period — the API keeps only 45 days; load an export file for history)', ' (khoảng này chưa có số — API chỉ giữ 45 ngày; nạp file export để có lịch sử)'); gap = true; }
      }
      if(k==='tiktokads' && tiktokAdsMatched){
        label += tv(' (GMV Max — TikTok Shop ads)', ' (GMV Max — quảng cáo TikTok Shop)');
        if(a.tiktokAdsRealDays===a.n){ live = true; }
        else if(a.tiktokAdsRealDays>0){ live = true; label += tv(' ('+(a.n-a.tiktokAdsRealDays)+' days without figures yet = $0)', ' ('+(a.n-a.tiktokAdsRealDays)+' ngày chưa có số = $0)'); }
        else { label += tv(' (no figures for this period yet)', ' (khoảng này chưa có số)'); gap = true; }
      }
      let est = false, estTitle = '';
      if(k==='amazonads' && a.amazonAdsProvisionalDays>0){
        const exl = AMAZON_ADS_LIVE_DATA.meta.automation.fetched_last_day;
        est = true; estTitle = tv('The Sellerboard export only reaches ', 'Export Sellerboard mới có đến ')+exl.slice(8,10)+'/'+exl.slice(5,7)+tv(' — the figures of the ', ' — số của ')+a.amazonAdsProvisionalDays+tv(' days after it (', ' ngày sau đó (')+money(a.amazonAdsProvisionalAmt)+tv(') are provisional, pulled from the PPC dashboard during the day (usually a partial day), replaced once the export has them', ') là bản tạm kéo từ PPC dashboard trong ngày (thường mới một phần ngày), tự thay khi export có');
        label += ' — '+a.amazonAdsProvisionalDays+tv(' days after the Sellerboard export (to ', ' ngày sau export Sellerboard (đến ')+exl.slice(8,10)+'/'+exl.slice(5,7)+tv('): provisional, updates automatically', '): số tạm, tự cập nhật');
      }
      rows.push({...stLine(label, -a.ads[k], nr, 'var', 'mkt'), neg:true, live, gap, est, estTitle, hget: x=>-x.ads[k]});
    });
    if(a.snowballRealDays>0){
      let label = tv('Influencer/affiliate commission — Snowball · ', 'Hoa hồng influencer/affiliate — Snowball · ')+a.snowballOrders.toLocaleString('en-US')+tv(' referral orders', ' đơn referral');
      if(a.snowballRealDays<a.n) label += tv(' ('+(a.n-a.snowballRealDays)+' days outside the sync window not counted)', ' ('+(a.n-a.snowballRealDays)+' ngày ngoài cửa sổ đồng bộ chưa tính)');
      rows.push({...stLine(label, -a.snowballCommission, nr, 'var', 'mkt'), neg: a.snowballCommission>=0, live:true, hget: x=>-x.snowballCommission});
    } else if(shopifyMatched){
      rows.push({...stLine(tv('Influencer/affiliate commission — Snowball (this period is outside the Shopify sync window — no figures)', 'Hoa hồng influencer/affiliate — Snowball (khoảng này ngoài cửa sổ đồng bộ Shopify — chưa có số)'), 0, nr, 'var', 'mkt'), neg:true, gap:true, hget: x=>-x.snowballCommission});
    }
    if(a.tiktokDays>0){
      const estA = a.tiktokAffiliateEst>0.005, estP = a.tiktokSmartEst>0.005;
      rows.push({...stLine(tv('Creator/affiliate commission — TikTok Shop (actual fees on settled orders', 'Hoa hồng creator/affiliate — TikTok Shop (phí thật đơn đã quyết toán')+(estA ? tv(' + estimate for unsettled orders', ' + ước tính đơn chưa quyết toán') : '')+')', -a.tiktokAffiliate, nr, 'var', 'mkt'), neg: a.tiktokAffiliate>=0, live:true, est: estA, estTitle: estA ? tv('Creator commission varies per order (0–30%). ', 'Hoa hồng creator thay đổi theo từng đơn (0–30%). ')+money(a.tiktokAffiliateEst)+tv(' is an estimate at the average rate of settled orders.', ' là ước tính theo tỷ lệ trung bình của các đơn đã quyết toán.') : '', hget: x=>-x.tiktokAffiliate});
      rows.push({...stLine(tv('Smart Promotion — TikTok Shop (in-marketplace ads, charged on revenue)', 'Smart Promotion — TikTok Shop (quảng cáo trong sàn, tính theo doanh thu)')+(estP ? tv(' · unsettled orders: estimate', ' · đơn chưa quyết toán: ước tính') : ''), -a.tiktokSmart, nr, 'var', 'mkt'), neg: a.tiktokSmart>=0, live:true, est: estP, estTitle: estP ? money(a.tiktokSmartEst)+tv(' is an estimate at the rate of settled orders.', ' là ước tính theo tỷ lệ của các đơn đã quyết toán.') : '', hget: x=>-x.tiktokSmart});
    }
    if(a.walmartDays>0 && a.walmartAds>0.005){
      rows.push({...stLine(tv('Walmart Connect ads (deducted in the reconciliation report)', 'Quảng cáo Walmart Connect (khoản trừ trong báo cáo đối soát)'), -a.walmartAds, nr, 'var', 'mkt'), neg:true, live:true, hget: x=>-x.walmartAds});
    }
    rows.push({...stSub(tv('= Total marketing & selling', '= Tổng marketing & bán hàng'), -a.marketingTotal, nr, 'mkt_sub'), hget: x=>-x.marketingTotal});
    rows.push({...stSub(tv('= Contribution margin (CM3, after marketing)', '= Lợi nhuận đóng góp (Contribution Margin, sau marketing)'), a.contributionProfit, nr, 'cm'), hget: x=>x.contributionProfit});

    rows.push(stSection(tv('Operating costs (OpEx) — warehousing & logistics', 'Chi phí hoạt động (OpEx) — kho bãi & logistics'),'logi'));
    if(a.amazonOrdersReal>0){
      const feeOrdered = a.amazonFeeOrderedDays>0;
      if(feeOrdered){
        let sl = tv('FBA monthly storage fee — booked in the month of storage (Amazon charges it on the 7th–15th of the next month)', 'Phí lưu kho FBA hàng tháng — ghi vào tháng lưu kho (Amazon thu ngày 7–15 tháng sau)');
        const slParts = [];
        if(a.amazonStorageReportDays>0) slParts.push(a.amazonStorageReportDays+tv(' days per Amazon\'s Storage Fees report, not charged yet', ' ngày theo report Storage Fees của Amazon, chưa thu tiền'));
        if(a.amazonStorageEstDays>0) slParts.push(a.amazonStorageEstDays+tv(' days estimated ', ' ngày ước tính ')+money(a.amazonStorageEstAmt)+tv(' = FBA stock per SKU × volume × Amazon\'s rate', ' = tồn kho FBA từng SKU × thể tích × đơn giá Amazon'));
        if(a.amazonStorageMissingDays>0) slParts.push(a.amazonStorageMissingDays+tv(' days in a month Amazon has not charged yet = $0', ' ngày thuộc tháng Amazon chưa thu phí = $0'));
        if(slParts.length) sl += ' ('+slParts.join(' · ')+')';
        rows.push({...stLine(sl, -a.amazonStorageAlloc, nr, 'fix', 'logi'), neg:true, live:true, est: a.amazonStorageEstDays>0, estTitle: tv('Estimated the way Amazon calculates it (average units/day × cu ft × seasonal rate by size tier, learned from earlier months\' reports); replaced by the report, then by the amount Amazon actually charges', 'Ước tính theo cách tính của Amazon (unit trung bình/ngày × cu ft × đơn giá theo mùa & size tier, học từ report các tháng trước); thay bằng report rồi bằng số Amazon thu thật'), hget: x=>-x.amazonStorageAlloc});
        if(Math.abs(a.amazonStoragePosted) >= 0.01) rows.push({...stLine(tv('Reconciliation: Amazon charged ', 'Đối chiếu: Amazon thu phí lưu kho ')+money(a.amazonStoragePosted)+tv(' of storage fees in this period (7th–15th of each month, for the previous month)', ' trong khoảng này (ngày 7–15 hàng tháng, cho tháng trước)'), 0, nr, null, 'logi'), detail:true, live:true});
      }
      rows.push({...stLine(feeOrdered ? tv('Amazon service fees (subscription, returns processing, removal, Vine/coupon — excluding monthly storage)', 'Phí dịch vụ Amazon (subscription, xử lý trả hàng, removal, Vine/coupon — không gồm lưu kho tháng)') : tv('Amazon service fees (subscription, FBA storage, returns processing, removal, Vine/coupon)', 'Phí dịch vụ Amazon (subscription, lưu kho FBA, xử lý trả hàng, removal, Vine/coupon)'), -a.amazonServiceFeesReal, nr, 'fix', 'logi'), neg:true, gap: a.amazonServiceFeesReal===0, hget: x=>-x.amazonServiceFeesReal});
    }
    if(a.smInvDays>0 || a.smStorageOpenDays>0){
      const invNote = tx('st.perInvoice') + (a.smInvDays<a.n ? tx('st.noInvoiceDays', {n: a.n-a.smInvDays, d: dayWord(a.n-a.smInvDays)}) : '');
      const logiLine = (label, v, extra, hget) => rows.push({...stLine(label + (extra===undefined ? invNote : extra) + alloc, -v, nr, 'fix', 'logi'), neg: v>=0, live:true, hget});
      // storage: exact per-day amounts from the ShipMonk report (= invoice when the period closes); before 06/2025 the invoice is spread evenly
      const evenDays = a.smInvDays - a.smStorageReportDays;
      let stNote = '';
      if(a.smStorageReportDays>0 || a.smStorageOpenDays>0){
        stNote = tv(' — actual per-day fees per ShipMonk\'s Storage Fees report', ' — phí thật từng ngày theo report Storage Fees của ShipMonk');
        if(a.smStorageReportDays>0 && a.smInvDays===a.smStorageReportDays && a.smStorageOpenDays===0) stNote += tv(' (reconciled to invoice)', ' (đã khớp hoá đơn)');
        else {
          const parts = [];
          if(a.smStorageReportDays>0) parts.push(a.smStorageReportDays+tv(' days reconciled to invoice', ' ngày đã khớp hoá đơn'));
          if(a.smStorageOpenDays - a.smStorageCarryDays>0) parts.push((a.smStorageOpenDays - a.smStorageCarryDays)+tv(' days of the open billing period: per report', ' ngày kỳ chưa xuất hoá đơn: theo report'));
          if(a.smStorageCarryDays>0) parts.push(a.smStorageCarryDays+tv(' days not in the report yet: carried from the latest day', ' ngày report chưa có: tạm lấy bằng ngày gần nhất'));
          if(evenDays>0) parts.push(evenDays+tv(' days before 06/2025: spread evenly over the billing period', ' ngày trước 06/2025: chia đều theo kỳ hoá đơn'));
          stNote += ' ('+parts.join(' · ')+')';
        }
      } else stNote = tv(' — spread evenly over the days of the billing period (the per-day report only exists from 06/2025)', ' — chia đều theo ngày trong kỳ hoá đơn (report theo ngày chỉ có từ 06/2025)') + (a.smInvDays<a.n ? tx('st.noInvoiceDays', {n: a.n-a.smInvDays, d: dayWord(a.n-a.smInvDays)}) : '');
      rows.push({...stLine(tv('ShipMonk storage — pallets & bins', 'Lưu kho ShipMonk — pallet & bin') + stNote + alloc, -a.smInv.storage, nr, 'fix', 'logi'), neg: a.smInv.storage>=0, live:true, est: a.smStorageCarryDays>0, estTitle: tv('Days the ShipMonk report has not updated yet (refreshes ~04:00 warehouse time) are carried from the latest day; replaced once the report has the figure', 'Ngày report ShipMonk chưa cập nhật (làm mới ~04:00 giờ kho) tạm lấy bằng ngày gần nhất; tự thay khi report có số'), hget: x=>-x.smInv.storage});
      logiLine(tv('ShipMonk receiving — cartons received, containers unloaded', 'Receiving hàng nhập ShipMonk — nhận carton, dỡ container'), a.smInv.receiving, undefined, x=>-x.smInv.receiving);
      logiLine(tv('ShipMonk returns handling — processing + return postage', 'Xử lý hàng trả ShipMonk — processing + cước hàng trả'), a.smInv.returns, undefined, x=>-x.smInv.returns);
      if(a.smInvOther !== 0) logiLine(tv('Other ShipMonk fees — minimum fee, late fees, audits, surcharges', 'Phí khác ShipMonk — phí tối thiểu, phạt trễ, audit, phụ phí') + (Math.abs(a.smInv.unallocated)>=1 ? tv(' (including ', ' (gồm ')+money(a.smInv.unallocated)+tv(' of invoice items that could not be split by section)', ' hoá đơn không tách được mục)') : ''), a.smInvOther, undefined, x=>-x.smInvOther);
    } else if(a.shipmonkRealDays>0){
      rows.push({...stLine(tv('ShipMonk storage / receiving / returns — no invoice for this period yet', 'Lưu kho / receiving / hàng trả ShipMonk — chưa có hoá đơn cho khoảng này'), 0, nr, 'fix', 'logi'), gap:true});
    }
    rows.push({...stLine(tv('Inventory holding cost — not entered', 'Chi phí tồn kho (holding cost) — chưa nhập') + alloc, -a.inventoryHolding, nr, 'fix', 'logi'), neg:true, gap:true, hget: x=>-x.inventoryHolding});
    rows.push({...stSub(tv('= Total warehousing & logistics', '= Tổng kho bãi & logistics'), -(a.logisticsTotal + a.inventoryHolding), nr, 'logi_sub'), hget: x=>-(x.logisticsTotal + x.inventoryHolding)});

    rows.push(stSection(tv('Operating costs (OpEx) — G&A (software, salaries, office…)', 'Chi phí hoạt động (OpEx) — G&A (phần mềm, lương, văn phòng…)'),'fixed'));
    a.gaItems.forEach(it=>{
      const known = it.real || it.manual;
      rows.push({...stLine(it.label + (known ? '' : tx('st.notEntered')) + (it.key==='klaviyo' ? '' : alloc), -it.value, nr, 'fix', 'fixed'), neg:true, live: it.real ? 'real' : (it.manual && !it.allEst ? 'manual' : false), gap: known ? false : 'manual', est: !!it.est, estTitle: OPEX_EST_TITLE(), hget: x=>-((x.gaItems.find(g=>g.key===it.key)||{}).value||0)});
    });
    rows.push({...stSub(tv('= Total G&A', '= Tổng G&A'), -a.gaTotal, nr, 'fixed_sub'), hget: x=>-x.gaTotal});
    rows.push({...stSub(tv('= Total operating costs (OpEx)', '= Tổng chi phí hoạt động (OpEx)'), -a.fixedTotal, nr, 'opex_sub'), hget: x=>-x.fixedTotal});

    rows.push({...stFinal(tv('= Operating profit (EBITDA)', '= Lợi nhuận hoạt động (EBITDA)') + (a.salaryEntered ? tv(' — before depreciation, interest, income tax', ' — trước khấu hao, lãi vay, thuế TNDN') : tv(' — before salaries not entered, depreciation, interest, income tax', ' — trước lương chưa nhập, khấu hao, lãi vay, thuế TNDN')), a.netProfit, nr), hget: x=>x.netProfit});

    // Below EBITDA: D&A -> EBIT, interest -> EBT, income tax -> net income (manual monthly entries in data/opex_monthly.json)
    rows.push(stSection(tv('Below EBITDA — depreciation, interest, income tax (manual monthly entry)', 'Dưới EBITDA — khấu hao, lãi vay, thuế TNDN (nhập tay theo tháng)'),'below'));
    const manualNote = tx('st.manualMonthly') + a.opexNote + alloc;
    rows.push({...stLine(tv('Depreciation & amortisation (D&A) — moulds, equipment, software bought outright', 'Khấu hao & phân bổ (D&A) — khuôn, thiết bị, phần mềm mua đứt') + (a.depreciationEntered ? manualNote : tx('st.notEntered')), -a.depreciation, nr, 'fix', 'below'), neg:true, live: a.depreciationEntered ? 'manual' : false, gap: a.depreciationEntered ? false : 'manual', hget: x=>-x.depreciation});
    rows.push({...stSub(tv('= EBIT (profit before interest & tax)', '= EBIT (lợi nhuận trước lãi vay & thuế)'), a.ebit, nr, 'ebit_sub'), hget: x=>x.ebit});
    rows.push({...stLine(tv('Interest & finance costs (± deposit interest, exchange differences)', 'Lãi vay & chi phí tài chính (± lãi tiền gửi, chênh lệch tỷ giá)') + (a.interestEntered ? manualNote : tx('st.notEntered')), -a.interest, nr, 'fix', 'below'), neg: a.interest>=0, live: a.interestEntered ? 'manual' : false, gap: a.interestEntered ? false : 'manual', hget: x=>-x.interest});
    rows.push({...stSub(tv('= Profit before tax (EBT)', '= Lợi nhuận trước thuế (EBT)'), a.ebt, nr, 'ebt_sub'), hget: x=>x.ebt});
    const taxLabel = tv('Corporate income tax', 'Thuế thu nhập doanh nghiệp (TNDN)') + (a.taxEntered ? manualNote : a.incomeTaxEstimated ? tv(` — estimated ${(a.taxRate*100).toFixed(a.taxRate*100%1 ? 1 : 0)}% × positive profit before tax (tax_rate in the file; replaced by the accountant's figure when available)`, ` — ước tính ${(a.taxRate*100).toFixed(a.taxRate*100%1 ? 1 : 0)}% × lợi nhuận trước thuế dương (tax_rate trong file; thay bằng số kế toán khi có)`) : tx('st.notEntered'));
    rows.push({...stLine(taxLabel, -a.incomeTax, nr, 'fix', 'below'), neg:true, live: a.taxEntered ? 'manual' : false, gap: (a.taxEntered || a.incomeTaxEstimated) ? false : 'manual', est: a.incomeTaxEstimated, estTitle: tv('Estimated at the tax rate in data/opex_monthly.json — enter income_tax per month to replace it with the actual figure', 'Ước tính theo thuế suất trong data/opex_monthly.json — nhập income_tax theo tháng để thay bằng số thật'), hget: x=>-x.incomeTax});
    rows.push({...stFinal(tv('= Net profit (after tax)', '= Lợi nhuận ròng (Net Profit, sau thuế)') + (a.belowEbitdaEntered ? '' : tv(' — currently equals EBITDA because the items below EBITDA are still $0', ' — hiện bằng EBITDA vì các khoản dưới EBITDA còn để $0')), a.netIncome, nr), hget: x=>x.netIncome});
    return rows;
  }

  // ---------- trailing periods (last n ngày/tuần/tháng ending at the one currently selected) ----------
  // Used by renderStatement() below to add history columns to the P&L statement's "big total" rows
  // (returns [] for mode==='range', where "kỳ liền trước" has no clear meaning).
  function trailingPeriods(n){
    const out = [];
    if(mode==='day'){
      for(let i=n-1;i>=0;i--){
        const idx = selDayIdx-i;
        if(idx<0) continue;
        const d = days[idx];
        out.push({rows:[d], label: fmtDate(d.date), sub: DOW[d.date.getDay()], current: idx===selDayIdx});
      }
    } else if(mode==='week'){
      const ci = WEEKS.indexOf(selWeek);
      for(let i=n-1;i>=0;i--){
        const wi = ci-i;
        if(wi<0) continue;
        const wk = WEEKS[wi];
        const r = weekMap[wk];
        const mon = new Date(parseInt(wk.slice(0,4),10), parseInt(wk.slice(5,7),10)-1, parseInt(wk.slice(8,10),10));
        const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate()+6);
        out.push({rows:r, label: fmtDate(mon)+'–'+fmtDate(sun), sub: tv('Week ', 'Tuần ')+isoWeekNo(mon), current: wk===selWeek});
      }
    } else if(mode==='month'){
      const ci = MONTHS.indexOf(selMonth);
      for(let i=n-1;i>=0;i--){
        const mi = ci-i;
        if(mi<0) continue;
        const mk = MONTHS[mi];
        const r = monthMap[mk];
        const [y,mo] = mk.split('-');
        out.push({rows:r, label: tv(MONTHS_EN[parseInt(mo,10)-1]+' '+y, 'Th'+parseInt(mo,10)+'/'+y), sub: r.length<28 ? tv('to ', 'đến ')+fmtDate(r[r.length-1].date) : r.length+' '+tx('u.days'), current: mk===selMonth});
      }
    }
    return out;
  }

  // History columns (last 6 kỳ liền trước) in the P&L statement table: buildRows() below tags most
  // rows (subtotals/finals AND per-channel/per-platform detail lines) with an `hget(aggregateOfThatPeriod)`
  // closure that reads the matching field out of a *different* period's aggregate() result — same
  // field name/key the row's own current-period value came from, just evaluated against `h.a` instead
  // of `a`. Only the handful of rows whose very shape can vary between periods (fee-type/gateway mix
  // breakdowns, ShipMonk per-store rows, reconciliation memo lines, one-off gap fallbacks) are left
  // without `hget`, which renders as a blank cell in the history columns for that row only.
  const SECTION_DEFAULT_OPEN = {cogs:true, opvar:true, mkt:true, logi:true, fixed:true, below:true};

  function renderStatement(){
    const rows = currentRows();
    const a = aggregate(rows);
    const built = buildRows(a);
    // [] in range mode (no "kỳ trước" concept there) - see the `hget` note above SECTION_DEFAULT_OPEN.
    // Full array so the CURRENT period (last entry, current:true) also gets its own date/label in the
    // header - a bare "Số tiền" column with no date next to 6 clearly-dated history columns reads as
    // "just a total", not "the period you picked", and gets missed for the history beside it (28/09 bug report).
    const trailFull = trailingPeriods(7);
    const hist = trailFull.slice(0, -1).map(p=>({label:p.label, sub:p.sub, a: aggregate(p.rows)}));
    const curP = trailFull.length ? trailFull[trailFull.length-1] : null;
    const totalCols = 1 + (hist.length+1)*2;
    const table = document.getElementById('stmtTable');
    table.classList.toggle('multihist', hist.length>0);
    table.style.minWidth = hist.length>0 ? (480 + hist.length*120)+'px' : '';
    const wrap = table.closest('.stmt-wrap'); if(wrap) wrap.classList.toggle('has-hist', hist.length>0);
    const histHeadCells = hist.map(h=>`<th class="num hist grpstart">${h.label}${h.sub?`<br><span class="sub">${h.sub}</span>`:''}</th><th class="pct hist">%</th>`).join('');
    const curHead = curP
      ? `<th class="num cur grpstart">${curP.label}${curP.sub?`<br><span class="sub">${curP.sub}</span>`:''}<br><span class="sub cur-tag">${tv('— selected', '— đang xem')}</span></th><th class="pct cur">%</th>`
      : `<th class="num cur grpstart">${tv('Amount', 'Số tiền')}</th><th class="pct cur">${tv('% of net rev.', '% DT thuần')}</th>`;
    let html = `<thead><tr><th>${tv('Line item', 'Khoản mục')}</th>${histHeadCells}${curHead}</tr></thead><tbody>`;
    let curSection = null, sectionOpen = true;
    const histCells = r => {
      if(!hist.length) return '';
      if(!r.hget) return '<td class="num hist grpstart"></td><td class="pct hist"></td>' + '<td class="num hist"></td><td class="pct hist"></td>'.repeat(Math.max(0, hist.length-1));
      return hist.map((h,i)=>{
        const v = r.hget(h.a);
        const nrH = h.a.netRevenue;
        const pctV = nrH ? v/nrH*100 : 0;
        return `<td class="num hist${i===0?' grpstart':''}${v<0?' neg':''}">${money(v,{compact:true})}</td><td class="pct hist">${pctV.toFixed(1)}%</td>`;
      }).join('');
    };
    built.forEach(r=>{
      if(r.t==='section'){
        curSection = r.key;
        sectionOpen = collapsed[curSection]===undefined ? SECTION_DEFAULT_OPEN[curSection] : !collapsed[curSection];
        html += `<tr class="section" data-toggle="${r.key}"><td class="label" colspan="${totalCols}"><span class="caret ${sectionOpen?'open':''}">▸</span> ${r.label}</td></tr>`;
        return;
      }
      const hiddenCls = ((r.t==='line' || r.t==='group') && curSection && r.key===curSection && !sectionOpen) ? 'hidden' : '';
      if(r.t==='group'){
        html += `<tr class="group ${hiddenCls}" data-sec="${curSection||''}"><td class="label">${r.label}</td>${histCells(r)}<td class="num cur grpstart">${money(r.value)}</td><td class="pct cur">${pctStr(r.pct)}</td></tr>`;
      } else if(r.t==='line'){
        const tagHtml = r.tag ? `<span class="tag ${r.tag}"><span class="d"></span>${r.tag==='var'?tx('tag.var'):tx('tag.fix')}</span>` : '';
        const gapHtml = r.gap ? `<span class="tag gap"><span class="d"></span>${r.gap==='manual' ? tx('tag.gapManual') : tx('tag.gap')}</span>` : '';
        const liveHtml = r.live ? `<span class="tag live"><span class="d"></span>${r.live==='real'?tx('tag.real'): r.live==='manual' ? tx('tag.manual') : 'Live'}</span>` : '';
        const estHtml = r.est ? `<span class="tag info" title="${r.estTitle || tx('tag.estDefault')}"><span class="d"></span>${tx('tag.est')}</span>` : '';
        const detailCls = r.detail ? 'detail' : '';
        html += `<tr class="line ${r.neg?'neg':''} ${detailCls} ${hiddenCls}" data-sec="${curSection||''}"><td class="label">${r.label}${tagHtml}${gapHtml}${liveHtml}${estHtml}</td>${histCells(r)}<td class="num cur grpstart">${money(r.value)}</td><td class="pct cur">${pctStr(r.pct)}</td></tr>`;
      } else if(r.t==='subtotal'){
        html += `<tr class="subtotal"><td class="label">${r.label}</td>${histCells(r)}<td class="num cur grpstart">${money(r.value)}</td><td class="pct cur">${pctStr(r.pct)}</td></tr>`;
      } else if(r.t==='final'){
        html += `<tr class="final"><td class="label">${r.label}</td>${histCells(r)}<td class="num cur grpstart">${money(r.value)}</td><td class="pct cur">${pctStr(r.pct)}</td></tr>`;
      }
    });
    html += '</tbody>';
    table.innerHTML = html;
    table.querySelectorAll('tr.section').forEach(tr=>{
      tr.addEventListener('click', ()=>{
        const key = tr.dataset.toggle;
        const openNow = collapsed[key]===undefined ? SECTION_DEFAULT_OPEN[key] : !collapsed[key];
        collapsed[key] = openNow;
        renderStatement();
      });
    });
  }

  // ---------- cost to sell through each channel (take rate) ----------
  // Same figures as the P&L, regrouped per sales channel: transaction fees (marketplace commission / payment
  // processing), fulfillment & storage, marketing (ads, affiliates, D2C tools) as % of the channel's net revenue.
  function renderChannelCosts(){
    const grid = document.getElementById('channelCostGrid'); if(!grid) return;
    const a = aggregate(currentRows());
    const netOf = ch => a.gross[ch] - a.discountBy[ch] - a.refund[ch];
    const smCh = {...a.shipmonkByChannel};
    const smAll = a.postage + a.shipmonkPickPack + a.packaging;
    if(smCh.shopify + smCh.amazon + smCh.walmart < 0.01 && smAll > 0.01) smCh.shopify = smAll;   // ShipMonk JSON without by_store: all D2C
    const snowballSub = (a.gaItems.find(it=>it.key==='snowball_sub')||{}).value || 0;
    const d2cAds = AD_KEYS.filter(k=>k!=='amazonads').reduce((t,k)=>t+a.ads[k],0);
    const chans = [];
    chans.push({key:'amazon', name:'Amazon (FBA + FBM)', sub: tv('Amazon per-order fees, FBA, storage, marketplace ads', 'phí Amazon thu theo đơn, FBA, lưu kho, quảng cáo trên sàn'), net: netOf('amazon'), orders: a.orders.amazon, groups:[
      {label: tx('cc.txnFees'), rows:[
        {n: tv('Amazon commission (referral) & per-order fees', 'Hoa hồng Amazon (referral) & phí theo đơn'), s: tv('including refund administration fees, adjustments and Amazon reimbursements', 'gồm phí xử lý hoàn tiền, điều chỉnh và khoản Amazon trả lại'), v: a.amazonReferralFeesReal + a.amazonOtherFeesReal + a.amazonOtherUnclassifiedCost, est: a.amazonRefEst>0.5, gap: a.amazonOrdersReal===0 && a.orders.amazon>0},
      ]},
      {label: tx('cc.fulfil'), rows:[
        {n:'FBA fulfillment (pick, pack, ship)', v: a.fulfillment, est: a.amazonFbaEst>0.5},
        {n: tv('ShipMonk for FBM orders', 'ShipMonk cho đơn FBM'), v: smCh.amazon},
        {n: tv('FBA storage + Amazon service fees', 'Lưu kho FBA + phí dịch vụ Amazon'), s: tv('monthly storage, removal, returns, subscription', 'lưu kho tháng, removal, returns, subscription'), v: a.amazonLogistics},
      ]},
      {label: tx('cc.mktOn'), rows:[
        {n:'Amazon Ads (SP · SB · SD)', s: a.amazonAdsProvisionalDays>0 ? a.amazonAdsProvisionalDays+tv(' days after the Sellerboard export: provisional (partial day), updates automatically', ' ngày sau export Sellerboard: số tạm (một phần ngày), tự cập nhật') : '', v: a.ads.amazonads, gap: !amazonAdsMatched, est: a.amazonAdsProvisionalDays>0},
      ]},
    ]});
    chans.push({key:'shopify', name:'Shopify (D2C)', sub: tv('payment gateways, ShipMonk, ads, affiliates, D2C tools', 'cổng thanh toán, ShipMonk, quảng cáo, affiliate, công cụ D2C'), net: netOf('shopify'), orders: a.orders.shopify, groups:[
      {label: tx('cc.txnFees'), rows:[
        {n: tv('Payment gateways (Shopify Payments, PayPal, Afterpay estimate)', 'Cổng thanh toán (Shopify Payments, PayPal, Afterpay ước tính)'), v: a.paymentFeesAll, gap: a.paymentFeeDays===0 && a.paypalDays===0},
      ]},
      {label: tx('cc.fulfil'), rows:[
        {n: tv('ShipMonk per order (postage, pick & pack, packaging)', 'ShipMonk theo đơn (cước, pick & pack, bao bì)'), s: tv('including bulk packaging, credits and invoice differences', 'gồm bao bì mua sỉ, credit và chênh lệch hoá đơn'), v: smCh.shopify + a.shipmonkInvoiceExtras},
        {n: tv('ShipMonk warehousing (storage, receiving, returns, other fees)', 'Kho ShipMonk (lưu kho, receiving, hàng trả, phí khác)'), v: a.shipmonkLogistics},
      ]},
      {label:'Marketing', rows:[
        {n: tv('Ads (Meta, Google, TikTok, AppLovin)', 'Quảng cáo (Meta, Google, TikTok, AppLovin)'), v: d2cAds},
        {n: tv('Affiliate / creator commission (Snowball)', 'Hoa hồng affiliate / creator (Snowball)'), v: a.snowballCommission},
        {n: tv('D2C tools: Klaviyo + Social Snowball plan', 'Công cụ D2C: Klaviyo + gói Social Snowball'), s: tv('sits under G&A on the P&L', 'trên P&L nằm ở G&A'), v: a.klaviyoCost + snowballSub},
      ]},
    ]});
    if(a.walmartDays>0){
      chans.push({key:'walmart', name:'Walmart', sub: tv('commission by category from the reconciliation report; ShipMonk per order', 'hoa hồng theo danh mục từ báo cáo đối soát; ShipMonk theo đơn'), net: netOf('walmart'), orders: a.orders.walmart, groups:[
        {label: tx('cc.txnFees'), rows:[{n: tv('Walmart commission + other fees', 'Hoa hồng + phí khác Walmart'), s: tv('actual for reconciled orders, estimated for the rest', 'thật cho đơn đã đối soát, còn lại ước tính'), v: a.walmartFees, est: a.walmartFeesEst>0.5}]},
        {label: tx('cc.fulfil'), rows:[{n: tx('cc.shipmonkPerOrder'), v: smCh.walmart}]},
        {label: tx('cc.mktOn'), rows:[{n: tv('Walmart Connect ads', 'Quảng cáo Walmart Connect'), v: a.walmartAds}]},
      ]});
    } else if(netOf('walmart') > 0.01) chans.push({key:'walmart', name:'Walmart', sub: tv('marketplace fees not connected', 'phí sàn chưa kết nối'), net: netOf('walmart'), orders: a.orders.walmart, groups:[
      {label: tx('cc.txnFees'), rows:[{n: tv('Walmart marketplace fees', 'Phí sàn Walmart'), v: a.walmartFees, gap:true}]},
      {label: tx('cc.fulfil'), rows:[{n: tx('cc.shipmonkPerOrder'), v: smCh.walmart}]},
    ]});
    if(a.tiktokDays>0 || netOf('tiktok')>0.01){
      chans.push({key:'tiktok', name:'TikTok Shop', sub: tv('referral, creator, Smart Promotion; ShipMonk per order if there is a TikTok store', 'referral, creator, Smart Promotion; ShipMonk theo đơn nếu có store TikTok'), net: netOf('tiktok'), orders: a.orders.tiktok, groups:[
        {label: tx('cc.txnFees'), rows:[
          {n: tv('Referral + refund administration fee', 'Referral + phí xử lý hoàn tiền'), s: tv('6% of the seller\'s discounted price', '6% giá sau giảm của người bán'), v: a.tiktokFees, est: a.tiktokFeesEstSelling>0.5},
        ]},
        {label: tx('cc.fulfil'), rows:[{n: tv('ShipMonk per order (TikTok store)', 'ShipMonk theo đơn (store TikTok)'), v: smCh.tiktok||0}]},
        {label: tx('cc.mktOn'), rows:[
          {n: tv('Creator/affiliate commission', 'Hoa hồng creator/affiliate'), v: a.tiktokAffiliate, est: a.tiktokAffiliateEst>0.5},
          {n:'Smart Promotion', v: a.tiktokSmart, est: a.tiktokSmartEst>0.5},
        ]},
      ]});
    }
    const note = document.getElementById('channelCostNote');
    if(note) note.textContent = (netOf('walmart') <= 0.01 && smCh.walmart > 0.01) ? tv(' ShipMonk still ships Walmart orders (', ' ShipMonk còn ship đơn Walmart (')+money(smCh.walmart)+tv(' in the period, inside the P&L\'s COGS) — Walmart revenue is not connected, so no take rate is computed for this channel yet.', ' trong kỳ, nằm trong COGS của P&L) — doanh thu Walmart chưa kết nối nên chưa tính take rate cho kênh này.') : '';
    grid.innerHTML = chans.map(c=>{
      const total = c.groups.reduce((t,g)=>t+g.rows.reduce((u,r)=>u+r.v,0),0);
      const left = c.net - total;
      const pctOf = v => c.net>0 ? (v/c.net*100).toFixed(1)+'%' : '—';
      let rows = `<tr class="rev"><td class="name">${tv('Net revenue ', 'Doanh thu thuần ')}${CH_LABEL[c.key]}<small>${c.orders.toLocaleString('en-US')} ${tx('u.orders')} · ${tv('gross − discounts − refunds', 'gross − giảm giá − hoàn tiền')}</small></td><td class="num">${money(c.net)}</td><td class="pct">100%</td></tr>`;
      c.groups.forEach(g=>{
        rows += `<tr class="grp"><td colspan="3">${g.label}</td></tr>`;
        g.rows.forEach(r=>{ rows += `<tr><td class="name">${r.n}${r.s ? `<small>${r.s}</small>` : ''}${r.gap ? ' <span class="tag gap" style="margin-left:0;"><span class="d"></span>'+tx('tag.gap')+'</span>' : ''}${r.est ? ' <span class="tag info" style="margin-left:0;"><span class="d"></span>'+tx('tag.est')+'</span>' : ''}</td><td class="num">${money(-r.v)}</td><td class="pct">${pctOf(r.v)}</td></tr>`; });
      });
      rows += `<tr class="total"><td class="name">${tv('Taken by the channel & its services (take rate)', 'Kênh & dịch vụ đi kèm lấy (take rate)')}</td><td class="num">${money(-total)}</td><td class="pct">${pctOf(total)}</td></tr>`;
      rows += `<tr class="left ${left<0 ? 'bad' : ''}"><td class="name">${tv('Left to pay for product cost & G&amp;A', 'Còn lại để trả giá vốn sản phẩm & G&amp;A')}</td><td class="num">${money(left)}</td><td class="pct">${pctOf(left)}</td></tr>`;
      return `<div class="chan" style="--c:${CH_COLOR[c.key]}"><div class="chan-head"><div><div class="chan-name">${c.name}</div><div class="chan-sub">${c.sub}</div></div><div class="chan-rate"><div class="v">${c.net>0 ? (total/c.net*100).toFixed(1)+'%' : '—'}</div><div class="l">take rate</div></div></div><table>${rows}</table></div>`;
    }).join('');
  }

  // ---------- break-even ----------
  // ---------- trend: net revenue / total cost / net profit per week or month ----------
  const trendCache = {};   // bucket key -> {rev, varc, fixc, cost, profit, days, partial}
  const trendHidden = new Set();   // series ids switched off in the legend (click)
  function trendBucketsFor(){
    // which buckets to draw: week mode = 26 weeks ending at the selected week; month mode = every
    // month; range mode = the weeks (<=120 days) or months the range spans; day mode = none
    if(mode==='day') return null;
    if(mode==='week'){ const i = WEEKS.indexOf(selWeek); const from = Math.max(0, i-25); return {unit:'week', keys: WEEKS.slice(from, i+1), sel: selWeek}; }
    if(mode==='month') return {unit:'month', keys: MONTHS.slice(), sel: selMonth};
    const span = currentRows().length;
    if(span<=120){ const keys = WEEKS.filter(w=>weekMap[w].some(d=>d.iso>=rangeFrom && d.iso<=rangeTo)); return {unit:'week', keys, sel:null}; }
    const keys = MONTHS.filter(m=>monthMap[m].some(d=>d.iso>=rangeFrom && d.iso<=rangeTo)); return {unit:'month', keys, sel:null};
  }
  function trendValue(unit, key){
    const ck = LANG+':'+unit+':'+key;   // labels inside are language-specific
    if(trendCache[ck]) return trendCache[ck];
    const rows = unit==='week' ? weekMap[key] : monthMap[key];
    const a = aggregate(rows);
    const lastIso = rows[rows.length-1].iso, today = days[TOTAL_DAYS-1].iso;
    const full = unit==='week' ? rows.length===7 : rows.length===new Date(parseInt(key.slice(0,4),10), parseInt(key.slice(5,7),10), 0).getDate();
    const v = {rev: a.netRevenue, varc: a.variableTotal, fixc: a.fixedTotal, cost: a.netRevenue - a.netProfit, profit: a.netProfit, days: rows.length, partial: !full || lastIso===today,
               label: unit==='week' ? WEEK_LABEL(key) : MONTH_LABEL(key), short: unit==='week' ? fmtDate(rows[0].date) : tv(MONTHS_EN[parseInt(key.slice(5,7),10)-1]+' \''+key.slice(2,4), 'T'+parseInt(key.slice(5,7),10)+'/'+key.slice(2,4))};
    trendCache[ck] = v; return v;
  }
  function renderTrend(){
    const card = document.getElementById('trendCard');
    const spec = trendBucketsFor();
    if(!spec || spec.keys.length<2){ card.style.display='none'; return; }
    card.style.display = '';
    const pts = spec.keys.map(k=>({key:k, ...trendValue(spec.unit, k)}));
    document.getElementById('trendTitle').textContent = spec.unit==='week' ? tv('Weekly trend', 'Xu hướng theo tuần') : tv('Monthly trend', 'Xu hướng theo tháng');
    document.getElementById('trendNote').textContent = (spec.unit==='week' ? pts.length+tv(' weeks (Monday → Sunday)', ' tuần (Thứ Hai → Chủ Nhật)') : pts.length+tv(' months', ' tháng')) + ' · ' + pts[0].short + ' → ' + pts[pts.length-1].short + tv(' · same figures as the P&L table below', ' · cùng số với bảng P&L bên dưới');
    const revC = resolveVar('var(--series-1)'), varC = resolveVar('var(--series-cost)'), fixC = resolveVar('var(--series-fixed)'), profC = resolveVar('var(--series-4)');
    const grid_ = resolveVar('var(--gridline)'), muted = resolveVar('var(--ink-muted)'), ink = resolveVar('var(--ink-primary)'), accent = resolveVar('var(--accent)'), surface = resolveVar('var(--surface-card)');
    // 4 lines on one $ scale: fixed cost is dashed (second cue besides colour), each line is labelled at its last point
    const allSeries = [
      {id:'rev', name: tx('m.netRevenue'), color: revC},
      {id:'varc', name: tv('Variable costs', 'Chi phí biến đổi'), color: varC},
      {id:'fixc', name: tv('Operating costs (OpEx)', 'Chi phí hoạt động (OpEx)'), color: fixC, dash:'6,4'},
      {id:'profit', name: tv('Operating profit (EBITDA)', 'LN hoạt động (EBITDA)'), color: profC},
    ];
    if(!canView('pnl') && !canView('exec')){ allSeries.splice(1); trendHidden.clear(); }   // no P&L page for this user: costs / profit lines are not drawn
    const series = allSeries.filter(sr=>!trendHidden.has(sr.id));
    const legend = document.getElementById('trendLegend');
    legend.innerHTML = allSeries.map(sr=>{
      const off = trendHidden.has(sr.id);
      const sw = sr.dash ? `background:repeating-linear-gradient(90deg,${sr.color} 0 3px,transparent 3px 5px);height:3px;width:14px;border-radius:0` : `background:${sr.color}`;
      return `<button type="button" class="li${off?' off':''}" data-series="${sr.id}" aria-pressed="${!off}" title="${tv('Click to hide/show this line', 'Bấm để ẩn/hiện đường này')}"><span class="sw" style="${sw}"></span>${sr.name}</button>`;
    }).join('');
    legend.querySelectorAll('button[data-series]').forEach(b=>b.addEventListener('click', ()=>{
      const id = b.dataset.series;
      if(trendHidden.has(id)) trendHidden.delete(id); else if(trendHidden.size < allSeries.length-1) trendHidden.add(id);
      renderTrend();
    }));
    // draw at the container's own width: on a phone the SVG is then 1:1 with the screen, so 9.5px type stays 9.5px
    const wrapEl = document.getElementById('trendWrap'), cw = Math.round(wrapEl.clientWidth || 1120), narrow = cw < 640;
    const W = narrow ? Math.max(300, cw) : 1120, H = narrow ? 230 : 300, padL = narrow ? 50 : 64, padR = narrow ? 56 : 110, padT = 18, padB = narrow ? 28 : 34, plotW=W-padL-padR, plotH=H-padT-padB;
    const vals = pts.flatMap(p=>series.map(sr=>p[sr.id]));
    let yMin = Math.min(0, ...vals), yMax = Math.max(0, ...vals);
    if(yMax===yMin){ yMax = yMin+1; }
    // round the axis to a clean step
    const rawStep = (yMax-yMin)/5, mag = Math.pow(10, Math.floor(Math.log10(rawStep))), step = [1,2,2.5,5,10].map(m=>m*mag).find(sv=>sv>=rawStep) || rawStep;
    yMax = Math.ceil(yMax/step)*step;
    if(yMin<0) yMin = yMin - (yMax-yMin)*0.04;   // a small negative dip gets a little headroom, not a whole extra step
    const gridFrom = Math.ceil(yMin/step)*step;
    const n = pts.length;
    const x = i => padL + (n===1 ? plotW/2 : (i/(n-1))*plotW);
    const y = v => padT + plotH - ((v-yMin)/(yMax-yMin))*plotH;
    let svg = '';
    // selected bucket band
    const selIdx = spec.sel ? pts.findIndex(p=>p.key===spec.sel) : -1;
    const half = n>1 ? plotW/(n-1)/2 : plotW/2;
    if(selIdx>=0) svg += `<rect x="${x(selIdx)-half}" y="${padT}" width="${half*2}" height="${plotH}" fill="${accent}" opacity="0.10"/>`;
    for(let v=gridFrom; v<=yMax+1e-9; v+=step){
      const yy = y(v);
      svg += `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="${grid_}" stroke-width="${Math.abs(v)<1e-9?1.4:1}"/>`;
      svg += `<text x="${padL-8}" y="${yy+3}" text-anchor="end" font-size="9.5" fill="${muted}" font-family="var(--font-mono)">${money(v,{compact:true})}</text>`;
    }
    // x labels: at most ~13, always the first and the last
    const every = Math.max(1, Math.ceil(n/(narrow ? 5 : 13)));
    pts.forEach((p,i)=>{ if(i%every===0 || i===n-1) svg += `<text x="${x(i)}" y="${H-padB+16}" text-anchor="middle" font-size="9.5" fill="${muted}" font-family="var(--font-mono)">${p.short}</text>`; });
    // lines + markers
    series.forEach(sr=>{
      const d = pts.map((p,i)=>(i?'L':'M')+' '+x(i).toFixed(1)+' '+y(p[sr.id]).toFixed(1)).join(' ');
      svg += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${sr.dash?` stroke-dasharray="${sr.dash}"`:''}/>`;
      pts.forEach((p,i)=>{ svg += p.partial ? `<circle cx="${x(i)}" cy="${y(p[sr.id])}" r="3.2" fill="${surface}" stroke="${sr.color}" stroke-width="2"/>` : `<circle cx="${x(i)}" cy="${y(p[sr.id])}" r="2.6" fill="${sr.color}" stroke="${surface}" stroke-width="1"/>`; });
    });
    // direct labels at the last point (pushed apart if they collide)
    const last = pts[n-1];
    const labels = series.map(sr=>({sr, yy: y(last[sr.id]), txt: money(last[sr.id],{compact:true})})).sort((a,b)=>a.yy-b.yy);
    for(let i=1;i<labels.length;i++){ if(labels[i].yy - labels[i-1].yy < 13) labels[i].yy = labels[i-1].yy + 13; }
    labels.forEach(l=>{ svg += `<text x="${x(n-1)+8}" y="${l.yy+3.5}" font-size="10.5" fill="${l.sr.color}" font-family="var(--font-mono)" font-weight="600">${l.txt}</text>`; });
    svg += `<rect id="trendHit" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent"/>`;
    svg += `<line id="trendCursor" x1="0" y1="${padT}" x2="0" y2="${padT+plotH}" stroke="${ink}" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>`;
    const el = document.getElementById('trendChart');
    el.setAttribute('viewBox', `0 0 ${W} ${H}`); el.innerHTML = svg;
    // hover: nearest bucket -> tooltip
    const wrap = document.getElementById('trendWrap'), tip = document.getElementById('trendTip'), cursor = document.getElementById('trendCursor');
    const hit = document.getElementById('trendHit');
    const onMove = (ev)=>{
      const rect = el.getBoundingClientRect(); const px = (ev.clientX-rect.left)/rect.width*W;
      let i = Math.round((px-padL)/(n>1?plotW/(n-1):1)); i = Math.max(0, Math.min(n-1, i));
      const p = pts[i];
      cursor.setAttribute('x1', x(i)); cursor.setAttribute('x2', x(i)); cursor.setAttribute('opacity','1');
      const pctOf = v => p.rev ? (v/p.rev*100).toFixed(1)+tv('% of rev.', '% DT') : '—';
      tip.innerHTML = `<div class="t-title">${p.label}${p.partial?tv(' · not finished', ' · chưa kết thúc'):''}</div>`
        + allSeries.map(sr=>`<div class="t-row"><span style="color:${sr.color}">■ ${sr.name}</span><span>${money(p[sr.id])}${sr.id==='varc'||sr.id==='fixc'?' · '+pctOf(p[sr.id]):''}</span></div>`).join('')
        + `<div class="t-row"><span>${tv('Total costs', 'Tổng chi phí')}</span><span>${money(p.cost)}</span></div><div class="t-row"><span>${tv('EBITDA margin', 'Biên EBITDA')}</span><span>${p.rev ? (p.profit/p.rev*100).toFixed(1)+'%' : '—'}</span></div>`;
      const left = (ev.clientX-rect.left), top = (ev.clientY-rect.top);
      const tw = tip.offsetWidth || 230;
      tip.style.left = Math.max(0, Math.min(left+14, wrap.clientWidth-tw))+'px'; tip.style.top = Math.max(0, top-70)+'px'; tip.style.opacity = '1';
    };
    hit.addEventListener('mousemove', onMove);
    hit.addEventListener('mouseleave', ()=>{ tip.style.opacity='0'; cursor.setAttribute('opacity','0'); });
    // touch: a finger on the chart shows the same tooltip (tap or drag); it goes away on release
    const touchPt = ev => (ev.touches && ev.touches[0]) ? ev.touches[0] : ev;
    hit.addEventListener('touchstart', ev=>onMove(touchPt(ev)), {passive:true});
    hit.addEventListener('touchmove', ev=>onMove(touchPt(ev)), {passive:true});
    hit.addEventListener('touchend', ()=>{ setTimeout(()=>{ tip.style.opacity='0'; cursor.setAttribute('opacity','0'); }, 1500); }, {passive:true});
    hit.addEventListener('click', (ev)=>{   // click a bucket to select it
      const rect = el.getBoundingClientRect(); const px = (ev.clientX-rect.left)/rect.width*W;
      let i = Math.round((px-padL)/(n>1?plotW/(n-1):1)); i = Math.max(0, Math.min(n-1, i));
      if(spec.unit==='week' && mode==='week'){ selWeek = pts[i].key; renderAll(); }
      else if(spec.unit==='month' && mode==='month'){ selMonth = pts[i].key; renderAll(); }
    });
  }

  function renderBreakeven(){
    const rows = currentRows();
    const a = aggregate(rows);
    const grid = document.getElementById('beGrid');
    const beOk = isFinite(a.breakEvenRevenue) && a.breakEvenRevenue>=0;
    const gap = beOk ? a.netRevenue - a.breakEvenRevenue : -Infinity;
    grid.innerHTML = `
      <div class="be-stat"><div class="l">${tv('Operating costs (OpEx)', 'Chi phí hoạt động (OpEx)')}</div><div class="v">${money(a.fixedTotal)}</div></div>
      <div class="be-stat"><div class="l">${tv('Contribution margin (CM %)', 'Biên đóng góp (CM %)')}</div><div class="v">${(a.cmRatio*100).toFixed(1)}%</div></div>
      <div class="be-stat"><div class="l">${tv('Break-even revenue', 'Doanh thu hoà vốn')}</div><div class="v">${beOk ? money(a.breakEvenRevenue) : '—'}</div></div>
      <div class="be-stat"><div class="l">${gap>=0?tv('Above break-even', 'Vượt hoà vốn'):tv('Short of break-even', 'Còn thiếu để hoà vốn')}</div><div class="v ${gap>=0?'good':'bad'}">${beOk ? money(Math.abs(gap)) : 'CM ≤ 0'}</div></div>
    `;

    const beWrap = document.getElementById('beChart').parentElement, bcw = Math.round(beWrap.clientWidth || 1120), bnarrow = bcw < 640;
    const W = bnarrow ? Math.max(300, bcw) : 1120, H = bnarrow ? 220 : 260, padL = bnarrow ? 50 : 56, padR = 16, padT = 16, padB = 30;
    const plotW=W-padL-padR, plotH=H-padT-padB;
    const beFinite = isFinite(a.breakEvenRevenue) && a.breakEvenRevenue>=0;
    const maxX = Math.max(beFinite ? a.breakEvenRevenue : 0, a.netRevenue, a.fixedTotal, 1)*1.45;   // CM ≤ 0 -> no finite break-even: draw costs vs revenue only
    const x = v=> padL + (v/maxX)*plotW;
    const yMax = Math.max(maxX, a.fixedTotal + a.variableRatio*maxX);
    const y = v=> padT + plotH - (v/yMax)*plotH;
    const grid_ = resolveVar('var(--gridline)'), muted = resolveVar('var(--ink-muted)');
    const revColor = resolveVar('var(--series-1)'), costColor = resolveVar('var(--series-cost)'), curColor = resolveVar('var(--ink-primary)');

    let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">`;
    for(let i=0;i<=4;i++){
      const v = yMax*i/4, yy=y(v);
      svg += `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="${grid_}" stroke-width="1"/>`;
      svg += `<text x="${padL-8}" y="${yy+3}" text-anchor="end" font-size="9.5" fill="${muted}" font-family="var(--font-mono)">${money(v,{compact:true})}</text>`;
    }
    // cost line
    const costPath = `M ${x(0)} ${y(a.fixedTotal)} L ${x(maxX)} ${y(a.fixedTotal + a.variableRatio*maxX)}`;
    svg += `<path d="${costPath}" fill="none" stroke="${costColor}" stroke-width="2.2"/>`;
    // revenue line
    svg += `<path d="M ${x(0)} ${y(0)} L ${x(maxX)} ${y(maxX)}" fill="none" stroke="${revColor}" stroke-width="2.2"/>`;
    // break-even point
    if(isFinite(a.breakEvenRevenue)){
      const bx = x(a.breakEvenRevenue), by = y(a.breakEvenRevenue);
      svg += `<circle cx="${bx}" cy="${by}" r="4.5" fill="${curColor}"/>`;
      svg += `<text x="${bx}" y="${by-10}" text-anchor="middle" font-size="10.5" fill="${curColor}" font-family="var(--font-body)" font-weight="600">${tv('Break-even: ', 'Hoà vốn: ')}${money(a.breakEvenRevenue,{compact:true})}</text>`;
    }
    // current point
    const cx_ = x(a.netRevenue), ccost = a.fixedTotal + a.variableRatio*a.netRevenue;
    svg += `<line x1="${cx_}" y1="${padT}" x2="${cx_}" y2="${H-padB}" stroke="${muted}" stroke-width="1" stroke-dasharray="3,3"/>`;
    svg += `<circle cx="${cx_}" cy="${y(a.netRevenue)}" r="4" fill="${revColor}"/>`;
    svg += `<text x="${cx_}" y="${H-10}" text-anchor="middle" font-size="9.5" fill="${muted}" font-family="var(--font-mono)">${tv('Current', 'Hiện tại')}</text>`;
    svg += `<text x="${W-padR}" y="${padT+10}" text-anchor="end" font-size="10.5" fill="${revColor}" font-family="var(--font-body)" font-weight="600">${tv('■ Revenue', '■ Doanh thu')}</text>`;
    svg += `<text x="${W-padR}" y="${padT+24}" text-anchor="end" font-size="10.5" fill="${costColor}" font-family="var(--font-body)" font-weight="600">${tv('■ Total costs', '■ Tổng chi phí')}</text>`;
    svg += `</svg>`;
    document.getElementById('beChart').outerHTML = svg.replace('<svg ','<svg id="beChart" ');
  }

  // ---------- ROAS / MER ----------
  // The ad sources report on different clocks: Meta / Google / AppLovin / TikTok sync every 30 min (today included),
  // while the Sellerboard export behind Amazon Ads lands once a day, some hours after the LA day has closed.
  // A day only counts toward MER once EVERY connected ad source has reported it - otherwise MER divides the full
  // revenue by part of the spend and looks better than it is (e.g. 05/10: 2.22x shown vs ~1.9x once Amazon Ads arrived).
  const AD_REAL_FLAG = {meta:'metaReal', google:'googleReal', applovin:'applovinReal', tiktokads:'tiktokAdsReal', amazonads:'amazonAdsReal'};
  function adMatched(k){
    return k==='meta' ? metaMatched : k==='google' ? googleMatched : k==='applovin' ? applovinMatched : k==='tiktokads' ? tiktokAdsMatched : k==='amazonads' ? amazonAdsMatched : false;
  }
  function adLastDay(k){
    if(!adMatched(k)) return null;
    const src = {meta: META_ADS_LIVE_DATA, google: GOOGLE_ADS_LIVE_DATA, applovin: APPLOVIN_LIVE_DATA, tiktokads: TIKTOK_ADS_LIVE_DATA, amazonads: AMAZON_ADS_LIVE_DATA}[k];
    if(!src || !src.daily) return null;
    if(k==='amazonads'){ const au = src.meta && src.meta.automation; if(au && au.fetched_last_day) return au.fetched_last_day; }
    const ks = Object.keys(src.daily).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
    return ks.length ? ks[ks.length-1] : null;
  }
  const dmShort = iso => iso ? iso.slice(8,10)+'/'+iso.slice(5,7) : '';
  function dmRange(list){ if(!list.length) return ''; const a0 = list[0], a1 = list[list.length-1]; return a0===a1 ? dmShort(a0) : dmShort(a0)+'–'+dmShort(a1); }
  // ad sources still missing a day (connected, but their data does not reach it yet)
  function adPendingKeys(r){ return AD_KEYS.filter(k=>{ const l = adLastDay(k); return l && r.iso > l; }); }
  function elapsedShareOfDay(tz){
    try{
      const parts = new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
      const g = t => parseInt(parts.find(x=>x.type===t).value,10);
      return Math.min(1, Math.max(0.02, (g('hour')*60 + g('minute'))/1440));
    }catch(e){ return 1; }
  }
  function merOf(rowsSet){ const x = aggregate(rowsSet); return {mer: x.merSpend>0 ? x.netRevenue/x.merSpend : 0, spend: x.merSpend, revenue: x.netRevenue}; }

  function renderRoas(){
    const rows = currentRows();
    const a = aggregate(rows);
    const colors = [resolveVar('var(--series-1)'),resolveVar('var(--series-2)'),resolveVar('var(--series-4)'),resolveVar('var(--series-3)'),resolveVar('var(--series-5)')];
    document.getElementById('roasGrid').innerHTML = AD_KEYS.map((k,i)=>{
      const roas = k==='amazonads' && a.amazonAdsConsoleSpend>0 ? a.amazonRoas : (a.ads[k]>0 ? a.adsAttr[k]/a.ads[k] : 0);   // Amazon: same maths as the Ads console (Sales ÷ Total cost)
      const noteStar = (k==='amazonads' && !amazonAdsMatched) ? ' *' : '';
      const last = adLastDay(k);
      const flag = AD_REAL_FLAG[k];
      const okDays = flag ? rows.filter(r=> r[flag] && !(last && r.iso > last)).length : 0;   // days with final numbers
      const pendDays = last ? rows.filter(r=> r.iso > last).length : 0;                        // days the source has not reported yet
      const realPurch = k==='meta' ? a.metaAdsPurchases : k==='google' ? a.googleAdsPurchases : k==='amazonads' ? a.amazonAdsPurchases : k==='applovin' ? a.applovinPurchases : k==='tiktokads' ? a.tiktokAdsOrders : 0;
      const unconnected = !!AD_UNCONNECTED[k] || !adMatched(k);
      const tag = (cls, txt, tit) => `<span class="tag ${cls}" style="margin-left:6px;"${tit ? ` title="${tit}"` : ''}><span class="d"></span>${txt}</span>`;
      const liveTag = unconnected ? tag('gap', tx('u.notConnected'))
        : okDays===0 && pendDays>0 ? tag('info', tv('Waiting · data to ', 'Chờ số · có đến ')+dmShort(last), k==='amazonads' ? tv('Sellerboard exports Amazon Ads once a day, a few hours after the (LA) day ends — this day is not in the file yet', 'Sellerboard xuất số Amazon Ads 1 lần/ngày, vài giờ sau khi ngày (giờ LA) kết thúc — ngày này chưa có trong file') : tv('The source has not synced up to this day yet', 'Nguồn chưa đồng bộ tới ngày này'))
        : okDays===0 ? tag('info', tv('Outside window', 'Ngoài cửa sổ'))
        : okDays===a.n ? tag('live', 'Live')
        : okDays+pendDays>=a.n ? tag('live', tv('Live · data to ', 'Live · số đến ')+dmShort(last), (pendDays)+tv(' days at the end of the period have no figures yet — not counted in MER', ' ngày cuối kỳ chưa có số — không tính vào MER'))
        : tag('live', tv('Partly live', 'Live một phần'), (a.n-okDays-pendDays)+tv(' days are outside this source\'s history', ' ngày nằm ngoài lịch sử nguồn này'));
      const unit = k==='google' ? tv('attributed conv.', 'conv. quy về') : tv('attributed orders', 'đơn quy về');
      const extra = okDays>0 && realPurch>0 ? ` · ${Math.round(realPurch).toLocaleString('en-US')} ${unit}` : '';
      const idle = !unconnected && okDays>0 && a.ads[k]<0.005 ? tv(' · not running in the period', ' · không chạy trong kỳ') : '';
      const amzSalesNote = (k==='amazonads' && a.amazonAdsConsoleSpend>0 && a.amazonAdsSalesDays<a.amazonAdsRealDays)
        ? `<div class="kv"><span title="${tv('Sales matching the Amazon Ads console exist only for the days pulled from Sellerboard\'s PPC dashboard; ROAS/ACOS here use the spend of exactly those days', 'Sales khớp Amazon Ads console chỉ có cho các ngày đã kéo từ PPC dashboard của Sellerboard; ROAS/ACOS ở đây chỉ tính trên chi phí của đúng những ngày đó')}">${tv('ROAS/ACOS on ', 'ROAS/ACOS tính trên ')}${a.amazonAdsSalesDays}/${a.amazonAdsRealDays}${tv(' days with Sales', ' ngày có Sales')}${AMAZON_ADS_LIVE_DATA && AMAZON_ADS_LIVE_DATA.meta && AMAZON_ADS_LIVE_DATA.meta.ppc_last_day ? tv(' (to ', ' (đến ')+dmShort(AMAZON_ADS_LIVE_DATA.meta.ppc_last_day)+')' : ''}</span></div>` : '';
      const roasTxt = k==='amazonads' && a.amazonAdsConsoleSpend>0 && a.amazonAdsSalesDays===0 ? '—' : (a.ads[k]>0 ? roas.toFixed(2)+'x' : '—');
      return `<div class="roas-card" style="--c:${colors[i]}">
        <div class="p">${AD_LABEL[k]}${noteStar}${liveTag}</div>
        <div class="roas">${roasTxt}</div>
        <div class="sub">${tv('Spend: ', 'Chi: ')}${money(k==='amazonads' && a.amazonAdsConsoleSpend>0 ? a.amazonAdsConsoleSpend : a.ads[k])}${idle}${tv(' · Attributed revenue: ', ' · DT quy về: ')}${k==='amazonads' && a.amazonAdsConsoleSpend>0 && a.amazonAdsSalesDays===0 ? tv('no figures yet', 'chưa có số') : money(a.adsAttr[k])}${extra}</div>
        ${k==='amazonads' && a.amazonAdsConsoleSpend>0 ? `<div class="kv"><span title="${tv('ACOS = SP+SB+SD spend ÷ Amazon revenue attributed to ads (same maths as the Amazon Ads console)', 'ACOS = chi SP+SB+SD ÷ doanh thu Amazon gán cho quảng cáo (cùng cách tính với Amazon Ads console)')}"><b>ACOS</b> ${a.adsAttr[k]>0 ? (a.amazonAcos*100).toFixed(1)+'%' : '—'}</span><span title="${tv('TACOS = Amazon ad spend (SP+SB+SD) ÷ Amazon gross sales of the period', 'TACOS = chi quảng cáo Amazon (SP+SB+SD) ÷ doanh thu gộp Amazon của kỳ')}"><b>TACOS</b> ${a.amazonTacos>0 ? (a.amazonTacos*100).toFixed(1)+'%' : '—'}</span>${a.amazonAdsImpressions>0 ? `<span title="CTR = clicks ÷ impressions">CTR ${(a.amazonAdsClicks/a.amazonAdsImpressions*100).toFixed(2)}%</span>` : ''}${a.amazonAdsSplit.stv>0.005 ? `<span title="${tv('Sellerboard also records this \'Sponsored Television\' amount but the Amazon Ads console has no such campaign — not counted in the P&L', 'Sellerboard ghi thêm khoản \'Sponsored Television\' này nhưng Amazon Ads console không có chiến dịch nào — không tính vào P&L')}">Sellerboard +${money(a.amazonAdsSplit.stv)} STV ${tv('(ignored)', '(bỏ qua)')}</span>` : ''}</div>` : ''}
        ${amzSalesNote}
      </div>`;
    }).join('');

    // MER on the days every connected ad source has reported
    const pendingByDay = rows.map(r=>({iso: r.iso, keys: adPendingKeys(r)}));
    const completeRows = rows.filter((r,i)=> pendingByDay[i].keys.length===0);
    const pendingRows = rows.filter((r,i)=> pendingByDay[i].keys.length>0);
    const missing = {};   // source -> days it has not reported
    pendingByDay.forEach(p=> p.keys.forEach(k=>{ (missing[k] = missing[k] || []).push(p.iso); }));
    const missTxt = Object.keys(missing).map(k=> AD_LABEL[k]+' '+dmRange(missing[k])).join(', ');
    const whyAmz = missing.amazonads ? tv(' (Sellerboard exports Amazon Ads once a day — yesterday\'s figures usually arrive after ~18:00 Vietnam time)', ' (Sellerboard xuất số Amazon Ads 1 lần/ngày — thường có số ngày hôm qua sau ~18h giờ VN)') : '';
    const valEl = document.getElementById('merValue'), noteEl = document.getElementById('merNote');
    const spendParts = 'Meta, Google, Amazon Ads, TikTok Ads, AppLovin' + (a.walmartAds>0.005 ? ' + Walmart Connect' : '');
    let val = '—', note = '';
    if(!pendingRows.length){
      val = a.merSpend>0 ? a.merValue.toFixed(2)+'x' : '—';
      note = a.merSpend>0 ? tv(`Net revenue ${money(a.netRevenue)} ÷ ad spend ${money(a.merSpend)} (${spendParts}) · every source complete.`, `Doanh thu thuần ${money(a.netRevenue)} ÷ chi quảng cáo ${money(a.merSpend)} (${spendParts}) · đủ số tất cả nguồn.`) : '';
    } else if(completeRows.length){
      const m = merOf(completeRows);
      const lastOk = completeRows[completeRows.length-1].iso;
      val = m.spend>0 ? m.mer.toFixed(2)+'x' : '—';
      note = tv(`Based on ${completeRows.length}/${rows.length} complete days (to ${dmShort(lastOk)}): revenue ${money(m.revenue)} ÷ spend ${money(m.spend)}. ${dmRange(pendingRows.map(r=>r.iso))} not counted yet because ${missTxt} is missing${whyAmz}.`, `Tính trên ${completeRows.length}/${rows.length} ngày đủ số (đến ${dmShort(lastOk)}): doanh thu ${money(m.revenue)} ÷ chi ${money(m.spend)}. Chưa tính ${dmRange(pendingRows.map(r=>r.iso))} vì chưa có ${missTxt}${whyAmz}.`);
    } else {
      // nothing complete yet (e.g. "today" / "yesterday" before the export): provisional, missing spend at the source's last-7-day run rate
      let estSpend = 0; const estParts = [];
      const todayIso = days[TOTAL_DAYS-1].iso, dayShare = elapsedShareOfDay(REPORT_TZ);   // today is still running: count only the elapsed part
      Object.keys(missing).forEach(k=>{
        const last = adLastDay(k); if(!last) return;
        const ref = days.filter(r=> r.iso<=last && r[AD_REAL_FLAG[k]]).slice(-7);
        const avg = ref.length ? sum(ref.map(r=>r.ads[k]))/ref.length : 0;
        estSpend += sum(missing[k].map(iso=> avg*(iso===todayIso ? dayShare : 1)));
        estParts.push(AD_LABEL[k]+' ≈ '+money(avg)+tx('u.perDay')+(missing[k].includes(todayIso) ? tv(' — today counted at '+Math.round(dayShare*100)+'% of the day elapsed', ' — hôm nay tính '+Math.round(dayShare*100)+'% ngày đã qua') : ''));
      });
      const tot = a.merSpend + estSpend;
      val = tot>0 ? '≈ '+(a.netRevenue/tot).toFixed(2)+'x' : '—';
      note = tv(`Provisional: ${missTxt} missing${whyAmz} — the missing part is estimated from the last 7 days' average (${estParts.join(', ')}). Replaced by the actual figures once the source updates. Ignoring the missing part, MER would show ${a.merSpend>0 ? a.merValue.toFixed(2)+'x' : '—'} (artificially high).`, `Tạm tính: chưa có ${missTxt}${whyAmz} — phần thiếu ước theo trung bình 7 ngày gần nhất (${estParts.join(', ')}). Số thật sẽ thay khi nguồn cập nhật. Nếu bỏ qua phần thiếu, MER sẽ hiện ${a.merSpend>0 ? a.merValue.toFixed(2)+'x' : '—'} (cao ảo).`);
    }
    valEl.textContent = val;
    if(noteEl){ noteEl.textContent = note; noteEl.hidden = !note; }
  }

  // ---------- tax ----------
  function renderTax(){
    const rows = currentRows();
    const a = aggregate(rows);
    const shopifyNote = shopifyMatched
      ? (a.shopifyRealDays<a.n ? ` <span style="color:var(--ink-muted);font-size:11px;">(${a.n-a.shopifyRealDays} ${tv(dayWord(a.n-a.shopifyRealDays)+' outside the sync window', 'ngày ngoài cửa sổ đồng bộ')})</span>` : '')
      : ' <span class="tag gap"><span class="d"></span>'+tx('tag.gap')+'</span>';
    const remits = who => tv(who+' remits it', who+' nộp hộ');
    const facil = who => tv(`(${who} collects &amp; remits it itself, not through Cattasaurus)`, `(${who} tự thu &amp; nộp hộ, không qua Cattasaurus)`);
    const body = `<tr>
        <td class="name">${tv('Shopify — tax collected from customers, net of tax refunded (= Taxes in Shopify Analytics)', 'Shopify — thuế thu hộ khách, đã trừ thuế hoàn lại (= Taxes trên Shopify Analytics)')}${shopifyNote}</td>
        <td class="num">${money(a.shopifyTax)}</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td><span class="pill warn">${tv('Tax filing source not connected', 'Chưa nối nguồn nộp thuế')}</span></td>
      </tr>
      <tr>
        <td class="name">Amazon — marketplace facilitator <span style="color:var(--ink-muted);font-size:11px;">${facil('Amazon')}</span></td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">$0</td>
        <td><span class="pill ok">${remits('Amazon')}</span></td>
      </tr>
` + ((!walmartMatched || !tiktokMatched) ? `
      <tr>
        <td class="name">${[!walmartMatched && 'Walmart', !tiktokMatched && 'TikTok Shop'].filter(Boolean).join(' / ')} <span class="tag gap"><span class="d"></span>${tx('tag.gap')}</span></td>
        <td class="num">$0</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td><span class="pill warn">${tx('u.notConnected')}</span></td>
      </tr>` : '') + (walmartMatched ? `
      <tr>
        <td class="name">Walmart — marketplace facilitator <span style="color:var(--ink-muted);font-size:11px;">${facil('Walmart')}</span></td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">$0</td>
        <td><span class="pill ok">${remits('Walmart')}</span></td>
      </tr>` : '') + (tiktokMatched ? `
      <tr>
        <td class="name">TikTok Shop — marketplace facilitator <span style="color:var(--ink-muted);font-size:11px;">${facil('TikTok')}</span></td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">$0</td>
        <td><span class="pill ok">${remits('TikTok')}</span></td>
      </tr>` : '');
    document.getElementById('taxBody').innerHTML = body;
  }

  // ---------- data health (tab "Quản lý dữ liệu") ----------
  const GH_ACTIONS_BASE = 'https://github.com/taitran-star/ctu-fin-sync-8x2k/actions/workflows/';
  // Per-source: the per-day flag object set by that source's apply*Rows() (used to compute freshness below),
  // and the GitHub Actions workflow file that keeps it in sync (null = manual / no workflow).
  const HEALTH_FLAG = {amazon:'amazonReal', amazonfin:'amazonReal', meta:'metaReal', google:'googleReal', amazonads:'amazonAdsReal', shopify:'shopifyReal', snowball:'shopifyReal', shipmonk:'shipmonkReal', shipmonk_inv:'shipmonkInv', paypal:'paypalReal', klaviyo:'klaviyoReal', tiktokshop:'tiktokReal', walmart:'walmartReal', applovin:'applovinReal', tiktokads:'tiktokAdsReal'};
  const HEALTH_WORKFLOW = {amazon:'amazon_pnl.yml', amazonfin:'amazon_pnl.yml', amazon_storage:'amazon_storage.yml', amazonads:'sellerboard_ads.yml', meta:'meta_ads.yml', google:'google_ads.yml', shopify:'shopify_pnl.yml', snowball:'shopify_pnl.yml', shipmonk:'shipmonk.yml', paypal:'paypal.yml', klaviyo:'klaviyo.yml', tiktokshop:'tiktok_shop.yml', walmart:'walmart.yml', applovin:'applovin.yml', tiktokads:'tiktok_ads.yml'};
  // How many of the last WINDOW calendar days (today excluded - most sources aren't expected to have
  // closed it yet) actually have real data for this source, and the most recent day that does (scanning
  // back up to SCANMAX days so a longer stale gap still gets reported instead of showing nothing).
  function sourceFreshness(flagKey){
    if(!flagKey) return null;
    const WINDOW = 14, SCANMAX = 60;
    let lastIso = null, present = 0, total = 0, scanned = 0;
    for(let i = days.length - 1; i >= 0 && scanned < SCANMAX; i--){
      if(days[i]._syncing) continue;   // today: not expected to be closed yet for most sources
      scanned++;
      const ok = !!days[i][flagKey];
      if(ok && !lastIso) lastIso = days[i].iso;
      if(scanned <= WINDOW){ total++; if(ok) present++; }
    }
    return {lastIso, present, total, pct: total ? Math.round(present/total*100) : 0};
  }
  function fmtLastIso(iso){ return iso ? iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4) : tv('no day yet', 'chưa có ngày nào'); }

  function renderSources(){
    const el = document.getElementById('healthGrid');
    if(!el) return;
    el.innerHTML = SOURCES.map(s=>{
      const fresh = sourceFreshness(HEALTH_FLAG[s.key]);
      const wf = HEALTH_WORKFLOW[s.key];
      const unconnected = s.level==='c' && !fresh;
      const statLine = fresh
        ? `<div class="stat"><span>${fresh.present}/${fresh.total} ${tx('u.days')}</span><span class="bar"><i style="width:${fresh.pct}%"></i></span><span>${tv('latest ', 'gần nhất ')}${fmtLastIso(fresh.lastIso)}</span></div>`
        : '';
      const ghLink = '';   // V11.6: no link to the sync jobs (not useful to readers)
      return `<div class="healthcard ${s.level}${unconnected?' unconnected':''}">
        <div class="hc-top"><span class="dot ${s.level}"></span><span class="name">${s.name}</span></div>
        <div class="age">${s.age}</div>
        ${statLine}
        ${ghLink}
      </div>`;
    }).join('');
  }
  function setSource(key, level, age){
    const s = SOURCES.find(x=>x.key===key);
    if(s){ s.level=level; s.age=age; }
  }

  // ---------- OpEx nhập tay (tab "Quản lý dữ liệu") ----------
  function renderOpexTable(){
    const el = document.getElementById('opexTable');
    if(!el) return;
    if(!opexMeta || !OPEX_MONTHLY_LIVE_DATA || !OPEX_MONTHLY_LIVE_DATA.months){
      el.innerHTML = '<tbody><tr><td style="padding:10px 2px;color:var(--ink-muted);">'+tv('No <code>data/opex_monthly.json</code> file yet, or no month filled in.', 'Chưa có file <code>data/opex_monthly.json</code> hoặc chưa điền tháng nào.')+'</td></tr></tbody>';
      return;
    }
    const months = OPEX_MONTHLY_LIVE_DATA.months;
    const cols = OPEX_GA_KEYS.concat(OPEX_BELOW_KEYS);
    const LABEL = {depreciation: tv('Depreciation & amortisation (D&A)', 'Khấu hao & phân bổ (D&A)'), interest: tv('Interest & finance costs', 'Lãi vay & chi phí tài chính'), income_tax: tv('Income tax', 'Thuế TNDN')};
    GA_ITEMS.forEach(it=>{ if(OPEX_GA_KEYS.includes(it.key)) LABEL[it.key] = it.label; });
    let html = `<thead><tr><th>${tv('Month', 'Tháng')}</th>${cols.map(k=>`<th class="num">${LABEL[k]||k}</th>`).join('')}</tr></thead><tbody>`;
    const estM = opexMeta.est || {};
    [...new Set(opexMeta.entered.concat(Object.keys(estM)))].sort().reverse().forEach(m=>{
      const row = months[m] || {}, e = estM[m];
      const mLabel = tv(MONTHS_EN[parseInt(m.slice(5,7),10)-1]+' '+m.slice(0,4), 'Tháng '+parseInt(m.slice(5,7),10)+'/'+m.slice(0,4));
      html += `<tr><td class="name">${mLabel}${e ? ' <span class="tag info" title="'+OPEX_EST_TITLE()+'"><span class="d"></span>'+tv('estimated','tạm tính')+'</span>' : ''}</td>${cols.map(k=>{
        if(e){
          const v = e.perMonth[k];
          return `<td class="num">${(v===undefined||v===null) ? '<span style="color:var(--ink-muted);">—</span>' : `<span title="${opexEstText(m,k)}" style="font-style:italic;">≈${money(v)}</span>`}</td>`;
        }
        const v = row[k];
        return `<td class="num">${(v===undefined||v===null||v==='') ? '<span style="color:var(--ink-muted);">—</span>' : money(parseFloat(v)||0)}</td>`;
      }).join('')}</tr>`;
    });
    html += '</tbody>';
    el.innerHTML = html;
  }

  // ---------- "what's missing" (Data tab) — V11.6: built from the data actually loaded, for the selected period ----------
  // Only real gaps are listed (red = material, amber = partial / small), each with what it is worth this period;
  // what is already real is summed up on one green line underneath.
  function renderGaps(){
    const el = document.getElementById('gapsList');
    if(!el) return;
    let a = null, rows = [];
    try{ rows = currentRows(); a = aggregate(rows); }catch(e){ a = null; }
    const gaps = [], done = [];
    const fmtM = m => m.slice(5,7)+'/'+m.slice(0,4);
    const span = ms => ms.length===1 ? fmtM(ms[0]) : fmtM(ms[0])+' → '+fmtM(ms[ms.length-1]);
    const pct = v => (v<1 && v>0 ? v.toFixed(1) : v.toFixed(0))+'%';
    SOURCES.filter(s=>s.level==='c').forEach(s=>gaps.push({lvl:'c', name:s.name, note:s.age}));
    // product cost
    if(a){
      if(a.productCostHasLots){
        const U = a.productCostLotUnits + a.productCostFbUnits + a.productCostEstUnits;
        const lotPct = U>0 ? a.productCostLotUnits/U*100 : 0, fbPct = U>0 ? a.productCostFbUnits/U*100 : 0;
        const estShare = a.productCost>0 ? a.productCostEstAmount/a.productCost*100 : 0;
        if(a.productCostEstAmount>0.5) gaps.push({lvl: estShare>10 ? 'c' : 'w', amt: a.productCostEstAmount,
          name: tv('Product cost: ','Giá vốn: ')+money(a.productCostEstAmount,{compact:true})+' ('+pct(estShare)+tv(' of product cost) still estimated at ',' giá vốn) còn ước ')+(a.cogsEstRate*100).toFixed(0)+'%',
          note: tv('sales without units per SKU — Walmart / TikTok Shop days before their SKU data, items without a SKU','doanh số chưa có units theo SKU — Walmart / TikTok Shop những ngày trước khi có SKU, hàng không gắn SKU')});
        done.push(tv('product cost FIFO by Notion receipt lot for ','giá vốn FIFO theo lô nhập Notion cho ')+pct(lotPct)+tv(' of units',' units')+(fbPct>=0.5 ? tv(' (+ ',' (+ ')+pct(fbPct)+tv(' at the nearest lot / per-SKU cost)',' theo giá lô gần nhất / giá SKU)') : ''));
        const g = COGS_LOTS_LIVE_DATA && (COGS_LOTS_LIVE_DATA.generated_at || (COGS_LOTS_LIVE_DATA.meta||{}).fetched_at);
        const ageD = g ? (Date.now()-new Date(g).getTime())/86400000 : null;
        if(ageD!==null && ageD>7) gaps.push({lvl:'w', name: tv('Receipt lots last read from Notion on ','Lô nhập đọc từ Notion lần cuối ')+String(g).slice(8,10)+'/'+String(g).slice(5,7)+'/'+String(g).slice(0,4),
          note: tv('receipts added in Notion after that date are priced at the nearest lot — add NOTION_TOKEN for the nightly sync or ask Claude to refresh','lô mới trên Notion sau ngày đó đang tính theo giá lô gần nhất — thêm NOTION_TOKEN để đồng bộ hằng đêm hoặc nhờ Claude cập nhật')});
      } else if(a.productCostEst || !a.productCostHasActual){
        gaps.push({lvl:'c', amt: a.productCost, name: tv('Cost of goods sold (COGS)', 'Giá vốn hàng bán (COGS)'), note: COGS_EST ? tv('ESTIMATED at ', 'Đang ƯỚC TÍNH ')+(COGS_EST.rate*100).toFixed(0)+tv('% of net revenue — receipt lots (data/cogs_lots.json) are not loaded', '% doanh thu thuần — chưa nạp được lô nhập (data/cogs_lots.json)') : tv('Actual product cost needed', 'Cần giá vốn thật')});
      } else done.push(tv('product cost from the accountant\'s inventory book','giá vốn theo sổ kho kế toán'));
    }
    // payment fees
    if(a){
      if(a.afterpayOrders>0) gaps.push({lvl:'w', amt: a.afterpayFees,
        name: tv('Afterpay fee: ','Phí Afterpay: ')+money(a.afterpayFees)+tv(' estimated (',' đang ước (')+a.afterpayOrders.toLocaleString('en-US')+' '+tx('u.orders')+', '+money(a.afterpayAmount,{compact:true})+tv(' collected)',' thu)'),
        note: tv('6% + $0.30 per order is an assumption — Afterpay\'s settlement report (merchant portal) or the contract rate replaces it','6% + $0,30/đơn là giả định — cần báo cáo settlement (merchant portal Afterpay) hoặc tỷ lệ hợp đồng để thay bằng số thật')});
      const pf = [];
      if(shopifyMeta && shopifyMeta.meta && shopifyMeta.meta.payment_fees_basis) pf.push('Shopify Payments');
      if(paypalMatched) pf.push('PayPal');
      if(pf.length) done.push(tv('actual payment fees for ','phí cổng thanh toán thật cho ')+pf.join(' + '));
    }
    // G&A (data/opex_monthly.json)
    const OM = OPEX_MONTHLY_LIVE_DATA && OPEX_MONTHLY_LIVE_DATA.months;
    if(!opexMeta || !OM) gaps.push({lvl:'c', name: tv('G&A (salaries, software, office…)','G&A (lương, phần mềm, văn phòng…)'), note: tv('enter per month in data/opex_monthly.json','nhập theo tháng vào data/opex_monthly.json')});
    else {
      const months = [...new Set(rows.map(r=>r.iso.slice(0,7)))].sort();
      const num = (m,k) => parseFloat(OM[m] && OM[m][k]) || 0;
      const isOpenM = m => (opexMeta.open||[]).includes(m);
      const prov = months.filter(m=>opexMeta.est && opexMeta.est[m]);
      const missing = months.filter(m=>!OM[m] && !prov.includes(m));
      const noVN = months.filter(m=>OM[m] && !isOpenM(m) && !(num(m,'office')>0));
      if(prov.length){
        const last = prov[prov.length-1];
        const KN = {salary: tv('payroll','nhân sự'), office: tv('office','văn phòng'), other: tv('other','khác'), accounting: tv('accounting','kế toán'), software: tv('software','phần mềm')};
        const grp = {};
        ['salary','office','other','accounting','software'].forEach(k=>{ const t = opexEstText(last,k); if(t) (grp[t] = grp[t] || []).push(KN[k]); });
        gaps.push({lvl:'w', amt: a ? a.opexEstAmount : 0,
          name: tv('G&A ','G&A ')+span(prov)+tv(' estimated (month not closed)',' đang tạm tính (tháng chưa chốt)')+(a && a.opexEstAmount>0 ? ': '+money(a.opexEstAmount,{compact:true}) : ''),
          note: Object.keys(grp).map(t=>grp[t].join(', ')+' = '+t).join(' · ')+tv(' — enter the actual month in data/opex_monthly.json once the books close',' — nhập số thật của tháng vào data/opex_monthly.json khi chốt sổ')});
      }
      if(missing.length) gaps.push({lvl:'w', name: tv('G&A ','G&A ')+span(missing)+tv(' not entered',' chưa nhập'), note: tv('no earlier closed month to estimate from — add the month to data/opex_monthly.json','chưa có tháng đã chốt để tạm tính — thêm tháng vào data/opex_monthly.json')});
      if(noVN.length) gaps.push({lvl:'w', name: tv('G&A ','G&A ')+span(noVN)+tv(': no Vietnam payroll / office yet',': chưa có lương & văn phòng VN'), note: tv('these months only have Upwork contractors, software and accounting — add the Vietnam cost file for them if there were costs','các tháng này mới có Upwork, phần mềm, kế toán — bổ sung file chi phí VN nếu có phát sinh')});
      const entered = months.filter(m=>OM[m] && !isOpenM(m));
      if(entered.length) done.push(tv('G&A entered monthly ','G&A nhập theo tháng ')+span(entered)+tv(' (salaries incl. Upwork, software, office, accounting, other)',' (lương gồm Upwork, phần mềm, văn phòng, kế toán, khác)'));
      if(entered.length && entered.every(m=>!(num(m,'depreciation')>0) && !(num(m,'interest')>0)))
        gaps.push({lvl:'w', name: tv('Depreciation & interest not entered','Khấu hao & lãi vay chưa nhập'), note: tv('below EBITDA only — enter per month in data/opex_monthly.json if there are any','chỉ ảnh hưởng dưới EBITDA — nhập theo tháng vào data/opex_monthly.json nếu có')});
    }
    const order = {c:0, w:1};
    gaps.sort((x,y)=> order[x.lvl]-order[y.lvl] || (y.amt||0)-(x.amt||0));
    el.innerHTML = (gaps.length
        ? gaps.map(g=>`<div class="gap-row ${g.lvl==='c'?'crit':'warn'}"><span class="dot ${g.lvl}"></span><span class="g-name">${g.name}</span><span class="g-note">${g.note||''}</span></div>`).join('')
        : '<div class="caption" style="padding-left:0;">'+tv('No known gaps left', 'Không còn khoảng trống nào đã biết')+'</div>')
      + (done.length ? `<div class="gap-row ok"><span class="dot g"></span><span class="g-name">${tv('Already real: ','Đã có số thật: ')}${done.join(' · ')}</span></div>` : '');
  }

  // ---------- Amazon data-quality gaps (service fees / ad spend not yet captured) ----------
  function renderAmazonGaps(){
    const card = document.getElementById('amazonGapsCard');
    if(!amazonMatched){ card.style.display='none'; return; }
    card.style.display = '';
    const warnings = (amazonMeta && Array.isArray(amazonMeta.warnings)) ? amazonMeta.warnings : [];
    const schema2 = !!(amazonMeta && amazonMeta.schema >= 2);
    const diag = (schema2 && amazonMeta.diagnostics) || null;
    // Total service fees over the whole loaded window - tells us whether the API sent ANY.
    const svcTotal = days.reduce((s,d)=> s + (d.amazonReal ? d.amazonReal.serviceFees : 0), 0);
    let html = '<div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;color:var(--ink-secondary);">';
    if(amazonOrderBasisDays>0){
      const sel = currentRows().filter(r=>r.amazonReal && r.amazonReal.orderBasis);
      const ordered = sum(sel.map(r=>r.channels.amazon)), posted = sum(sel.map(r=>r.amazonReal.postedGross));
      const mcfU = sum(sel.map(r=>r.amazonReal.mcfUnits)), mcfO = sum(sel.map(r=>r.amazonReal.mcfOrders)), pend = sum(sel.map(r=>r.amazonReal.pendingUnits));
      html += tv(`<div><span class="tag live"><span class="d"></span>By order date</span> <b>Amazon revenue</b> in the selected period: <b>${money(ordered)}</b> by the day the customer ordered (All Orders report — the way Seller Central/Sellerboard count it) vs ${money(posted)} by the day Amazon shipped &amp; posted the money (Finances). Fees and refunds stay on their posting date.${mcfU?` MCF orders (Shopify orders shipped by FBA) are kept separate: ${mcfO.toLocaleString('en-US')} orders / ${mcfU.toLocaleString('en-US')} units — not counted in Amazon revenue.`:''}${pend?` ${pend.toLocaleString('en-US')} units still Pending have no price yet (Amazon has not released it) → not in revenue yet.`:''}</div>`,
        `<div><span class="tag live"><span class="d"></span>Theo ngày đặt</span> <b>Doanh thu Amazon</b> trong khoảng đang xem: <b>${money(ordered)}</b> theo ngày khách đặt (All Orders report — cách Seller Central/Sellerboard tính) so với ${money(posted)} theo ngày Amazon ship &amp; ghi nhận tiền (Finances). Phí, hoàn tiền vẫn theo ngày ghi nhận.${mcfU?` Đơn MCF (Shopify do FBA ship) tách riêng: ${mcfO.toLocaleString('en-US')} đơn / ${mcfU.toLocaleString('en-US')} units — không tính vào doanh thu Amazon.`:''}${pend?` ${pend.toLocaleString('en-US')} units đang Pending chưa có giá (Amazon chưa công bố) → chưa vào doanh thu.`:''}</div>`);
    }
    if(svcTotal===0){
      const svcNote = schema2
        ? tv('Script v2 handles ServiceFeeEventList + removal fees, but SP-API Finances still returns nothing in the sync window — see the event-type log below; if it stays empty after a few syncs, these must come from the Reports API (monthly FBA storage fee report) instead of Finances.', 'Script v2 đã xử lý ServiceFeeEventList + removal fees nhưng SP-API Finances vẫn không trả về khoản nào trong cửa sổ đồng bộ — xem log loại sự kiện bên dưới; nếu vẫn trống sau vài lần sync, cần lấy từ Reports API (báo cáo phí lưu kho FBA hàng tháng) thay vì Finances.')
        : tv('SP-API Finances returns $0 for this account although Cattasaurus does pay storage fees; script v2 (waiting to replace the file in the ctu-fin-sync-8x2k repo) will log details to find where this amount lands.', 'SP-API Finances trả về $0 cho tài khoản này dù Cattasaurus đang trả phí lưu kho thật; script v2 (chờ thay file trong repo ctu-fin-sync-8x2k) sẽ log chi tiết để tìm chỗ khoản này nằm.');
      html += `<div><span class="tag gap"><span class="d"></span>${tv('Not captured ($0)', 'Chưa capture ($0)')}</span> <b>${tv('Amazon service fees', 'Phí dịch vụ Amazon')}</b> ${tv('(subscription + FBA storage)', '(subscription + lưu kho FBA)')} — ${svcNote}</div>`;
    } else {
      html += `<div><span class="tag live"><span class="d"></span>${tv('Captured', 'Đã capture')}</span> <b>${tv('Amazon service fees', 'Phí dịch vụ Amazon')}</b> ${tv('(subscription + FBA storage/removal)', '(subscription + lưu kho/removal FBA)')} — ${money(svcTotal)} ${tv('in the current sync window.', 'trong cửa sổ đồng bộ hiện tại.')}</div>`;
    }
    if(amazonAdsMatched){
      html += `<div><span class="tag live"><span class="d"></span>${tv('Data available', 'Đã có số')}</span> <b>Amazon Ads</b> (Sponsored Products/Brands/Display) — ${tv('daily spend ', 'chi phí theo ngày ')}${AMAZON_ADS_LIVE_DATA.source==='sellerboard' ? tv('via Sellerboard (Sellerboard pulls the Amazon Ads API); will switch to the Amazon Ads API directly once Amazon approves access', 'lấy qua Sellerboard (Sellerboard kéo Amazon Ads API); sẽ chuyển sang Amazon Ads API trực tiếp khi Amazon duyệt quyền') : tv('from the Amazon Ads API', 'từ Amazon Ads API')}.</div>`;
    } else html += `<div><span class="tag gap"><span class="d"></span>${tx('tag.gap')}</span> <b>Amazon Ads</b> (Sponsored Products/Brands/Display) — ${tv('SP-API Finances does not return ad spend; shown as $0 until Amazon approves Advertising API access (application submitted, pending).', 'SP-API Finances không trả về ad spend; hiển thị $0 cho tới khi Amazon duyệt quyền Advertising API (đã nộp hồ sơ, đang chờ).')}</div>`;
    if(schema2){
      html += `<div><span class="tag live"><span class="d"></span>${tv('Classified', 'Đã phân loại')}</span> ${tv('Gift wrap (revenue), gift wrap commission (referral fee), sales tax collection / shipping chargeback / holdback / refund administration fee / return-label postage ("Other Amazon fees" line), return shipping & restocking fees (folded into refunds), removal/liquidation (service fees + adjustments), SAFE-T & inventory reimbursements (adjustments). <b>Inbound freight &amp; duty into FBA</b> is a separate line in COGS (inventory cost; Amazon invoices per shipment, so invoice days dip sharply — read it by month). Deliberately ignored because they are not P&amp;L: debt recovery, tax retrocharges, and Reserve credit/debit (money Amazon holds temporarily and returns).', 'Gift wrap (doanh thu), hoa hồng gift wrap (phí giới thiệu), phí thu hộ sales tax / shipping chargeback / holdback / phí xử lý hoàn tiền / postage nhãn trả hàng (dòng "Phí Amazon khác"), phí ship hàng trả & restocking (gộp vào hoàn tiền), removal/liquidation (phí dịch vụ + điều chỉnh), SAFE-T & bồi hoàn kho (điều chỉnh). <b>Cước &amp; thuế nhập hàng vào FBA</b> tách thành dòng riêng trong COGS (giá vốn tồn kho, Amazon xuất hoá đơn theo lô nên ngày có hoá đơn sẽ lõm sâu — đọc theo tháng). Bỏ qua có chủ đích vì không thuộc P&amp;L: debt recovery, retrocharge thuế, và Reserve credit/debit (tiền Amazon tạm giữ rồi trả).')}</div>`;
    }
    html += '</div>';
    if(warnings.length){
      const cap = schema2
        ? tv('Fee/event types script v2 still could not map in the latest sync (currently in the "Adjustments & unclassified" or "Service fees" line — add them to the mapping table):', 'Loại phí/sự kiện script v2 vẫn chưa map được ở lần đồng bộ gần nhất (đang nằm ở dòng "Điều chỉnh & chưa phân loại" hoặc "Phí dịch vụ" — cần bổ sung vào bảng map):')
        : tv('"Unclassified" fee/event types the script met in the latest sync (folded into the "Other / unclassified Amazon fees" line above for now — script v2 maps all of them, waiting to replace the file in the repo):', 'Loại phí/sự kiện "chưa phân loại" script gặp phải ở lần đồng bộ gần nhất (tạm gộp vào dòng "Phí Amazon khác/chưa phân loại" ở trên — script v2 đã map toàn bộ các loại này, chờ thay file trong repo):');
      html += `<div class="caption" style="padding-left:0;margin:10px 0 6px;">${cap}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${warnings.map(w=>`<span class="pill warn">${w}</span>`).join('')}</div>`;
    }
    if(diag){
      const fmtMap = (obj, moneyVals) => Object.keys(obj||{}).length
        ? Object.keys(obj).map(k=>`<span class="pill ok" style="font-weight:500;">${k}: ${moneyVals ? money(obj[k]) : obj[k]}</span>`).join('')
        : '<span class="pill warn">'+tv('none', 'không có')+'</span>';
      html += `<div class="caption" style="padding-left:0;margin:12px 0 6px;">${tv('Latest sync log — service fee types Amazon sent (where subscription/storage fees should appear):', 'Log lần đồng bộ gần nhất — loại phí dịch vụ Amazon gửi về (nơi phí subscription/lưu kho phải xuất hiện):')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${fmtMap(diag.service_fee_types, true)}</div>
        <div class="caption" style="padding-left:0;margin:10px 0 6px;">${tv('Adjustment types by total amount:', 'Loại điều chỉnh (adjustment) theo tổng tiền:')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${fmtMap(diag.adjustment_types, true)}</div>
        <div class="caption" style="padding-left:0;margin:10px 0 6px;">${tv('Event counts per list (including empty lists) · deliberately ignored: ', 'Số sự kiện theo danh sách (kể cả danh sách trống) · bỏ qua có chủ đích: ')}${fmtMap(diag.ignored_event_lists, false)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${fmtMap(diag.event_lists, false)}</div>`;
    }
    document.getElementById('amazonGapsBody').innerHTML = html;
  }

  // =====================================================================================
  // V5 — 7-page layout. Page 1 "Điều hành": period KPIs with like-for-like comparisons
  // (previous period, same span last year, monthly plan), month pacing, channel matrix, alerts.
  // Everything below reads the same aggregate() as the P&L page, so the numbers never diverge.
  // =====================================================================================
  const MS_DAY = 86400000;
  function shiftIso(iso, daysBack){ const d = new Date(+iso.slice(0,4), +iso.slice(5,7)-1, +iso.slice(8,10)); d.setDate(d.getDate()-daysBack); return isoDate(d); }
  function rowsBetween(from, to){ const r = days.filter(d=> d.iso>=from && d.iso<=to); return r.length ? r : null; }
  // "kỳ trước" like-for-like: a partial month compares with the same first N days of the previous month
  function prevLikeRows(){
    const cur = currentRows(); if(!cur.length) return null;
    const ml = monthLikeRange();
    if(mode==='month' || ml){
      const idx = MONTHS.indexOf(ml || selMonth); if(idx<=0) return null;
      const lastDom = cur[cur.length-1].date.getDate();
      const r = (monthMap[MONTHS[idx-1]]||[]).filter(d=> d.date.getDate()<=lastDom);
      return r.length ? r : null;
    }
    return previousRows();
  }
  // same span one year earlier (day/week: 52 weeks back so the weekday matches; month: same first N days)
  function yearAgoRows(){
    const cur = currentRows(); if(!cur.length) return null;
    const ml = monthLikeRange();
    if(mode==='month' || ml){
      const m0 = ml || selMonth, m = String(+m0.slice(0,4)-1)+m0.slice(4);
      const lastDom = cur[cur.length-1].date.getDate();
      const r = (monthMap[m]||[]).filter(d=> d.date.getDate()<=lastDom);
      return r.length ? r : null;
    }
    const back = (mode==='day' || mode==='week') ? 364 : 365;
    return rowsBetween(shiftIso(cur[0].iso, back), shiftIso(cur[cur.length-1].iso, back));
  }
  function likeLabel(){ return (mode==='month' || monthLikeRange()) ? tv('same days last month', 'cùng số ngày tháng trước') : mode==='week' ? tv('last week', 'tuần trước') : mode==='day' ? tv('the day before', 'hôm trước') : tv('previous period', 'kỳ liền trước'); }
  function aggOrNull(rows){ if(!rows || !rows.length) return null; const a = aggregate(rows); return a.netRevenue>0 || a.adSpend>0 ? a : null; }
  function dAbs(cur, ref){ return (ref===null || ref===undefined) ? null : (ref!==0 ? (cur-ref)/Math.abs(ref)*100 : null); }
  function deltaLine(label, d, opts){
    opts = opts||{};
    if(d===null || d===undefined || !isFinite(d)) return `<div class="delta flat"><span class="k">${label}:</span> —</div>`;
    const good = opts.lowerIsBetter ? d<=0 : d>=0;
    const cls = Math.abs(d)<0.05 ? 'flat' : (good ? 'up' : 'down');
    const arrow = Math.abs(d)<0.05 ? '•' : (d>=0 ? '▲' : '▼');
    return `<div class="delta ${cls}"><span class="k">${label}:</span> ${arrow} ${Math.abs(d).toFixed(1)}${opts.pts?' '+tx('u.pts'):'%'}</div>`;
  }
  // new Shopify customers in the period (customer-journey blocks) -> nCAC
  function newCustomersOf(rows){
    const at = attrAggregate(maskPartial() ? rows.map(maskRow) : rows);
    if(!at.attrDays) return null;
    return sum(Object.values(at.last).map(v=>v.newC||0));
  }
  function d2cAdsOf(a){ return a.ads.meta + a.ads.google + a.ads.applovin; }
  function breakEvenMer(a){ const cm2 = a.netRevenue>0 ? a.cmBeforeMarketing/a.netRevenue : 0; return cm2>0 ? 1/cm2 : null; }
  // MER over the days every connected ad source has reported (same rule as the Marketing page)
  function merComplete(rows){
    const complete = rows.filter(r=> adPendingKeys(r).length===0);
    const m = merOf(complete);
    return {value: m.spend>0 ? m.mer : null, days: complete.length, of: rows.length, spend: m.spend};
  }

  // ---------- V10 dictionary for the second half of the file (overview, alerts, inventory, data sources) ----------
  Object.assign(L.en, {
    'u.orders':'orders', 'u.order':'order', 'u.vs':'vs', 'u.lastYear':'last year', 'u.plan':'plan', 'u.breakEven':'break-even', 'u.margin':'margin', 'u.pts':'pts',
    'u.netRev':'Net revenue', 'u.grossRev':'Gross sales', 'u.attrRev':'Attributed revenue', 'u.netRevLc':'net revenue', 'u.thisPeriod':'this period', 'u.selPeriod':'selected period',
    'u.none':'none', 'u.manual':'Manual entry', 'u.manualLc':'manual entry', 'u.notEntered':'not entered', 'u.spend':'Spend', 'u.spendPct':'% of spend', 'u.product2':'Product / campaign', 'u.other':'Other',
    'u.noPrior':'No prior period to compare', 'u.seeData':'See the Data page', 'u.source':'Source',
    'age.just':'Live · just updated', 'age.min':'Live · {n} minutes ago', 'age.hour':'Live · {n} hours ago', 'age.from':' · from {d}', 'age.missing':' ({n} days missing)',
    'u.unitsSold':'units sold',
  });
  Object.assign(L.vi, {
    'u.orders':'đơn', 'u.order':'đơn', 'u.vs':'so', 'u.lastYear':'năm trước', 'u.plan':'kế hoạch', 'u.breakEven':'hoà vốn', 'u.margin':'biên', 'u.pts':'đpt',
    'u.netRev':'DT thuần', 'u.grossRev':'DT gộp', 'u.attrRev':'DT quy về', 'u.netRevLc':'doanh thu thuần', 'u.thisPeriod':'kỳ này', 'u.selPeriod':'kỳ đang xem',
    'u.none':'chưa có', 'u.manual':'Nhập tay', 'u.manualLc':'nhập tay', 'u.notEntered':'chưa nhập', 'u.spend':'Chi', 'u.spendPct':'% chi', 'u.product2':'Sản phẩm / campaign', 'u.other':'Khác',
    'u.noPrior':'Chưa có kỳ trước để so', 'u.seeData':'Xem trang Dữ liệu', 'u.source':'Nguồn',
    'age.just':'Live · vừa cập nhật', 'age.min':'Live · {n} phút trước', 'age.hour':'Live · {n} giờ trước', 'age.from':' · từ {d}', 'age.missing':' (thiếu {n} ngày)',
    'u.unitsSold':'units bán',
  });
  let _bannerPaint = null;   // V10: repaints the live banner in the active language (set once the banner is first shown)
  const nDays = n => n+' '+(n===1 ? tx('u.day') : tx('u.days'));   // "1 day" / "2 days"; Vietnamese is "N ngày" either way
  function setNote(id, txt){ const el = document.getElementById(id); if(el) el.textContent = txt; }
  // ---- V7: period strip (Sellerboard-style): yesterday · last 7 days · month to date · month forecast · last month ----
  function renderPeriodStrip(){
    const el = document.getElementById('periodStrip'); if(!el) return;
    const closed = days.filter(r=>!r._syncing); const lastC = closed[closed.length-1]; if(!lastC){ el.innerHTML = ''; return; }
    const m = lastC.iso.slice(0,7), mRows = (monthMap[m]||[]).filter(r=>!r._syncing);
    const rows7 = closed.slice(-7);
    const pmIdx = MONTHS.indexOf(m)-1, pmRows = pmIdx>=0 ? monthMap[MONTHS[pmIdx]] : null;
    const aY = aggregate([lastC]), a7 = aggregate(rows7), aM = aggregate(mRows), aPM = pmRows ? aggregate(pmRows) : null;
    const dim = daysInMonth(m), done = mRows.length, rem = Math.max(0, dim-done);
    const avg7 = k => a7[k]/Math.max(1, rows7.length);
    const fcNet = aM.netRevenue + avg7('netRevenue')*rem, fcCm = aM.contributionProfit + avg7('contributionProfit')*rem;
    const tile = (l, v, sub, cls) => `<div class="st ${cls||''}"><div class="l" title="${l}">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
    const cm = x => 'CM3 '+money(x,{compact:true});
    el.innerHTML = tile(tv('Yesterday','Hôm qua')+' · '+fmtDate(lastC.date), money(aY.netRevenue,{compact:true}), cm(aY.contributionProfit))
      + tile(tv('Last 7 days','7 ngày qua'), money(a7.netRevenue,{compact:true}), cm(a7.contributionProfit))
      + tile(tv('This month','Tháng này')+' · '+done+'/'+dim+' '+tx('u.days'), money(aM.netRevenue,{compact:true}), cm(aM.contributionProfit))
      + tile(tv('Month-end forecast','Dự báo cuối tháng'), money(fcNet,{compact:true}), cm(fcCm)+tv(' · 7-day pace',' · nhịp 7 ngày'), 'fc')
      + (aPM ? tile(tv('Last month','Tháng trước'), money(aPM.netRevenue,{compact:true}), cm(aPM.contributionProfit)) : tile(tv('Last month','Tháng trước'), '—', ''));
  }
  // ---- V7: profit bridge. CM3 = O·g·(1−dsc−rf)·(1−c−fe) − O·f − mk; swap one driver at a time from the reference
  // period to the current one, so the eight effects add up to the change in CM3 exactly. ----
  function profitBridge(a, p){
    if(!p || !(p.totalOrders>0) || !(a.totalOrders>0)) return null;
    const ea = channelEcon(a), ep = channelEcon(p);
    // per channel: CM3_k = O·g·(1−dsc−rf)·(1−c−fe) − O·f − mk, every rate taken from that channel's own numbers,
    // so a shift between channels lands in the volume rows and never distorts the price / discount rates
    const par = (x, e, k) => { const O = e[k].orders, gross = x.gross[k], net = e[k].net; return {O, g: O>0 ? gross/O : 0, dsc: gross>0 ? x.discountBy[k]/gross : 0, rf: gross>0 ? x.refund[k]/gross : 0, c: net>0 ? e[k].cogs/net : 0, fe: net>0 ? e[k].fees/net : 0, f: O>0 ? e[k].fulfil/O : 0, mk: e[k].adsAll}; };
    const cm3 = q => q.O*q.g*(1-q.dsc-q.rf)*(1-q.c-q.fe) - q.O*q.f - q.mk;
    const DRV = [['g',tv('Gross price per order','Giá gộp mỗi đơn')],['dsc',tv('Discount rate','Tỷ lệ giảm giá')],['rf',tv('Refund rate','Tỷ lệ hoàn tiền')],['c',tv('Product cost rate','Tỷ lệ giá vốn')],['fe',tv('Marketplace & payment fees / revenue','Phí sàn & thanh toán / doanh thu')],['f',tv('Fulfillment per order','Fulfillment mỗi đơn')],['mk',tv('Marketing spend','Chi marketing')]];
    const vol = [], drv = {}; DRV.forEach(([k])=>drv[k]={value:0, from:0, to:0});
    CH_KEYS.forEach(k=>{
      const P = par(p, ep, k), A = par(a, ea, k);
      if(P.O===0 && A.O===0) return;
      if(P.O===0 || A.O===0){ vol.push({key:'O:'+k, label:tv(CH_LABEL[k]+' orders','Số đơn '+CH_LABEL[k]), value: ep[k].cm===undefined ? 0 : (ea[k].cm - ep[k].cm), from:P.O, to:A.O}); return; }
      const q = {...P}; let prev = cm3(q);
      q.O = A.O; let v = cm3(q); vol.push({key:'O:'+k, label:tv(CH_LABEL[k]+' orders','Số đơn '+CH_LABEL[k]), value: v-prev, from:P.O, to:A.O}); prev = v;
      DRV.forEach(([kk])=>{ q[kk] = A[kk]; v = cm3(q); drv[kk].value += v-prev; prev = v; });
    });
    // display values of the rate rows = company level (per-channel detail lives in the volume rows)
    const tot = x => { const fulfil = x.packaging + x.fulfillment + x.shipmonkPickPack + x.postage + x.shipmonkInvoiceExtras; return {g: x.grossSales/x.totalOrders, dsc: x.grossSales>0 ? x.discount/x.grossSales : 0, rf: x.grossSales>0 ? x.refundsTotal/x.grossSales : 0, c: x.netRevenue>0 ? x.productCost/x.netRevenue : 0, fe: x.netRevenue>0 ? x.feesTotal/x.netRevenue : 0, f: fulfil/x.totalOrders, mk: x.marketingTotal}; };
    const TP = tot(p), TA = tot(a);
    const effects = vol.sort((x,y)=>Math.abs(y.value)-Math.abs(x.value)).concat(DRV.map(([k,label])=>({key:k, label, value:drv[k].value, from:TP[k], to:TA[k]})));
    return {start: p.contributionProfit, end: a.contributionProfit, effects};
  }
  function effDetail(e){ const f = (v,k)=> ['dsc','rf','c','fe'].includes(k) ? (v*100).toFixed(1)+'%' : k.startsWith('O') ? intFmt(v)+' '+tx('u.orders') : money(v); return f(e.from,e.key)+' → '+f(e.to,e.key); }
  function renderBridge(a, p, lk){
    const svg = document.getElementById('bridgeChart'); if(!svg) return null;
    const br = profitBridge(a, p);
    const note = document.getElementById('bridgeNote'), cap = document.getElementById('bridgeCaption');
    if(!br){ svg.innerHTML = ''; svg.setAttribute('height', 0); if(note) note.textContent = tx('u.noPrior'); if(cap) cap.textContent = ''; return null; }
    const d = br.end - br.start;
    if(note) note.textContent = `CM3 ${money(br.start,{compact:true})} (${lk}) → ${money(br.end,{compact:true})} (${tx('u.thisPeriod')}): ${d>=0?'+':'−'}${money(Math.abs(d),{compact:true})}`;
    const W = Math.max(560, svg.clientWidth || svg.parentNode.clientWidth || 760), rowH = 26, padL = 230, padR = 96, padT = 8;
    const H = padT + rowH*br.effects.length + 8;
    const maxAbs = Math.max(1, ...br.effects.map(e=>Math.abs(e.value)));
    const x0 = padL + (W-padL-padR)/2, scale = (W-padL-padR)/2/maxAbs;
    const ink = resolveVar('var(--ink-primary)'), muted = resolveVar('var(--ink-muted)'), good = resolveVar('var(--success-text)'), bad = resolveVar('var(--status-critical)'), grid = resolveVar('var(--gridline)');
    let g = `<line x1="${x0}" x2="${x0}" y1="${padT}" y2="${H-4}" stroke="${grid}" stroke-width="1"/>`;
    br.effects.forEach((e,i)=>{
      const y = padT + i*rowH, w = Math.abs(e.value)*scale, x = e.value>=0 ? x0 : x0-w, col = e.value>=0 ? good : bad;
      g += `<text x="${padL-10}" y="${y+rowH/2+4}" text-anchor="end" font-size="12" fill="${ink}">${e.label}</text>`;
      g += `<rect x="${x}" y="${y+6}" width="${Math.max(1,w)}" height="${rowH-12}" rx="4" fill="${col}" fill-opacity="0.85"><title>${e.label}: ${effDetail(e)}</title></rect>`;
      g += `<text x="${e.value>=0 ? x0+w+6 : x0-w-6}" y="${y+rowH/2+4}" text-anchor="${e.value>=0?'start':'end'}" font-size="12" fill="${ink}" font-weight="600">${e.value>=0?'+':'−'}${money(Math.abs(e.value),{compact:true})}</text>`;
      g += `<text x="${W-padR+8}" y="${y+rowH/2+4}" font-size="10.5" fill="${muted}">${effDetail(e)}</text>`;
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H); svg.innerHTML = g;
    if(cap) cap.textContent = tv('The effects add up exactly to the change in CM3. Computed per channel and then summed: orders per channel (including shifts between channels) in the first rows, the rates below are the total effect across all channels. The order effect uses that channel\'s contribution margin before marketing; marketing spend (not per order) sits on its own in the last row. Right column: value in the prior period → this period at company level.', 'Các hiệu ứng cộng đúng bằng thay đổi CM3. Tính riêng từng kênh rồi cộng lại: số đơn mỗi kênh (gồm cả dịch chuyển giữa các kênh) ở các dòng đầu, các tỷ lệ bên dưới là hiệu ứng tổng của mọi kênh. Hiệu ứng số đơn tính theo biên đóng góp trước marketing của kênh đó; chi marketing (không tính theo đơn) tách riêng ở dòng cuối. Cột phải: giá trị kỳ trước → kỳ này ở mức toàn công ty.');
    return br;
  }
  // ---- V11.5: brief card — verdict (what happened + why), prioritised actions with money and a link to the detail,
  // the profit drivers as diverging bars, and the data caveats on one line. Actions = alerts that are not data notes
  // (kind 'data'); the bridge effects add up exactly to ΔCM3 (see renderBridge).
  function briefGo(view, id){
    const show = () => {
      const el = id ? document.getElementById(id) : null, box = el ? (el.closest('.card') || el) : null;
      if(!box) return;
      box.scrollIntoView({behavior:'smooth', block:'start'});
      box.classList.add('bf-flash'); setTimeout(()=>box.classList.remove('bf-flash'), 1800);
    };
    if(view && view!==currentView){ showView(view); setTimeout(show, 150); } else show();
  }
  function renderBrief(rows, a, p, bridge, alerts, merNow, lk){
    const card = document.getElementById('briefCard'); if(!card) return;
    if(!card.dataset.bound){
      card.dataset.bound = '1';
      card.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if(!b) return; const [v, id] = b.dataset.go.split('|'); briefGo(v, id); });
    }
    const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const m = v => money(Math.abs(v), {compact:true});
    const sgn = v => v>=0 ? '+' : '−';
    const pctOfNet = (x) => x.netRevenue>0 ? x.contributionProfit/x.netRevenue*100 : null;
    const cmD = p ? dAbs(a.contributionProfit, p.contributionProfit) : null, nrD = p ? dAbs(a.netRevenue, p.netRevenue) : null;
    const fin = v => v!==null && v!==undefined && isFinite(v);
    const live = alerts.filter(i => i.lvl!=='ok');
    const acts = live.filter(i => i.kind!=='data').sort((x,y)=> (x.lvl==='crit'?0:1)-(y.lvl==='crit'?0:1) || (y.stake||0)-(x.stake||0));
    const dataNotes = live.filter(i => i.kind==='data');
    // ---- 1. verdict ----
    const crit = acts.some(i => i.lvl==='crit');
    let tone = 'neutral';
    if(a.contributionProfit<0 || (fin(cmD) && cmD<=-20) || acts.some(i=>i.key==='mer' && i.lvl==='crit')) tone = 'bad';
    else if(fin(cmD) && cmD>=5 && !crit) tone = 'good';
    else if(fin(cmD) || crit) tone = 'warn';
    const toneLbl = {bad: tv('Needs action','Cần xử lý'), warn: tv('Watch','Cần chú ý'), good: tv('On track','Đang tốt'), neutral: tv('This period','Kỳ này')}[tone];
    const cmPct = pctOfNet(a), cmPctP = p ? pctOfNet(p) : null;
    const head = (p && fin(cmD))
      ? `CM3 ${cmD>=0 ? tv('up','tăng') : tv('down','giảm')} ${Math.abs(cmD).toFixed(0)}% ${tx('u.vs')} ${lk}: <b>${money(p.contributionProfit,{compact:true})} → ${money(a.contributionProfit,{compact:true})}</b>`
      : `CM3 <b>${money(a.contributionProfit,{compact:true})}</b>` + (cmPct!==null ? ` · ${cmPct.toFixed(1)}% ${tv('of net revenue','doanh thu thuần')}` : '');
    const RATE = {dsc:1, rf:1, c:1, fe:1, f:1, g:1};
    // a rate can move the other way at company level than inside the channels (channel mix): say so instead of showing a contradiction
    const within = e => { if(!(e.key in RATE) || !isFinite(e.from) || !isFinite(e.to) || e.from===e.to) return null; const up = e.key==='g' ? e.value>0 : e.value<0; return up !== (e.to>e.from) ? up : null; };
    const effShort = e => { const f = (v,k)=> ['dsc','rf','c','fe'].includes(k) ? (v*100).toFixed(1)+'%' : money(v,{compact:true}); if(e.key.startsWith('O')) return intFmt(e.from)+' → '+intFmt(e.to)+' '+tx('u.orders'); const base = f(e.from,e.key)+' → '+f(e.to,e.key), w = within(e); return w===null ? base : (w ? tv('up within channels','tăng trong từng kênh') : tv('down within channels','giảm trong từng kênh'))+'; '+tv('overall ','chung ')+base; };
    const effTxt = e => `<b class="${e.value>=0?'up':'dn'}">${esc(e.label)} ${sgn(e.value)}${m(e.value)}</b> <span class="bf-dim">(${effShort(e)})</span>`;
    let why = '';
    if(bridge){
      const dd = bridge.end - bridge.start, floor = Math.max(Math.abs(dd)*0.15, 500);
      const neg = bridge.effects.filter(e=>e.value<0 && Math.abs(e.value)>=floor).sort((x,y)=>x.value-y.value).slice(0,2);
      const pos = bridge.effects.filter(e=>e.value>0 && e.value>=floor).sort((x,y)=>y.value-x.value).slice(0,2);
      if(dd<0 && neg.length) why = tv('Pulled down by ','Kéo xuống: ') + neg.map(effTxt).join(', ') + (pos.length ? tv('; offset by ','; bù lại: ') + pos.map(effTxt).join(', ') : '') + '.';
      else if(dd>=0 && pos.length) why = tv('Lifted by ','Đẩy lên: ') + pos.map(effTxt).join(', ') + (neg.length ? tv('; held back by ','; kéo lại: ') + neg.map(effTxt).join(', ') : '') + '.';
    }
    let margin = '';
    if(p && fin(cmD) && fin(nrD) && cmPct!==null && cmPctP!==null && Math.abs(cmD-nrD)>=10)
      margin = (cmD<nrD ? tv('Profit fell faster than revenue','Lợi nhuận giảm nhanh hơn doanh thu') : tv('Profit grew faster than revenue','Lợi nhuận tăng nhanh hơn doanh thu'))
        + ` (CM3 ${sgn(cmD)}${Math.abs(cmD).toFixed(0)}% ${tv('vs net revenue','so với doanh thu thuần')} ${sgn(nrD)}${Math.abs(nrD).toFixed(0)}%): ${tv('CM3 margin','biên CM3')} ${cmPctP.toFixed(1)}% → <b>${cmPct.toFixed(1)}%</b>.`;
    if(a.netProfit<0) margin += (margin ? ' ' : '') + tv('EBITDA after G&A is ','EBITDA sau G&A đang âm ') + `<b class="dn">−${m(a.netProfit)}</b>.`;
    document.getElementById('briefVerdict').className = 'bf-verdict t-'+tone;
    document.getElementById('briefVerdict').innerHTML = `<div class="bf-v1"><span class="bf-tone">${toneLbl}</span><span class="bf-head">${head}</span></div>`
      + (why ? `<p class="bf-v2">${why}</p>` : '') + (margin ? `<p class="bf-v3">${margin}</p>` : '');
    // ---- 2. actions ----
    const can = v => !v || VIEWS.includes(v);
    const goLbl = {marketing: tv('See ROAS & MER','Xem ROAS & MER'), exec: tv('See pacing','Xem nhịp độ'), sales: tv('See returns by SKU','Xem trả hàng theo SKU'), pnl: tv('See the P&L','Xem lãi lỗ'), inventory: tv('See stock by SKU','Xem tồn kho'), data: tv('See data health','Xem sức khoẻ dữ liệu')};
    const whyOf = i => {
      if(i.key==='mer') return i.name;
      if(i.key==='disc') return i.name + ' · ' + tv('threshold 40%','ngưỡng 40%');
      if(i.key==='stock') return i.name + (i.soon && i.soon.cover!==null ? ' · ' + (i.soon.cover<1 ? tv('already out: ','đã hết hàng: ') + i.soon.sku : tv('first: ','sớm nhất: ') + i.soon.sku + ' ' + tv('in ','còn ') + Math.floor(i.soon.cover) + tv(' days',' ngày')) : '');
      return i.name + (i.note ? ' · ' + i.note : '');
    };
    const titleOf = i => (i.key==='stock' && i.skus && i.skus.length>1) ? tv('Place or expedite POs for the ','Đặt hoặc đẩy nhanh PO cho ') + i.skus.length + tv(' SKUs at most risk',' SKU rủi ro nhất') : (i.todo || i.action || i.name);
    const skuTags = i => (i.key==='stock' && i.skus && i.skus.length>1) ? '<div class="bf-skus">' + i.skus.map(k=>'<span class="bf-sku">'+esc(k)+'</span>').join('') + '</div>' : '';
    const pri = i => i.lvl==='crit' ? ['crit', tv('Urgent','Gấp')] : (i.stake>0 ? ['warn', tv('This week','Tuần này')] : ['watch', tv('Watch','Theo dõi')]);
    const shown = acts.slice(0, 4);
    document.getElementById('briefActsN').textContent = acts.length ? String(acts.length) : '';
    document.getElementById('briefActs').innerHTML = shown.length ? shown.map((i, n) => {
      const [cls, lbl] = pri(i);
      const go = i.go && can(i.go[0]) ? `<button type="button" class="bf-go" data-go="${i.go[0]}|${i.go[1]||''}">${goLbl[i.go[0]] || tv('Details','Chi tiết')} →</button>` : '';
      return `<li class="bf-act ${cls}${n===0?' top':''}"><span class="bf-pri ${cls}">${lbl}</span>`
        + `<div class="bf-act-b"><div class="bf-act-t">${titleOf(i)}</div>${skuTags(i)}<div class="bf-act-w">${whyOf(i)}</div>${go}</div>`
        + `<div class="bf-act-v">${i.stake>0 ? `<b>${m(i.stake)}</b><small>${i.stakeLbl || tv('money affected','tiền bị ảnh hưởng')}</small>` : ''}</div></li>`;
    }).join('') + (acts.length>shown.length ? `<li class="bf-more"><button type="button" class="bf-go" data-go="exec|alertCard">${tv('+ ','+ ')}${acts.length-shown.length}${tv(' more in Alerts',' việc khác ở thẻ Cảnh báo')} →</button></li>` : '')
      : `<li class="bf-none">${tv('Nothing urgent this period — no threshold breached.','Kỳ này không có việc gấp — chưa vượt ngưỡng nào.')}</li>`;
    // ---- 3. drivers ----
    const dr = document.getElementById('briefDrivers');
    if(bridge){
      const eff = [...bridge.effects].sort((x,y)=>Math.abs(y.value)-Math.abs(x.value)).slice(0, 5).filter(e=>Math.abs(e.value)>=1);
      const mx = Math.max(1, ...eff.map(e=>Math.abs(e.value))), dd = bridge.end - bridge.start;
      dr.innerHTML = `<div class="bf-drv">` + eff.map(e => `<div class="bf-dr" title="${esc(e.label)}: ${esc(effDetail(e))}"><span class="l">${esc(e.label)}<small>${effShort(e)}</small></span><span class="bf-bar" aria-hidden="true"><i class="${e.value>=0?'up':'dn'}" style="width:${(Math.abs(e.value)/mx*50).toFixed(1)}%"></i></span><span class="v ${e.value>=0?'up':'dn'}">${sgn(e.value)}${m(e.value)}</span></div>`).join('') + `</div>`
        + `<div class="bf-tot"><span>${tv('Total','Tổng')}: CM3 ${money(bridge.start,{compact:true})} → ${money(bridge.end,{compact:true})} <b class="${dd>=0?'up':'dn'}">${sgn(dd)}${m(dd)}</b></span>${can('exec') ? `<button type="button" class="bf-go" data-go="exec|bridgeCard">${tv('All effects','Đủ các yếu tố')} →</button>` : ''}</div>`;
    } else dr.innerHTML = `<p class="bf-none">${tx('u.noPrior')}</p>`;
    // ---- 4. data caveats ----
    const dn = document.getElementById('briefData');
    dn.hidden = !dataNotes.length;
    dn.innerHTML = dataNotes.length ? `<span class="k">${tv('Numbers not final:','Số liệu chưa đủ:')}</span>` + dataNotes.map(i=>`<span class="bf-chip ${i.lvl}" title="${esc(i.name + (i.note ? ' — ' + i.note : ''))}">${esc(i.short || i.name)}</span>`).join('') : '';
    document.getElementById('briefCaption').textContent = tv(
      'Priority: Urgent = a critical threshold is breached; This week = money is affected; Watch = no money yet. Money: revenue at risk = units that cannot be sold over the next 30 days at the current pace × price (incoming stock not counted); over the threshold = the part above the alert level, in money, for this period; short of plan = plan spread evenly to the last closed day − actual. "Why profit moved" comes from the Profit bridge card: the effects add up exactly to the change in CM3. A rate can move the other way overall than inside the channels when the channel mix changes; the effect is measured inside each channel, so such lines say "up/down within channels; overall x → y". Data notes: hover a chip for the detail.',
      'Mức ưu tiên: Gấp = vượt ngưỡng nghiêm trọng; Tuần này = có tiền bị ảnh hưởng; Theo dõi = chưa ra tiền. Số tiền: DT có thể mất = số units không đủ hàng để bán trong 30 ngày tới theo tốc độ hiện tại × giá bán (chưa tính hàng đang về); vượt ngưỡng = phần vượt mức cảnh báo tính ra tiền trong kỳ; thiếu so kế hoạch = kế hoạch rải đều đến ngày đã chốt − thực tế. "Vì sao lợi nhuận đổi" lấy từ thẻ Cầu lợi nhuận: các yếu tố cộng đúng bằng thay đổi CM3. Một tỷ lệ có thể đi ngược chiều ở mức chung so với trong từng kênh khi tỷ trọng kênh thay đổi; hiệu ứng được tính trong từng kênh nên những dòng đó ghi "tăng/giảm trong từng kênh; chung x → y". Lưu ý số liệu: rê chuột lên từng mục để xem chi tiết.');
  }
  // ---- V7: unit economics (P&L page): what one average order earns, per channel ----
  function renderUnitEconomics(){
    const t = document.getElementById('ueTable'); if(!t) return;
    const rows = currentRows(), a = aggregate(rows), ce = channelEcon(a);
    const cols = [['total',tx('u.total')]].concat(CH_KEYS.filter(k=>ce[k].orders>0).map(k=>[k, CH_LABEL[k]]));
    const tot = {net:a.netRevenue, orders:a.totalOrders, cogs:a.productCost, fulfil:a.packaging+a.fulfillment+a.shipmonkPickPack+a.postage+a.shipmonkInvoiceExtras, fees:a.feesTotal, adsAll:a.marketingTotal, cm:a.contributionProfit};
    const get = k => k==='total' ? tot : {net:ce[k].net, orders:ce[k].orders, cogs:ce[k].cogs, fulfil:ce[k].fulfil, fees:ce[k].fees, adsAll:ce[k].adsAll, cm:ce[k].cm};
    const per = (v,o) => o>0 ? money(v/o) : '—';
    const lines = [
      [tv('Net revenue / order','Doanh thu thuần / đơn'), x=>per(x.net,x.orders)],
      [tv('Product cost / order','Giá vốn sản phẩm / đơn'), x=>per(-x.cogs,x.orders)],
      [tv('Fulfillment / order','Fulfillment / đơn'), x=>per(-x.fulfil,x.orders)],
      [tv('Marketplace & payment fees / order','Phí sàn & thanh toán / đơn'), x=>per(-x.fees,x.orders)],
      [tv('= Earned / order before marketing','= Kiếm được / đơn trước marketing'), x=>per(x.net-x.cogs-x.fulfil-x.fees,x.orders)],
      [tv('Ads + affiliate / order','Ads + affiliate / đơn'), x=>per(-x.adsAll,x.orders)],
      [tv('= CM3 / order','= CM3 / đơn'), x=>per(x.cm,x.orders)],
      [tv('Floor price (net revenue/order for CM3 = 0)','Giá sàn (doanh thu thuần/đơn để CM3 = 0)'), x=>per(x.net-x.cm,x.orders)],
      [tv('Cost of one return (CM3 lost + fulfillment already spent)','Chi phí 1 lần trả hàng (CM3 mất + fulfillment đã chi)'), x=>per(Math.max(0, x.cm+x.fulfil),x.orders)],
    ];
    t.innerHTML = '<thead><tr><th>'+tv('One average order','Một đơn trung bình')+'</th>'+cols.map(c=>`<th class="num">${c[1]}</th>`).join('')+'</tr></thead><tbody>'
      + lines.map(l=>`<tr${l[0].startsWith('=')?' class="sub"':''}><td>${l[0]}</td>`+cols.map(c=>`<td class="num">${l[1](get(c[0]))}</td>`).join('')+'</tr>').join('')+'</tbody>';
    const be = breakEvenMer(a), mer = merComplete(rows), head = (be && mer.value) ? mer.value/be : null;
    setNote('ueNote', tv(`Based on ${intFmt(a.totalOrders)} orders in the selected period`, `Tính trên ${intFmt(a.totalOrders)} đơn kỳ đang xem`) + (head ? tv(` · MER ${mer.value.toFixed(2)}x vs break-even ${be.toFixed(2)}x → ads can get ${head.toFixed(2)}× worse before losing money`, ` · MER ${mer.value.toFixed(2)}x so hoà vốn ${be.toFixed(2)}x → quảng cáo được phép kém đi ${head.toFixed(2)} lần nữa mới lỗ`) : ''));
    setNote('ueCaption', tv('Floor price = net revenue per order needed for CM3 = 0 with the current cost structure. Cost of one return = CM3 lost + fulfillment already spent, excluding return postage. Product cost from ', 'Giá sàn = doanh thu thuần mỗi đơn cần có để CM3 = 0 với cơ cấu chi phí hiện tại. Chi phí 1 lần trả hàng = CM3 mất + fulfillment đã chi, chưa gồm cước trả về. Giá vốn theo ') + (a.productCostHasActual ? tv('the accounting inventory ledger','sổ kho kế toán') : tv('an estimate of ','ước tính ')+(a.cogsEstRate*100).toFixed(0)+'%') + tv('. Amazon is counted per order, not per product.', '. Amazon tính theo đơn, không theo sản phẩm.'));
  }
  // ---- V7: one-line finding under a few card titles ----
  // ---------- V8: sensitivity (±10% one lever at a time) + what-if scenario ----------
  const SCEN = {orders:0, price:0, discount:0, refund:0, cogs:0, fulfil:0, ads:0, adsMer:true};
  function renderSensitivity(){
    const t = document.getElementById('sensTable'); if(!t) return;
    const a = aggregate(currentRows());
    const net = a.netRevenue, O = a.totalOrders;
    const box = document.getElementById('scenBox'), out = document.getElementById('scenOut');
    if(net<=0 || O<=0){ t.innerHTML=''; box.innerHTML=''; out.innerHTML=''; setNote('sensNote',tv('No revenue in this period','Chưa có doanh thu trong kỳ')); setNote('sensCaption',''); return; }
    const feeRate = a.feesTotal/net;                                  // marketplace + payment fees move with revenue
    const aff = a.marketingTotal - a.merSpend, affRate = aff/net;      // affiliate / creator commissions move with revenue
    const fulfil = a.fulfillment + a.shipmonkPickPack + a.postage + a.packaging + a.shipmonkInvoiceExtras;
    const cmVar = a.cmBeforeMarketing - aff;                          // what one more dollar of revenue keeps before paid ads
    const cmVarRate = cmVar/net;
    const mer = a.merSpend>0 ? net/a.merSpend : 0;
    const d = 0.10, keepRate = 1 - feeRate - affRate;
    const levers = [
      {name:tv('Number of orders','Số đơn hàng'), now: intFmt(O)+' '+tx('u.orders'), how:tv('price, product cost/order, fulfillment/order, fee % unchanged; ad spend unchanged','giá, giá vốn/đơn, fulfillment/đơn, phí % giữ nguyên; chi quảng cáo không đổi'), dn: -d*cmVar, up: d*cmVar},
      {name:tv('Gross price per order','Giá bán gộp mỗi đơn'), now: money(a.grossSales/O), how:tv('orders unchanged; discounts, refunds, marketplace/payment fees, commissions keep their %','số đơn giữ nguyên; giảm giá, hoàn tiền, phí sàn/thanh toán, hoa hồng theo % không đổi'), dn: -d*net*keepRate, up: d*net*keepRate},
      {name:tv('Discount rate','Tỷ lệ giảm giá'), now: pct1(a.discount, a.grossSales)+tv(' of gross sales',' doanh thu gộp'), how:tv('±10% relative: ','±10% tương đối: ')+pct1(a.discount*0.9, a.grossSales)+' ↔ '+pct1(a.discount*1.1, a.grossSales), dn: d*a.discount*keepRate, up: -d*a.discount*keepRate},
      {name:tv('Refund rate','Tỷ lệ hoàn tiền'), now: pct1(a.refundsTotal, a.grossSales)+tv(' of gross sales',' doanh thu gộp'), how:tv('±10% relative: ','±10% tương đối: ')+pct1(a.refundsTotal*0.9, a.grossSales)+' ↔ '+pct1(a.refundsTotal*1.1, a.grossSales), dn: d*a.refundsTotal*keepRate, up: -d*a.refundsTotal*keepRate},
      {name:tv('Product cost','Giá vốn sản phẩm'), now: money(a.productCost,{compact:true})+' · '+pct1(a.productCost, net)+' '+tv('of net revenue','DT thuần'), how: a.productCostHasActual ? tv('from the inventory ledger (the rest estimated)','theo sổ kho (phần còn lại ước tính)') : (a.productCostEst ? tv('estimated at ','đang ước ')+(a.cogsEstRate*100).toFixed(0)+tv('% — fill in cogs_monthly.json for actuals','% — điền cogs_monthly.json để có số thật') : tv('no product cost yet','chưa có giá vốn')), dn: d*a.productCost, up: -d*a.productCost},
      {name:tv('Fulfillment per order','Fulfillment mỗi đơn'), now: money(fulfil/O), how:tv('FBA + ShipMonk pick/pack, postage, packaging — ','FBA + ShipMonk pick/pack, cước, đóng gói — ')+money(fulfil,{compact:true})+tv(' for the period',' cả kỳ'), dn: d*fulfil, up: -d*fulfil},
      {name:tv('Ad spend — revenue unchanged','Chi quảng cáo — doanh thu giữ nguyên'), now: money(a.merSpend,{compact:true}), how:tv('cut / add budget with revenue unchanged (lower and upper bound of the effect)','cắt / thêm ngân sách mà doanh thu không đổi (sàn dưới và trần trên của tác động)'), dn: d*a.merSpend, up: -d*a.merSpend},
      {name:tv('Ad spend — revenue follows MER ','Chi quảng cáo — doanh thu đổi theo MER ')+(mer ? mer.toFixed(2)+'x' : '—'), now: money(a.merSpend,{compact:true}), how: mer ? tv('every $1 of ads brings ','mỗi $1 quảng cáo kéo theo ')+money(mer)+tv(' net revenue, keeping ',' doanh thu thuần, giữ lại ')+money(mer*cmVarRate)+tv(' before ads',' trước quảng cáo') : tv('no ad spend yet','chưa có chi quảng cáo'), dn: -d*a.merSpend*(mer*cmVarRate-1), up: d*a.merSpend*(mer*cmVarRate-1)},
    ].sort((x,y)=> Math.max(Math.abs(y.dn),Math.abs(y.up)) - Math.max(Math.abs(x.dn),Math.abs(x.up)));
    const cell = v => `<td class="num ${v>=0.5?'d-up':(v<=-0.5?'d-down':'d-flat')}">${v>=0?'+':'−'}${money(Math.abs(v),{compact:true})}</td>`;
    t.innerHTML = '<thead><tr><th>'+tv('Lever','Yếu tố')+'</th><th>'+tv('Current','Hiện tại')+'</th><th class="num">−10%</th><th class="num">+10%</th><th>'+tv('Assumption','Giả định')+'</th></tr></thead><tbody>' +
      levers.map(l=>`<tr><td class="name">${l.name}</td><td style="font-variant-numeric:tabular-nums;white-space:nowrap;">${l.now}</td>${cell(l.dn)}${cell(l.up)}<td style="color:var(--ink-muted);font-size:11.5px;">${l.how}</td></tr>`).join('') + '</tbody>';
    setNote('sensNote', tv('CM3 this period ','CM3 kỳ này ')+money(a.contributionProfit,{compact:true})+' · EBITDA '+money(a.netProfit,{compact:true})+tv(' · biggest lever: ',' · đòn bẩy lớn nhất: ')+levers[0].name.toLowerCase());
    // what-if: the same linear model with every lever at once
    const sl = [['orders',tv('Orders','Số đơn')],['price',tv('Gross price/order','Giá bán gộp/đơn')],['discount',tv('Discount rate','Tỷ lệ giảm giá')],['refund',tv('Refund rate','Tỷ lệ hoàn tiền')],['cogs',tv('Product cost/order','Giá vốn/đơn')],['fulfil',tv('Fulfillment/order','Fulfillment/đơn')],['ads',tv('Ad spend','Chi quảng cáo')]];
    box.innerHTML = sl.map(([k,l])=>`<label><span>${l} <b id="scv_${k}">${SCEN[k]>0?'+':''}${SCEN[k]}%</b></span><input type="range" min="-30" max="30" step="1" value="${SCEN[k]}" id="sc_${k}"></label>`).join('')
      + `<label class="chk"><input type="checkbox" id="sc_adsMer" ${SCEN.adsMer?'checked':''}> ${tv('Revenue follows MER when ads change','Doanh thu đổi theo MER khi đổi quảng cáo')}</label><label class="chk"><button class="btn mini" type="button" id="sc_reset" style="margin-left:0;">${tv('Reset','Đặt lại')}</button></label>`;
    const base = {net, cm3: a.contributionProfit, ebitda: a.netProfit, mer: mer||null, orders: O};
    const scenario = () => {
      const o = 1+SCEN.orders/100, pr = 1+SCEN.price/100, dd = 1+SCEN.discount/100, rr = 1+SCEN.refund/100, cc = 1+SCEN.cogs/100, ff = 1+SCEN.fulfil/100, ad = 1+SCEN.ads/100;
      const vol = o * (SCEN.adsMer ? ad : 1);
      const gross = a.grossSales*vol*pr, disc = a.discount*vol*pr*dd, ref = a.refundsTotal*vol*pr*rr;
      const net2 = gross - disc - ref;
      const cogs2 = a.productCost*vol*cc, ful2 = fulfil*vol*ff, fees2 = net2*feeRate, aff2 = net2*affRate, ads2 = a.merSpend*ad;
      const cm3 = net2 - cogs2 - ful2 - fees2 - aff2 - ads2;
      return {net: net2, cm3, ebitda: cm3 - a.fixedTotal, mer: ads2>0 ? net2/ads2 : null, orders: O*vol};
    };
    const paint = () => {
      const r = scenario();
      const dv = (x,y,m) => y===null||x===null ? '' : (Math.abs(x-y) < (m ? 0.5 : 0.005) ? '<div class="d">'+tv('= current','= hiện tại')+'</div>' : `<div class="d">${x-y>=0?'+':'−'}${m ? money(Math.abs(x-y),{compact:true}) : Math.abs(x-y).toFixed(2)+'x'} ${tv('vs current','so hiện tại')}</div>`);
      out.innerHTML = [
        {l:tv('Net revenue','Doanh thu thuần'), v: money(r.net,{compact:true}), d: dv(r.net, base.net, true)},
        {l:'CM3', v: money(r.cm3,{compact:true}), d: dv(r.cm3, base.cm3, true)},
        {l:'EBITDA', v: money(r.ebitda,{compact:true}), d: dv(r.ebitda, base.ebitda, true)},
        {l:'MER', v: r.mer ? r.mer.toFixed(2)+'x' : '—', d: dv(r.mer, base.mer, false)},
        {l:tv('Orders','Số đơn'), v: intFmt(r.orders), d: dv(r.orders, base.orders, true).replace(/\$/g,'')},
      ].map(x=>`<div class="so"><div class="l">${x.l}</div><div class="v">${x.v}</div>${x.d}</div>`).join('');
    };
    sl.forEach(([k])=>{ const el = document.getElementById('sc_'+k); el.addEventListener('input', ()=>{ SCEN[k] = parseInt(el.value,10)||0; document.getElementById('scv_'+k).textContent = (SCEN[k]>0?'+':'')+SCEN[k]+'%'; paint(); }); });
    document.getElementById('sc_adsMer').addEventListener('change', e=>{ SCEN.adsMer = e.target.checked; paint(); });
    document.getElementById('sc_reset').addEventListener('click', ()=>{ sl.forEach(([k])=>{ SCEN[k] = 0; }); SCEN.adsMer = true; renderSensitivity(); });
    paint();
    setNote('sensCaption', tv('Each row changes one lever with the others held constant; a linear model on the selected period\'s numbers (good enough for ±10–20%, no price elasticity of demand). Drag the sliders to try several levers at once — orders are multiplied by the ad-spend change when "revenue follows MER" is on.', 'Mỗi dòng đổi một yếu tố, các yếu tố khác giữ nguyên; mô hình tuyến tính trên số kỳ đang xem (đủ đúng cho ±10–20%, không tính co giãn cầu theo giá). Kéo thanh để thử nhiều yếu tố cùng lúc — số đơn nhân với mức đổi quảng cáo khi bật "doanh thu đổi theo MER".'));
  }
  function renderFindings(){
    const rows = currentRows(), a = aggregate(rows), p = aggOrNull(prevLikeRows()), lk = likeLabel();
    const mer = merComplete(rows), be = breakEvenMer(a);
    let worst = null; rows.filter(r=>adPendingKeys(r).length===0).forEach(r=>{ const m = merOf([r]); if(m.spend>0 && (worst===null || m.mer<worst.mer)) worst = {mer:m.mer, iso:r.iso}; });
    setNote('roasFinding', mer.value!==null ? `MER ${mer.value.toFixed(2)}x` + (be ? (mer.value>=be ? tv(', above',', trên') : tv(', BELOW',', DƯỚI'))+tv(' break-even ',' hoà vốn ')+be.toFixed(2)+'x' : '') + (worst && rows.length>1 ? ` · ${tv('lowest day','ngày thấp nhất')} ${worst.iso.slice(8,10)}/${worst.iso.slice(5,7)}: ${worst.mer.toFixed(2)}x` : '') : tv('No day yet with every ad source reported','Chưa có ngày nào đủ số mọi nguồn quảng cáo'));
    setNote('stmtFinding', `CM3 ${money(a.contributionProfit,{compact:true})} (${a.netRevenue>0?(a.contributionProfit/a.netRevenue*100).toFixed(1):'—'}%) · EBITDA ${money(a.netProfit,{compact:true})}` + (p ? ` · CM3 ${lk}: ${money(p.contributionProfit,{compact:true})}` : ''));
    setNote('opexFinding', `OpEx ${money(a.fixedTotal,{compact:true})} = ${a.netRevenue>0?(a.fixedTotal/a.netRevenue*100).toFixed(1):'—'}% ${tv('of net revenue','doanh thu thuần')} · G&A ${money(a.gaTotal,{compact:true})} · ${tv('warehousing','kho bãi')} ${money(a.inventoryHolding+a.logisticsTotal,{compact:true})}`);
  }
  // ---- V7: CSV export of any rendered table ----
  function exportTable(tableId, name){
    const t = document.getElementById(tableId); if(!t) return;
    const lines = [...t.querySelectorAll('tr')].map(tr=>[...tr.children].map(c=>'"'+c.innerText.replace(/\s+/g,' ').trim().replace(/"/g,'""')+'"').join(','));
    const blob = new Blob(['﻿'+lines.join('\n')], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'cattasaurus-'+name+'-'+((document.getElementById('rangeLbl')||{}).textContent||'').replace(/[^0-9]+/g,'-').replace(/^-|-$/g,'')+'.csv';
    document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  document.addEventListener('click', (e)=>{ const b = e.target.closest('[data-export]'); if(b){ e.preventDefault(); exportTable(b.dataset.export, b.dataset.name||b.dataset.export); } });

  // ---------- V10: overview building blocks — daily series, sparklines, revenue chart, channel donut, product lines, stock risk ----------
  let _dailyCache = {key:null, list:null};
  function dailyAgg(rows){
    const key = (rows[0] ? rows[0].iso : '')+'|'+rows.length+'|'+_maskVer;
    if(_dailyCache.key===key) return _dailyCache.list;
    const list = rows.map(r=>aggregate([r]));
    _dailyCache = {key, list};
    return list;
  }
  function sparkSvg(values, opts){
    opts = opts||{};
    const vs = values.filter(v=> v!==null && v!==undefined && isFinite(v));
    if(vs.length<2) return '';
    const W = 160, H = 34, pad = 2;
    let min = Math.min(...vs), max = Math.max(...vs); if(max===min){ max = min + 1; }
    if(max-min < Math.abs(max)*0.02) { min -= Math.abs(max)*0.01; max += Math.abs(max)*0.01; }   // flat series: keep a visible mid line
    const n = values.length, X = i => pad + i/(n-1)*(W-2*pad), Y = v => pad + (1 - (v-min)/(max-min))*(H-2*pad);
    const pts = []; values.forEach((v,i)=>{ if(v===null || v===undefined || !isFinite(v)) return; pts.push([X(i), Y(v)]); });
    const line = pts.map((p,i)=> (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
    const base = Y(Math.max(min, 0));
    const area = line + ' L'+pts[pts.length-1][0].toFixed(1)+' '+base.toFixed(1)+' L'+pts[0][0].toFixed(1)+' '+base.toFixed(1)+' Z';
    const c = opts.color || 'var(--accent)';
    const last = pts[pts.length-1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${area}" fill="${c}" fill-opacity=".07"/><path d="${line}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.2" fill="${c}"/></svg>`;
  }
  const pillOf = (d, lowerIsBetter) => { if(d===null || d===undefined || !isFinite(d)) return ''; const good = lowerIsBetter ? d<=0 : d>=0; const cls = Math.abs(d)<0.05 ? 'flat' : (good ? 'up' : 'down'); const arrow = Math.abs(d)<0.05 ? '' : (d>=0 ? '↑ ' : '↓ '); return `<span class="pill-d ${cls}">${arrow}${Math.abs(d).toFixed(1)}%</span>`; };

  // ---- revenue performance: net revenue + CM3 on one $ axis, daily / weekly / monthly buckets of the period ----
  const REV_STATE = {g:'day'};
  function bucketRows(rows, g){
    if(g==='day') return rows.map(r=>({label: r.iso, rows:[r]}));
    const map = {}, order = [];
    rows.forEach(r=>{ let k; if(g==='month') k = r.iso.slice(0,7); else { const dow = (r.date.getDay()+6)%7; const mon = new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate()-dow); k = isoDate(mon); } if(!map[k]){ map[k] = []; order.push(k); } map[k].push(r); });
    return order.map(k=>({label:k, rows:map[k]}));
  }
  function renderRev(){
    const svg = document.getElementById('revChart'); if(!svg) return;
    const rows = currentRows();
    const seg = document.getElementById('revSeg');
    if(seg && !seg._wired){ seg._wired = true; seg.addEventListener('click', e=>{ const b = e.target.closest('button'); if(!b) return; REV_STATE.g = b.dataset.g; renderRev(); }); }
    if(seg) [...seg.querySelectorAll('button')].forEach(b=>b.classList.toggle('active', b.dataset.g===REV_STATE.g));
    const g = rows.length<14 ? 'day' : REV_STATE.g;
    const buckets = bucketRows(rows, g);
    const daily = g==='day' ? dailyAgg(rows) : null;
    const series = buckets.map((b,i)=>{ const x = daily ? daily[i] : aggregate(b.rows); return {label: b.label, n: b.rows.length, net: x.netRevenue, cm: x.contributionProfit, orders: x.totalOrders, ads: x.merSpend}; });
    const W = Math.max(320, svg.clientWidth || svg.parentNode.clientWidth || 800), H = 240, padL = 52, padR = 14, padT = 18, padB = 26;
    const vals = series.map(s=>s.net).concat(series.map(s=>s.cm));
    const maxY = Math.max(1, ...vals)*1.1, minY = Math.min(0, ...vals)*1.1;
    const n = series.length, X = i => padL + (n>1 ? i/(n-1) : 0.5)*(W-padL-padR), Y = v => padT + (1-(v-minY)/(maxY-minY))*(H-padT-padB);
    const grid = resolveVar('var(--gridline)'), ink = resolveVar('var(--ink-muted)'), c1 = resolveVar('var(--series-1)'), c4 = resolveVar('var(--series-4)');
    let out = '';
    for(let i=0;i<=4;i++){ const v = minY + (maxY-minY)*i/4; out += `<line x1="${padL}" x2="${W-padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="${grid}" stroke-width="1"/><text x="${padL-6}" y="${Y(v)+4}" text-anchor="end" font-size="10" fill="${ink}">${money(v,{compact:true})}</text>`; }
    const labelOf = s => g==='month' ? (LANG==='vi' ? 'T'+parseInt(s.label.slice(5,7),10) : MONTHS_EN[+s.label.slice(5,7)-1]) : fmtDate(new Date(+s.label.slice(0,4), +s.label.slice(5,7)-1, +s.label.slice(8,10)));
    const step = Math.max(1, Math.ceil(n/8));
    series.forEach((s,i)=>{ if(i%step===0 || i===n-1) out += `<text x="${X(i)}" y="${H-8}" text-anchor="middle" font-size="10" fill="${ink}">${labelOf(s)}</text>`; });
    if(minY<0) out += `<line x1="${padL}" x2="${W-padR}" y1="${Y(0)}" y2="${Y(0)}" stroke="${ink}" stroke-width="1" stroke-dasharray="3 3"/>`;
    const path = key => series.map((s,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(s[key]).toFixed(1)).join(' ');
    out += `<path d="${path('net')} L${X(n-1).toFixed(1)} ${Y(Math.max(0,minY)).toFixed(1)} L${X(0).toFixed(1)} ${Y(Math.max(0,minY)).toFixed(1)} Z" fill="${c1}" fill-opacity=".08"/>`;
    out += `<path d="${path('net')}" fill="none" stroke="${c1}" stroke-width="2.2" stroke-linejoin="round"/>`;
    out += `<path d="${path('cm')}" fill="none" stroke="${c4}" stroke-width="2" stroke-linejoin="round"/>`;
    // peak label
    let pi = 0; series.forEach((s,i)=>{ if(s.net>series[pi].net) pi = i; });
    if(n>1){ const px = X(pi), py = Y(series[pi].net); out += `<circle cx="${px}" cy="${py}" r="3.5" fill="${c1}"/><text x="${px}" y="${Math.max(10, py-9)}" text-anchor="${pi>n*0.8?'end':(pi<n*0.2?'start':'middle')}" font-size="10.5" font-weight="600" fill="${resolveVar('var(--ink-primary)')}">${tx('rev.peak')} ${money(series[pi].net,{compact:true})}</text>`; }
    // hover
    out += series.map((s,i)=>`<rect data-i="${i}" x="${(X(i)-(W-padL-padR)/Math.max(1,n-1)/2).toFixed(1)}" y="${padT}" width="${((W-padL-padR)/Math.max(1,n-1)).toFixed(1)}" height="${H-padT-padB}" fill="transparent"/>`).join('');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H); svg.innerHTML = out;
    const tip = document.getElementById('revTip');
    if(tip){ svg.onmousemove = e=>{ const r = e.target.closest('rect[data-i]'); if(!r){ tip.style.opacity = 0; return; } const s = series[+r.dataset.i]; tip.innerHTML = `<div class="t-title">${labelOf(s)}${s.n>1 ? ' · '+s.n+' '+tx('u.days') : ''}</div><div class="t-row"><span>${tx('m.netRevenue')}</span><b>${money(s.net)}</b></div><div class="t-row"><span>CM3</span><b>${money(s.cm)}</b></div><div class="t-row"><span>${tx('m.orders')}</span><b>${intFmt(s.orders)}</b></div><div class="t-row"><span>${tx('m.adSpend')}</span><b>${money(s.ads)}</b></div>`; tip.style.opacity = 1; const bx = svg.getBoundingClientRect(); tip.style.left = Math.min(bx.width-170, Math.max(0, e.clientX-bx.left+12))+'px'; tip.style.top = Math.max(0, e.clientY-bx.top-70)+'px'; }; svg.onmouseleave = ()=>{ tip.style.opacity = 0; }; }
    const best = series[pi];
    setNote('revNote', n>1 ? tx('rev.note', {best: money(best.net,{compact:true}), day: labelOf(best)}) : '');
    const lg = document.getElementById('revLegend'); if(lg) lg.innerHTML = `<span class="li"><span class="sw" style="background:${c1}"></span>${tx('m.netRevenue')}</span><span class="li"><span class="sw" style="background:${c4}"></span>CM3</span>`;
    setNote('revCaption', tx('rev.caption'));
  }

  // ---- sales channels: donut + list (CH_COLOR defined with the other channel constants) ----
  function renderChannels(){
    const el = document.getElementById('chanList'); if(!el) return;
    const rows = currentRows(), a = aggregate(rows), ce = channelEcon(a);   // V11.3: the four channels, each on its own
    const keys = CH_KEYS.filter(k=> ce[k].net>0.005).sort((x,y)=>ce[y].net-ce[x].net);
    const tot = sum(keys.map(k=>ce[k].net));
    const svg = document.getElementById('chanDonut');
    if(svg){
      let out = '', acc = 0; const R = 62, r = 44, cx = 75, cy = 75;
      keys.forEach(k=>{ const f = tot>0 ? ce[k].net/tot : 0; if(f<=0) return; const a0 = acc*2*Math.PI - Math.PI/2, a1 = (acc+f)*2*Math.PI - Math.PI/2; acc += f; const big = f>0.5 ? 1 : 0; const p = (ang, rad) => [cx+rad*Math.cos(ang), cy+rad*Math.sin(ang)]; const [x0,y0] = p(a0,R), [x1,y1] = p(a1,R), [x2,y2] = p(a1,r), [x3,y3] = p(a0,r); out += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${big} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} A${r} ${r} 0 ${big} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z" fill="${resolveVar(CH_COLOR[k])}" stroke="${resolveVar('var(--surface-card)')}" stroke-width="2"><title>${CH_LABEL[k]} ${money(ce[k].net)}</title></path>`; });
      out += `<text x="${cx}" y="${cy-2}" text-anchor="middle" font-size="17" font-weight="600" fill="${resolveVar('var(--ink-primary)')}" font-family="var(--font-display)">${money(tot,{compact:true})}</text><text x="${cx}" y="${cy+14}" text-anchor="middle" font-size="10" fill="${resolveVar('var(--ink-muted)')}">${tx('m.netRevenue')}</text>`;
      svg.innerHTML = out;
    }
    el.innerHTML = keys.map(k=>`<div class="r"><span class="sw" style="background:${CH_COLOR[k]}"></span><span><div style="font-weight:600;">${CH_LABEL[k]}</div><div class="bar"><i style="width:${tot>0?(ce[k].net/tot*100).toFixed(1):0}%;background:${CH_COLOR[k]}"></i></div></span><span class="v">${money(ce[k].net,{compact:true})}</span><span class="p">${tot>0?Math.round(ce[k].net/tot*100):0}%</span></div>`).join('') || `<div class="r"><span>${tx('u.noData')}</span></div>`;
    setNote('chanNote', tx('chan.note', {total: money(tot,{compact:true}), n: keys.length}));
    const st = document.getElementById('chanStats'); if(st) st.innerHTML = `<div class="ms"><div class="l">${tx('chan.avgDay')}</div><div class="v">${money(rows.length ? tot/rows.length : 0,{compact:true})}</div></div><div class="ms"><div class="l">${tx('chan.perOrder')}</div><div class="v">${money(a.blendedAOV)}</div></div>`;
  }

  // ---- per-SKU economics (shared by the product P&L table and the product-lines card) ----
  function skuEconomics(rows){
    const sa = skuAggregate(rows);
    const keys = SKU_CH.filter(k=> CH_MASK[k] && sa[k].days>0);
    const items = {}; let chCm = 0, covMin = 1e9, realCost = 0, allSkus = 0;
    keys.forEach(k=>{
      const o = sa[k]; covMin = Math.min(covMin, o.days);
      const rk = rows.filter(r=> r.sku && r.sku[k]);
      const ak = aggregate(rk), ck = channelEcon(ak)[k]; chCm += ck.cm;
      const skus = [...new Set(Object.keys(o.units).concat(Object.keys(o.sales)))];
      const fc = fifoSkuCosts(rows, k);   // V11: FIFO cost per SKU over the same (masked) days
      const G = sum(skus.map(x=>o.sales[x]||0)), U = sum(skus.map(x=>o.units[x]||0));
      const rw = {}; let RW = 0; skus.forEach(x=>{ const u = o.units[x]||0, g = o.sales[x]||0; rw[x] = u>0 ? (o.refunds[x]||0)*(g/u) : 0; RW += rw[x]; });
      skus.forEach(x=>{
        const g = G>0 ? (o.sales[x]||0)/G : 0, us = U>0 ? (o.units[x]||0)/U : 0, rs = RW>0 ? rw[x]/RW : g;
        const units = o.units[x]||0, cost = skuCost(x);
        const gross = ak.gross[k]*g, disc = ak.discountBy[k]*g, ref = ak.refund[k]*rs, net = gross - disc - ref;
        const sc = skuCogsOf(fc, x, units, net, ck, g), cogs = sc.cogs;
        const fulfil = ck.fulfil*us, fees = ck.fees*g, ads = ck.adsAll*g;
        const it = items[x] = items[x] || {sku:x, line: productLineOf(x), ch:{}, chNet:{}, units:0, refunds:0, gross:0, disc:0, ref:0, net:0, cogs:0, cogsReal:0, fulfil:0, fees:0, ads:0, cm:0};
        it.ch[k] = true; it.chNet[k] = (it.chNet[k]||0) + net; it.units += units; it.refunds += o.refunds[x]||0; it.gross += gross; it.disc += disc; it.ref += ref; it.net += net; it.cogs += cogs; it.cogsReal += sc.real; it.fulfil += fulfil; it.fees += fees; it.ads += ads; it.cm += net - cogs - fulfil - fees - ads;
        allSkus++; if(sc.real>0) realCost++;
      });
    });
    return {items, keys, chCm, covMin: keys.length ? covMin : 0, realCost, allSkus, n: rows.length};
  }
  function lineEconomics(rows){
    const e = skuEconomics(rows); const lines = {};
    Object.values(e.items).forEach(it=>{ const l = lines[it.line] = lines[it.line] || {id: it.line, skus:0, chNet:{}, units:0, refunds:0, gross:0, net:0, cogs:0, cogsReal:0, fulfil:0, fees:0, ads:0, cm:0}; l.skus++; ['units','refunds','gross','net','cogs','cogsReal','fulfil','fees','ads','cm'].forEach(f=>{ l[f] += it[f]; }); Object.keys(it.chNet||{}).forEach(k=>{ l.chNet[k] = (l.chNet[k]||0) + it.chNet[k]; }); });
    return {lines, keys: e.keys, covMin: e.covMin, n: e.n, realCost: e.realCost, allSkus: e.allSkus};
  }

  // ---- stock on hand + velocity per SKU across FBA and ShipMonk (for product lines, risks, inventory page) ----
  let _stockCache = {ver:null, rows:null};
  function stockRows(){
    const key = _maskVer+'|'+TODAY_ISO;
    if(_stockCache.ver===key) return _stockCache.rows;
    const out = {};
    const get = sku => out[sku] = out[sku] || {sku, line: productLineOf(sku), fba:0, fbaInbound:0, smk:0, smkIncoming:0, unitsAz:0, unitsSh:0, days:0, sales:0, known:false};
    const skipSku = sku => /^amzn\.gr\./i.test(sku) || sku==='(no sku)' || sku==='RETURN-OFFSET';
    const snap = AMAZON_STORAGE_LIVE_DATA && AMAZON_STORAGE_LIVE_DATA.inventory && AMAZON_STORAGE_LIVE_DATA.inventory.snapshot;
    if(snap) Object.keys(snap).forEach(sku=>{ if(skipSku(sku)) return; const s = snap[sku], o = get(sku); o.known = true; o.fba += s.fulfillable||0; o.fbaInbound += (s.inbound_working||0)+(s.inbound_shipped||0)+(s.inbound_receiving||0); });
    if(SHIPMONK_INVENTORY && SHIPMONK_INVENTORY.skus) Object.keys(SHIPMONK_INVENTORY.skus).forEach(sku=>{ const s = SHIPMONK_INVENTORY.skus[sku], o = get(sku); o.known = true; const av = Math.max(0, Math.min(+s.available||0, (+s.on_hand||0) - (+s.quarantined||0) - (+s.unavailable||0))); o.smk += isFinite(av) ? av : 0; o.smkIncoming += +s.incoming||0; });
    // velocity: last 30 closed days with per-SKU units (either sync)
    const from = shiftIso(TODAY_ISO, 30), to = shiftIso(TODAY_ISO, 1);
    let dAz = 0, dSh = 0;
    days.forEach(r=>{ if(r.iso<from || r.iso>to || !r.sku) return; if(r.sku.amazon){ dAz++; Object.entries(r.sku.amazon.units||{}).forEach(([k,v])=>{ if(skipSku(k)) return; get(k).unitsAz += +v||0; }); Object.entries(r.sku.amazon.sales||{}).forEach(([k,v])=>{ if(!skipSku(k)) get(k).sales += +v||0; }); } if(r.sku.shopify){ dSh++; Object.entries(r.sku.shopify.units||{}).forEach(([k,v])=>{ if(skipSku(k)) return; get(k).unitsSh += +v||0; }); Object.entries(r.sku.shopify.sales||{}).forEach(([k,v])=>{ if(!skipSku(k)) get(k).sales += +v||0; }); } });
    const skuFees = (AMAZON_LIVE_DATA && AMAZON_LIVE_DATA.meta && AMAZON_LIVE_DATA.meta.sku_fees) || {}, win = (AMAZON_LIVE_DATA && AMAZON_LIVE_DATA.window_days) || 45;
    const list = Object.values(out).map(o=>{
      let perDay = 0;
      if(dAz>=14 || dSh>=14) perDay = (dAz>=14 ? o.unitsAz/dAz : 0) + (dSh>=14 ? o.unitsSh/dSh : 0);
      else if(skuFees[o.sku]) perDay = skuFees[o.sku].units/win;
      const units = o.unitsAz + o.unitsSh;
      const price = units>0 ? o.sales/units : 0;
      const stock = o.fba + o.smk, cover = (perDay>0 && o.known) ? stock/perDay : null;   // unknown stock (SKU in neither snapshot) -> no cover, no risk
      const atRisk = (cover!==null && cover<30) ? Math.max(0, (30-cover))*perDay*price : 0;
      return Object.assign(o, {perDay, price, stock, cover, atRisk});
    });
    _stockCache = {ver:key, rows:list};
    return list;
  }
  function stockRisk(){
    const list = stockRows().filter(r=> r.perDay>=0.2 && r.cover!==null && r.cover<30).sort((x,y)=>y.atRisk-x.atRisk);
    return {count: list.length, atRisk: sum(list.map(r=>r.atRisk)), top: list.slice(0,3), soonest: list.slice().sort((x,y)=>x.cover-y.cover)[0] || null};
  }

  // ---- product lines card (overview) ----
  function renderProductLines(){
    const t = document.getElementById('plTable'); if(!t) return;
    const rows = currentRows(), le = lineEconomics(rows);
    const caption = document.getElementById('plCaption');
    if(!le.keys.length){ t.innerHTML = ''; setNote('plNote', tx('u.waiting')); if(caption) caption.textContent = sinceText('sku'); renderDollar(); return; }
    const pr = prevLikeRows(); let lp = pr ? lineEconomics(pr) : null;
    if(lp && lp.covMin < le.covMin*0.9) lp = null;   // prior period lacks per-SKU days -> no fair comparison
    const stock = stockRows();
    const list = Object.values(le.lines).filter(l=>l.net>0.005 || l.units>0).sort((a,b)=>b.net-a.net);
    const totNet = sum(list.map(l=>l.net)), totCm = sum(list.map(l=>l.cm)), totUnits = sum(list.map(l=>l.units));
    const coverOf = id => { const rs = stock.filter(s=>s.line===id && s.known); const pd = sum(rs.map(s=>s.perDay)), st = sum(rs.map(s=>s.stock)); return pd>0 ? st/pd : null; };
    const dcell = (cur, prev) => (prev===null || prev===undefined || !isFinite(prev) || prev<=0) ? '<td class="num d-flat">—</td>' : `<td class="num">${pillOf((cur/prev-1)*100)}</td>`;
    t.innerHTML = `<thead><tr><th>${tx('pl.line')}</th><th class="num">${tx('m.units')}</th><th class="num">${tx('m.netRevenue')}</th><th>${tx('pl.share')}</th><th class="num">${tx('pl.vsPrior')}</th><th class="num">CM3</th><th class="num">CM3 %</th><th class="num">${tx('pl.cover')}</th></tr></thead><tbody>` +
      list.map(l=>{ const cv = coverOf(l.id); const pv = lp && lp.lines[l.id] ? lp.lines[l.id].net : null; return `<tr><td class="name">${productLineName(l.id)}<small style="display:block;font-weight:400;color:var(--ink-muted);">${l.skus} SKU${(() => { const ks = Object.keys(l.chNet||{}).filter(k=>l.chNet[k]>0.005).sort((x,y)=>l.chNet[y]-l.chNet[x]); return ks.length>1 && l.net>0 ? ' · ' + ks.map(k=>CH_LABEL[k]+' '+(l.chNet[k]/l.net*100<0.5 ? '<1' : Math.round(l.chNet[k]/l.net*100))+'%').join(' · ') : (ks.length===1 ? ' · '+CH_LABEL[ks[0]] : ''); })()}</small></td><td class="num">${intFmt(l.units)}</td><td class="num">${money(l.net,{compact:true})}</td><td><div class="bar"><i style="width:${totNet>0?(l.net/totNet*100).toFixed(1):0}%"></i></div></td>${dcell(l.net, pv)}<td class="num ${l.cm<0?'d-down':''}">${money(l.cm,{compact:true})}</td><td class="num">${l.net>0 ? (l.cm/l.net*100).toFixed(0)+'%' : '—'}</td><td class="num ${cv!==null && cv<30 ? 'd-down' : ''}">${cv===null ? '—' : (cv>365 ? '>1y' : Math.round(cv)+' '+tx('u.d'))}</td></tr>`; }).join('') +
      `<tr style="font-weight:700;"><td class="name">${tx('u.total')}</td><td class="num">${intFmt(totUnits)}</td><td class="num">${money(totNet,{compact:true})}</td><td></td><td class="num"></td><td class="num">${money(totCm,{compact:true})}</td><td class="num">${totNet>0 ? (totCm/totNet*100).toFixed(0)+'%' : '—'}</td><td class="num"></td></tr></tbody>`;
    setNote('plNote', tx('pl.note', {n: list.length, ch: le.keys.map(k=>CH_LABEL[k]).join(' + '), cov: le.covMin<le.n ? ' · '+le.covMin+'/'+le.n+' '+tx('u.daysWithSku') : ''}));
    if(caption) caption.textContent = tx('pl.caption') + (le.realCost>0 ? ' '+tx('pl.realCost', {n: le.realCost, of: le.allSkus}) : ' '+tx('pl.estCost'));
    renderDollar();
  }
  function renderDollar(){
    const bar = document.getElementById('dollarBar'), rowsEl = document.getElementById('dollarRows'); if(!bar || !rowsEl) return;
    const a = aggregate(currentRows()); const net = a.netRevenue;
    if(net<=0){ bar.innerHTML=''; rowsEl.innerHTML = `<div class="r"><span>${tx('u.noData')}</span></div>`; return; }
    const parts = [
      {k:'cogs', l: tx('d.productCost'), v: a.productCost, c:'var(--series-2)'},
      {k:'ful', l: tx('d.fulfillment'), v: a.cogs - a.productCost, c:'var(--series-3)'},
      {k:'fees', l: tx('d.fees'), v: a.feesTotal, c:'var(--series-5)'},
      {k:'mkt', l: tx('d.marketing'), v: a.marketingTotal, c:'var(--series-6)'},
      {k:'opex', l: tx('d.opex'), v: a.fixedTotal, c:'var(--series-fixed)'},
    ];
    const keep = a.netProfit;
    const per = v => v/net*100;
    bar.innerHTML = parts.map(p=>`<i style="width:${Math.max(0,per(p.v)).toFixed(1)}%;background:${p.c}" title="${p.l} ${money(p.v,{compact:true})}"></i>`).join('') + (keep>0 ? `<i style="width:${per(keep).toFixed(1)}%;background:var(--series-1)" title="EBITDA"></i>` : '');
    rowsEl.innerHTML = parts.map(p=>`<div class="r"><span class="sw" style="background:${p.c}"></span><span>${p.l}</span><span class="v">$${per(p.v).toFixed(2)}</span><span class="p">${per(p.v).toFixed(0)}%</span></div>`).join('') + `<div class="r keep"><span class="sw" style="background:var(--series-1)"></span><span>${tx('d.keep')}</span><span class="v">$${per(keep).toFixed(2)}</span><span class="p">${per(keep).toFixed(0)}%</span></div>`;
  }
  function renderExec(){
    const el = document.getElementById('execKpis'); if(!el) return;
    const rows = currentRows();
    const a = aggregate(rows);
    const prevRows = prevLikeRows(), lyRows = yearAgoRows();
    const p = aggOrNull(prevRows), ly = aggOrNull(lyRows);
    const planNet = planForRows(rows, x=>x.net_revenue), planMkt = planForRows(rows, x=>x.marketing), planOrders = planForRows(rows, x=>x.orders), planCm3 = planForRows(rows, x=>x.cm3);
    const newC = newCustomersOf(rows), newCPrev = prevRows ? newCustomersOf(prevRows) : null, newCLy = lyRows ? newCustomersOf(lyRows) : null;
    const ncac = v => (v.newC && v.newC>0) ? d2cAdsOf(v.a)/v.newC : null;
    const merNow = merComplete(rows), merPrev = prevRows ? merComplete(prevRows) : null, merLy = lyRows ? merComplete(lyRows) : null;
    const refundPct = x => x.grossSales>0 ? sum(CH_KEYS.map(k=>x.refund[k]))/x.grossSales*100 : null;
    const lk = likeLabel();
    const cmp = EXEC_STATE.cmp;
    const dl = (dPrev, dYear, dFix) => cmp==='none' ? [dFix||''] : (cmp==='year' ? [dYear, dPrev, dFix||''] : [dPrev, dYear, dFix||'']);
    const ncacNow = ncac({a, newC});
    const tiles = [
      {label:tv('Net revenue','Doanh thu thuần'), value: money(a.netRevenue, {compact:true}), title: money(a.netRevenue),
        deltas: dl(deltaLine(lk, p && dAbs(a.netRevenue, p.netRevenue)), deltaLine(tx('u.lastYear'), ly && dAbs(a.netRevenue, ly.netRevenue)), deltaLine(tx('u.plan'), planNet!==null ? dAbs(a.netRevenue, planNet) : null)),
        foot: (planNet===null ? tv('Company plan: not entered','Kế hoạch tổng: chưa nhập') : tv('Plan for this period ','Kế hoạch kỳ này ')+money(planNet,{compact:true})) + (refundPct(a)!==null ? tv(' · refunds ',' · hoàn tiền ')+refundPct(a).toFixed(1)+tv('% of gross sales','% doanh thu gộp') : ''), alert: refundPct(a)!==null && refundPct(a)>8},
      {label:tv('CM3 — contribution margin','CM3 — LN đóng góp'), value: money(a.contributionProfit, {compact:true}), title: money(a.contributionProfit),
        deltas: dl(deltaLine(lk, p && dAbs(a.contributionProfit, p.contributionProfit)), deltaLine(tx('u.lastYear'), ly && dAbs(a.contributionProfit, ly.contributionProfit)), deltaLine(tx('u.plan'), planCm3!==null ? dAbs(a.contributionProfit, planCm3) : null)),
        foot: (a.netRevenue>0 ? (a.contributionProfit/a.netRevenue*100).toFixed(1)+tv('% of net revenue','% doanh thu thuần') : '') + (a.productCostHasLots ? tv(' · product cost FIFO by receipt lot',' · giá vốn FIFO theo lô nhập')+(a.productCostEstAmount>0.5 ? tv(' + estimate',' + ước tính') : '') : a.productCostHasActual ? (a.productCostEst ? tv(' · product cost mostly from the ledger',' · giá vốn phần lớn theo sổ kho') : tv(' · product cost from the ledger',' · giá vốn theo sổ kho')) : (a.productCostEst ? tv(' · product cost estimated at ',' · giá vốn ước ')+(a.cogsEstRate*100).toFixed(0)+'%' : tv(' · product cost not deducted',' · chưa trừ giá vốn')))},
      {label:'EBITDA', value: money(a.netProfit, {compact:true}), title: money(a.netProfit),
        deltas: dl(deltaLine(lk, p && dAbs(a.netProfit, p.netProfit)), deltaLine(tx('u.lastYear'), ly && dAbs(a.netProfit, ly.netProfit)), deltaLine(tx('u.margin'), a.netRevenue>0 && p && p.netRevenue>0 ? (a.netProfit/a.netRevenue - p.netProfit/p.netRevenue)*100 : null, {pts:true})),
        foot: (a.netRevenue>0 ? tv('Margin ','Biên ')+(a.netProfit/a.netRevenue*100).toFixed(1)+'%' : '') + (a.opexDays>0 ? (a.opexEstDays>0 ? tv(' · G&A includes estimate (month not closed)',' · G&A có tạm tính (tháng chưa chốt)') : tv(' · G&A entered manually',' · G&A nhập tay')) : tv(' · no G&A yet',' · chưa có G&A')) + ((a.productCostEst||a.productCostHasActual||a.productCostHasLots) ? '' : tv(' · product cost not deducted',' · chưa trừ giá vốn'))},
      {label:'MER', value: merNow.value!==null ? merNow.value.toFixed(2)+'x' : '—',
        deltas: dl(deltaLine(lk, (merPrev && merPrev.value!==null && merNow.value!==null) ? dAbs(merNow.value, merPrev.value) : null), deltaLine(tx('u.lastYear'), (merLy && merLy.value!==null && merNow.value!==null) ? dAbs(merNow.value, merLy.value) : null), (()=>{ const be = breakEvenMer(a); return be ? `<div class="delta ${merNow.value!==null && merNow.value>=be ? 'up':'down'}"><span class="k">${tx('u.breakEven')}:</span> ${be.toFixed(2)}x</div>` : deltaLine(tx('u.breakEven'), null); })()),
        foot: merNow.days<merNow.of ? tv('Based on ','Tính trên ')+merNow.days+'/'+merNow.of+tv(' days with complete data (Amazon Ads arrives after ~18:00 VN)',' ngày đủ số (Amazon Ads về sau ~18h VN)') : tv('Every ad source reported','Đủ số mọi nguồn quảng cáo'), alert: merNow.value!==null && breakEvenMer(a) && merNow.value<breakEvenMer(a)},
      {label:tv('Marketing spend','Chi marketing'), value: money(a.marketingTotal, {compact:true}), title: money(a.marketingTotal),
        deltas: dl(deltaLine(lk, p && dAbs(a.marketingTotal, p.marketingTotal), {lowerIsBetter:true}), deltaLine(tx('u.lastYear'), ly && dAbs(a.marketingTotal, ly.marketingTotal), {lowerIsBetter:true}), deltaLine(tx('u.plan'), planMkt!==null ? dAbs(a.marketingTotal, planMkt) : null, {lowerIsBetter:true})),
        foot: (a.netRevenue>0 ? (a.marketingTotal/a.netRevenue*100).toFixed(1)+tv('% of net revenue','% doanh thu thuần') : '') + (ncacNow!==null ? ' · nCAC Shopify '+money(ncacNow)+' ('+intFmt(newC)+tv(' new customers)',' khách mới)') : tv(' · ads ',' · quảng cáo ')+money(a.merSpend,{compact:true}))},
      {label:tv('Orders · AOV','Đơn hàng · AOV'), value: intFmt(a.totalOrders), title: a.totalOrders+' '+tx('u.orders'),
        deltas: dl(deltaLine(lk, p && dAbs(a.totalOrders, p.totalOrders)), deltaLine(tx('u.lastYear'), ly && dAbs(a.totalOrders, ly.totalOrders)), deltaLine(tx('u.plan'), planOrders!==null ? dAbs(a.totalOrders, planOrders) : null)),
        foot: 'AOV '+money(a.blendedAOV)+(p ? ' · '+lk+' '+money(p.blendedAOV) : '')},
    ];
    // V10: primary comparison as a pill (top right) + sparkline of the period's daily values
    const prim = cmp==='year' ? ly : (cmp==='none' ? null : p), primMer = cmp==='year' ? merLy : (cmp==='none' ? null : merPrev);
    const pd = [prim && dAbs(a.netRevenue, prim.netRevenue), prim && dAbs(a.contributionProfit, prim.contributionProfit), prim && dAbs(a.netProfit, prim.netProfit), (primMer && primMer.value!==null && merNow.value!==null) ? dAbs(merNow.value, primMer.value) : null, prim && dAbs(a.marketingTotal, prim.marketingTotal), prim && dAbs(a.totalOrders, prim.totalOrders)];
    const lower = [false, false, false, false, true, false];
    const daily = rows.length>=3 ? dailyAgg(rows) : null;
    const sparks = daily ? [daily.map(x=>x.netRevenue), daily.map(x=>x.contributionProfit), daily.map(x=>x.netProfit), daily.map(x=> x.merSpend>0 ? x.merValue : null), daily.map(x=>x.marketingTotal), daily.map(x=>x.totalOrders)] : null;
    el.innerHTML = tiles.map((t,i)=>`<div class="kpi${t.alert?' alert':''}"><div class="kh"><span class="label">${t.label}</span>${pillOf(pd[i], lower[i])}</div><div class="value" title="${t.title||''}">${t.value}</div><div class="deltas">${t.deltas.slice(1).join('')}</div>${t.foot ? `<div class="foot">${t.foot}</div>` : ''}${sparks ? sparkSvg(sparks[i], {free: i===3}) : ''}</div>`).join('');
    const _F = fifoState();
    const defCogs = document.getElementById('defCogs'); if(defCogs) defCogs.textContent = (_F && _F.ok ? tv('FIFO by receipt lot from ','FIFO theo lô nhập từ ')+_F.meta.lots+tv(' Notion lots (',' lô Notion (')+_F.meta.skus+tv(' SKUs) on every day with units per SKU since ',' SKU) cho mọi ngày có units theo SKU từ ')+_F.first+'; ' : '') + (Object.keys(COGS_ACTUAL.months).length ? tv('actuals from the accounting inventory ledger for ','số thật từ sổ kho kế toán cho ')+Object.keys(COGS_ACTUAL.months).sort().join(', ')+tv('; the remaining months ','; các tháng còn lại ') : '') + (COGS_EST ? tv('estimated at ','ước ')+(COGS_EST.rate*100).toFixed(0)+'% — '+COGS_EST.basis : tv('not enabled — product cost $0','chưa bật — giá vốn $0'));
    renderPace(rows, a);
    renderMatrix(rows, a, prevRows, lyRows);
    const alertItems = renderAlerts(rows, a, merNow);
    const bridge = renderBridge(a, p, lk);
    renderBrief(rows, a, p, bridge, alertItems, merNow, lk);
    renderPeriodStrip();
  }

  // ---------- month pacing: cumulative actual vs plan vs forecast ----------
  function renderPace(rows, a){
    const svg = document.getElementById('paceChart'); if(!svg) return;
    const last = rows[rows.length-1];
    const m = last.iso.slice(0,7);
    const mrows = (monthMap[m] || []).map(maskRow);
    const dim = daysInMonth(m);
    const plan = PLAN.months[m] || null;
    // what to pace: company net revenue vs total plan; else Amazon gross vs the Amazon plan; else actual only
    let series = 'net', planTotal = plan ? plan.net_revenue : null, label = tv('Company net revenue','Doanh thu thuần toàn công ty');
    if(maskPartial()){ planTotal = null; label = tv('Net revenue — ','Doanh thu thuần — ')+maskLabel()+tv(' (company plan not compared while filtering)',' (kế hoạch tổng không so khi đang lọc)'); }
    // V10.2: no company plan -> pace the channels that have a plan, each on its own basis (Shopify plan = net sales, Amazon plan = gross/ordered sales)
    // V10.3: the plan of a group = the plan of its first member (Shopify net covers Shopify + TikTok Shop; Amazon gross covers Amazon + Walmart)
    const basisOf = g => { const k = CH_GROUPS.find(x=>x.id===g).members[0]; return plan && plan.channels[k] ? (plan.channels[k].net!==null ? 'net' : (plan.channels[k].gross!==null ? 'gross' : null)) : null; };
    const planned = CH_GROUPS.map(g=>g.id).filter(g=>basisOf(g));
    const activeG = CH_GROUPS.filter(g=>g.members.some(k=>CH_MASK[k])).map(g=>g.id);
    const wholeGroups = CH_GROUPS.every(g=> g.members.every(k=>CH_MASK[k]) || g.members.every(k=>!CH_MASK[k]));
    let paceCh = null;
    if(planTotal===null && planned.length && (!maskPartial() || (FILTER.market==='all' && FILTER.product==='all' && wholeGroups && activeG.every(g=>planned.includes(g))))){
      paceCh = maskPartial() ? activeG : planned; series = 'channels';
      planTotal = sum(paceCh.map(g=>{ const k = CH_GROUPS.find(x=>x.id===g).members[0]; return basisOf(g)==='net' ? plan.channels[k].net : plan.channels[k].gross; }));
      const parts = paceCh.map(g=> groupLabel(g)+' ('+(basisOf(g)==='net' ? tv('net','thuần') : tv('gross','gộp'))+')').join(' + ');
      label = parts + (paceCh.length>1 ? tv(' — sum of the channel plans',' — tổng kế hoạch các kênh') : tv(' — by order date',' — theo ngày đặt')) + tv(' (company plan not entered)',' (kế hoạch tổng chưa nhập)');
    }
    const chVal = (r,g) => sum(CH_GROUPS.find(x=>x.id===g).members.map(k=> basisOf(g)==='net' ? r.channels[k]-r.discounts[k]-r.refunds[k] : r.channels[k]));
    const valOf = r => series==='channels' ? sum(paceCh.map(g=>chVal(r,g))) : (r.channels.shopify+r.channels.amazon+r.channels.walmart+r.channels.tiktok) - sum(CH_KEYS.map(k=>r.discounts[k])) - sum(CH_KEYS.map(k=>r.refunds[k]));
    const closed = mrows.filter(r=>!r._syncing);
    const actualByDom = new Array(dim+1).fill(null); let cum = 0;
    closed.forEach(r=>{ cum += valOf(r); actualByDom[r.date.getDate()] = cum; });
    const mtd = cum, lastDom = closed.length ? closed[closed.length-1].date.getDate() : 0;
    // forecast: run-rate of the last 7 closed days
    const tail = closed.slice(-7); const rate = tail.length ? sum(tail.map(valOf))/tail.length : 0;
    const forecast = mtd + rate*(dim-lastDom);
    const planToDate = planTotal!==null ? planTotal*lastDom/dim : null;
    const monthLabel = tv(MONTHS_EN[parseInt(m.slice(5,7),10)-1]+' '+m.slice(0,4), 'tháng '+parseInt(m.slice(5,7),10)+'/'+m.slice(0,4));
    document.getElementById('paceTitle').textContent = tv('Pacing ','Nhịp độ ')+monthLabel+(planTotal!==null ? tv(' vs plan',' vs kế hoạch') : '');
    document.getElementById('paceNote').textContent = label;
    const k = document.getElementById('paceKpis');
    const pc = (x,y)=> y ? ((x/y-1)*100) : null;
    const fmtD = d => d===null ? '' : `<div class="delta ${d>=0?'up':'down'}">${d>=0?'▲':'▼'} ${Math.abs(d).toFixed(1)}% ${tv('vs plan','so kế hoạch')}</div>`;
    k.innerHTML = `
      <div class="kpi"><div class="label">${tv('Through day','Đến ngày')} ${lastDom||'—'}</div><div class="value">${money(mtd,{compact:true})}</div>${planToDate!==null ? fmtD(pc(mtd, planToDate)) : '<div class="delta flat">'+tv('plan: not entered','kế hoạch: chưa nhập')+'</div>'}<div class="foot">${planToDate!==null ? tv('Plan through day ','Kế hoạch đến ngày ')+lastDom+': '+money(planToDate,{compact:true}) : tv('Fill in data/targets_monthly.json','Điền vào data/targets_monthly.json')}</div></div>
      <div class="kpi"><div class="label">${tv('Full-month plan','Kế hoạch cả tháng')}</div><div class="value">${planTotal!==null ? money(planTotal,{compact:true}) : '—'}</div><div class="foot">${planTotal!==null ? money(planTotal/dim,{compact:true})+tv('/day','/ngày') : tv('None','Chưa có')}</div></div>
      <div class="kpi"><div class="label">${tv('Month-end forecast','Dự báo cuối tháng')}</div><div class="value">${money(forecast,{compact:true})}</div>${planTotal!==null ? fmtD(pc(forecast, planTotal)) : ''}<div class="foot">${tv('So far','Đã có')} ${money(mtd,{compact:true})} + ${money(rate,{compact:true})}${tv('/day','/ngày')} × ${dim-lastDom} ${tv((dim-lastDom)===1 ? 'day left (last 7-day pace)' : 'days left (last 7-day pace)','ngày còn lại (nhịp 7 ngày gần nhất)')}</div></div>`;
    // chart
    const W = Math.max(320, svg.clientWidth || svg.parentNode.clientWidth || 600), H = 220, padL = 56, padR = 14, padT = 14, padB = 28;
    const maxY = Math.max(planTotal||0, forecast, mtd, 1)*1.08;
    const X = dom => padL + (dom-1)/(dim-1)*(W-padL-padR), Y = v => padT + (1-v/maxY)*(H-padT-padB);
    const grid = resolveVar('var(--gridline)'), ink = resolveVar('var(--ink-muted)'), accent = resolveVar('var(--accent)'), plan_c = resolveVar('var(--ink-secondary)');
    let g = '';
    const ticks = 4;
    for(let i=0;i<=ticks;i++){ const v = maxY*i/ticks; g += `<line x1="${padL}" x2="${W-padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="${grid}" stroke-width="1"/><text x="${padL-6}" y="${Y(v)+4}" text-anchor="end" font-size="10" fill="${ink}">${money(v,{compact:true})}</text>`; }
    [1,5,10,15,20,25,dim].forEach(d=>{ g += `<text x="${X(d)}" y="${H-8}" text-anchor="middle" font-size="10" fill="${ink}">${d}</text>`; });
    if(planTotal!==null) g += `<line x1="${X(1)}" y1="${Y(planTotal/dim)}" x2="${X(dim)}" y2="${Y(planTotal)}" stroke="${plan_c}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    const pts = []; for(let d=1; d<=dim; d++){ if(actualByDom[d]!==null) pts.push([X(d), Y(actualByDom[d])]); }
    if(pts.length){
      g += `<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round"/>`;
      const lp = pts[pts.length-1];
      g += `<circle cx="${lp[0]}" cy="${lp[1]}" r="3.5" fill="${accent}"/>`;
      if(lastDom<dim) g += `<line x1="${lp[0]}" y1="${lp[1]}" x2="${X(dim)}" y2="${Y(forecast)}" stroke="${accent}" stroke-width="2" stroke-dasharray="2 4"/>`;
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('height', H); svg.innerHTML = g;
    document.getElementById('paceLegend').innerHTML = `<span class="li"><span class="sw" style="background:${accent}"></span>${tv('actual (cumulative by day)','thực tế (luỹ kế theo ngày)')}</span>`+(planTotal!==null ? `<span class="li"><span class="sw" style="background:${plan_c};height:2px;"></span>${tv('plan (spread evenly)','kế hoạch (rải đều)')}</span>` : '')+`<span class="li"><span class="sw" style="background:${accent};opacity:.5;height:2px;"></span>${tv('forecast','dự báo')}</span>`;
    document.getElementById('paceCaption').textContent = (series==='amazon' ? tv('Amazon 2026 plan = "Revenue FC by KA" (gross sales by order date, comparable with the Amazon line in the P&L). ','Kế hoạch Amazon 2026 = "Revenue FC by KA" (doanh thu gộp theo ngày đặt, so được với dòng Amazon trong P&L). ') : '') + tv('Today is not final, so it is left out of the actuals. Forecast = last 7-day pace, with no seasonality or events (Prime Day, Black Friday).','Ngày hôm nay chưa chốt nên không tính vào thực tế. Dự báo = nhịp 7 ngày gần nhất, chưa tính mùa vụ hay sự kiện (Prime Day, Black Friday).');
  }

  // ---------- channel matrix ----------
  // V10.3: the same figures summed per reporting group (Shopify + TikTok Shop, Amazon + Walmart)
  function groupEcon(ce){
    const out = {};
    CH_GROUPS.forEach(g=>{ const o = {net:0, orders:0, fees:0, fulfil:0, ads:0, aff:0, cogs:0, cm:0, adsAll:0}; g.members.forEach(k=>{ const c = ce[k]; if(!c) return; Object.keys(o).forEach(f=>{ o[f] += c[f]||0; }); }); out[g.id] = o; });
    return out;
  }
  function channelEcon(a){
    const smCh = {...a.shipmonkByChannel};
    const smAll = a.postage + a.shipmonkPickPack + a.packaging;
    if((smCh.shopify||0) + (smCh.amazon||0) + (smCh.walmart||0) < 0.01 && smAll > 0.01) smCh.shopify = smAll;
    const netOf = k => a.gross[k] - a.discountBy[k] - a.refund[k];
    const cogsOf = k => (a.productCostBy && a.productCostBy[k]) || 0;
    const out = {};
    // same cost lines as the P&L down to CM3 (warehousing / storage stay below CM3 as OpEx, so the channel total = the CM3 tile)
    out.amazon = {net: netOf('amazon'), orders: a.orders.amazon, fees: a.amazonMarketplaceFeesReal + a.amazonMarketplaceFeesEst, fulfil: a.fulfillment + (smCh.amazon||0), ads: a.ads.amazonads, aff: 0};
    out.shopify = {net: netOf('shopify'), orders: a.orders.shopify, fees: a.paymentFeesAll, fulfil: (smCh.shopify||0) + a.shipmonkInvoiceExtras, ads: a.ads.meta + a.ads.google + a.ads.applovin, aff: a.snowballCommission};
    out.walmart = {net: netOf('walmart'), orders: a.orders.walmart, fees: a.walmartFees, fulfil: smCh.walmart||0, ads: a.walmartAds, aff: 0};
    out.tiktok = {net: netOf('tiktok'), orders: a.orders.tiktok, fees: a.tiktokFees, fulfil: 0, ads: a.ads.tiktokads, aff: a.tiktokAffiliate + a.tiktokSmart};
    CH_KEYS.forEach(k=>{ const c = out[k]; c.cogs = cogsOf(k); c.cm = c.net - c.cogs - c.fees - c.fulfil - c.ads - c.aff; c.adsAll = c.ads + c.aff; });
    return out;
  }
  function renderMatrix(rows, a, prevRows, lyRows){
    const t = document.getElementById('matrixTable'); if(!t) return;
    const cur0 = channelEcon(a), p = aggOrNull(prevRows), ly = aggOrNull(lyRows);
    const cur = groupEcon(cur0), pe = p ? groupEcon(channelEcon(p)) : null, le = ly ? groupEcon(channelEcon(ly)) : null;
    const gsum = (g, f) => sum(CH_GROUPS.find(x=>x.id===g).members.map(k=>f(k)));
    const totalNet = a.netRevenue;
    const planGross = k => planForRows(rows, x=> x.channels[k] ? x.channels[k].gross : null, true);
    const planNet = k => planForRows(rows, x=> x.channels[k] ? x.channels[k].net : null, true);   // V10.2: Shopify plan is on net sales
    const dcell = d => d===null ? '<td class="num d-flat">—</td>' : `<td class="num ${Math.abs(d)<0.05?'d-flat':(d>=0?'d-up':'d-down')}">${d>=0?'+':''}${d.toFixed(1)}%</td>`;
    // V11.3: every channel on its own row; the reporting group (Shopify + TikTok Shop, Amazon + Walmart) appears as a
    // subtotal row only to compare with the plan, because the plans are set per group (Shopify plan = net, Amazon plan = gross).
    const pe0 = pe ? channelEcon(p) : null, le0 = le ? channelEcon(ly) : null;
    const chKeys = CH_KEYS.filter(k=> cur0[k].net>0.005 || a.gross[k]>0.005 || (pe0 && pe0[k].net>0.005));
    const groups = CH_GROUPS.map(g=>({id:g.id, members:g.members.filter(k=>chKeys.includes(k)).sort((x,y)=>cur0[y].net-cur0[x].net)})).filter(g=>g.members.length).sort((x,y)=>cur[y.id].net-cur[x.id].net);
    const keys = groups.map(g=>g.id);
    const head = `<thead><tr><th>${tx('f.channel')}</th><th class="num">${tx('u.netRev')}</th><th class="num">Mix</th><th class="num">${likeLabel()}</th><th class="num">${tv('Last year','Năm trước')}</th><th class="num">${tv('Plan','Kế hoạch')}</th><th class="num">${tv('Refunds','Hoàn tiền')}</th><th class="num">Ads + affiliate</th><th class="num">${tv('Ads/revenue','Ads/DT')}</th><th class="num">CM3${a.productCostEst?'*':''}</th><th class="num">CM3 %</th></tr></thead>`;
    const planCell = (k) => {
      const pn = planNet(k), pg = pn===null ? planGross(k) : null, pv = pn!==null ? pn : pg, pact = pn!==null ? cur[k].net : gsum(k, x=>a.gross[x]);
      return pv!==null ? `${money(pv,{compact:true})} <small style="color:var(--ink-muted)">${pn!==null ? tv('net','thuần') : tv('gross','gộp')}</small> · ${pact>0 ? '<span class="'+(pact>=pv?'d-up':'d-down')+'">'+(pact/pv*100).toFixed(0)+'%</span>' : '—'}` : '<span class="d-flat">'+tx('u.none')+'</span>';
    };
    const chRow = (k, planTxt) => { const c = cur0[k];
      return `<tr><td class="name">${CH_LABEL[k]}<small style="display:block;font-weight:400;color:var(--ink-muted);">${intFmt(c.orders)} ${tx('u.orders')} · AOV ${c.orders>0 ? money(c.net/c.orders) : '—'}</small></td>
        <td class="num">${money(c.net,{compact:true})}</td><td class="num">${totalNet>0 ? (c.net/totalNet*100).toFixed(0)+'%' : '—'}</td>
        ${dcell(pe0 ? dAbs(c.net, pe0[k].net) : null)}${dcell(le0 ? dAbs(c.net, le0[k].net) : null)}
        <td class="num">${planTxt}</td>
        <td class="num">${a.gross[k]>0 ? (a.refund[k]/a.gross[k]*100).toFixed(1)+'%' : '—'}</td>
        <td class="num">${money(c.adsAll,{compact:true})}</td><td class="num">${c.net>0 ? (c.adsAll/c.net*100).toFixed(0)+'%' : '—'}</td>
        <td class="num ${c.cm>=0?'':'d-down'}">${money(c.cm,{compact:true})}</td><td class="num">${c.net>0 ? (c.cm/c.net*100).toFixed(0)+'%' : '—'}</td></tr>`; };
    const groupRow = (g) => { const c = cur[g.id];
      return `<tr class="group" style="background:var(--surface-card-2);color:var(--ink-secondary);"><td class="name" style="font-weight:600;">${g.members.map(k=>CH_LABEL[k]).join(' + ')}<small style="display:block;font-weight:400;color:var(--ink-muted);">${tv('group vs plan','nhóm so kế hoạch')} · ${intFmt(c.orders)} ${tx('u.orders')}</small></td>
        <td class="num">${money(c.net,{compact:true})}</td><td class="num">${totalNet>0 ? (c.net/totalNet*100).toFixed(0)+'%' : '—'}</td>
        ${dcell(pe ? dAbs(c.net, pe[g.id].net) : null)}${dcell(le ? dAbs(c.net, le[g.id].net) : null)}
        <td class="num">${planCell(g.id)}</td>
        <td class="num">${gsum(g.id, x=>a.gross[x])>0 ? (gsum(g.id, x=>a.refund[x])/gsum(g.id, x=>a.gross[x])*100).toFixed(1)+'%' : '—'}</td>
        <td class="num">${money(c.adsAll,{compact:true})}</td><td class="num">${c.net>0 ? (c.adsAll/c.net*100).toFixed(0)+'%' : '—'}</td>
        <td class="num ${c.cm>=0?'':'d-down'}">${money(c.cm,{compact:true})}</td><td class="num">${c.net>0 ? (c.cm/c.net*100).toFixed(0)+'%' : '—'}</td></tr>`; };
    const body = groups.map(g=> g.members.length>1 ? g.members.map(k=>chRow(k, '<span class="d-flat" title="'+tv('The plan is set for the group — see the group row','Kế hoạch đặt theo nhóm — xem dòng nhóm')+'">'+tv('group ↓','theo nhóm ↓')+'</span>')).join('') + groupRow(g) : chRow(g.members[0], planCell(g.id))).join('');
    const tot = keys.reduce((s,k)=>({net:s.net+cur[k].net, ads:s.ads+cur[k].adsAll, cm:s.cm+cur[k].cm}), {net:0, ads:0, cm:0});
    const foot = `<tr style="font-weight:700;"><td class="name">${tx('u.total')}</td><td class="num">${money(tot.net,{compact:true})}</td><td class="num">100%</td>${dcell(p ? dAbs(a.netRevenue, p.netRevenue) : null)}${dcell(ly ? dAbs(a.netRevenue, ly.netRevenue) : null)}<td class="num"></td><td class="num">${a.grossSales>0 ? (sum(CH_KEYS.map(k=>a.refund[k]))/a.grossSales*100).toFixed(1)+'%' : '—'}</td><td class="num">${money(tot.ads,{compact:true})}</td><td class="num">${tot.net>0 ? (tot.ads/tot.net*100).toFixed(0)+'%' : '—'}</td><td class="num">${money(tot.cm,{compact:true})}</td><td class="num">${tot.net>0 ? (tot.cm/tot.net*100).toFixed(0)+'%' : '—'}</td></tr>`;
    t.innerHTML = head + '<tbody>' + body + foot + '</tbody>';
    document.getElementById('matrixCaption').innerHTML = tv('One row per channel. The plans are set per group (Shopify + TikTok Shop vs the Shopify net-sales plan, Amazon + Walmart vs the Amazon gross-sales plan), so a group row shows the plan comparison when both channels of the group sold. Ads by channel: Meta + Google + AppLovin → Shopify; Amazon Ads → Amazon; GMV Max → TikTok Shop; Walmart Connect → Walmart. CM3 = net revenue − product cost','Mỗi kênh một dòng. Kế hoạch đặt theo nhóm (Shopify + TikTok Shop so kế hoạch Shopify thuần; Amazon + Walmart so kế hoạch Amazon gộp) nên dòng nhóm chỉ hiện để so kế hoạch khi cả hai kênh trong nhóm có bán. Ads gắn kênh: Meta + Google + AppLovin → Shopify; Amazon Ads → Amazon; GMV Max → TikTok Shop; Walmart Connect → Walmart. CM3 = doanh thu thuần − giá vốn') + (a.productCostEst ? tv(' (*estimated at ',' (*ước ')+(a.cogsEstRate*100).toFixed(0)+'%'+(a.productCostHasActual?tv(', partly from the accounting inventory ledger',', một phần theo sổ kho kế toán'):'')+')' : (a.productCostHasActual ? tv(' (from the accounting inventory ledger)',' (theo sổ kho kế toán)') : tv(' ($0, not available)',' ($0, chưa có)'))) + tv(' − per-order fulfillment (FBA, ShipMonk) − marketplace/payment fees − ads − affiliate; storage and G&amp;A not deducted (column total = the CM3 tile). Plan: % = this period\'s actual (net for Shopify, gross for Amazon) ÷ plan spread evenly by day.',' − fulfillment theo đơn (FBA, ShipMonk) − phí sàn/cổng − ads − affiliate; chưa trừ lưu kho và G&amp;A (tổng cột = CM3 trên ô chỉ số). Kế hoạch: % = số thực kỳ này (Shopify thuần, Amazon gộp) ÷ kế hoạch rải đều theo ngày.');
  }

  // ---------- alerts ----------
  function renderAlerts(rows, a, merNow){
    const el = document.getElementById('alertList'); if(!el) return [];
    const items = [];
    const be = breakEvenMer(a);
    if(merNow.value!==null && be){
      if(merNow.value < be) items.push({key:'mer', go:['marketing','roasGrid'], stakeLbl:tv('more revenue to break even','DT cần thêm để hoà vốn'), todo:tv('Cut spend on the lowest-ROAS channel or raise AOV','Cắt chi kênh ROAS thấp nhất hoặc nâng AOV'), lvl:'crit', name:'MER '+merNow.value.toFixed(2)+tv('x below break-even ','x dưới mức hoà vốn ')+be.toFixed(2)+'x', note:tv('Every $1 of ads is not covering CM2 — see the Marketing page','Mỗi $1 quảng cáo đang không đủ bù CM2 — xem trang Marketing'), stake:(be-merNow.value)*merNow.spend, action:tv('Cut spend on the lowest-ROAS channel or raise AOV; ','Cắt chi ở kênh ROAS thấp nhất hoặc nâng AOV; cần thêm ')+money((be-merNow.value)*merNow.spend,{compact:true})+tv(' more revenue needed to break even',' doanh thu để hoà vốn')});
      else if(merNow.value < be*1.15) items.push({key:'merNear', go:['marketing','roasGrid'], todo:tv('Hold ad budgets and watch ROAS daily','Giữ nguyên ngân sách quảng cáo, theo dõi ROAS hằng ngày'), lvl:'warn', name:'MER '+merNow.value.toFixed(2)+tv('x close to break-even ','x sát mức hoà vốn ')+be.toFixed(2)+'x', note:tv('Safety margin under 15% · ','Biên an toàn dưới 15% · còn ')+money((merNow.value-be)*merNow.spend,{compact:true})+tv(' left before a loss',' trước khi lỗ'), stake:null, action:tv('Watch daily; do not raise budgets until ROAS improves','Theo dõi từng ngày; đừng tăng ngân sách khi ROAS chưa cải thiện')});
    }
    const last = rows[rows.length-1], m = last.iso.slice(0,7), plan = PLAN.months[m];
    if(plan){
      const closed = (monthMap[m]||[]).filter(r=>!r._syncing), lastDom = closed.length ? closed[closed.length-1].date.getDate() : 0, dim = daysInMonth(m);
      const check = (label, actual, planV) => { if(planV===null || !lastDom) return; const exp = planV*lastDom/dim; const d = (actual/exp-1)*100; if(d < -10) items.push({key:'pace', go:['exec','paceCard'], stakeLbl:tv('short of plan','thiếu so kế hoạch'), todo:tv('Decide: push ','Quyết: đẩy ')+label+tv(' or lower the plan',' hay hạ kế hoạch'), lvl: d<-25?'crit':'warn', name: label+tv(' through day ',' đến ngày ')+lastDom+tv(' is below plan by ',' thấp hơn kế hoạch ')+Math.abs(d).toFixed(0)+'%', note: money(actual,{compact:true})+tv(' vs ',' so với ')+money(exp,{compact:true})+tv(' plan spread evenly',' kế hoạch rải đều'), stake: exp-actual, action:tv('Short ','Thiếu ')+money(exp-actual,{compact:true})+tv(' vs the evenly spread plan — decide to push or lower the plan',' so kế hoạch rải đều — quyết thúc đẩy hay hạ kế hoạch')}); };
      check(tv('Net revenue','Doanh thu thuần'), sum(closed.map(r=> sum(CH_KEYS.map(k=>r.channels[k]-r.discounts[k]-r.refunds[k])))), plan.net_revenue);
      CH_GROUPS.forEach(g=>{ const cp = plan.channels[g.members[0]]; if(!cp) return; const mem = g.members; if(cp.net!==null) check(groupLabel(g.id)+tv(' (net revenue)',' (doanh thu thuần)'), sum(closed.map(r=>sum(mem.map(k=>r.channels[k]-r.discounts[k]-r.refunds[k])))), cp.net); else if(cp.gross!==null) check(groupLabel(g.id)+tv(' (gross sales)',' (doanh thu gộp)'), sum(closed.map(r=>sum(mem.map(k=>r.channels[k])))), cp.gross); });
    } else items.push({kind:'data', short:tv('No plan for this month','Chưa có kế hoạch tháng'), lvl:'warn', name:tv('No plan for ','Chưa có kế hoạch tháng ')+(LANG==='vi' ? parseInt(m.slice(5,7),10)+'/'+m.slice(0,4) : MONTHS_EN[parseInt(m.slice(5,7),10)-1]+' '+m.slice(0,4)), note:tv('Fill in data/targets_monthly.json to get the "vs plan" column and pacing alerts','Điền data/targets_monthly.json để có cột "so kế hoạch" và cảnh báo nhịp độ'), stake:null});
    const refundPct = a.grossSales>0 ? sum(CH_KEYS.map(k=>a.refund[k]))/a.grossSales*100 : 0;
    if(refundPct>8) items.push({key:'refund', go:['sales','returnsCard'], stakeLbl:tv('over the 8% threshold','vượt ngưỡng 8%'), todo:tv('Check return reasons by channel and SKU','Xem lý do trả hàng theo kênh và SKU'), lvl: refundPct>12?'crit':'warn', name:tv('Refunds ','Hoàn tiền ')+refundPct.toFixed(1)+tv('% of gross sales','% doanh thu gộp'), note:tv('Alert threshold 8% · ','Ngưỡng cảnh báo 8% · ')+CH_KEYS.filter(k=>a.gross[k]>0).map(k=>CH_LABEL[k]+' '+(a.refund[k]/a.gross[k]*100).toFixed(1)+'%').join(', '), stake:(refundPct-8)/100*a.grossSales, action:tv('Excess over the 8% threshold = ','Phần vượt ngưỡng 8% = ')+money((refundPct-8)/100*a.grossSales,{compact:true})+tv(' — review return reasons by channel/product',' — xem lý do trả theo kênh/sản phẩm')});
    const discPct = a.gross.shopify>0 ? a.discountBy.shopify/a.gross.shopify*100 : 0;
    if(discPct>40) items.push({key:'disc', go:['pnl','stmtTable'], stakeLbl:tv('over the 40% threshold','vượt ngưỡng 40%'), todo:tv('Review Shopify discount codes and B1G2F','Rà mã giảm giá và B1G2F trên Shopify'), lvl:'warn', name:tv('Shopify discounts ','Giảm giá Shopify ')+discPct.toFixed(0)+tv('% of Shopify gross sales','% doanh thu gộp Shopify'), note:tv('Threshold 40% · discount codes, automatic promotions, B1G2F — see the P&L page','Ngưỡng 40% · mã giảm giá, KM tự động, B1G2F — xem trang Lãi lỗ'), stake:(discPct-40)/100*a.gross.shopify, action:tv('Excess over the 40% threshold = ','Phần vượt ngưỡng 40% = ')+money((discPct-40)/100*a.gross.shopify,{compact:true})+tv(' — review discount codes and B1G2F',' — rà mã giảm giá và B1G2F')});
    if(a.amazonAdsProvisionalDays>0 || merNow.days<merNow.of) items.push({kind:'data', short:tv('Amazon Ads missing ','Amazon Ads thiếu ')+nDays(merNow.of-merNow.days), lvl:'warn', name:tv('Amazon Ads has no data for the last ','Amazon Ads chưa có số cho ')+(merNow.of-merNow.days)+tv((merNow.of-merNow.days)===1 ? ' day of the period' : ' days of the period',' ngày cuối kỳ'), note:tv('Sellerboard exports once a day (~18:00 VN) — MER and marketing spend for this period will rise when it lands','Sellerboard xuất 1 lần/ngày (~18h giờ VN) — MER và chi marketing kỳ này sẽ tăng khi số về'), stake:null, action: a.amazonAdsProvisionalAmt>0 ? tv('Provisionally counting ','Đang tạm tính ')+money(a.amazonAdsProvisionalAmt,{compact:true})+tv(' of cost',' chi phí') : tv('Wait for the data, then recheck MER','Chờ số về rồi xem lại MER')});
    SOURCES.filter(s0=> s0.level==='w' || s0.level==='c').forEach(s0=>{ if(s0.level==='c' && !HEALTH_FLAG[s0.key]) return; items.push({kind:'data', short:s0.name+' · '+s0.age, lvl: s0.level==='c'?'crit':'warn', name:tx('u.source')+' '+s0.name, note: s0.age, stake:null, action:tx('u.seeData')}); });
    if(a.productCostHasLots){
      const U = a.productCostLotUnits + a.productCostFbUnits + a.productCostEstUnits, estPct = a.productCost>0 ? a.productCostEstAmount/a.productCost*100 : 0;
      if(estPct>10) items.push({kind:'data', short:tv('Product cost ','Giá vốn ')+estPct.toFixed(0)+tv('% estimated','% còn ước tính'), lvl:'warn', name:tv('Product cost: ','Giá vốn: ')+estPct.toFixed(0)+tv('% still estimated','% còn ước tính'), note:money(a.productCostLots+a.productCostFallback,{compact:true})+tv(' FIFO by receipt lot, ',' FIFO theo lô nhập, ')+money(a.productCostEstAmount,{compact:true})+tv(' estimated at ',' ước ')+(a.cogsEstRate*100).toFixed(0)+tv('% for sales without units per SKU (Walmart, TikTok Shop, items without SKU, days before the SKU data)','% cho doanh số không có units theo SKU (Walmart, TikTok Shop, hàng không SKU, ngày trước khi có dữ liệu SKU)'), stake:null, action:tv('Run the SKU backfill (Shopify / Amazon sync, from 2025-01-01)','Chạy backfill SKU (sync Shopify / Amazon, từ 01/01/2025)')});
      else items.push({lvl:'ok', name:tv('Product cost: FIFO by receipt lot','Giá vốn: FIFO theo lô nhập'), note:(U>0 ? (a.productCostLotUnits/U*100).toFixed(0)+tv('% of units from Notion receipt lots',' % units theo lô nhập Notion') : '')+(a.productCostFbUnits>0 ? tv(' · ',' · ')+(a.productCostFbUnits/U*100).toFixed(0)+tv('% nearest-lot / per-SKU cost','% giá lô gần nhất / theo SKU') : '')+(SHIPMONK_BOM ? tv(' · BOM: ShipMonk bundles',' · BOM: bundle ShipMonk') : tv(' · BOM: cogs_skus only',' · BOM: chỉ cogs_skus'))+(a.boxMode ? tv(' · boxes per package',' · hộp theo kiện') : ''), stake:null});
    }
    else if(!a.productCostEst && !a.productCostHasActual) items.push({kind:'data', short:tv('Product cost not deducted','Chưa trừ giá vốn'), lvl:'warn', name:tv('Product cost not deducted','Chưa trừ giá vốn sản phẩm'), note:tv('CM3 and EBITDA are overstated — fill in data/cogs_monthly.json (accounting figures) or enable cogs_estimate in data/targets_monthly.json','CM3 và EBITDA đang cao hơn thực tế — điền data/cogs_monthly.json (số kế toán) hoặc bật cogs_estimate trong data/targets_monthly.json'), stake:null});
    else if(a.productCostEst && a.productCostHasActual) items.push({lvl:'ok', name:tv('Product cost: partly still estimated','Giá vốn: một phần còn ước tính'), note:money(a.productCostActual,{compact:true})+tv(' from the accounting inventory ledger, ',' theo sổ kho kế toán, ')+money(a.productCostEstAmount,{compact:true})+tv(' still estimated at ',' còn ước ')+(a.cogsEstRate*100).toFixed(0)+tv('% — fill in the remaining channels/months in data/cogs_monthly.json','% — điền nốt các kênh/tháng còn trống trong data/cogs_monthly.json'), stake:null});
    else if(a.productCostEst) items.push({kind:'data', short:tv('Product cost estimated at ','Giá vốn ước ')+(a.cogsEstRate*100).toFixed(0)+'%', lvl:'warn', name:tv('Product cost is still an estimate of ','Giá vốn còn là ước tính ')+(a.cogsEstRate*100).toFixed(0)+'%', note:tv('No accounting figures for this period — CM3, EBITDA and channel margins are approximations (','Chưa có số kế toán kỳ này — CM3, EBITDA và biên theo kênh chỉ là xấp xỉ (')+money(a.productCostEstAmount,{compact:true})+tv(' estimated). Fill in data/cogs_monthly.json once the inventory report is available.',' đang ước). Điền data/cogs_monthly.json khi có báo cáo tồn kho.'), stake:null, action:tv('Send CAU_HOI_GUI_KE_TOAN.txt to the accountant','Gửi CAU_HOI_GUI_KE_TOAN.txt cho kế toán')});
    try{ const sr = stockRisk(); if(sr.count>0){ const list = sr.top.map(r=>r.sku).join(', '); items.push({key:'stock', go:['inventory','invCard'], stakeLbl:tv('revenue at risk · 30 days','DT có thể mất · 30 ngày'), todo: tx('risk.stockoutAction', {list}), skus: sr.top.map(r=>r.sku), soon: sr.soonest, lvl: sr.atRisk>5000 ? 'crit' : 'warn', name: tx('risk.stockout', {n: sr.count}), note: tx('risk.stockoutNote', {list}), stake: sr.atRisk, action: tx('risk.stockoutAction', {list})}); } }catch(e){}
    if(a.opexDays===0) items.push({kind:'data', short:tv('No G&A this period','Chưa có G&A kỳ này'), lvl:'warn', name:tv('No G&A for this period','Chưa có G&A kỳ này'), note:tv('EBITDA does not yet deduct salaries/office — fill in data/opex_monthly.json','EBITDA chưa trừ lương/văn phòng — điền data/opex_monthly.json'), stake:null});
    if(!items.length) items.push({lvl:'ok', name:tv('No alerts','Không có cảnh báo'), note:tv('MER above break-even, pacing on plan, every source reported','MER trên hoà vốn, nhịp độ trong kế hoạch, mọi nguồn đủ số'), stake:null});
    const order = {crit:0, warn:1, ok:2};
    items.sort((x,y)=> (order[x.lvl]-order[y.lvl]) || ((y.stake||0)-(x.stake||0)));
    el.innerHTML = items.map(i=>`<div class="gap-row ${i.lvl}"><span class="dot ${i.lvl==='crit'?'c':i.lvl==='warn'?'w':'g'}"></span><span class="g-name">${i.name}${i.stake>0 ? ' <span class="stake" title="'+tv('Money affected','Số tiền đang bị ảnh hưởng')+'">'+money(i.stake,{compact:true})+'</span>' : ''}</span><span class="g-note">${i.action ? i.action+' · ' : ''}${i.note}</span></div>`).join('');
    return items;
  }

  // ---------- page 5: Amazon FBA inventory by SKU (Inventory API snapshot + units sold in the sync window) ----------
  // ---------- V8: manual purchase orders (data/purchase_orders.json) + landed cost per SKU (data/cogs_skus.json) ----------
  const PO_LIVE_DATA = (window.__LIVE && window.__LIVE["purchase_orders"]) || null;
  const COGS_SKUS_LIVE_DATA = (window.__LIVE && window.__LIVE["cogs_skus"]) || null;
  function parsePurchaseOrders(data){
    const out = [];
    if(!data || typeof data!=='object' || !Array.isArray(data.orders)) return out;
    data.orders.forEach(o=>{
      if(!o || typeof o!=='object') return;
      const sku = String(o.sku||'').trim(), qty = Math.round(parseFloat(o.qty)||0), eta = /^\d{4}-\d{2}-\d{2}$/.test(String(o.eta||'')) ? String(o.eta) : null;
      if(!sku || qty<=0) return;
      const dest = String(o.destination||'fba').toLowerCase();
      out.push({sku, qty, eta, dest: /ship|monk|3pl/.test(dest) ? 'shipmonk' : 'fba', supplier: String(o.supplier||''), po: String(o.po||''), note: String(o.note||''), received: o.received===true});
    });
    return out.sort((x,y)=> (x.eta||'9999') < (y.eta||'9999') ? -1 : 1);
  }
  const PURCHASE_ORDERS = parsePurchaseOrders(PO_LIVE_DATA);
  function parseCogsSkus(data){
    const map = {};
    if(!data || typeof data!=='object' || !data.skus || typeof data.skus!=='object') return map;
    Object.keys(data.skus).forEach(sku=>{ const v = data.skus[sku]; if(v && typeof v==='object') map[String(sku).trim()] = {code: v.code||'', name: v.name||'', cost: isFinite(parseFloat(v.landed_cost)) ? parseFloat(v.landed_cost) : null, components: (v.components && typeof v.components==='object') ? v.components : null}; });
    return map;
  }
  const COGS_SKUS = parseCogsSkus(COGS_SKUS_LIVE_DATA);
  // landed cost of one platform SKU: its own number, else the sum of its components (bundles / multipacks)
  // ---------- V11: FIFO landed cost from receipt lots (data/cogs_lots.json <- Notion Reorder Tracker) ----------
  // One lot = one SKU line of one inbound container with its landed cost per unit (EXW + freight/unit + duties/unit, Notion's
  // own formulas, rebuilt and checked 32/32 against the accountant's export). Units sold per SKU per day consume lots
  // first-in-first-out per stock pool: Amazon sells from FBA/AWD, Shopify / TikTok Shop / Walmart from ShipMonk + SAT; a SKU
  // stocked in one pool only is shared by every channel. Opening stock on the first day with units per SKU = units on hand
  // today + units sold since - units received since, kept from the NEWEST earlier lots (FIFO leaves the newest on the shelf).
  // Returns are not put back (the accountant's rule on returned stock is still open). A unit no lot can cover takes, in order:
  // the next lot's cost, the last lot's cost, the other pool's lot cost, data/cogs_skus.json, else the % estimate.
  // P&L precedence: accounting figure for the month+channel (data/cogs_monthly.json) > FIFO lots > % estimate.
  const FIFO_CH_POOL = {amazon:'fba', shopify:'d2c', walmart:'d2c', tiktok:'d2c'};
  const fifoPoolOf = dest => { const x = String(dest||'').toLowerCase(); if(!x) return null; if(/\bfba\b|\bawd\b|amazon/.test(x)) return 'fba'; if(/shipmonk|\bsat\b|bsf|walmart|uline/.test(x)) return 'd2c'; return null; };
  const fifoBaseSku = x => /^amzn\.gr\./i.test(x) ? x.slice(8, 20) : x;
  const fifoSkip = x => x==='(no sku)' || x==='RETURN-OFFSET';
  function parseLots(data){
    const out = {lots:[], meta:{loaded:0, priced:0, unpriced:0, incoming:0, incomingUnits:0, offsite:0, skus:0, generated_at: (data && data.generated_at)||null}};
    if(!data || !Array.isArray(data.lots)) return out;
    const skus = new Set();
    data.lots.forEach(l=>{
      if(!l || !l.sku) return;
      const sku = String(l.sku).trim(); if(!sku) return;
      const rq = parseFloat(l.received_qty)||0, q = parseFloat(l.qty)||0, qty = rq>0 ? rq : q;
      if(!(qty>0)) return;
      const lv = parseFloat(l.landed), landed = (l.landed===null || l.landed===undefined || l.landed==='' || !isFinite(lv)) ? null : lv;
      const day = String(l.ata || l.eta || '').slice(0,10) || null;
      const done = rq>0 || /^(received|receiving|archived)$/i.test(String(l.status||''));
      const pool = fifoPoolOf(l.dest);
      const lot = {inbound: String(l.inbound||''), sku, pool, dest: String(l.dest||''), status: String(l.status||''), qty, day: done ? (day||'2000-01-01') : day, received: done && (!day || day<=TODAY_ISO), landed, eta: String(l.eta||'').slice(0,10)||null};
      out.meta.loaded++; skus.add(sku); if(landed!==null) out.meta.priced++; else out.meta.unpriced++;
      if(!pool) out.meta.offsite++; else if(!lot.received){ out.meta.incoming++; out.meta.incomingUnits += qty; }
      out.lots.push(lot);
    });
    out.meta.skus = skus.size;
    return out;
  }
  // components a sold SKU consumes: Amazon virtual bundle -> its parent; V11.1: ShipMonk's own bundle table first
  // (data/shipmonk.json bom.bundles, sync v1.5+: exactly what the warehouse picks - caves by colour, covers, freebies,
  // the random cave), then bundles / multipacks from data/cogs_skus.json as the fallback
  function fifoParts(sku, depth){
    const b = fifoBaseSku(sku), d = depth||0;
    const sm = SHIPMONK_BOM && SHIPMONK_BOM.bundles && SHIPMONK_BOM.bundles[b];
    if(sm && d<3){
      const ks = Object.keys(sm).filter(x=> (parseFloat(sm[x])||0)>0);
      if(!(ks.length===1 && ks[0]===b)){   // a "bundle" that is only itself x1 is a plain product
        const out = [];
        ks.forEach(x=>{ const q = parseFloat(sm[x])||0; (x===b ? [[b,1]] : fifoParts(x, d+1)).forEach(([y,qq])=>out.push([y, q*qq])); });
        if(out.length) return out;
      }
    }
    const c = COGS_SKUS[b];
    if(c && c.components && d<3){
      const out = [];
      Object.keys(c.components).forEach(x=>{ const q = parseFloat(c.components[x])||0; if(q>0) fifoParts(x, d+1).forEach(([y,qq])=>out.push([y, q*qq])); });
      if(out.length) return out;
    }
    return [[b, 1]];
  }
  const fifoBomSource = sku => { const b = fifoBaseSku(sku); if(SHIPMONK_BOM && SHIPMONK_BOM.bundles && SHIPMONK_BOM.bundles[b]){ const ks = Object.keys(SHIPMONK_BOM.bundles[b]); if(!(ks.length===1 && ks[0]===b)) return 'shipmonk'; } const c = COGS_SKUS[b]; return (c && c.components) ? 'cogs_skus' : null; };
  function fifoState(){
    let ready = false; try{ ready = booted; }catch(e){ ready = false; }   // booted is declared further down (TDZ before boot)
    if(!ready) return null;
    const sig = days.length+'|'+days.filter(r=>r.sku).length+'|'+(SHIPMONK_BOM ? Object.keys(SHIPMONK_BOM.bundles).length : 0)+'|'+days.filter(r=>r.shipmonkReal && (r.shipmonkReal.packagingItems || r.shipmonkReal.boxDataWeak)).length;
    if(_fifo && _fifo.sig===sig) return _fifo;
    try{ _fifo = buildFifo(); }catch(e){ _fifo = {ok:false, error: String(e && e.message || e), day:{}, Q:{}, meta:{}}; }
    _fifo.sig = sig;
    return _fifo;
  }
  function buildFifo(){
    if(!LOTS) LOTS = parseLots(COGS_LOTS_LIVE_DATA);
    const st = {ok:false, day:{}, Q:{}, first:null, meta: Object.assign({lots: LOTS.meta.loaded, skus: LOTS.meta.skus}, LOTS.meta)};
    if(!LOTS.lots.length) return st;
    const sales = days.filter(r=> r.sku && Object.keys(r.sku).some(k=>FIFO_CH_POOL[k]));
    if(!sales.length) return st;
    st.first = sales[0].iso;
    // queues per SKU per pool (one shared queue when the SKU is stocked in one pool only)
    const pools = {};
    LOTS.lots.forEach(l=>{ if(l.pool) (pools[l.sku] = pools[l.sku] || new Set()).add(l.pool); });
    const Q = st.Q;
    LOTS.lots.forEach(l=>{
      if(!l.pool) return;
      const shared = pools[l.sku].size<2, key = l.sku+'|'+(shared ? '*' : l.pool);
      const q = Q[key] = Q[key] || {key, sku: l.sku, pool: shared ? '*' : l.pool, home: l.pool, layers:[], last:null, sold:0, rec:0, open:0, onHand:null};
      q.layers.push({inbound: l.inbound, day: l.day, avail: l.received, cost: l.landed, qty: l.qty, left: l.qty, status: l.status, dest: l.dest, eta: l.eta});
    });
    Object.values(Q).forEach(q=>{
      q.layers.sort((a,b)=> String(a.day||'9999').localeCompare(String(b.day||'9999')) || a.inbound.localeCompare(b.inbound));
      // a lot without a landed cost yet (freight not booked) borrows the nearest priced lot of the same queue
      q.layers.forEach((y,i)=>{ if(y.cost!==null) return; let c = null; for(let j=i-1; j>=0 && c===null; j--) c = q.layers[j].cost; for(let j=i+1; j<q.layers.length && c===null; j++) c = q.layers[j].cost; y.cost = c; y.borrowed = c!==null; });
    });
    const keyOf = (sku, ch) => { const ps = pools[sku]; if(!ps) return null; if(ps.size<2) return sku+'|*'; const p = FIFO_CH_POOL[ch]; return ps.has(p) ? sku+'|'+p : null; };
    // pass 1: units each queue sells over the replay
    sales.forEach(r=> Object.keys(r.sku).forEach(k=>{ if(!FIFO_CH_POOL[k]) return; const u = r.sku[k].units||{}; Object.keys(u).forEach(x=>{ const n = parseFloat(u[x])||0; if(n<=0 || fifoSkip(x)) return; fifoParts(x).forEach(([c,qq])=>{ const key = keyOf(c, k); if(key && Q[key]) Q[key].sold += n*qq; }); }); }));
    // V11.1: boxes ShipMonk picked per package (sync v1.5+ packaging_items) draw on the box lots in the D2C pool
    // V11.2 (user OK 19/10/2026): months where ShipMonk did not yet list the box on the order (before 10/2025) are
    // ESTIMATED as one box per package shipped, split Large / Jumbo by the caves sold that day (bundles expanded through
    // the BOM), costed by FIFO over the same Notion box lots (Uline, PKGQ...) - the boxes the company bought and owns.
    const boxItemsOf = r => {
      const sr = r.shipmonkReal; if(!sr) return null;
      if(sr.packagingItems) return {items: sr.packagingItems, est: false};
      if(!sr.boxDataWeak || !(sr.packages>0)) return null;
      if(sr.packagingItemsEst) return {items: sr.packagingItemsEst, est: true};
      let L = 0, J = 0;
      const u = r.sku && r.sku.shopify && r.sku.shopify.units;
      if(u) Object.keys(u).forEach(x=>{ const n = parseFloat(u[x])||0; if(n<=0 || fifoSkip(x)) return; fifoParts(x).forEach(([c,qq])=>{ if(/^PKCTCV(2Z)?-L-/i.test(c)) L += n*qq; else if(/^PKCTCV-JMB-/i.test(c)) J += n*qq; }); });
      const shareL = (L+J)>0 ? L/(L+J) : 0.73;   // 0.73 = Large share of the boxes ShipMonk recorded in 10-12/2025
      const nL = Math.round(sr.packages*shareL), nJ = sr.packages - nL, items = {};
      if(nL>0) items['PKCTCVBX-SNGL-L'] = nL;
      if(nJ>0) items['PKCTCVBX-SNGL-J'] = nJ;
      sr.packagingItemsEst = items;
      return {items, est: true};
    };
    const boxDays = days.filter(r=> r.iso>=st.first && boxItemsOf(r));
    boxDays.forEach(r=>{ const pi = boxItemsOf(r).items; Object.keys(pi).forEach(x=>{ const n = parseFloat(pi[x])||0; if(n<=0) return; const key = keyOf(x, 'shopify'); if(key && Q[key]) Q[key].sold += n; }); });
    // pass 2: opening stock = on hand today + sold since the first day - received since, kept from the newest earlier lots
    const snap = (AMAZON_STORAGE_LIVE_DATA && AMAZON_STORAGE_LIVE_DATA.inventory && AMAZON_STORAGE_LIVE_DATA.inventory.snapshot) || {};
    const smk = (SHIPMONK_INVENTORY && SHIPMONK_INVENTORY.skus) || {}, smkPack = (SHIPMONK_INVENTORY && SHIPMONK_INVENTORY.packaging) || {};   // packaging = box stock (sync v1.5+)
    const onFba = x => { const v = snap[x]; return v ? Math.max(0, (v.total||0) - (v.inbound_working||0) - (v.inbound_shipped||0)) : null; };
    const onSmk = x => { const v = smk[x] || smkPack[x]; return (v && v.on_hand!==null && v.on_hand!==undefined) ? Math.max(0, parseFloat(v.on_hand)||0) : null; };
    Object.values(Q).forEach(q=>{
      const a = q.pool==='d2c' ? null : onFba(q.sku), b = q.pool==='fba' ? null : onSmk(q.sku);
      const known = a!==null || b!==null;
      q.onHand = known ? (a||0) + (b||0) : null;
      q.rec = q.layers.filter(y=> y.avail && y.day>=st.first).reduce((t,y)=>t+y.qty, 0);
      q.open = Math.max(0, (known ? q.onHand : 0) + q.sold - q.rec);
      let keep = q.open;
      for(let i=q.layers.length-1; i>=0; i--){ const y = q.layers[i]; if(!y.avail || y.day>=st.first) continue; const t = Math.min(y.qty, keep); y.left = t; keep -= t; }
      if(keep>0.5){ const c0 = (q.layers.find(y=>y.cost!==null)||{}).cost; q.layers.unshift({inbound: 'opening', day: '0000-00-00', avail: true, cost: c0===undefined ? null : c0, qty: keep, left: keep, status: '', dest: '', eta: null, synthetic: true}); }
      q.openShort = Math.max(0, keep);
    });
    // pass 3: replay the sales day by day
    const take = (q, d, need) => {
      let cost = 0, priced = 0, taken = 0;
      for(const y of q.layers){
        if(need<=1e-9) break;
        if(y.day>d) break;
        if(!y.avail || y.left<=1e-9) continue;
        const t = Math.min(y.left, need); y.left -= t; need -= t; taken += t;
        if(y.cost!==null){ cost += t*y.cost; priced += t; q.last = y.cost; }
      }
      return {cost, priced, taken};
    };
    const fallbackCost = (c, k, q, d) => {
      if(q){
        const nx = q.layers.find(y=> y.cost!==null && (y.day>d || !y.avail) && y.left>0); if(nx) return nx.cost;
        if(q.last!==null) return q.last;
      }
      const ps = pools[c];
      if(ps && ps.size>1){ const other = Q[c+'|'+(FIFO_CH_POOL[k]==='fba' ? 'd2c' : 'fba')]; if(other){ const y = other.layers.find(z=> z.cost!==null && z.left>0); if(y) return y.cost; if(other.last!==null) return other.last; } }
      const sc = skuCost(c); return sc!==null ? sc : null;
    };
    const tot = {lot:0, fb:0, units:0, lotUnits:0, fbUnits:0, estUnits:0};
    sales.forEach(r=>{
      const d = r.iso, rec = st.day[d] = {};
      Object.keys(r.sku).forEach(k=>{
        if(!FIFO_CH_POOL[k]) return;
        const u = r.sku[k].units||{}, o = rec[k] = {c:{}, lot:0, fb:0, units:0, lotUnits:0, fbUnits:0, estUnits:0};
        Object.keys(u).forEach(x=>{
          const n = parseFloat(u[x])||0; if(n<=0 || fifoSkip(x)) return;
          let lot = 0, fb = 0, need = 0, lotU = 0, fbU = 0;
          fifoParts(x).forEach(([c,qq])=>{
            const want = n*qq; need += want;
            const key = keyOf(c, k), q = key ? Q[key] : null;
            let rest = want;
            if(q){ const t = take(q, d, rest); lot += t.cost; lotU += t.priced; rest -= t.priced; }
            if(rest>1e-9){ const uc = fallbackCost(c, k, q, d); if(uc!==null){ fb += rest*uc; fbU += rest; rest = 0; } }
          });
          const cl = need>0 ? lotU/need : 0, cf = need>0 ? fbU/need : 0, ce = Math.max(0, 1 - cl - cf);
          o.c[x] = {n, lot, fb, lotU: n*cl, fbU: n*cf, est: n*ce};
          o.lot += lot; o.fb += fb; o.units += n; o.lotUnits += n*cl; o.fbUnits += n*cf; o.estUnits += n*ce;
        });
        ['lot','fb','units','lotUnits','fbUnits','estUnits'].forEach(f=>{ tot[f] += o[f]; });
      });
    });
    st.meta.replay = tot; st.meta.salesDays = sales.length;
    // V11.1: replay the boxes day by day (their queues are separate SKUs, so the order against the products does not matter)
    const btot = {lot:0, fb:0, units:0, lotU:0, fbU:0, estU:0, days:0, skus:{}, estDays:0, estBoxes:0, estCost:0};
    boxDays.forEach(r=>{
      const bi = boxItemsOf(r), d = r.iso, pi = bi.items, o = {c:{}, lot:0, fb:0, units:0, lotU:0, fbU:0, estU:0, est: bi.est};
      Object.keys(pi).forEach(x=>{
        const n = parseFloat(pi[x])||0; if(n<=0) return;
        const key = keyOf(x, 'shopify'), q = key ? Q[key] : null;
        let lot = 0, fb = 0, lotU = 0, fbU = 0, rest = n;
        if(q){ const t = take(q, d, rest); lot += t.cost; lotU += t.priced; rest -= t.priced; }
        if(rest>1e-9){ const uc = fallbackCost(x, 'shopify', q, d); if(uc!==null){ fb += rest*uc; fbU += rest; rest = 0; } }
        o.c[x] = {n, lot, fb, lotU, fbU, estU: rest};
        o.lot += lot; o.fb += fb; o.units += n; o.lotU += lotU; o.fbU += fbU; o.estU += rest;
        const sx = btot.skus[x] = btot.skus[x] || {n:0, cost:0, estU:0}; sx.n += n; sx.cost += lot+fb; sx.estU += rest;
      });
      (st.day[d] = st.day[d] || {}).box = o;
      btot.lot += o.lot; btot.fb += o.fb; btot.units += o.units; btot.lotU += o.lotU; btot.fbU += o.fbU; btot.estU += o.estU; btot.days++;
      if(o.est){ btot.estDays++; btot.estBoxes += o.units; btot.estCost += o.lot + o.fb; }
    });
    st.meta.boxes = btot;
    st.ok = true;
    return st;
  }
  // cost of one day+channel's units per SKU (the row may be masked to a market / product line)
  function fifoCostOfSku(fd, sk){
    const u = sk.units||{}, sales = sk.sales||{};
    let lot = 0, fb = 0, units = 0, lotU = 0, fbU = 0, estU = 0, S = 0, SE = 0;
    Object.keys(u).forEach(x=>{
      const n = parseFloat(u[x])||0, g = Math.max(0, parseFloat(sales[x])||0); S += g;
      if(x==='RETURN-OFFSET' || n<=0) return;
      const c = fd.c[x];
      if(!c || !(c.n>0)){ units += n; estU += n; SE += g; return; }
      const f = n/c.n; lot += c.lot*f; fb += c.fb*f; units += n; lotU += c.lotU*f; fbU += c.fbU*f; estU += c.est*f; SE += g*(c.est/c.n);
    });
    return {lot, fb, units, lotUnits: lotU, fbUnits: fbU, estUnits: estU, estShare: S>0 ? SE/S : (units>0 ? estU/units : 1)};
  }
  // FIFO cost per SKU over a set of day rows for one channel (masked like skuAggregate)
  function fifoSkuCosts(rowsIn, k){
    const F = fifoState(); if(!F || !F.ok) return null;
    const rows = maskPartial() ? rowsIn.map(maskRow) : rowsIn;
    const out = {};
    rows.forEach(r=>{
      const sk = r.sku && r.sku[k], fd = F.day[r.iso] && F.day[r.iso][k]; if(!sk || !fd) return;
      Object.keys(sk.units||{}).forEach(x=>{ const n = parseFloat(sk.units[x])||0, c = fd.c[x]; const o = out[x] = out[x] || {cost:0, units:0, costed:0}; o.units += n; if(c && c.n>0){ const f = n/c.n; o.cost += (c.lot+c.fb)*f; o.costed += (c.lotU+c.fbU)*f; } });
    });
    return out;
  }
  // product cost of one SKU in the SKU / product-line tables: FIFO where the replay costed it, else data/cogs_skus.json, else the channel's share
  function skuCogsOf(fc, x, units, net, ck, g){
    const f = fc && fc[x];
    if(f && f.costed>0){
      const rest = Math.max(0, units - f.costed), c1 = skuCost(x);
      const extra = rest>1e-9 ? (c1!==null ? rest*c1 : (COGS_EST ? COGS_EST.rate : 0)*Math.max(0, net)*(units>0 ? rest/units : 1)) : 0;
      return {cogs: f.cost + extra, real: f.cost + (c1!==null && rest>1e-9 ? rest*c1 : 0)};
    }
    const c = skuCost(x); if(c!==null) return {cogs: units*c, real: units*c};
    return {cogs: ck.cogs*g, real: 0};
  }
  // unit cost of the stock still on hand (FIFO layers left), for inventory capital
  function fifoUnitCostNow(sku, pool){
    const F = fifoState(); if(!F || !F.ok) return null;
    const q = F.Q[sku+'|'+pool] || F.Q[sku+'|*']; if(!q) return null;
    let u = 0, v = 0; q.layers.forEach(y=>{ if(y.avail && y.left>0 && y.cost!==null){ u += y.left; v += y.left*y.cost; } });
    if(u>0) return v/u;
    const nx = q.layers.find(y=> y.cost!==null && !y.avail); return nx ? nx.cost : (q.last!==null ? q.last : null);
  }
  // ---- Products & inventory: receipt lots card ----
  function renderLots(){
    const card = document.getElementById('lotsCard'), t = document.getElementById('lotsTable'); if(!card || !t) return;
    const F = fifoState(), L = LOTS || parseLots(COGS_LOTS_LIVE_DATA);
    const k = document.getElementById('lotsKpis');
    if(!L.lots.length){ k.innerHTML = ''; t.innerHTML = ''; setNote('lotsNote', tv('Waiting for data/cogs_lots.json (Notion receipt lots)','Chờ data/cogs_lots.json (lô nhập từ Notion)')); setNote('lotsCaption', ''); return; }
    const poolName = p => p==='fba' ? 'FBA / AWD' : p==='d2c' ? tv('ShipMonk + SAT','ShipMonk + SAT') : tv('shared','dùng chung');
    const rows = F && F.ok ? Object.values(F.Q).map(q=>{
      let left = 0, val = 0; q.layers.forEach(y=>{ if(y.avail && y.left>0){ left += y.left; if(y.cost!==null) val += y.left*y.cost; } });
      const cur = q.layers.find(y=> y.avail && y.left>0) || null;
      const next = q.layers.find(y=> !y.avail) || null;
      const recv = q.layers.filter(y=> y.avail && !y.synthetic); const last = recv.length ? recv[recv.length-1] : null;
      return {q, left, val, cur, next, last};
    }).filter(r=> r.left>0.5 || r.next) : [];
    rows.sort((x,y)=> y.val - x.val);
    const totLeft = sum(rows.map(r=>r.left)), totVal = sum(rows.map(r=>r.val));
    const R = F && F.ok ? F.meta.replay : null, U = R ? R.lotUnits + R.fbUnits + R.estUnits : 0;
    k.innerHTML = `
      <div class="kpi"><div class="label">${tv('Receipt lots','Lô nhập')}</div><div class="value">${intFmt(L.meta.loaded)}</div><div class="foot">${intFmt(L.meta.skus)} SKU · ${intFmt(L.meta.unpriced)} ${tv('without landed cost yet','chưa có giá landed')}</div></div>
      <div class="kpi"><div class="label">${tv('On hand by lot (FIFO)','Tồn theo lô (FIFO)')}</div><div class="value">${money(totVal,{compact:true})}</div><div class="foot">${intFmt(totLeft)} ${tv('units across','units ·')} ${intFmt(rows.filter(r=>r.left>0.5).length)} ${tv('SKU × pool','SKU × kho')}</div></div>
      <div class="kpi"><div class="label">${tv('Incoming lots','Lô đang về')}</div><div class="value">${intFmt(L.meta.incoming)}</div><div class="foot">${intFmt(L.meta.incomingUnits)} ${tv('units not received yet','units chưa nhận')}</div></div>
      <div class="kpi"><div class="label">${tv('Units costed from lots','Units tính theo lô')}</div><div class="value">${U>0 ? (R.lotUnits/U*100).toFixed(1)+'%' : '—'}</div><div class="foot">${U>0 ? tv('since ','từ ')+F.first+' · '+(R.fbUnits/U*100).toFixed(1)+tv('% nearest-lot / per-SKU · ','% giá lô gần nhất / theo SKU · ')+(R.estUnits/U*100).toFixed(1)+tv('% estimated','% ước tính') : '—'}</div></div>
      <div class="kpi"><div class="label">${tv('Bill of materials','Thành phần bộ bán (BOM)')}</div><div class="value">${SHIPMONK_BOM ? intFmt(Object.keys(SHIPMONK_BOM.bundles).length) : intFmt(Object.values(COGS_SKUS).filter(v=>v.components).length)}</div><div class="foot">${SHIPMONK_BOM ? tv('ShipMonk bundles · ','bundle ShipMonk · ')+String(SHIPMONK_BOM.as_of||'').slice(0,10)+(SHIPMONK_BOM.carried_over ? tv(' (carried over)',' (bản cũ)') : '')+' · '+intFmt(Object.values(COGS_SKUS).filter(v=>v.components).length)+tv(' in cogs_skus as fallback',' trong cogs_skus dự phòng') : tv('from data/cogs_skus.json — waiting for ShipMonk sync 1.5 (bundle table)','từ data/cogs_skus.json — chờ ShipMonk sync 1.5 (bảng bundle)')}</div></div>
      <div class="kpi"><div class="label">${tv('Shipping boxes (FIFO)','Hộp đóng gói (FIFO)')}</div><div class="value">${F && F.ok && F.meta.boxes && F.meta.boxes.days ? money(F.meta.boxes.lot+F.meta.boxes.fb,{compact:true}) : '—'}</div><div class="foot">${F && F.ok && F.meta.boxes && F.meta.boxes.days ? intFmt(F.meta.boxes.units)+tv(' boxes over ',' hộp trong ')+intFmt(F.meta.boxes.days)+tv(' days · one per package as ShipMonk picked it',' ngày · 1 hộp/kiện theo ShipMonk')+(F.meta.boxes.estBoxes>0.5 ? ' · '+intFmt(F.meta.boxes.estBoxes)+tv(' estimated (before 10/2025)',' ước tính (trước 10/2025)') : '')+(F.meta.boxes.estU>0.5 ? ' · '+intFmt(F.meta.boxes.estU)+tv(' with no lot = $0',' chưa có lô = $0') : '') : tv('waiting for ShipMonk sync 1.5 (packaging per order) + backfill','chờ ShipMonk sync 1.5 (hộp theo đơn) + backfill')}</div></div>`;
    setNote('lotsNote', F && F.ok ? tv('FIFO since ','FIFO từ ')+F.first+' · '+intFmt(F.meta.salesDays)+tv(' days with units per SKU',' ngày có units theo SKU') : tv('No units per SKU yet','Chưa có units theo SKU'));
    const fd = d => d ? d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(2,4) : '—';
    const lotTxt = y => y ? `${y.inbound} · ${fd(y.day||y.eta)} · ${intFmt(y.qty)} @ ${y.cost!==null ? money(y.cost) : '—'}` : '—';
    t.innerHTML = `<thead><tr><th>SKU</th><th>${tx('u.product')}</th><th>${tv('Stock pool','Kho')}</th><th class="num">${tv('On hand (FIFO)','Tồn (FIFO)')}</th><th class="num">${tv('Value','Giá trị')}</th><th class="num">${tv('Current lot cost','Giá lô đang xuất')}</th><th>${tv('Next lot','Lô kế tiếp')}</th><th>${tv('Last received','Nhận gần nhất')}</th></tr></thead><tbody>` +
      rows.slice(0,40).map(r=>`<tr><td style="font-family:var(--font-mono);font-size:11.5px;">${r.q.sku}</td><td>${(skuName(r.q.sku)||'').slice(0,34)}</td><td>${poolName(r.q.pool==='*' ? r.q.home : r.q.pool)}${r.q.pool==='*' ? ' <small style="color:var(--ink-muted)">'+tv('all channels','mọi kênh')+'</small>' : ''}</td><td class="num" title="${tv('Opening stock ','Tồn đầu ')+intFmt(r.q.open)+tv(' · sold ',' · đã bán ')+intFmt(r.q.sold)+tv(' · received ',' · đã nhận ')+intFmt(r.q.rec)+(r.q.onHand!==null ? tv(' · on hand today ',' · tồn hôm nay ')+intFmt(r.q.onHand) : '')}">${intFmt(r.left)}</td><td class="num">${money(r.val,{compact:true})}</td><td class="num">${r.cur && r.cur.cost!==null ? money(r.cur.cost) : '—'}${r.cur && r.cur.synthetic ? ' <small style="color:var(--ink-muted)">'+tv('opening','tồn đầu')+'</small>' : ''}</td><td style="font-size:11.5px;white-space:nowrap;">${lotTxt(r.next)}</td><td style="font-size:11.5px;white-space:nowrap;">${lotTxt(r.last)}</td></tr>`).join('') + '</tbody>';
    setNote('lotsCaption', (rows.length>40 ? tv('Showing the 40 largest of ','Hiện 40/')+rows.length+tv(' SKU × pool by value. ',' SKU × kho lớn nhất theo giá trị. ') : '') + tv('data/cogs_lots.json from the Notion Reorder Tracker (landed = EXW + freight/unit + duties/unit). FIFO per stock pool (FBA / AWD for Amazon; ShipMonk + SAT for Shopify, TikTok Shop, Walmart); opening stock = on hand today + sold since − received since, from the newest earlier lots; returns are not put back.','data/cogs_lots.json từ Notion Reorder Tracker (landed = EXW + cước/unit + thuế/unit). FIFO theo kho (FBA / AWD cho Amazon; ShipMonk + SAT cho Shopify, TikTok Shop, Walmart); tồn đầu = tồn hôm nay + đã bán − đã nhận từ ngày đầu, lấy từ các lô mới nhất trước đó; hàng trả chưa nhập lại.'));
  }
  function skuCost(sku, depth){
    const v = COGS_SKUS[sku]; if(!v) return null;
    if(v.cost!==null) return v.cost;
    if(v.components && (depth||0)<3){ let t = 0, any = false; for(const k of Object.keys(v.components)){ const c = skuCost(k, (depth||0)+1); if(c===null) return null; t += c*(parseFloat(v.components[k])||0); any = true; } return any ? t : null; }
    return null;
  }
  // first day a sync carries per-SKU units (sync v2.0 Shopify / v2.8 Amazon), null before the first run
  function skuUnitsSince(data){ const si = data && data.meta && data.meta.schema_info; return (si && si.sku_units_since) || null; }
  const fmtDmy = d => LANG==='vi' ? String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0') : MONTHS_EN[d.getMonth()]+' '+d.getDate();
  function renderInventory(){
    const t = document.getElementById('invTable'); if(!t) return;
    const inv = AMAZON_STORAGE_LIVE_DATA && AMAZON_STORAGE_LIVE_DATA.inventory;
    const costKnown = Object.keys(COGS_SKUS).length>0 || !!(fifoState() && fifoState().ok);
    const azSince = skuUnitsSince(AMAZON_LIVE_DATA), shSince = skuUnitsSince(SHOPIFY_LIVE_DATA);
    const gaps = document.getElementById('invGaps');
    gaps.innerHTML = [
      {name:tv('ShipMonk inventory (Shopify, Walmart, FBM)','Tồn kho ShipMonk (Shopify, Walmart, FBM)'), note: SHIPMONK_INVENTORY ? Object.keys(SHIPMONK_INVENTORY.skus||{}).length+' SKU · snapshot '+String(SHIPMONK_INVENTORY.as_of||'').slice(0,10) : tv('Waiting for the ShipMonk 1.4 script to run (stock by SKU / warehouse)','Chờ script ShipMonk 1.4 chạy (tồn kho theo SKU / kho)'), dot: SHIPMONK_INVENTORY ? 'g' : 'w'},
      {name:tv('Landed cost per SKU','Giá vốn landed theo SKU'), note: costKnown ? Object.keys(COGS_SKUS).length+tv(' SKUs in data/cogs_skus.json — used for inventory capital and profit by product',' SKU trong data/cogs_skus.json — dùng cho vốn tồn kho và lãi theo sản phẩm') : tv('Fill in data/cogs_skus.json (from the accounting inventory report) to compute capital tied up in inventory and profit by product','Điền data/cogs_skus.json (từ báo cáo tồn kho kế toán) để tính vốn nằm trong tồn kho và lãi theo sản phẩm'), dot: costKnown ? 'g' : 'c'},
      {name:tv('Units sold per SKU per day (Amazon, Shopify)','Số lượng bán theo SKU mỗi ngày (Amazon, Shopify)'), note: (azSince||shSince) ? tv('Available from ','Có từ ')+[azSince ? 'Amazon '+azSince : null, shSince ? 'Shopify '+shSince : null].filter(Boolean).join(' · ') : tv('The Shopify 2.0 / Amazon 2.8 sync scripts write units per SKU per day — waiting for the first run after upload','Script đồng bộ Shopify 2.0 / Amazon 2.8 ghi units theo SKU mỗi ngày — chờ lần chạy đầu sau khi up'), dot: (azSince||shSince) ? 'g' : 'w'},
      {name:tv('Purchase orders (PO) outside Amazon inbound','Hàng đang đặt (PO) ngoài Amazon inbound'), note: PURCHASE_ORDERS.length ? PURCHASE_ORDERS.length+tv(' POs in data/purchase_orders.json',' PO trong data/purchase_orders.json') : tv('Enter by hand in data/purchase_orders.json (SKU, quantity, ETA) — counted in the stock-out date','Nhập tay vào data/purchase_orders.json (SKU, số lượng, ngày về) — tính vào ngày hết hàng'), dot: PURCHASE_ORDERS.length ? 'g' : 'w'},
    ].map(g=>`<div class="gap-row"><span class="dot ${g.dot}"></span><span class="g-name">${g.name}</span><span class="g-note">${g.note}</span></div>`).join('');
    renderPurchaseOrders(inv && inv.snapshot ? inv.snapshot : {});
    if(!inv || !inv.snapshot){ document.getElementById('invNote').textContent = tv('No FBA inventory snapshot yet','Chưa có snapshot tồn kho FBA'); t.innerHTML=''; document.getElementById('invKpis').innerHTML=''; document.getElementById('invCaption').textContent=''; return; }
    const snap = inv.snapshot, win = (AMAZON_LIVE_DATA && AMAZON_LIVE_DATA.window_days) || 45;
    const skuFees = (AMAZON_LIVE_DATA && AMAZON_LIVE_DATA.meta && AMAZON_LIVE_DATA.meta.sku_fees) || {};
    // sales velocity: units per SKU over the last 30 closed days from the sync's per-SKU units (v2.8+), else the 45-day fee basis
    const skuDaily = {}; let skuDays = 0;
    if(azSince && AMAZON_LIVE_DATA.daily){
      const from = shiftIso(TODAY_ISO, 30), to = shiftIso(TODAY_ISO, 1);
      Object.keys(AMAZON_LIVE_DATA.daily).forEach(iso=>{ if(iso<from || iso>to) return; const row = AMAZON_LIVE_DATA.daily[iso]; if(!row || !row.sku_units) return; skuDays++; Object.entries(row.sku_units).forEach(([k,u])=>{ skuDaily[k] = (skuDaily[k]||0) + (parseFloat(u)||0); }); });
    }
    const useDaily = skuDays>=14, velWin = useDaily ? skuDays : win;
    // last month that actually carries a per-SKU storage report (a month can be {empty:true} while Amazon has not produced it)
    const withSkus = obj => Object.keys(obj||{}).filter(k=> obj[k] && obj[k].by_sku && Object.keys(obj[k].by_sku).length).sort();
    const stMonths = (AMAZON_STORAGE_LIVE_DATA.storage && AMAZON_STORAGE_LIVE_DATA.storage.months) || {};
    const stKey = withSkus(stMonths).pop();
    const stBySku = stKey ? (stMonths[stKey].by_sku||{}) : {};
    const stTotal = stKey ? (parseFloat(stMonths[stKey].total) || sum(Object.values(stBySku).map(v=>parseFloat(v.fee)||0))) : 0;
    const ltMonths = (AMAZON_STORAGE_LIVE_DATA.ltsf && AMAZON_STORAGE_LIVE_DATA.ltsf.months) || {};
    const ltKey = withSkus(ltMonths).pop();
    const ltTotal = ltKey ? (parseFloat(ltMonths[ltKey].total) || sum(Object.values(ltMonths[ltKey].by_sku).map(v=>parseFloat(v.fee)||0))) : 0;
    const todayD = days[TOTAL_DAYS-1].date;
    const addDays = k => { const d = new Date(todayD); d.setDate(d.getDate()+k); return d; };
    const poBySku = {}; PURCHASE_ORDERS.forEach(po=>{ if(po.dest!=='fba' || po.received) return; (poBySku[po.sku] = poBySku[po.sku]||[]).push(po); });
    // the day the stock runs out: walk forward from today selling perDay units a day; inbound counts now, each PO on its ETA (a late PO counts as today)
    function runOut(stock0, perDay, arrivals){
      if(perDay<=0) return null;
      let stock = stock0; const arr = (arrivals||[]).map(a=>({d: a.eta ? Math.max(0, dayDiff(TODAY_ISO, a.eta)) : 0, q: a.qty}));
      for(let d=0; d<=730; d++){ arr.forEach(a=>{ if(a.d===d) stock += a.q; }); stock -= perDay; if(stock<0) return d; }
      return 730;
    }
    let capitalTotal = 0, capitalSkus = 0, poUnits = 0;
    const rows = Object.keys(snap).map(sku=>{
      const s = snap[sku];
      const units = useDaily ? (skuDaily[sku]||0) : (skuFees[sku] ? skuFees[sku].units : 0);
      const perDay = units/velWin;
      const inbound = (s.inbound_working||0)+(s.inbound_shipped||0)+(s.inbound_receiving||0);
      const pos = poBySku[sku]||[], poQty = sum(pos.map(p=>p.qty)); poUnits += poQty;
      const outD = runOut(s.fulfillable||0, perDay, []), outAllD = runOut((s.fulfillable||0)+inbound, perDay, pos);
      const cover = perDay>0 ? (s.fulfillable||0)/perDay : null;
      const coverIn = perDay>0 ? ((s.fulfillable||0)+inbound+poQty)/perDay : null;
      const fee = stBySku[sku] ? stBySku[sku].fee : 0;
      const lt = ltKey && ltMonths[ltKey].by_sku && ltMonths[ltKey].by_sku[sku] ? ltMonths[ltKey].by_sku[sku].fee : 0;
      const virtual = /^amzn\.gr\./i.test(sku);   // Amazon virtual bundle: sells from its components' stock, has no stock of its own
      const fcNow = fifoUnitCostNow(sku, 'fba'), cost = fcNow!==null ? fcNow : skuCost(sku), onHand = s.total||0, capital = cost!==null ? cost*onHand : null;   // Amazon's total already includes inbound + reserved; V11: cost = FIFO lots still on hand
      if(capital!==null){ capitalTotal += capital; capitalSkus++; }
      return {sku, name: s.name||'', fulfillable: s.fulfillable||0, reserved: s.reserved||0, inbound, total: s.total||0, units, perDay, cover, coverIn, outD, outAllD, pos, poQty, fee, lt, unf: s.unfulfillable||0, cost, capital, virtual};
    }).filter(r=> r.total>0 || r.units>0 || r.poQty>0);
    rows.sort((x,y)=> (y.units - x.units) || (y.total - x.total));
    const soon = rows.filter(r=> !r.virtual && r.outAllD!==null && r.outAllD<30 && r.perDay>=0.2).sort((x,y)=>x.outAllD-y.outAllD);
    const waiting = rows.filter(r=> !r.virtual && r.outD!==null && r.outD<30 && r.perDay>=0.2 && !(r.outAllD!==null && r.outAllD<30));
    const high = rows.filter(r=> r.perDay>0 && r.coverIn!==null && r.coverIn>180 && r.total>50), dead = rows.filter(r=> r.perDay===0 && r.total>0);
    const kp = document.getElementById('invKpis');
    const soonFoot = soon.length ? tx('inv.earliest')+' '+fmtDmy(addDays(soon[0].outAllD))+' · '+soon.slice(0,3).map(r=>r.sku).join(', ') : (waiting.length ? waiting.length+tv(' SKUs waiting on inbound / PO',' SKU chờ hàng về / PO') : '—');
    kp.innerHTML = `
      <div class="kpi"><div class="label">${tv('FBA fulfillable','FBA bán được')}</div><div class="value">${intFmt(inv.fulfillable||0)}</div><div class="foot">${intFmt(inv.reserved||0)} ${tv('reserved (orders/transfers)','đang giữ (đơn/chuyển kho)')} · ${intFmt(inv.unfulfillable||0)} ${tv('unfulfillable','không bán được')} · snapshot ${inv.as_of||''}</div></div>
      <div class="kpi"><div class="label">${tv('Inbound to FBA + PO','Đang về FBA + PO')}</div><div class="value">${intFmt((inv.inbound||0)+poUnits)}</div><div class="foot">${intFmt(inv.inbound||0)} Amazon inbound · ${intFmt(poUnits)} ${tv('manual PO','PO nhập tay')} (${Object.keys(poBySku).length} SKU)</div></div>
      <div class="kpi${soon.length?' alert':''}"><div class="label">${tx('inv.soon')}</div><div class="value">${soon.length}</div><div class="foot">${soonFoot}</div></div>
      <div class="kpi"><div class="label">${costKnown ? tv('Capital tied up in FBA','Vốn nằm trong FBA') : tv('Storage fee ','Phí lưu kho ')+(stKey ? stKey.slice(5,7)+'/'+stKey.slice(0,4) : '')}</div><div class="value">${costKnown ? money(capitalTotal,{compact:true}) : money(stTotal,{compact:true})}</div><div class="foot">${costKnown ? capitalSkus+'/'+rows.length+tv(' SKUs with a cost · storage ',' SKU có giá vốn · lưu kho ')+(stKey ? stKey.slice(5,7)+'/'+stKey.slice(0,4)+' '+money(stTotal,{compact:true}) : '—') : (ltKey ? 'LTSF '+ltKey.slice(5,7)+'/'+ltKey.slice(0,4)+': '+money(ltTotal)+' · ' : '')+high.length+tv(' SKUs with &gt; 180 days of stock · ',' SKU tồn &gt; 180 ngày · ')+dead.length+tv(' SKUs with no sales in ',' SKU không bán trong ')+velWin+' '+tx('u.days')}</div></div>`;
    document.getElementById('invNote').textContent = 'Snapshot FBA Inventory API '+(inv.as_of||'')+tv(' · sales velocity = ',' · tốc độ bán = ')+(useDaily ? tv('units per SKU over the last ','units theo SKU ')+skuDays+tv(' days (sync 2.8)',' ngày gần nhất (sync 2.8)') : tv('units shipped in the ','đơn vị đã ship trong ')+win+tv('-day Amazon sync window ÷ ',' ngày đồng bộ Amazon ÷ ')+win);
    const flag = r => r.virtual ? '<span class="tag info"><span class="d"></span>'+tv('virtual bundle — stock held by its component SKUs','bundle ảo — tồn theo SKU thành phần')+'</span>' : r.perDay===0 ? '<span class="tag info"><span class="d"></span>'+tx('inv.tagNoSales')+'</span>' : r.fulfillable<=0 ? '<span class="tag gap"><span class="d"></span>'+tx('inv.tagOut')+'</span>' : (r.outAllD!==null && r.outAllD<30) ? '<span class="tag gap"><span class="d"></span>'+tx('inv.tagSoon')+'</span>' : (r.outD!==null && r.outD<30) ? '<span class="tag info"><span class="d"></span>'+tx('inv.tagWaiting')+'</span>' : (r.coverIn!==null && r.coverIn>180) ? '<span class="tag info"><span class="d"></span>'+tv('overstocked','tồn lâu')+'</span>' : '<span class="tag live"><span class="d"></span>'+tx('inv.tagOk')+'</span>';
    const fmtOut = d => d===null ? '—' : d>=365 ? tv('>1 year','>1 năm') : fmtDmy(addDays(d))+' <small style="color:var(--ink-muted)">'+d+' '+tx('u.d')+'</small>';
    const fmtPo = r => r.pos.length ? r.pos.map(p=>intFmt(p.qty)+(p.eta ? ' · '+p.eta.slice(8,10)+'/'+p.eta.slice(5,7) : '')).join('<br>') : '—';
    t.innerHTML = `<thead><tr><th>SKU</th><th>${tx('u.product')}</th><th class="num">/${tx('u.day')}</th><th class="num">${tv('Fulfillable','Bán được')}</th><th class="num">${tv('Inbound','Đang về')}</th><th class="num">${tv('Manual PO','PO nhập tay')}</th><th class="num">${tx('inv.outStock')}</th><th class="num">${tx('inv.outAll')}</th><th class="num">${tv('Stock capital','Vốn tồn')}</th><th class="num">${tv('Storage/month','Lưu kho/tháng')}</th><th>${tx('u.status')}</th></tr></thead><tbody>`+
      rows.slice(0,60).map(r=>`<tr><td style="font-family:var(--font-mono);font-size:11.5px;">${r.sku}</td><td title="${r.name.replace(/"/g,'&quot;')}">${r.name.slice(0,44)}${r.name.length>44?'…':''}</td><td class="num" title="${intFmt(r.units)} units / ${velWin} ${tx('u.days')}">${r.perDay.toFixed(1)}</td><td class="num">${intFmt(r.fulfillable)}</td><td class="num">${intFmt(r.inbound)}</td><td class="num">${fmtPo(r)}</td><td class="num" style="white-space:nowrap;">${fmtOut(r.outD)}</td><td class="num" style="white-space:nowrap;">${fmtOut(r.outAllD)}</td><td class="num">${r.capital!==null ? money(r.capital,{compact:true}) : '—'}</td><td class="num">${r.fee ? money(r.fee) : '—'}</td><td>${flag(r)}</td></tr>`).join('')+'</tbody>';
    document.getElementById('invCaption').textContent = (rows.length>60 ? tv('Showing the 60 best-selling of ','Hiện 60/')+rows.length+tv(' SKUs. ',' SKU bán chạy nhất. ') : '') + tv('"Stock-out" = the day stock reaches 0 at the current sales velocity (no seasonality); the second column adds Amazon inbound and manual POs on their ETA. ','"Hết hàng" = ngày tồn về 0 với tốc độ bán hiện tại (chưa tính mùa vụ); cột thứ hai cộng thêm hàng Amazon đang nhận và PO nhập tay đúng ngày về. ') + (costKnown ? tv('Stock capital = total units at/inbound to Amazon × landed cost in data/cogs_skus.json. ','Vốn tồn = tổng units tại/đang về Amazon × giá vốn landed trong data/cogs_skus.json. ') : tv('No per-SKU cost yet (data/cogs_skus.json), so capital tied up in inventory and profit by product are not computed. ','Chưa có giá vốn theo SKU (data/cogs_skus.json) nên chưa tính vốn nằm trong tồn kho và lãi theo sản phẩm. ')) + tv('Storage = Amazon fee for the latest month with a per-SKU report.','Lưu kho = phí Amazon tháng gần nhất có báo cáo theo SKU.');
  }
  // ---------- V9: order funnel + returns by SKU + product P&L (sync Shopify 2.0 / Amazon 2.8 + data/cogs_skus.json) ----------
  const FUNNEL_CH = ['shopify','amazon'];
  const SKU_CH = ['shopify','amazon','walmart','tiktok'];   // V11.3.1: channels whose syncs carry units per SKU (Walmart / TikTok Shop from 19/10/2026)
  function funnelAggregate(rowsIn){
    const rows = maskPartial() ? rowsIn.map(maskRow) : rowsIn;
    const out = {}; FUNNEL_CH.forEach(k=>{ out[k] = {days:0, placed:0, paid:0, paidKnown:false, fulfilled:0, partial:0, cancelled:0, refunded:0, refundedKnown:false}; });
    rows.forEach(r=>{ if(!r.funnel) return; FUNNEL_CH.forEach(k=>{ if(!CH_MASK[k]) return; const f = r.funnel[k]; if(!f) return; const o = out[k]; o.days++; o.placed += f.placed; o.fulfilled += f.fulfilled; o.partial += f.partial; o.cancelled += f.cancelled; if(f.paid!==null){ o.paid += f.paid; o.paidKnown = true; } if(f.refunded!==null){ o.refunded += f.refunded; o.refundedKnown = true; } }); });
    return out;
  }
  function skuAggregate(rowsIn){
    const rows = maskPartial() ? rowsIn.map(maskRow) : rowsIn;
    const out = {}; SKU_CH.forEach(k=>{ out[k] = {days:0, units:{}, sales:{}, refunds:{}}; });
    const addTo = (o, f, src) => Object.entries(src||{}).forEach(([sku,v])=>{ o[f][sku] = (o[f][sku]||0) + (parseFloat(v)||0); });
    rows.forEach(r=>{ if(!r.sku) return; SKU_CH.forEach(k=>{ if(!CH_MASK[k]) return; const d = r.sku[k]; if(!d) return; const o = out[k]; o.days++; addTo(o,'units',d.units); addTo(o,'sales',d.sales); addTo(o,'refunds',d.refunds); }); });
    return out;
  }
  function skuName(sku){ const snap = AMAZON_STORAGE_LIVE_DATA && AMAZON_STORAGE_LIVE_DATA.inventory && AMAZON_STORAGE_LIVE_DATA.inventory.snapshot; const c = COGS_SKUS[sku]; const sm = SHIPMONK_INVENTORY && SHIPMONK_INVENTORY.skus && SHIPMONK_INVENTORY.skus[sku]; return (c && c.name) || (snap && snap[sku] && snap[sku].name) || (sm && sm.name) || ''; }   // V10.3: ShipMonk names cover the Shopify SKUs
  function sinceText(kind){
    const f = kind==='sku' ? 'sku_units_since' : 'statuses_since';
    const si = d => (d && d.meta && d.meta.schema_info && d.meta.schema_info[f]) || null;
    const parts = [si(SHOPIFY_LIVE_DATA) ? tv('Shopify from ','Shopify từ ')+si(SHOPIFY_LIVE_DATA) : null, si(AMAZON_LIVE_DATA) ? tv('Amazon from ','Amazon từ ')+si(AMAZON_LIVE_DATA) : null].filter(Boolean);
    const masked = SKU_CH.filter(k=>CH_MASK[k]).length===0 ? tv(' (the selected channel has no such data)',' (đang lọc kênh không có dữ liệu này)') : '';
    return parts.length ? tv('No day in the selected period carries this data yet (','Kỳ đang xem chưa có ngày nào mang dữ liệu này (')+parts.join(' · ')+tv(') — pick a later period.',') — chọn kỳ muộn hơn.')+masked : tv('Waiting for the first run of the Shopify 2.0 / Amazon 2.8 sync scripts (≤ 30 minutes after uploading the 2 .py files) — data covers the last 45 days, older needs a backfill.','Chờ script đồng bộ Shopify 2.0 / Amazon 2.8 chạy lần đầu (sau khi up 2 file .py, ≤ 30 phút) — dữ liệu có cho 45 ngày gần nhất, cũ hơn cần backfill.')+masked;
  }
  const pctOf = (x, y) => y>0 ? (x/y*100).toFixed(1)+'%' : '—';
  function renderFunnel(){
    const t = document.getElementById('funnelTable'), kp = document.getElementById('funnelKpis'); if(!t || !kp) return;
    const rows = currentRows(), f = funnelAggregate(rows), pr = prevLikeRows(), fp = pr ? funnelAggregate(pr) : null;
    const keys = FUNNEL_CH.filter(k=> CH_MASK[k] && f[k].days>0);
    if(!keys.length){ kp.innerHTML=''; t.innerHTML=''; setNote('funnelNote',tx('u.waiting')); setNote('funnelCaption', sinceText('statuses')); return; }
    const tot = o => keys.reduce((s,k)=>{ const x = o[k]; s.placed += x.placed; s.fulfilled += x.fulfilled; s.partial += x.partial; s.cancelled += x.cancelled; if(x.paidKnown){ s.paid += x.paid; s.paidBase += x.placed; } if(x.refundedKnown){ s.refunded += x.refunded; s.refBase += x.placed; } return s; }, {placed:0, paid:0, paidBase:0, fulfilled:0, partial:0, cancelled:0, refunded:0, refBase:0});
    const T = tot(f), P = fp ? tot(fp) : null;
    const rate = (x, y) => y>0 ? x/y*100 : null;
    const dpts = (cur, prev, lowerBetter) => (cur===null || prev===null) ? '' : ` · <span class="${(cur-prev)*(lowerBetter?-1:1)>=0 ? 'd-up' : 'd-down'}">${cur-prev>=0?'+':''}${(cur-prev).toFixed(1)} ${tx('u.pts')}</span> ${tx('u.vs')} ${likeLabel()}`;
    const tiles = [
      {l:tv('Placed','Đặt hàng'), v: intFmt(T.placed), s: keys.map(k=>CH_LABEL[k]+' '+intFmt(f[k].placed)).join(' · '), pct: 100},
      {l:tv('Paid','Đã thanh toán'), v: T.paidBase>0 ? pctOf(T.paid, T.paidBase) : '—', s: T.paidBase>0 ? intFmt(T.paid)+' '+tx('u.orders')+(T.paidBase<T.placed ? tv(' (Shopify only)',' (chỉ Shopify)') : '')+dpts(rate(T.paid,T.paidBase), P ? rate(P.paid,P.paidBase) : null, false) : tv('Amazon has no payment status','Amazon không có trạng thái thanh toán'), pct: rate(T.paid,T.paidBase)},
      {l:tv('Fully fulfilled','Đã giao đủ'), v: pctOf(T.fulfilled, T.placed), s: intFmt(T.fulfilled)+' '+tx('u.orders')+' · '+intFmt(T.partial)+tv(' partially fulfilled',' giao một phần')+dpts(rate(T.fulfilled,T.placed), P ? rate(P.fulfilled,P.placed) : null, false), pct: rate(T.fulfilled,T.placed)},
      {l:tv('Cancelled','Huỷ'), v: pctOf(T.cancelled, T.placed), s: intFmt(T.cancelled)+' '+tx('u.orders')+dpts(rate(T.cancelled,T.placed), P ? rate(P.cancelled,P.placed) : null, true), pct: rate(T.cancelled,T.placed), bad: rate(T.cancelled,T.placed)>5},
      {l:tv('With a refund','Có hoàn tiền'), v: T.refBase>0 ? pctOf(T.refunded, T.refBase) : '—', s: T.refBase>0 ? intFmt(T.refunded)+' '+tx('u.orders')+(T.refBase<T.placed ? tv(' (Shopify only)',' (chỉ Shopify)') : '')+dpts(rate(T.refunded,T.refBase), P ? rate(P.refunded,P.refBase) : null, true) : tv('Amazon: see refund amounts in the P&L','Amazon: xem tiền hoàn ở P&L'), pct: rate(T.refunded,T.refBase), bad: rate(T.refunded,T.refBase)>8},
    ];
    kp.innerHTML = tiles.map(x=>`<div class="fstage${x.bad?' bad':''}"><div class="l">${x.l}</div><div class="v">${x.v}</div><div class="s">${x.s}</div><div class="bar"><i style="width:${Math.max(0, Math.min(100, x.pct||0)).toFixed(1)}%"></i></div></div>`).join('');
    const n = rows.length;
    t.innerHTML = '<thead><tr><th>'+tx('f.channel')+'</th><th class="num">'+tv('Placed','Đặt')+'</th><th class="num">'+tv('Paid','Thanh toán')+'</th><th class="num">'+tv('Fulfilled','Giao đủ')+'</th><th class="num">'+tv('Partial','Giao một phần')+'</th><th class="num">'+tv('Unfulfilled','Chưa giao')+'</th><th class="num">'+tv('Cancelled','Huỷ')+'</th><th class="num">'+tv('Refunded','Có hoàn')+'</th><th class="num">'+tv('Cancel rate','Tỷ lệ huỷ')+'</th><th class="num">'+tv('Refund rate','Tỷ lệ hoàn')+'</th><th class="num">'+tv('Days with data','Ngày có số')+'</th></tr></thead><tbody>' +
      keys.map(k=>{ const o = f[k]; const open = Math.max(0, o.placed - o.fulfilled - o.partial - o.cancelled); return `<tr><td class="name">${CH_LABEL[k]}</td><td class="num">${intFmt(o.placed)}</td><td class="num">${o.paidKnown ? intFmt(o.paid) : '—'}</td><td class="num">${intFmt(o.fulfilled)}</td><td class="num">${intFmt(o.partial)}</td><td class="num">${intFmt(open)}</td><td class="num">${intFmt(o.cancelled)}</td><td class="num">${o.refundedKnown ? intFmt(o.refunded) : '—'}</td><td class="num ${rate(o.cancelled,o.placed)>5?'d-down':''}">${pctOf(o.cancelled,o.placed)}</td><td class="num ${o.refundedKnown && rate(o.refunded,o.placed)>8?'d-down':''}">${o.refundedKnown ? pctOf(o.refunded,o.placed) : '—'}</td><td class="num">${o.days}/${n}</td></tr>`; }).join('') +
      (keys.length>1 ? `<tr style="font-weight:700;"><td class="name">${tx('u.total')}</td><td class="num">${intFmt(T.placed)}</td><td class="num">${T.paidBase>0 ? intFmt(T.paid) : '—'}</td><td class="num">${intFmt(T.fulfilled)}</td><td class="num">${intFmt(T.partial)}</td><td class="num">${intFmt(Math.max(0, T.placed-T.fulfilled-T.partial-T.cancelled))}</td><td class="num">${intFmt(T.cancelled)}</td><td class="num">${T.refBase>0 ? intFmt(T.refunded) : '—'}</td><td class="num">${pctOf(T.cancelled,T.placed)}</td><td class="num">${T.refBase>0 ? pctOf(T.refunded,T.refBase) : '—'}</td><td class="num"></td></tr>` : '') + '</tbody>';
    const cov = keys.map(k=>f[k].days).reduce((x,y)=>Math.min(x,y), 1e9);
    setNote('funnelNote', intFmt(T.placed)+tv(' orders placed · cancelled ',' đơn đặt · huỷ ')+pctOf(T.cancelled,T.placed)+(T.refBase>0 ? tv(' · refunded ',' · có hoàn ')+pctOf(T.refunded,T.refBase) : '')+(cov<n ? ' · '+cov+'/'+n+tv(' days with data',' ngày có số') : ''));
    setNote('funnelCaption', tv('Counted by order date, status as of the latest sync (only the last 45 days are refreshed — older orders keep the status they had). "Placed" includes orders cancelled before payment (not in revenue). Shopify: paid = PAID / partially or fully refunded; Amazon: from the All Orders report, no payment status. Alert thresholds: cancelled > 5%, refunded > 8%.','Đếm theo ngày đặt hàng, trạng thái tại lần đồng bộ gần nhất (chỉ làm mới cho 45 ngày gần nhất — đơn cũ hơn giữ trạng thái lúc đó). "Đặt" gồm cả đơn huỷ trước khi thanh toán (không nằm trong doanh thu). Shopify: thanh toán = PAID / đã hoàn một phần hoặc toàn bộ; Amazon: từ All Orders report, không có trạng thái thanh toán. Ngưỡng cảnh báo: huỷ > 5%, hoàn > 8%.'));
  }
  function renderReturnsBySku(){
    const t = document.getElementById('returnsTable'); if(!t) return;
    const rows = currentRows(), sa = skuAggregate(rows), pr = prevLikeRows(), sp = pr ? skuAggregate(pr) : null;
    const keys = SKU_CH.filter(k=> CH_MASK[k] && sa[k].days>0);
    if(!keys.length){ t.innerHTML=''; setNote('returnsNote',tx('u.waiting')); setNote('returnsCaption', sinceText('sku')); return; }
    const m = {};
    keys.forEach(k=>{ const o = sa[k]; const add = (sku, fld, v)=>{ const x = m[sku] = m[sku]||{sku, units:0, refunds:0, sales:0, ch:{}}; x[fld] += v; x.ch[k] = true; }; Object.entries(o.units).forEach(([sku,v])=>add(sku,'units',v)); Object.entries(o.refunds).forEach(([sku,v])=>add(sku,'refunds',v)); Object.entries(o.sales).forEach(([sku,v])=>add(sku,'sales',v)); });
    const list = Object.values(m);
    const totU = sum(list.map(x=>x.units)), totR = sum(list.map(x=>x.refunds));
    const prevRate = sku => { if(!sp) return null; let u=0, r=0; keys.forEach(k=>{ u += sp[k].units[sku]||0; r += sp[k].refunds[sku]||0; }); return u>0 ? r/u*100 : null; };
    const withR = list.filter(x=>x.refunds>0).sort((a,b)=> b.refunds - a.refunds || b.units - a.units).slice(0,15);
    const dcell = (cur, prev) => prev===null ? '<td class="num d-flat">—</td>' : `<td class="num ${cur-prev<=0?'d-up':'d-down'}">${prev.toFixed(1)}% → ${cur.toFixed(1)}%</td>`;
    t.innerHTML = '<thead><tr><th>SKU</th><th>'+tx('u.product')+'</th><th>'+tx('f.channel')+'</th><th class="num">'+tv('Sold (units)','Bán (units)')+'</th><th class="num">'+tv('Returned (units)','Trả (units)')+'</th><th class="num">'+tv('Return rate','Tỷ lệ trả')+'</th><th class="num">'+tv('Vs ','So ')+likeLabel()+'</th><th class="num">'+tx('u.grossRev')+'</th></tr></thead><tbody>' +
      (withR.length ? withR.map(x=>{ const r = x.units>0 ? x.refunds/x.units*100 : null; return `<tr><td style="font-family:var(--font-mono);font-size:11.5px;">${x.sku}</td><td title="${skuName(x.sku).replace(/"/g,'&quot;')}">${skuName(x.sku).slice(0,40)}</td><td>${Object.keys(x.ch).map(k=>CH_LABEL[k]).join(', ')}</td><td class="num">${intFmt(x.units)}</td><td class="num">${intFmt(x.refunds)}</td><td class="num ${r!==null && r>8 ? 'd-down' : ''}">${r===null ? '—' : r.toFixed(1)+'%'}</td>${dcell(r===null?0:r, prevRate(x.sku))}<td class="num">${money(x.sales,{compact:true})}</td></tr>`; }).join('') : '<tr><td colspan="8" style="color:var(--ink-muted)">'+tv('No units returned in this period','Không có đơn vị nào bị trả trong kỳ')+'</td></tr>') +
      `<tr style="font-weight:700;"><td class="name" colspan="3">${tx('u.total')} ${list.length} SKU</td><td class="num">${intFmt(totU)}</td><td class="num">${intFmt(totR)}</td><td class="num">${pctOf(totR,totU)}</td><td class="num"></td><td class="num">${money(sum(list.map(x=>x.sales)),{compact:true})}</td></tr></tbody>`;
    setNote('returnsNote', intFmt(totR)+tv(' units returned / ',' units trả / ')+intFmt(totU)+' '+tx('u.unitsSold')+' = '+pctOf(totR,totU)+' · '+list.filter(x=>x.refunds>0).length+tv(' SKUs with returns',' SKU có trả'));
    setNote('returnsCaption', tv('Returned units are booked on the refund processing date (they may belong to orders placed before the period), units sold by order date — the rate is an approximation per period. Showing the 15 most-returned SKUs; product names come from the FBA snapshot or the "name" field in data/cogs_skus.json. Shopify: refundLineItems; Amazon: quantity in RefundEvent.','Units trả ghi theo ngày xử lý hoàn tiền (có thể thuộc đơn đặt trước kỳ), units bán theo ngày đặt — tỷ lệ là xấp xỉ theo kỳ. Hiện 15 SKU trả nhiều nhất; tên sản phẩm lấy từ snapshot FBA hoặc trường "name" trong data/cogs_skus.json. Shopify: refundLineItems; Amazon: số lượng trong RefundEvent.'));
  }
  const PROD_STATE = {group:'sku', q:''};
  function renderProductPnl(){
    const t = document.getElementById('prodTable'), ctl = document.getElementById('prodCtl'); if(!t || !ctl) return;
    const rows = currentRows(), sa = skuAggregate(rows);
    const keys = SKU_CH.filter(k=> CH_MASK[k] && sa[k].days>0);
    if(!keys.length){ ctl.innerHTML=''; t.innerHTML=''; setNote('prodNote',tx('u.waiting')); setNote('prodCaption', sinceText('sku')); return; }
    const anyCode = Object.values(COGS_SKUS).some(v=>v.code);
    // allocation per channel over the days that carry SKU data for that channel (so partial coverage does not inflate costs)
    const items = {}; let realCost = 0, allSkus = 0, covMin = 1e9, chCm = 0;
    keys.forEach(k=>{
      const o = sa[k]; covMin = Math.min(covMin, o.days);
      const rk = rows.filter(r=> r.sku && r.sku[k]);
      const ak = aggregate(rk), ck = channelEcon(ak)[k]; chCm += ck.cm;
      const skus = [...new Set(Object.keys(o.units).concat(Object.keys(o.sales)))];
      const fc = fifoSkuCosts(rows, k);   // V11: FIFO cost per SKU over the same (masked) days
      const G = sum(skus.map(x=>o.sales[x]||0)), U = sum(skus.map(x=>o.units[x]||0));
      const rw = {}; let RW = 0; skus.forEach(x=>{ const u = o.units[x]||0, g = o.sales[x]||0; rw[x] = u>0 ? (o.refunds[x]||0)*(g/u) : 0; RW += rw[x]; });
      skus.forEach(x=>{
        const g = G>0 ? (o.sales[x]||0)/G : 0, us = U>0 ? (o.units[x]||0)/U : 0, rs = RW>0 ? rw[x]/RW : g;
        const units = o.units[x]||0, cost = skuCost(x);
        const gross = ak.gross[k]*g, disc = ak.discountBy[k]*g, ref = ak.refund[k]*rs, net = gross - disc - ref;
        const sc = skuCogsOf(fc, x, units, net, ck, g), cogs = sc.cogs;
        const fulfil = ck.fulfil*us, fees = ck.fees*g, ads = ck.adsAll*g;
        const key = PROD_STATE.group==='code' ? ((COGS_SKUS[x] && COGS_SKUS[x].code) || x) : x;
        const it = items[key] = items[key] || {key, skus:[], ch:{}, chNet:{}, chUnits:{}, units:0, refunds:0, gross:0, disc:0, ref:0, net:0, cogs:0, cogsReal:0, fulfil:0, fees:0, ads:0, cm:0};
        if(!it.skus.includes(x)) it.skus.push(x); it.ch[k] = true; it.chNet[k] = (it.chNet[k]||0) + net; it.chUnits[k] = (it.chUnits[k]||0) + units;   // V11.3: split per channel
        it.units += units; it.refunds += o.refunds[x]||0; it.gross += gross; it.disc += disc; it.ref += ref; it.net += net; it.cogs += cogs; it.cogsReal += sc.real; it.fulfil += fulfil; it.fees += fees; it.ads += ads; it.cm += net - cogs - fulfil - fees - ads;
        allSkus++; if(sc.real>0) realCost++;
      });
    });
    const q = PROD_STATE.q.trim().toLowerCase();
    let list = Object.values(items);
    if(q) list = list.filter(it=> it.key.toLowerCase().includes(q) || it.skus.some(x=>x.toLowerCase().includes(q) || skuName(x).toLowerCase().includes(q)));
    list.sort((a,b)=> b.cm - a.cm);
    const n = rows.length;
    ctl.innerHTML = `<input type="search" id="prodQ" placeholder="${tv('Search SKU / name…','Tìm SKU / tên…')}" value="${PROD_STATE.q.replace(/"/g,'&quot;')}">` + (anyCode ? `<div class="seg" id="prodGroup"><button type="button" data-g="sku" class="${PROD_STATE.group==='sku'?'active':''}">${tv('Platform SKU','SKU sàn')}</button><button type="button" data-g="code" class="${PROD_STATE.group==='code'?'active':''}">${tv('Internal code','Mã nội bộ')}</button></div>` : '<span>'+tv('Group by internal code: add "code" to data/cogs_skus.json','Gộp theo mã nội bộ: thêm "code" vào data/cogs_skus.json')+'</span>') + `<span>${list.length} ${tv('rows · sorted by CM3','dòng · sắp theo CM3')}</span>`;
    const qi = document.getElementById('prodQ'); qi.addEventListener('input', ()=>{ PROD_STATE.q = qi.value; const pos = qi.selectionStart; renderProductPnl(); const q2 = document.getElementById('prodQ'); if(q2){ q2.focus(); try{ q2.setSelectionRange(pos,pos); }catch(e){} } });
    const pg = document.getElementById('prodGroup'); if(pg) pg.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{ PROD_STATE.group = b.dataset.g; renderProductPnl(); }));
    const show = list.slice(0,40);
    const tot = list.reduce((s,it)=>{ ['units','refunds','gross','net','cogs','fulfil','fees','ads','cm'].forEach(f=>{ s[f] += it[f]; }); return s; }, {units:0, refunds:0, gross:0, net:0, cogs:0, fulfil:0, fees:0, ads:0, cm:0});
    const nameOf = it => PROD_STATE.group==='code' ? (it.skus.map(skuName).find(Boolean)||'') : skuName(it.key);
    t.innerHTML = '<thead><tr><th>'+(PROD_STATE.group==='code' ? tv('Internal code','Mã nội bộ') : 'SKU')+'</th><th>'+tx('u.product')+'</th><th>'+tx('f.channel')+'</th><th class="num">Units</th><th class="num">'+tv('Returned','Trả')+'</th><th class="num">'+tx('u.grossRev')+' (pb)</th><th class="num">'+tx('u.netRev')+' (pb)</th><th class="num">'+tv('Product cost','Giá vốn')+'</th><th class="num">Fulfillment (pb)</th><th class="num">'+tv('Fees','Phí')+' (pb)</th><th class="num">Ads + aff (pb)</th><th class="num">CM3</th><th class="num">CM3 / unit</th><th class="num">'+tv('% of net revenue','% DT thuần')+'</th></tr></thead><tbody>' +
      show.map(it=>`<tr><td style="font-family:var(--font-mono);font-size:11.5px;" title="${it.skus.join(', ')}">${it.key}${PROD_STATE.group==='code' && it.skus.length>1 ? ' <small style="color:var(--ink-muted)">'+it.skus.length+' SKU</small>' : ''}</td><td title="${nameOf(it).replace(/"/g,'&quot;')}">${nameOf(it).slice(0,36)}</td><td style="white-space:nowrap;">${Object.keys(it.ch).sort((x,y)=>(it.chNet[y]||0)-(it.chNet[x]||0)).map(k=>`<div>${CH_LABEL[k]} <span style="color:var(--ink-muted)">${intFmt(it.chUnits[k]||0)} · ${money(it.chNet[k]||0,{compact:true})}${it.net>0 && Object.keys(it.ch).length>1 ? ' · '+Math.round((it.chNet[k]||0)/it.net*100)+'%' : ''}</span></div>`).join('')}</td><td class="num">${intFmt(it.units)}</td><td class="num">${intFmt(it.refunds)}</td><td class="num">${money(it.gross,{compact:true})}</td><td class="num">${money(it.net,{compact:true})}</td><td class="num" title="${it.cogsReal>0 ? (Math.abs(it.cogsReal-it.cogs)<0.5 ? tv('actual cost (FIFO lots / cogs_skus.json)','giá vốn thật (lô FIFO / cogs_skus.json)') : tv('partly actual cost','một phần giá vốn thật')) : tv('allocated from the channel\'s estimated product cost','phân bổ từ giá vốn ước tính của kênh')}">${money(it.cogs,{compact:true})}${it.cogsReal>0 ? '' : ' <small style="color:var(--ink-muted)">'+tv('est.','ước')+'</small>'}</td><td class="num">${money(it.fulfil,{compact:true})}</td><td class="num">${money(it.fees,{compact:true})}</td><td class="num">${money(it.ads,{compact:true})}</td><td class="num ${it.cm<0?'d-down':''}">${money(it.cm,{compact:true})}</td><td class="num ${it.cm<0?'d-down':''}">${it.units>0 ? money(it.cm/it.units) : '—'}</td><td class="num">${it.net>0 ? (it.cm/it.net*100).toFixed(0)+'%' : '—'}</td></tr>`).join('') +
      `<tr style="font-weight:700;"><td class="name" colspan="3">${tx('u.total')} ${list.length} ${tv('rows','dòng')}${list.length>40 ? tv(' (showing 40)',' (hiện 40)') : ''}</td><td class="num">${intFmt(tot.units)}</td><td class="num">${intFmt(tot.refunds)}</td><td class="num">${money(tot.gross,{compact:true})}</td><td class="num">${money(tot.net,{compact:true})}</td><td class="num">${money(tot.cogs,{compact:true})}</td><td class="num">${money(tot.fulfil,{compact:true})}</td><td class="num">${money(tot.fees,{compact:true})}</td><td class="num">${money(tot.ads,{compact:true})}</td><td class="num ${tot.cm<0?'d-down':''}">${money(tot.cm,{compact:true})}</td><td class="num">${tot.units>0 ? money(tot.cm/tot.units) : '—'}</td><td class="num">${tot.net>0 ? (tot.cm/tot.net*100).toFixed(0)+'%' : '—'}</td></tr></tbody>`;
    const best = list[0], worst = list.length>1 ? list[list.length-1] : null;
    setNote('prodNote', allSkus+tv(' SKUs on ',' SKU trên ')+keys.map(k=>CH_LABEL[k]).join(' + ')+tv(' · actual cost for ',' · giá vốn thật cho ')+realCost+'/'+allSkus+(covMin<n ? ' · '+covMin+'/'+n+' '+tx('u.daysWithSku') : '')+(best ? tv(' · best ',' · tốt nhất ')+best.key+' '+money(best.cm,{compact:true}) : '')+(worst && worst.cm<0 ? tv(' · worst ',' · kém nhất ')+worst.key+' '+money(worst.cm,{compact:true}) : ''));
    setNote('prodCaption', tv('(pb) = allocated from the channel total over the days with SKU data: gross sales, discounts, fees and ads by the SKU\'s share of gross sales; refunds by units returned × average price; fulfillment by units. Product cost = FIFO by receipt lot (data/cogs_lots.json) for each day\'s units, else units × landed cost in data/cogs_skus.json, otherwise allocated from the channel\'s ','(pb) = phân bổ từ tổng của kênh trong những ngày có dữ liệu SKU: doanh thu gộp, giảm giá, phí và ads theo tỷ trọng doanh thu gộp của SKU; hoàn tiền theo units trả × giá bình quân; fulfillment theo units. Giá vốn = FIFO theo lô nhập (data/cogs_lots.json) cho units từng ngày, không có thì units × giá landed trong data/cogs_skus.json, nếu không phân bổ từ giá vốn ')+(COGS_EST ? tv('estimated cost of ','ước ')+(COGS_EST.rate*100).toFixed(0)+'%' : tv('product cost','của kênh'))+tv(' ("est."). Total CM3 of the SKUs',' ("ước"). Tổng CM3 các SKU')+(Math.abs(tot.cm - chCm) > Math.max(50, Math.abs(chCm)*0.01) && !q ? tv(' differs by ',' lệch ')+money(tot.cm - chCm,{compact:true})+tv(' from the channel CM3 because actual costs replace the estimate',' so CM3 kênh vì giá vốn thật thay cho ước tính') : tv(' = the channel CM3 over the same days',' = CM3 của kênh trên cùng số ngày'))+'.');
  }
  // ---------- V10: ShipMonk warehouse stock (sync v1.4+ `inventory` block) ----------
  function runOutDays(stock0, perDay, arrivals){
    if(perDay<=0) return null;
    let stock = stock0; const arr = (arrivals||[]).map(a=>({d: a.eta ? Math.max(0, dayDiff(TODAY_ISO, a.eta)) : 0, q: a.qty}));
    for(let d=0; d<=730; d++){ arr.forEach(a=>{ if(a.d===d) stock += a.q; }); stock -= perDay; if(stock<0) return d; }
    return 730;
  }
  function renderShipmonkInventory(){
    const card = document.getElementById('smkInvCard'), t = document.getElementById('smkInvTable'); if(!card || !t) return;
    const inv = SHIPMONK_INVENTORY;
    if(!inv || !inv.skus || !Object.keys(inv.skus).length){ card.hidden = false; t.innerHTML = ''; document.getElementById('smkInvKpis').innerHTML = ''; setNote('smkInvNote', tx('u.waiting')); setNote('smkInvCaption', tx('smk.waiting')); return; }
    card.hidden = false;
    const stock = stockRows(); const byStock = {}; stock.forEach(r=>{ byStock[r.sku] = r; });
    const todayD = days[TOTAL_DAYS-1].date, addDays = k => { const d = new Date(todayD); d.setDate(d.getDate()+k); return d; };
    const poBySku = {}; PURCHASE_ORDERS.forEach(po=>{ if(po.dest!=='shipmonk' || po.received) return; (poBySku[po.sku] = poBySku[po.sku]||[]).push(po); });
    const whAll = (inv.warehouses||[]).map(w=>w.identifier||w.name||String(w.id));
    const whTot = (inv.totals && inv.totals.by_warehouse) || {};
    const whs = whAll.filter(w=> !whTot[w] || (whTot[w].available||0)>0 || (whTot[w].on_hand||0)>0);
    const rows = Object.keys(inv.skus).map(sku=>{
      const s = inv.skus[sku], st = byStock[sku];
      const available = Math.max(0, Math.min(+s.available||0, (+s.on_hand||0) - (+s.quarantined||0) - (+s.unavailable||0)));
      const perDay = st ? (st.unitsSh>0 || st.unitsAz>0 ? (st.perDay * (st.unitsSh/((st.unitsSh+st.unitsAz)||1))) : 0) : 0;   // ShipMonk serves the Shopify (D2C) orders
      const pos = poBySku[sku]||[], poQty = sum(pos.map(p=>p.qty));
      const incoming = +s.incoming||0;
      const outD = runOutDays(available, perDay, []), outAllD = runOutDays(available + incoming, perDay, pos);
      const bw = s.by_warehouse||{};
      return {sku, name: s.name||skuName(sku), line: productLineOf(sku), available, onHand: +s.on_hand||0, allocated: +s.allocated||0, incoming, backordered: +s.backordered||0, perDay, outD, outAllD, pos, poQty, bw, active: s.active!==false};
    }).filter(r=> r.onHand>0 || r.available>0 || r.perDay>0 || r.incoming>0);
    rows.sort((x,y)=> (y.perDay - x.perDay) || (y.available - x.available));
    const soon = rows.filter(r=> r.perDay>=0.2 && r.outAllD!==null && r.outAllD<30).sort((x,y)=>x.outAllD-y.outAllD);
    const back = rows.filter(r=>r.backordered>0);
    const tot = inv.totals||{};
    document.getElementById('smkInvKpis').innerHTML = `
      <div class="kpi"><div class="label">${tx('smk.available')}</div><div class="value">${intFmt(tot.available!==undefined ? tot.available : sum(rows.map(r=>r.available)))}</div><div class="foot">${intFmt(tot.on_hand||0)} ${tx('smk.onHand')} · ${intFmt(tot.allocated||0)} ${tx('smk.allocated')}</div></div>
      <div class="kpi"><div class="label">${tx('smk.incoming')}</div><div class="value">${intFmt((tot.incoming||0) + sum(Object.values(poBySku).flat().map(p=>p.qty)))}</div><div class="foot">${intFmt(tot.incoming||0)} ${tx('smk.receivings')} · ${intFmt(sum(Object.values(poBySku).flat().map(p=>p.qty)))} PO</div></div>
      <div class="kpi${soon.length?' alert':''}"><div class="label">${tx('inv.soon')}</div><div class="value">${soon.length}</div><div class="foot">${soon.length ? tx('inv.earliest')+' '+fmtDmy(addDays(soon[0].outAllD))+' · '+soon.slice(0,3).map(r=>r.sku).join(', ') : '—'}</div></div>
      <div class="kpi${back.length?' alert':''}"><div class="label">${tx('smk.backordered')}</div><div class="value">${back.length}</div><div class="foot">${back.length ? intFmt(sum(back.map(r=>r.backordered)))+' '+tx('smk.unitsShort')+' · '+back.slice(0,3).map(r=>r.sku).join(', ') : tx('smk.noBackorder')}</div></div>`;
    setNote('smkInvNote', tx('smk.note', {as_of: (inv.as_of||'').slice(0,10), wh: whs.join(' · '), n: rows.length}));
    const fmtOut = d => d===null ? '—' : d>=365 ? '>1y' : fmtDmy(addDays(d))+' <small style="color:var(--ink-muted)">'+d+' '+tx('u.d')+'</small>';
    const flag = r => r.backordered>0 ? `<span class="tag gap"><span class="d"></span>${tx('smk.tagBack')}</span>` : r.perDay===0 ? `<span class="tag info"><span class="d"></span>${tx('inv.tagNoSales')}</span>` : r.available<=0 ? `<span class="tag gap"><span class="d"></span>${tx('inv.tagOut')}</span>` : (r.outAllD!==null && r.outAllD<30) ? `<span class="tag gap"><span class="d"></span>${tx('inv.tagSoon')}</span>` : (r.outD!==null && r.outD<30) ? `<span class="tag info"><span class="d"></span>${tx('inv.tagWaiting')}</span>` : `<span class="tag live"><span class="d"></span>${tx('inv.tagOk')}</span>`;
    t.innerHTML = `<thead><tr><th>SKU</th><th>${tx('u.product')}</th><th class="num">/${tx('u.day')}</th><th class="num">${tx('smk.available')}</th><th class="num">${tx('smk.onHand')}</th><th class="num">${tx('smk.allocated')}</th><th class="num">${tx('smk.incoming')}</th><th class="num">PO</th><th class="num">${tx('inv.outStock')}</th><th class="num">${tx('inv.outAll')}</th><th>${tx('smk.byWarehouse')}</th><th>${tx('u.status')}</th></tr></thead><tbody>` +
      rows.slice(0,60).map(r=>`<tr><td style="font-family:var(--font-mono);font-size:11.5px;">${r.sku}</td><td title="${(r.name||'').replace(/"/g,'&quot;')}">${(r.name||'').slice(0,34)}${r.name && r.name.length>34?'…':''}<small style="display:block;color:var(--ink-muted)">${productLineName(r.line)}</small></td><td class="num">${r.perDay.toFixed(1)}</td><td class="num">${intFmt(r.available)}</td><td class="num">${intFmt(r.onHand)}</td><td class="num">${intFmt(r.allocated)}</td><td class="num">${intFmt(r.incoming)}</td><td class="num">${r.poQty ? intFmt(r.poQty) : '—'}</td><td class="num" style="white-space:nowrap;">${fmtOut(r.outD)}</td><td class="num" style="white-space:nowrap;">${fmtOut(r.outAllD)}</td><td style="font-size:11.5px;color:var(--ink-muted);white-space:nowrap;">${whs.map(w=> (r.bw[w] && (r.bw[w].available||0)>0) ? w+' '+intFmt(r.bw[w].available) : '').filter(Boolean).join(' · ')||'—'}</td><td>${flag(r)}</td></tr>`).join('') + '</tbody>';
    setNote('smkInvCaption', (rows.length>60 ? tx('inv.showing', {n: rows.length})+' ' : '') + tx('smk.caption'));
  }
  function renderPurchaseOrders(snap){
    const t = document.getElementById('poTable'); if(!t) return;
    const n = PURCHASE_ORDERS.length;
    if(!n){
      setNote('poNote', tv('No POs — data/purchase_orders.json is empty','Chưa có PO — file data/purchase_orders.json trống'));
      t.innerHTML = '';
      document.getElementById('poCaption').innerHTML = tv('Enter each ordered batch in <code>data/purchase_orders.json</code>: <code>{"sku":"SKU on Amazon/Shopify","qty":500,"eta":"2026-11-20","destination":"fba","supplier":"…","note":"…"}</code>. POs bound for FBA are added to the stock-out date in the table above; ShipMonk-bound ones are only listed (no ShipMonk stock yet). Set <code>"received": true</code> once the goods are in the warehouse to skip it.','Nhập mỗi lô hàng đã đặt vào <code>data/purchase_orders.json</code>: <code>{"sku":"SKU trên Amazon/Shopify","qty":500,"eta":"2026-11-20","destination":"fba","supplier":"…","note":"…"}</code>. PO đích FBA được cộng vào ngày hết hàng của bảng trên; đích ShipMonk chỉ liệt kê (chưa có tồn kho ShipMonk). Đặt <code>"received": true</code> khi hàng đã nhập kho để bỏ qua.');
      return;
    }
    const late = PURCHASE_ORDERS.filter(p=> !p.received && p.eta && p.eta<TODAY_ISO).length, open = PURCHASE_ORDERS.filter(p=>!p.received).length;
    setNote('poNote', open+tv(open===1 ? ' open PO · ' : ' open POs · ',' PO đang mở · ')+intFmt(sum(PURCHASE_ORDERS.filter(p=>!p.received).map(p=>p.qty)))+' units'+(late ? ' · '+late+tv(late===1 ? ' PO past its ETA' : ' POs past their ETA',' PO quá ngày về') : '')+(PO_LIVE_DATA && PO_LIVE_DATA.updated_at ? tv(' · updated ',' · cập nhật ')+PO_LIVE_DATA.updated_at : ''));
    const st = p => p.received ? '<span class="tag live"><span class="d"></span>'+tv('received','đã nhận')+'</span>' : !p.eta ? '<span class="tag info"><span class="d"></span>'+tv('no ETA','chưa có ngày về')+'</span>' : p.eta<TODAY_ISO ? '<span class="tag gap"><span class="d"></span>'+tv('late by ','trễ ')+nDays(dayDiff(p.eta, TODAY_ISO))+'</span>' : '<span class="tag info"><span class="d"></span>'+tv('due in ','còn ')+nDays(dayDiff(TODAY_ISO, p.eta))+'</span>';
    t.innerHTML = '<thead><tr><th>SKU</th><th>'+tx('u.product')+'</th><th class="num">'+tv('Quantity','Số lượng')+'</th><th>'+tv('ETA','Ngày về')+'</th><th>'+tv('Destination','Đích')+'</th><th>'+tv('Supplier / PO','Nhà cung cấp / PO')+'</th><th>'+tv('Note','Ghi chú')+'</th><th>'+tx('u.status')+'</th></tr></thead><tbody>' +
      PURCHASE_ORDERS.map(p=>`<tr><td style="font-family:var(--font-mono);font-size:11.5px;">${p.sku}</td><td>${((snap[p.sku]||{}).name||'').slice(0,40)}</td><td class="num">${intFmt(p.qty)}</td><td>${p.eta ? p.eta.slice(8,10)+'/'+p.eta.slice(5,7)+'/'+p.eta.slice(0,4) : '—'}</td><td>${p.dest==='fba' ? 'Amazon FBA' : 'ShipMonk'}</td><td>${[p.supplier, p.po].filter(Boolean).join(' · ')||'—'}</td><td style="color:var(--ink-muted)">${p.note||''}</td><td>${st(p)}</td></tr>`).join('') + '</tbody>';
    document.getElementById('poCaption').textContent = tv('Entered by hand in data/purchase_orders.json. POs bound for FBA are added to "Stock-out (stock + incoming + PO)" on their ETA; a late PO counts as arriving today.','Nhập tay trong data/purchase_orders.json. PO đích FBA được cộng vào "Hết hàng (tồn + về + PO)" đúng ngày về; PO quá ngày coi như về hôm nay.');
  }

  // ---------- page 6: OpEx by month + cash gaps ----------
  function renderOpexPage(){
    const kp = document.getElementById('opexKpis'); if(!kp) return;
    const a = aggregate(currentRows());
    const ga = a.gaTotal, logi = a.logisticsTotal, opex = a.fixedTotal;
    kp.innerHTML = `
      <div class="kpi"><div class="label">${tv('OpEx this period','OpEx kỳ này')}</div><div class="value">${money(opex,{compact:true})}</div><div class="foot">${a.netRevenue>0 ? (opex/a.netRevenue*100).toFixed(1)+tv('% of net revenue','% doanh thu thuần') : ''}</div></div>
      <div class="kpi"><div class="label">${tv('Warehousing & services','Kho bãi & dịch vụ')}</div><div class="value">${money(logi,{compact:true})}</div><div class="foot">${tv('ShipMonk storage/receiving/returns','ShipMonk lưu kho/receiving/hàng trả')} ${money(a.shipmonkLogistics,{compact:true})} · ${tv('Amazon storage & services','Amazon lưu kho & dịch vụ')} ${money(a.amazonLogistics,{compact:true})}</div></div>
      <div class="kpi"><div class="label">G&A</div><div class="value">${money(ga,{compact:true})}</div><div class="foot">${a.opexDays>0 ? (a.opexEstDays>=a.opexDays ? tv('Estimated (month not closed)','Tạm tính (tháng chưa chốt)') : tx('u.manual')+(a.opexEstDays>0 ? ' ('+a.opexEstDays+tv(' days estimated)',' ngày tạm tính)') : '')) : tv('No G&A entered for this period','Chưa nhập G&A cho kỳ này')} · Klaviyo ${money(a.klaviyoCost,{compact:true})}</div></div>
      <div class="kpi"><div class="label">EBITDA</div><div class="value">${money(a.netProfit,{compact:true})}</div><div class="foot">${a.netRevenue>0 ? tv('Margin ','Biên ')+(a.netProfit/a.netRevenue*100).toFixed(1)+'%' : ''} · = CM3 ${money(a.contributionProfit,{compact:true})} − OpEx</div></div>`;
    const t = document.getElementById('opexMonthsTable');
    const ms = MONTHS.slice(-13);
    t.innerHTML = `<thead><tr><th>${tv('Month','Tháng')}</th><th class="num">${tx('u.netRev')}</th><th class="num">CM3</th><th class="num">${tv('Warehousing','Kho bãi')}</th><th class="num">G&A</th><th class="num">OpEx</th><th class="num">${tv('OpEx/revenue','OpEx/DT')}</th><th class="num">EBITDA</th><th class="num">${tv('Margin','Biên')}</th><th>G&A</th></tr></thead><tbody>`+
      ms.slice().reverse().map(m=>{
        const x = aggregate(monthMap[m]);
        if(x.netRevenue<=0) return '';
        const entered = x.opexDays>0 && x.opexEstDays<x.opexDays, carried = x.opexDays>0 && x.opexEstDays>0;
        return `<tr><td>${MONTH_LABEL(m)}</td><td class="num">${money(x.netRevenue,{compact:true})}</td><td class="num">${money(x.contributionProfit,{compact:true})}</td><td class="num">${money(x.logisticsTotal,{compact:true})}</td><td class="num">${money(x.gaTotal,{compact:true})}</td><td class="num">${money(x.fixedTotal,{compact:true})}</td><td class="num">${(x.fixedTotal/x.netRevenue*100).toFixed(1)}%</td><td class="num ${x.netProfit<0?'d-down':''}">${money(x.netProfit,{compact:true})}</td><td class="num">${(x.netProfit/x.netRevenue*100).toFixed(1)}%</td><td>${entered ? '<span class="tag live"><span class="d"></span>'+tx('u.manualLc')+'</span>' : carried ? '<span class="tag info" title="'+OPEX_EST_TITLE()+'"><span class="d"></span>'+tv('estimated','tạm tính')+'</span>' : '<span class="tag gap"><span class="d"></span>'+tx('u.notEntered')+'</span>'}</td></tr>`;
      }).join('')+'</tbody>';
    document.getElementById('opexMonthsCaption').textContent = tv('G&A = data/opex_monthly.json (Vietnam payroll & office costs, Upwork contractors, software from the Mercury/Slash cards, Numeral accounting) + Klaviyo invoices + the Snowball plan. The month not closed yet is estimated (tagged): Vietnam costs = average of the last 6 closed months, software (Slash) & Upwork = actual charges to date, spread per day.','G&A = data/opex_monthly.json (lương & chi phí văn phòng VN, nhân sự Upwork, phần mềm từ thẻ Mercury/Slash, kế toán Numeral) + hoá đơn Klaviyo + gói Snowball. Tháng chưa chốt sổ được tạm tính (gắn nhãn): chi phí VN = TB 6 tháng đã chốt gần nhất, phần mềm (Slash) & Upwork = số thực tế tới nay, rải theo ngày.');
    document.getElementById('cashGaps').innerHTML = [
      {name:tv('Bank balance & runway','Số dư ngân hàng & runway'), note:tv('Bank/Mercury/QuickBooks not connected — enter by hand or connect the API when ready','Chưa nối ngân hàng/Mercury/QuickBooks — nhập tay hoặc nối API khi sẵn sàng')},
      {name:tv('Cash in transit (Amazon, Walmart, TikTok payouts)','Tiền đang trên đường về (Amazon, Walmart, TikTok payout)'), note:tv('Amazon Finances has settlement data — not yet built into a cash flow','Amazon Finances có số liệu quyết toán — chưa dựng thành dòng tiền')},
    ].map(g=>`<div class="gap-row"><span class="dot c"></span><span class="g-name">${g.name}</span><span class="g-note">${g.note}</span></div>`).join('');
  }

  // ---------- wire up ----------
  let lastVw = window.innerWidth;
  window.addEventListener('resize', ()=>{ clearTimeout(window.__rsz); window.__rsz = setTimeout(()=>{ if(window.innerWidth!==lastVw){ lastVw = window.innerWidth; renderTrend(); renderBreakeven(); renderExec(); } }, 150); });
  function renderAll(){
    applySourceAges();   // V10: source "age" lines in the active language
    renderSubCtl(); renderKpis(); renderTrend(); renderStatement(); renderChannelCosts(); renderBreakeven(); renderRoas(); renderAttribution(); renderKlaviyo(); renderLoopSubscriptions(); renderTax(); renderSources(); renderOpexTable(); renderGaps(); renderAmazonGaps(); renderShipmonk(); renderShopifyRecon(); renderSnowball(); renderMetaCampaigns(); renderGoogleCampaigns();
    renderExec(); renderRev(); renderChannels(); renderProductLines(); renderInventory(); renderShipmonkInventory(); renderOpexPage(); renderUnitEconomics(); renderSensitivity(); renderFunnel(); renderReturnsBySku(); renderProductPnl(); renderLots(); renderFindings(); renderPageHead();
    if(_bannerPaint) _bannerPaint();
  }
  function renderPageHead(){
    const h = document.getElementById('pageTitle'); if(h) h.textContent = tx('page.'+currentView);
    const c = document.getElementById('pageCtx'); if(!c) return;
    const parts = [];
    if(maskPartial()) parts.push(maskLabel());
    if(!onPnl() && EXEC_STATE.cmp!=='none') parts.push(tx('ctx.vs', {cmp: likeLabel()}));
    const rows = currentRows(); if(rows.length && rows[rows.length-1]._syncing) parts.push(tx('ctx.today'));
    c.textContent = parts.join(' · ');
  }
  // V11.2.1: per-user pages. The loader in pnl.html puts /api/me into window.__ME ({views, admin, email...}); the owner /
  // an old server give null = every page. Tabs the user may not see were removed from #mainTabs by the loader; here the
  // view list follows the same rule so a saved or typed view outside the list falls back to the first allowed page.
  const ME = window.__ME || null;
  const canView = v => !ME || !Array.isArray(ME.views) || ME.views.includes(v);
  const ALL_VIEWS = ['exec','sales','marketing','pnl','inventory','opex','data'];
  const VIEWS = ALL_VIEWS.filter(canView);
  let booted = false;
  function showView(view){
    if(!VIEWS.includes(view)) view = VIEWS[0] || 'exec';
    const wasPnl = currentView==='pnl'; currentView = view;
    if(view==='pnl') applyPnlState(); else { if(wasPnl) savePnlState(); applyExecState(); }
    [...document.querySelectorAll('#mainTabs button')].forEach(b=>{ const on = b.dataset.view===view; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    ALL_VIEWS.forEach(v=>{ const el = document.getElementById('view'+v.charAt(0).toUpperCase()+v.slice(1)); if(el) el.hidden = (v!==view); });
    try{ localStorage.setItem('ctu_view', view); }catch(e){}
    if(booted) renderAll();   // the period control and the row selection differ per page, so everything re-renders
  }
  document.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click', ()=>setLang(b.dataset.lang)));
  (()=>{ const tb = document.getElementById('themeBtn'); if(!tb) return; const apply = v => { if(v) document.documentElement.setAttribute('data-theme', v); else document.documentElement.removeAttribute('data-theme'); }; try{ apply(localStorage.getItem('ctu_theme')||''); }catch(e){} tb.addEventListener('click', ()=>{ const cur = document.documentElement.getAttribute('data-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const next = cur==='dark' ? 'light' : 'dark'; apply(next); try{ localStorage.setItem('ctu_theme', next); }catch(e){} renderAll(); }); })();
  renderStatic();
  document.getElementById('mainTabs').addEventListener('click', (e)=>{ const btn = e.target.closest('button'); if(!btn) return; if(btn.dataset.view!==currentView) showView(btn.dataset.view); });
  (()=>{ let v0 = VIEWS[0] || 'exec'; try{ const s1 = localStorage.getItem('ctu_view'); if(s1 && VIEWS.includes(s1)) v0 = s1; }catch(e){} showView(v0); })();
  [...document.querySelectorAll('#modeSeg button')].forEach(b=>b.classList.toggle('active', b.dataset.mode===mode));   // default / remembered period
  document.getElementById('modeSeg').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    mode = btn.dataset.mode; savePnlState();
    try{ localStorage.setItem('ctu_mode', mode); }catch(e){}
    [...document.querySelectorAll('#modeSeg button')].forEach(b=>b.classList.toggle('active', b===btn));
    renderAll();
  });

  // Amazon SP-API data is baked into the page at publish time (see AMAZON_DATA_INJECT
  // above) by the automated GitHub Actions -> Claude scheduled-task sync, so it's applied
  // synchronously here before the very first render.
  const amazonMatched = AMAZON_LIVE_DATA ? applyAmazonRows(AMAZON_LIVE_DATA) : false;
  const amazonStorageMatched = (amazonMatched && AMAZON_STORAGE_LIVE_DATA) ? applyAmazonStorageRows(AMAZON_STORAGE_LIVE_DATA) : false;
  const metaMatched = META_ADS_LIVE_DATA ? applyMetaAdsRows(META_ADS_LIVE_DATA) : false;
  const googleMatched = GOOGLE_ADS_LIVE_DATA ? applyGoogleAdsRows(GOOGLE_ADS_LIVE_DATA) : false;
  const applovinMatched = APPLOVIN_LIVE_DATA ? applyApplovinRows(APPLOVIN_LIVE_DATA) : false;
  if(applovinMatched){ AD_UNCONNECTED.applovin = false; }
  const tiktokAdsMatched = TIKTOK_ADS_LIVE_DATA ? applyTiktokAdsRows(TIKTOK_ADS_LIVE_DATA) : false;
  if(tiktokAdsMatched){ AD_UNCONNECTED.tiktokads = false; }
  const amazonAdsMatched = AMAZON_ADS_LIVE_DATA ? applyAmazonAdsRows(AMAZON_ADS_LIVE_DATA) : false;
  if(amazonAdsMatched){ AD_UNCONNECTED.amazonads = false; }
  // ShipMonk fulfillment costs baked in by the same sync.
  const paypalMatched = PAYPAL_LIVE_DATA ? applyPaypalRows(PAYPAL_LIVE_DATA) : false;
  const loopMatched = LOOP_LIVE_DATA ? applyLoopRows(LOOP_LIVE_DATA) : false;
  const tiktokMatched = TIKTOK_SHOP_LIVE_DATA ? applyTiktokShopRows(TIKTOK_SHOP_LIVE_DATA) : false;
  if(tiktokMatched){ CH_UNCONNECTED.tiktok = false; }
  const walmartMatched = WALMART_LIVE_DATA ? applyWalmartRows(WALMART_LIVE_DATA) : false;
  if(walmartMatched){ CH_UNCONNECTED.walmart = false; }
  const shipmonkMatched = SHIPMONK_LIVE_DATA ? applyShipmonkRows(SHIPMONK_LIVE_DATA) : false;
  const shipmonkStorageMatched = SHIPMONK_STORAGE_LIVE_DATA ? applyShipmonkStorageRows(SHIPMONK_STORAGE_LIVE_DATA) : false;   // before the invoices: they reallocate storage by it
  const shipmonkInvMatched = SHIPMONK_INVOICES_LIVE_DATA ? applyShipmonkInvoiceRows(SHIPMONK_INVOICES_LIVE_DATA) : false;
  // Klaviyo (email + SMS) attribution + campaign/flow performance, and the Klaviyo invoices (cost).
  const klaviyoMatched = KLAVIYO_LIVE_DATA ? applyKlaviyoRows(KLAVIYO_LIVE_DATA) : false;
  const klaviyoInvMatched = KLAVIYO_INVOICES_LIVE_DATA ? applyKlaviyoInvoiceRows(KLAVIYO_INVOICES_LIVE_DATA) : false;
  // Monthly OpEx entered by hand in the repo (data/opex_monthly.json).
  const opexMatched = OPEX_MONTHLY_LIVE_DATA ? applyOpexRows(OPEX_MONTHLY_LIVE_DATA) : false;
  const targetsMatched = TARGETS_LIVE_DATA ? applyTargets(TARGETS_LIVE_DATA) : false;
  const cogsMatched = COGS_LIVE_DATA ? applyCogsActual(COGS_LIVE_DATA) : false;
  // Shopify + Snowball baked in by the same hourly sync.
  const shopifyMatched = SHOPIFY_LIVE_DATA ? applyShopifyLive(SHOPIFY_LIVE_DATA) : false;
  // V10: the "age" line of every baked-in source (Data page) is text in the active language, so it is written here
  // once at boot and again at the start of every renderAll() (the language toggle re-renders everything).
  function applySourceAges(){
    const fmtD = k => k ? k.slice(8,10)+'/'+k.slice(5,7)+'/'+k.slice(0,4) : '';
    if(amazonStorageMatched){
      const st = AMAZON_STORAGE_LIVE_DATA.storage || {}, iv = AMAZON_STORAGE_LIVE_DATA.inventory || {};
      const mr = st.months_with_report || [];
      setSource('amazon_storage', ageLevel(AMAZON_STORAGE_LIVE_DATA.generated_at), fmtAmazonAge(AMAZON_STORAGE_LIVE_DATA.generated_at) + tv(' · stock ',' · tồn kho ') + (iv.on_hand||0).toLocaleString('en-US') + ' units / ' + (iv.skus||0) + ' SKU' + (mr.length ? tv(' · storage fee reports ',' · report phí lưu kho ') + mr[0].slice(5,7)+'/'+mr[0].slice(0,4) + ' → ' + mr[mr.length-1].slice(5,7)+'/'+mr[mr.length-1].slice(0,4) : tv(' · no monthly report yet',' · chưa có report tháng nào')));
    }
    if(amazonMatched){
      setSource('amazon',ageLevel(AMAZON_LIVE_DATA.generated_at), fmtAmazonAge(AMAZON_LIVE_DATA.generated_at)+fmtCoverage(AMAZON_LIVE_DATA));
      setSource('amazonfin',ageLevel(AMAZON_LIVE_DATA.generated_at), fmtAmazonAge(AMAZON_LIVE_DATA.generated_at)+fmtCoverage(AMAZON_LIVE_DATA));
    }
    if(metaMatched){
      setSource('meta',ageLevel(META_ADS_LIVE_DATA.generated_at), fmtAmazonAge(META_ADS_LIVE_DATA.generated_at)+fmtCoverage(META_ADS_LIVE_DATA));
    }
    if(googleMatched){
      setSource('google',ageLevel(GOOGLE_ADS_LIVE_DATA.generated_at), fmtAmazonAge(GOOGLE_ADS_LIVE_DATA.generated_at)+fmtCoverage(GOOGLE_ADS_LIVE_DATA));
    }
    if(applovinMatched){
      const acov = APPLOVIN_LIVE_DATA.coverage || {}, am = APPLOVIN_LIVE_DATA.meta || {};
      const aFmt = fmtD;
      const aErr = am.api_errors && am.api_errors.length && am.time_basis!=='utc_day';
      setSource('applovin', aErr ? 'w' : ageLevel(APPLOVIN_LIVE_DATA.generated_at), fmtAmazonAge(APPLOVIN_LIVE_DATA.generated_at)+(acov.first_day ? tx('age.from', {d: aFmt(acov.first_day)}) : '')+' · '+(am.time_basis==='hour_to_la' ? tv('days in LA time','ngày theo giờ LA') : tv('days in UTC (the API returns no hour — off by a few hours at most vs LA time)','ngày theo UTC (API không trả giờ — lệch tối đa vài giờ so với giờ LA)'))+tv(' · the API keeps only 45 days, older comes from the export file',' · API chỉ giữ 45 ngày, cũ hơn lấy từ file export'));
    }
    if(tiktokAdsMatched){
      const tm = TIKTOK_ADS_LIVE_DATA.meta || {};
      const tErr = tm.api_errors && tm.api_errors.length;
      setSource('tiktokads', tErr ? 'w' : ageLevel(TIKTOK_ADS_LIVE_DATA.generated_at), fmtAmazonAge(TIKTOK_ADS_LIVE_DATA.generated_at)+fmtCoverage(TIKTOK_ADS_LIVE_DATA)+tv(' · GMV Max (TikTok Shop) + regular ads · days in account time (UTC−8)',' · GMV Max (TikTok Shop) + quảng cáo thường · ngày theo giờ tài khoản (UTC−8)')+(tErr ? tv(' · error on the latest run: ',' · lỗi lần chạy gần nhất: ')+tm.api_errors[tm.api_errors.length-1] : ''));
    }
    if(amazonAdsMatched){
      const cov = AMAZON_ADS_LIVE_DATA.coverage || {};
      const via = AMAZON_ADS_LIVE_DATA.source==='sellerboard' ? tv('via Sellerboard','qua Sellerboard') : 'Amazon Ads API';
      const auto = AMAZON_ADS_LIVE_DATA.meta && AMAZON_ADS_LIVE_DATA.meta.automation;
      setSource('amazonads', ageLevel(AMAZON_ADS_LIVE_DATA.generated_at), fmtAmazonAge(AMAZON_ADS_LIVE_DATA.generated_at)+' · '+via+(cov.first_day ? tx('age.from', {d: cov.first_day.slice(8,10)+'/'+cov.first_day.slice(5,7)+'/'+cov.first_day.slice(0,4)}) : '')+(auto && auto.fetched_last_day ? tv(' · export final through ',' · export chốt đến ')+auto.fetched_last_day.slice(8,10)+'/'+auto.fetched_last_day.slice(5,7) : ''));
      const cap = document.getElementById('adsCaptionAmazon');
      if(cap) cap.outerHTML = `<span id="adsCaptionAmazon">${tv('Amazon Ads: "Spend" and "Attributed revenue" on the card = Total cost and Sales in the Amazon Ads console (SP+SB+SD, Amazon revenue attributed to ads within the 7/14-day window, updated for a few more days after the click) — ROAS = Sales ÷ Total cost, ACOS = Total cost ÷ Sales, TACOS = Amazon ad spend ÷ Amazon gross sales for the period. The "Sponsored Television" item Sellerboard books from 31/08 is not in the Ads console, so it is not counted. ','Amazon Ads: "Chi" và "DT quy về" trên thẻ = Total cost và Sales trong Amazon Ads console (SP+SB+SD, doanh thu Amazon gán cho quảng cáo trong cửa sổ 7/14 ngày, được cập nhật thêm vài ngày sau khi click) — ROAS = Sales ÷ Total cost, ACOS = Total cost ÷ Sales, TACOS = chi quảng cáo Amazon ÷ doanh thu gộp Amazon của kỳ. Khoản "Sponsored Television" Sellerboard ghi từ 31/08 không có trong Ads console nên không tính. ')}</span>`;
    }
    if(paypalMatched){
      setSource('paypal',ageLevel(PAYPAL_LIVE_DATA.generated_at), fmtAmazonAge(PAYPAL_LIVE_DATA.generated_at)+fmtCoverage(PAYPAL_LIVE_DATA));
    }
    if(loopMatched){
      const lc = LOOP_LIVE_DATA.coverage || {};
      setSource('loop', ageLevel(LOOP_LIVE_DATA.generated_at), fmtAmazonAge(LOOP_LIVE_DATA.generated_at)+(lc.first_day ? tx('age.from', {d: fmtD(lc.first_day)}) : ''));
    }
    if(tiktokMatched){
      const tm = TIKTOK_SHOP_LIVE_DATA.meta || {}, tc = TIKTOK_SHOP_LIVE_DATA.coverage || {};
      const od = Object.keys(TIKTOK_SHOP_LIVE_DATA.orders_daily||{}).sort();
      const feeErr = tm.order_fee_calls && tm.order_fee_calls.errors>0;
      const lvl = (tm.orders_status && tm.orders_status.status==='ok' && !feeErr) ? ageLevel(TIKTOK_SHOP_LIVE_DATA.generated_at) : 'w';
      setSource('tiktokshop', lvl, fmtAmazonAge(TIKTOK_SHOP_LIVE_DATA.generated_at)+(od.length ? tv(' · orders from ',' · đơn từ ')+fmtD(od[0]) : '')+' · '+(tm.orders_total||0)+tv(' orders sold (',' đơn bán (')+(tm.orders_settled||0)+tv(' settled, actual fees; the rest estimated by rate)',' đã quyết toán, phí thật; còn lại ước tính theo tỷ lệ)')+(lvl==='w' ? tv(' · Orders/Finance API reported an error — see GitHub Actions',' · Orders/Finance API báo lỗi — xem GitHub Actions') : ''));
    }
    if(walmartMatched){
      const wm = WALMART_LIVE_DATA.meta || {};
      const wod = Object.keys(WALMART_LIVE_DATA.orders_daily||{}).sort();
      const fmtDW = fmtD;
      const wErr = (wm.orders_status && !wm.orders_status.ok) || (wm.recon && (!wm.recon.ok || wm.recon.errors>0));
      const wl = wErr ? 'w' : ageLevel(WALMART_LIVE_DATA.generated_at);
      setSource('walmart', wl, fmtAmazonAge(WALMART_LIVE_DATA.generated_at)+(wod.length ? tv(' · orders from ',' · đơn từ ')+fmtDW(wod[0]) : '')+' · '+(wm.orders_total||0)+tv(' orders sold (',' đơn bán (')+(wm.orders_settled||0)+tv(' reconciled, actual fees; the rest estimated by rate)',' đã đối soát, phí thật; còn lại ước tính theo tỷ lệ)')+(wm.orders_from_recon>0 ? ' · '+wm.orders_from_recon+tv(' older orders (the API keeps only 180 days) rebuilt from the reconciliation report, date ≈ ship/posting date',' đơn cũ (API chỉ giữ 180 ngày) dựng lại từ báo cáo đối soát, ngày ≈ ngày giao hàng/ghi sổ') : '')+(wErr ? tv(' · Orders/Recon API reported an error — see GitHub Actions',' · Orders/Recon API báo lỗi — xem GitHub Actions') : ''));
    }
    if(shipmonkMatched){
      setSource('shipmonk',ageLevel(SHIPMONK_LIVE_DATA.generated_at), fmtAmazonAge(SHIPMONK_LIVE_DATA.generated_at)+fmtCoverage(SHIPMONK_LIVE_DATA));
    }
    if(shipmonkInvMatched){
      const im = SHIPMONK_INVOICES_LIVE_DATA.meta || {};
      setSource('shipmonk_inv',(SHIPMONK_INVOICES_LIVE_DATA.meta && SHIPMONK_INVOICES_LIVE_DATA.meta.current_period ? 'g' : 'w'), fmtAmazonAge(SHIPMONK_INVOICES_LIVE_DATA.generated_at) + (im.first_day ? tv(' · invoices ',' · hoá đơn ')+fmtD(im.first_day)+' → '+fmtD(im.last_day) : '') + (im.missing_count ? tx('age.missing', {n: im.missing_count}) : '') + (shipmonkStorageMatched ? tv(' · daily storage through ',' · lưu kho theo ngày đến ')+fmtD(SHIPMONK_STORAGE_LIVE_DATA.last_day) : ''));
    }
    if(klaviyoMatched || klaviyoInvMatched){
      const km = (KLAVIYO_INVOICES_LIVE_DATA && KLAVIYO_INVOICES_LIVE_DATA.meta) || {};
      setSource('klaviyo',(klaviyoMatched ? ageLevel(KLAVIYO_LIVE_DATA.generated_at) : 'w'), (klaviyoMatched ? fmtAmazonAge(KLAVIYO_LIVE_DATA.generated_at)+fmtCoverage(KLAVIYO_LIVE_DATA) : tv('API not available','API chưa có')) + (klaviyoInvMatched ? tv(' · invoices through ',' · hoá đơn đến ')+fmtD(km.last_day) : tv(' · no invoices yet',' · chưa có hoá đơn')));
    }
    if(COGS_LOTS_LIVE_DATA){
      const cm = COGS_LOTS_LIVE_DATA.meta || {}, cg = COGS_LOTS_LIVE_DATA.generated_at || cm.fetched_at;
      const cAge = cg ? (Date.now()-new Date(cg).getTime())/86400000 : null;
      setSource('cogs', cAge===null ? 'w' : cAge<=7 ? 'g' : cAge<=31 ? 'w' : 'c', (cg ? tv('read from Notion ','đọc từ Notion ')+fmtD(String(cg).slice(0,10)) : '')+' · '+(cm.lots||0).toLocaleString('en-US')+tv(' lots · ',' lô · ')+(cm.skus||0)+' SKU · '+(cm.lots_with_landed||0).toLocaleString('en-US')+tv(' with landed cost',' có landed cost')+(COGS_SKUS_LIVE_DATA ? tv(' + per-SKU cost (cogs_skus)',' + giá theo SKU (cogs_skus)') : ''));
    }
    if(opexMatched){
      const e = opexMeta.entered;
      const fmtM = m => m.slice(5,7)+'/'+m.slice(0,4);
      const anyNum = e.some(m => OPEX_GA_KEYS.concat(OPEX_BELOW_KEYS).some(k => parseFloat(OPEX_MONTHLY_LIVE_DATA.months[m][k])>0));
      const ec = opexMeta.closed.length ? opexMeta.closed : e;
      setSource('ga', anyNum ? 'g' : 'w', tv('entered by hand in data/opex_monthly.json · ','nhập tay data/opex_monthly.json · ') + (ec.length===1 ? tv('month ','tháng ')+fmtM(ec[0]) : fmtM(ec[0])+' → '+fmtM(ec[ec.length-1])) + (opexMeta.open.length ? tv(' · open month ',' · tháng đang mở ')+opexMeta.open.map(fmtM).join(', ')+tv(' estimated',' tạm tính') : '') + (anyNum ? '' : tv(' (all $0 — no figures entered)',' (toàn $0 — chưa điền số)')));
    }
    if(shopifyMatched){
      setSource('shopify',ageLevel(SHOPIFY_LIVE_DATA.generated_at), fmtAmazonAge(SHOPIFY_LIVE_DATA.generated_at)+fmtCoverage(SHOPIFY_LIVE_DATA));
      setSource('snowball',ageLevel(SHOPIFY_LIVE_DATA.generated_at), fmtAmazonAge(SHOPIFY_LIVE_DATA.generated_at)+fmtCoverage(SHOPIFY_LIVE_DATA));
    }
  }
  applySourceAges();
  // Human-readable list of the sources that are baked in live, for the banner text.
  function bakedLiveNames(){
    const names = [];
    if(shopifyMatched) names.push(tv('Shopify (real Admin API)','Shopify (Admin API thật)'));
    if(shopifyMatched) names.push(tv('Snowball (commission from Shopify tags)','Snowball (hoa hồng từ tag Shopify)'));
    if(amazonMatched) names.push(tv('Amazon (real SP-API)','Amazon (SP-API thật)'));
    if(amazonStorageMatched) names.push(tv('Amazon FBA inventory & storage fees (Inventory API + monthly report)','Amazon FBA tồn kho & phí lưu kho (Inventory API + report tháng)'));
    if(metaMatched) names.push(tv('Meta Ads (real Marketing API)','Meta Ads (Marketing API thật)'));
    if(googleMatched) names.push(tv('Google Ads (real Google Ads API)','Google Ads (Google Ads API thật)'));
    if(applovinMatched) names.push(tv('AppLovin (real Reporting API — ad spend)','AppLovin (Reporting API thật — chi phí quảng cáo)'));
    if(tiktokAdsMatched) names.push(tv('TikTok Ads (Marketing API — GMV Max for TikTok Shop)','TikTok Ads (Marketing API — GMV Max cho TikTok Shop)'));
    if(amazonAdsMatched) names.push(AMAZON_ADS_LIVE_DATA.source==='sellerboard' ? tv('Amazon Ads (SP/SB/SD spend via Sellerboard)','Amazon Ads (chi phí SP/SB/SD qua Sellerboard)') : tv('Amazon Ads (real Ads API)','Amazon Ads (Ads API thật)'));
    if(shipmonkMatched) names.push(tv('ShipMonk (real API — per-order fulfillment fees)','ShipMonk (API thật — phí fulfillment theo đơn)'));
    if(shipmonkInvMatched) names.push(tv('ShipMonk invoices (storage, receiving, returns, packaging)','ShipMonk hoá đơn (lưu kho, receiving, hàng trả, bao bì)'));
    if(paypalMatched) names.push(tv('PayPal (real API — transaction fees)','PayPal (API thật — phí giao dịch)'));
    if(tiktokMatched) names.push(tv('TikTok Shop (real Open API — orders by order date, actual fees on settled orders)','TikTok Shop (Open API thật — đơn theo ngày đặt, phí thật đơn đã quyết toán)'));
    if(walmartMatched) names.push(tv('Walmart (real Marketplace API — orders by order date, actual commission from the reconciliation report)','Walmart (Marketplace API thật — đơn theo ngày đặt, hoa hồng thật từ báo cáo đối soát)'));
    if(klaviyoMatched) names.push(tv('Klaviyo (real API — email & SMS)','Klaviyo (API thật — email & SMS)'));
    if(klaviyoInvMatched) names.push(tv('Klaviyo invoices (plan cost)','hoá đơn Klaviyo (chi phí gói)'));
    if(COGS_LOTS_LIVE_DATA) names.push(tv('product cost (FIFO by Notion receipt lot)','giá vốn (FIFO theo lô nhập Notion)'));
    if(opexMatched) names.push(tv('G&A (entered monthly)','G&A (nhập theo tháng)'));
    return names;
  }
  booted = true;
  renderAll();

  // ---------- live data via mcp capability (Shopify) ----------
  function setLiveBanner(html, tone){
    const el = document.getElementById('liveBanner');
    el.innerHTML = html;
    const toneColor = tone==='good' ? 'var(--status-good)' : tone==='bad' ? 'var(--status-critical)' : 'var(--accent)';
    el.style.borderColor = `color-mix(in srgb, ${toneColor} 35%, var(--border))`;
    el.style.background = `color-mix(in srgb, ${toneColor} 8%, var(--surface-card))`;
    el.style.setProperty('--bi', tone==='warn' ? 'var(--status-warning)' : toneColor);
  }
  // ---------- live data: TikTok Shop orders by order date + fees (GitHub Actions sync, data/tiktok_shop.json) ----------
  // Sales / discounts / orders on the ORDER day (same rule as Shopify and Amazon). Real fees exist only for SETTLED
  // orders (TikTok books them ~8 days after delivery); the not-yet-settled sales get the fee rates measured on the
  // settled ones (data.meta.fee_rates_settled) and are tagged as estimates. Refunds: day of cancel / of the statement.
  function applyTiktokShopRows(data){
    if(!data || !data.orders_daily) return false;
    tiktokMeta = data;
    const rates = (data.meta && data.meta.fee_rates_settled) || {};
    const rt = k => parseFloat(rates[k])||0;
    const num = v => parseFloat(v)||0;
    let matched = 0;
    Object.keys(data.orders_daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.orders_daily[iso] || {};
      const net = num(r.net_sales), netSettled = num(r.net_sales_settled);
      const unNet = r.net_sales_unsettled!=null ? num(r.net_sales_unsettled) : 0;
      days[idx].channels.tiktok = num(r.gross_sales);
      days[idx].discounts.tiktok = num(r.seller_discount);
      days[idx].orders.tiktok = Math.round(num(r.orders_count));
      if(r.sku_units && typeof r.sku_units==='object') (days[idx].sku = days[idx].sku||{}).tiktok = {units: r.sku_units, sales: r.sku_sales||{}, refunds: r.sku_refund_units||{}};   // V11.3.1 (tiktok_shop-2.3)
      days[idx].tiktokReal = {
        netSales: net, netSettled, netUnsettled: unNet,
        settledOrders: Math.round(num(r.settled_orders)), unsettledOrders: Math.round(num(r.unsettled_orders)),
        cancelled: Math.round(num(r.cancelled_orders)), platformDiscount: num(r.platform_discount),
        sellingReal: num(r.fees_referral) + num(r.fees_refund_admin) + num(r.fees_other),
        smartReal: num(r.fees_smart_promo), affiliateReal: num(r.fees_affiliate),
        sellingEst: unNet * (rt('referral') + rt('other')),
        smartEst: unNet * rt('smart_promo'), affiliateEst: unNet * rt('affiliate'),
      };
      matched++;
    });
    Object.keys(data.refunds_daily || {}).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.refunds_daily[iso] || {};
      days[idx].refunds.tiktok += Math.max(0, num(r.refund_gross) - num(r.refund_seller_discount));
    });
    return matched>0;
  }

  // ---------- live data: Walmart Marketplace orders by order date + commission (GitHub Actions sync, data/walmart.json) ----------
  // Sales / orders on the ORDER day (same rule as Shopify, Amazon, TikTok). Real commission comes from Walmart's
  // reconciliation report once an order settles; the not-yet-settled sales get the commission rate measured on the
  // settled ones (data.meta.fee_rates_settled.commission) and are tagged as estimates. Refunds: day of the refund.
  // Fees that are not tied to an order (Walmart ads, service fees) land on the day they were posted.
  function applyWalmartRows(data){
    if(!data || !data.orders_daily) return false;
    walmartMeta = data;
    const rate = parseFloat(data.meta && data.meta.fee_rates_settled && data.meta.fee_rates_settled.commission)||0;
    const num = v => parseFloat(v)||0;
    const wr = idx => days[idx].walmartReal || (days[idx].walmartReal = {netSales:0, netSettled:0, netUnsettled:0, settledOrders:0, unsettledOrders:0, cancelled:0, commissionReal:0, commissionEst:0, otherReal:0, adsReal:0});
    let matched = 0;
    Object.keys(data.orders_daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.orders_daily[iso] || {};
      days[idx].channels.walmart = num(r.gross_sales);
      days[idx].orders.walmart = Math.round(num(r.orders_count));
      if(r.sku_units && typeof r.sku_units==='object') (days[idx].sku = days[idx].sku||{}).walmart = {units: r.sku_units, sales: r.sku_sales||{}, refunds: r.sku_refund_units||{}};   // V11.3.1 (walmart sku_schema 1)
      const x = wr(idx);
      x.netSales = num(r.net_sales); x.netSettled = num(r.net_sales_settled); x.netUnsettled = num(r.net_sales_unsettled);
      x.settledOrders = Math.round(num(r.settled_orders)); x.unsettledOrders = Math.round(num(r.unsettled_orders)); x.cancelled = Math.round(num(r.cancelled_orders));
      x.commissionReal = num(r.fees_commission); x.commissionEst = x.netUnsettled * rate;
      matched++;
    });
    Object.keys(data.refunds_daily || {}).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      days[idx].refunds.walmart += Math.max(0, num((data.refunds_daily[iso]||{}).refund_gross));
      wr(idx);
    });
    Object.keys(data.other_fees_daily || {}).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.other_fees_daily[iso] || {}, x = wr(idx);
      x.adsReal += num(r.ads);
      x.otherReal += num(r.other_fee) + num(r.commission);
    });
    return matched>0;
  }

  function applyShopifyRows(rows){
    let matched = 0, sumGross = 0;
    rows.forEach(r=>{
      const iso = r[0];
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const orders = parseInt(r[1],10)||0;
      const gross = parseFloat(r[2])||0;
      const discount = Math.abs(parseFloat(r[3])||0);
      const reversal = Math.abs(parseFloat(r[4])||0);
      days[idx].channels.shopify = gross;
      days[idx].discounts.shopify = discount;
      days[idx].refunds.shopify = reversal;
      days[idx].orders.shopify = Math.max(orders, 0);
      matched++; sumGross += gross;
    });
    return matched>0;
  }

  // ---------- live data: ShipMonk per-order fulfillment charges (GitHub Actions sync) ----------
  function applyPaypalRows(data){
    if(!data || !data.daily) return false;
    paypalMeta = data;
    let matched = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      days[idx].paypalReal = {
        fees: parseFloat(r.fees)||0,                 // PayPal fee_amount, net of fee credits (positive = cost)
        payments: parseFloat(r.payments)||0,
        paymentsCount: Math.round(parseFloat(r.payments_count)||0),
        refunds: parseFloat(r.refunds)||0,
        transactions: Math.round(parseFloat(r.transactions)||0),
      };
      matched++;
    });
    return matched>0;
  }

  function applyLoopRows(data){
    if(!data || !data.daily) return false;
    loopMeta = data;
    let matched = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      days[idx].loopReal = {
        newSubscriptions: Math.round(parseFloat(r.new_subscriptions)||0),
        newSubscribers: Math.round(parseFloat(r.new_subscribers)||0),
        checkoutRevenue: parseFloat(r.checkout_revenue)||0,
        recurringRevenueActual: r.recurring_revenue_actual==null ? null : parseFloat(r.recurring_revenue_actual),
      };
      matched++;
    });
    return matched>0;
  }

  function applyShipmonkRows(data){
    if(!data || !data.daily) return false;
    shipmonkMeta = data;
    if(data.inventory && typeof data.inventory==='object' && data.inventory.skus) SHIPMONK_INVENTORY = data.inventory;
    if(data.bom && typeof data.bom==='object' && data.bom.bundles && Object.keys(data.bom.bundles).length) SHIPMONK_BOM = data.bom;
    let matched = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      days[idx].shipmonkReal = {
        orders: Math.round(parseFloat(r.orders)||0),
        units: Math.round(parseFloat(r.units)||0),
        packages: Math.round(parseFloat(r.packages)||0),
        shipping: parseFloat(r.shipping_cost)||0,     // carrier / postage charges
        packaging: parseFloat(r.packaging_cost)||0,   // boxes, mailers, dunnage
        pickPack: parseFloat(r.pick_pack_cost)||0,    // fulfillment labour
        total: parseFloat(r.total_cost)||0,
        missing: Math.round(parseFloat(r.cost_missing_orders)||0),
        shipped: Math.round(parseFloat(r.orders_shipped !== undefined ? r.orders_shipped : r.orders)||0),   // sync v1.0 = shipped orders only
        unshipped: Math.round(parseFloat(r.orders_unshipped)||0),
        onhold: Math.round(parseFloat(r.orders_onhold)||0),        // sync v1.2+: subset of unshipped (stock-out / address holds)
        foreign: r.foreign_cost || {},                              // sync v1.3+: native amounts of charges stated in CAD etc. (already converted in the USD fields)
        byStore: r.by_store || {}, byType: r.by_type || {}, byCarrier: r.by_carrier || {},
        packagingItems: (r.packaging_items && typeof r.packaging_items==='object') ? r.packaging_items : null,   // sync v1.5+: {box_sku: boxes picked} -> box cost by FIFO over the box lots
        packagingUnits: Math.round(parseFloat(r.packaging_units)||0),
      };
      matched++;
    });
    // Days inside the sync window with no orders still count as real ($0) days.
    if(data.window && data.window.start && data.window.end){
      days.forEach(d=>{ if(!d.shipmonkReal && d.iso>=data.window.start && d.iso<=data.window.end) d.shipmonkReal = {orders:0,units:0,packages:0,shipping:0,packaging:0,pickPack:0,total:0,missing:0,shipped:0,unshipped:0,onhold:0,byStore:{},byType:{},byCarrier:{}}; });
    }
    // V11.1.1: ShipMonk only lists the box on the order from about 10/2025 (before that the packaging line is missing on
    // nearly every order), so a month whose boxes cover less than half of its packages has no usable per-package data:
    // those days keep the invoice's purchase line instead of a near-zero box cost. Coverage per month is kept for the labels.
    const cov = {};
    days.forEach(d=>{ const sr = d.shipmonkReal; if(!sr || !sr.packagingItems) return; const m = d.iso.slice(0,7); const c = cov[m] = cov[m] || {boxes:0, packages:0}; c.boxes += sr.packagingUnits||0; c.packages += sr.packages||0; });
    const weak = {}; Object.keys(cov).forEach(m=>{ const c = cov[m]; if(c.packages>0 && c.boxes < 0.5*c.packages) weak[m] = c; });
    days.forEach(d=>{ const sr = d.shipmonkReal; if(!sr || !sr.packagingItems) return; if(weak[d.iso.slice(0,7)]){ sr.packagingItems = null; sr.packagingUnits = 0; sr.boxDataWeak = true; } });
    shipmonkBoxCoverage = {months: cov, weak, firstGood: Object.keys(cov).filter(m=>!weak[m]).sort()[0] || null};
    return matched>0;
  }
  // Amazon storage per day: Finances posting (FBAStorageFee, month stored) stays the truth; months Amazon has not
  // billed yet take the storage-fee report total (est=false) or the inventory x volume x rate estimate (est=true).
  function applyAmazonStorageRows(data){
    if(!data || !data.storage || !data.storage.daily) return false;
    amazonStorageMeta = data;
    let matched = 0;
    days.forEach(d=>{
      const r = data.storage.daily[d.iso];
      if(!r || !d.amazonReal) return;
      const fee = parseFloat(r.fee)||0;
      d.amazonReal.storageReport = fee;
      if(!d.amazonReal.storageKnown){
        d.amazonReal.storageAlloc = fee;   // positive cost, like the Finances allocation (-monthly fee / days)
        d.amazonReal.storageKnown = true;
        d.amazonReal.storageSrc = r.est ? 'estimate' : 'report';
        d.amazonReal.storageEst = !!r.est;
      } else d.amazonReal.storageSrc = 'posted';
      matched++;
    });
    return matched>0;
  }

  // Daily storage fee (report): every day in the file gets the reported amount; days after the report's last day
  // (today, and yesterday until the 04:00 refresh) carry the last reported day forward as an estimate.
  function applyShipmonkStorageRows(data){
    if(!data || !data.daily) return false;
    shipmonkStorageMeta = data;
    let matched = 0, lastIso = null, last = null;
    days.forEach(d=>{
      const r = data.daily[d.iso];
      if(r){
        d.shipmonkStorage = {inv: parseFloat(r.inv)||0, tru: parseFloat(r.tru)||0, wh: r.wh||{}, src:'report'};
        lastIso = d.iso; last = d.shipmonkStorage; matched++;
      } else if(last && d.iso > lastIso && dayDiff(lastIso, d.iso) <= 7){
        d.shipmonkStorage = {inv: last.inv, tru: last.tru, wh: last.wh, src:'carry', from: lastIso};
      }
    });
    return matched>0;
  }
  function dayDiff(a, b){ return Math.round((new Date(b+'T00:00:00Z') - new Date(a+'T00:00:00Z'))/86400000); }

  function applyShipmonkInvoiceRows(data){
    if(!data || !data.daily) return false;
    shipmonkInvMeta = data;
    let matched = 0;
    // True-up per invoice: invoiced postage + pick & pack vs the API's estimate over the SAME billing
    // period (ship-date series). Only when the API covers every day of the period; prorated per day.
    const ds = (shipmonkMeta && shipmonkMeta.daily_shipped) || null;
    const trueUp = {};   // invoice number -> {perDay, invPerDay, apiByDay}
    (data.invoices||[]).forEach(inv=>{
      if(!ds) return;
      const n = inv.days || 1; let api = 0, covered = 0; const apiByDay = {};
      const start = new Date(inv.start.slice(0,4), inv.start.slice(5,7)-1, inv.start.slice(8,10));
      // a day inside the API's synced history with no shipped orders (holiday) simply has no entry = $0
      const hist = (shipmonkMeta.meta && shipmonkMeta.meta.history) || {};
      const inHistory = k => !!(hist.first_day && hist.last_day && k >= hist.first_day && k <= hist.last_day) || !!(shipmonkMeta.window && k >= shipmonkMeta.window.start && k <= shipmonkMeta.window.end);
      for(let i=0;i<n;i++){ const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate()+i); const k = isoDate(dt); const b = ds[k]; if(b){ covered++; const v = parseFloat(b.total_cost)||0; api += v; apiByDay[k] = v; } else if(inHistory(k)){ covered++; apiByDay[k] = 0; } }
      if(covered===n) trueUp[inv.number] = {perDay: ((inv.shipping||0) - api)/n, invPerDay: (inv.shipping||0)/n, apiByDay};
    });
    // Storage: the invoice total is spread by the daily report (exact per-day amounts) instead of evenly, when the
    // report covers the whole period; the period total stays the invoice's to the cent.
    const storageScale = {};   // invoice number -> factor applied to the reported daily amount
    (data.invoices||[]).forEach(inv=>{
      const n = inv.days || 1; let sum = 0, covered = 0;
      const start = new Date(inv.start.slice(0,4), inv.start.slice(5,7)-1, inv.start.slice(8,10));
      for(let i=0;i<n;i++){ const k = isoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate()+i)); const d = days.find(x=>x.iso===k); if(d && d.shipmonkStorage && d.shipmonkStorage.src==='report'){ covered++; sum += d.shipmonkStorage.inv; } }
      if(covered===n && sum>0 && (inv.storage||0)>0) storageScale[inv.number] = inv.storage/sum;
    });
    days.forEach(d=>{
      const r = data.daily[d.iso];
      if(!r) return;
      const f = k => parseFloat(r[k])||0;
      const tu = trueUp[r.invoice];
      const sc = storageScale[r.invoice];
      const storage = (sc && d.shipmonkStorage) ? d.shipmonkStorage.inv*sc : f('storage');
      d.shipmonkInv = {storage, storageSrc: sc ? 'report' : 'even', receiving:f('receiving'), returns:f('returns'), packaging_purchases:f('packaging_purchases'), fees_other:f('fees_other'),
                       adjustments:f('adjustments'), credits:f('credits'), unallocated:f('unallocated'), shipping:f('shipping'), total:f('total'), invoice:r.invoice,
                       trueUp: tu ? tu.perDay : 0, cmpOk: !!tu, cmpInv: tu ? tu.invPerDay : 0, cmpApi: tu ? (tu.apiByDay[d.iso]||0) : 0};
      matched++;
    });
    return matched>0;
  }
  // Sync v1.1+ books each order on its ORDER date (meta.cost_basis "...by_ordered_at"); v1.0 on the ship date.
  function shipmonkOrderBasis(){ return !!(shipmonkMeta && shipmonkMeta.meta && /ordered_at/.test(shipmonkMeta.meta.cost_basis||'')); }
  // ShipMonk store name -> which sales channel it is (by_type says D2C vs amazon; the store name is what ShipMonk shows)
  // Store names as ShipMonk > Settings > Stores lists them: "Cattasaurus - shoproxstore - …" (Shopify v2),
  // "Cattasaurus - Amazon USA" (Amazon FBM v2), "Cattasaurus - Walmart" (Walmart v2), "Cattasaurus - Manual Store",
  // "n8n Return Action" (Generic System v2 - reships from the returns flow), "Cattasaurus ShipMonk API".
  function shipmonkStoreLabel(name){
    const n = String(name||'');
    if(/amazon|fbm|mcf/i.test(n)) return tv('Amazon FBM via ShipMonk — store "','Amazon FBM qua ShipMonk — store "')+n+'"';
    if(/walmart/i.test(n)) return tv('Walmart via ShipMonk — store "','Walmart qua ShipMonk — store "')+n+'"';
    if(/tiktok/i.test(n)) return tv('TikTok Shop via ShipMonk — store "','TikTok Shop qua ShipMonk — store "')+n+'"';
    if(/manual/i.test(n)) return tv('Orders created by hand in ShipMonk — store "','Đơn tạo tay trên ShipMonk — store "')+n+'"';
    if(/return|reship|claim/i.test(n)) return tv('Return reships / claims — store "','Gửi lại hàng trả / claim — store "')+n+'"';
    if(/shopify|shop|cattasaurus\.com|web/i.test(n)) return tv('Shopify via ShipMonk — store "','Shopify qua ShipMonk — store "')+n+'"';
    return 'ShipMonk store "'+n+'"';
  }

  // ---------- live data: Shopify Admin API + Snowball (via automated GitHub Actions sync) ----------
  function applyShopifyLive(data){
    if(!data || !data.daily) return false;
    shopifyMeta = data;
    let matched = 0, sumGross = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      const gross = Math.max(0, parseFloat(r.gross_sales)||0);
      days[idx].channels.shopify = gross;
      days[idx].discounts.shopify = Math.max(0, parseFloat(r.discounts)||0);
      // returns = Shopify Analytics "Returns" (sales reversals) on the refund's processed
      // date: returned items + extra money refunded, pre-tax. Sync v1.5+ reproduces it to
      // the cent; a rare negative day (failed refund transaction) is kept as Shopify shows it.
      days[idx].refunds.shopify = parseFloat(r.returns)||0;
      days[idx].orders.shopify = Math.max(Math.round(parseFloat(r.orders)||0), 0);
      days[idx].shopifyReal = {
        shipping: parseFloat(r.shipping)||0,
        tax: parseFloat(r.tax)||0,
        refundedShipping: parseFloat(r.refunded_shipping)||0,   // Shopify nets these out of "Shipping charges"
        refundedTax: parseFloat(r.refunded_tax)||0,             // ... and out of "Taxes" (sync v1.5+, else 0)
        totalSales: parseFloat(r.total_sales)||0,
        refundedTotal: parseFloat(r.refunded_total)||0,   // cash actually refunded incl. shipping + tax
        // sync v1.7+: Shopify Payments processing fees on the order day (undefined on older days)
        paymentFees: r.payment_fees !== undefined ? (parseFloat(r.payment_fees)||0) : null,
        paymentFeesOrders: Math.round(parseFloat(r.payment_fees_orders)||0),
        feesMissingOrders: Math.round(parseFloat(r.fees_missing_orders)||0),
        gateways: r.gateways || {},
        feeTypes: r.payment_fee_types || {},
      };
      days[idx].snowballReal = {
        orders: Math.round(parseFloat(r.snowball_orders)||0),
        revenue: parseFloat(r.snowball_revenue)||0,
        commission: parseFloat(r.snowball_commission)||0,
        reversals: parseFloat(r.snowball_reversals)||0,
        commissionNet: (parseFloat(r.snowball_commission)||0) - (parseFloat(r.snowball_reversals)||0),
      };
      // sync v1.8+: customer-journey channels of the orders placed that day (null on days synced before v1.8)
      days[idx].shopifyAttr = (r.attribution && typeof r.attribution === 'object') ? r.attribution : null;
      // sync v2.0+: order funnel counters (status as of the sync) + per-SKU units / pre-discount sales / refund units
      if(r.orders_placed !== undefined) (days[idx].funnel = days[idx].funnel||{}).shopify = {placed: Math.round(+r.orders_placed||0), paid: r.orders_paid===undefined ? null : Math.round(+r.orders_paid||0), fulfilled: Math.round(+r.orders_fulfilled||0), partial: Math.round(+r.orders_partially_fulfilled||0), cancelled: Math.round(+r.orders_cancelled||0), refunded: r.orders_refunded===undefined ? null : Math.round(+r.orders_refunded||0)};
      if(r.sku_units && typeof r.sku_units==='object') (days[idx].sku = days[idx].sku||{}).shopify = {units: r.sku_units, sales: r.sku_sales||{}, refunds: r.sku_refund_units||{}};
      if(r.markets && typeof r.markets==='object') (days[idx].markets = days[idx].markets||{}).shopify = r.markets;   // sync v2.1+: per-country split
      matched++; sumGross += gross;
    });
    return matched>0;
  }

  // ---------- live data: Klaviyo (email + SMS) attributed orders per day, campaigns, flows ----------
  function applyKlaviyoRows(data){
    if(!data || !data.daily) return false;
    klaviyoMeta = data;
    let matched = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      const f = k => parseFloat(r[k])||0;
      days[idx].klaviyoReal = {
        storeRevenue: f('store_revenue'), storeOrders: f('store_orders'),          // every Placed Order Klaviyo received (sync v1.1+; = attributed on v1.0 days)
        attributedRevenue: f('attributed_revenue'), attributedOrders: f('attributed_orders'),
        campaignRevenue: f('campaign_revenue'), campaignOrders: f('campaign_orders'),
        flowRevenue: f('flow_revenue'), flowOrders: f('flow_orders'),
        emailRevenue: f('email_revenue'), emailOrders: f('email_orders'),
        smsRevenue: f('sms_revenue'), smsOrders: f('sms_orders'),
        channelSplitKnown: (f('email_orders') + f('sms_orders') + f('push_orders')) > 0 || f('attributed_orders') === 0,   // v1.0 days have the channel columns at 0
      };
      matched++;
    });
    return matched>0;
  }

  function applyKlaviyoInvoiceRows(data){
    if(!data || !data.daily) return false;
    klaviyoInvMeta = data;
    let matched = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      days[idx].klaviyoCost = {cost: parseFloat(r.cost)||0, platform: parseFloat(r.platform)||0, sms: parseFloat(r.sms)||0, upgrades: parseFloat(r.upgrades)||0, flex: parseFloat(r.flex)||0, cycle: r.cycle||null};
      matched++;
    });
    return matched>0;
  }

  // V11.7: closed months = the entered figures. A month still open (status "open") or not entered yet is ESTIMATED:
  //   - Vietnam costs (payroll, office, other, accounting…) = average of the last 6 closed months;
  //   - software (Slash card) and Upwork contractors = actual charges to date ("actual_to_date"), as a daily run-rate;
  //   - a figure written in the open month itself always wins.
  // Replaced automatically once the month is entered without status "open".
  function applyOpexRows(data){
    if(!data || !data.months) return false;
    const months = {};
    Object.keys(data.months).forEach(m=>{ if(/^\d{4}-\d{2}$/.test(m) && data.months[m] && typeof data.months[m]==='object') months[m] = data.months[m]; });
    const entered = Object.keys(months).sort();
    if(!entered.length) return false;
    const isOpen = m => !!months[m] && String(months[m].status||'').toLowerCase()==='open';
    const closed = entered.filter(m=>!isOpen(m));
    opexMeta = {entered, closed, open: entered.filter(isOpen), est:{}, tax_rate: parseFloat(data.tax_rate)||0, note: data.note||'', updated_at: data.updated_at||null};
    const num = v => (v===null || v===undefined || v==='') ? null : (isFinite(parseFloat(v)) ? parseFloat(v) : null);
    const dimOf = m => new Date(Date.UTC(+m.slice(0,4), +m.slice(5,7), 0)).getUTCDate();   // days in that month
    // value of one key in a closed month; payroll is split into Vietnam payroll and Upwork contractors
    const valOf = (m,k) => {
      const r = months[m];
      if(k==='salary_vn'){ const v = num(r.salary_vn); if(v!==null) return v; const s = num(r.salary), u = num(r.upwork); return (s!==null && u!==null) ? s-u : null; }
      return num(r[k]);
    };
    const estimate = m => {
      if(opexMeta.est[m]) return opexMeta.est[m];
      const prev = closed.filter(x=>x<m).slice(-OPEX_AVG_MONTHS);
      const r = months[m] || {};
      if(!prev.length && !months[m]) return null;
      const dim = dimOf(m);
      const atd = (r.actual_to_date && typeof r.actual_to_date==='object') ? r.actual_to_date : {};
      const avg = k => { const xs = prev.map(x=>valOf(x,k)).filter(v=>v!==null); return xs.length ? xs.reduce((s,v)=>s+v,0)/xs.length : null; };
      const e = {month:m, dim, perMonth:{}, basis:{}, actual:{}, avgN: prev.length, avgFrom: prev[0]||null, avgTo: prev[prev.length-1]||null};
      const one = k => {
        const x = num(r[k]);
        if(x!==null){ e.basis[k] = 'entered'; return x; }
        const a = atd[k], amt = a ? num(a.amount) : null;
        if(a && amt!==null && a.from && a.to){
          const d = Math.round((Date.parse(a.to+'T00:00:00Z')-Date.parse(a.from+'T00:00:00Z'))/86400000)+1;
          if(d>0){ e.basis[k] = 'actual'; e.actual[k] = {amount:amt, from:a.from, to:a.to, days:d, source:a.source||''}; return amt/d*dim; }
        }
        const v = avg(k); if(v!==null) e.basis[k] = 'avg'; return v;
      };
      OPEX_GA_KEYS.concat(OPEX_BELOW_KEYS).forEach(k=>{
        if(k==='salary' && num(r.salary)===null){
          const vn = one('salary_vn'), up = one('upwork');
          if(vn!==null || up!==null){ e.perMonth.salary = (vn||0)+(up||0); e.perMonth.salary_vn = vn; e.perMonth.upwork = up; e.basis.salary = 'split'; return; }
        }
        if(k==='income_tax' && num(r.income_tax)===null){ e.perMonth.income_tax = null; return; }   // left to the tax-rate estimate
        e.perMonth[k] = one(k);
      });
      opexMeta.est[m] = e;
      return e;
    };
    let matched = 0;
    days.forEach(d=>{
      const m = d.iso.slice(0,7);
      const dim = dimOf(m);
      // has = a non-zero number (drives the "Nhập tay" tag); given = any number incl. 0 (0 = "no such cost", null/absent = unknown)
      const o = {month:m, from:m, carried:false, est:false, vals:{}, has:{}, given:{}};
      if(months[m] && !isOpen(m)){
        OPEX_GA_KEYS.concat(OPEX_BELOW_KEYS).forEach(k=>{ const v = num(months[m][k]); o.given[k] = v!==null; o.has[k] = v!==null && v!==0; o.vals[k] = (v||0)/dim; });
      } else {
        const e = estimate(m);
        if(!e) return;
        o.est = true;
        OPEX_GA_KEYS.concat(OPEX_BELOW_KEYS).forEach(k=>{ const v = e.perMonth[k]; const g = v!==null && v!==undefined; o.given[k] = g; o.has[k] = g && v!==0; o.vals[k] = (g ? v : 0)/dim; });
      }
      d.opex = o; matched++;
    });
    return matched>0;
  }
  // how an estimated month's figure was made, e.g. "avg of 6 months 04–09/2026" / "Slash actual to 17/10"
  function opexEstText(m, k){
    const e = opexMeta && opexMeta.est && opexMeta.est[m];
    if(!e) return '';
    const mm = x => x.slice(5,7)+'/'+x.slice(0,4);
    const avgT = () => !e.avgN ? '' : e.avgN===1 ? tv('as ','theo ')+mm(e.avgFrom)
      : (e.avgFrom.slice(0,4)===e.avgTo.slice(0,4) ? tv(`avg of ${e.avgN} months ${e.avgFrom.slice(5,7)}–${mm(e.avgTo)}`, `TB ${e.avgN} tháng ${e.avgFrom.slice(5,7)}–${mm(e.avgTo)}`)
                                                    : tv(`avg of ${e.avgN} months ${mm(e.avgFrom)}–${mm(e.avgTo)}`, `TB ${e.avgN} tháng ${mm(e.avgFrom)}–${mm(e.avgTo)}`));
    const actT = (a, src) => (src && a.source ? a.source+' ' : '')+tv('actual to ','thực tế tới ')+a.to.slice(8,10)+'/'+a.to.slice(5,7);
    const one = (kk, src=true) => e.basis[kk]==='avg' ? avgT() : e.basis[kk]==='actual' ? actT(e.actual[kk], src) : e.basis[kk]==='entered' ? tv('entered','đã nhập') : '';
    if(e.basis[k]==='split') return [e.basis.salary_vn ? tv('Vietnam payroll ','lương VN ')+one('salary_vn', false) : '', e.basis.upwork ? 'Upwork '+one('upwork', false) : ''].filter(Boolean).join(' + ');
    return one(k);
  }

  // ---------- last-touch attribution: sums of the daily "attribution" blocks over the selected rows ----------
  function attrAggregate(rows){
    const out = {days: rows.length, attrDays:0, shopifyDays:0, orders:0, pending:0, noJourney:0, last:{}, first:{}, journeys:{}, email:{}};
    rows.forEach(r=>{
      if(r.shopifyReal) out.shopifyDays++;
      const a = r.shopifyAttr;
      if(!a) return;
      out.attrDays++;
      out.orders += a.orders||0; out.pending += a.pending||0; out.noJourney += a.no_journey||0;
      Object.entries(a.last_touch||{}).forEach(([k,v])=>{
        const t = out.last[k] = out.last[k] || {orders:0, sales:0, newC:0, returning:0, paidFirst:0};
        t.orders += v.orders||0; t.sales += v.sales||0; t.newC += v.new||0; t.returning += v.returning||0; t.paidFirst += v.paid_first||0;
      });
      Object.entries(a.first_touch||{}).forEach(([k,v])=>{ const t = out.first[k] = out.first[k] || {orders:0, sales:0}; t.orders += v.orders||0; t.sales += v.sales||0; });
      Object.entries(a.journeys||{}).forEach(([k,v])=>{ const t = out.journeys[k] = out.journeys[k] || {orders:0, sales:0}; t.orders += v.orders||0; t.sales += v.sales||0; });
      Object.entries(a.email_detail||{}).forEach(([k,v])=>{ const t = out.email[k] = out.email[k] || {orders:0, sales:0, medium:v.medium||'email'}; t.orders += v.orders||0; t.sales += v.sales||0; });
    });
    out.classified = sum(Object.values(out.last).map(v=>v.orders));
    out.sales = sum(Object.values(out.last).map(v=>v.sales));
    return out;
  }
  function loopAggregate(rows){
    const ls = rows.filter(r=>r.loopReal).map(r=>r.loopReal);
    return {
      days: ls.length,
      newSubscriptions: sum(ls.map(x=>x.newSubscriptions)),
      newSubscribers: sum(ls.map(x=>x.newSubscribers)),
      checkoutRevenue: sum(ls.map(x=>x.checkoutRevenue)),
      recurringRevenueActual: ls.length && ls.every(x=>x.recurringRevenueActual!=null) ? sum(ls.map(x=>x.recurringRevenueActual)) : null,
    };
  }

  function klaviyoAggregate(rows){
    const ks = rows.filter(r=>r.klaviyoReal).map(r=>r.klaviyoReal);
    const g = k => sum(ks.map(x=>x[k]));
    return {days: ks.length, storeRevenue:g('storeRevenue'), storeOrders:g('storeOrders'), attributedRevenue:g('attributedRevenue'), attributedOrders:g('attributedOrders'),
      campaignRevenue:g('campaignRevenue'), campaignOrders:g('campaignOrders'), flowRevenue:g('flowRevenue'), flowOrders:g('flowOrders'),
      emailRevenue:g('emailRevenue'), emailOrders:g('emailOrders'), smsRevenue:g('smsRevenue'), smsOrders:g('smsOrders'),
      splitKnown: ks.length>0 && ks.every(x=>x.channelSplitKnown), storeKnown: ks.some(x=>x.storeOrders > x.attributedOrders)};
  }

  function renderAttribution(){
    const card = document.getElementById('attrCard');
    const supported = !!(shopifyMatched && shopifyMeta && shopifyMeta.attribution && shopifyMeta.attribution.enabled);
    if(!supported){ card.style.display='none'; return; }
    card.style.display='';
    const rows = currentRows();
    const a = aggregate(rows);
    const t = attrAggregate(rows);
    const kl = klaviyoMatched ? klaviyoAggregate(rows) : null;
    const kpis = document.getElementById('attrKpis');
    const bar = document.getElementById('attrBar');
    const legend = document.getElementById('attrLegend');
    const table = document.getElementById('attrTable');
    const jr = document.getElementById('attrJourneys');
    const ew = document.getElementById('attrEmailWrap');
    const cap = document.getElementById('attrCaption');
    if(!t.attrDays){
      kpis.innerHTML = ''; bar.innerHTML = ''; legend.innerHTML = ''; table.innerHTML = ''; ew.innerHTML = '';
      jr.innerHTML = `<span class="tag gap" style="margin-left:0;"><span class="d"></span>${tv('No journey data yet','Chưa có dữ liệu hành trình')}</span> ${tv('The days in this period were synced before Shopify sync v1.8 — run a backfill (2025-01-01 → 2025-06-30, 2025-07-01 → 2025-12-31, 2026-01-01 → today) to get channel attribution for the whole history.','Các ngày trong kỳ này được đồng bộ trước bản Shopify v1.8 — chạy backfill (2025-01-01 → 2025-06-30, 2025-07-01 → 2025-12-31, 2026-01-01 → nay) để có phân kênh cho toàn bộ lịch sử.')}`;
      cap.textContent = '';
      return;
    }
    const chans = Object.keys(t.last).sort((x,y)=> t.last[y].sales - t.last[x].sales);
    const paidSales = sum(chans.filter(k=>ATTR_PAID[k]).map(k=>t.last[k].sales));
    const paidOrders = sum(chans.filter(k=>ATTR_PAID[k]).map(k=>t.last[k].orders));
    const klv = (t.last.email||{orders:0,sales:0}); const sms = (t.last.sms||{orders:0,sales:0});
    const own = ['email','sms','email_other','organic_search','direct','referral','ai_search','social_other','meta_organic','meta_shop','tiktok_organic','tiktok_shop','shop_app','other_channel','snowball','other_utm'];
    const ownSales = sum(chans.filter(k=>own.includes(k)).map(k=>t.last[k].sales));
    const shopOrders = a.orders.shopify;
    const cov = t.attrDays<t.shopifyDays ? ` · ${t.attrDays}/${t.shopifyDays} ${tv('days with journeys','ngày có hành trình')}` : '';
    kpis.innerHTML = `
      <div class="be-stat"><div class="l">${tv('Orders attributed','Đơn đã phân kênh')}</div><div class="v">${intFmt(t.classified)}<span style="font-size:12px;color:var(--ink-muted);font-weight:500;"> / ${intFmt(shopOrders)} ${tx('u.orders')}</span></div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${t.pending ? intFmt(t.pending)+tv(' Shopify orders not attributed yet (new orders)',' đơn Shopify chưa attribute (đơn mới)') : tv('every order in the period has a journey','mọi đơn trong kỳ đã có hành trình')}${cov}</div></div>
      <div class="be-stat"><div class="l">${tv('Last touch = paid ads','Chạm cuối = quảng cáo trả tiền')}</div><div class="v">${pct1(paidSales, t.sales)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${intFmt(paidOrders)} ${tx('u.orders')} · ${money(paidSales)} ${tx('u.netRevLc')}</div></div>
      <div class="be-stat"><div class="l">${tv('Last touch = Email + SMS (Klaviyo)','Chạm cuối = Email + SMS (Klaviyo)')}</div><div class="v">${pct1(klv.sales+sms.sales, t.sales)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${intFmt(klv.orders+sms.orders)} ${tx('u.orders')} · ${money(klv.sales+sms.sales)}${klv.paidFirst||sms.paidFirst ? ' · '+intFmt((klv.paidFirst||0)+(sms.paidFirst||0))+tv(' orders opened by ads',' đơn mở bằng quảng cáo') : ''}</div></div>
      <div class="be-stat"><div class="l">${tv('Unpaid channels (organic, direct, email…)','Kênh không trả tiền (organic, direct, email…)')}</div><div class="v">${pct1(ownSales, t.sales)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${money(ownSales)} · ${tv('including email/SMS in the next column','gồm cả email/SMS ở cột bên')}</div></div>`;
    // 100% bar of net sales by last-touch channel (label the segments >= 7%, everything is in the legend + table)
    bar.innerHTML = chans.map(k=>{
      const c = ATTR_BY_KEY[k] || {color:'var(--gridline)'}; const w = t.sales>0 ? 100*t.last[k].sales/t.sales : 0;
      const lbl = w>=7 ? `<span style="color:${c.ink||'var(--ink-primary)'};">${ATTR_LABEL(k).split(' (')[0]} ${w.toFixed(0)}%</span>` : '';
      return `<div class="sg" style="width:${w.toFixed(2)}%;background:${c.color};" title="${ATTR_LABEL(k)} — ${money(t.last[k].sales)} (${w.toFixed(1)}%)">${lbl}</div>`;
    }).join('');
    legend.innerHTML = chans.map(k=>{ const c = ATTR_BY_KEY[k]||{color:'var(--gridline)'}; return `<div class="li"><span class="sw" style="background:${c.color};margin-right:0;"></span>${ATTR_LABEL(k)} <span style="color:var(--ink-muted);font-family:var(--font-mono);">${pct1(t.last[k].sales, t.sales)}</span></div>`; }).join('');
    // channel cost + what the platform itself claims for the same period
    const costOf = {meta: a.ads.meta, google: a.ads.google, tiktokads: a.ads.tiktokads, applovin: a.ads.applovin, snowball: a.snowballCommission, klaviyo: a.klaviyoCostDays>0 ? a.klaviyoCost : null};
    const claimOf = {
      meta_paid: metaMatched && a.metaAdsRealDays>0 ? {orders: a.metaAdsPurchases, sales: a.adsAttr.meta, who:'Meta'} : null,
      google_ads: googleMatched && a.googleAdsRealDays>0 ? {orders: a.googleAdsPurchases, sales: a.adsAttr.google, who:'Google'} : null,
      email: kl && kl.days>0 ? {orders: kl.splitKnown ? kl.emailOrders : kl.attributedOrders, sales: kl.splitKnown ? kl.emailRevenue : kl.attributedRevenue, who: kl.splitKnown ? 'Klaviyo' : 'Klaviyo (email+SMS)'} : null,
      sms: kl && kl.days>0 && kl.splitKnown ? {orders: kl.smsOrders, sales: kl.smsRevenue, who:'Klaviyo'} : null,
    };
    let html = `<thead><tr><th>${tv('Channel (last touch)','Kênh (điểm chạm cuối)')}</th><th style="text-align:right">${tv('Orders','Đơn')}</th><th style="text-align:right">${tv('% of orders','% đơn')}</th><th style="text-align:right">${tv('Net revenue','Doanh thu thuần')}</th><th style="text-align:right">${tv('% of revenue','% DT')}</th><th style="text-align:right">AOV</th><th style="text-align:right">${tv('New customers','Khách mới')}</th><th style="text-align:right">${tv('Opened by paid ads','Mở bằng QC trả tiền')}</th><th style="text-align:right">${tv('Channel cost','Chi phí kênh')}</th><th style="text-align:right">${tv('Revenue ÷ cost (last-touch)','DT ÷ chi (last-touch)')}</th><th style="text-align:right">${tv('Platform self-reported','Nền tảng tự nhận')}</th></tr></thead><tbody>`;
    chans.forEach(k=>{
      const v = t.last[k]; const c = ATTR_BY_KEY[k] || {};
      const costKey = c.cost; const cost = costKey ? costOf[costKey] : null;
      const costTxt = cost===null || cost===undefined ? '<span style="color:var(--ink-muted)">—</span>' : (cost>0 ? money(cost) : '<span class="tag gap" style="margin-left:0;"><span class="d"></span>'+tv('$0 not connected','$0 chưa nối')+'</span>');
      const roasTxt = cost>0 ? (v.sales/cost).toFixed(2)+'x' : '<span style="color:var(--ink-muted)">—</span>';
      const cl = claimOf[k];
      const claimTxt = cl ? `${intFmt(cl.orders)} ${tx('u.orders')} · ${money(cl.sales)}` : '<span style="color:var(--ink-muted)">—</span>';
      html += `<tr><td class="name"><span class="sw" style="background:${c.color||'var(--gridline)'};"></span>${ATTR_LABEL(k)}</td><td class="num">${intFmt(v.orders)}</td><td class="num">${pct1(v.orders, t.classified)}</td><td class="num">${money(v.sales)}</td><td class="num">${pct1(v.sales, t.sales)}</td><td class="num">${v.orders>0 ? money(v.sales/v.orders) : '—'}</td><td class="num">${v.newC+v.returning>0 ? pct0(v.newC, v.newC+v.returning) : '—'}</td><td class="num">${v.orders>0 ? pct0(v.paidFirst, v.orders) : '—'}</td><td class="num">${costTxt}</td><td class="num">${roasTxt}</td><td class="num sub" style="text-align:right;">${claimTxt}</td></tr>`;
    });
    html += `<tr style="font-weight:700;"><td class="name">${tv('Total attributed','Tổng đã phân kênh')}</td><td class="num">${intFmt(t.classified)}</td><td class="num">100%</td><td class="num">${money(t.sales)}</td><td class="num">100%</td><td class="num">${t.classified>0 ? money(t.sales/t.classified) : '—'}</td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td></tr></tbody>`;
    table.innerHTML = html;
    // cross-channel journeys: first session != last session
    const jkeys = Object.keys(t.journeys).filter(k=>{ const [f,l] = k.split('>'); return f!==l && !['direct','unknown'].includes(f); }).sort((x,y)=>t.journeys[y].orders - t.journeys[x].orders).slice(0,6);
    const firstPaidOrders = sum(Object.keys(t.first).filter(k=>ATTR_PAID[k]).map(k=>t.first[k].orders));
    let jhtml = `<b>${tv('Cross-channel journeys','Hành trình đổi kênh')}</b> ${tv('(first visit → last touch)','(lượt ghé đầu → chạm cuối)')}: ${jkeys.length ? jkeys.map(k=>{ const [f,l] = k.split('>'); const v = t.journeys[k]; return `${ATTR_LABEL(f).split(' (')[0]} → <b>${ATTR_LABEL(l).split(' (')[0]}</b> ${intFmt(v.orders)} ${tx('u.orders')} (${money(v.sales)})`; }).join(' · ') : tv('none','không có')}.`;
    jhtml += tv(` Of ${intFmt(t.classified)} orders, <b>${pct0(firstPaidOrders, t.classified)}</b> had their first visit from paid ads.`, ` Trong ${intFmt(t.classified)} đơn, <b>${pct0(firstPaidOrders, t.classified)}</b> có lượt ghé đầu từ quảng cáo trả tiền.`);
    const m2e = t.journeys['meta_paid>email'] || t.journeys['meta_paid>sms'] ? (t.journeys['meta_paid>email']||{orders:0,sales:0}).orders + (t.journeys['meta_paid>sms']||{orders:0,sales:0}).orders : 0;
    if(m2e) jhtml += tv(` <b>Meta opened → email/SMS closed: ${intFmt(m2e)} orders</b> — Meta claims them, Klaviyo claims them too; this table counts them for email/SMS only.`, ` <b>Meta mở → email/SMS chốt: ${intFmt(m2e)} đơn</b> — Meta cũng nhận, Klaviyo cũng nhận; ở bảng này chỉ tính cho email/SMS.`);
    jr.innerHTML = jhtml;
    // Klaviyo campaign / flow names behind the email + sms last-touch orders
    const enames = Object.keys(t.email).sort((x,y)=>t.email[y].sales - t.email[x].sales);
    if(enames.length){
      const top = enames.slice(0, 12); const rest = enames.slice(12);
      let eh = `<div class="subhead">${tv('Email / SMS last touch by campaign or flow (name in the Klaviyo utm_campaign)','Email / SMS chạm cuối theo campaign hoặc flow (tên trong utm_campaign của Klaviyo)')}</div><div style="overflow-x:auto;"><table class="simple" style="min-width:640px;"><thead><tr><th>Campaign / flow message</th><th>${tx('f.channel')}</th><th style="text-align:right">${tv('Orders','Đơn')}</th><th style="text-align:right">${tv('Net revenue','Doanh thu thuần')}</th><th style="text-align:right">AOV</th></tr></thead><tbody>`;
      top.forEach(nm=>{ const v = t.email[nm]; eh += `<tr><td class="name">${nm.replace(/</g,'&lt;')}</td><td>${v.medium==='sms'?'SMS':'Email'}</td><td class="num">${intFmt(v.orders)}</td><td class="num">${money(v.sales)}</td><td class="num">${money(v.sales/v.orders)}</td></tr>`; });
      if(rest.length){ const ro = sum(rest.map(n=>t.email[n].orders)), rs = sum(rest.map(n=>t.email[n].sales)); eh += `<tr><td class="name" style="color:var(--ink-muted);">+ ${rest.length} ${tv('more names','tên khác')}</td><td></td><td class="num">${intFmt(ro)}</td><td class="num">${money(rs)}</td><td class="num">${ro>0?money(rs/ro):'—'}</td></tr>`; }
      eh += '</tbody></table></div>';
      ew.innerHTML = eh;
    } else ew.innerHTML = '';
    const basis = (shopifyMeta.attribution && shopifyMeta.attribution.basis) || '';
    cap.innerHTML = tv(`Source: <code>Order.customerJourneySummary</code> from the Shopify Admin API (sync v1.8) — the same "last non-direct click" model Shopify uses for its <i>Sales attributed to marketing</i> report. An order whose last visit is direct / a return from Shop Pay, PayPal, Amazon Pay takes the previous non-direct visit. Revenue = net sales (after discounts, before refunds) by order date — the same figure as the Shopify line in the P&amp;L, so the percentages add up to 100%. "Platform self-reported" = what Meta / Google / Klaviyo report for the same period under their own attribution windows (7-day click for Meta, 5 days for Klaviyo…), so they can add up to more than 100% — for comparison only, never added to revenue. Google Ads sends no UTM (the gclid auto-tag is hidden by Shopify), so from sync v1.9 a visit from Google landing on an ads-only page (<code>/pages/cats-love-it-2025</code>, product pages ending in <code>-gg</code>) counts as Google Ads; orders with no web session (bought inside Facebook/Instagram Shop, the Shop app…) go by sales channel. Orders from the first 1–3 hours have no journey from Shopify yet (counted under "not attributed") and update on the next sync.`, `Nguồn: <code>Order.customerJourneySummary</code> của Shopify Admin API (sync v1.8) — cùng mô hình "last non-direct click" mà Shopify dùng cho báo cáo <i>Sales attributed to marketing</i>. Đơn có lượt cuối là direct / quay về từ Shop Pay, PayPal, Amazon Pay thì lấy lượt ghé trước đó không phải direct. Doanh thu = net sales (sau giảm giá, trước hoàn) ghi theo ngày đặt — cùng số với dòng Shopify trong P&amp;L, nên các % cộng đúng 100%. "Nền tảng tự nhận" = con số Meta / Google / Klaviyo tự báo cho cùng kỳ theo cửa sổ attribution riêng của họ (7 ngày click Meta, 5 ngày Klaviyo…) nên có thể cộng vượt 100% — dùng để so, không cộng vào doanh thu. Google Ads không gửi UTM (auto-tagging gclid bị Shopify ẩn) nên từ sync v1.9 lượt ghé từ Google đáp xuống trang đích chỉ dùng cho quảng cáo (<code>/pages/cats-love-it-2025</code>, trang sản phẩm đuôi <code>-gg</code>) được tính là Google Ads; đơn không có phiên web nào (mua ngay trong Facebook/Instagram Shop, Shop app…) tính theo kênh bán. Đơn mới trong 1–3 giờ đầu chưa được Shopify gắn hành trình (đếm ở "chưa attribute") và tự cập nhật ở lần đồng bộ sau.`);
  }

  // ---------- Klaviyo card: its own attribution next to the last-touch view, campaigns of the period, flows ----------
  function renderLoopSubscriptions(){
    const card = document.getElementById('loopCard');
    if(!loopMatched || !loopMeta){ card.style.display='none'; return; }
    card.style.display='';
    const rows = currentRows();
    const l = loopAggregate(rows);
    const mrr = loopMeta.mrr_estimate || {};
    const note = document.getElementById('loopNote');
    note.textContent = tv('Loop Admin API + Shopify order feed, by America/Los_Angeles day · ','Loop Admin API + Shopify order feed, theo ngày America/Los_Angeles · ') + fmtAmazonAge(loopMeta.generated_at) + (l.days<rows.length ? tv(` · ${nDays(rows.length-l.days)} in the period ${rows.length-l.days===1?'has':'have'} no Loop data yet`, ` · ${rows.length-l.days} ngày trong kỳ chưa có dữ liệu Loop`) : '');
    const kp = document.getElementById('loopKpis');
    const rrReal = l.recurringRevenueActual;
    const rrTile = rrReal!=null
      ? `<div class="be-stat"><div class="l">Recurring revenue (${tx('u.selPeriod')})</div><div class="v">${money(rrReal)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${mrr.weekly_run_rate!=null ? tv('current run-rate ~','run-rate hiện tại ~')+money(mrr.weekly_run_rate)+tv('/week','/tuần') : ''}${mrr.active_subscriptions!=null ? ' · '+intFmt(mrr.active_subscriptions)+tv(' active subs',' sub active') : ''}</div></div>`
      : `<div class="be-stat"><div class="l">${tv('Recurring revenue — current estimate','Recurring revenue — ước tính hiện tại')}</div><div class="v">${mrr.weekly_run_rate!=null ? money(mrr.weekly_run_rate)+tv('/week','/tuần') : '—'}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${mrr.active_subscriptions!=null ? intFmt(mrr.active_subscriptions)+tv(' active subscriptions · ',' subscription đang active · ') : ''}${tv('no actuals for this period yet — a run-rate estimate, NOT what was actually charged','chưa có số thật cho kỳ này — ước tính run-rate, KHÔNG phải số đã charge thật')}</div></div>`;
    kp.innerHTML = `
      <div class="be-stat"><div class="l">${tv('New subscriptions','Subscription mới')} (${tx('u.selPeriod')})</div><div class="v">${intFmt(l.newSubscriptions)}</div></div>
      <div class="be-stat"><div class="l">${tv('First-time subscribers','Khách đăng ký lần đầu')}</div><div class="v">${intFmt(l.newSubscribers)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${pct0(l.newSubscribers, l.newSubscriptions)} ${tv('of new subscriptions are brand-new customers','subscription mới là khách hoàn toàn mới')}</div></div>
      <div class="be-stat"><div class="l">Checkout revenue (${tv('first order, selected period','đơn đầu, kỳ đang xem')})</div><div class="v">${money(l.checkoutRevenue)}</div></div>
      ${rrTile}`;
    document.getElementById('loopCaption').innerHTML = tv(`Source: Loop Admin API (new subscriptions / new subscribers / checkout revenue) + Shopify order feed (recurring revenue). "New subscriptions" and "Checkout revenue" count subscriptions created (<code>createdAt</code>) in the selected period; "First-time subscribers" = customers with <code>allSubscriptionsCount == 1</code> (never had a subscription before). "Recurring revenue" = the ACTUAL amount charged in the period — every time Loop re-charges a subscription it creates a real Shopify order (tag <code>Subscription Recurring Order</code>, app <code>Loop Subscriptions</code>); summing those orders by creation date gives this figure, reconciled to the cent with the "Recurring revenue" Loop shows on its own Home dashboard. The small line below is the current run-rate (price per cycle ÷ cycle length, over every active subscription) — it does not change with the selected period, for comparison only.`, `Nguồn: Loop Admin API (subscription mới/khách mới/checkout revenue) + Shopify order feed (recurring revenue). "Subscription mới" và "Checkout revenue" tính theo subscription có ngày tạo (<code>createdAt</code>) trong kỳ đang xem; "Khách đăng ký lần đầu" = khách có <code>allSubscriptionsCount == 1</code> (chưa từng có subscription nào trước đó). "Recurring revenue" = SỐ THẬT đã charge trong kỳ — mỗi lần Loop charge lại một subscription, Loop tạo 1 đơn Shopify thật (tag <code>Subscription Recurring Order</code>, app <code>Loop Subscriptions</code>); cộng đúng các đơn đó theo ngày tạo ra số này, đã đối chiếu khớp tới từng cent với "Recurring revenue" Loop tự hiển thị trên Home dashboard của họ. Dòng nhỏ bên dưới là run-rate hiện tại (giá mỗi chu kỳ ÷ độ dài chu kỳ, cộng mọi subscription đang active) — không đổi khi bạn đổi kỳ xem, chỉ để so sánh.`);
  }

  function renderKlaviyo(){
    const card = document.getElementById('klaviyoCard');
    if(!klaviyoMatched || !klaviyoMeta){ card.style.display='none'; return; }
    card.style.display='';
    const rows = currentRows();
    const a = aggregate(rows);
    const k = klaviyoAggregate(rows);
    const t = attrAggregate(rows);
    const meta = klaviyoMeta.meta || {};
    const note = document.getElementById('klaviyoNote');
    note.textContent = tv('Klaviyo\'s own attribution (default 5 days after an email click/open, 1 day for SMS) · overlaps with ad attribution, so it is not added to P&L revenue · ','Attribution riêng của Klaviyo (mặc định 5 ngày sau khi bấm/mở email, 1 ngày với SMS) · trùng với attribution của quảng cáo nên không cộng vào doanh thu P&L · ') + fmtAmazonAge(klaviyoMeta.generated_at) + (k.days<a.n ? tv(` · ${nDays(a.n-k.days)} in the period ${a.n-k.days===1?'has':'have'} no Klaviyo data yet`, ` · ${a.n-k.days} ngày trong kỳ chưa có dữ liệu Klaviyo`) : '');
    const kp = document.getElementById('klaviyoKpis');
    const cost = a.klaviyoCostDays>0 ? a.klaviyoCost : null;
    const lt = (t.last.email||{orders:0,sales:0}); const ls = (t.last.sms||{orders:0,sales:0});
    const ltOrders = lt.orders + ls.orders, ltSales = lt.sales + ls.sales;
    const shopNet = a.netRevenue;
    kp.innerHTML = `
      <div class="be-stat"><div class="l">${tv('Klaviyo self-reported (attributed)','Klaviyo tự nhận (attributed)')}</div><div class="v">${money(k.attributedRevenue)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${intFmt(k.attributedOrders)} ${tx('u.orders')} · flow ${pct0(k.flowRevenue, k.attributedRevenue)} / campaign ${pct0(k.campaignRevenue, k.attributedRevenue)}${k.splitKnown && k.smsOrders>0 ? ' · SMS '+intFmt(k.smsOrders)+' '+tx('u.orders') : ''}</div></div>
      <div class="be-stat"><div class="l">${tv('Last touch = email/SMS (Shopify)','Điểm chạm cuối = email/SMS (Shopify)')}</div><div class="v">${t.attrDays ? money(ltSales) : '—'}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${t.attrDays ? intFmt(ltOrders)+' '+tx('u.orders')+' · '+pct1(ltSales, shopNet)+tv(' of Shopify net revenue',' doanh thu thuần Shopify') : tv('no journeys for this period yet (backfill v1.8)','chưa có hành trình cho kỳ này (backfill v1.8)')}</div></div>
      <div class="be-stat"><div class="l">${tv('Klaviyo-attributed orders / all orders','Tỷ lệ đơn Klaviyo nhận / tổng đơn')}</div><div class="v">${k.storeKnown ? pct1(k.attributedOrders, k.storeOrders) : pct1(k.attributedOrders, a.orders.shopify)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${k.storeKnown ? intFmt(k.storeOrders)+tv(' orders Klaviyo received from Shopify',' đơn Klaviyo nhận từ Shopify') : tv('of ','trên ')+intFmt(a.orders.shopify)+tv(' Shopify orders (Klaviyo\'s total available from sync v1.1)',' đơn Shopify (tổng của Klaviyo có từ sync v1.1)')}</div></div>
      <div class="be-stat"><div class="l">${tv('Klaviyo cost (invoices) &amp; ROI','Chi phí Klaviyo (hoá đơn) &amp; ROI')}</div><div class="v">${cost!==null ? money(cost) : '<span class="tag gap" style="margin-left:0;font-size:11px;"><span class="d"></span>'+tv('no invoices yet','chưa có hoá đơn')+'</span>'}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${cost!==null && cost>0 ? (t.attrDays ? tv('last-touch revenue ÷ cost = <b>','DT last-touch ÷ chi = <b>')+(ltSales/cost).toFixed(1)+'x</b> · ' : '')+tv('Klaviyo self-reported ÷ cost = ','Klaviyo tự nhận ÷ chi = ')+(k.attributedRevenue/cost).toFixed(1)+'x' + (a.klaviyoCostParts.upgrades||a.klaviyoCostParts.flex ? tv(' · incl. plan upgrades ',' · gồm nâng gói ')+money(a.klaviyoCostParts.upgrades)+(a.klaviyoCostParts.flex?tv(' + email overage ',' + vượt email ')+money(a.klaviyoCostParts.flex):'') : '') : tv('ROI = email/SMS revenue ÷ Klaviyo fees for the period','ROI = doanh thu email/SMS ÷ phí Klaviyo theo kỳ')}</div></div>`;
    const cmp = document.getElementById('klaviyoCompare');
    if(t.attrDays && k.days){
      const diff = k.attributedOrders - ltOrders;
      cmp.innerHTML = tv(`<b>Two counts for the same period:</b> Klaviyo claims <b>${intFmt(k.attributedOrders)} orders</b> (placed within ${meta.attribution && /5-day/.test(meta.attribution) ? '5 days' : 'the attribution window'} after the customer clicked/opened an email) vs <b>${intFmt(ltOrders)} orders</b> whose last touch is email/SMS according to Shopify. ${diff>0 ? `The ${intFmt(diff)}-order gap = customers who opened/clicked an email but whose last touch before buying was another channel (usually Meta ads) or direct — Meta claims those orders too.` : diff<0 ? `Shopify sees ${intFmt(-diff)} more email orders than Klaviyo (email links without Klaviyo UTMs or outside Klaviyo's attribution window).` : 'The two counts match.'} Klaviyo's order value is the order total (incl. shipping + tax), so it is not directly comparable with net revenue.`, `<b>Hai cách đếm cùng kỳ:</b> Klaviyo tự nhận <b>${intFmt(k.attributedOrders)} đơn</b> (đơn đặt trong ${meta.attribution && /5-day/.test(meta.attribution) ? '5 ngày' : 'cửa sổ attribution'} sau khi khách bấm/mở email) so với <b>${intFmt(ltOrders)} đơn</b> có email/SMS là điểm chạm cuối theo Shopify. ${diff>0 ? `Chênh ${intFmt(diff)} đơn = khách có mở/bấm email nhưng cú chạm cuối trước khi mua là kênh khác (thường là quảng cáo Meta) hoặc vào thẳng — Meta cũng đang nhận những đơn đó.` : diff<0 ? `Shopify thấy nhiều đơn email hơn Klaviyo ${intFmt(-diff)} đơn (link email không có UTM Klaviyo hoặc ngoài cửa sổ attribution của Klaviyo).` : 'Hai cách đếm trùng nhau.'} Giá trị đơn của Klaviyo là tổng đơn (gồm ship + thuế) nên không so tiền trực tiếp với doanh thu thuần.`);
    } else cmp.innerHTML = '';
    // campaigns sent inside the selected period (local send date)
    const keys = new Set(rows.map(r=>r.iso));
    const camps = Object.entries(klaviyoMeta.campaigns||{}).map(([id,c])=>({id, ...c})).filter(c=>c.send_time && keys.has(c.send_time.slice(0,10))).sort((x,y)=> (y.send_time||'').localeCompare(x.send_time||''));
    const ct = document.getElementById('klaviyoCampaignTable');
    document.getElementById('klaviyoCampaignHead').textContent = tv(`Campaigns sent in the period (${camps.length})`, `Campaign gửi trong kỳ (${camps.length})`);
    if(camps.length){
      let h = `<thead><tr><th>Campaign</th><th>${tx('f.channel')}</th><th>${tv('Sent','Gửi')}</th><th style="text-align:right">${tv('Recipients','Người nhận')}</th><th style="text-align:right">${tv('Opens','Mở')}</th><th style="text-align:right">Click</th><th style="text-align:right">${tv('Orders (Klaviyo)','Đơn (Klaviyo)')}</th><th style="text-align:right">${tx('u.attrRev')}</th><th style="text-align:right">${tv('$/recipient','$/người nhận')}</th><th style="text-align:right">${tv('Unsubscribes','Huỷ đăng ký')}</th></tr></thead><tbody>`;
      camps.forEach(c=>{ h += `<tr><td class="name">${(c.name||c.id).replace(/</g,'&lt;')}</td><td>${c.channel==='sms'?'SMS':'Email'}</td><td>${c.send_time.slice(8,10)}/${c.send_time.slice(5,7)}</td><td class="num">${intFmt(c.recipients||0)}</td><td class="num">${c.open_rate!=null ? (100*c.open_rate).toFixed(1)+'%' : '—'}</td><td class="num">${c.click_rate!=null ? (100*c.click_rate).toFixed(2)+'%' : '—'}</td><td class="num">${intFmt(c.conversions||0)}</td><td class="num">${money(c.conversion_value||0)}</td><td class="num">${c.recipients>0 ? '$'+((c.conversion_value||0)/c.recipients).toFixed(3) : '—'}</td><td class="num">${intFmt(c.unsubscribes||0)}</td></tr>`; });
      const tc = {r: sum(camps.map(c=>c.recipients||0)), o: sum(camps.map(c=>c.conversions||0)), v: sum(camps.map(c=>c.conversion_value||0)), u: sum(camps.map(c=>c.unsubscribes||0))};
      h += `<tr style="font-weight:700;"><td class="name">${tx('u.total')}</td><td></td><td></td><td class="num">${intFmt(tc.r)}</td><td></td><td></td><td class="num">${intFmt(tc.o)}</td><td class="num">${money(tc.v)}</td><td class="num">${tc.r>0 ? '$'+(tc.v/tc.r).toFixed(3) : '—'}</td><td class="num">${intFmt(tc.u)}</td></tr></tbody>`;
      ct.innerHTML = h;
    } else ct.innerHTML = `<tbody><tr><td class="name" style="color:var(--ink-muted);">${tv('No campaign was sent in the selected period.','Không có campaign nào gửi trong kỳ đang xem.')}</td></tr></tbody>`;
    // flows: values over the sync window (Klaviyo reports flows per window, not per day)
    const flows = Object.entries(klaviyoMeta.flows||{}).map(([id,f])=>({id, ...f})).sort((x,y)=>(y.conversion_value||0)-(x.conversion_value||0));
    const win = (flows[0] && flows[0].window) || (klaviyoMeta.window) || null;
    const winTxt = win && win.start ? ` ${win.start.slice(8,10)}/${win.start.slice(5,7)} → ${win.end.slice(8,10)}/${win.end.slice(5,7)}` : '';
    document.getElementById('klaviyoFlowHead').textContent = tv(`Automated flows (${flows.length}) — figures for the sync window${winTxt}, not the selected period`, `Flow tự động (${flows.length}) — số của cửa sổ đồng bộ${winTxt}, không theo kỳ đang chọn`);
    const ft = document.getElementById('klaviyoFlowTable');
    if(flows.length){
      let h = `<thead><tr><th>Flow</th><th>${tx('f.channel')}</th><th>${tx('u.status')}</th><th style="text-align:right">${tv('Messages sent','Tin gửi')}</th><th style="text-align:right">${tv('Opens','Mở')}</th><th style="text-align:right">Click</th><th style="text-align:right">${tv('Orders (Klaviyo)','Đơn (Klaviyo)')}</th><th style="text-align:right">${tx('u.attrRev')}</th><th style="text-align:right">${tv('$/message','$/tin')}</th></tr></thead><tbody>`;
      flows.slice(0, 15).forEach(f=>{ h += `<tr><td class="name">${(f.name||f.id).replace(/</g,'&lt;')}</td><td>${f.channel==='sms'?'SMS':'Email'}</td><td>${f.status||''}</td><td class="num">${intFmt(f.recipients||0)}</td><td class="num">${f.open_rate!=null ? (100*f.open_rate).toFixed(1)+'%' : '—'}</td><td class="num">${f.click_rate!=null ? (100*f.click_rate).toFixed(2)+'%' : '—'}</td><td class="num">${intFmt(f.conversions||0)}</td><td class="num">${money(f.conversion_value||0)}</td><td class="num">${f.recipients>0 ? '$'+((f.conversion_value||0)/f.recipients).toFixed(2) : '—'}</td></tr>`; });
      if(flows.length>15){ const rest = flows.slice(15); h += `<tr><td class="name" style="color:var(--ink-muted);">+ ${rest.length} ${tv('more flows','flow khác')}</td><td></td><td></td><td class="num">${intFmt(sum(rest.map(f=>f.recipients||0)))}</td><td></td><td></td><td class="num">${intFmt(sum(rest.map(f=>f.conversions||0)))}</td><td class="num">${money(sum(rest.map(f=>f.conversion_value||0)))}</td><td></td></tr>`; }
      h += '</tbody>';
      ft.innerHTML = h;
    } else ft.innerHTML = '';
    document.getElementById('klaviyoCaption').innerHTML = tv(`Source: Klaviyo API (metric "${(meta.conversion_metric||{}).label||'Placed Order'}", Query Metric Aggregates by LA-time day; Campaign/Flow Values Reports). "Orders (Klaviyo)" and "Attributed revenue" are Klaviyo's attribution — they overlap with Meta/Google attribution and with the Shopify figures themselves, so they are <b>not added to revenue</b>; the email channel's real revenue is in the "Channels by last touch" table above. Opens/Click are unique rates over messages delivered.`, `Nguồn: Klaviyo API (metric "${(meta.conversion_metric||{}).label||'Placed Order'}", Query Metric Aggregates theo ngày giờ LA; Campaign/Flow Values Reports). "Đơn (Klaviyo)" và "DT quy về" là attribution của Klaviyo — trùng với attribution của Meta/Google và với chính số Shopify, nên <b>không cộng vào doanh thu</b>; doanh thu thật của kênh email nằm ở bảng "Kênh theo điểm chạm cuối" phía trên. Mở/Click là tỷ lệ unique trên số đã gửi thành công.`);
  }

  // ---------- Meta Ads: product / campaign breakdown for the selected period ----------
  function renderMetaCampaigns(){
    const card = document.getElementById('metaCampaignCard');
    const camps = (META_ADS_LIVE_DATA && META_ADS_LIVE_DATA.campaigns) || null;
    if(!metaMatched || !camps || !Object.keys(camps).length){ card.style.display='none'; return; }
    card.style.display = '';
    const isoSet = new Set(currentRows().map(r=>r.iso));
    const F = ['spend','impressions','reach','link_clicks','add_to_cart','initiate_checkout','purchases','purchase_value'];
    const zero = ()=> { const o={}; F.forEach(f=>o[f]=0); return o; };
    const derive = o => {
      o.cpm = o.impressions ? o.spend/o.impressions*1000 : 0;
      o.ctr = o.impressions ? o.link_clicks/o.impressions*100 : 0;
      o.cpa = o.purchases ? o.spend/o.purchases : 0;
      o.roas = o.spend ? o.purchase_value/o.spend : 0;
      o.aov = o.purchases ? o.purchase_value/o.purchases : 0;
      o.freq = o.reach ? o.impressions/o.reach : 0;
      return o;
    };
    const rows = [];
    Object.keys(camps).forEach(id=>{
      const c = camps[id]; const agg = zero(); let days = 0;
      Object.keys(c.daily||{}).forEach(iso=>{ if(!isoSet.has(iso)) return; const d=c.daily[iso]; F.forEach(f=>agg[f]+= (parseFloat(d[f])||0)); days++; });
      if(days===0 || agg.spend<=0) return;
      rows.push({id, name:c.name, product:c.product||tx('u.other'), market:c.market||'', stage:c.stage||'', status:c.status||'', budget:c.daily_budget, ...derive(agg)});
    });
    if(!rows.length){ card.style.display='none'; return; }
    const products = {};
    rows.forEach(r=>{ const p = products[r.product] = products[r.product] || {...zero(), n:0}; F.forEach(f=>p[f]+=r[f]); p.n++; });
    Object.values(products).forEach(derive);
    const totalSpend = rows.reduce((s,r)=>s+r.spend,0);
    const fmtN = v => Math.round(v).toLocaleString('en-US');
    const warnCls = r => (r.roas && r.roas<META_ROAS_WARN) || (r.cpa && r.cpa>META_CPA_WARN) ? 'style="color:var(--status-critical);font-weight:600;"' : '';
    const stagePill = s => s && s!=='Other' ? `<span class="pill ${s==='Scaling'?'ok':'warn'}" style="font-weight:500;margin-left:4px;">${s}</span>` : '';
    const statusDot = st => `<span class="dot ${st==='ACTIVE'?'g':'w'}" style="display:inline-block;margin-right:6px;vertical-align:middle;" title="${st}"></span>`;
    let html = `<thead><tr><th>${tx('u.product2')}</th><th style="text-align:right">${tx('u.spend')}</th><th style="text-align:right">${tx('u.spendPct')}</th><th style="text-align:right">${tv('Attributed orders','Đơn quy về')}</th><th style="text-align:right">CPA</th><th style="text-align:right">${tx('u.attrRev')}</th><th style="text-align:right">ROAS</th><th style="text-align:right">AOV</th><th style="text-align:right">CTR</th><th style="text-align:right">CPM</th><th style="text-align:right">Freq≈</th></tr></thead><tbody>`;
    const cell = (r, bold) => `<td class="num" ${bold?'style="font-weight:700;color:var(--ink-primary);"':''}>${money(r.spend)}</td><td class="num">${totalSpend? (r.spend/totalSpend*100).toFixed(0):0}%</td><td class="num">${fmtN(r.purchases)}</td><td class="num" ${warnCls(r)}>${r.cpa?money(r.cpa):'—'}</td><td class="num">${money(r.purchase_value)}</td><td class="num" ${warnCls(r)}>${r.roas.toFixed(2)}x</td><td class="num">${r.aov?money(r.aov):'—'}</td><td class="num">${r.ctr.toFixed(2)}%</td><td class="num">${money(r.cpm)}</td><td class="num">${r.freq?r.freq.toFixed(2):'—'}</td>`;
    Object.keys(products).sort((a,b)=>products[b].spend-products[a].spend).forEach(p=>{
      const pr = products[p];
      html += `<tr style="background:var(--surface-card-2);"><td class="name" style="font-weight:700;">${p} <span style="color:var(--ink-muted);font-weight:400;font-size:11px;">· ${pr.n} campaign</span></td>${cell(pr,true)}</tr>`;
      rows.filter(r=>r.product===p).sort((a,b)=>b.spend-a.spend).forEach(r=>{
        html += `<tr><td class="name" style="font-weight:400;padding-left:22px;font-size:12px;">${statusDot(r.status)}${r.name}${r.market&&r.market!=='US'?` <span class="pill" style="background:var(--surface-card-3);color:var(--ink-secondary);font-weight:500;">${r.market}</span>`:''}${stagePill(r.stage)}</td>${cell(r,false)}</tr>`;
      });
    });
    const all = zero(); rows.forEach(r=>F.forEach(f=>all[f]+=r[f])); derive(all);
    html += `<tr style="border-top:1.5px solid var(--baseline);"><td class="name" style="font-weight:700;">${tv(`Total Meta (${rows.length} campaigns with spend)`, `Tổng Meta (${rows.length} campaign có chi)`)}</td>${cell(all,true)}</tr></tbody>`;
    document.getElementById('metaCampaignTable').innerHTML = html;
    document.getElementById('metaCampaignNote').textContent = 'Marketing API · attribution '+(META_ADS_LIVE_DATA.attribution||'account default')+' · '+fmtAmazonAge(META_ADS_LIVE_DATA.generated_at)+tv(' · green dot = running, amber = paused',' · chấm xanh = đang chạy, vàng = tạm dừng');
  }

  function renderShipmonk(){
    const card = document.getElementById('shipmonkCard');
    if(!card) return;
    const sel = currentRows().filter(r=>r.shipmonkReal);
    const invSel = currentRows().filter(r=>r.shipmonkInv);
    if((!shipmonkMatched || !sel.length) && !invSel.length){ card.style.display='none'; return; }
    card.style.display = '';
    const S = f => sum(sel.map(f));
    const orders = S(r=>r.shipmonkReal.orders), units = S(r=>r.shipmonkReal.units), packages = S(r=>r.shipmonkReal.packages);
    const ship = S(r=>r.shipmonkReal.shipping), pick = S(r=>r.shipmonkReal.pickPack), pack = S(r=>r.shipmonkReal.packaging), missing = S(r=>r.shipmonkReal.missing);
    const total = ship + pick + pack;
    const n = currentRows().length, outside = n - sel.length;
    const line = (label, v, opts) => `<tr><td class="name" ${opts&&opts.bold?'style="font-weight:700;"':''}>${label}</td><td class="num" ${opts&&opts.bold?'style="font-weight:700;color:var(--ink-primary);"':''}>${typeof v==='number' ? money(v) : v}</td><td class="num">${opts&&opts.per!==undefined ? (orders? money(opts.per/orders) : '—') : ''}</td></tr>`;
    const hdrRows = sel.length ? sel : invSel;
    let html = `<thead><tr><th>${tv('Item','Khoản')}</th><th style="text-align:right">${hdrRows.length===1 ? fmtDateLong(hdrRows[0].date) : hdrRows.length+' '+tx('u.days')}</th><th style="text-align:right">/ ${tx('u.order')}</th></tr></thead><tbody>`;
    if(!sel.length) html += line(tv('Per-order estimate (ShipMonk API) — no data for this range yet (waiting for a backfill)','Ước tính theo từng đơn (API ShipMonk) — chưa có dữ liệu cho khoảng này (chờ backfill)'), '—');
    const orderBasis = shipmonkOrderBasis();
    if(sel.length){
    const shippedN = S(r=>r.shipmonkReal.shipped), unshippedN = S(r=>r.shipmonkReal.unshipped), onholdN = S(r=>r.shipmonkReal.onhold||0);
    html += line(orderBasis ? tv('Orders received by ShipMonk (by order date)','Đơn ShipMonk nhận (theo ngày đặt hàng)') : tv('Orders shipped','Đơn đã ship'), orders.toLocaleString('en-US'));
    if(orderBasis) html += line(tv('… of which shipped · not yet shipped (ShipMonk estimate)','… trong đó đã ship · chưa ship (ước tính ShipMonk)') + (onholdN ? tv(' · On Hold in ShipMonk',' · đang On Hold trong ShipMonk') : ''), shippedN.toLocaleString('en-US')+' · '+unshippedN.toLocaleString('en-US') + (onholdN ? ' · '+onholdN.toLocaleString('en-US') : ''));
    html += line(tv('Units · packages','Units · kiện'), units.toLocaleString('en-US')+' · '+packages.toLocaleString('en-US'));
    html += line(tv('Shipping (postage / carrier)','Cước vận chuyển (postage / carrier)'), ship, {per: ship});
    html += line(tv('Pick & pack (fulfillment labor)','Pick & pack (nhân công fulfillment)'), pick, {per: pick});
    html += line(tv('Packaging materials','Vật liệu đóng gói (packaging)'), pack, {per: pack});
    html += line(tv('= Total ShipMonk fulfillment cost','= Tổng chi phí fulfillment ShipMonk'), total, {bold:true, per: total});
    if(missing) html += line(tv('ShipMonk orders without a cost estimate yet ($0 for now)','Đơn ShipMonk chưa có ước tính chi phí (tạm $0)'), missing.toLocaleString('en-US'));
    // charges ShipMonk states in another currency (Toronto warehouse bills in CAD): shown native, already converted above
    const foreign = {}; sel.forEach(r=>{ Object.entries(r.shipmonkReal.foreign||{}).forEach(([cur,v])=>{ foreign[cur] = (foreign[cur]||0) + (parseFloat(v)||0); }); });
    const fxRates = (shipmonkMeta && shipmonkMeta.meta && shipmonkMeta.meta.fx && shipmonkMeta.meta.fx.rates_to_usd) || {};
    Object.entries(foreign).forEach(([cur,v])=>{ if(v) html += line(tv('… of which ShipMonk charges billed in ','… trong đó phí ShipMonk ghi bằng ')+cur+tv(' (Toronto warehouse), converted @ ',' (kho Toronto), đã quy đổi @ ')+(fxRates[cur]!==undefined ? fxRates[cur] : '?')+' USD/'+cur, v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+cur); });
    // ship-date view of the same range, for checking against ShipMonk's weekly invoices
    if(orderBasis && shipmonkMeta && shipmonkMeta.daily_shipped){
      const ds = shipmonkMeta.daily_shipped; let shipTotal = 0, shipOrders = 0;
      sel.forEach(r=>{ const b = ds[r.iso]; if(b){ shipTotal += parseFloat(b.total_cost)||0; shipOrders += Math.round(parseFloat(b.orders)||0); } });
      html += line(tv('Cross-check — same range but by ship date (','Đối chiếu — cùng khoảng nhưng theo ngày ship (')+shipOrders.toLocaleString('en-US')+tv(' orders, matches the weekly ShipMonk invoices)',' đơn, khớp hoá đơn tuần ShipMonk)'), shipTotal);
    }
    }
    // invoices overlapping the range: what ShipMonk actually billed on top of the per-order estimates
    if(invSel.length){
      const I = k => sum(invSel.map(r=>r.shipmonkInv[k]||0));
      const invNums = [...new Set(invSel.map(r=>r.shipmonkInv.invoice))];
      const invList = (shipmonkInvMeta.invoices||[]).filter(i=>invNums.includes(i.number));
      const per = n => fmtDateLong(new Date(n.slice(0,4), n.slice(5,7)-1, n.slice(8,10)));
      html += `<tr><td class="name" colspan="3" style="font-weight:700;padding-top:14px;">${tv('ShipMonk invoices in the range','Hoá đơn ShipMonk trong khoảng')} (${invSel.length}/${currentRows().length} ${tv('days with an invoice','ngày có hoá đơn')})</td></tr>`;
      invList.forEach(i=>{ html += line(tv('Invoice ','Hoá đơn ')+i.number+tv(' · period ',' · kỳ ')+per(i.start)+' – '+per(i.end)+' · '+(i.orders_invoiced||0).toLocaleString('en-US')+' '+tx('u.orders'), i.total); });
      html += line(tv('Shipping + pick & pack per invoice (days within the range)','Cước + pick & pack theo hoá đơn (phần ngày trong khoảng)'), I('shipping'));
      html += line(tv('Storage (pallet & bin)','Lưu kho (pallet & bin)'), I('storage'));
      html += line(tv('Receiving of inbound goods','Receiving hàng nhập'), I('receiving'));
      html += line(tv('Returns handling','Xử lý hàng trả'), I('returns'));
      html += line(tv('Custom packaging purchases','Mua bao bì riêng (custom packaging)')+(invSel.some(r=> r.shipmonkReal && r.shipmonkReal.packagingItems) ? tv(' — memo: boxes are expensed per package (FIFO) on days with ShipMonk packaging data',' — ghi nhớ: hộp tính theo kiện (FIFO) ở ngày có dữ liệu hộp ShipMonk') : ''), I('packaging_purchases'));
      html += line(tv('Other fees (minimums, late penalties, audits, surcharges, unclassified)','Phí khác (phí tối thiểu, phạt trễ, audit, phụ phí, chưa phân loại)'), I('fees_other') + I('unallocated'));
      html += line(tv('Shipping adjustments & credits','Điều chỉnh cước & credit'), I('adjustments') + I('credits'));
      html += line(tv('= Total per invoices (days within the range)','= Tổng theo hoá đơn (phần ngày trong khoảng)'), I('total'), {bold:true});
      const cur = shipmonkInvMeta.meta && shipmonkInvMeta.meta.current_period;
      if(cur && currentRows().some(r=>r.iso>=cur.start && r.iso<=cur.end)) html += line(tv('Period ','Kỳ ')+per(cur.start)+' – '+per(cur.end)+tv(' not yet invoiced by ShipMonk → per-order estimates only',' ShipMonk chưa chốt hoá đơn → chỉ có ước tính theo đơn'), '—');
    }
    html += '</tbody>';
    document.getElementById('shipmonkTable').innerHTML = html;
    // breakdown by store / order type / carrier
    const agg = key => { const o = {}; sel.forEach(r=>{ const b = r.shipmonkReal[key]||{}; Object.keys(b).forEach(k=>{ const t = o[k] = o[k] || {orders:0,total:0}; t.orders += b[k].orders||0; t.total += (b[k].total_cost!==undefined ? b[k].total_cost : b[k].shipping_cost)||0; }); }); return Object.entries(o).sort((a,b)=>b[1].total-a[1].total); };
    const pills = (title, rows, fmt) => rows.length ? `<div style="font-size:12px;color:var(--ink-secondary);margin-top:6px;"><b>${title}:</b> ${rows.slice(0,6).map(([k,v])=>`${k==='unknown' ? tv('no carrier assigned','chưa gán carrier') : k} ${money(v.total)} (${v.orders.toLocaleString('en-US')} ${tx('u.orders')})`).join(' · ')}</div>` : '';
    document.getElementById('shipmonkBreakdown').innerHTML = sel.length ? (pills(tv('By store','Theo store'), agg('byStore')) + pills(tv('By order type','Theo loại đơn'), agg('byType')) + pills(tv('Shipping by carrier','Cước theo carrier'), agg('byCarrier'))) : '';
    const note = document.querySelector('#shipmonkCard .note');
    if(note && SHIPMONK_LIVE_DATA) note.textContent = tv('ShipMonk\'s estimate for each order (carrier postage + pick & pack + packaging materials) · ','Ước tính của ShipMonk cho từng đơn (cước carrier + pick & pack + vật liệu đóng gói) · ') + (orderBasis ? tv('booked by order date (LA time), including orders not yet shipped — same day as the revenue','ghi theo ngày đặt hàng (giờ LA), gồm cả đơn chưa ship — cùng ngày với doanh thu') : tv('booked by ship date, LA time','ghi theo ngày ship, giờ LA')) + (outside ? tv(` · ${nDays(outside)} in the range ${outside===1?'is':'are'} outside the sync window`, ` · ${outside} ngày trong khoảng ngoài cửa sổ đồng bộ`) : '') + ' · ' + fmtAmazonAge(SHIPMONK_LIVE_DATA.generated_at);
    const cap = document.getElementById('shipmonkCaption');
    const csv = shipmonkMeta && shipmonkMeta.meta && shipmonkMeta.meta.orders_csv;
    // V10: the caption is rebuilt whole in the active language (same text as the static HTML + the per-order CSV link + the invoice sentence once invoices are in)
    if(cap){
      let link = '';
      if(csv){
        const isDir = String(csv).endsWith('/');
        const csvPath = String(csv).startsWith('data/') ? csv : 'data/' + String(csv).replace(/\/$/, '').split('/').pop() + (isDir ? '/' : '');   // the sync commits it next to shipmonk.json
        const href = 'https://github.com/taitran-star/ctu-fin-sync-8x2k/' + (isDir ? 'tree' : 'blob') + '/main/' + csvPath.replace(/\/$/, '');
        const label = isDir ? csvPath.replace(/\/$/, '').split('/').pop() + tv('/ (one CSV file per month)','/ (một file CSV mỗi tháng)') : csvPath.split('/').pop();
        link = tv(' Details <b>per order</b> (Shopify / Amazon order number, order date, ship date, postage, pick & pack, packaging): ',' Chi tiết <b>từng đơn</b> (số đơn Shopify / Amazon, ngày đặt, ngày ship, cước, pick & pack, packaging): ')+'<a href="'+href+'" target="_blank" rel="noopener">'+label+'</a>'+tv(' — updated together with the figures above.',' — cập nhật cùng lúc với số trên.');
      }
      cap.innerHTML = tv('Figures from the ShipMonk API (<code>order_costs</code>: estimated shipping / pick &amp; pack / packaging) for every order ShipMonk receives — Shopify and Amazon FBM stores alike. Orders not yet shipped use ShipMonk\'s estimate and are refreshed every 30 minutes once shipped. ShipMonk\'s weekly invoices may differ slightly (postage adjustments, surcharges). ','Số lấy từ ShipMonk API (<code>order_costs</code>: estimated shipping / pick &amp; pack / packaging) cho mọi đơn ShipMonk nhận — store Shopify lẫn Amazon FBM. Đơn chưa ship dùng ước tính của ShipMonk và được cập nhật lại mỗi 30 phút khi ship. Hoá đơn tuần của ShipMonk có thể lệch nhỏ (điều chỉnh cước, surcharge). ')
        + (shipmonkInvMatched
          ? tv('<b>ShipMonk invoices</b> (Billing → Invoices, 2 periods/month) are read in on top: storage, receiving, returns, packaging bought through ShipMonk, other fees, adjustments/credits — spread evenly over the days of the invoice period; postage + pick & pack on the invoice are only used to cross-check and true up the per-order estimate.','<b>Hoá đơn ShipMonk</b> (Billing → Invoices, 2 kỳ/tháng) được đọc thêm vào: lưu kho, receiving, hàng trả, bao bì mua qua ShipMonk, phí khác, điều chỉnh/credit — chia đều theo ngày trong kỳ hoá đơn; cước + pick & pack trên hoá đơn chỉ dùng để đối chiếu và bù chênh lệch với ước tính theo đơn.')
          : tv('<b>Not included:</b> storage, receiving, returns handling and the items that only appear on invoices — added once the invoice file is in.','<b>Chưa gồm</b> phí lưu kho, receiving, xử lý hàng trả và các khoản chỉ có trên hoá đơn — sẽ thêm khi có file hoá đơn.'))
        + link;
    }
  }

  function renderShopifyRecon(){
    const card = document.getElementById('shopifyReconCard');
    if(!card) return;
    const sel = currentRows().filter(r=>r.shopifyReal);
    if(!shopifyMatched || !sel.length){ card.style.display='none'; return; }
    card.style.display = '';
    const S = f => sum(sel.map(f));
    const orders = S(r=>r.orders.shopify), gross = S(r=>r.channels.shopify), disc = S(r=>r.discounts.shopify), ret = S(r=>r.refunds.shopify);
    const ship = S(r=>r.shopifyReal.shipping - r.shopifyReal.refundedShipping), tax = S(r=>r.shopifyReal.tax - r.shopifyReal.refundedTax);
    const refShip = S(r=>r.shopifyReal.refundedShipping), refTax = S(r=>r.shopifyReal.refundedTax);
    const net = gross - disc - ret;
    const total = net + ship + tax;
    const n = currentRows().length, missing = n - sel.length;
    // sync v1.5+ (schema 2) reproduces Shopify's returns / refunded ship & tax exactly; older data only approximates
    const exact = !!(shopifyMeta && shopifyMeta.meta && (shopifyMeta.meta.schema||1) >= 2);
    const line = (label, v, opts) => `<tr><td class="name" ${opts&&opts.bold?'style="font-weight:700;"':''}>${label}</td><td class="num" ${opts&&opts.bold?'style="font-weight:700;color:var(--ink-primary);"':''}>${typeof v==='number' ? money(v) : v}</td></tr>`;
    let html = `<thead><tr><th>${tv('Metric (named as in Shopify Analytics)','Chỉ số (tên như trong Shopify Analytics)')}</th><th style="text-align:right">${sel.length===1 ? fmtDateLong(sel[0].date) : sel.length+' '+tx('u.days')}</th></tr></thead><tbody>`;
    html += line(tv('Orders — order count (each order once, test orders and unpaid cancellations excluded)','Orders — số đơn (mỗi đơn đếm 1 lần, đã loại đơn test và đơn huỷ chưa thu tiền)'), orders.toLocaleString('en-US'));
    html += line(tv('Gross sales — list price × quantity, before discounts','Gross sales — giá niêm yết × số lượng, trước giảm giá'), gross);
    html += line(tv('− Discounts — discount codes + automatic promotions','− Discounts — mã giảm giá + khuyến mãi tự động'), -disc);
    html += line(exact
      ? tv('− Returns — returned goods + extra refunds (refund discrepancy), before tax, on the day Shopify processed the refund','− Returns — hàng trả + tiền hoàn thêm (refund discrepancy), trước thuế, theo ngày Shopify xử lý hoàn')
      : tv('− Returns — value of returned goods (by refund date; old sync, extra refunds not included)','− Returns — giá trị hàng trả (theo ngày hoàn tiền; sync cũ, chưa gồm tiền hoàn thêm)'), -ret);
    html += line(tv('= Net sales (= the Shopify part of "Net revenue" on the dashboard)','= Net sales (= "Doanh thu thuần" phần Shopify trên dashboard)'), net, {bold:true});
    html += line(tv('+ Shipping charges — shipping paid by customers','+ Shipping charges — phí ship khách trả') + (refShip ? tv(` (net of ${money(refShip)} shipping refunded)`, ` (đã trừ ${money(refShip)} ship hoàn lại)`) : ''), ship);
    html += line(tv('+ Taxes — tax collected','+ Taxes — thuế thu hộ') + (refTax ? tv(` (net of ${money(refTax)} tax refunded)`, ` (đã trừ ${money(refTax)} thuế hoàn lại)`) : ''), tax);
    html += line(exact
      ? tv('= Total sales — Shopify\'s exact formula: net sales + shipping charges + taxes (duties / additional fees = 0)','= Total sales — đúng công thức Shopify: net sales + shipping charges + taxes (duties / additional fees = 0)')
      : tv('≈ Total sales — Shopify Analytics also subtracts shipping/tax refunded to customers (old sync)','≈ Total sales — Shopify Analytics còn trừ thêm phần ship/thuế hoàn lại cho khách (sync cũ)'), total, {bold:true});
    html += '</tbody>';
    document.getElementById('shopifyReconTable').innerHTML = html;
    const note = document.querySelector('#shopifyReconCard .note');
    const vis = shopifyMeta && shopifyMeta.meta && shopifyMeta.meta.orders_visibility;
    const visNote = vis && vis!=='all' ? ' · '+bicon('warn','bi-inline')+tv('the app lacks the read_all_orders scope: refunds on orders older than 60 days are invisible, Returns will be lower than Shopify','app chưa có quyền read_all_orders: hoàn tiền trên đơn cũ hơn 60 ngày không nhìn thấy, Returns sẽ thấp hơn Shopify') : '';
    if(note) note.textContent = tv('Same definitions as Shopify\'s "Sales over time" report · days in store time (LA)','Cùng định nghĩa với báo cáo "Sales over time" của Shopify · ngày theo giờ cửa hàng (LA)') + (missing ? tv(` · ${nDays(missing)} in the range ${missing===1?'has':'have'} no synced data yet`, ` · ${missing} ngày trong khoảng chưa có dữ liệu đồng bộ`) : '') + visNote + ' · ' + fmtAmazonAge(SHOPIFY_LIVE_DATA.generated_at);
  }

  function renderSnowball(){
    const card = document.getElementById('snowballCard');
    if(!shopifyMatched || !shopifyMeta || !shopifyMeta.snowball){ card.style.display='none'; return; }
    card.style.display = '';
    const sb = shopifyMeta.snowball;
    const wt = sb.window_totals || {};
    const programs = sb.programs || {};
    const affiliates = sb.affiliates || {};
    const warnings = (shopifyMeta.meta && Array.isArray(shopifyMeta.meta.warnings)) ? shopifyMeta.meta.warnings : [];
    const baseLabel = {subtotal:tv('item value after discounts (excl. shipping/tax)','giá trị hàng sau giảm giá (chưa ship/thuế)'), subtotal_shipping:tv('item value + shipping','giá trị hàng + ship'), subtotal_tax:tv('item value + tax','giá trị hàng + thuế'), total:tv('order total (incl. shipping + tax — per Snowball\'s Revenue Calculation setting)','tổng đơn (gồm ship + thuế — đúng cài đặt Revenue Calculation của Snowball)')}[sb.commission_base] || sb.commission_base;
    let html = '<div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;color:var(--ink-secondary);">';
    html += `<div><span class="tag live"><span class="d"></span>Live</span> ${tv('Window','Cửa sổ')} ${shopifyMeta.window ? shopifyMeta.window.start+' → '+shopifyMeta.window.end : shopifyMeta.window_days+' '+tx('u.days')}: <b>${(wt.orders||0).toLocaleString('en-US')} ${tv('referral orders','đơn referral')}</b>, ${tv('attributed revenue','doanh thu quy về')} ${money(wt.revenue||0)}, ${tv('commission','hoa hồng')} <b>${money(wt.commission_net||0)}</b> (${tv('net of','đã trừ')} ${money(wt.reversals||0)} ${tv('refunds','hoàn tiền')}). ${tv('Basis','Cơ sở tính')}: ${baseLabel}.</div>`;
    const progKeys = Object.keys(programs).sort((x,y)=>(programs[y].commission_net||0)-(programs[x].commission_net||0));
    if(progKeys.length){
      html += `<div class="caption" style="padding-left:0;margin:4px 0 0;">${tv('By program (Shopify tag "Referral - SS - …") · % from ','Theo chương trình (tag Shopify "Referral - SS - …") · % lấy từ ')}${tv('the workflow config / program name','cấu hình workflow / tên program')}:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${progKeys.map(k=>{
          const p = programs[k]; const src = (sb.rate_sources||{})[k];
          const cls = src==='default' ? 'warn' : 'ok';
          return `<span class="pill ${cls}" style="font-weight:500;">${k}: ${(p.rate*100).toFixed(p.rate*100%1?1:0)}% · ${p.orders} ${tx('u.orders')} · ${money(p.commission_net||0)}${src==='inferred_from_name'?tv(' · % inferred from the name',' · % đoán từ tên'):''}${src==='default'?tv(' · NO % SET',' · CHƯA CÓ %'):''}</span>`;
        }).join('')}</div>`;
    }
    const affKeys = Object.keys(affiliates).slice(0, 12);
    if(affKeys.length){
      html += `<div class="caption" style="padding-left:0;margin:4px 0 0;">${tv('Top influencers/affiliates by commission (code in the __snowball order attribute):','Top influencer/affiliate theo hoa hồng (mã trong thuộc tính đơn __snowball):')}</div>
        <div style="overflow-x:auto;"><table class="simple" style="min-width:420px;"><thead><tr><th>Affiliate</th><th>Program</th><th style="text-align:right">${tv('Orders','Đơn')}</th><th style="text-align:right">${tv('Revenue','Doanh thu')}</th><th style="text-align:right">${tv('Commission','Hoa hồng')}</th></tr></thead><tbody>${affKeys.map(k=>{
          const a = affiliates[k];
          return `<tr><td>${k}</td><td>${a.program||''}</td><td style="text-align:right">${a.orders}</td><td style="text-align:right">${money(a.revenue||0)}</td><td style="text-align:right">${money(a.commission_net||0)}</td></tr>`;
        }).join('')}</tbody></table></div>`;
    }
    html += `<div><span class="tag info"><span class="d"></span>${tv('Note','Lưu ý')}</span> ${tv('This is commission <i>accrued</i> per order. Actual payouts via Tremendous/PayPal may differ in timing and exclude product gifts or flat fees agreed outside Snowball. Reconcile monthly with Payouts → Export in Snowball.','Đây là hoa hồng <i>phát sinh</i> theo đơn (accrual). Khoản trả thật (payout) qua Tremendous/PayPal có thể lệch thời điểm và không gồm quà tặng sản phẩm hay flat fee thoả thuận riêng ngoài Snowball. Đối soát theo tháng với Payouts → Export trong Snowball.')}</div>`;
    if(warnings.length){
      html += `<div class="caption" style="padding-left:0;margin:6px 0 4px;">${tv('Warnings from the latest sync:','Cảnh báo từ lần đồng bộ gần nhất:')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${warnings.map(w=>`<span class="pill warn">${w}</span>`).join('')}</div>`;
    }
    html += '</div>';
    document.getElementById('snowballBody').innerHTML = html;
  }

  // ---------- live data: Amazon SP-API Finances (via automated GitHub Actions sync) ----------
  function applyAmazonRows(data){
    if(!data || !data.daily) return false;
    amazonMeta = data.meta || null;
    let matched = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso];
      // Script schema 3 adds ordered_* = the All Orders report by ORDER date (what Seller
      // Central / Sellerboard show). Revenue, promotions and order counts use that basis when
      // present; fees and refunds always come from Finances (posted/ship date).
      const orderBasis = typeof r.ordered_sales === 'number';
      let gross, promo, ordersN;
      if(orderBasis){
        // Product sales only (item-price), the exact figure Seller Central "Sales" / Sellerboard show;
        // shipping charged to the customer is left out, same as the Shopify channel on this page.
        gross = (r.ordered_sales||0);
        promo = (r.ordered_promotions||0);
        ordersN = Math.round(r.ordered_orders||0);
        amazonOrderBasisDays++;
      } else {
        // giftwrap_credits exists from script schema 2 on (customer-paid gift wrap = revenue).
        gross = (r.gross_sales||0) + (r.shipping_credits||0) + (r.giftwrap_credits||0);
        promo = -(r.promotions||0);
        ordersN = Math.round(r.orders||0);
      }
      // refunds is signed: negative = money back to customers. Negate (not abs) so a day
      // where return-shipping/restocking kept by the seller outweighs refunds nets correctly.
      const refund = -(r.refunds||0);
      days[idx].channels.amazon = gross;
      days[idx].discounts.amazon = promo;
      days[idx].refunds.amazon = refund;
      days[idx].orders.amazon = Math.max(ordersN, 0);
      // Fees are signed in the JSON (negative = cost, positive = fee refunded back). Negate
      // rather than abs() so a refund-heavy day reduces the cost instead of inflating it.
      // Script schema 4: the same ItemFeeList fees booked on the ORDER day (management P&L =
      // revenue and fees of an order on the same day). Fees Amazon returns on refunds stay on the
      // refund day; the monthly FBA storage fee is allocated to the month stored (see below).
      const feeBasisOrdered = typeof r.ordered_referral_fees === 'number';
      const refundFeeAdj = feeBasisOrdered ? (r.refund_fee_adjustments||0) : 0;
      const storagePosted = feeBasisOrdered ? (r.fba_storage_posted||0) : 0;
      const monthKey = iso.slice(0,7);
      const storageMonthly = (data.monthly_storage_fees||{})[monthKey];
      const dim = new Date(parseInt(iso.slice(0,4),10), parseInt(iso.slice(5,7),10), 0).getDate();
      if(feeBasisOrdered) amazonFeeBasisOrderedDays++;
      days[idx].amazonReal = {
        fbaFees: feeBasisOrdered ? -(r.ordered_fba_fulfillment_fees||0) : -(r.fba_fulfillment_fees||0),
        referralFees: feeBasisOrdered ? -(r.ordered_referral_fees||0) : -(r.referral_fees||0),
        feeBasisOrdered,
        refundFeeAdj,                                   // positive = fee Amazon gave back with a refund (reduces cost)
        // Subscription + FBA removal/returns fees (schema 4: the monthly storage lump is taken out and
        // re-spread below). Reads 0 when the Finances API returns no ServiceFee events in the window.
        serviceFees: -((r.service_fees||0) - storagePosted),
        storagePosted: -storagePosted,                  // cash-day amount of the monthly storage fee (info)
        storageAlloc: typeof storageMonthly === 'number' ? -storageMonthly / dim : 0,   // month stored, spread per day
        storageKnown: typeof storageMonthly === 'number',
        // Script 2.2+: freight + import duty + placement fees for moving inventory INTO FBA.
        // Landed cost of inventory (COGS), billed by Amazon in lumps on the invoice date.
        inboundFreight: -(r.inbound_freight||0),
        // Script schema 2: sales-tax collection fee, shipping chargeback/holdback, refund
        // administration fee, return-label postage - real per-order costs, split out from the catch-all.
        otherFees: (feeBasisOrdered ? -(r.ordered_other_fees||0) : -(r.other_fees||0)) - refundFeeAdj,
        // catch-all, kept signed: reimbursements, reserve movements, liquidation revenue and
        // anything the script could not map - folded into marketplace fees so no dollar is dropped.
        otherNet: (r.unclassified_other||0) + (r.adjustments||0),
        orderBasis,
        postedGross: (r.gross_sales||0) + (r.shipping_credits||0) + (r.giftwrap_credits||0),
        pendingUnits: r.ordered_pending_units||0,
        mcfUnits: r.mcf_units||0,
        mcfOrders: r.mcf_orders||0,
        orderedUnits: r.ordered_units||0,
        refEst: 0, fbaEst: 0, feeEstimated: false, pendKnown: false, pendUnits: 0,
      };
      // Script 2.7 (schema 5): the sync prices every order line Amazon has not posted fees for yet with
      // that SKU's own posted FBA fee / referral rate -> exact expected fees, no ratio guess needed.
      if(typeof r.ordered_referral_fees_pending === 'number' && feeBasisOrdered){
        const ar = days[idx].amazonReal;
        ar.pendKnown = true;
        ar.refEst = -(r.ordered_referral_fees_pending||0);
        ar.fbaEst = -(r.ordered_fba_fulfillment_fees_pending||0);
        ar.pendUnits = r.ordered_units_pending_fees||0;
        ar.referralFees += ar.refEst; ar.fbaFees += ar.fbaEst;
        ar.feeEstimated = (ar.refEst + ar.fbaEst) > 0.005;
      }
      // NOTE: r.ad_spend is a known gap too (Sponsored Products spend needs the separate
      // Amazon Advertising API, not covered by SP-API) - intentionally NOT overwriting the
      // ads.amazonads estimate with this yet, since the real value would misleadingly read 0.
      // sync v2.8+: order funnel counters (All Orders report status) + per-SKU units / item-price sales / refund units
      if(r.orders_placed !== undefined) (days[idx].funnel = days[idx].funnel||{}).amazon = {placed: Math.round(+r.orders_placed||0), paid: r.orders_paid===undefined ? null : Math.round(+r.orders_paid||0), fulfilled: Math.round(+r.orders_fulfilled||0), partial: Math.round(+r.orders_partially_fulfilled||0), cancelled: Math.round(+r.orders_cancelled||0), refunded: r.orders_refunded===undefined ? null : Math.round(+r.orders_refunded||0)};
      if(r.sku_units && typeof r.sku_units==='object') (days[idx].sku = days[idx].sku||{}).amazon = {units: r.sku_units, sales: r.sku_sales||{}, refunds: r.sku_refund_units||{}};
      if(r.markets && typeof r.markets==='object') (days[idx].markets = days[idx].markets||{}).amazon = r.markets;   // sync v2.9+: per-marketplace split
      matched++;
    });
    estimateUnpostedAmazonFees(data);
    return matched>0;
  }
  // Order-day fees only exist once Amazon posts the shipment (Finances), so the newest days show
  // referral/FBA fees far below what their orders will cost - the same gap Sellerboard fills with
  // "estimated" fees. Rates come from settled days (15-60 days back); a recent day whose posted
  // fees are below 97% of the expected amount is topped up to the expectation and flagged.
  function estimateUnpostedAmazonFees(data){
    const withFees = days.filter(d=>d.amazonReal && d.amazonReal.feeBasisOrdered && d.amazonReal.orderBasis);
    if(!withFees.length) return;
    const lastIso = withFees[withFees.length-1].iso;
    const dayMs = 86400000, lastT = Date.parse(lastIso+'T00:00:00Z');
    const settled = withFees.filter(d=>{ const age = (lastT - Date.parse(d.iso+'T00:00:00Z'))/dayMs; return age > AMZ_FEE_EST_SETTLE_DAYS && age <= AMZ_FEE_EST_SETTLE_DAYS+60 && d.channels.amazon>0; });
    if(settled.length < 7) return;
    const sGross = settled.reduce((s,d)=>s+d.channels.amazon,0), sRef = settled.reduce((s,d)=>s+d.amazonReal.referralFees,0);
    const sUnits = settled.reduce((s,d)=>s+d.amazonReal.orderedUnits,0), sFba = settled.reduce((s,d)=>s+d.amazonReal.fbaFees,0);
    const refRate = sGross>0 ? sRef/sGross : 0, fbaPerUnit = sUnits>0 ? sFba/sUnits : 0;
    if(refRate<=0 || fbaPerUnit<=0) return;
    amazonFeeEstRates = {refRate, fbaPerUnit, settledDays: settled.length};
    withFees.forEach(d=>{
      const age = (lastT - Date.parse(d.iso+'T00:00:00Z'))/dayMs;
      if(age > AMZ_FEE_EST_WINDOW_DAYS) return;
      const a = d.amazonReal;
      if(a.pendKnown) return;   // the sync already priced the unposted lines per SKU
      const expRef = d.channels.amazon*refRate, expFba = a.orderedUnits*fbaPerUnit;
      if(a.referralFees < expRef*0.97){ a.refEst = expRef - a.referralFees; a.referralFees = expRef; a.feeEstimated = true; }
      if(a.fbaFees < expFba*0.97){ a.fbaEst = expFba - a.fbaFees; a.fbaFees = expFba; a.feeEstimated = true; }
    });
  }
  // ---------- live data: Meta Ads Marketing API (via automated GitHub Actions sync) ----------
  function applyMetaAdsRows(data){
    if(!data || !data.daily) return false;
    let matched = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      const spend = Math.max(0, parseFloat(r.spend)||0);
      const value = Math.max(0, parseFloat(r.purchase_value)||0);
      days[idx].ads.meta = spend;          // what Meta charged that day
      days[idx].adsAttr.meta = value;      // purchase value Meta attributes to ads (account attribution window)
      days[idx].metaReal = {
        purchases: Math.round(parseFloat(r.purchases)||0),
        impressions: Math.round(parseFloat(r.impressions)||0),
        clicks: Math.round(parseFloat(r.clicks)||0),
      };
      matched++;
    });
    return matched>0;
  }
  // ---------- live data: AppLovin advertiser spend per day (GitHub Actions sync, data/applovin.json) ----------
  function applyApplovinRows(data){
    if(!data || !data.daily) return false;
    let matched = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      days[idx].ads.applovin = Math.max(0, parseFloat(r.spend)||0);
      days[idx].adsAttr.applovin = Math.max(0, parseFloat(r.sales)||0);   // revenue AppLovin attributes to its ads (platform-reported)
      days[idx].applovinReal = {conversions: parseFloat(r.conversions)||0, impressions: Math.round(parseFloat(r.impressions)||0), clicks: Math.round(parseFloat(r.clicks)||0)};
      matched++;
    });
    return matched>0;
  }

  // ---------- live data: TikTok Ads (GMV Max + other ads) per day (GitHub Actions sync, data/tiktok_ads.json) ----------
  function applyTiktokAdsRows(data){
    if(!data || !data.daily) return false;
    let matched = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      days[idx].ads.tiktokads = Math.max(0, parseFloat(r.spend)||0);
      days[idx].adsAttr.tiktokads = Math.max(0, parseFloat(r.gross_revenue)||0);   // TikTok Shop revenue GMV Max attributes to itself (platform-reported)
      days[idx].tiktokAdsReal = {orders: parseFloat(r.orders)||0, gmvMax: parseFloat(r.gmv_max_spend)||0, other: parseFloat(r.other_spend)||0};
      matched++;
    });
    return matched>0;
  }

  function applyGoogleAdsRows(data){
    if(!data || !data.daily) return false;
    let matched = 0;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      const spend = Math.max(0, parseFloat(r.spend)||0);
      const value = Math.max(0, parseFloat(r.conversion_value)||0);
      days[idx].ads.google = spend;          // cost_micros / 1e6 for the day (account currency)
      days[idx].adsAttr.google = value;      // conversions_value Google attributes to ads
      days[idx].googleReal = {
        conversions: parseFloat(r.conversions)||0,
        impressions: Math.round(parseFloat(r.impressions)||0),
        clicks: Math.round(parseFloat(r.clicks)||0),
      };
      matched++;
    });
    return matched>0;
  }

  // ---------- live data: Amazon Ads spend per day (Sellerboard export today, Amazon Ads API later) ----------
  function applyAmazonAdsRows(data){
    if(!data || !data.daily) return false;
    let matched = 0;
    // Sellerboard's daily export (workflow sellerboard_ads.yml) is final for every day up to meta.automation.fetched_last_day;
    // later days only carry the number Claude pulled from the PPC dashboard during the day -> provisional until the export catches up.
    const exportLast = (data.meta && data.meta.automation && data.meta.automation.fetched_last_day) || null;
    Object.keys(data.daily).forEach(iso=>{
      const idx = days.findIndex(d=>d.iso===iso);
      if(idx<0) return;
      const r = data.daily[iso] || {};
      const split = (parseFloat(r.sp)||0) + (parseFloat(r.sb)||0) + (parseFloat(r.sd)||0);
      const consoleSpend = (r.ads_spend_console!=null) ? (parseFloat(r.ads_spend_console)||0) : split;
      // P&L cost = SP + SB + SD, exactly what the Amazon Ads console bills. Sellerboard also reports a
      // "Sponsored Television" line (r.stv) that does not exist in the console (checked 22/09) -> not booked, shown as a note.
      const spend = Math.max(0, consoleSpend>0 ? consoleSpend : (parseFloat(r.spend)||0) - (parseFloat(r.stv)||0));
      days[idx].ads.amazonads = spend;
      days[idx].adsAttr.amazonads = Math.max(0, parseFloat(r.purchase_value)||0);   // Amazon-attributed sales (not added to revenue)
      days[idx].amazonAdsReal = {
        sp: parseFloat(r.sp)||0, sb: parseFloat(r.sb)||0, sd: parseFloat(r.sd)||0, stv: parseFloat(r.stv)||0,
        clicks: Math.round(parseFloat(r.clicks)||0), purchases: parseFloat(r.purchases)||0,   // purchases = ad-attributed orders (schema 2) or units (schema 1)
        impressions: Math.round(parseFloat(r.impressions)||0),
        consoleSpend: (r.ads_spend_console!=null) ? (parseFloat(r.ads_spend_console)||0) : ((parseFloat(r.sp)||0)+(parseFloat(r.sb)||0)+(parseFloat(r.sd)||0)),   // what the Amazon Ads console calls "Total cost" (SP+SB+SD, no Sponsored TV)
        provisional: !!(exportLast && iso > exportLast && r.spend_src !== 'sellerboard_automation'),
        hasSales: r.purchase_value!=null,   // console Sales pulled from the PPC dashboard for this day
      };
      matched++;
    });
    return matched>0;
  }

  // ---------- Google Ads: product / campaign breakdown for the selected period ----------
  function renderGoogleCampaigns(){
    const card = document.getElementById('googleCampaignCard');
    if(!card) return;
    const camps = (GOOGLE_ADS_LIVE_DATA && GOOGLE_ADS_LIVE_DATA.campaigns) || null;
    if(!googleMatched || !camps || !Object.keys(camps).length){ card.style.display='none'; return; }
    card.style.display = '';
    const isoSet = new Set(currentRows().map(r=>r.iso));
    const F = ['spend','impressions','clicks','conversions','conversion_value'];
    const zero = ()=> { const o={}; F.forEach(f=>o[f]=0); return o; };
    const derive = o => {
      o.cpc = o.clicks ? o.spend/o.clicks : 0;
      o.ctr = o.impressions ? o.clicks/o.impressions*100 : 0;
      o.cpa = o.conversions ? o.spend/o.conversions : 0;
      o.roas = o.spend ? o.conversion_value/o.spend : 0;
      return o;
    };
    const rows = [];
    Object.keys(camps).forEach(id=>{
      const c = camps[id]; const agg = zero(); let n = 0;
      Object.keys(c.daily||{}).forEach(iso=>{ if(!isoSet.has(iso)) return; const d=c.daily[iso]; F.forEach(f=>agg[f]+= (parseFloat(d[f])||0)); n++; });
      if(n===0 || agg.spend<=0) return;
      rows.push({id, name:c.name, product:c.product||tx('u.other'), channel:c.channel||'', market:c.market||'', stage:c.stage||'', status:c.status||'', ...derive(agg)});
    });
    if(!rows.length){ card.style.display='none'; return; }
    const products = {};
    rows.forEach(r=>{ const p = products[r.product] = products[r.product] || {...zero(), n:0}; F.forEach(f=>p[f]+=r[f]); p.n++; });
    Object.values(products).forEach(derive);
    const totalSpend = rows.reduce((s,r)=>s+r.spend,0);
    const fmtN = v => Math.round(v).toLocaleString('en-US');
    const warnCls = r => (r.roas && r.roas<META_ROAS_WARN) || (r.cpa && r.cpa>META_CPA_WARN) ? 'style="color:var(--status-critical);font-weight:600;"' : '';
    const chanPill = ch => ch ? `<span class="pill" style="background:var(--surface-card-3);color:var(--ink-secondary);font-weight:500;margin-left:4px;">${ch}</span>` : '';
    const stagePill = s => s && s!=='Other' ? `<span class="pill ${s==='Scaling'?'ok':'warn'}" style="font-weight:500;margin-left:4px;">${s}</span>` : '';
    const statusDot = st => `<span class="dot ${st==='ENABLED'?'g':'w'}" style="display:inline-block;margin-right:6px;vertical-align:middle;" title="${st}"></span>`;
    let html = `<thead><tr><th>${tx('u.product2')}</th><th style="text-align:right">${tx('u.spend')}</th><th style="text-align:right">${tx('u.spendPct')}</th><th style="text-align:right">${tv('Attributed conv.','Conv. quy về')}</th><th style="text-align:right">CPA</th><th style="text-align:right">${tx('u.attrRev')}</th><th style="text-align:right">ROAS</th><th style="text-align:right">Clicks</th><th style="text-align:right">CPC</th><th style="text-align:right">CTR</th></tr></thead><tbody>`;
    const cell = (r, bold) => `<td class="num" ${bold?'style="font-weight:700;color:var(--ink-primary);"':''}>${money(r.spend)}</td><td class="num">${totalSpend? (r.spend/totalSpend*100).toFixed(0):0}%</td><td class="num">${fmtN(r.conversions)}</td><td class="num" ${warnCls(r)}>${r.cpa?money(r.cpa):'—'}</td><td class="num">${money(r.conversion_value)}</td><td class="num" ${warnCls(r)}>${r.roas.toFixed(2)}x</td><td class="num">${fmtN(r.clicks)}</td><td class="num">${r.cpc?money(r.cpc):'—'}</td><td class="num">${r.ctr.toFixed(2)}%</td>`;
    Object.keys(products).sort((a,b)=>products[b].spend-products[a].spend).forEach(p=>{
      const pr = products[p];
      html += `<tr style="background:var(--surface-card-2);"><td class="name" style="font-weight:700;">${p} <span style="color:var(--ink-muted);font-weight:400;font-size:11px;">· ${pr.n} campaign</span></td>${cell(pr,true)}</tr>`;
      rows.filter(r=>r.product===p).sort((a,b)=>b.spend-a.spend).forEach(r=>{
        html += `<tr><td class="name" style="font-weight:400;padding-left:22px;font-size:12px;">${statusDot(r.status)}${r.name}${chanPill(r.channel)}${r.market&&r.market!=='US'?` <span class="pill" style="background:var(--surface-card-3);color:var(--ink-secondary);font-weight:500;">${r.market}</span>`:''}${stagePill(r.stage)}</td>${cell(r,false)}</tr>`;
      });
    });
    const all = zero(); rows.forEach(r=>F.forEach(f=>all[f]+=r[f])); derive(all);
    html += `<tr style="border-top:1.5px solid var(--baseline);"><td class="name" style="font-weight:700;">${tv(`Total Google (${rows.length} campaigns with spend)`, `Tổng Google (${rows.length} campaign có chi)`)}</td>${cell(all,true)}</tr></tbody>`;
    document.getElementById('googleCampaignTable').innerHTML = html;
    document.getElementById('googleCampaignNote').textContent = tv('Google Ads API · conversions per the account settings (may include non-purchase conversions) · ','Google Ads API · conversions theo cài đặt tài khoản (có thể gồm cả conversion không phải mua hàng) · ')+fmtAmazonAge(GOOGLE_ADS_LIVE_DATA.generated_at)+tv(' · green dot = running, amber = paused',' · chấm xanh = đang chạy, vàng = tạm dừng');
  }
  // "từ 2025-01-01" / "thiếu N ngày" from meta.history (sync scripts that keep history)
  function fmtCoverage(data){
    const h = data && data.meta && data.meta.history;
    if(!h || !h.first_day) return '';
    const from = h.first_day.slice(8,10)+'/'+h.first_day.slice(5,7)+'/'+h.first_day.slice(0,4);
    return tx('age.from', {d: from}) + (h.missing_count ? tx('age.missing', {n: h.missing_count.toLocaleString('en-US')}) : '');
  }
  // Dot colour = real age of the embedded snapshot: green < 4h (the GitHub jobs refresh every 30 min, the page
  // is republished by the sync task), amber up to 48h, red beyond (sync stalled - check the scheduled task).
  function ageLevel(iso){
    if(!iso) return 'w';
    const h = (Date.now()-new Date(iso).getTime())/3600000;
    return h < 6 ? 'g' : h < 48 ? 'w' : 'c';   // V11.6: GitHub runs the scheduled syncs every ~3-4.5 h in practice
  }
  function fmtAmazonAge(iso){
    if(!iso) return tx('age.just');
    const mins = Math.round((Date.now()-new Date(iso).getTime())/60000);
    if(mins<1) return tx('age.just');
    if(mins<60) return tx('age.min', {n: mins});
    return tx('age.hour', {n: Math.round(mins/60)});
  }

  function fmtAgeFromCache(cache){
    if(!cache || !cache.storedAt) return tx('age.just');
    const mins = Math.round((Date.now()-cache.storedAt)/60000);
    if(mins<1) return tx('age.just');
    if(mins<60) return tx('age.min', {n: mins});
    return tx('age.hour', {n: Math.round(mins/60)});
  }

  // Sources with no live feed yet - they show $0 on the page (never a sample figure).
  // V11.6: real sync cadence; the "not connected" clause only when something really is not connected
  function bannerTail(){ const m = stillMockNames(); return tv(', sources sync automatically every few hours — press ↻ to load new figures',', nguồn tự đồng bộ vài giờ một lần — bấm ↻ để tải số mới') + (m.length ? tv('. <b>Not connected = $0</b> (no sample figures): ','. <b>Chưa kết nối = $0</b> (kh&ocirc;ng d&ugrave;ng số mẫu): ') + m.join(', ') : ''); }
  function stillMockNames(){
    const m = [];
    if(!shopifyMatched) m.push('Shopify');
    if(!amazonMatched) m.push('Amazon');
    if(!walmartMatched) m.push('Walmart'); if(!tiktokMatched) m.push('TikTok Shop');
    if(!metaMatched) m.push('Meta Ads');
    if(!googleMatched) m.push('Google Ads');
    if(!shipmonkMatched) m.push('ShipMonk');
    if(!shipmonkInvMatched) m.push(tv('ShipMonk invoices (storage, receiving, returns)','hoá đơn ShipMonk (lưu kho, receiving, hàng trả)'));
    if(!amazonAdsMatched) m.push(tv('Amazon Ads (pending approval)','Amazon Ads (chờ duyệt)'));
    if(!tiktokAdsMatched) m.push('TikTok Ads'); if(!applovinMatched) m.push('AppLovin'); if(!COGS_LOTS_LIVE_DATA && !COGS_SKUS_LIVE_DATA) m.push(tv('product cost per SKU','giá vốn theo SKU'));
    if(!(shopifyMeta && shopifyMeta.meta && shopifyMeta.meta.payment_fees_basis)) m.push(tv('payment processing fees','phí cổng thanh toán')); else if(!paypalMatched) m.push(tv('PayPal fees (Shopify Payments done)','phí PayPal (Shopify Payments đã có)'));
    if(!klaviyoMatched) m.push('Klaviyo');
    if(!opexMatched) m.push(tv('G&A (except Snowball, Klaviyo)','G&A (trừ Snowball, Klaviyo)'));
    return m;
  }
  (async function connectLiveData(){
    // Shopify baked in by the hourly sync = the source of truth; don't also pull the
    // connector's ShopifyQL numbers on top (slightly different definitions would flicker).
    if(shopifyMatched){
      _bannerPaint = ()=> setLiveBanner(bicon('check')+'<span><b>'+bakedLiveNames().join(' + ')+tv(' are LIVE',' đang LIVE')+'</b>'+bannerTail()+'.</span>', 'good');
      _bannerPaint();
      return;
    }
    let mcp;
    try{ mcp = await claude.use('mcp'); } catch(e){ mcp = null; }
    if(!mcp){
      const live = bakedLiveNames();
      if(live.length){
        _bannerPaint = ()=> setLiveBanner(bicon('check')+'<span><b>'+bakedLiveNames().join(' + ')+tv(' are LIVE',' đang LIVE')+'</b>'+bannerTail()+tv('. Shopify revenue is not in this build yet — wait for the next sync.</span>','. Doanh thu Shopify chưa c&oacute; trong bản n&agrave;y — chờ lần sync kế tiếp.</span>'), 'warn');
      } else {
        _bannerPaint = ()=> setLiveBanner(bicon('info')+'<span>'+tv('No source has been synced into this build yet — every figure is $0 (no sample figures). Wait for the next sync.','Chưa c&oacute; nguồn n&agrave;o được đồng bộ v&agrave;o bản n&agrave;y — mọi số đang l&agrave; $0 (kh&ocirc;ng d&ugrave;ng số mẫu). Chờ lần sync kế tiếp.')+'</span>', 'warn');
      }
      _bannerPaint();
      return;
    }
    mcp.watchTool('Shopify', 'run-analytics-query',
      {query: 'FROM sales SHOW orders, gross_sales, discounts, sales_reversals, net_sales, shipping_charges, taxes, total_sales TIMESERIES day SINCE -'+(TOTAL_DAYS+5)+'d UNTIL today'},
      (ev)=>{
        if(ev.type==='data'){
          const payload = ev.result.payload;
          const rows = payload && payload.rows ? payload.rows : null;
          if(rows && applyShopifyRows(rows)){
            const domain = payload.shopDomain || 'Shopify';
            setSource('shopify','g', fmtAgeFromCache(ev.result.cache));
            _bannerPaint = ()=>{
              const liveNames = bakedLiveNames();
              const amazonNote = liveNames.length
                ? liveNames.join(' + ')+tv(' are LIVE too.',' cũng đang LIVE.')
                : tv('Other sources not connected show $0.','C&aacute;c nguồn kh&aacute;c chưa kết nối hiển thị $0.');
              setLiveBanner(bicon('check')+'<span><b>'+tv('Shopify revenue is LIVE','Doanh thu Shopify đang LIVE')+'</b> (' + domain + ') — ' + amazonNote + tv(' Connect more sources in the "Data connection guide" tab.</span>',' Kết nối th&ecirc;m nguồn ở tab "Hướng dẫn kết nối dữ liệu".</span>'), 'good');
            };
            renderAll();
          }
        } else {
          const err = ev.error || {};
          setSource('shopify','c',tv('Connection error','Lỗi kết nối'));
          if(err.code==='needs_reauth' || err.code==='server_not_connected'){
            setLiveBanner(bicon('warn')+'<span>'+tv('Shopify is not connected or the sign-in has expired — go to claude.ai Settings &gt; Connectors to connect / sign in to Shopify again.','Shopify chưa kết nối hoặc phi&ecirc;n đăng nhập đ&atilde; hết hạn — v&agrave;o claude.ai Settings &gt; Connectors để kết nối/đăng nhập lại Shopify.')+'</span>', 'bad');
          } else if(err.code==='server_unavailable' || err.retryable){
            setLiveBanner(bicon('clock')+'<span>'+tv('Could not fetch Shopify data right now (temporary) — Shopify shows $0, try again later.','Kh&ocirc;ng lấy được dữ liệu Shopify l&uacute;c n&agrave;y (tạm thời) — Shopify đang hiển thị $0, thử lại sau.')+'</span>', 'warn');
          } else if(err.code==='not_in_manifest' || err.code==='consent_required'){
            setLiveBanner(bicon('warn')+'<span>'+tv('You have not allowed this page to use your Shopify connection. Accept when asked, or re-enable it in the page settings.','Bạn chưa cho ph&eacute;p trang n&agrave;y d&ugrave;ng kết nối Shopify của bạn. H&atilde;y đồng &yacute; khi được hỏi, hoặc bật lại trong c&agrave;i đặt của trang.')+'</span>', 'bad');
          } else {
            setLiveBanner(bicon('warn')+'<span>'+tv('Could not fetch real Shopify data (','Chưa lấy được dữ liệu Shopify thật (') + (err.code||tv('error','lỗi')) + tv(') — Shopify shows $0.',') — Shopify đang hiển thị $0.')+'</span>', 'warn');
          }
          renderSources();
        }
      },
      {refetchInterval: 300000}
    );
    try{
      const shopInfo = await mcp.callTool('Shopify','get-shop-info');
      // shop identity available at shopInfo.payload if needed later
    }catch(e){ /* non-critical */ }
  })();
  // ---- V11.4: explanations on demand. A card's header note and its captions sit behind an (i) button next to the
  // card title; the popover copies them at open time, so it always shows what the card currently says. Notes with an
  // id ending in "Finding" (MER, P&L, OpEx findings) stay visible. "Always show notes" is remembered per browser.
  (function(){
    const KEY = 'ctu_notes';
    let pinned = false; try{ pinned = localStorage.getItem(KEY) === 'open'; }catch(e){}
    document.body.classList.toggle('notes-open', pinned);
    const isFinding = el => /Finding$/.test(el.id || '');
    const txt = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const shown = el => !el.closest('[hidden]') && el.style.display !== 'none';
    const escH = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    // a box = a card (title h2 in .card-head; notes in the head, captions anywhere) or a column of the brief (h3 + .sub)
    function sourcesOf(box){
      if(box.classList.contains('card')){
        const head = box.querySelector('.card-head');
        return { notes: head ? [...head.querySelectorAll('.note')].filter(n => !isFinding(n)) : [], caps: [...box.querySelectorAll('.caption')] };
      }
      return { notes: [], caps: [...box.querySelectorAll(':scope > .sub')] };
    }
    const titleOf = box => box.querySelector(box.classList.contains('card') ? '.card-head h2' : ':scope > h3, :scope > .ch-title > h3');
    function hasContent(card){ const s = sourcesOf(card); return s.notes.some(n => txt(n)) || s.caps.some(c => txt(c) && shown(c)); }
    let pop = null, openBtn = null;
    function close(){
      if(pop){ pop.remove(); pop = null; }
      if(openBtn){ openBtn.setAttribute('aria-expanded', 'false'); openBtn.classList.remove('on'); openBtn = null; }
    }
    function place(btn){
      if(!pop) return;
      if(window.matchMedia('(max-width: 640px)').matches){ pop.classList.add('sheet'); return; }
      const r = btn.getBoundingClientRect(), w = Math.min(480, window.innerWidth - 32);
      pop.style.width = w + 'px';
      const left = Math.max(16, Math.min(r.left - 14, window.innerWidth - w - 16));
      pop.style.left = (left + window.scrollX) + 'px';
      pop.style.top = (r.bottom + window.scrollY + 8) + 'px';
    }
    function open(btn, card){
      close();
      const s = sourcesOf(card), parts = [];
      s.notes.filter(n => txt(n)).forEach(n => parts.push('<p class="ip-lead">' + n.innerHTML + '</p>'));
      s.caps.filter(c => txt(c) && shown(c)).forEach(c => parts.push('<div class="ip-cap">' + c.innerHTML + '</div>'));
      const h2 = titleOf(card);
      pop = document.createElement('div');
      pop.className = 'info-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', h2 ? txt(h2) : tv('Notes', 'Ghi chú'));
      pop.innerHTML = '<div class="ip-head"><span class="ip-title">' + escH(h2 ? txt(h2) : '') + '</span><button type="button" class="ip-x" aria-label="' + tv('Close', 'Đóng') + '">&times;</button></div>' +
        '<div class="ip-body">' + (parts.join('') || '<p class="ip-lead">' + tv('No notes for this card yet.', 'Chưa có ghi chú cho mục này.') + '</p>') + '</div>' +
        '<div class="ip-foot"><button type="button" class="ip-pin">' + (pinned ? tv('Hide notes on the page again', 'Ẩn lại ghi chú trên trang') : tv('Always show notes on the page', 'Luôn hiện ghi chú trên trang')) + '</button></div>';
      pop.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
      document.body.appendChild(pop);
      place(btn);
      btn.setAttribute('aria-expanded', 'true'); btn.classList.add('on'); openBtn = btn;
      pop.querySelector('.ip-x').addEventListener('click', () => { const b = openBtn; close(); if(b) b.focus(); });
      pop.querySelector('.ip-pin').addEventListener('click', () => {
        pinned = !pinned; try{ localStorage.setItem(KEY, pinned ? 'open' : ''); }catch(e){}
        document.body.classList.toggle('notes-open', pinned); close();
      });
      pop.querySelector('.ip-x').focus({preventScroll: true});
    }
    const ICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.3v4.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.9" r="1" fill="currentColor"/></svg>';
    [...document.querySelectorAll('.card'), ...document.querySelectorAll('.brief-grid > div')].forEach(card => {
      const h2 = titleOf(card); if(!h2) return;
      const s = sourcesOf(card); if(!s.notes.length && !s.caps.length) return;
      card.classList.add('has-info');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'info-btn'; b.innerHTML = ICON;
      b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-haspopup', 'dialog');
      b.title = tv('What this shows', 'Giải thích mục này'); b.setAttribute('aria-label', b.title);
      const wrap = document.createElement('span'); wrap.className = 'ch-title';   // keeps the (i) next to the title whatever the header layout
      h2.parentNode.insertBefore(wrap, h2); wrap.appendChild(h2); wrap.appendChild(b);
      b.addEventListener('click', e => { e.stopPropagation(); if(openBtn === b){ close(); return; } open(b, card); });
      const sync = () => { b.hidden = !hasContent(card); };
      sync();
      const mo = new MutationObserver(sync);
      s.notes.concat(s.caps).forEach(el => mo.observe(el, {childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden']}));
    });
    document.addEventListener('click', e => { if(pop && !pop.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && pop){ const b = openBtn; close(); if(b) b.focus(); } });
    window.addEventListener('resize', close);
  })();
})();
