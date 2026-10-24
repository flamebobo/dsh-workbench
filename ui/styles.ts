/** All colours come from DSH theme tokens (--dsw-alias-*); the literals are only fallbacks. */
export const css = `
.wb { --wb-fg: var(--dsw-alias-label-primary, #1a1a1a); --wb-fg2: var(--dsw-alias-label-secondary, #555); --wb-fg3: var(--dsw-alias-label-tertiary, #888);
  --wb-bg: var(--dsw-alias-bg-base, #fff); --wb-l1: var(--dsw-alias-bg-layer-1, #f6f7f9); --wb-l2: var(--dsw-alias-bg-layer-2, #eef0f3);
  --wb-bd: var(--dsw-alias-border-l2, #e3e5e8); --wb-bd1: var(--dsw-alias-border-l1, #eceef1); --wb-hover: var(--dsw-alias-interactive-bg-hover, #f0f2f5);
  --wb-blue: var(--dsw-alias-state-business-primary, #2f6bff); --wb-red: var(--dsw-alias-state-error-primary, #e5484d);
  --wb-green: var(--dsw-alias-state-success-primary, #2da44e); --wb-amber: var(--dsw-alias-state-warn-primary, #d98a00);
  display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--wb-fg); background: var(--wb-bg); font-size: 13px; line-height: 1.5; }
.wb * { box-sizing: border-box; }
.wb button { font: inherit; color: inherit; cursor: pointer; }
.wb-head { display: flex; align-items: center; gap: 16px; padding: 14px 20px 0; flex-wrap: wrap; }
.wb-title { font-size: 16px; font-weight: 600; margin: 0; }
.wb-sub { color: var(--wb-fg3); font-size: 12px; }
.wb-tabs { display: flex; gap: 2px; padding: 10px 20px 0; border-bottom: 1px solid var(--wb-bd1); }
.wb-tab { background: none; border: 0; padding: 7px 14px; border-bottom: 2px solid transparent; color: var(--wb-fg2); }
.wb-tab:hover { color: var(--wb-fg); } .wb-tab[aria-selected=true] { color: var(--wb-fg); border-bottom-color: var(--wb-blue); font-weight: 600; }
.wb-body { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.wb-main { flex: 1; min-width: 0; overflow: auto; }
.wb-banner { margin: 12px 20px 0; padding: 8px 12px; border-radius: 8px; background: color-mix(in srgb, var(--wb-amber) 12%, transparent); color: var(--wb-fg); border: 1px solid color-mix(in srgb, var(--wb-amber) 35%, transparent); font-size: 12px; }
.wb-banner.err { background: color-mix(in srgb, var(--wb-red) 10%, transparent); border-color: color-mix(in srgb, var(--wb-red) 35%, transparent); }
.wb-pill { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 10px; font-size: 11px; background: var(--wb-l2); color: var(--wb-fg2); white-space: nowrap; }
.wb-pill.demo { background: color-mix(in srgb, var(--wb-amber) 18%, transparent); color: var(--wb-amber); }
.wb-pill.live { background: color-mix(in srgb, var(--wb-green) 16%, transparent); color: var(--wb-green); }
.wb-pill.err { background: color-mix(in srgb, var(--wb-red) 16%, transparent); color: var(--wb-red); }
.wb-btn { border: 1px solid var(--wb-bd); background: var(--wb-bg); border-radius: 7px; padding: 5px 12px; }
.wb-btn:hover { background: var(--wb-hover); }
.wb-btn.primary { background: var(--wb-blue); border-color: var(--wb-blue); color: #fff; font-weight: 600; }
.wb-btn.primary:hover { filter: brightness(1.08); } .wb-btn:disabled { opacity: .5; cursor: default; }
.wb-btn.danger { color: var(--wb-red); }
.wb-input, .wb-select, .wb-textarea { width: 100%; font: inherit; color: inherit; background: var(--wb-bg); border: 1px solid var(--wb-bd); border-radius: 7px; padding: 6px 9px; }
.wb-textarea { resize: vertical; min-height: 90px; line-height: 1.5; } .wb-input:focus, .wb-select:focus, .wb-textarea:focus { outline: 1px solid var(--wb-blue); }
.wb-toolbar { display: flex; align-items: center; gap: 8px; padding: 12px 20px; flex-wrap: wrap; }
.wb-chip { border: 1px solid var(--wb-bd); background: none; border-radius: 14px; padding: 2px 11px; font-size: 12px; color: var(--wb-fg2); }
.wb-chip[aria-pressed=true] { background: var(--wb-fg); color: var(--wb-bg); border-color: var(--wb-fg); }
.wb-table { width: 100%; border-collapse: collapse; }
.wb-table th { text-align: left; font-weight: 500; font-size: 12px; color: var(--wb-fg3); padding: 6px 10px; border-bottom: 1px solid var(--wb-bd1); position: sticky; top: 0; background: var(--wb-bg); }
.wb-th { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.wb-th:hover, .wb-th:focus-visible { color: var(--wb-fg); }
.wb-th-ind { font-size: 9px; min-width: 9px; }
.wb-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin: 12px 0 4px; }
.wb-tile { background: var(--wb-l1); border-radius: 12px; padding: 10px 14px; } .wb-tile-v { font-size: 24px; font-weight: 600; margin: 2px 0; }
.wb-weeks { display: flex; gap: 10px; align-items: flex-end; height: 120px; margin: 8px 0 4px; max-width: 640px; }
.wb-week { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; }
.wb-bars { flex: 1; width: 100%; display: flex; gap: 3px; align-items: flex-end; } .wb-bars i { flex: 1; min-height: 2px; border-radius: 3px 3px 0 0; } .wb-bars i.a, .wb-key.a { background: var(--wb-blue); } .wb-bars i.b, .wb-key.b { background: var(--wb-green); }
.wb-key { display: inline-block; width: 9px; height: 9px; border-radius: 2px; vertical-align: baseline; }
.wb-pre { background: var(--wb-l1); border-radius: 10px; padding: 10px 12px; font-size: 11px; max-height: 260px; overflow: auto; margin-top: 8px; }
.wb-badge { margin-left: 5px; min-width: 16px; padding: 0 5px; border-radius: 8px; background: var(--wb-red); color: #fff; font-size: 10px; line-height: 16px; display: inline-block; text-align: center; }
.wb-table td { padding: 9px 10px; border-bottom: 1px solid var(--wb-bd1); vertical-align: middle; overflow-wrap: anywhere; }
.wb-table td .wb-btn { white-space: nowrap; }
.wb-table tr.arch td { opacity: .55; }
.wb-table tr.row { cursor: pointer; } .wb-table tr.row:hover td { background: var(--wb-hover); } .wb-table tr.sel td { background: color-mix(in srgb, var(--wb-blue) 9%, transparent); }
.wb-pri { display: inline-block; min-width: 26px; text-align: center; border-radius: 4px; font-size: 11px; font-weight: 600; padding: 0 4px; background: var(--wb-l2); color: var(--wb-fg2); }
.wb-pri.P0 { background: color-mix(in srgb, var(--wb-red) 16%, transparent); color: var(--wb-red); }
.wb-pri.P1 { background: color-mix(in srgb, var(--wb-amber) 18%, transparent); color: var(--wb-amber); }
.wb-src { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--wb-fg2); white-space: nowrap; }
.wb-src i { width: 14px; height: 14px; border-radius: 3px; display: inline-block; } .wb-src i.zentao { background: #3b82f6; } .wb-src i.gitlab { background: #e24329; } .wb-src i.jenkins { background: #d33833; } .wb-src i.sparkin { background: #8b5cf6; } .wb-src i.manual { background: var(--wb-fg3); }
.wb-muted { color: var(--wb-fg3); } .wb-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-detail { width: 380px; flex: none; border-left: 1px solid var(--wb-bd1); background: var(--wb-l1); display: flex; flex-direction: column; min-height: 0; }
.wb-detail-body { flex: 1; overflow: auto; padding: 16px 18px; } .wb-detail-foot { padding: 12px 18px; border-top: 1px solid var(--wb-bd1); display: flex; gap: 8px; align-items: center; }
.wb-detail h3 { margin: 0 0 6px; font-size: 15px; } .wb-detail h4 { margin: 16px 0 6px; font-size: 12px; color: var(--wb-fg3); font-weight: 600; }
.wb-kv { display: grid; grid-template-columns: 64px 1fr; gap: 3px 8px; font-size: 12px; } .wb-kv dt { color: var(--wb-fg3); } .wb-kv dd { margin: 0; }
.wb-ac { list-style: none; margin: 0; padding: 0; } .wb-ac li { display: flex; gap: 8px; padding: 3px 0; } .wb-ac li::before { content: ''; flex: none; width: 13px; height: 13px; margin-top: 3px; border: 1.5px solid var(--wb-fg3); border-radius: 3px; }
.wb-rel { padding: 6px 9px; border: 1px solid var(--wb-bd1); border-radius: 7px; background: var(--wb-bg); margin-bottom: 5px; font-size: 12px; }
.wb-board { display: flex; gap: 12px; padding: 14px 20px; height: 100%; align-items: stretch; overflow-x: auto; }
.wb-col { flex: 1 0 140px; min-width: 140px; background: var(--wb-l1); border-radius: 10px; display: flex; flex-direction: column; min-height: 0; border: 1px solid transparent; }
.wb-col.over { border-color: var(--wb-blue); background: color-mix(in srgb, var(--wb-blue) 7%, var(--wb-l1)); }
.wb-col-h { display: flex; align-items: center; gap: 6px; padding: 10px 12px; font-weight: 600; } .wb-col-h .n { color: var(--wb-fg3); font-weight: 400; margin-right: auto; }
.wb-dot { width: 8px; height: 8px; border-radius: 50%; border: 2px solid var(--wb-fg3); } .wb-dot.in_progress { border-color: var(--wb-amber); } .wb-dot.in_review { border-color: var(--wb-green); } .wb-dot.done { border-color: var(--wb-blue); background: var(--wb-blue); } .wb-dot.blocked { border-color: var(--wb-red); }
.wb-col-b { flex: 1; overflow: auto; padding: 0 8px 8px; display: flex; flex-direction: column; gap: 8px; }
.wb-card { background: var(--wb-bg); border: 1px solid var(--wb-bd); border-radius: 9px; padding: 9px 11px; cursor: grab; }
.wb-agents { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--wb-fg2); white-space: nowrap; }
.wb-seg { display: inline-flex; border: 1px solid var(--wb-bd); border-radius: 8px; overflow: hidden; }
.wb-seg button { border: 0; background: var(--wb-bg); padding: 5px 12px; color: var(--wb-fg2); white-space: nowrap; } .wb-seg button + button { border-left: 1px solid var(--wb-bd); }
.wb-seg button[aria-pressed=true] { background: var(--wb-fg); color: var(--wb-bg); font-weight: 600; }
.wb-card.dropb { box-shadow: 0 -3px 0 0 var(--wb-blue); } .wb-card.dropa { box-shadow: 0 3px 0 0 var(--wb-blue); }
.wb-card.arch { opacity: .6; background: var(--wb-l1); }
.wb-card:hover { border-color: var(--wb-fg3); } .wb-card.drag { opacity: .45; }
.wb-card .t { font-weight: 600; margin: 3px 0 6px; word-break: break-word; } .wb-card .m { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; font-size: 11px; color: var(--wb-fg3); } .wb-card .m .wb-btn { white-space: nowrap; }
.wb-card .k { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--wb-fg3); }
.wb-spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--wb-bd); border-top-color: var(--wb-amber); animation: wbspin 0.9s linear infinite; display: inline-block; }
@keyframes wbspin { to { transform: rotate(360deg); } }
.wb-modal-mask { position: absolute; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 20; padding: 24px; }
.wb-modal { width: min(640px, 100%); max-height: 100%; overflow: auto; background: var(--wb-bg); border: 1px solid var(--wb-bd); border-radius: 12px; padding: 18px 20px; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
.wb-field { margin: 10px 0; } .wb-field label { display: block; font-size: 12px; color: var(--wb-fg3); margin-bottom: 4px; }
.wb-row { display: flex; gap: 8px; align-items: center; } .wb-grow { flex: 1; }
.wb-split { display: flex; height: 100%; min-height: 0; } .wb-list { width: 260px; flex: none; border-right: 1px solid var(--wb-bd1); overflow: auto; padding: 10px; }
.wb-li { display: block; width: 100%; text-align: left; border: 1px solid transparent; background: none; border-radius: 8px; padding: 8px 10px; margin-bottom: 4px; }
.wb-li:hover { background: var(--wb-hover); } .wb-li[aria-selected=true] { background: var(--wb-l2); border-color: var(--wb-bd); }
.wb-pane { flex: 1; overflow: auto; padding: 18px 24px; }
.wb-toast { position: absolute; right: 20px; bottom: 20px; z-index: 30; padding: 9px 14px; border-radius: 9px; background: var(--wb-fg); color: var(--wb-bg); box-shadow: 0 6px 24px rgba(0,0,0,.25); max-width: 420px; }
.wb-composer { position: relative; border: 1px solid var(--wb-bd); border-radius: 12px; background: var(--wb-bg); }
.wb-composer:focus-within { border-color: var(--wb-blue); } .wb-composer.drop { outline: 2px dashed var(--wb-blue); outline-offset: 2px; }
.wb-composer-text { display: block; width: 100%; min-height: 120px; border: 0; background: none; color: inherit; font: inherit; line-height: 1.55; padding: 10px 12px 4px; resize: vertical; outline: none; }
.wb-composer-bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px 8px; font-size: 12px; }
.wb-plus { width: 28px; height: 28px; border-radius: 50%; border: 0; background: var(--wb-l2); color: var(--wb-fg2); font-size: 16px; line-height: 1; padding: 0; }
.wb-plus:hover { background: var(--wb-hover); color: var(--wb-fg); }
.wb-slash { position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 25; max-height: 280px; overflow: auto; padding: 6px; border: 1px solid var(--wb-bd); border-radius: 12px; background: var(--wb-bg); box-shadow: 0 8px 28px rgba(0,0,0,.18); }
.wb-slash-h { padding: 6px 10px 2px; font-size: 12px; color: var(--wb-fg3); }
.wb-slash-i { display: flex; align-items: baseline; gap: 8px; padding: 7px 10px; border-radius: 8px; cursor: pointer; }
.wb-slash-i[aria-selected=true] { background: var(--wb-l2); } .wb-slash-i .k { color: var(--wb-fg3); } .wb-slash-i .d { margin-left: auto; color: var(--wb-fg3); font-size: 12px; }
.wb-files.in { margin: 0; padding: 8px 10px 0; } .wb-files { margin-top: 6px; display: flex; flex-direction: column; gap: 5px; }
.wb-file { display: flex; align-items: center; gap: 8px; padding: 4px 6px 4px 8px; border: 1px solid var(--wb-bd1); border-radius: 7px; background: var(--wb-l1); }
.wb-file img { width: 28px; height: 28px; object-fit: cover; border-radius: 4px; } .wb-file .ic { width: 28px; text-align: center; font-size: 18px; }
.wb-conn { border: 1px solid var(--wb-bd); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; background: var(--wb-bg); }
.wb-pick { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; }
.wb-bld { font-size: 11px; margin-top: 4px; }
.wb-pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 14px; padding: 4px 20px 20px; }
.wb-pcard { text-align: left; border: 1px solid var(--wb-bd); border-radius: 14px; background: var(--wb-l1); padding: 14px 16px; min-width: 0; }
.wb-pcard:hover { border-color: var(--wb-fg3); background: var(--wb-hover); }
.wb-pcard.add { display: flex; align-items: center; justify-content: center; min-height: 150px; border-style: dashed; color: var(--wb-fg3); background: none; }
.wb-flag { font-size: 11px; padding: 1px 8px; border-radius: 10px; background: var(--wb-l2); white-space: nowrap; margin-left: auto; }
.wb-nums { display: flex; gap: 18px; margin-bottom: 10px; } .wb-nums div { display: flex; flex-direction: column; } .wb-nums b { font-size: 20px; line-height: 1.1; } .wb-nums span { font-size: 11px; color: var(--wb-fg3); }
.wb-pdetail { padding: 14px 22px 28px; max-width: 1280px; }
.wb-crumb { display: flex; align-items: center; gap: 8px; font-size: 12px; } .wb-crumb button { border: 0; background: none; color: var(--wb-fg2); padding: 0; } .wb-crumb button:hover { color: var(--wb-fg); }
.wb-panel { background: var(--wb-l1); border-radius: 14px; padding: 14px 16px; min-width: 0; } .wb-panel h4 { margin: 0 0 8px; font-size: 13px; }
.wb-ptop { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
.wb-pcols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
.wb-bigs { display: flex; } .wb-bigs div { flex: 1; text-align: center; display: flex; flex-direction: column; } .wb-bigs b { font-size: 30px; font-weight: 500; line-height: 1.2; } .wb-bigs span { font-size: 12px; color: var(--wb-fg3); }
.wb-prow { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; border-bottom: 1px solid var(--wb-bd1); background: none; padding: 9px 4px; text-align: left; } .wb-prow:last-child { border-bottom: 0; } .wb-prow:hover { background: var(--wb-hover); }
.wb-chips { display: flex; flex-wrap: wrap; gap: 6px; }
@media (max-width: 900px) { .wb-ptop, .wb-pcols { grid-template-columns: 1fr; } }
.wb-skills { max-height: 220px; overflow: auto; margin-top: 6px; border: 1px solid var(--wb-bd1); border-radius: 8px; padding: 4px 8px; }
.wb-chipx { display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px 1px 9px; border-radius: 12px; background: var(--wb-l2); font-size: 12px; } .wb-chipx button { border: 0; background: none; color: var(--wb-fg3); padding: 0 6px; } .wb-chipx button:hover { color: var(--wb-red); }
.wb-diff { border: 1px solid var(--wb-bd1); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
.wb-diff-h { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: var(--wb-l1); padding: 7px 10px; font-size: 12px; } .wb-diff-h:hover { background: var(--wb-hover); }
.wb-st { font-size: 11px; padding: 0 6px; border-radius: 4px; background: var(--wb-l2); } .wb-st.st-A { color: var(--wb-green); } .wb-st.st-D { color: var(--wb-red); } .wb-st.st-M { color: var(--wb-amber); }
.wb-pre { margin: 0; padding: 6px 0; overflow: auto; max-height: 360px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--wb-bg); }
.wb-pre div { padding: 0 12px; white-space: pre; } .wb-pre .add { background: color-mix(in srgb, var(--wb-green) 14%, transparent); } .wb-pre .del { background: color-mix(in srgb, var(--wb-red) 13%, transparent); } .wb-pre .hunk { color: var(--wb-fg3); background: var(--wb-l1); }
.wb-linkbtn { border: 0; background: none; color: var(--dsw-alias-link, var(--wb-blue)); padding: 0; font-size: 12px; }
.wb-sec { margin: 22px 0 8px; font-size: 13px; padding-bottom: 4px; border-bottom: 1px solid var(--wb-bd1); }
.wb-menu-h { padding: 4px 10px 8px; font-size: 12px; color: var(--wb-fg3); }
.wb-dotx { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.wb-empty { padding: 40px; text-align: center; color: var(--wb-fg3); }
`
