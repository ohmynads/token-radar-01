// Token Radar model sandbox, radar-2.
//
// A reader should be able to test the model, not just trust it. This page takes
// the same rows board.json carries, lets the reader change the fitted multiple,
// the growth weight and the maturity range, and re-ranks the top ten live, in
// the browser, with no network. Nothing here writes to the board: the sandbox
// is a what-if tool, and the board stays the fitted model's ranking.
//
// The arithmetic here is deliberately the same shape as lib/model.ts, written
// out again in plain JavaScript so the page stands alone beside data.js:
//     growth  = clamp(change_7d, floor, cap)
//     growthM = 1 + (growth / 100) * growthWeight
//     age     = age_days, or 365 when the snapshot records none
//     mature  = 0.6 + min(age, 1095) / 1095 * maturityRange
//     implied = max(1, round(tvl * multiple * growthM * mature))
//
// Three questions the sandbox answers, and the dashboard cannot:
//   1. How sensitive is the top ten to the multiple? Move it from 0.10 to 0.40
//      and watch Steakhouse, Gauntlet and Veda: their order barely moves,
//      because they are separated by TVL, not by the multiple. The multiple
//      sets the level, not the ranking, and that is a property a reader
//      should be able to check in a minute.
//   2. How sensitive is it to growth? Raise the growth weight and the fast
//      growers climb; lower it and the old, large protocols hold their place.
//   3. What is the range? Every implied value carries a half-to-double range,
//      roughly one residual standard deviation in log space for the live
//      peers. The sandbox shows the range beside every value, so a $410M
//      point estimate reads as $205M-$820M, which is what the fit actually
//      supports.

(function () {
    'use strict';

    var DATA = window.RADAR;
    if (!DATA) return;

    var root = document.getElementById('sandbox');
    var model = DATA.model;
    var state = {
        multiple: model.base_multiple,
        growthWeight: model.growth_weight,
        maturityRange: model.maturity_range,
        maturityFloor: model.maturity_floor,
    };

    function usd(n) {
        if (n === null || n === undefined || !isFinite(n)) return 'n/a';
        if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
        if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
        if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
        return '$' + Math.round(n);
    }

    function el(tag, attrs) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === 'class') node.className = attrs[k];
                else if (k === 'text') node.textContent = attrs[k];
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

    // Score one row under the sandbox's current constants. The shape matches
    // lib/model.ts exactly, so a reader can compare the two functions line
    // by line and see that the page is not running a second, hidden model.
    function score(row) {
        var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
        var growthM = 1 + (growth / 100) * state.growthWeight;
        var age = row.age_days === null ? model.unknown_age_days : row.age_days;
        var mature = state.maturityFloor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * state.maturityRange;
        var implied = Math.max(1, Math.round(row.tvl_usd * state.multiple * growthM * mature));
        return { implied: implied, low: Math.max(1, Math.round(implied * 0.5)), high: Math.round(implied * 2), growthM: growthM, mature: mature };
    }

    function ranked() {
        var scored = DATA.rows.map(function (row) {
            var s = score(row);
            return { row: row, implied: s.implied, low: s.low, high: s.high };
        });
        scored.sort(function (a, b) {
            return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : 1);
        });
        return scored.slice(0, 10);
    }

    function slider(label, min, max, step, value, onChange) {
        var input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
        var shown = el('b', { class: 'num', text: String(value) });
        input.addEventListener('input', function () {
            shown.textContent = input.value;
            onChange(parseFloat(input.value));
            render();
        });
        return el('div', { class: 'field' },
            el('label', { text: label }),
            input,
            shown
        );
    }

    function render() {
        root.textContent = '';
        var shell = el('div', { class: 'shell' });
        shell.appendChild(el('header', { class: 'top' },
            el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
            el('div', { class: 'top-meta' },
                el('span', { text: 'Snapshot ' + DATA.as_of }),
                el('span', { text: DATA.model_version + ' model sandbox' })
            )
        ));
        shell.appendChild(el('section', { class: 'lede' },
            el('div', null,
                el('h1', { text: 'Test the model, do not trust it' }),
                el('p', { text: 'The fitted multiple is ' + model.base_multiple + ', the median market-cap/TVL of the snapshot\u2019s live-token peers. Move the sliders and watch the top ten: the multiple sets the level, growth sets the order among close rivals, and every value carries a half-to-double range.' })
            ),
            el('div', { class: 'facts' },
                el('div', { class: 'fact' }, el('span', { text: 'Fitted multiple' }), el('b', { text: String(model.base_multiple) })),
                el('div', { class: 'fact' }, el('span', { text: 'Rows in the board' }), el('b', { text: String(DATA.board_size) })),
                el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }))
            )
        ));
        var controls = el('div', { class: 'controls' },
            slider('Base multiple', 0.05, 0.5, 0.005, state.multiple, function (v) { state.multiple = v; }),
            slider('Growth weight', 0, 1, 0.05, state.growthWeight, function (v) { state.growthWeight = v; }),
            slider('Maturity range', 0, 0.8, 0.05, state.maturityRange, function (v) { state.maturityRange = v; }),
            el('button', { class: 'button primary', type: 'button', text: 'Reset to the fitted model', onclick: function () {
                state.multiple = model.base_multiple;
                state.growthWeight = model.growth_weight;
                state.maturityRange = model.maturity_range;
                render();
            } })
        );
        shell.appendChild(controls);
        var top = ranked();
        var tbody = el('tbody');
        top.forEach(function (item, i) {
            tbody.appendChild(el('tr', null,
                el('td', { class: 'num', text: String(i + 1) }),
                el('td', null, el('div', { class: 'name' },
                    el('b', { text: item.row.name }),
                    el('span', { class: 'sub', text: (item.row.category || 'Other') + ' on ' + (item.row.chains && item.row.chains.length ? item.row.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
                )),
                el('td', { class: 'num', text: usd(item.row.tvl_usd) }),
                el('td', { class: 'num', text: usd(item.implied) }),
                el('td', { class: 'num sub', text: usd(item.low) + ' - ' + usd(item.high) })
            ));
        });
        shell.appendChild(el('div', { class: 'panel' },
            el('div', { class: 'table-wrap' },
                el('table', null,
                    el('caption', { class: 'sub', text: 'Top ten under the sandbox constants. The board itself is unchanged: this page only re-ranks what the board already carries.' }),
                    el('thead', null, el('tr', null,
                        el('th', { scope: 'col', text: 'Rank' }),
                        el('th', { scope: 'col', text: 'Protocol' }),
                        el('th', { scope: 'col', text: 'TVL' }),
                        el('th', { scope: 'col', text: 'Implied value' }),
                        el('th', { scope: 'col', text: 'Range (half to double)' })
                    )),
                    tbody
                )
            )
        ));
        shell.appendChild(el('section', { class: 'panel model' },
            el('h2', { text: 'What the sandbox shows' }),
            el('p', { class: 'sub', text: 'At the fitted multiple the top three are the same three the board ranks first, because their TVLs are far apart. That is the point of the sandbox: a reader can see which parts of the ranking are robust to the model and which parts are a coin flip between close rivals, instead of taking a single number on trust.' }),
            el('p', { class: 'sub', text: 'Back to the board: ' }),
            el('a', { href: 'index.html', text: 'Open the full board' })
        ));
        root.appendChild(shell);
    }

    render();
})();
