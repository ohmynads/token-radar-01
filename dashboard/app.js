// Token Radar dashboard, radar-2. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail drawer with the model's own inputs, the protocol's farm
// plan, and the wide range around every implied value. No network: every byte
// it shows is in data.js. The model sandbox lives beside it, in sandbox.html.
(function () {
    'use strict';

    var DATA = window.RADAR;
    if (!DATA) return;
    var app = document.getElementById('board');
    var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

    var moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

    function money(n) {
        if (n === null || n === undefined || !isFinite(n)) return 'n/a';
        if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
        if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
        if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
        return moneyFmt.format(n);
    }

    function pct(n) {
        if (n === null || n === undefined || !isFinite(n)) return 'n/a';
        return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
    }

    function ageText(days) {
        if (days === null || days === undefined) return 'unknown';
        if (days >= 365) return (days / 365).toFixed(1) + 'y';
        return Math.max(0, Math.round(days)) + 'd';
    }

    function rangeText(implied) {
        var low = Math.max(1, Math.round(implied * 0.5));
        var high = Math.round(implied * 2);
        return money(low) + ' - ' + money(high);
    }

    // The model in one function: the page recomputes a row from the snapshot
    // figures and checks the number board.json carries, so the page's code and
    // the board's data are visibly the same arithmetic.
    function recompute(row, model) {
        var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
        var growthM = 1 + (growth / 100) * model.growth_weight;
        var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
        var mature = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
        return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthM * mature));
    }

    function h(tag, attrs) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === 'class') node.className = attrs[k];
                else if (k === 'text') node.textContent = attrs[k];
                else if (k === 'html') node.innerHTML = attrs[k];
                else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
                else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
            });
        }
        for (var i = 2; i < arguments.length; i++) {
            var child = arguments[i];
            if (child === null || child === undefined) continue;
            if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
            else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
            else node.appendChild(child);
        }
        return node;
    }

    // The farm plan is the same derivation main.ts writes to board.json:
    // category, chains, TVL and age decide the action, the capital, the hold
    // and every cost and time. No name is special-cased.
    function firstChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }

    function capitalFor(p) {
        if (p.tvl_usd >= 5e9) return 250;
        if (p.tvl_usd >= 1e9) return 150;
        if (p.tvl_usd >= 1e8) return 100;
        return 50;
    }

    function holdFor(age) {
        if (age === null || age === undefined) return 30;
        if (age < 180) return 60;
        if (age < 365) return 45;
        return 30;
    }

    function actionFor(p, capital, chain) {
        var c = (p.category || '').toLowerCase();
        var name = p.name;
        if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
        if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
        if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
        if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
        if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
        if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
        if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
        if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
        if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
        if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
        return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
    }

    function joinStep(step) {
        var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
        if (s.length > 600) s = s.slice(0, 596) + '...';
        if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
        return s;
    }

    function farmPlan(p) {
        var chain = firstChain(p);
        var capital = capitalFor(p);
        var hold = holdFor(p.age_days);
        var weeks = Math.ceil(hold / 7);
        var gas = 3 + (capital >= 150 ? 8 : 4) + 2 * weeks;
        var minutes = 5 + 15 + 10 * weeks + 10 + 5;
        var perHour = Math.round((gas / (minutes / 60)) * 10) / 10;
        return [
            { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
            { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
            { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
            { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
            { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
            { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
            { text: 'Count the whole plan before you start: about $' + gas + ' of gas over ' + minutes + ' minutes of your time, about $' + perHour + ' per hour, plus $' + capital + ' of capital that stays in the position.', cost: 'about $' + gas + ' of gas in total', time: minutes + ' minutes in total' }
        ].map(joinStep);
    }

    function readHash() {
        var hash = window.location.hash.replace(/^#/, '');
        if (!hash) return;
        var params = new URLSearchParams(hash);
        if (params.get('q')) state.q = params.get('q');
        if (params.get('p')) state.selected = params.get('p');
        if (params.get('category')) state.category = params.get('category');
    }

    function writeHash() {
        var params = new URLSearchParams();
        if (state.q) params.set('q', state.q);
        if (state.category !== 'all') params.set('category', state.category);
        if (state.selected) params.set('p', state.selected);
        var next = params.toString();
        if (next) window.history.replaceState(null, '', '#' + next);
        else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    function visibleRows() {
        var q = state.q.trim().toLowerCase();
        return DATA.rows.filter(function (r) {
            if (state.category !== 'all' && r.category !== state.category) return false;
            if (!q) return true;
            var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
            return hay.indexOf(q) >= 0;
        });
    }

    function sortedRows(list) {
        var key = state.sort;
        return list.slice().sort(function (a, b) {
            var av, bv;
            if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
            else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
            else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
            else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
            else { av = a.implied_value_usd; bv = b.implied_value_usd; }
            if (av < bv) return -state.dir;
            if (av > bv) return state.dir;
            return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
        });
    }

    function pageHeader() {
        return h('header', { class: 'top' },
            h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
            h('div', { class: 'top-meta' },
                h('span', { text: 'Snapshot ' + DATA.as_of }),
                h('span', { text: 'DefiLlama protocol index' }),
                h('span', { text: DATA.model_version + ' model' })
            )
        );
    }

    function lede() {
        return h('section', { class: 'lede' },
            h('div', null,
                h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
                h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' }),
                h('p', null, h('a', { href: 'sandbox.html', text: 'Test the model in the sandbox' }))
            ),
            h('div', { class: 'facts' },
                h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
                h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
                h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(DATA.early_size) })),
                h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) }))
            )
        );
    }

    function controls() {
        var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
        var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
        search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
        var select = h('select', { id: 'category', 'aria-label': 'Filter by category' },
            h('option', { value: 'all', text: 'All categories' }),
            categories.map(function (c) { return h('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
        );
        select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
        var pre = h('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
        var live = h('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
        return h('div', { class: 'controls' },
            h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
            h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), select),
            h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
            h('span', { class: 'count', text: state.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
        );
    }

    function sortTh(key, label) {
        return h('th', { scope: 'col' },
            h('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
                label,
                state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
            )
        );
    }

    function boardTable() {
        var list = sortedRows(visibleRows());
        if (list.length === 0) {
            return h('div', { class: 'panel' }, h('div', { class: 'empty' },
                h('h2', { text: 'No protocol matches that filter' }),
                h('p', { text: 'Clear the search or pick another category to see the board again.' }),
                h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; render(); } })
            ));
        }
        var max = list[0].implied_value_usd || 1;
        var tbody = h('tbody');
        list.forEach(function (r) {
            var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
            var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
            var tr = h('tr', {
                'data-selected': state.selected === r.slug ? 'true' : 'false',
                tabindex: '0',
                onclick: function () { openDetail(r.slug); },
                onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
            },
                h('td', { class: 'num', text: String(r.rank) }),
                h('td', null, h('div', { class: 'name' },
                    h('b', { text: r.name }),
                    h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
                )),
                h('td', { class: 'num', text: money(r.tvl_usd) }),
                h('td', { class: 'num ' + growthClass, text: growth }),
                h('td', { class: 'num', text: ageText(r.age_days) }),
                h('td', null, h('div', { class: 'implied' },
                    h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
                    h('span', { class: 'num', text: money(r.implied_value_usd) })
                )),
                h('td', { class: 'num sub', text: rangeText(r.implied_value_usd) }),
                h('td', null, h('span', { class: 'status', text: 'no token' }))
            );
            tbody.appendChild(tr);
        });
        return h('div', { class: 'panel' },
            h('div', { class: 'table-wrap' },
                h('table', null,
                    h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
                    h('thead', null, h('tr', null,
                        sortTh('implied', 'Rank'),
                        sortTh('name', 'Protocol'),
                        sortTh('tvl', 'TVL'),
                        sortTh('growth', '7d'),
                        sortTh('age', 'Age'),
                        sortTh('implied', 'Implied value'),
                        h('th', { scope: 'col', text: 'Range' }),
                        h('th', { scope: 'col', text: 'Token' })
                    )),
                    tbody
                )
            )
        );
    }

    function liveTable() {
        var tbody = h('tbody');
        DATA.live.forEach(function (r) {
            tbody.appendChild(h('tr', null,
                h('td', { class: 'num', text: 'live' }),
                h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
                h('td', { class: 'num', text: money(r.tvl_usd) }),
                h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
                h('td', { class: 'num', text: money(r.mcap_usd) }),
                h('td', null, h('span', { class: 'status', text: 'already trades' }))
            ));
        });
        return h('div', { class: 'panel' },
            h('div', { class: 'table-wrap' },
                h('table', null,
                    h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
                    h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Token' }))),
                    tbody
                )
            )
        );
    }

    function modelPanel() {
        var m = DATA.model;
        return h('section', { class: 'panel model' },
            h('h2', { text: 'How implied value is computed' }),
            h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
            h('div', { class: 'formula' },
                'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
            ),
            h('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
            h('p', { class: 'sub', text: 'The ' + m.base_multiple + ' base multiple is fitted at run time, not assumed: it is the median market-cap/TVL of the live-token protocols in this snapshot with ratios 0.01-2.0. Category medians were too noisy to use (Risk Curators has one live peer), and a log-log fit was too dispersed (residual std 1.3 log units), so the global median is used and the range is wide: treat every implied value as an order of magnitude, not a price.' })
        );
    }

    var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
    dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

    function openDetail(slug) {
        var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
        if (!row) return;
        state.selected = slug;
        writeHash();
        dialog.textContent = '';
        var steps = farmPlan(row);
        dialog.appendChild(h('div', { class: 'detail-head' },
            h('div', null,
                h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
                h('h2', { id: 'detail-title', text: row.name }),
                h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
            ),
            h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
        ));
        dialog.appendChild(h('section', { class: 'detail-section' },
            h('h3', { text: 'Implied value' }),
            h('div', { class: 'equation' },
                h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: money(row.tvl_usd) })),
                h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pct(row.change_7d) })),
                h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageText(row.age_days) })),
                h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: String(row.growth_multiplier) })),
                h('div', null, h('span', { text: 'Maturity multiplier' }), h('b', { class: 'num', text: String(row.maturity_multiplier) })),
                h('div', null, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: money(row.implied_value_usd) })),
                h('div', null, h('span', { text: 'Range (half to double)' }), h('b', { class: 'num', text: rangeText(row.implied_value_usd) }))
            ),
            h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recompute(row, DATA.model)) + (recompute(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
        ));
        dialog.appendChild(h('section', { class: 'detail-section' },
            h('h3', { text: 'Farm plan' }),
            h('ol', { class: 'steps' }, steps.map(function (s) {
                var at = s.indexOf(' Cost: ');
                var action = at >= 0 ? s.slice(0, at) : s;
                var tail = at >= 0 ? s.slice(at + 1) : '';
                return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
            }))
        ));
        if (typeof dialog.showModal === 'function') {
            if (!dialog.open) dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
    }

    function render() {
        app.textContent = '';
        var shell = h('div', { class: 'shell' });
        shell.appendChild(pageHeader());
        shell.appendChild(lede());
        shell.appendChild(controls());
        shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
        if (state.tab === 'pre-token') shell.appendChild(modelPanel());
        app.appendChild(shell);
        app.setAttribute('aria-busy', 'false');
        if (!dialog.isConnected) app.appendChild(dialog);
        if (state.selected) openDetail(state.selected);
    }

    readHash();
    render();
    window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && dialog.open) dialog.close();
    });
})();
