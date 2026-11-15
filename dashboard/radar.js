// Token Launch Radar — board rendering, sorting, filtering, detail view.
// Data arrives as window.RADAR from ../data.js, written by main.ts from the
// same board the gate scores. No network, no framework.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) return;
  var rows = R.rows.slice();
  var state = { sort: 'rank', dir: 1, q: '', cat: '', watch: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
    return '$' + v;
  }
  function pct(c) {
    if (c === null || c === undefined) return '<span class="down">n/a</span>';
    var cls = c >= 0 ? 'up' : 'down';
    return '<span class="' + cls + '">' + (c >= 0 ? '+' : '') + c.toFixed(1) + '%</span>';
  }

  // Masthead stats and model note.
  $('mastStats').innerHTML =
    stat(R.board_size, 'ranked') + stat(R.watchlist_size, 'watchlist') +
    stat(R.live_size, 'already live') + stat(R.total_protocols, 'in snapshot');
  function stat(v, label) { return '<div class="stat"><b>' + v + '</b><span>' + label + '</span></div>'; }
  function fact(v, label) { return '<div class="fact"><b>' + v + '</b><span>' + label + '</span></div>'; }
  $('globalMult').textContent = R.global_multiple.toFixed(3) + '×';
  $('footLine').textContent =
    'Snapshot as of ' + R.as_of + ' · floor $' + (R.floor_usd / 1e6) + 'M · ' +
    R.board_size + ' pre-token protocols ranked, ' + R.watchlist_size + ' of them on the watchlist.';

  // Category filter options, in board order of first appearance.
  var cats = [];
  rows.forEach(function (r) { var c = r.category || 'Uncategorised'; if (cats.indexOf(c) < 0) cats.push(c); });
  cats.sort();
  var sel = $('cat');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; sel.appendChild(o);
  });

  function visible() {
    return rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function render() {
    var list = visible();
    list.sort(function (a, b) {
      var k = state.sort;
      var av = a[k], bv = b[k];
      if (av === null || av === undefined) av = -Infinity;
      if (bv === null || bv === undefined) bv = -Infinity;
      if (typeof av === 'string') return state.dir * av.localeCompare(bv);
      return state.dir * (av - bv);
    });
    $('rowCount').textContent = list.length + ' of ' + rows.length + ' protocols';
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + '<small>' + esc(r.slug) + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</small></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(2) + '×</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td>' + (r.watchlist ? '<span class="pill watch">WATCHLIST</span>' : '<span class="pill early">EARLY</span>') + '</td>' +
        '</tr>';
    }).join('');
    Array.prototype.forEach.call($('rows').querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () { showDetail(tr.getAttribute('data-slug')); });
    });
  }

  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var days = r.days_listed === null ? 'not recorded' : r.days_listed + ' days';
    var html = '<button class="back" id="backBtn">← Back to the board</button>' +
      '<p class="kicker" style="margin-top:14px">RANK ' + r.rank + ' · ' + (r.watchlist ? 'ON THE WATCHLIST' : 'EARLY — BELOW THE FLOOR') + '</p>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) + ' · records no token in the snapshot</p>' +
      '<div class="facts">' +
      fact(money(r.implied_value_usd), 'implied value') +
      fact(money(r.tvl_usd), 'TVL') +
      fact(r.change_7d === null ? 'n/a' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%', 'TVL change, 7d') +
      fact(r.listed_at || 'n/a', 'tracked since') +
      fact(days, 'track record') +
      fact(r.multiple.toFixed(3) + '×', 'category multiple') +
      '</div>' +
      '<div class="arith"><b>How this value is derived</b><br><code>' +
      money(r.tvl_usd) + ' TVL × ' + r.multiple.toFixed(3) + ' category multiple × ' +
      r.momentum.toFixed(3) + ' momentum × ' + r.track.toFixed(3) + ' track record = ' + money(r.implied_value_usd) +
      '</code><br>The multiple is the median market-cap/TVL of ' + esc(r.category || 'its category') +
      ' protocols whose token already trades in this snapshot. Momentum is clamped so one wild week cannot dominate; the track-record factor rises the longer a protocol has run with no token.</div>' +
      '<h3>Farm plan</h3><ol class="plan">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    var d = $('detailView');
    d.innerHTML = html;
    d.hidden = false;
    $('boardView').hidden = true;
    $('backBtn').addEventListener('click', hideDetail);
    window.scrollTo(0, 0);
  }
  function hideDetail() {
    $('detailView').hidden = true;
    $('boardView').hidden = false;
  }

  // Controls.
  $('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
  sel.addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  $('watchOnly').addEventListener('change', function (e) { state.watch = e.target.checked; render(); });
  Array.prototype.forEach.call(document.querySelectorAll('th[data-sort]'), function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; if (k === 'rank') state.dir = 1; }
      render();
    });
  });

  // Deep links used for the entry's screenshots: ?slug= opens a detail view,
  // ?cat= and ?q= open a filtered board.
  var params = new URLSearchParams(location.search);
  if (params.get('cat')) { state.cat = params.get('cat'); sel.value = state.cat; }
  if (params.get('q')) { state.q = params.get('q'); $('q').value = state.q; }
  if (params.get('watch')) { state.watch = true; $('watchOnly').checked = true; }
  render();
  if (params.get('slug')) showDetail(params.get('slug'));
})();
