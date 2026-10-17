# RUNBOOK — refresh the ShipMonk billing files on the P&L dashboard

Toolkit v1.0 (2026-10-16). For a **fresh Claude session with no memory**, run twice a month (after ShipMonk
closes a billing period: periods are 1–14 and 15–end of month, so run on the **2nd and the 17th**).
Needs the user's Mac online with the Claude desktop app (built-in browser + the `Documents/ctu-fin` folder).

What you produce: two static files for the dashboard, written to the user's Mac so they can upload them to
GitHub (the user uploads by hand; you never push):

| file | what it is | consumed by |
|---|---|---|
| `site/public/shipmonk_invoices.json` | every closed ShipMonk invoice since 2025-01-01 by P&L category, spread per day + per month | dashboard `SHIPMONK_INVOICES_INJECT` |
| `site/public/shipmonk_storage_daily.json` | storage fee per day × warehouse from the "Storage Fees Breakdown" report (sums to the invoice) | dashboard `SHIPMONK_STORAGE_INJECT` |

Toolkit files (keep the four together):

| file | role |
|---|---|
| `collect_shipmonk_billing.js` | snippet run inside the app.shipmonk.com tab → one JSON blob (invoices + current period + storage rows) |
| `build_shipmonk_billing.py` | stdlib Python: blob + previous files → new files + `REPORT.txt` + `HUONG_DAN_UP.txt` |
| `test_build.py` | acceptance tests (reproduces the Sept-2026 files byte-for-byte; merge invariants; collector e2e under node) |
| `RUNBOOK.md` | this file |

Background docs in the project: `claude/shipmonk-invoices.md` (endpoints, category table) and
`claude/storage-fees-by-day.md` (Metabase report). The toolkit encodes everything in them; read them only if
something looks different from what is described here.

---

## 0. Before you start (2 min)

1. Load the tools in one `ToolSearch` call each:
   - built-in browser: `ToolSearch {query: "mcp__remote-devices__Claude_Browser__", max_results: 64}`
     (if only `enable__mcp__remote-devices__Claude_Browser` exists, call it first)
   - device files: `ToolSearch {query: "select:mcp__remote-devices__get_device_info,mcp__remote-devices__device_bash,mcp__remote-devices__device_commit_files,mcp__remote-devices__device_request_folder_access,mcp__remote-devices__device_list_dir"}`
2. Make a work dir in the cloud container: `mkdir -p /tmp/smk_run/{tool,prev,out}`.
3. Get the toolkit into `/tmp/smk_run/tool/`. In order of preference:
   a. from the GitHub repo if it has been added there:
      `for f in collect_shipmonk_billing.js build_shipmonk_billing.py test_build.py; do curl -sSL -o /tmp/smk_run/tool/$f https://raw.githubusercontent.com/taitran-star/ctu-fin-sync-8x2k/main/tools/shipmonk_billing/$f; done`
      (check each file starts with `/* collect_` / `#!/usr/bin/env python3`, not with `404`)
   b. else from the project docs (`Projects` tool, `project_read` of `claude/shipmonk-billing-toolkit/<name>` if present)
   c. else ask the user where the toolkit is. Do not rewrite it from memory.
4. `python3 /tmp/smk_run/tool/build_shipmonk_billing.py --help` must print the usage.

## 1. Download the current files from GitHub (the merge base)

```
cd /tmp/smk_run/prev
for f in shipmonk_invoices.json shipmonk_storage_daily.json; do
  curl -sSL --max-time 60 -o $f https://raw.githubusercontent.com/taitran-star/ctu-fin-sync-8x2k/main/site/public/$f
done
python3 -c "import json;a=json.load(open('shipmonk_invoices.json'));s=json.load(open('shipmonk_storage_daily.json'));print('invoices', a['meta']['invoice_count'], 'last', a['meta']['last_day'], 'current', a['meta']['current_period']);print('storage', s['days'], 'days', s['first_day'], '->', s['last_day'])"
```
Note the two dates printed: **INV_LAST** (`meta.last_day`, e.g. `2026-09-14`) and **ST_LAST** (`last_day`,
e.g. `2026-09-21`). If the download fails (HTML/404), stop and tell the user; do not build from nothing.

## 2. Open ShipMonk in the built-in browser

1. `preview_start {url: "https://app.shipmonk.com/billing"}` → note the `tabId`.
2. If the tool says the site is not allowed yet and `request_access` exists: `request_access {url: "https://app.shipmonk.com", scope: "site"}` and wait for the user's answer; then retry.
3. `get_page_text {tabId}`. Decide:
   - **Logged in** (page shows the Billing/Invoices table, a company name, "Invoice", "Billing period"...) → go to step 3.
   - **Login page** (words like "Log in", "Sign in", "Email", "Password", "Forgot password") →
     a. `tabs_context`; its last line says whether the Browser pane is displayed, hidden or not open.
        If hidden: ask the user to press **Cmd+Shift+B** in the Claude desktop app (or click the globe icon).
     b. Ask the user (Vietnamese is fine): "Trang app.shipmonk.com đang ở màn hình đăng nhập trong khung
        trình duyệt của Claude — bạn đăng nhập giúp mình nhé (mình không nhập mật khẩu)."
     c. Poll: every ~60 s `get_page_text` (up to ~10 min). When the billing page appears, continue.
        If it never appears: stop, say the run can be re-fired after they sign in, and end the run.
   - **Never** type an email/password, never use saved credentials, never click "Forgot password".
4. One sanity call (never prints the token):
   `javascript_tool {tabId, action: "javascript_exec", text: "(() => { const t = localStorage.getItem('api_token'); return {hasToken: !!t, len: t ? t.length : 0, origin: location.origin}; })()"}`
   → expect `hasToken: true` and origin `https://app.shipmonk.com`.

## 3. Run the collector snippet

1. `Read /tmp/smk_run/tool/collect_shipmonk_billing.js` and change the two settings at the top:
   - `SINCE` = the **start** of the last invoice already in the file (so that invoice is re-collected and
     any status/amount change is picked up). It is `INV_LAST` minus 13 or 16 days — simplest: use the
     `start` of the last element of `prev/shipmonk_invoices.json`'s `invoices[]`
     (`python3 -c "import json;print(json.load(open('/tmp/smk_run/prev/shipmonk_invoices.json'))['invoices'][-1]['start'])"`).
   - `STORAGE_SINCE` = `ST_LAST` minus 7 days (the report refreshes recent days; overlapping days are replaced).
2. `javascript_tool {tabId, action: "javascript_exec", text: <the whole edited file content>}`.
   The script is a single top-level `await` expression; the tool returns its value = **a JSON string**.
   Progress can be watched with `javascript_tool text: "window.__smBillStatus"`.
   Typical run: 3–6 invoice details + 1–2 storage chunks, 10–40 s.
3. Save the result as `/tmp/smk_run/blob.json`:
   - The tool result is the JSON **string literal** (starts with `"{\"toolkit\"...`). Write it to the file
     exactly as returned — the builder un-quotes it itself.
   - **If the output is longer than ~64k characters the tool saves it to a file instead** and tells you the
     path (something like `.../tool-results/<id>.txt`). `cp` that file to `/tmp/smk_run/blob.json`.
     That file is the same JSON string literal, followed by a trailer `\n\n(captured at origin ...)`;
     the builder strips everything from `"\n\n(captured at origin"` on. To parse it yourself:
     `python3 -c "import json;t=open(p).read();t=t[:t.find('\n\n(captured at origin')] if '\n\n(captured at origin' in t else t;b=json.loads(json.loads(t))"`.
   - If the result is `null` / `[object Promise]` / an error about `await`: wait until
     `javascript_tool text: "window.__smBillDone === true"` returns true, then
     `javascript_tool text: "JSON.stringify(window.__smBill)"` and save that.
   - If the result is an object with only `error: "token: ..."` → not logged in; go back to step 2.
4. Quick look (no secrets are in the blob):
   `python3 -c "import json;b=json.load(open('/tmp/smk_run/blob.json'));b=json.loads(b) if isinstance(b,str) else b;print(len(b['invoices']),'invoices',[(i['number'],i['start'],i['end'],i['status'],i['total']) for i in b['invoices']]);print('current',b['current']);s=b['storage'];print('storage',s.get('error') or [(c['from'],c['to'],c.get('row_count'),c.get('cols')) for c in s['chunks']]);print('diag',b['diag'])"`
   - `invoices` should contain the re-collected last invoice plus the new closed period(s).
     0 new invoices on the 2nd/17th usually means ShipMonk has not closed the period yet → see step 7.
   - `storage.chunks[].cols` must contain `TRUE_STORAGE_USD_SUM` and `INVOICED_SUM`. If they are missing or
     the column list looks different, keep going but read the REPORT warnings carefully (assumption A2).
   - `diag.skipped` lists what was not fetched and why (`not closed` = the running period, expected).

## 4. Build

```
cd /tmp/smk_run
python3 tool/build_shipmonk_billing.py blob.json --inv-prev prev/shipmonk_invoices.json \
    --storage-prev prev/shipmonk_storage_daily.json --out-dir out
cat out/REPORT.txt
```
Gates before delivering (read `REPORT.txt`):
- exit code 0, both files listed under `files:`;
- `NEW invoices (n)` lines look sane: 14–17 day periods, totals in the usual range (tens of thousands $),
  `unalloc` small (< ~3,000), no `odd billing period` warning;
- storage: `check: N billing period(s) fully covered ...; 0 exceed the 0.15 tolerance`. A period that exceeds
  it means the report and the invoice disagree — deliver anyway but say so to the user;
- `storage columns by name: ...` (good). `resolved by POSITION` = the Metabase column names changed;
  open the blob, look at `storage.chunks[0].cols` and a few rows, and only continue if the mapped values
  make sense (true ≥ invoiced, day is a date, warehouse is a name);
- `WARNING storage report not collected` = report/JWT not found; the storage file is re-written unchanged.
  Deliver the invoices file alone and mention it.
- **Nothing new** (`NEW invoices (0)`, no `REPLACED`, `added days: 0`, `replaced days (values changed): 0`):
  do not make the user upload anything. Tell them nothing changed and end the run.

Optional self-check when something looks odd (needs the legacy fixtures next to the toolkit, see test_build.py):
`python3 tool/test_build.py --fixtures <dir> --raw <raw_invoices.json>`.

## 5. Write the results to the user's Mac

Target: `~/Documents/ctu-fin/UP_LEN_GITHUB/site/public/` (the two JSON files) and
`~/Documents/ctu-fin/UP_LEN_GITHUB/HUONG_DAN_UP.txt` (the Vietnamese upload note the builder wrote).

1. `get_device_info` → `connectedFolders`. If no connected folder contains `Documents/ctu-fin`:
   `device_request_folder_access {paths: ["~/Documents/ctu-fin"], reason: "Ghi 2 file ShipMonk vào UP_LEN_GITHUB để bạn up lên GitHub"}` and wait.
2. Prepare the folder (device_bash; connected folders are mounted at `$HOME/mnt/<folder-name>`):
   ```
   D="$HOME/mnt/ctu-fin/UP_LEN_GITHUB"; mkdir -p "$D/site/public"
   # park files from an earlier ShipMonk run so they are not confused with today's
   if ls "$D/site/public"/shipmonk_*.json >/dev/null 2>&1; then mkdir -p "$D/_da_up_roi/shipmonk-$(date +%F)" && mv "$D/site/public"/shipmonk_*.json "$D/_da_up_roi/shipmonk-$(date +%F)/"; fi
   # keep someone else's pending note
   if [ -f "$D/HUONG_DAN_UP.txt" ] && ! grep -q ShipMonk "$D/HUONG_DAN_UP.txt"; then echo OTHER_NOTE_PRESENT; fi
   ls -la "$D" "$D/site/public"
   ```
   If it printed `OTHER_NOTE_PRESENT`, name ours `HUONG_DAN_UP_SHIPMONK.txt` instead and say so.
3. Stage + commit (stagedPath must be under `/mnt/user-data/outputs/`):
   ```
   mkdir -p /mnt/user-data/outputs/shipmonk-billing && cp /tmp/smk_run/out/shipmonk_invoices.json /tmp/smk_run/out/shipmonk_storage_daily.json /tmp/smk_run/out/HUONG_DAN_UP.txt /tmp/smk_run/out/REPORT.txt /mnt/user-data/outputs/shipmonk-billing/
   ```
   `device_commit_files {files: [
      {stagedPath: "/mnt/user-data/outputs/shipmonk-billing/shipmonk_invoices.json",      devicePath: "~/Documents/ctu-fin/UP_LEN_GITHUB/site/public/shipmonk_invoices.json"},
      {stagedPath: "/mnt/user-data/outputs/shipmonk-billing/shipmonk_storage_daily.json", devicePath: "~/Documents/ctu-fin/UP_LEN_GITHUB/site/public/shipmonk_storage_daily.json"},
      {stagedPath: "/mnt/user-data/outputs/shipmonk-billing/HUONG_DAN_UP.txt",            devicePath: "~/Documents/ctu-fin/UP_LEN_GITHUB/HUONG_DAN_UP.txt"}]}`
   Then verify: `device_bash "ls -la $HOME/mnt/ctu-fin/UP_LEN_GITHUB/site/public && md5sum $HOME/mnt/ctu-fin/UP_LEN_GITHUB/site/public/shipmonk_*.json"` and compare with `md5sum /tmp/smk_run/out/shipmonk_*.json`.
4. If the Mac is unreachable: `SendUserFile` the three files instead and say the Mac was offline.

## 6. Tell the user (Vietnamese, short)

Example (fill from REPORT.txt):
> Đã cập nhật ShipMonk: thêm hoá đơn **7784202692** (15–30/09/2026, $xx.xxx) và **77842026101** (01–14/10, $xx.xxx);
> phí lưu kho theo ngày tới **15/10/2026**. 2 file đã ghi vào `Documents/ctu-fin/UP_LEN_GITHUB/site/public/`,
> hướng dẫn trong `UP_LEN_GITHUB/HUONG_DAN_UP.txt` — bạn up 2 file lên GitHub (site/public/) là dashboard có số mới.
Mention any WARNING from the report in one line. If a push/notification tool is available in the session,
send the same text there.

## 7. When things go wrong

| situation | do |
|---|---|
| Login page and the user does not sign in within ~10 min | stop; message: sign in to app.shipmonk.com in Claude's browser pane and re-run the task |
| `HTTP 401/403` from `/api/v1/billing/...` | token expired → reload the tab (`navigate`), re-check login, run again |
| 0 new invoices on the 2nd/17th | ShipMonk closes a period a few days late sometimes; if the storage file gained days, deliver that; otherwise say "chưa có hoá đơn mới" and end |
| `storage report not collected` | deliver invoices only; mention the Reports page may have changed (check `/api/v1/reports` manually: name "Storage Fees Breakdown") |
| `resolved by POSITION` | see step 4 gate; if the mapped numbers make no sense, do not deliver the storage file |
| builder traceback | paste it to the user with the blob's `diag` and stop; do not hand-edit JSON |
| output > 64k and no file path shown | re-run the collector with a later `STORAGE_SINCE` / `SINCE` (smaller blob), or fetch pieces: `JSON.stringify({...window.__smBill, storage:null})` and `JSON.stringify(window.__smBill.storage.chunks[0])` ... and assemble them into one object |

## 8. Suggested scheduled-task prompt (create with `requires_local_device: true`)

> Refresh the ShipMonk billing files for the P&L dashboard. Follow RUNBOOK.md of the ShipMonk billing toolkit
> (repo `taitran-star/ctu-fin-sync-8x2k`, folder `tools/shipmonk_billing/`, or the project doc copy): download
> the toolkit and the current `site/public/shipmonk_invoices.json` + `shipmonk_storage_daily.json`, open
> app.shipmonk.com in the built-in browser (ask the user to sign in in the pane if needed — never type
> passwords), run `collect_shipmonk_billing.js`, build with `build_shipmonk_billing.py`, write the two files and
> `HUONG_DAN_UP.txt` to `~/Documents/ctu-fin/UP_LEN_GITHUB/`, then tell the user in Vietnamese what changed and
> that they need to upload the two files to GitHub `site/public/`. If nothing changed, say so and upload nothing.

Schedule: `CRON_TZ=Asia/Ho_Chi_Minh 50 8 2,17 * *` (08:50 on the 2nd and 17th).

---

## Open assumptions (verify on the first real run and fix the toolkit if needed)

- **A1 invoice list fields.** Documented: `id, invoice_number, billing_period, status, closed, total`. The shape of
  `billing_period` is not documented; the collector tries `{start,end}`, `{from,to}`, `{start_date,end_date}`,
  a string with two dates, top-level `*_start/*_end`, then the detail payload. `diag.list_item_keys` and
  `diag.detail_keys` in the blob show the real keys. If `diag.skipped` says `billing period not found (A1)`,
  look at those keys and add the pair to `pickPeriod()`.
- **Closed-invoice filter.** `closed === true`, or status matching complete/submitted/closed/paid; statuses
  matching process/open/draft/pending are excluded. Seen so far: `status_complete`, `status_submitted`.
- **`/api/v1/billing/invoices/current`** is assumed to return the running period with a billing_period; if it
  fails, the builder keeps the previous `current_period` or derives the semi-monthly period after the last
  invoice (and the REPORT says so).
- **A2 Metabase columns (card 165).** `TRUE_STORAGE_USD_SUM`, `STORAGE_CAPPING_SUM`, `WINNING_STRATEGY`,
  `INVOICED_SUM` are documented; the **day** and **warehouse** column names are not. The builder maps by name
  (day: a name containing `storage_day`/`day`/`date`; warehouse: containing `warehouse`/`facility`/`location`),
  then by value shape (ISO date column / first text column), then by the Sept-2026 position order
  `0=day 1=warehouse 2=true 3=capping 4=strategy 5=invoiced`. Every chunk also carries `col_meta`
  (name/display_name/base_type) for inspection. Values may be strings — they are coerced.
- **A3 chunking.** ≤ 60 days per Metabase call; with at most ~6 warehouses that is ≤ 360 rows, far below the
  2000-row cap. `truncated:true` on a chunk (and a REPORT warning) means the assumption broke.
- **"All Warehouses"** appears only in 06/2025 (the report had no per-warehouse split then) and never together
  with named warehouses; day totals are the sum of the rows present. If a day ever has both, the builder drops
  the "All Warehouses" row for that day and warns.
- **Report refresh window.** The report is complete up to *yesterday* (~04:00 warehouse time); today's rows
  may be partial. Re-pulling from `ST_LAST − 7` days replaces those days with the refreshed values.
- **Dates / timezone.** Billing periods and storage days are calendar dates as the app shows them; `today`
  in the collector is the browser's local date.
- **Serialization.** Both files are written compact (`separators=(",", ":")`, `ensure_ascii=False`) like the
  live files; `meta.script_version` stays `"1.0"` so the dashboard sees an unchanged schema.
