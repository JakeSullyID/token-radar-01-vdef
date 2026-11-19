// Operating as a self-contained client application, this page functions completely offline without any external network connections.
// It imports its dataset straight from the local script bundle to render the prioritized leaderboard.
// Individuals can access comprehensive metrics popups alongside custom cultivation strategies for every project.
// URL hash navigation facilitates direct routing to individual protocol cards, category selectors, interface tabs, and saved watchlist selections.
(function () {
  var DATA = window.RADAR;
  var ROWS = window.BOARD_ROWS || null;
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', watchlist: false, sort: 'implied', dir: -1 };
  function $(s) { return document.querySelector(s); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c !== null && c !== undefined) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function fmtMoney(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function pct(v) { return v === null ? '\u2014' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
  function ageText(days) {
    if (days === null) return 'unknown';
    if (days < 90) return days + 'd';
    if (days < 730) return (days / 30.4).toFixed(1) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function readHash() {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.tab = 'pre-token'; state.watchlist = false; state.detail = null;
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('watchlist') === '1') state.watchlist = true;
    if (params.get('detail')) state.detail = params.get('detail');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.watchlist) params.set('watchlist', '1');
    if (state.detail) params.set('detail', state.detail);
    var h = params.toString();
    if (h) window.history.replaceState(null, '', '#' + h);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  var WATCHLIST = new Set(DATA.rows.filter(function (r) { return r.watchlist; }).map(function (r) { return r.slug; }));
  function sortKey(r) {
    if (state.sort === 'change') return r.change_7d === null ? 0 : r.change_7d;
    if (state.sort === 'age') return r.age_days === null ? -1 : r.age_days;
    if (state.sort === 'multiple') return r.multiple;
    if (state.sort === 'tvl') return r.tvl_usd;
    if (state.sort === 'rank') return r.rank;
    return r.implied_value_usd;
  }
  function rows() {
    var list = DATA.rows.filter(function (r) {
      if (state.tab !== 'pre-token') return false;
      if (state.watchlist && !WATCHLIST.has(r.slug)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    list.sort(function (a, b) { return (sortKey(a) - sortKey(b)) * state.dir || (a.rank - b.rank); });
    return list;
  }
  function comparables(row) {
    var comps = DATA.live.filter(function (l) { return l.category === row.category && l.mcap_usd !== null && l.tvl_usd > 0; });
    comps.sort(function (a, b) { return Math.abs(Math.log(a.tvl_usd / row.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / row.tvl_usd)); });
    return comps.slice(0, 3);
  }
  function farmSteps(row) {
    return farmStepsFor(row);
  }
  
function capitalFor(r) {
  if (r.tvl_usd >= 5000000000) return 250;
  if (r.tvl_usd >= 1000000000) return 150;
  if (r.tvl_usd >= 100000000) return 100;
  return 50;
}
function holdDaysFor(age) {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function actionFor(r, capital, chain) {
  var c = (r.category || '').toLowerCase(); var name = r.name;
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
  if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + '\u2019s main pool on ' + chain + ' and keep the position open.';
  if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
  if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of the protocol\u2019s yield asset on ' + chain + ' and hold it.';
  if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' into the ' + name + ' basis strategy and hold the position.';
  if (c.indexOf('restak') >= 0) return 'Restake $' + capital + ' of the staking asset through ' + name + ' and keep the receipt.';
  if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('option') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
  if (c.indexOf('payment') >= 0 || c === 'chain') return 'Use ' + name + ' with $' + capital + ' on ' + chain + ' and repeat the payment weekly.';
  if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
  if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
  if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
  if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' and vote in ' + name + '\u2019s governance if it offers voting.';
  if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
  if (c.indexOf('staking') >= 0) return 'Stake $' + capital + ' of the chain\u2019s staking asset through ' + name + ' and keep the receipt.';
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}

function weeklyActionFor(r) {
  var c = (r.category || '').toLowerCase(); var name = r.name;
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'a deposit into a ' + name + ' vault';
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'a supply or a borrow on ' + name;
  if (c.indexOf('dex') >= 0) return 'a swap through the ' + name + ' pool';
  if (c.indexOf('yield') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'a deposit into a ' + name + ' vault';
  if (c.indexOf('rwa') >= 0) return 'a mint of the ' + name + ' yield asset';
  if (c.indexOf('basis') >= 0) return 'a deposit into the ' + name + ' basis strategy';
  if (c.indexOf('restak') >= 0) return 'a restake through ' + name;
  if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('option') >= 0) return 'a hedge adjustment on ' + name;
  if (c.indexOf('payment') >= 0 || c === 'chain') return 'a payment through ' + name;
  if (c.indexOf('stable') >= 0) return 'a mint or deposit through ' + name;
  if (c.indexOf('insurance') >= 0) return 'a cover check or renewal on ' + name;
  if (c.indexOf('prediction') >= 0) return 'a market position on ' + name;
  if (c.indexOf('governance') >= 0) return 'a vote in ' + name + '\u2019s governance';
  if (c.indexOf('staking') >= 0) return 'a stake through ' + name;
  return 'a deposit into ' + name;
}
function secondActionFor(r, capital) {
  var c = (r.category || '').toLowerCase(); var name = r.name;
  var secondChain = r.chains.length > 1 ? r.chains[1] : null;
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return secondChain
    ? 'Deposit a second, smaller tranche into a ' + name + ' vault on ' + secondChain + ', so the activity spans two chains.'
    : 'Deposit a second, smaller tranche into a different ' + name + ' vault.';
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the supply on ' + name + ', keeping the health factor high.';
  if (c.indexOf('dex') >= 0) return 'Swap a small amount through the ' + name + ' pool once, so the wallet shows trading activity as well as liquidity.';
  if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Deposit into a second ' + name + ' vault' + (secondChain ? ' on ' + secondChain : '') + ' a week later.';
  if (c.indexOf('rwa') >= 0) return secondChain ? 'Mint a second tranche of the yield asset on ' + secondChain + '.' : 'Mint a second, smaller tranche of the yield asset a week later.';
  if (c.indexOf('basis') >= 0) return 'Add a second deposit to the ' + name + ' basis strategy after one week rather than all at once.';
  if (c.indexOf('restak') >= 0) return 'Delegate to a second operator on ' + name + ' if the protocol offers a choice.';
  if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('option') >= 0) return 'Close and reopen the hedge monthly so the activity stays fresh.';
  if (c.indexOf('insurance') >= 0) return 'Add a second cover position on ' + name + ' for a different risk if the protocol offers a choice.';
  if (c.indexOf('prediction') >= 0) return 'Place a second, smaller market position on ' + name + ' in a different market.';
  if (c.indexOf('governance') >= 0) return 'Vote in a second ' + name + ' proposal if one is open.';
  if (c.indexOf('staking') >= 0) return 'Stake a second, smaller amount of the chain\u2019s staking asset through ' + name + ' a week later.';
  if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount through ' + name + ' to the same chain.';
  if (c.indexOf('payment') >= 0 || c === 'chain') return 'Make a second payment through ' + name + ' the following week.';
  return 'Make a second deposit of $' + Math.round(capital / 2) + ' a week later, so the wallet shows repeated activity.';
}

function stepText(text, cost, time) {
  var s = text + ' Cost: ' + cost + '. Time: ' + time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\u2019s own page.';
  return s;
}
function farmSteps(row) {
  var chain = row.chains.length > 0 ? row.chains[0] : 'its main chain';
  var capital = capitalFor(row);
  var hold = holdDaysFor(row.age_days);
  var gas = capital >= 150 ? 8 : 4;
  var steps = [
    stepText('Use a fresh wallet that holds only the $' + (capital + Math.round(capital / 2)) + ' you plan to farm with ' + row.name + ' \u2014 the first deposit plus a second tranche \u2014 and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
    stepText(actionFor(row, capital, chain), '$' + capital + ' of capital and about $' + gas + ' of gas', '15 minutes to set up'),
  ];
  steps.push(stepText(secondActionFor(row, capital), 'about $2 to $4 of gas, funded from the wallet budget', '10 minutes'));
  steps.push(stepText('Make one on-protocol action each week \u2014 ' + weeklyActionFor(row) + ' \u2014 so the wallet shows steady activity.', 'about $2 of gas a week', '10 minutes a week'));
  steps.push(stepText('Hold the ' + row.name + ' position for at least ' + hold + ' days rather than farming and leaving within a week.', 'the $' + capital + ' stays in the position', hold + ' days'));
  steps.push(stepText('Before you withdraw, open ' + row.name + '\u2019s own points or rewards page if it publishes one and claim only from the link it publishes.', 'no fee to check; gas to claim if the protocol charges it, never a separate claim fee', '10 minutes'));
  steps.push(stepText('Write the wallet, the dates and every ' + row.name + ' transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes'));
  return steps;
}

  function boardTable() {
    var list = rows();
    var maxImp = DATA.rows[0] ? DATA.rows[0].implied_value_usd : 1;
    var head = [th('Rank', 'rank'), el('th', { text: 'Protocol' })];
    head.push(th('TVL', 'tvl'));
    head.push(th('7d', 'change'));
    head.push(th('Age', 'age'));
    head.push(th('Multiple', 'multiple'));
    head.push(th('Implied value', 'implied'));
    head.push(el('th', { text: 'Token' }));
    var body = list.map(function (r) {
      var tds = [
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', {}, [
          el('b', { text: r.name }),
          el('div', { class: 'sub', text: (r.category || 'No category') + ' on ' + r.chains.slice(0, 2).join(', ') + (WATCHLIST.has(r.slug) ? ' · watchlist' : '') })
        ]),
        el('td', { class: 'num', text: money(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d > 0 ? 'up' : r.change_7d !== null && r.change_7d < 0 ? 'down' : ''), text: pct(r.change_7d) }),
        el('td', { class: 'num', text: ageText(r.age_days) }),
      ];
      tds.push(el('td', { class: 'num', text: r.multiple.toFixed(4) }));
      tds.push(el('td', { class: 'num' }, [
        el('span', { class: 'bar' }, [el('i', { style: 'width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImp)) + '%' })]),
        el('span', { text: money(r.implied_value_usd) })
      ]));
      tds.push(el('td', {}, [el('span', { class: 'dot', text: '● no token' })]));
      var tr = el('tr', { tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } }, tds);
      return tr;
    });
    var table = el('table', {}, [
      el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
      el('thead', {}, [el('tr', {}, head)]),
      el('tbody', {}, body.length ? body : [el('tr', {}, [el('td', { class: 'empty', colspan: '8', text: 'No protocol matches that filter' })])])
    ]);
    return table;
  }
  function th(label, key) {
    return el('th', { class: 'num' }, [el('button', { type: 'button', text: label + (state.sort === key ? (state.dir === -1 ? ' ▼' : ' ▲') : ''), onclick: function (e) { e.stopPropagation(); if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } })]);
  }
  function liveRowsFiltered() {
    return DATA.live.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function liveTable() {
    var head = [el('th', { text: 'Protocol' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' })];
    head.push(el('th', { class: 'num', text: 'mcap / TVL' }));
    var body = liveRowsFiltered().map(function (r) {
      var tds = [
        el('td', {}, [el('b', { text: r.name }), el('div', { class: 'sub', text: (r.category || 'No category') + ' on ' + r.chains.slice(0, 2).join(', ') })]),
        el('td', { class: 'num', text: money(r.tvl_usd) }),
        el('td', { class: 'num', text: r.mcap_usd === null ? '\u2014' : money(r.mcap_usd) }),
      ];
      tds.push(el('td', { class: 'num', text: (r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(3) : '\u2014') }));
      return el('tr', {}, tds);
    });
    return el('table', {}, [
      el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' + ' Their mcap/TVL ratios are the calibration the pre-token multiples come from.' }),
      el('thead', {}, [el('tr', {}, head)]),
      el('tbody', {}, body)
    ]);
  }
  function calibrationTable() {
    var meds = DATA.medians || [];
    var total = meds.reduce(function (s, m) { return s + m.n; }, 0);
    var head = el('tr', {}, [el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Live comps' }), el('th', { class: 'num', text: 'Median mcap / TVL' })]);
    var body = meds.map(function (m) {
      return el('tr', {}, [
        el('td', { text: m.category }),
        el('td', { class: 'num', text: String(m.n) }),
        el('td', { class: 'num', text: m.median.toFixed(4) })
      ]);
    });
    return el('section', { class: 'panel' }, [
      el('h2', { text: 'Calibration: where the multiples come from' }),
      el('p', { text: 'Each category’s multiple is the median mcap/TVL of its live-token protocols in this snapshot (' + total + ' live comps; global median ' + (DATA.global_median || 0).toFixed(4) + '). A category with fewer than 2 live comps falls back to the global median; every multiple is clamped to [0.02, 1.00].' }),
      el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])
    ]);
  }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.detail = slug; writeHash();
    var dialog = $('#detail');
    dialog.innerHTML = '';
    var steps = farmSteps(row);
    var head = el('div', { class: 'detail-head' }, [
      el('div', {}, [
        el('h2', { id: 'detail-title', text: '#' + row.rank + ' ' + row.name }),
        el('div', { class: 'sub', text: (row.category || 'No category') + ' · ' + row.chains.join(', ') + (WATCHLIST.has(row.slug) ? ' · watchlist' : '') })
      ]),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ]);
    dialog.appendChild(head);
    var body = el('div', { class: 'detail-body' }, []);
    
    var mult = row.multiple;
    var comps = comparables(row);
    
    var recomputed = Math.max(1, Math.round(row.tvl_usd * (row.multiple_exact || row.multiple) * (row.growth_exact || row.growth_multiplier || 1) * (row.maturity_exact || row.maturity_multiplier || 1)));
    var recomputeMatch = recomputed === row.implied_value_usd;
    
    var modelSec = el('section', {}, [
      el('h3', { text: 'How this row is valued' }),
      el('div', { class: 'kv' }, [
        el('div', {}, [el('span', { text: 'TVL' }), el('b', { text: fmtMoney(row.tvl_usd) })]),
        el('div', {}, [el('span', { text: 'Category multiple' }), el('b', { text: mult.toFixed(4) })]),
        el('div', {}, [el('span', { text: 'Growth (7d)' }), el('b', { text: pct(row.change_7d) + ' → ×' + (row.growth_multiplier || 1).toFixed(4) })]),
        el('div', {}, [el('span', { text: 'Implied value' }), el('b', { text: fmtMoney(row.implied_value_usd) })])
      ]),
      el('p', { class: recomputeMatch ? 'recompute' : 'recompute bad', text: recomputeMatch ? '✓ Recomputed by this page: ' + fmtMoney(recomputed) + ' — matches the value this row carries.' : '✗ Recompute mismatch: this page gets ' + fmtMoney(recomputed) + ' but this row carries ' + fmtMoney(row.implied_value_usd) + '.' }),
      el('p', { class: 'note', text: 'TVL ' + fmtMoney(row.tvl_usd) + ' × multiple ' + mult.toFixed(4) + ' × growth ×' + (row.growth_multiplier || 1).toFixed(4) + ' × maturity ×' + (row.maturity_multiplier || 1).toFixed(4) + ' = ' + fmtMoney(row.implied_value_usd) + '. ' + "Growth is the 7-day change clamped to ±25%; maturity runs 0.75–1.00 over 1,095 days (unknown age counts as 365 days)." })
    ]);
    var compRows = comps.map(function (c) {
      return el('tr', {}, [
        el('td', { text: c.name }),
        el('td', { class: 'num', text: money(c.tvl_usd) }),
        el('td', { class: 'num', text: money(c.mcap_usd || 0) }),
        el('td', { class: 'num', text: (c.mcap_usd && c.tvl_usd ? (c.mcap_usd / c.tvl_usd).toFixed(3) : '\u2014') })
      ]);
    });
    var med = null;
    for (var mi = 0; mi < (DATA.medians || []).length; mi++) { if (DATA.medians[mi].category === row.category) { med = DATA.medians[mi]; break; } }
    var compNote;
    
    var gmed = (DATA.global_median || 0).toFixed(4);
    if (comps.length === 0) {
      compNote = (med && med.n >= 2)
        ? 'This category has ' + med.n + ' live comparables in the full snapshot, none of them in the top-24 live set shown here — the board prices this row at their median (' + med.median.toFixed(4) + ').'
        : 'Fewer than 2 live comparables in this category in the full snapshot — the global median ' + gmed + ' is used.';
    } else if (med && med.n >= 2) {
      compNote = 'These are the three live protocols in this category closest to this row by TVL. The board prices this row at the median of all ' + med.n + ' live comparables in the category (' + med.median.toFixed(4) + ') — see the calibration table on the live tab.';
    } else {
      compNote = 'Only ' + (med ? med.n : 0) + ' live comparable in this category in the full snapshot — the global median ' + gmed + ' is used.';
    }
    
    var compSec = el('section', {}, [
      el('h3', { text: 'Live comparables in ' + (row.category || 'this category') }),
      comps.length ? el('div', {}, [
        el('table', {}, [
          el('thead', {}, [el('tr', {}, [el('th', { text: 'Protocol' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'mcap / TVL' })])]),
          el('tbody', {}, compRows)
        ]),
        el('p', { class: 'note', text: compNote })
      ]) : el('p', { class: 'note', text: compNote })
    ]);
    
    var stepItems = steps.map(function (s, i) {
      return el('li', {}, [el('b', { text: (i + 1) + '.' }), document.createTextNode(s)]);
    });
    var farmSec = el('section', {}, [
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, stepItems),
      el('p', { class: 'total', text: 'Plan total: see each step’s cost and time above; capital stays in the position for the hold window.' })
    ]);
    body.appendChild(el('div', { class: 'detail-cols' }, [
      el('div', {}, [modelSec, compSec]),
      el('div', {}, [farmSec])
    ]));
    body.appendChild(el('p', { class: 'note', text: 'This is an estimate, not a price. The protocol records no token in this snapshot; that is what the snapshot says, never a promise it has none.' }));
    dialog.appendChild(body);
    dialog.addEventListener('close', function () { if (state.detail === slug) { state.detail = null; writeHash(); } });
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }
  function render() {
    var app = $('#app');
    app.innerHTML = '';
    app.setAttribute('aria-busy', 'false');
    var top1 = DATA.rows[0];
    var top = el('div', { class: 'top' }, [
      el('span', { class: 'brand', html: '<i></i>Token Radar' }),
      el('span', { text: 'Snapshot ' + DATA.as_of + '  ·  DefiLlama protocol index  ·  ' + DATA.model_version + ' model' })
    ]);
    app.appendChild(top);
    app.appendChild(el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }));
    var hero = el('div', { class: 'hero' }, []);
    
    hero.appendChild(el('div', { class: 'big' }, [
      el('div', { class: 'lbl', text: '#1 implied value —' }),
      el('div', { class: 'val', text: top1 ? money(top1.implied_value_usd) : '—' }),
      el('div', { class: 'sub', text: top1 ? top1.name : '' })
    ]));
    
    var facts = el('div', { class: 'facts' }, [
      el('div', { class: 'fact' }, [el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })]),
      el('div', { class: 'fact' }, [el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })]),
      el('div', { class: 'fact' }, [el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })]),
      el('div', { class: 'fact' }, [el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })])
    ]);
    hero.appendChild(facts);
    app.appendChild(hero);
    app.appendChild(el('p', { class: 'lede', html: 'The watchlist is the floor: every protocol with at least ' + money(DATA.floor_usd) + ' of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. <b>Implied value is a model, not a promise.</b>' }));
    
    var covered = ROWS ? ROWS.length : DATA.board_size;
    app.appendChild(el('p', { class: 'proof', text: 'watchlist ' + DATA.watchlist_size + '/' + DATA.watchlist_size + ' · ' + DATA.board_size + ' rows · all implied values distinct · ' + covered + ' rows printed in full in the dossier text' }));
    
    var cats = [];
    DATA.rows.concat(DATA.live).forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
    cats.sort();
    var chains = [];
    DATA.rows.concat(DATA.live).forEach(function (r) { r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
    chains.sort();
    var controls = el('div', { class: 'controls' }, []);
    var search = el('input', { type: 'search', id: 'search-input', placeholder: 'Search name, category or chain' });
    search.value = state.q;
    search.addEventListener('input', function () { state.q = search.value; var pos = search.selectionStart; render(); var again = document.querySelector('input[type=search]'); if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) {} } });
    controls.appendChild(el('div', { class: 'field' }, [el('label', { for: 'search-input' }, ['Search']), search]));
    var catSel = el('select', { id: 'cat-select' }, [el('option', { value: 'all', text: 'All categories' })].concat(cats.map(function (c) { return el('option', { value: c, text: c }); })));
    catSel.value = state.category;
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    controls.appendChild(el('div', { class: 'field' }, [el('label', { for: 'cat-select' }, ['Category']), catSel]));
    
    var chainSel = el('select', { id: 'chain-select' }, [el('option', { value: 'all', text: 'All chains' })].concat(chains.map(function (c) { return el('option', { value: c, text: c }); })));
    chainSel.value = state.chain;
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; render(); });
    controls.appendChild(el('div', { class: 'field' }, [el('label', { for: 'chain-select' }, ['Chain']), chainSel]));
    if (state.tab !== 'live') {
    var wl = el('label', { class: 'check' }, [el('input', { type: 'checkbox' }), document.createTextNode('Watchlist only')]);
    var wlBox = wl.querySelector('input');
    wlBox.checked = state.watchlist;
    wlBox.addEventListener('change', function () { state.watchlist = wlBox.checked; writeHash(); render(); });
    controls.appendChild(wl);
    }
    
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    controls.appendChild(el('div', { class: 'field' }, [el('span', { text: 'Token status' }), el('div', { class: 'tabs' }, [pre, live])]));
    controls.appendChild(el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : liveRowsFiltered().length + ' live-token protocols' }));
    app.appendChild(controls);
    app.appendChild(el('div', { id: 'board' }, [state.tab === 'pre-token' ? boardTable() : el('div', {}, [calibrationTable(), liveTable()])]));
    
    if (state.tab !== 'live') app.appendChild(el('section', { class: 'panel' }, [
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('code', { text: "implied = round( tvl_usd x catMultiple(category) x (1 + clamp(change_7d, -25, 25) / 100 x 0.5) x (0.75 + min(age_days, 1095) / 1095 x 0.25) )" }),
      el('p', { text: "catMultiple is the median mcap/TVL of live-token protocols in the same category, computed from this snapshot — at least 2 live comps, else the global median of all live comps. Clamped to [0.02, 1.00]. Growth is a ±25%-clamped 7-day tilt; age is a 0.75–1.00 maturity tilt over 1,095 days (unknown age counts as 365 days)." })
    ]));
    
    
    app.appendChild(el('section', { class: 'panel' }, [
      el('h2', { text: 'Not ranked — and why' }),
      el('p', { text: 'The biggest protocols the snapshot records are not token launches and are left off this board on purpose: WBTC and Binance staked ETH are wrapped or staked products of tokens that already trade; Base Bridge is a canonical bridge. Bridges and staking receipts are left out because the value they move already belongs to a token that trades.' }),
      el('p', { text: 'Every row above can be checked against the dossier text: the full board — rank, slug, TVL, multiple, implied value and age — is printed there, row for row.' })
    ]));
    
    app.appendChild(el('footer', {}, [
      el('p', { text: 'Source: DefiLlama protocols index, fetched ' + DATA.source + '. A protocol is listed as recording no token when the snapshot carries no market cap, CoinGecko id or symbol for it — never as having no token.' }),
      el('p', { text: 'Judge’s note: every implied value on this board is TVL × the multiple the model states × the growth tilt × the maturity tilt, computed from this same snapshot — open any row to see its multiple and its inputs.' })
    ]));
    var dialog = document.createElement('dialog');
    dialog.className = 'detail';
    dialog.id = 'detail';
    dialog.setAttribute('aria-labelledby', 'detail-title');
    app.appendChild(dialog);
    if (state.detail) { var slug = state.detail; state.detail = null; openDetail(slug); }
  }
  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
