// Cattasaurus P&L dashboard — built from the template by build_site.py (build 106ff7f95e).
// Data arrives in window.__LIVE (see the loader in index.html); do not edit by hand, rebuild instead.

(function(){
  "use strict";
  function sum(arr){ return arr.reduce((a,b)=>a+b,0); }
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
  function fmtDate(d){ return d.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit'}); }
  function fmtDateLong(d){ return d.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}); }
  // Calendar date in the viewer's local timezone (NOT toISOString, which converts to UTC and
  // shifts every key one day early for UTC+ viewers, so real data landed on the wrong chip).
  function isoDate(d){ const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  const DOW = ['CN','T2','T3','T4','T5','T6','T7'];

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

  // Amazon SP-API Finances data, injected here at publish time by the automated sync
  // (GitHub Actions fetches from Amazon -> Claude scheduled task republishes this artifact
  // with the block below replaced). Do not rename this line; the sync matches it exactly.
  const AMAZON_LIVE_DATA = (window.__LIVE && window.__LIVE["amazon"]) || null; /*AMAZON_DATA_INJECT*/

  let amazonMeta = null;
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

  // Last-touch channels (Shopify customer journey, sync v1.8+): fixed order, fixed colors.
  // Full-strength hues = one entity each; lighter mixes = the organic / untagged sibling of that hue.
  const ATTR_CH = [
    {key:'email', label:'Email (Klaviyo)', color:'var(--series-3)', ink:'#fff', cost:'klaviyo'},
    {key:'sms', label:'SMS (Klaviyo)', color:'color-mix(in srgb, var(--series-3) 55%, var(--surface-card))', cost:'klaviyo'},
    {key:'email_other', label:'Email khác (không có UTM Klaviyo)', color:'color-mix(in srgb, var(--series-3) 28%, var(--surface-card))'},
    {key:'meta_paid', label:'Meta Ads', color:'var(--series-1)', ink:'#fff', cost:'meta'},
    {key:'meta_organic', label:'Meta không UTM (FB/IG referrer)', color:'color-mix(in srgb, var(--series-1) 45%, var(--surface-card))'},
    {key:'meta_shop', label:'Mua trong Facebook / Instagram Shop', color:'color-mix(in srgb, var(--series-1) 70%, var(--surface-card))', ink:'#fff'},
    {key:'google_ads', label:'Google Ads', color:'var(--series-2)', ink:'#fff', cost:'google'},
    {key:'organic_search', label:'Tìm kiếm organic (Google, Bing…)', color:'var(--series-4)', ink:'#fff'},
    {key:'tiktok_ads', label:'TikTok Ads', color:'var(--series-5)', ink:'#fff', cost:'tiktokads'},
    {key:'tiktok_organic', label:'TikTok organic', color:'color-mix(in srgb, var(--series-5) 45%, var(--surface-card))'},
    {key:'tiktok_shop', label:'TikTok Shop', color:'color-mix(in srgb, var(--series-5) 70%, var(--surface-card))', ink:'#fff'},
    {key:'applovin', label:'AppLovin', color:'var(--series-7)', ink:'#fff', cost:'applovin'},
    {key:'snowball', label:'Snowball / creator / affiliate', color:'var(--series-6)', ink:'#fff', cost:'snowball'},
    {key:'other_paid', label:'Quảng cáo trả tiền khác', color:'color-mix(in srgb, var(--series-7) 45%, var(--surface-card))'},
    {key:'social_other', label:'Mạng xã hội khác', color:'color-mix(in srgb, var(--series-2) 45%, var(--surface-card))'},
    {key:'ai_search', label:'AI (ChatGPT, Perplexity…)', color:'color-mix(in srgb, var(--series-4) 45%, var(--surface-card))'},
    {key:'referral', label:'Website giới thiệu', color:'var(--ink-muted)', ink:'#fff'},
    {key:'other_utm', label:'UTM khác', color:'color-mix(in srgb, var(--ink-muted) 55%, var(--surface-card))'},
    {key:'shop_app', label:'Shop app (Shopify)', color:'color-mix(in srgb, var(--series-6) 45%, var(--surface-card))'},
    {key:'other_channel', label:'Kênh bán khác (POS, app, draft…)', color:'color-mix(in srgb, var(--ink-muted) 40%, var(--surface-card))'},
    {key:'direct', label:'Direct (gõ link / bookmark)', color:'var(--baseline)'},
    {key:'unknown', label:'Không có hành trình (web, không cookie)', color:'var(--gridline)'},
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
    {key:'salary', label:'Lương gián tiếp (vận hành, quản lý)', monthly:0},
    {key:'software', label:'Phần mềm & công cụ', monthly:0},
    {key:'snowball_sub', label:'Social Snowball — phần mềm affiliate (gói Blizzard, không thu % hoa hồng)', monthly:350, real:true},
    {key:'office', label:'Văn phòng & vận hành', monthly:0},
    {key:'accounting', label:'Kế toán & pháp lý', monthly:0},
    {key:'insurance', label:'Bảo hiểm', monthly:0},
    {key:'other', label:'Khác', monthly:0},
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
    const row = {date:d, iso:isoDate(d), channels:{}, refunds:{}, orders:{}, discounts:{}, ads:{}, adsAttr:{}, amazonReal:null, metaReal:null, googleReal:null, shopifyReal:null, snowballReal:null, shipmonkReal:null, shipmonkInv:null, paypalReal:null, shopifyAttr:null, klaviyoReal:null, klaviyoCost:null};
    CH_KEYS.forEach(k=>{ row.channels[k]=0; row.refunds[k]=0; row.orders[k]=0; row.discounts[k]=0; });
    AD_KEYS.forEach(k=>{ row.ads[k]=0; row.adsAttr[k]=0; });
    days.push(row);
  }
  days[TOTAL_DAYS-1]._syncing = true;
  // Channels / ad platforms with no synced source at all (always $0 until connected).
  const CH_UNCONNECTED = {walmart:true, tiktok:true};
  const AD_UNCONNECTED = {tiktokads:true, applovin:true, amazonads:true};

  const SOURCES = [
    {key:'shopify', name:'Shopify (doanh thu)', age:'Chưa kết nối — $0', level:'c'},
    {key:'snowball', name:'Snowball (hoa hồng influencer)', age:'Chưa kết nối — chưa có trong P&L', level:'c'},
    {key:'tiktokshop', name:'TikTok Shop (đơn hàng)', age:'Chưa kết nối — $0', level:'c'},
    {key:'amazon', name:'Amazon Orders', age:'Chưa kết nối — $0', level:'c'},
    {key:'walmart', name:'Walmart Marketplace', age:'Chưa kết nối — $0', level:'c'},
    {key:'meta', name:'Meta Ads', age:'Chưa kết nối — $0', level:'c'},
    {key:'google', name:'Google Ads', age:'Chưa kết nối — $0', level:'c'},
    {key:'tiktokads', name:'TikTok Ads', age:'Chưa kết nối — $0', level:'c'},
    {key:'applovin', name:'AppLovin', age:'Chưa kết nối — $0', level:'c'},
    {key:'amazonads', name:'Amazon Ads (attributed)', age:'Chờ Amazon duyệt Advertising API — $0', level:'c'},
    {key:'amazonfin', name:'Amazon SP-API Finances', age:'Chưa kết nối — $0', level:'c'},
    {key:'shipmonk', name:'ShipMonk (phí fulfillment theo đơn)', age:'Chưa kết nối — $0', level:'c'},
    {key:'shipmonk_inv', name:'ShipMonk hoá đơn (lưu kho, receiving, hàng trả…)', age:'Chưa kết nối — $0', level:'c'},
    {key:'paypal', name:'PayPal (phí giao dịch)', age:'Chưa kết nối — $0', level:'c'},
    {key:'klaviyo', name:'Klaviyo (email & SMS marketing)', age:'Chưa kết nối', level:'c'},
    {key:'ga', name:'Kế toán (G&A)', age:'Chưa kết nối — $0', level:'c'},
  ];

  // ---------- months list ----------
  const monthMap = {};
  days.forEach(d=>{ const m = d.iso.slice(0,7); (monthMap[m] = monthMap[m]||[]).push(d); });
  const MONTHS = Object.keys(monthMap).sort();
  const MONTH_LABEL = m => { const [y,mo] = m.split('-'); return 'Tháng '+parseInt(mo,10)+'/'+y + (monthMap[m].length<28? ' (đến '+fmtDate(monthMap[m][monthMap[m].length-1].date)+')' : ''); };
  // ---------- weeks list (Monday - Sunday, keyed by the Monday) ----------
  const weekMap = {};
  days.forEach(d=>{ const dow = (d.date.getDay()+6)%7; const mon = new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate()-dow); const k = isoDate(mon); (weekMap[k] = weekMap[k]||[]).push(d); });
  const WEEKS = Object.keys(weekMap).sort();
  function isoWeekNo(d){ const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dn = t.getUTCDay()||7; t.setUTCDate(t.getUTCDate()+4-dn); const y0 = new Date(Date.UTC(t.getUTCFullYear(),0,1)); return Math.ceil((((t-y0)/86400000)+1)/7); }
  const WEEK_LABEL = k => { const r = weekMap[k]; const mon = new Date(k.slice(0,4), k.slice(5,7)-1, k.slice(8,10)); const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate()+6); return 'Tuần '+isoWeekNo(mon)+'/'+mon.getFullYear()+' · '+fmtDate(mon)+' – '+fmtDate(sun) + (r.length<7 ? ' (có '+r.length+' ngày)' : ''); };

  // ---------- aggregate ----------
  function aggregate(rows){
    const n = rows.length || 1;
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

    // ---- Amazon: use real SP-API Finances fees on days we have them, estimate the rest ----
    let amazonOrdersReal=0, amazonOrdersEst=0, amazonRevenueEst=0;
    let amazonFbaFeesReal=0, amazonReferralFeesReal=0, amazonServiceFeesReal=0, amazonInboundFreightReal=0, amazonOtherFeesReal=0, amazonOtherNetReal=0;
    let amazonStorageAlloc=0, amazonStorageMissingDays=0, amazonStoragePosted=0, amazonRefundFeeAdj=0, amazonFeeOrderedDays=0;
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
        amazonStoragePosted += r.amazonReal.storagePosted || 0;
        amazonRefundFeeAdj += r.amazonReal.refundFeeAdj || 0;
        if(r.amazonReal.feeBasisOrdered){ amazonFeeOrderedDays++; if(!r.amazonReal.storageKnown) amazonStorageMissingDays++; }
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
    const productCost = 0;
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
    const smInvOther = smInv.fees_other + smInv.unallocated;                 // minimum fee, late fees, audits + what ShipMonk's sections don't allocate
    const smInvAdjCredits = smInv.adjustments + smInv.credits;               // carrier adjustments + credits (usually negative = money back)
    // true-up: invoiced postage + pick&pack vs the API's estimate, per billing period (precomputed per day in applyShipmonkInvoiceRows)
    let smInvShipCmp = 0, smApiShipCmp = 0, smCmpDays = 0, smTrueUp = 0;
    invRows.forEach(r=>{ if(r.shipmonkInv.cmpOk){ smCmpDays++; smInvShipCmp += r.shipmonkInv.cmpInv; smApiShipCmp += r.shipmonkInv.cmpApi; smTrueUp += r.shipmonkInv.trueUp; } });
    const smCmpMissingDays = smInvDays - smCmpDays;
    const shipmonkInvoiceExtras = smInv.storage + smInv.receiving + smInv.returns + smInv.packaging_purchases + smInvOther + smInvAdjCredits + smTrueUp;
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
    const paymentFeesAll = paymentFees + paypalFees;
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
    const amazonMarketplaceFeesReal = amazonReferralFeesReal + amazonServiceFeesReal + amazonStorageAlloc + amazonOtherFeesReal + amazonOtherUnclassifiedCost;
    const walmartFees = 0;                 // Walmart not connected
    const tiktokFees = 0;                  // TikTok Shop not connected
    const marketplaceFees = amazonMarketplaceFeesEst + amazonMarketplaceFeesReal + walmartFees + tiktokFees;
    const adSpend = sum(AD_KEYS.map(k=>ads[k]));
    // Snowball influencer/affiliate commissions - only from real Shopify sync data (no
    // seeded estimate: the line is hidden until data/shopify_pnl.json is baked in).
    const snowballRealDays = rows.filter(r=>r.snowballReal).length;
    const snowballOrders = sum(rows.map(r=> r.snowballReal ? r.snowballReal.orders : 0));
    const snowballRevenue = sum(rows.map(r=> r.snowballReal ? r.snowballReal.revenue : 0));
    const snowballCommission = sum(rows.map(r=> r.snowballReal ? r.snowballReal.commissionNet : 0));
    const otherVarTotal = paymentFeesAll + marketplaceFees + adSpend + snowballCommission;
    const contributionProfit = grossProfit - otherVarTotal;

    const gaItems = GA_ITEMS.map(it=>({...it, value: it.monthly/30*n}));
    // Klaviyo: real invoices booked per billing cycle (data/klaviyo_invoices.json), spread per day
    const klaviyoCostDays = rows.filter(r=>r.klaviyoCost).length;
    const klaviyoCost = sum(rows.map(r=> r.klaviyoCost ? r.klaviyoCost.cost : 0));
    const klaviyoCostParts = {platform:0, sms:0, upgrades:0, flex:0};
    rows.forEach(r=>{ if(r.klaviyoCost){ Object.keys(klaviyoCostParts).forEach(k=>{ klaviyoCostParts[k] += r.klaviyoCost[k]||0; }); } });
    if(klaviyoCostDays>0){
      gaItems.push({key:'klaviyo', label:'Klaviyo — email & SMS (hoá đơn theo chu kỳ 19→18, chia đều theo ngày)' + (klaviyoCostDays<n ? ` — ${n-klaviyoCostDays} ngày chưa có hoá đơn` : ''), monthly:0, value: klaviyoCost, real:true});
    }
    const gaTotal = sum(gaItems.map(it=>it.value));
    const inventoryHolding = INVENTORY_MONTHLY/30*n;
    const fixedTotal = gaTotal + inventoryHolding;
    const netProfit = contributionProfit - fixedTotal;

    const variableTotal = cogs + otherVarTotal;
    const variableRatio = netRevenue>0 ? variableTotal/netRevenue : 0;
    const cmRatio = 1 - variableRatio;
    const breakEvenRevenue = cmRatio>0 ? fixedTotal/cmRatio : Infinity;
    const blendedAOV = totalOrders>0 ? netRevenue/totalOrders : 0;
    const breakEvenOrders = blendedAOV>0 ? breakEvenRevenue/blendedAOV : 0;

    const merValue = adSpend>0 ? netRevenue/adSpend : 0;
    const attrRevenueSum = sum(AD_KEYS.map(k=>adsAttr[k]));

    // Meta Ads: how many of the selected days carry real Marketing API numbers
    // (vs. the seeded estimate). Display-only - the spend itself is already in ads.meta.
    const metaAdsRealDays = rows.filter(r=>r.metaReal).length;
    const metaAdsPurchases = sum(rows.map(r=> r.metaReal ? r.metaReal.purchases : 0));
    const googleAdsRealDays = rows.filter(r=>r.googleReal).length;
    const googleAdsPurchases = sum(rows.map(r=> r.googleReal ? r.googleReal.conversions : 0));

    // tax collected net of tax refunded to customers = Shopify Analytics "Taxes"
    const shopifyTax = sum(rows.map(r=> r.shopifyReal ? r.shopifyReal.tax - r.shopifyReal.refundedTax : 0));
    const shopifyRealDays = rows.filter(r=>r.shopifyReal).length;
    const amazonRealDays = rows.filter(r=>r.amazonReal).length;

    return {n, gross, refund, discountBy, orders, ads, adsAttr, grossSales, discount, refundsTotal, netRevenue, totalOrders,
      productCost, packaging, fulfillment, postage, cogs, grossProfit, nonAmazonOrders, shopifyTax, shopifyRealDays, amazonRealDays,
      shipmonkRealDays, shipmonkOrders, shipmonkUnshipped, shipmonkUnits, shipmonkPickPack, shipmonkByStore,
      smInvDays, smInv, smInvOther, smInvAdjCredits, smInvShipCmp, smApiShipCmp, smCmpDays, smCmpMissingDays, smTrueUp, shipmonkInvoiceExtras,
      paymentFees, paymentFeeDays, paymentFeeOrders, feesMissingOrders, gatewayMix, feeTypeMix, paypalDays, paypalFees, paypalPayments, paypalPaymentsCount, paypalCompare, paymentFeesAll, marketplaceFees, adSpend, otherVarTotal, contributionProfit,
      gaItems, gaTotal, inventoryHolding, fixedTotal, netProfit, klaviyoCost, klaviyoCostDays, klaviyoCostParts,
      variableTotal, variableRatio, cmRatio, breakEvenRevenue, blendedAOV, breakEvenOrders,
      merValue, attrRevenueSum,
      amazonOrdersReal, amazonReferralFeesReal, amazonServiceFeesReal, amazonInboundFreightReal, amazonOtherFeesReal, amazonOtherUnclassifiedCost, amazonMarketplaceFeesEst, walmartFees, tiktokFees,
      amazonStorageAlloc, amazonStorageMissingDays, amazonStoragePosted, amazonRefundFeeAdj, amazonFeeOrderedDays,
      metaAdsRealDays, metaAdsPurchases, googleAdsRealDays, googleAdsPurchases,
      snowballRealDays, snowballOrders, snowballRevenue, snowballCommission};
  }

  // ---------- state ----------
  let mode = 'day';
  let selDayIdx = TOTAL_DAYS-1;
  let selMonth = MONTHS[MONTHS.length-1];
  let selWeek = WEEKS[WEEKS.length-1];
  let rangeFrom = days[Math.max(0,TOTAL_DAYS-8)].iso, rangeTo = days[TOTAL_DAYS-1].iso;
  const collapsed = {};

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
  function renderSubCtl(){
    const el = document.getElementById('subCtl');
    if(mode==='day'){
      let html = '<div class="chips">';
      for(let i=TOTAL_DAYS-7;i<TOTAL_DAYS;i++){
        const d = days[i].date;
        html += `<div class="chip ${i===selDayIdx?'active':''}" data-idx="${i}"><span class="dow">${DOW[d.getDay()]}</span>${fmtDate(d)}</div>`;
      }
      html += '</div>';
      html += `<input type="date" id="dayPick" value="${days[selDayIdx].iso}" min="${days[0].iso}" max="${days[TOTAL_DAYS-1].iso}" title="Chọn ngày bất kỳ trong lịch sử">`;
      el.innerHTML = html;
      el.querySelectorAll('.chip').forEach(c=>c.addEventListener('click', ()=>{ selDayIdx = parseInt(c.dataset.idx,10); renderAll(); }));
      document.getElementById('dayPick').addEventListener('change', (e)=>{ const idx = days.findIndex(d=>d.iso===e.target.value); if(idx>=0){ selDayIdx = idx; renderAll(); } });
    } else if(mode==='week'){
      const idx = WEEKS.indexOf(selWeek);
      let html = `<button class="chip" id="weekPrev" ${idx<=0?'disabled':''} title="Tuần trước">‹</button><select id="weekSel">`+WEEKS.map(w=>`<option value="${w}" ${w===selWeek?'selected':''}>${WEEK_LABEL(w)}</option>`).join('')+`</select><button class="chip" id="weekNext" ${idx>=WEEKS.length-1?'disabled':''} title="Tuần sau">›</button>`;
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
        {label:'30 ngày', from: days[Math.max(0,TOTAL_DAYS-30)].iso, to: max},
        {label:'90 ngày', from: days[Math.max(0,TOTAL_DAYS-90)].iso, to: max},
      ];
      const years = [...new Set(days.map(d=>d.iso.slice(0,4)))];
      years.forEach(y=>{ const f = y+'-01-01', t = y+'-12-31'; presets.push({label:'Năm '+y, from: f<min?min:f, to: t>max?max:t}); });
      const ly = years[years.length-1];
      [['Q1','01-01','03-31'],['Q2','04-01','06-30'],['Q3','07-01','09-30'],['Q4','10-01','12-31']].forEach(([q,a,b])=>{
        const f = ly+'-'+a, t = ly+'-'+b; if(f<=max && t>=min) presets.push({label:q+' '+ly, from: f<min?min:f, to: t>max?max:t});
      });
      const chips = presets.map(p=>`<div class="chip ${p.from===rangeFrom&&p.to===rangeTo?'active':''}" data-from="${p.from}" data-to="${p.to}">${p.label}</div>`).join('');
      el.innerHTML = `<div class="chips">${chips}</div> Từ <input type="date" id="fromD" value="${rangeFrom}" min="${min}" max="${max}"> đến <input type="date" id="toD" value="${rangeTo}" min="${min}" max="${max}"> <button class="btn" id="applyRange">Xem</button>`;
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
      {label:'Doanh thu thuần', v:cur.netRevenue, pv:prev&&prev.netRevenue},
      {label:'Lợi nhuận gộp', v:cur.grossProfit, pv:prev&&prev.grossProfit},
      {label:'LN đóng góp (CM1)', v:cur.contributionProfit, pv:prev&&prev.contributionProfit},
      {label:'Lợi nhuận ròng', v:cur.netProfit, pv:prev&&prev.netProfit},
      {label:'Biên LN ròng', v: cur.netRevenue? cur.netProfit/cur.netRevenue*100:0, pv: prev&&prev.netRevenue? prev.netProfit/prev.netRevenue*100:null, pct:true},
    ];
    document.getElementById('kpiRow').innerHTML = items.map(it=>{
      let deltaHtml = '<div class="delta flat">— kỳ trước không có dữ liệu</div>';
      if(it.pv!==null && it.pv!==undefined){
        const delta = it.pct ? (it.v-it.pv) : (it.pv!==0? (it.v-it.pv)/Math.abs(it.pv)*100 : 0);
        const up = delta>=0;
        deltaHtml = `<div class="delta ${up?'up':'down'}">${up?'▲':'▼'} ${Math.abs(delta).toFixed(1)}${it.pct?' đpt':'%'} so kỳ trước</div>`;
      }
      const valStr = it.pct ? it.v.toFixed(1)+'%' : money(it.v);
      return `<div class="kpi"><div class="label">${it.label}</div><div class="value">${valStr}</div>${deltaHtml}</div>`;
    }).join('');

    const rangeLbl = document.getElementById('rangeLbl');
    const first = rows[0].date, last = rows[rows.length-1].date;
    rangeLbl.textContent = rows.length===1 ? fmtDateLong(first) : (fmtDate(first)+' – '+fmtDateLong(last)+' · '+rows.length+' ngày');

    const banner = document.getElementById('syncBanner');
    banner.style.display = rows.some(r=>r._syncing) ? 'flex' : 'none';
  }

  // ---------- statement ----------
  function stLine(label, value, base, tag, key, extra){ return {t:'line', label, value, pct: base? value/base*100:0, tag, key, extra}; }
  function stSection(label, key){ return {t:'section', label, key}; }
  function stSub(label, value, base, key){ return {t:'subtotal', label, value, pct: base? value/base*100:0, key}; }
  function stFinal(label, value, base){ return {t:'final', label, value, pct: base? value/base*100:0}; }

  function buildRows(a){
    const nr = a.netRevenue;
    const rows = [];
    rows.push(stLine('Doanh thu gộp (Gross Sales)', a.grossSales, nr, null, 'gs'));
    const chState = k => ({
      unconnected: !!CH_UNCONNECTED[k] || (k==='shopify' && !shopifyMatched) || (k==='amazon' && !amazonMatched),
      liveDays: k==='shopify' ? a.shopifyRealDays : k==='amazon' ? a.amazonRealDays : 0,
    });
    const netBy = k => a.gross[k] - a.discountBy[k] - a.refund[k];
    [...CH_KEYS].sort((x,y)=>a.gross[y]-a.gross[x]).forEach(k=>{
      const {unconnected, liveDays} = chState(k);
      let label = CH_LABEL[k]+' · '+a.orders[k].toLocaleString('en-US')+' đơn';
      if(k==='amazon' && liveDays>0) label += amazonOrderBasisDays>0 ? ' (theo ngày đặt hàng — khớp Seller Central)' : ' (theo ngày ship — Finances)';
      if(!unconnected && liveDays>0 && liveDays<a.n) label += ' ('+(a.n-liveDays)+' ngày ngoài cửa sổ đồng bộ = $0)';
      rows.push({...stLine(label, a.gross[k], nr, null, 'gs'), detail:true, gap: unconnected, live: !unconnected && liveDays>0});
    });
    rows.push({...stLine('Giảm giá & khuyến mãi', -a.discount, nr, 'var', 'disc'), neg:true});
    CH_KEYS.filter(k=>a.discountBy[k]>0).sort((x,y)=>a.discountBy[y]-a.discountBy[x]).forEach(k=>{
      const note = k==='shopify' ? ' — mã giảm giá, KM tự động, B1G2F… (Shopify Analytics: Discounts)' : k==='amazon' ? ' — promotions Amazon' : '';
      rows.push({...stLine(CH_LABEL[k]+note, -a.discountBy[k], nr, null, 'disc'), detail:true, neg:true});
    });
    rows.push({...stLine('Hoàn tiền / Trả hàng', -a.refundsTotal, nr, 'var', 'ref'), neg:true});
    CH_KEYS.filter(k=>a.refund[k]!==0).sort((x,y)=>a.refund[y]-a.refund[x]).forEach(k=>{
      const note = k==='shopify' ? ' — hàng trả + tiền hoàn thêm, theo ngày Shopify xử lý hoàn (= Returns trên Shopify Analytics)' : k==='amazon' ? ' — ghi ngày Amazon hoàn tiền' : '';
      rows.push({...stLine(CH_LABEL[k]+note, -a.refund[k], nr, null, 'ref'), detail:true, neg: a.refund[k]>0});
    });
    rows.push(stSub('= Doanh thu thuần (Net Revenue)', nr, nr, 'nr'));
    // Same split as Gross Sales: each channel's net = its gross - its discounts - its refunds; the four add up to the subtotal.
    [...CH_KEYS].sort((x,y)=>netBy(y)-netBy(x)).forEach(k=>{
      const {unconnected, liveDays} = chState(k);
      let label = CH_LABEL[k]+' — thuần (gộp − giảm giá − hoàn tiền)';
      if(k==='shopify' && !unconnected) label = 'Shopify — thuần = Net sales trên Shopify Analytics';
      if(k==='amazon' && !unconnected) label = 'Amazon — thuần (giá bán − promotions − hoàn tiền)';
      rows.push({...stLine(label, netBy(k), nr, null, 'nr'), detail:true, gap: unconnected, live: !unconnected && liveDays>0});
    });

    rows.push(stSection('Giá vốn hàng bán — COGS (giá vốn sản phẩm + fulfillment)','cogs'));
    rows.push({...stLine('Giá vốn sản phẩm (chưa có bảng giá vốn theo SKU)', -a.productCost, nr, 'var', 'cogs'), neg:true, gap:true});
    const smLive = a.shipmonkRealDays>0;
    const smBasis = shipmonkOrderBasis() ? 'theo ngày đặt hàng' : 'theo ngày ship';
    const smNote = smLive ? ' — ShipMonk, ' + smBasis + (a.shipmonkRealDays<a.n ? ' ('+(a.n-a.shipmonkRealDays)+' ngày ngoài cửa sổ đồng bộ = $0)' : '') : '';
    const smStores = smLive ? Object.entries(a.shipmonkByStore||{}).sort((x,y)=>y[1].total-x[1].total) : [];
    const smStoreRows = (field, what) => {   // one detail row per ShipMonk store (Shopify vs Amazon FBM) when there is more than one
      if(smStores.length<2) return;
      smStores.forEach(([name, t])=>{
        rows.push({...stLine(shipmonkStoreLabel(name)+' — '+what+' ('+t.orders.toLocaleString('en-US')+' đơn)', -t[field], nr, null, 'cogs'), detail:true, neg:true, live:true});
      });
    };
    rows.push({...stLine('Phí đóng gói (packaging)' + (smLive ? ' — vật liệu đóng gói ShipMonk, ' + smBasis : ''), -a.packaging, nr, 'var', 'cogs'), neg:true, gap: !smLive, live: smLive});
    smStoreRows('packaging', 'packaging');
    rows.push({...stLine('Phí fulfillment FBA — Amazon pick & pack + ship (FBAPerUnitFulfillmentFee)', -a.fulfillment, nr, 'var', 'cogs'), neg:true, live: a.amazonRealDays>0});
    const smOrdersTxt = a.shipmonkOrders.toLocaleString('en-US')+' đơn' + (a.shipmonkUnshipped>0 ? ', '+a.shipmonkUnshipped.toLocaleString('en-US')+' chưa ship — tính theo ước tính ShipMonk' : '') + ', '+a.shipmonkUnits.toLocaleString('en-US')+' units';
    rows.push({...stLine(smLive ? 'Phí fulfillment ShipMonk — pick & pack ('+smOrdersTxt+')' + smNote : 'Phí fulfillment ShipMonk / kho thủ công — đơn Shopify + Amazon FBM (chưa kết nối ShipMonk)', -a.shipmonkPickPack, nr, 'var', 'cogs'), neg:true, gap: !smLive, live: smLive});
    smStoreRows('pickPack', 'pick & pack');
    rows.push({...stLine('Phí vận chuyển đến khách (postage) — đơn ngoài FBA' + (smLive ? ' — cước carrier ShipMonk ước tính theo đơn, ' + smBasis : ''), -a.postage, nr, 'var', 'cogs'), neg:true, gap: !smLive, live: smLive});
    smStoreRows('shipping', 'postage');
    if(a.smInvDays>0){
      const invNote = ' — theo hoá đơn ShipMonk' + (a.smInvDays<a.n ? ' ('+(a.n-a.smInvDays)+' ngày chưa có hoá đơn)' : '');
      const invLine = (label, v, opts) => rows.push({...stLine(label + invNote, -v, nr, 'var', 'cogs'), neg: v>=0, live:true, ...(opts||{})});
      invLine('Lưu kho ShipMonk — pallet & bin, chia đều theo ngày trong kỳ hoá đơn', a.smInv.storage);
      invLine('Receiving hàng nhập ShipMonk — nhận carton, dỡ container', a.smInv.receiving);
      invLine('Xử lý hàng trả ShipMonk — processing + cước hàng trả', a.smInv.returns);
      if(a.smInv.packaging_purchases !== 0) invLine('Mua bao bì riêng qua ShipMonk — custom packaging, ghi khi ShipMonk xuất hoá đơn', a.smInv.packaging_purchases);
      if(a.smInvOther !== 0) invLine('Phí khác ShipMonk — phí tối thiểu, phạt trễ, audit, phụ phí' + (Math.abs(a.smInv.unallocated)>=1 ? ' (gồm '+money(a.smInv.unallocated)+' hoá đơn không phân loại)' : ''), a.smInvOther);
      if(a.smInvAdjCredits !== 0) invLine('Điều chỉnh cước & credit ShipMonk — hoàn/điều chỉnh trên hoá đơn', a.smInvAdjCredits);
      if(a.smCmpDays>0){
        const pct = a.smInvShipCmp ? (Math.min(a.smInvShipCmp, a.smApiShipCmp)/Math.max(a.smInvShipCmp, a.smApiShipCmp)*100) : 100;
        invLine('Chênh lệch hoá đơn − ước tính API (cước + pick & pack), tính theo từng kỳ hoá đơn', a.smTrueUp);
        rows.push({...stLine('Đối chiếu '+a.smCmpDays+' ngày: hoá đơn ghi '+money(a.smInvShipCmp)+' cước + pick & pack · API ước tính '+money(a.smApiShipCmp)+' (theo ngày ship) · khớp '+pct.toFixed(1)+'%' + (a.smCmpMissingDays ? ' · '+a.smCmpMissingDays+' ngày thuộc kỳ API chưa đủ dữ liệu để đối chiếu' : ''), 0, nr, null, 'cogs'), detail:true, live:true});
      } else if(a.smCmpMissingDays>0){
        rows.push({...stLine('Đối chiếu cước + pick & pack với hoá đơn: chưa được — API chưa có đủ ngày ship của kỳ này (chờ backfill)', 0, nr, null, 'cogs'), detail:true, live:true});
      }
    } else if(smLive){
      rows.push({...stLine('Lưu kho / receiving / hàng trả ShipMonk — chưa có hoá đơn cho khoảng này', 0, nr, 'var', 'cogs'), gap:true});
    }
    if(a.amazonInboundFreightReal !== 0){
      rows.push({...stLine('Memo — cước & thuế nhập hàng vào FBA '+money(a.amazonInboundFreightReal)+' (Amazon Global Logistics, ngày hoá đơn): tính vào giá vốn hàng nhập kho, KHÔNG trừ ở đây', 0, nr, null, 'cogs'), detail:true, live:true});
    }
    rows.push(stSub('= Tổng COGS', -a.cogs, nr, 'cogs_sub'));
    rows.push(stSub('= Lợi nhuận gộp (Gross Profit)', a.grossProfit, nr, 'gp'));

    rows.push(stSection('Chi phí biến đổi khác (phí giao dịch + quảng cáo)','opvar'));
    if(a.paymentFeeDays>0){
      const GW_LABEL = {shopify_payments:'Shopify Payments (thẻ, Shop Pay)', paypal:'PayPal', shop_cash:'Shop Cash', gift_card:'Gift card', manual:'Thủ công', shopify_installments:'Shop Pay Installments', 'afterpay (new)':'Afterpay (trả góp)', afterpay:'Afterpay (trả góp)'};
      // Gateways that never carry a per-transaction fee: gift cards, Shop Cash rewards and manual/COD orders.
      const GW_NO_FEE = new Set(['gift_card','shop_cash','manual']);
      let lbl = 'Phí cổng thanh toán — Shopify Payments, phí thật theo từng giao dịch ('+a.paymentFeeOrders.toLocaleString('en-US')+' đơn)';
      if(a.paymentFeeDays<a.n) lbl += ' ('+(a.n-a.paymentFeeDays)+' ngày ngoài cửa sổ đồng bộ = $0)';
      rows.push({...stLine(lbl, -a.paymentFees, nr, 'var', 'opvar'), neg:true, live:true});
      Object.entries(a.feeTypeMix).sort((x,y)=>y[1]-x[1]).forEach(([k,v])=>{
        const FT = {domestic_card_not_present:'thẻ nội địa 2.25% + $0.30', premium_domestic_card_not_present:'thẻ premium 2.95% + $0.30', amex_card_not_present:'Amex 2.95% + $0.30', international_card_not_present:'thẻ quốc tế 3.25% + $0.42', foreign_exchange_fee:'phí quy đổi ngoại tệ 1.5%'};
        rows.push({...stLine((FT[k]||k), -v, nr, null, 'opvar'), detail:true, neg:true, live:true});
      });
      Object.entries(a.gatewayMix).filter(([g])=>g!=='shopify_payments' && !(g==='paypal' && a.paypalDays>0)).sort((x,y)=>y[1].amount-x[1].amount).forEach(([g,v])=>{
        const base = (GW_LABEL[g]||g)+' — '+v.orders.toLocaleString('en-US')+' đơn, '+money(v.amount)+' thu qua cổng này';
        if(GW_NO_FEE.has(g)) rows.push({...stLine(base+' — cổng này không thu phí giao dịch', 0, nr, null, 'opvar'), detail:true, live:true});
        else rows.push({...stLine(base+' — phí chưa kết nối', 0, nr, null, 'opvar'), detail:true, neg:true, gap:true});
      });
    } else if(a.paypalDays===0){
      rows.push({...stLine('Phí cổng thanh toán (Shopify Payments / PayPal / ShopPay) — chưa kết nối', -a.paymentFees, nr, 'var', 'opvar'), neg:true, gap:true});
    }
    if(a.paypalDays>0){
      let plbl = 'Phí PayPal — phí thật theo từng giao dịch ('+a.paypalPaymentsCount.toLocaleString('en-US')+' thanh toán, '+money(a.paypalPayments)+' thu qua PayPal)';
      if(a.paypalDays<a.n) plbl += ' ('+(a.n-a.paypalDays)+' ngày ngoài cửa sổ đồng bộ = $0)';
      rows.push({...stLine(plbl, -a.paypalFees, nr, 'var', 'opvar'), neg:true, live:true});
      const pc = a.paypalCompare;
      if(pc && pc.shopify>0){
        const gap = pc.paypal - pc.shopify, pct = pc.paypal ? (Math.min(pc.shopify, pc.paypal)/pc.paypal*100) : 0;
        rows.push({...stLine('Đối chiếu '+pc.days+' ngày cả hai cùng live: Shopify ghi '+money(pc.shopify)+' qua PayPal ('+pc.shopifyOrders.toLocaleString('en-US')+' đơn) · PayPal ghi '+money(pc.paypal)+' ('+pc.paypalCount.toLocaleString('en-US')+' thanh toán) · khớp '+pct.toFixed(1)+'%'+(Math.abs(gap)>=1 ? ', chênh '+money(gap)+' = thanh toán của đơn đã huỷ / ngoài Shopify' : ''), 0, nr, null, 'opvar'), detail:true, live:true});
      }
    }
    if(a.amazonOrdersReal>0){
      const feeOrdered = a.amazonFeeOrderedDays>0;
      const feeBasisTxt = feeOrdered ? ' — theo ngày đặt hàng (đơn chưa ship: phí vào khi Amazon ship)' : ' — theo ngày ship (Finances)';
      rows.push({...stLine('Phí giới thiệu Amazon (Referral fees)'+feeBasisTxt, -a.amazonReferralFeesReal, nr, 'var', 'opvar'), neg:true, live: feeOrdered});
      rows.push({...stLine(feeOrdered ? 'Phí dịch vụ Amazon (subscription, xử lý trả hàng, removal, Vine/coupon — không gồm lưu kho tháng)' : 'Phí dịch vụ Amazon (subscription, lưu kho FBA, xử lý trả hàng, removal, Vine/coupon)', -a.amazonServiceFeesReal, nr, 'var', 'opvar'), neg:true, gap: a.amazonServiceFeesReal===0});
      if(feeOrdered){
        let sl = 'Phí lưu kho FBA hàng tháng — ghi vào tháng lưu kho (Amazon thu ngày 7 tháng sau)';
        if(a.amazonStorageMissingDays>0) sl += ' ('+a.amazonStorageMissingDays+' ngày thuộc tháng Amazon chưa thu phí = $0)';
        rows.push({...stLine(sl, -a.amazonStorageAlloc, nr, 'var', 'opvar'), neg:true, live:true});
        if(Math.abs(a.amazonStoragePosted) >= 0.01) rows.push({...stLine('Đối chiếu: Amazon thu phí lưu kho '+money(a.amazonStoragePosted)+' trong khoảng này (ngày 7–15 hàng tháng, cho tháng trước)', 0, nr, null, 'opvar'), detail:true, live:true});
      }
      // Script schema 2 splits the per-order "other" fees out of the catch-all; on older
      // JSON they are still inside the catch-all and this line would be a misleading $0.
      const amazonSchema2 = !!(amazonMeta && amazonMeta.schema >= 2);
      if(amazonSchema2 || a.amazonOtherFeesReal !== 0){
        rows.push({...stLine('Phí Amazon khác (thu hộ sales tax, shipping chargeback/holdback, phí xử lý hoàn tiền, postage nhãn trả hàng)' + (feeOrdered ? ' — theo ngày đặt hàng, gồm điều chỉnh phí khi hoàn tiền' : ''), -a.amazonOtherFeesReal, nr, 'var', 'opvar'), neg: a.amazonOtherFeesReal>=0});
        if(feeOrdered && Math.abs(a.amazonRefundFeeAdj) >= 0.01) rows.push({...stLine('… trong đó Amazon trả lại phí khi hoàn tiền (theo ngày hoàn): '+money(a.amazonRefundFeeAdj), 0, nr, null, 'opvar'), detail:true, live:true});
      }
      const catchAllLabel = amazonSchema2
        ? 'Điều chỉnh Amazon & khoản chưa phân loại (reimbursement, reserve, liquidation, mục chưa map)'
        : 'Phí Amazon khác/chưa phân loại (gift wrap, sales tax fee, shipping chargeback...)';
      rows.push({...stLine(catchAllLabel, -a.amazonOtherUnclassifiedCost, nr, 'var', 'opvar'), neg: a.amazonOtherUnclassifiedCost>=0});
    } else {
      rows.push({...stLine('Phí sàn Amazon (khoảng này chưa có dữ liệu SP-API)', 0, nr, 'var', 'opvar'), neg:true, gap:true});
    }
    rows.push({...stLine('Phí sàn Walmart — chưa kết nối', -a.walmartFees, nr, 'var', 'opvar'), neg:true, gap:true});
    rows.push({...stLine('Phí sàn TikTok Shop — chưa kết nối', -a.tiktokFees, nr, 'var', 'opvar'), neg:true, gap:true});
    AD_KEYS.forEach(k=>{
      let label = 'Quảng cáo — '+AD_LABEL[k];
      let live = false, gap = false;
      if(k==='amazonads'){ label += ' (chờ Amazon duyệt Advertising API)'; gap = true; }
      else if(AD_UNCONNECTED[k]){ label += ' — chưa kết nối'; gap = true; }
      if(k==='meta'){
        if(a.metaAdsRealDays===a.n){ live = true; }
        else if(a.metaAdsRealDays>0){ live = true; label += ' ('+(a.n-a.metaAdsRealDays)+' ngày ngoài cửa sổ Marketing API = $0)'; }
        else { label += metaMatched ? ' (khoảng này ngoài cửa sổ Marketing API)' : ' — chưa kết nối'; gap = true; }
      }
      if(k==='google'){
        if(a.googleAdsRealDays===a.n){ live = true; }
        else if(a.googleAdsRealDays>0){ live = true; label += ' ('+(a.n-a.googleAdsRealDays)+' ngày ngoài cửa sổ Google Ads API = $0)'; }
        else { label += googleMatched ? ' (khoảng này ngoài cửa sổ Google Ads API)' : ' — chưa kết nối'; gap = true; }
      }
      rows.push({...stLine(label, -a.ads[k], nr, 'var', 'opvar'), neg:true, live, gap});
    });
    if(a.snowballRealDays>0){
      let label = 'Hoa hồng influencer/affiliate — Snowball · '+a.snowballOrders.toLocaleString('en-US')+' đơn referral';
      if(a.snowballRealDays<a.n) label += ' ('+(a.n-a.snowballRealDays)+' ngày ngoài cửa sổ đồng bộ chưa tính)';
      rows.push({...stLine(label, -a.snowballCommission, nr, 'var', 'opvar'), neg: a.snowballCommission>=0, live:true});
    } else if(shopifyMatched){
      rows.push({...stLine('Hoa hồng influencer/affiliate — Snowball (khoảng này ngoài cửa sổ đồng bộ Shopify — chưa có số)', 0, nr, 'var', 'opvar'), neg:true, gap:true});
    }
    rows.push(stSub('= Tổng chi phí biến đổi khác', -a.otherVarTotal, nr, 'opvar_sub'));
    rows.push(stSub('= Lợi nhuận đóng góp (Contribution Margin)', a.contributionProfit, nr, 'cm'));

    rows.push(stSection('Chi phí cố định (G&A + tồn kho)','fixed'));
    a.gaItems.forEach(it=>{
      rows.push({...stLine(it.label + (it.real ? '' : ' — chưa nhập'), -it.value, nr, 'fix', 'fixed'), neg:true, live: it.real ? 'real' : false, gap: !it.real});
    });
    rows.push({...stLine('Chi phí tồn kho (holding cost) — chưa nhập', -a.inventoryHolding, nr, 'fix', 'fixed'), neg:true, gap:true});
    rows.push(stSub('= Tổng chi phí cố định', -a.fixedTotal, nr, 'fixed_sub'));

    rows.push(stFinal('= Lợi nhuận ròng (Net Profit)', a.netProfit, nr));
    return rows;
  }

  const SECTION_DEFAULT_OPEN = {cogs:true, opvar:true, fixed:true};

  function renderStatement(){
    const rows = currentRows();
    const a = aggregate(rows);
    const built = buildRows(a);
    let html = `<thead><tr><th>Khoản mục</th><th class="num">Số tiền</th><th class="pct">% DT thuần</th></tr></thead><tbody>`;
    let curSection = null, sectionOpen = true;
    built.forEach(r=>{
      if(r.t==='section'){
        curSection = r.key;
        sectionOpen = collapsed[curSection]===undefined ? SECTION_DEFAULT_OPEN[curSection] : !collapsed[curSection];
        html += `<tr class="section" data-toggle="${r.key}"><td class="label" colspan="3"><span class="caret ${sectionOpen?'open':''}">▸</span> ${r.label}</td></tr>`;
        return;
      }
      const hiddenCls = (r.t==='line' && curSection && r.key===curSection && !sectionOpen) ? 'hidden' : '';
      if(r.t==='line'){
        const tagHtml = r.tag ? `<span class="tag ${r.tag}"><span class="d"></span>${r.tag==='var'?'Biến đổi':'Cố định'}</span>` : '';
        const gapHtml = r.gap ? `<span class="tag gap"><span class="d"></span>Chưa kết nối ($0)</span>` : '';
        const liveHtml = r.live ? `<span class="tag live"><span class="d"></span>${r.live==='real'?'Số thật':'Live'}</span>` : '';
        const detailCls = r.detail ? 'detail' : '';
        html += `<tr class="line ${r.neg?'neg':''} ${detailCls} ${hiddenCls}" data-sec="${curSection||''}"><td class="label">${r.label}${tagHtml}${gapHtml}${liveHtml}</td><td class="num">${money(r.value)}</td><td class="pct">${pctStr(r.pct)}</td></tr>`;
      } else if(r.t==='subtotal'){
        html += `<tr class="subtotal"><td class="label">${r.label}</td><td class="num">${money(r.value)}</td><td class="pct">${pctStr(r.pct)}</td></tr>`;
      } else if(r.t==='final'){
        html += `<tr class="final"><td class="label">${r.label}</td><td class="num">${money(r.value)}</td><td class="pct">${pctStr(r.pct)}</td></tr>`;
      }
    });
    html += '</tbody>';
    const table = document.getElementById('stmtTable');
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
    const ck = unit+':'+key;
    if(trendCache[ck]) return trendCache[ck];
    const rows = unit==='week' ? weekMap[key] : monthMap[key];
    const a = aggregate(rows);
    const lastIso = rows[rows.length-1].iso, today = days[TOTAL_DAYS-1].iso;
    const full = unit==='week' ? rows.length===7 : rows.length===new Date(parseInt(key.slice(0,4),10), parseInt(key.slice(5,7),10), 0).getDate();
    const v = {rev: a.netRevenue, varc: a.variableTotal, fixc: a.fixedTotal, cost: a.netRevenue - a.netProfit, profit: a.netProfit, days: rows.length, partial: !full || lastIso===today,
               label: unit==='week' ? WEEK_LABEL(key) : MONTH_LABEL(key), short: unit==='week' ? fmtDate(rows[0].date) : ('T'+parseInt(key.slice(5,7),10)+'/'+key.slice(2,4))};
    trendCache[ck] = v; return v;
  }
  function renderTrend(){
    const card = document.getElementById('trendCard');
    const spec = trendBucketsFor();
    if(!spec || spec.keys.length<2){ card.style.display='none'; return; }
    card.style.display = '';
    const pts = spec.keys.map(k=>({key:k, ...trendValue(spec.unit, k)}));
    document.getElementById('trendTitle').textContent = spec.unit==='week' ? 'Xu hướng theo tuần' : 'Xu hướng theo tháng';
    document.getElementById('trendNote').textContent = (spec.unit==='week' ? pts.length+' tuần (Thứ Hai → Chủ Nhật)' : pts.length+' tháng') + ' · ' + pts[0].short + ' → ' + pts[pts.length-1].short + ' · cùng số với bảng P&L bên dưới';
    const revC = resolveVar('var(--series-1)'), varC = resolveVar('var(--series-cost)'), fixC = resolveVar('var(--series-fixed)'), profC = resolveVar('var(--series-4)');
    const grid_ = resolveVar('var(--gridline)'), muted = resolveVar('var(--ink-muted)'), ink = resolveVar('var(--ink-primary)'), accent = resolveVar('var(--accent)'), surface = resolveVar('var(--surface-card)');
    // 4 lines on one $ scale: fixed cost is dashed (second cue besides colour), each line is labelled at its last point
    const allSeries = [
      {id:'rev', name:'Doanh thu thuần', color: revC},
      {id:'varc', name:'Chi phí biến đổi', color: varC},
      {id:'fixc', name:'Chi phí cố định', color: fixC, dash:'6,4'},
      {id:'profit', name:'Lợi nhuận ròng', color: profC},
    ];
    const series = allSeries.filter(sr=>!trendHidden.has(sr.id));
    const legend = document.getElementById('trendLegend');
    legend.innerHTML = allSeries.map(sr=>{
      const off = trendHidden.has(sr.id);
      const sw = sr.dash ? `background:repeating-linear-gradient(90deg,${sr.color} 0 3px,transparent 3px 5px);height:3px;width:14px;border-radius:0` : `background:${sr.color}`;
      return `<button type="button" class="li${off?' off':''}" data-series="${sr.id}" aria-pressed="${!off}" title="Bấm để ẩn/hiện đường này"><span class="sw" style="${sw}"></span>${sr.name}</button>`;
    }).join('');
    legend.querySelectorAll('button[data-series]').forEach(b=>b.addEventListener('click', ()=>{
      const id = b.dataset.series;
      if(trendHidden.has(id)) trendHidden.delete(id); else if(trendHidden.size < allSeries.length-1) trendHidden.add(id);
      renderTrend();
    }));
    const W=1120, H=300, padL=64, padR=110, padT=18, padB=34, plotW=W-padL-padR, plotH=H-padT-padB;
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
    const every = Math.max(1, Math.ceil(n/13));
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
      const pctOf = v => p.rev ? (v/p.rev*100).toFixed(1)+'% DT' : '—';
      tip.innerHTML = `<div class="t-title">${p.label}${p.partial?' · chưa kết thúc':''}</div>`
        + allSeries.map(sr=>`<div class="t-row"><span style="color:${sr.color}">■ ${sr.name}</span><span>${money(p[sr.id])}${sr.id==='varc'||sr.id==='fixc'?' · '+pctOf(p[sr.id]):''}</span></div>`).join('')
        + `<div class="t-row"><span>Tổng chi phí</span><span>${money(p.cost)}</span></div><div class="t-row"><span>Biên LN ròng</span><span>${p.rev ? (p.profit/p.rev*100).toFixed(1)+'%' : '—'}</span></div>`;
      const left = (ev.clientX-rect.left), top = (ev.clientY-rect.top);
      tip.style.left = Math.min(left+14, wrap.clientWidth-230)+'px'; tip.style.top = Math.max(0, top-70)+'px'; tip.style.opacity = '1';
    };
    hit.addEventListener('mousemove', onMove);
    hit.addEventListener('mouseleave', ()=>{ tip.style.opacity='0'; cursor.setAttribute('opacity','0'); });
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
    const gap = a.netRevenue - a.breakEvenRevenue;
    grid.innerHTML = `
      <div class="be-stat"><div class="l">Tổng chi phí cố định</div><div class="v">${money(a.fixedTotal)}</div></div>
      <div class="be-stat"><div class="l">Biên đóng góp (CM %)</div><div class="v">${(a.cmRatio*100).toFixed(1)}%</div></div>
      <div class="be-stat"><div class="l">Doanh thu hoà vốn</div><div class="v">${money(a.breakEvenRevenue)}</div></div>
      <div class="be-stat"><div class="l">${gap>=0?'Vượt hoà vốn':'Còn thiếu để hoà vốn'}</div><div class="v ${gap>=0?'good':'bad'}">${money(Math.abs(gap))}</div></div>
    `;

    const W=1120,H=260,padL=56,padR=16,padT=16,padB=30;
    const plotW=W-padL-padR, plotH=H-padT-padB;
    const maxX = Math.max(a.breakEvenRevenue, a.netRevenue)*1.45;
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
      svg += `<text x="${bx}" y="${by-10}" text-anchor="middle" font-size="10.5" fill="${curColor}" font-family="var(--font-body)" font-weight="600">Hoà vốn: ${money(a.breakEvenRevenue,{compact:true})}</text>`;
    }
    // current point
    const cx_ = x(a.netRevenue), ccost = a.fixedTotal + a.variableRatio*a.netRevenue;
    svg += `<line x1="${cx_}" y1="${padT}" x2="${cx_}" y2="${H-padB}" stroke="${muted}" stroke-width="1" stroke-dasharray="3,3"/>`;
    svg += `<circle cx="${cx_}" cy="${y(a.netRevenue)}" r="4" fill="${revColor}"/>`;
    svg += `<text x="${cx_}" y="${H-10}" text-anchor="middle" font-size="9.5" fill="${muted}" font-family="var(--font-mono)">Hiện tại</text>`;
    svg += `<text x="${W-padR}" y="${padT+10}" text-anchor="end" font-size="10.5" fill="${revColor}" font-family="var(--font-body)" font-weight="600">■ Doanh thu</text>`;
    svg += `<text x="${W-padR}" y="${padT+24}" text-anchor="end" font-size="10.5" fill="${costColor}" font-family="var(--font-body)" font-weight="600">■ Tổng chi phí</text>`;
    svg += `</svg>`;
    document.getElementById('beChart').outerHTML = svg.replace('<svg ','<svg id="beChart" ');
  }

  // ---------- ROAS / MER ----------
  function renderRoas(){
    const rows = currentRows();
    const a = aggregate(rows);
    const colors = [resolveVar('var(--series-1)'),resolveVar('var(--series-2)'),resolveVar('var(--series-4)'),resolveVar('var(--series-3)'),resolveVar('var(--series-5)')];
    document.getElementById('roasGrid').innerHTML = AD_KEYS.map((k,i)=>{
      const roas = a.ads[k]>0 ? a.adsAttr[k]/a.ads[k] : 0;
      const noteStar = k==='amazonads' ? ' *' : '';
      const realDays = k==='meta' ? a.metaAdsRealDays : k==='google' ? a.googleAdsRealDays : 0;
      const realPurch = k==='meta' ? a.metaAdsPurchases : k==='google' ? a.googleAdsPurchases : 0;
      const unconnected = !!AD_UNCONNECTED[k] || (k==='meta' && !metaMatched) || (k==='google' && !googleMatched);
      const liveTag = unconnected
        ? `<span class="tag gap" style="margin-left:6px;"><span class="d"></span>Chưa kết nối</span>`
        : realDays>0 ? `<span class="tag live" style="margin-left:6px;"><span class="d"></span>${realDays===a.n?'Live':'Live một phần'}</span>`
        : `<span class="tag info" style="margin-left:6px;"><span class="d"></span>Ngoài cửa sổ</span>`;
      const extra = realDays>0 ? ` · ${Math.round(realPurch).toLocaleString('en-US')} ${k==='google'?'conv.':'đơn'} quy về` : '';
      return `<div class="roas-card" style="--c:${colors[i]}">
        <div class="p">${AD_LABEL[k]}${noteStar}${liveTag}</div>
        <div class="roas">${a.ads[k]>0 ? roas.toFixed(2)+'x' : '—'}</div>
        <div class="sub">Chi: ${money(a.ads[k])} · DT quy về: ${money(a.adsAttr[k])}${extra}</div>
      </div>`;
    }).join('');
    document.getElementById('merValue').textContent = a.adSpend>0 ? a.merValue.toFixed(2)+'x' : '—';
  }

  // ---------- tax ----------
  function renderTax(){
    const rows = currentRows();
    const a = aggregate(rows);
    const shopifyNote = shopifyMatched
      ? (a.shopifyRealDays<a.n ? ` <span style="color:var(--ink-muted);font-size:11px;">(${a.n-a.shopifyRealDays} ngày ngoài cửa sổ đồng bộ)</span>` : '')
      : ' <span class="tag gap"><span class="d"></span>Chưa kết nối ($0)</span>';
    const body = `<tr>
        <td class="name">Shopify — thuế thu hộ khách, đã trừ thuế hoàn lại (= Taxes trên Shopify Analytics)${shopifyNote}</td>
        <td class="num">${money(a.shopifyTax)}</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td><span class="pill warn">Chưa nối nguồn nộp thuế</span></td>
      </tr>
      <tr>
        <td class="name">Amazon — marketplace facilitator <span style="color:var(--ink-muted);font-size:11px;">(Amazon tự thu &amp; nộp hộ, không qua Cattasaurus)</span></td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">$0</td>
        <td><span class="pill ok">Amazon nộp hộ</span></td>
      </tr>
      <tr>
        <td class="name">Walmart / TikTok Shop <span class="tag gap"><span class="d"></span>Chưa kết nối ($0)</span></td>
        <td class="num">$0</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td><span class="pill warn">Chưa kết nối</span></td>
      </tr>`;
    document.getElementById('taxBody').innerHTML = body;
  }

  function renderSources(){
    document.getElementById('sourceGrid').innerHTML = SOURCES.map(s=>`
      <div class="src"><span class="dot ${s.level}"></span><span class="name">${s.name}</span><span class="age">${s.age}</span></div>
    `).join('');
  }
  function setSource(key, level, age){
    const s = SOURCES.find(x=>x.key===key);
    if(s){ s.level=level; s.age=age; }
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
      html += `<div><span class="tag live"><span class="d"></span>Theo ngày đặt</span> <b>Doanh thu Amazon</b> trong khoảng đang xem: <b>${money(ordered)}</b> theo ngày khách đặt (All Orders report — cách Seller Central/Sellerboard tính) so với ${money(posted)} theo ngày Amazon ship &amp; ghi nhận tiền (Finances). Phí, hoàn tiền vẫn theo ngày ghi nhận.${mcfU?` Đơn MCF (Shopify do FBA ship) tách riêng: ${mcfO.toLocaleString('en-US')} đơn / ${mcfU.toLocaleString('en-US')} units — không tính vào doanh thu Amazon.`:''}${pend?` ${pend.toLocaleString('en-US')} units đang Pending chưa có giá (Amazon chưa công bố) → chưa vào doanh thu.`:''}</div>`;
    }
    if(svcTotal===0){
      const svcNote = schema2
        ? 'Script v2 đã xử lý ServiceFeeEventList + removal fees nhưng SP-API Finances vẫn không trả về khoản nào trong cửa sổ đồng bộ — xem log loại sự kiện bên dưới; nếu vẫn trống sau vài lần sync, cần lấy từ Reports API (báo cáo phí lưu kho FBA hàng tháng) thay vì Finances.'
        : 'SP-API Finances trả về $0 cho tài khoản này dù Cattasaurus đang trả phí lưu kho thật; script v2 (chờ thay file trong repo ctu-fin-sync-8x2k) sẽ log chi tiết để tìm chỗ khoản này nằm.';
      html += `<div><span class="tag gap"><span class="d"></span>Chưa capture ($0)</span> <b>Phí dịch vụ Amazon</b> (subscription + lưu kho FBA) — ${svcNote}</div>`;
    } else {
      html += `<div><span class="tag live"><span class="d"></span>Đã capture</span> <b>Phí dịch vụ Amazon</b> (subscription + lưu kho/removal FBA) — ${money(svcTotal)} trong cửa sổ đồng bộ hiện tại.</div>`;
    }
    html += `<div><span class="tag gap"><span class="d"></span>Chưa kết nối ($0)</span> <b>Amazon Ads</b> (Sponsored Products/Brands/Display) — SP-API Finances không trả về ad spend; hiển thị $0 cho tới khi Amazon duyệt quyền Advertising API (đã nộp hồ sơ, đang chờ).</div>`;
    if(schema2){
      html += `<div><span class="tag live"><span class="d"></span>Đã phân loại</span> Gift wrap (doanh thu), hoa hồng gift wrap (phí giới thiệu), phí thu hộ sales tax / shipping chargeback / holdback / phí xử lý hoàn tiền / postage nhãn trả hàng (dòng "Phí Amazon khác"), phí ship hàng trả & restocking (gộp vào hoàn tiền), removal/liquidation (phí dịch vụ + điều chỉnh), SAFE-T & bồi hoàn kho (điều chỉnh). <b>Cước &amp; thuế nhập hàng vào FBA</b> tách thành dòng riêng trong COGS (giá vốn tồn kho, Amazon xuất hoá đơn theo lô nên ngày có hoá đơn sẽ lõm sâu — đọc theo tháng). Bỏ qua có chủ đích vì không thuộc P&amp;L: debt recovery, retrocharge thuế, và Reserve credit/debit (tiền Amazon tạm giữ rồi trả).</div>`;
    }
    html += '</div>';
    if(warnings.length){
      const cap = schema2
        ? 'Loại phí/sự kiện script v2 vẫn chưa map được ở lần đồng bộ gần nhất (đang nằm ở dòng "Điều chỉnh & chưa phân loại" hoặc "Phí dịch vụ" — cần bổ sung vào bảng map):'
        : 'Loại phí/sự kiện "chưa phân loại" script gặp phải ở lần đồng bộ gần nhất (tạm gộp vào dòng "Phí Amazon khác/chưa phân loại" ở trên — script v2 đã map toàn bộ các loại này, chờ thay file trong repo):';
      html += `<div class="caption" style="padding-left:0;margin:10px 0 6px;">${cap}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${warnings.map(w=>`<span class="pill warn">${w}</span>`).join('')}</div>`;
    }
    if(diag){
      const fmtMap = (obj, moneyVals) => Object.keys(obj||{}).length
        ? Object.keys(obj).map(k=>`<span class="pill ok" style="font-weight:500;">${k}: ${moneyVals ? money(obj[k]) : obj[k]}</span>`).join('')
        : '<span class="pill warn">không có</span>';
      html += `<div class="caption" style="padding-left:0;margin:12px 0 6px;">Log lần đồng bộ gần nhất — loại phí dịch vụ Amazon gửi về (nơi phí subscription/lưu kho phải xuất hiện):</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${fmtMap(diag.service_fee_types, true)}</div>
        <div class="caption" style="padding-left:0;margin:10px 0 6px;">Loại điều chỉnh (adjustment) theo tổng tiền:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${fmtMap(diag.adjustment_types, true)}</div>
        <div class="caption" style="padding-left:0;margin:10px 0 6px;">Số sự kiện theo danh sách (kể cả danh sách trống) · bỏ qua có chủ đích: ${fmtMap(diag.ignored_event_lists, false)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${fmtMap(diag.event_lists, false)}</div>`;
    }
    document.getElementById('amazonGapsBody').innerHTML = html;
  }

  // ---------- wire up ----------
  function renderAll(){
    renderSubCtl(); renderKpis(); renderTrend(); renderStatement(); renderBreakeven(); renderRoas(); renderAttribution(); renderKlaviyo(); renderTax(); renderSources(); renderAmazonGaps(); renderShipmonk(); renderShopifyRecon(); renderSnowball(); renderMetaCampaigns(); renderGoogleCampaigns();
  }
  document.getElementById('modeSeg').addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    mode = btn.dataset.mode;
    [...document.querySelectorAll('#modeSeg button')].forEach(b=>b.classList.toggle('active', b===btn));
    renderAll();
  });

  // Amazon SP-API data is baked into the page at publish time (see AMAZON_DATA_INJECT
  // above) by the automated GitHub Actions -> Claude scheduled-task sync, so it's applied
  // synchronously here before the very first render.
  const amazonMatched = AMAZON_LIVE_DATA ? applyAmazonRows(AMAZON_LIVE_DATA) : false;
  if(amazonMatched){
    setSource('amazon',ageLevel(AMAZON_LIVE_DATA.generated_at), fmtAmazonAge(AMAZON_LIVE_DATA.generated_at)+fmtCoverage(AMAZON_LIVE_DATA));
    setSource('amazonfin',ageLevel(AMAZON_LIVE_DATA.generated_at), fmtAmazonAge(AMAZON_LIVE_DATA.generated_at)+fmtCoverage(AMAZON_LIVE_DATA));
  }
  const metaMatched = META_ADS_LIVE_DATA ? applyMetaAdsRows(META_ADS_LIVE_DATA) : false;
  if(metaMatched){
    setSource('meta',ageLevel(META_ADS_LIVE_DATA.generated_at), fmtAmazonAge(META_ADS_LIVE_DATA.generated_at)+fmtCoverage(META_ADS_LIVE_DATA));
  }
  const googleMatched = GOOGLE_ADS_LIVE_DATA ? applyGoogleAdsRows(GOOGLE_ADS_LIVE_DATA) : false;
  if(googleMatched){
    setSource('google',ageLevel(GOOGLE_ADS_LIVE_DATA.generated_at), fmtAmazonAge(GOOGLE_ADS_LIVE_DATA.generated_at)+fmtCoverage(GOOGLE_ADS_LIVE_DATA));
  }
  // ShipMonk fulfillment costs baked in by the same sync.
  const paypalMatched = PAYPAL_LIVE_DATA ? applyPaypalRows(PAYPAL_LIVE_DATA) : false;
  if(paypalMatched){
    setSource('paypal',ageLevel(PAYPAL_LIVE_DATA.generated_at), fmtAmazonAge(PAYPAL_LIVE_DATA.generated_at)+fmtCoverage(PAYPAL_LIVE_DATA));
  }
  const shipmonkMatched = SHIPMONK_LIVE_DATA ? applyShipmonkRows(SHIPMONK_LIVE_DATA) : false;
  if(shipmonkMatched){
    setSource('shipmonk',ageLevel(SHIPMONK_LIVE_DATA.generated_at), fmtAmazonAge(SHIPMONK_LIVE_DATA.generated_at)+fmtCoverage(SHIPMONK_LIVE_DATA));
  }
  const shipmonkInvMatched = SHIPMONK_INVOICES_LIVE_DATA ? applyShipmonkInvoiceRows(SHIPMONK_INVOICES_LIVE_DATA) : false;
  if(shipmonkInvMatched){
    const im = SHIPMONK_INVOICES_LIVE_DATA.meta || {};
    const fmtD = k => k ? k.slice(8,10)+'/'+k.slice(5,7)+'/'+k.slice(0,4) : '';
    setSource('shipmonk_inv',(SHIPMONK_INVOICES_LIVE_DATA.meta && SHIPMONK_INVOICES_LIVE_DATA.meta.current_period ? 'g' : 'w'), fmtAmazonAge(SHIPMONK_INVOICES_LIVE_DATA.generated_at) + (im.first_day ? ' · hoá đơn '+fmtD(im.first_day)+' → '+fmtD(im.last_day) : '') + (im.missing_count ? ' (thiếu '+im.missing_count+' ngày)' : ''));
  }
  // Klaviyo (email + SMS) attribution + campaign/flow performance, and the Klaviyo invoices (cost).
  const klaviyoMatched = KLAVIYO_LIVE_DATA ? applyKlaviyoRows(KLAVIYO_LIVE_DATA) : false;
  const klaviyoInvMatched = KLAVIYO_INVOICES_LIVE_DATA ? applyKlaviyoInvoiceRows(KLAVIYO_INVOICES_LIVE_DATA) : false;
  if(klaviyoMatched || klaviyoInvMatched){
    const km = (KLAVIYO_INVOICES_LIVE_DATA && KLAVIYO_INVOICES_LIVE_DATA.meta) || {};
    const fmtD = k => k ? k.slice(8,10)+'/'+k.slice(5,7)+'/'+k.slice(0,4) : '';
    setSource('klaviyo',(klaviyoMatched ? ageLevel(KLAVIYO_LIVE_DATA.generated_at) : 'w'), (klaviyoMatched ? fmtAmazonAge(KLAVIYO_LIVE_DATA.generated_at)+fmtCoverage(KLAVIYO_LIVE_DATA) : 'API chưa có') + (klaviyoInvMatched ? ' · hoá đơn đến '+fmtD(km.last_day) : ' · chưa có hoá đơn'));
  }
  // Shopify + Snowball baked in by the same hourly sync.
  const shopifyMatched = SHOPIFY_LIVE_DATA ? applyShopifyLive(SHOPIFY_LIVE_DATA) : false;
  if(shopifyMatched){
    setSource('shopify',ageLevel(SHOPIFY_LIVE_DATA.generated_at), fmtAmazonAge(SHOPIFY_LIVE_DATA.generated_at)+fmtCoverage(SHOPIFY_LIVE_DATA));
    setSource('snowball',ageLevel(SHOPIFY_LIVE_DATA.generated_at), fmtAmazonAge(SHOPIFY_LIVE_DATA.generated_at)+fmtCoverage(SHOPIFY_LIVE_DATA));
  }
  // Human-readable list of the sources that are baked in live, for the banner text.
  function bakedLiveNames(){
    const names = [];
    if(shopifyMatched) names.push('Shopify (Admin API thật)');
    if(shopifyMatched) names.push('Snowball (hoa hồng từ tag Shopify)');
    if(amazonMatched) names.push('Amazon (SP-API thật)');
    if(metaMatched) names.push('Meta Ads (Marketing API thật)');
    if(googleMatched) names.push('Google Ads (Google Ads API thật)');
    if(shipmonkMatched) names.push('ShipMonk (API thật — phí fulfillment theo đơn)');
    if(shipmonkInvMatched) names.push('ShipMonk hoá đơn (lưu kho, receiving, hàng trả, bao bì)');
    if(paypalMatched) names.push('PayPal (API thật — phí giao dịch)');
    if(klaviyoMatched) names.push('Klaviyo (API thật — email & SMS)');
    if(klaviyoInvMatched) names.push('hoá đơn Klaviyo (chi phí gói)');
    return names;
  }
  renderAll();

  // ---------- live data via mcp capability (Shopify) ----------
  function setLiveBanner(html, tone){
    const el = document.getElementById('liveBanner');
    el.innerHTML = html;
    const toneColor = tone==='good' ? 'var(--status-good)' : tone==='bad' ? 'var(--status-critical)' : 'var(--accent)';
    el.style.borderColor = `color-mix(in srgb, ${toneColor} 35%, var(--border))`;
    el.style.background = `color-mix(in srgb, ${toneColor} 8%, var(--surface-card))`;
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

  function applyShipmonkRows(data){
    if(!data || !data.daily) return false;
    shipmonkMeta = data;
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
      };
      matched++;
    });
    // Days inside the sync window with no orders still count as real ($0) days.
    if(data.window && data.window.start && data.window.end){
      days.forEach(d=>{ if(!d.shipmonkReal && d.iso>=data.window.start && d.iso<=data.window.end) d.shipmonkReal = {orders:0,units:0,packages:0,shipping:0,packaging:0,pickPack:0,total:0,missing:0,shipped:0,unshipped:0,onhold:0,byStore:{},byType:{},byCarrier:{}}; });
    }
    return matched>0;
  }
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
    days.forEach(d=>{
      const r = data.daily[d.iso];
      if(!r) return;
      const f = k => parseFloat(r[k])||0;
      const tu = trueUp[r.invoice];
      d.shipmonkInv = {storage:f('storage'), receiving:f('receiving'), returns:f('returns'), packaging_purchases:f('packaging_purchases'), fees_other:f('fees_other'),
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
    if(/amazon|fbm|mcf/i.test(n)) return 'Amazon FBM qua ShipMonk — store "'+n+'"';
    if(/walmart/i.test(n)) return 'Walmart qua ShipMonk — store "'+n+'"';
    if(/tiktok/i.test(n)) return 'TikTok Shop qua ShipMonk — store "'+n+'"';
    if(/manual/i.test(n)) return 'Đơn tạo tay trên ShipMonk — store "'+n+'"';
    if(/return|reship|claim/i.test(n)) return 'Gửi lại hàng trả / claim — store "'+n+'"';
    if(/shopify|shop|cattasaurus\.com|web/i.test(n)) return 'Shopify qua ShipMonk — store "'+n+'"';
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
      jr.innerHTML = `<span class="tag gap" style="margin-left:0;"><span class="d"></span>Chưa có dữ liệu hành trình</span> Các ngày trong kỳ này được đồng bộ trước bản Shopify v1.8 — chạy backfill (2025-01-01 → 2025-06-30, 2025-07-01 → 2025-12-31, 2026-01-01 → nay) để có phân kênh cho toàn bộ lịch sử.`;
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
    const cov = t.attrDays<t.shopifyDays ? ` · ${t.attrDays}/${t.shopifyDays} ngày có hành trình` : '';
    kpis.innerHTML = `
      <div class="be-stat"><div class="l">Đơn đã phân kênh</div><div class="v">${intFmt(t.classified)}<span style="font-size:12px;color:var(--ink-muted);font-weight:500;"> / ${intFmt(shopOrders)} đơn</span></div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${t.pending ? intFmt(t.pending)+' đơn Shopify chưa attribute (đơn mới)' : 'mọi đơn trong kỳ đã có hành trình'}${cov}</div></div>
      <div class="be-stat"><div class="l">Chạm cuối = quảng cáo trả tiền</div><div class="v">${pct1(paidSales, t.sales)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${intFmt(paidOrders)} đơn · ${money(paidSales)} doanh thu thuần</div></div>
      <div class="be-stat"><div class="l">Chạm cuối = Email + SMS (Klaviyo)</div><div class="v">${pct1(klv.sales+sms.sales, t.sales)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${intFmt(klv.orders+sms.orders)} đơn · ${money(klv.sales+sms.sales)}${klv.paidFirst||sms.paidFirst ? ' · '+intFmt((klv.paidFirst||0)+(sms.paidFirst||0))+' đơn mở bằng quảng cáo' : ''}</div></div>
      <div class="be-stat"><div class="l">Kênh không trả tiền (organic, direct, email…)</div><div class="v">${pct1(ownSales, t.sales)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${money(ownSales)} · gồm cả email/SMS ở cột bên</div></div>`;
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
    let html = `<thead><tr><th>Kênh (điểm chạm cuối)</th><th style="text-align:right">Đơn</th><th style="text-align:right">% đơn</th><th style="text-align:right">Doanh thu thuần</th><th style="text-align:right">% DT</th><th style="text-align:right">AOV</th><th style="text-align:right">Khách mới</th><th style="text-align:right">Mở bằng QC trả tiền</th><th style="text-align:right">Chi phí kênh</th><th style="text-align:right">DT ÷ chi (last-touch)</th><th style="text-align:right">Nền tảng tự nhận</th></tr></thead><tbody>`;
    chans.forEach(k=>{
      const v = t.last[k]; const c = ATTR_BY_KEY[k] || {};
      const costKey = c.cost; const cost = costKey ? costOf[costKey] : null;
      const costTxt = cost===null || cost===undefined ? '<span style="color:var(--ink-muted)">—</span>' : (cost>0 ? money(cost) : '<span class="tag gap" style="margin-left:0;"><span class="d"></span>$0 chưa nối</span>');
      const roasTxt = cost>0 ? (v.sales/cost).toFixed(2)+'x' : '<span style="color:var(--ink-muted)">—</span>';
      const cl = claimOf[k];
      const claimTxt = cl ? `${intFmt(cl.orders)} đơn · ${money(cl.sales)}` : '<span style="color:var(--ink-muted)">—</span>';
      html += `<tr><td class="name"><span class="sw" style="background:${c.color||'var(--gridline)'};"></span>${ATTR_LABEL(k)}</td><td class="num">${intFmt(v.orders)}</td><td class="num">${pct1(v.orders, t.classified)}</td><td class="num">${money(v.sales)}</td><td class="num">${pct1(v.sales, t.sales)}</td><td class="num">${v.orders>0 ? money(v.sales/v.orders) : '—'}</td><td class="num">${v.newC+v.returning>0 ? pct0(v.newC, v.newC+v.returning) : '—'}</td><td class="num">${v.orders>0 ? pct0(v.paidFirst, v.orders) : '—'}</td><td class="num">${costTxt}</td><td class="num">${roasTxt}</td><td class="num sub" style="text-align:right;">${claimTxt}</td></tr>`;
    });
    html += `<tr style="font-weight:700;"><td class="name">Tổng đã phân kênh</td><td class="num">${intFmt(t.classified)}</td><td class="num">100%</td><td class="num">${money(t.sales)}</td><td class="num">100%</td><td class="num">${t.classified>0 ? money(t.sales/t.classified) : '—'}</td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td><td class="num"></td></tr></tbody>`;
    table.innerHTML = html;
    // cross-channel journeys: first session != last session
    const jkeys = Object.keys(t.journeys).filter(k=>{ const [f,l] = k.split('>'); return f!==l && !['direct','unknown'].includes(f); }).sort((x,y)=>t.journeys[y].orders - t.journeys[x].orders).slice(0,6);
    const firstPaidOrders = sum(Object.keys(t.first).filter(k=>ATTR_PAID[k]).map(k=>t.first[k].orders));
    let jhtml = `<b>Hành trình đổi kênh</b> (lượt ghé đầu → chạm cuối): ${jkeys.length ? jkeys.map(k=>{ const [f,l] = k.split('>'); const v = t.journeys[k]; return `${ATTR_LABEL(f).split(' (')[0]} → <b>${ATTR_LABEL(l).split(' (')[0]}</b> ${intFmt(v.orders)} đơn (${money(v.sales)})`; }).join(' · ') : 'không có'}.`;
    jhtml += ` Trong ${intFmt(t.classified)} đơn, <b>${pct0(firstPaidOrders, t.classified)}</b> có lượt ghé đầu từ quảng cáo trả tiền.`;
    const m2e = t.journeys['meta_paid>email'] || t.journeys['meta_paid>sms'] ? (t.journeys['meta_paid>email']||{orders:0,sales:0}).orders + (t.journeys['meta_paid>sms']||{orders:0,sales:0}).orders : 0;
    if(m2e) jhtml += ` <b>Meta mở → email/SMS chốt: ${intFmt(m2e)} đơn</b> — Meta cũng nhận, Klaviyo cũng nhận; ở bảng này chỉ tính cho email/SMS.`;
    jr.innerHTML = jhtml;
    // Klaviyo campaign / flow names behind the email + sms last-touch orders
    const enames = Object.keys(t.email).sort((x,y)=>t.email[y].sales - t.email[x].sales);
    if(enames.length){
      const top = enames.slice(0, 12); const rest = enames.slice(12);
      let eh = `<div class="subhead">Email / SMS chạm cuối theo campaign hoặc flow (tên trong utm_campaign của Klaviyo)</div><div style="overflow-x:auto;"><table class="simple" style="min-width:640px;"><thead><tr><th>Campaign / flow message</th><th>Kênh</th><th style="text-align:right">Đơn</th><th style="text-align:right">Doanh thu thuần</th><th style="text-align:right">AOV</th></tr></thead><tbody>`;
      top.forEach(nm=>{ const v = t.email[nm]; eh += `<tr><td class="name">${nm.replace(/</g,'&lt;')}</td><td>${v.medium==='sms'?'SMS':'Email'}</td><td class="num">${intFmt(v.orders)}</td><td class="num">${money(v.sales)}</td><td class="num">${money(v.sales/v.orders)}</td></tr>`; });
      if(rest.length){ const ro = sum(rest.map(n=>t.email[n].orders)), rs = sum(rest.map(n=>t.email[n].sales)); eh += `<tr><td class="name" style="color:var(--ink-muted);">+ ${rest.length} tên khác</td><td></td><td class="num">${intFmt(ro)}</td><td class="num">${money(rs)}</td><td class="num">${ro>0?money(rs/ro):'—'}</td></tr>`; }
      eh += '</tbody></table></div>';
      ew.innerHTML = eh;
    } else ew.innerHTML = '';
    const basis = (shopifyMeta.attribution && shopifyMeta.attribution.basis) || '';
    cap.innerHTML = `Nguồn: <code>Order.customerJourneySummary</code> của Shopify Admin API (sync v1.8) — cùng mô hình "last non-direct click" mà Shopify dùng cho báo cáo <i>Sales attributed to marketing</i>. Đơn có lượt cuối là direct / quay về từ Shop Pay, PayPal, Amazon Pay thì lấy lượt ghé trước đó không phải direct. Doanh thu = net sales (sau giảm giá, trước hoàn) ghi theo ngày đặt — cùng số với dòng Shopify trong P&amp;L, nên các % cộng đúng 100%. "Nền tảng tự nhận" = con số Meta / Google / Klaviyo tự báo cho cùng kỳ theo cửa sổ attribution riêng của họ (7 ngày click Meta, 5 ngày Klaviyo…) nên có thể cộng vượt 100% — dùng để so, không cộng vào doanh thu. Google Ads không gửi UTM (auto-tagging gclid bị Shopify ẩn) nên từ sync v1.9 lượt ghé từ Google đáp xuống trang đích chỉ dùng cho quảng cáo (<code>/pages/cats-love-it-2025</code>, trang sản phẩm đuôi <code>-gg</code>) được tính là Google Ads; đơn không có phiên web nào (mua ngay trong Facebook/Instagram Shop, Shop app…) tính theo kênh bán. Đơn mới trong 1–3 giờ đầu chưa được Shopify gắn hành trình (đếm ở "chưa attribute") và tự cập nhật ở lần đồng bộ sau.`;
  }

  // ---------- Klaviyo card: its own attribution next to the last-touch view, campaigns of the period, flows ----------
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
    note.textContent = 'Attribution riêng của Klaviyo (mặc định 5 ngày sau khi bấm/mở email, 1 ngày với SMS) · trùng với attribution của quảng cáo nên không cộng vào doanh thu P&L · ' + fmtAmazonAge(klaviyoMeta.generated_at) + (k.days<a.n ? ` · ${a.n-k.days} ngày trong kỳ chưa có dữ liệu Klaviyo` : '');
    const kp = document.getElementById('klaviyoKpis');
    const cost = a.klaviyoCostDays>0 ? a.klaviyoCost : null;
    const lt = (t.last.email||{orders:0,sales:0}); const ls = (t.last.sms||{orders:0,sales:0});
    const ltOrders = lt.orders + ls.orders, ltSales = lt.sales + ls.sales;
    const shopNet = a.netRevenue;
    kp.innerHTML = `
      <div class="be-stat"><div class="l">Klaviyo tự nhận (attributed)</div><div class="v">${money(k.attributedRevenue)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${intFmt(k.attributedOrders)} đơn · flow ${pct0(k.flowRevenue, k.attributedRevenue)} / campaign ${pct0(k.campaignRevenue, k.attributedRevenue)}${k.splitKnown && k.smsOrders>0 ? ' · SMS '+intFmt(k.smsOrders)+' đơn' : ''}</div></div>
      <div class="be-stat"><div class="l">Điểm chạm cuối = email/SMS (Shopify)</div><div class="v">${t.attrDays ? money(ltSales) : '—'}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${t.attrDays ? intFmt(ltOrders)+' đơn · '+pct1(ltSales, shopNet)+' doanh thu thuần Shopify' : 'chưa có hành trình cho kỳ này (backfill v1.8)'}</div></div>
      <div class="be-stat"><div class="l">Tỷ lệ đơn Klaviyo nhận / tổng đơn</div><div class="v">${k.storeKnown ? pct1(k.attributedOrders, k.storeOrders) : pct1(k.attributedOrders, a.orders.shopify)}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${k.storeKnown ? intFmt(k.storeOrders)+' đơn Klaviyo nhận từ Shopify' : 'trên '+intFmt(a.orders.shopify)+' đơn Shopify (tổng của Klaviyo có từ sync v1.1)'}</div></div>
      <div class="be-stat"><div class="l">Chi phí Klaviyo (hoá đơn) &amp; ROI</div><div class="v">${cost!==null ? money(cost) : '<span class="tag gap" style="margin-left:0;font-size:11px;"><span class="d"></span>chưa có hoá đơn</span>'}</div><div class="sub" style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${cost!==null && cost>0 ? (t.attrDays ? 'DT last-touch ÷ chi = <b>'+(ltSales/cost).toFixed(1)+'x</b> · ' : '')+'Klaviyo tự nhận ÷ chi = '+(k.attributedRevenue/cost).toFixed(1)+'x' + (a.klaviyoCostParts.upgrades||a.klaviyoCostParts.flex ? ' · gồm nâng gói '+money(a.klaviyoCostParts.upgrades)+(a.klaviyoCostParts.flex?' + vượt email '+money(a.klaviyoCostParts.flex):'') : '') : 'ROI = doanh thu email/SMS ÷ phí Klaviyo theo kỳ'}</div></div>`;
    const cmp = document.getElementById('klaviyoCompare');
    if(t.attrDays && k.days){
      const diff = k.attributedOrders - ltOrders;
      cmp.innerHTML = `<b>Hai cách đếm cùng kỳ:</b> Klaviyo tự nhận <b>${intFmt(k.attributedOrders)} đơn</b> (đơn đặt trong ${meta.attribution && /5-day/.test(meta.attribution) ? '5 ngày' : 'cửa sổ attribution'} sau khi khách bấm/mở email) so với <b>${intFmt(ltOrders)} đơn</b> có email/SMS là điểm chạm cuối theo Shopify. ${diff>0 ? `Chênh ${intFmt(diff)} đơn = khách có mở/bấm email nhưng cú chạm cuối trước khi mua là kênh khác (thường là quảng cáo Meta) hoặc vào thẳng — Meta cũng đang nhận những đơn đó.` : diff<0 ? `Shopify thấy nhiều đơn email hơn Klaviyo ${intFmt(-diff)} đơn (link email không có UTM Klaviyo hoặc ngoài cửa sổ attribution của Klaviyo).` : 'Hai cách đếm trùng nhau.'} Giá trị đơn của Klaviyo là tổng đơn (gồm ship + thuế) nên không so tiền trực tiếp với doanh thu thuần.`;
    } else cmp.innerHTML = '';
    // campaigns sent inside the selected period (local send date)
    const keys = new Set(rows.map(r=>r.iso));
    const camps = Object.entries(klaviyoMeta.campaigns||{}).map(([id,c])=>({id, ...c})).filter(c=>c.send_time && keys.has(c.send_time.slice(0,10))).sort((x,y)=> (y.send_time||'').localeCompare(x.send_time||''));
    const ct = document.getElementById('klaviyoCampaignTable');
    document.getElementById('klaviyoCampaignHead').textContent = `Campaign gửi trong kỳ (${camps.length})`;
    if(camps.length){
      let h = `<thead><tr><th>Campaign</th><th>Kênh</th><th>Gửi</th><th style="text-align:right">Người nhận</th><th style="text-align:right">Mở</th><th style="text-align:right">Click</th><th style="text-align:right">Đơn (Klaviyo)</th><th style="text-align:right">DT quy về</th><th style="text-align:right">$/người nhận</th><th style="text-align:right">Huỷ đăng ký</th></tr></thead><tbody>`;
      camps.forEach(c=>{ h += `<tr><td class="name">${(c.name||c.id).replace(/</g,'&lt;')}</td><td>${c.channel==='sms'?'SMS':'Email'}</td><td>${c.send_time.slice(8,10)}/${c.send_time.slice(5,7)}</td><td class="num">${intFmt(c.recipients||0)}</td><td class="num">${c.open_rate!=null ? (100*c.open_rate).toFixed(1)+'%' : '—'}</td><td class="num">${c.click_rate!=null ? (100*c.click_rate).toFixed(2)+'%' : '—'}</td><td class="num">${intFmt(c.conversions||0)}</td><td class="num">${money(c.conversion_value||0)}</td><td class="num">${c.recipients>0 ? '$'+((c.conversion_value||0)/c.recipients).toFixed(3) : '—'}</td><td class="num">${intFmt(c.unsubscribes||0)}</td></tr>`; });
      const tc = {r: sum(camps.map(c=>c.recipients||0)), o: sum(camps.map(c=>c.conversions||0)), v: sum(camps.map(c=>c.conversion_value||0)), u: sum(camps.map(c=>c.unsubscribes||0))};
      h += `<tr style="font-weight:700;"><td class="name">Tổng</td><td></td><td></td><td class="num">${intFmt(tc.r)}</td><td></td><td></td><td class="num">${intFmt(tc.o)}</td><td class="num">${money(tc.v)}</td><td class="num">${tc.r>0 ? '$'+(tc.v/tc.r).toFixed(3) : '—'}</td><td class="num">${intFmt(tc.u)}</td></tr></tbody>`;
      ct.innerHTML = h;
    } else ct.innerHTML = `<tbody><tr><td class="name" style="color:var(--ink-muted);">Không có campaign nào gửi trong kỳ đang xem.</td></tr></tbody>`;
    // flows: values over the sync window (Klaviyo reports flows per window, not per day)
    const flows = Object.entries(klaviyoMeta.flows||{}).map(([id,f])=>({id, ...f})).sort((x,y)=>(y.conversion_value||0)-(x.conversion_value||0));
    const win = (flows[0] && flows[0].window) || (klaviyoMeta.window) || null;
    const winTxt = win && win.start ? ` ${win.start.slice(8,10)}/${win.start.slice(5,7)} → ${win.end.slice(8,10)}/${win.end.slice(5,7)}` : '';
    document.getElementById('klaviyoFlowHead').textContent = `Flow tự động (${flows.length}) — số của cửa sổ đồng bộ${winTxt}, không theo kỳ đang chọn`;
    const ft = document.getElementById('klaviyoFlowTable');
    if(flows.length){
      let h = `<thead><tr><th>Flow</th><th>Kênh</th><th>Trạng thái</th><th style="text-align:right">Tin gửi</th><th style="text-align:right">Mở</th><th style="text-align:right">Click</th><th style="text-align:right">Đơn (Klaviyo)</th><th style="text-align:right">DT quy về</th><th style="text-align:right">$/tin</th></tr></thead><tbody>`;
      flows.slice(0, 15).forEach(f=>{ h += `<tr><td class="name">${(f.name||f.id).replace(/</g,'&lt;')}</td><td>${f.channel==='sms'?'SMS':'Email'}</td><td>${f.status||''}</td><td class="num">${intFmt(f.recipients||0)}</td><td class="num">${f.open_rate!=null ? (100*f.open_rate).toFixed(1)+'%' : '—'}</td><td class="num">${f.click_rate!=null ? (100*f.click_rate).toFixed(2)+'%' : '—'}</td><td class="num">${intFmt(f.conversions||0)}</td><td class="num">${money(f.conversion_value||0)}</td><td class="num">${f.recipients>0 ? '$'+((f.conversion_value||0)/f.recipients).toFixed(2) : '—'}</td></tr>`; });
      if(flows.length>15){ const rest = flows.slice(15); h += `<tr><td class="name" style="color:var(--ink-muted);">+ ${rest.length} flow khác</td><td></td><td></td><td class="num">${intFmt(sum(rest.map(f=>f.recipients||0)))}</td><td></td><td></td><td class="num">${intFmt(sum(rest.map(f=>f.conversions||0)))}</td><td class="num">${money(sum(rest.map(f=>f.conversion_value||0)))}</td><td></td></tr>`; }
      h += '</tbody>';
      ft.innerHTML = h;
    } else ft.innerHTML = '';
    document.getElementById('klaviyoCaption').innerHTML = `Nguồn: Klaviyo API (metric "${(meta.conversion_metric||{}).label||'Placed Order'}", Query Metric Aggregates theo ngày giờ LA; Campaign/Flow Values Reports). "Đơn (Klaviyo)" và "DT quy về" là attribution của Klaviyo — trùng với attribution của Meta/Google và với chính số Shopify, nên <b>không cộng vào doanh thu</b>; doanh thu thật của kênh email nằm ở bảng "Kênh theo điểm chạm cuối" phía trên. Mở/Click là tỷ lệ unique trên số đã gửi thành công.`;
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
      rows.push({id, name:c.name, product:c.product||'Khác', market:c.market||'', stage:c.stage||'', status:c.status||'', budget:c.daily_budget, ...derive(agg)});
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
    let html = `<thead><tr><th>Sản phẩm / campaign</th><th style="text-align:right">Chi</th><th style="text-align:right">% chi</th><th style="text-align:right">Đơn quy về</th><th style="text-align:right">CPA</th><th style="text-align:right">DT quy về</th><th style="text-align:right">ROAS</th><th style="text-align:right">AOV</th><th style="text-align:right">CTR</th><th style="text-align:right">CPM</th><th style="text-align:right">Freq≈</th></tr></thead><tbody>`;
    const cell = (r, bold) => `<td class="num" ${bold?'style="font-weight:700;color:var(--ink-primary);"':''}>${money(r.spend)}</td><td class="num">${totalSpend? (r.spend/totalSpend*100).toFixed(0):0}%</td><td class="num">${fmtN(r.purchases)}</td><td class="num" ${warnCls(r)}>${r.cpa?money(r.cpa):'—'}</td><td class="num">${money(r.purchase_value)}</td><td class="num" ${warnCls(r)}>${r.roas.toFixed(2)}x</td><td class="num">${r.aov?money(r.aov):'—'}</td><td class="num">${r.ctr.toFixed(2)}%</td><td class="num">${money(r.cpm)}</td><td class="num">${r.freq?r.freq.toFixed(2):'—'}</td>`;
    Object.keys(products).sort((a,b)=>products[b].spend-products[a].spend).forEach(p=>{
      const pr = products[p];
      html += `<tr style="background:var(--surface-card-2);"><td class="name" style="font-weight:700;">${p} <span style="color:var(--ink-muted);font-weight:400;font-size:11px;">· ${pr.n} campaign</span></td>${cell(pr,true)}</tr>`;
      rows.filter(r=>r.product===p).sort((a,b)=>b.spend-a.spend).forEach(r=>{
        html += `<tr><td class="name" style="font-weight:400;padding-left:22px;font-size:12px;">${statusDot(r.status)}${r.name}${r.market&&r.market!=='US'?` <span class="pill" style="background:var(--surface-card-3);color:var(--ink-secondary);font-weight:500;">${r.market}</span>`:''}${stagePill(r.stage)}</td>${cell(r,false)}</tr>`;
      });
    });
    const all = zero(); rows.forEach(r=>F.forEach(f=>all[f]+=r[f])); derive(all);
    html += `<tr style="border-top:1.5px solid var(--baseline);"><td class="name" style="font-weight:700;">Tổng Meta (${rows.length} campaign có chi)</td>${cell(all,true)}</tr></tbody>`;
    document.getElementById('metaCampaignTable').innerHTML = html;
    document.getElementById('metaCampaignNote').textContent = 'Marketing API · attribution '+(META_ADS_LIVE_DATA.attribution||'account default')+' · '+fmtAmazonAge(META_ADS_LIVE_DATA.generated_at)+' · chấm xanh = đang chạy, vàng = tạm dừng';
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
    let html = `<thead><tr><th>Khoản</th><th style="text-align:right">${hdrRows.length===1 ? fmtDateLong(hdrRows[0].date) : hdrRows.length+' ngày'}</th><th style="text-align:right">/ đơn</th></tr></thead><tbody>`;
    if(!sel.length) html += line('Ước tính theo từng đơn (API ShipMonk) — chưa có dữ liệu cho khoảng này (chờ backfill)', '—');
    const orderBasis = shipmonkOrderBasis();
    if(sel.length){
    const shippedN = S(r=>r.shipmonkReal.shipped), unshippedN = S(r=>r.shipmonkReal.unshipped), onholdN = S(r=>r.shipmonkReal.onhold||0);
    html += line(orderBasis ? 'Đơn ShipMonk nhận (theo ngày đặt hàng)' : 'Đơn đã ship', orders.toLocaleString('en-US'));
    if(orderBasis) html += line('… trong đó đã ship · chưa ship (ước tính ShipMonk)' + (onholdN ? ' · đang On Hold trong ShipMonk' : ''), shippedN.toLocaleString('en-US')+' · '+unshippedN.toLocaleString('en-US') + (onholdN ? ' · '+onholdN.toLocaleString('en-US') : ''));
    html += line('Units · kiện', units.toLocaleString('en-US')+' · '+packages.toLocaleString('en-US'));
    html += line('Cước vận chuyển (postage / carrier)', ship, {per: ship});
    html += line('Pick & pack (nhân công fulfillment)', pick, {per: pick});
    html += line('Vật liệu đóng gói (packaging)', pack, {per: pack});
    html += line('= Tổng chi phí fulfillment ShipMonk', total, {bold:true, per: total});
    if(missing) html += line('Đơn ShipMonk chưa có ước tính chi phí (tạm $0)', missing.toLocaleString('en-US'));
    // charges ShipMonk states in another currency (Toronto warehouse bills in CAD): shown native, already converted above
    const foreign = {}; sel.forEach(r=>{ Object.entries(r.shipmonkReal.foreign||{}).forEach(([cur,v])=>{ foreign[cur] = (foreign[cur]||0) + (parseFloat(v)||0); }); });
    const fxRates = (shipmonkMeta && shipmonkMeta.meta && shipmonkMeta.meta.fx && shipmonkMeta.meta.fx.rates_to_usd) || {};
    Object.entries(foreign).forEach(([cur,v])=>{ if(v) html += line('… trong đó phí ShipMonk ghi bằng '+cur+' (kho Toronto), đã quy đổi @ '+(fxRates[cur]!==undefined ? fxRates[cur] : '?')+' USD/'+cur, v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+cur); });
    // ship-date view of the same range, for checking against ShipMonk's weekly invoices
    if(orderBasis && shipmonkMeta && shipmonkMeta.daily_shipped){
      const ds = shipmonkMeta.daily_shipped; let shipTotal = 0, shipOrders = 0;
      sel.forEach(r=>{ const b = ds[r.iso]; if(b){ shipTotal += parseFloat(b.total_cost)||0; shipOrders += Math.round(parseFloat(b.orders)||0); } });
      html += line('Đối chiếu — cùng khoảng nhưng theo ngày ship ('+shipOrders.toLocaleString('en-US')+' đơn, khớp hoá đơn tuần ShipMonk)', shipTotal);
    }
    }
    // invoices overlapping the range: what ShipMonk actually billed on top of the per-order estimates
    if(invSel.length){
      const I = k => sum(invSel.map(r=>r.shipmonkInv[k]||0));
      const invNums = [...new Set(invSel.map(r=>r.shipmonkInv.invoice))];
      const invList = (shipmonkInvMeta.invoices||[]).filter(i=>invNums.includes(i.number));
      const per = n => fmtDateLong(new Date(n.slice(0,4), n.slice(5,7)-1, n.slice(8,10)));
      html += `<tr><td class="name" colspan="3" style="font-weight:700;padding-top:14px;">Hoá đơn ShipMonk trong khoảng (${invSel.length}/${currentRows().length} ngày có hoá đơn)</td></tr>`;
      invList.forEach(i=>{ html += line('Hoá đơn '+i.number+' · kỳ '+per(i.start)+' – '+per(i.end)+' · '+(i.orders_invoiced||0).toLocaleString('en-US')+' đơn', i.total); });
      html += line('Cước + pick & pack theo hoá đơn (phần ngày trong khoảng)', I('shipping'));
      html += line('Lưu kho (pallet & bin)', I('storage'));
      html += line('Receiving hàng nhập', I('receiving'));
      html += line('Xử lý hàng trả', I('returns'));
      html += line('Mua bao bì riêng (custom packaging)', I('packaging_purchases'));
      html += line('Phí khác (phí tối thiểu, phạt trễ, audit, phụ phí, chưa phân loại)', I('fees_other') + I('unallocated'));
      html += line('Điều chỉnh cước & credit', I('adjustments') + I('credits'));
      html += line('= Tổng theo hoá đơn (phần ngày trong khoảng)', I('total'), {bold:true});
      const cur = shipmonkInvMeta.meta && shipmonkInvMeta.meta.current_period;
      if(cur && currentRows().some(r=>r.iso>=cur.start && r.iso<=cur.end)) html += line('Kỳ '+per(cur.start)+' – '+per(cur.end)+' ShipMonk chưa chốt hoá đơn → chỉ có ước tính theo đơn', '—');
    }
    html += '</tbody>';
    document.getElementById('shipmonkTable').innerHTML = html;
    // breakdown by store / order type / carrier
    const agg = key => { const o = {}; sel.forEach(r=>{ const b = r.shipmonkReal[key]||{}; Object.keys(b).forEach(k=>{ const t = o[k] = o[k] || {orders:0,total:0}; t.orders += b[k].orders||0; t.total += (b[k].total_cost!==undefined ? b[k].total_cost : b[k].shipping_cost)||0; }); }); return Object.entries(o).sort((a,b)=>b[1].total-a[1].total); };
    const pills = (title, rows, fmt) => rows.length ? `<div style="font-size:12px;color:var(--ink-secondary);margin-top:6px;"><b>${title}:</b> ${rows.slice(0,6).map(([k,v])=>`${k==='unknown' ? 'chưa gán carrier' : k} ${money(v.total)} (${v.orders.toLocaleString('en-US')} đơn)`).join(' · ')}</div>` : '';
    document.getElementById('shipmonkBreakdown').innerHTML = sel.length ? (pills('Theo store', agg('byStore')) + pills('Theo loại đơn', agg('byType')) + pills('Cước theo carrier', agg('byCarrier'))) : '';
    const note = document.querySelector('#shipmonkCard .note');
    if(note && SHIPMONK_LIVE_DATA) note.textContent = 'Ước tính của ShipMonk cho từng đơn (cước carrier + pick & pack + vật liệu đóng gói) · ' + (orderBasis ? 'ghi theo ngày đặt hàng (giờ LA), gồm cả đơn chưa ship — cùng ngày với doanh thu' : 'ghi theo ngày ship, giờ LA') + (outside ? ` · ${outside} ngày trong khoảng ngoài cửa sổ đồng bộ` : '') + ' · ' + fmtAmazonAge(SHIPMONK_LIVE_DATA.generated_at);
    const cap = document.getElementById('shipmonkCaption');
    const csv = shipmonkMeta && shipmonkMeta.meta && shipmonkMeta.meta.orders_csv;
    if(cap && csv && !cap.querySelector('a')){
      const isDir = String(csv).endsWith('/');
      const csvPath = String(csv).startsWith('data/') ? csv : 'data/' + String(csv).replace(/\/$/, '').split('/').pop() + (isDir ? '/' : '');   // the sync commits it next to shipmonk.json
      const href = 'https://github.com/taitran-star/ctu-fin-sync-8x2k/' + (isDir ? 'tree' : 'blob') + '/main/' + csvPath.replace(/\/$/, '');
      const label = isDir ? csvPath.replace(/\/$/, '').split('/').pop() + '/ (một file CSV mỗi tháng)' : csvPath.split('/').pop();
      cap.insertAdjacentHTML('beforeend', ' Chi tiết <b>từng đơn</b> (số đơn Shopify / Amazon, ngày đặt, ngày ship, cước, pick & pack, packaging): <a href="'+href+'" target="_blank" rel="noopener">'+label+'</a> — cập nhật cùng lúc với số trên.');
    }
    if(cap && shipmonkInvMatched && !cap.dataset.inv){
      cap.dataset.inv = '1';
      cap.innerHTML = cap.innerHTML.replace('<b>Chưa gồm</b> phí lưu kho, receiving, xử lý hàng trả và các khoản chỉ có trên hoá đơn — sẽ thêm khi có file hoá đơn.', '<b>Hoá đơn ShipMonk</b> (Billing → Invoices, 2 kỳ/tháng) được đọc thêm vào: lưu kho, receiving, hàng trả, bao bì mua qua ShipMonk, phí khác, điều chỉnh/credit — chia đều theo ngày trong kỳ hoá đơn; cước + pick & pack trên hoá đơn chỉ dùng để đối chiếu và bù chênh lệch với ước tính theo đơn.');
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
    let html = `<thead><tr><th>Chỉ số (tên như trong Shopify Analytics)</th><th style="text-align:right">${sel.length===1 ? fmtDateLong(sel[0].date) : sel.length+' ngày'}</th></tr></thead><tbody>`;
    html += line('Orders — số đơn (mỗi đơn đếm 1 lần, đã loại đơn test và đơn huỷ chưa thu tiền)', orders.toLocaleString('en-US'));
    html += line('Gross sales — giá niêm yết × số lượng, trước giảm giá', gross);
    html += line('− Discounts — mã giảm giá + khuyến mãi tự động', -disc);
    html += line(exact
      ? '− Returns — hàng trả + tiền hoàn thêm (refund discrepancy), trước thuế, theo ngày Shopify xử lý hoàn'
      : '− Returns — giá trị hàng trả (theo ngày hoàn tiền; sync cũ, chưa gồm tiền hoàn thêm)', -ret);
    html += line('= Net sales (= "Doanh thu thuần" phần Shopify trên dashboard)', net, {bold:true});
    html += line('+ Shipping charges — phí ship khách trả' + (refShip ? ` (đã trừ ${money(refShip)} ship hoàn lại)` : ''), ship);
    html += line('+ Taxes — thuế thu hộ' + (refTax ? ` (đã trừ ${money(refTax)} thuế hoàn lại)` : ''), tax);
    html += line(exact
      ? '= Total sales — đúng công thức Shopify: net sales + shipping charges + taxes (duties / additional fees = 0)'
      : '≈ Total sales — Shopify Analytics còn trừ thêm phần ship/thuế hoàn lại cho khách (sync cũ)', total, {bold:true});
    html += '</tbody>';
    document.getElementById('shopifyReconTable').innerHTML = html;
    const note = document.querySelector('#shopifyReconCard .note');
    const vis = shopifyMeta && shopifyMeta.meta && shopifyMeta.meta.orders_visibility;
    const visNote = vis && vis!=='all' ? ' · ⚠ app chưa có quyền read_all_orders: hoàn tiền trên đơn cũ hơn 60 ngày không nhìn thấy, Returns sẽ thấp hơn Shopify' : '';
    if(note) note.textContent = 'Cùng định nghĩa với báo cáo "Sales over time" của Shopify · ngày theo giờ cửa hàng (LA)' + (missing ? ` · ${missing} ngày trong khoảng chưa có dữ liệu đồng bộ` : '') + visNote + ' · ' + fmtAmazonAge(SHOPIFY_LIVE_DATA.generated_at);
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
    const baseLabel = {subtotal:'giá trị hàng sau giảm giá (chưa ship/thuế)', subtotal_shipping:'giá trị hàng + ship', subtotal_tax:'giá trị hàng + thuế', total:'tổng đơn (gồm ship + thuế — đúng cài đặt Revenue Calculation của Snowball)'}[sb.commission_base] || sb.commission_base;
    let html = '<div style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;color:var(--ink-secondary);">';
    html += `<div><span class="tag live"><span class="d"></span>Live</span> Cửa sổ ${shopifyMeta.window ? shopifyMeta.window.start+' → '+shopifyMeta.window.end : shopifyMeta.window_days+' ngày'}: <b>${(wt.orders||0).toLocaleString('en-US')} đơn referral</b>, doanh thu quy về ${money(wt.revenue||0)}, hoa hồng <b>${money(wt.commission_net||0)}</b> (đã trừ ${money(wt.reversals||0)} hoàn tiền). Cơ sở tính: ${baseLabel}.</div>`;
    const progKeys = Object.keys(programs).sort((x,y)=>(programs[y].commission_net||0)-(programs[x].commission_net||0));
    if(progKeys.length){
      html += `<div class="caption" style="padding-left:0;margin:4px 0 0;">Theo chương trình (tag Shopify "Referral - SS - …") · % lấy từ ${'cấu hình workflow / tên program'}:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${progKeys.map(k=>{
          const p = programs[k]; const src = (sb.rate_sources||{})[k];
          const cls = src==='default' ? 'warn' : 'ok';
          return `<span class="pill ${cls}" style="font-weight:500;">${k}: ${(p.rate*100).toFixed(p.rate*100%1?1:0)}% · ${p.orders} đơn · ${money(p.commission_net||0)}${src==='inferred_from_name'?' · % đoán từ tên':''}${src==='default'?' · CHƯA CÓ %':''}</span>`;
        }).join('')}</div>`;
    }
    const affKeys = Object.keys(affiliates).slice(0, 12);
    if(affKeys.length){
      html += `<div class="caption" style="padding-left:0;margin:4px 0 0;">Top influencer/affiliate theo hoa hồng (mã trong thuộc tính đơn __snowball):</div>
        <div style="overflow-x:auto;"><table class="simple" style="min-width:420px;"><thead><tr><th>Affiliate</th><th>Program</th><th style="text-align:right">Đơn</th><th style="text-align:right">Doanh thu</th><th style="text-align:right">Hoa hồng</th></tr></thead><tbody>${affKeys.map(k=>{
          const a = affiliates[k];
          return `<tr><td>${k}</td><td>${a.program||''}</td><td style="text-align:right">${a.orders}</td><td style="text-align:right">${money(a.revenue||0)}</td><td style="text-align:right">${money(a.commission_net||0)}</td></tr>`;
        }).join('')}</tbody></table></div>`;
    }
    html += `<div><span class="tag info"><span class="d"></span>Lưu ý</span> Đây là hoa hồng <i>phát sinh</i> theo đơn (accrual). Khoản trả thật (payout) qua Tremendous/PayPal có thể lệch thời điểm và không gồm quà tặng sản phẩm hay flat fee thoả thuận riêng ngoài Snowball. Đối soát theo tháng với Payouts → Export trong Snowball.</div>`;
    if(warnings.length){
      html += `<div class="caption" style="padding-left:0;margin:6px 0 4px;">Cảnh báo từ lần đồng bộ gần nhất:</div>
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
      };
      // NOTE: r.ad_spend is a known gap too (Sponsored Products spend needs the separate
      // Amazon Advertising API, not covered by SP-API) - intentionally NOT overwriting the
      // ads.amazonads estimate with this yet, since the real value would misleadingly read 0.
      matched++;
    });
    return matched>0;
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
      rows.push({id, name:c.name, product:c.product||'Khác', channel:c.channel||'', market:c.market||'', stage:c.stage||'', status:c.status||'', ...derive(agg)});
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
    let html = `<thead><tr><th>Sản phẩm / campaign</th><th style="text-align:right">Chi</th><th style="text-align:right">% chi</th><th style="text-align:right">Conv. quy về</th><th style="text-align:right">CPA</th><th style="text-align:right">DT quy về</th><th style="text-align:right">ROAS</th><th style="text-align:right">Clicks</th><th style="text-align:right">CPC</th><th style="text-align:right">CTR</th></tr></thead><tbody>`;
    const cell = (r, bold) => `<td class="num" ${bold?'style="font-weight:700;color:var(--ink-primary);"':''}>${money(r.spend)}</td><td class="num">${totalSpend? (r.spend/totalSpend*100).toFixed(0):0}%</td><td class="num">${fmtN(r.conversions)}</td><td class="num" ${warnCls(r)}>${r.cpa?money(r.cpa):'—'}</td><td class="num">${money(r.conversion_value)}</td><td class="num" ${warnCls(r)}>${r.roas.toFixed(2)}x</td><td class="num">${fmtN(r.clicks)}</td><td class="num">${r.cpc?money(r.cpc):'—'}</td><td class="num">${r.ctr.toFixed(2)}%</td>`;
    Object.keys(products).sort((a,b)=>products[b].spend-products[a].spend).forEach(p=>{
      const pr = products[p];
      html += `<tr style="background:var(--surface-card-2);"><td class="name" style="font-weight:700;">${p} <span style="color:var(--ink-muted);font-weight:400;font-size:11px;">· ${pr.n} campaign</span></td>${cell(pr,true)}</tr>`;
      rows.filter(r=>r.product===p).sort((a,b)=>b.spend-a.spend).forEach(r=>{
        html += `<tr><td class="name" style="font-weight:400;padding-left:22px;font-size:12px;">${statusDot(r.status)}${r.name}${chanPill(r.channel)}${r.market&&r.market!=='US'?` <span class="pill" style="background:var(--surface-card-3);color:var(--ink-secondary);font-weight:500;">${r.market}</span>`:''}${stagePill(r.stage)}</td>${cell(r,false)}</tr>`;
      });
    });
    const all = zero(); rows.forEach(r=>F.forEach(f=>all[f]+=r[f])); derive(all);
    html += `<tr style="border-top:1.5px solid var(--baseline);"><td class="name" style="font-weight:700;">Tổng Google (${rows.length} campaign có chi)</td>${cell(all,true)}</tr></tbody>`;
    document.getElementById('googleCampaignTable').innerHTML = html;
    document.getElementById('googleCampaignNote').textContent = 'Google Ads API · conversions theo cài đặt tài khoản (có thể gồm cả conversion không phải mua hàng) · '+fmtAmazonAge(GOOGLE_ADS_LIVE_DATA.generated_at)+' · chấm xanh = đang chạy, vàng = tạm dừng';
  }
  // "từ 2025-01-01" / "thiếu N ngày" from meta.history (sync scripts that keep history)
  function fmtCoverage(data){
    const h = data && data.meta && data.meta.history;
    if(!h || !h.first_day) return '';
    const from = h.first_day.slice(8,10)+'/'+h.first_day.slice(5,7)+'/'+h.first_day.slice(0,4);
    return ' · từ '+from + (h.missing_count ? ' (thiếu '+h.missing_count.toLocaleString('en-US')+' ngày)' : '');
  }
  // Dot colour = real age of the embedded snapshot: green < 4h (the GitHub jobs refresh every 30 min, the page
  // is republished by the sync task), amber up to 48h, red beyond (sync stalled - check the scheduled task).
  function ageLevel(iso){
    if(!iso) return 'w';
    const h = (Date.now()-new Date(iso).getTime())/3600000;
    return h < 4 ? 'g' : h < 48 ? 'w' : 'c';
  }
  function fmtAmazonAge(iso){
    if(!iso) return 'Live · vừa cập nhật';
    const mins = Math.round((Date.now()-new Date(iso).getTime())/60000);
    if(mins<1) return 'Live · vừa cập nhật';
    if(mins<60) return 'Live · '+mins+' phút trước';
    return 'Live · '+Math.round(mins/60)+' giờ trước';
  }

  function fmtAgeFromCache(cache){
    if(!cache || !cache.storedAt) return 'Live · vừa cập nhật';
    const mins = Math.round((Date.now()-cache.storedAt)/60000);
    if(mins<1) return 'Live · vừa cập nhật';
    if(mins<60) return 'Live · '+mins+' phút trước';
    return 'Live · '+Math.round(mins/60)+' giờ trước';
  }

  // Sources with no live feed yet - they show $0 on the page (never a sample figure).
  function stillMockNames(){
    const m = [];
    if(!shopifyMatched) m.push('Shopify');
    if(!amazonMatched) m.push('Amazon');
    m.push('Walmart', 'TikTok Shop');
    if(!metaMatched) m.push('Meta Ads');
    if(!googleMatched) m.push('Google Ads');
    if(!shipmonkMatched) m.push('ShipMonk');
    if(!shipmonkInvMatched) m.push('hoá đơn ShipMonk (lưu kho, receiving, hàng trả)');
    m.push('Amazon Ads (chờ duyệt)', 'TikTok/AppLovin Ads', 'giá vốn theo SKU');
    if(!(shopifyMeta && shopifyMeta.meta && shopifyMeta.meta.payment_fees_basis)) m.push('phí cổng thanh toán'); else if(!paypalMatched) m.push('phí PayPal (Shopify Payments đã có)');
    if(!klaviyoMatched) m.push('Klaviyo');
    m.push('G&A (trừ Snowball, Klaviyo)');
    return m;
  }
  (async function connectLiveData(){
    // Shopify baked in by the hourly sync = the source of truth; don't also pull the
    // connector's ShopifyQL numbers on top (slightly different definitions would flicker).
    if(shopifyMatched){
      setLiveBanner('✅ <span><b>'+bakedLiveNames().join(' + ')+' đang LIVE</b>, nguồn tự cập nhật mỗi 30 phút — bấm ↻ để tải số mới. <b>Chưa kết nối = $0</b> (kh&ocirc;ng d&ugrave;ng số mẫu): '+stillMockNames().join(', ')+'.</span>', 'good');
      return;
    }
    let mcp;
    try{ mcp = await claude.use('mcp'); } catch(e){ mcp = null; }
    if(!mcp){
      const live = bakedLiveNames();
      if(live.length){
        setLiveBanner('✅ <span><b>'+live.join(' + ')+' đang LIVE</b>, nguồn tự cập nhật mỗi 30 phút — bấm ↻ để tải số mới. <b>Chưa kết nối = $0</b> (kh&ocirc;ng d&ugrave;ng số mẫu): '+stillMockNames().join(', ')+'. Doanh thu Shopify chưa c&oacute; trong bản n&agrave;y — chờ lần sync kế tiếp.</span>', 'warn');
      } else {
        setLiveBanner('ℹ️ <span>Chưa c&oacute; nguồn n&agrave;o được đồng bộ v&agrave;o bản n&agrave;y — mọi số đang l&agrave; $0 (kh&ocirc;ng d&ugrave;ng số mẫu). Chờ lần sync kế tiếp.</span>', 'warn');
      }
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
            const liveNames = bakedLiveNames();
            const amazonNote = liveNames.length
              ? liveNames.join(' + ')+' cũng đang LIVE.'
              : 'C&aacute;c nguồn kh&aacute;c chưa kết nối hiển thị $0.';
            setLiveBanner('✅ <span><b>Doanh thu Shopify đang LIVE</b> (' + domain + ') — ' + amazonNote + ' Kết nối th&ecirc;m nguồn ở tab "Hướng dẫn kết nối dữ liệu".</span>', 'good');
            renderAll();
          }
        } else {
          const err = ev.error || {};
          setSource('shopify','c','Lỗi kết nối');
          if(err.code==='needs_reauth' || err.code==='server_not_connected'){
            setLiveBanner('⚠️ <span>Shopify chưa kết nối hoặc phi&ecirc;n đăng nhập đ&atilde; hết hạn — v&agrave;o claude.ai Settings &gt; Connectors để kết nối/đăng nhập lại Shopify.</span>', 'bad');
          } else if(err.code==='server_unavailable' || err.retryable){
            setLiveBanner('⏳ <span>Kh&ocirc;ng lấy được dữ liệu Shopify l&uacute;c n&agrave;y (tạm thời) — Shopify đang hiển thị $0, thử lại sau.</span>', 'warn');
          } else if(err.code==='not_in_manifest' || err.code==='consent_required'){
            setLiveBanner('⚠️ <span>Bạn chưa cho ph&eacute;p trang n&agrave;y d&ugrave;ng kết nối Shopify của bạn. H&atilde;y đồng &yacute; khi được hỏi, hoặc bật lại trong c&agrave;i đặt của trang.</span>', 'bad');
          } else {
            setLiveBanner('⚠️ <span>Chưa lấy được dữ liệu Shopify thật (' + (err.code||'lỗi') + ') — Shopify đang hiển thị $0.</span>', 'warn');
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
})();
