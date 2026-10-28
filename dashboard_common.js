// ═══════════════════════════════════════════════════════════════════════════
// SHARED DASHBOARD & GENERATOR UTILITIES
// Used by dashboard1.html, dashboard2.html, dashboard3.html,
// gen_data_dashboard2.js, and gen_data_dashboard3.js
// ═══════════════════════════════════════════════════════════════════════════

function median(arr) {
    if (!arr || !arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

function mean(arr) {
    if (!arr || !arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

const n4 = x => Number((x || 0).toPrecision(4));
const n5 = x => Number((x || 0).toPrecision(5));
const n2 = x => Number((x || 0).toFixed(2));
const n3 = x => Number((x || 0).toFixed(3));
const pctDiff = (apred, aobs) => aobs !== 0 ? n2(((apred - aobs) / Math.abs(aobs)) * 100) : 0;

function galaxy3DUrl(name) {
    return './index.html?gal=' + encodeURIComponent(name);
}

function galaxy3DLink(name, extraClass) {
    const cls = extraClass ? `gal-3d-link ${extraClass}` : 'gal-3d-link';
    const url = galaxy3DUrl(name);
    return `<a class="${cls}" href="${url}" target="_blank" rel="noopener" title="Open ${name} 3D Voxel Model">${name}&nbsp;<span class="link-arrow">&#8599;</span></a>`;
}

function getUrlGalaxy(dataList, fallback) {
    if (typeof window !== 'undefined' && window.location && window.location.search) {
        const params = new URLSearchParams(window.location.search);
        const g = params.get('gal') || params.get('galaxy') || params.get('name');
        if (g && dataList && dataList.some(d => d.name === g)) return g;
    }
    return fallback;
}

function syncUrlAndNavLinks(galName) {
    if (typeof window === 'undefined' || !galName) return;
    const q = '?gal=' + encodeURIComponent(galName);
    if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', q);
    }
    if (typeof document !== 'undefined') {
        document.querySelectorAll('.header a[href]').forEach(a => {
            const raw = a.getAttribute('href').split('?')[0];
            if (raw.endsWith('.html')) {
                a.setAttribute('href', raw + q);
            }
        });
    }
}

function updateSortHeaders(tableSelector, sortKey, sortAsc) {
    if (typeof document === 'undefined') return;
    document.querySelectorAll(`${tableSelector} th[data-sort]`).forEach(th => {
        const k = th.getAttribute('data-sort');
        th.classList.toggle('sorted-asc', k === sortKey && sortAsc);
        th.classList.toggle('sorted-desc', k === sortKey && !sortAsc);
    });
}

function scrollSelectedRowIntoView(tableSelector) {
    if (typeof document === 'undefined') return;
    const row = document.querySelector(`${tableSelector} tbody tr.gal-row.selected`);
    if (row && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function drawOverviewHoverReadout(ctx, ml, mt, pw, ph, hit, label) {
    if (!hit) return;
    const cx = hit.x + hit.w * 0.5;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(cx, mt);
    ctx.lineTo(cx, mt + ph);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(hit.x, hit.by, hit.barW, Math.max(2, hit.bh));

    const text = `#${hit.rank}/${hit.total}  ${hit.gal.name}  \u2014  ${label}: ${hit.val.toFixed(2)}%`;
    ctx.font = '11px monospace';
    const tw = ctx.measureText(text).width + 16;
    const bx = ml + 8;
    const by = mt + 4;
    ctx.fillStyle = 'rgba(10, 10, 18, 0.92)';
    ctx.fillRect(bx, by, tw, 22);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.strokeRect(bx + 0.5, by + 0.5, tw - 1, 21);
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + 8, by + 15);
    ctx.restore();
}

function setupHiDPICanvas(canvas, fallbackW, H) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width || fallbackW;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
}

function drawRankedOverviewCanvas(opts) {
    const {
        canvas, height = 225, ml = 48, items, getVal, maxVal,
        ticks, refTick, refColor, barColor, selectedColor = '#ffffff',
        selectedName, hoveredName, hoverLabel, footerText
    } = opts;
    const { ctx, W, H } = setupHiDPICanvas(canvas, 900, height);
    const axisColor = 'rgba(255,255,255,0.12)';
    const textColor = '#94a3b8';
    const mr = 16, mt = 16, mb = 32;
    const pw = W - ml - mr;
    const ph = H - mt - mb;

    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ticks.forEach(t => {
        if (t > maxVal) return;
        const y = mt + ph - (t / maxVal) * ph;
        const isRef = t === refTick;
        ctx.strokeStyle = isRef ? refColor : axisColor;
        ctx.setLineDash(isRef ? [4, 4] : []);
        ctx.beginPath();
        ctx.moveTo(ml, y);
        ctx.lineTo(ml + pw, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = textColor;
        ctx.fillText(t + '%', ml - 6, y + 3);
    });

    const bars = [];
    const n = items.length || 1;
    const barStep = pw / n;
    const barW = Math.max(1.5, barStep - (n > 80 ? 1 : 2));

    items.forEach((d, idx) => {
        const val = getVal(d);
        const clamped = Math.min(maxVal, val);
        const bh = (clamped / maxVal) * ph;
        const bx = ml + idx * barStep;
        const by = mt + ph - bh;

        ctx.fillStyle = d.name === selectedName ? selectedColor : barColor;
        ctx.fillRect(bx, by, barW, Math.max(2, bh));
        bars.push({ x: bx, w: barStep, barW, by, bh, val, rank: idx + 1, total: items.length, gal: d });
    });

    const hoveredHit = hoveredName ? bars.find(b => b.gal.name === hoveredName) : null;
    drawOverviewHoverReadout(ctx, ml, mt, pw, ph, hoveredHit, hoverLabel);

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.fillText(footerText, ml + pw / 2, H - 8);
    return bars;
}

function bindDashboardInteractions(opts) {
    const {
        onSearch, onChipSelect, onSort,
        getOverviewBars, getHoveredName, setHoveredName,
        onBarSelect, drawOverview, drawProfile
    } = opts;

    const searchEl = document.getElementById('search-input');
    if (searchEl) {
        searchEl.addEventListener('input', (e) => onSearch(e.target.value.trim()));
    }

    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            onChipSelect(chip.getAttribute('data-gal'));
            scrollSelectedRowIntoView('#gal-table');
        });
    });

    document.querySelectorAll('#gal-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => onSort(th.getAttribute('data-sort')));
    });

    const ovCanvas = document.getElementById('overview-canvas');
    if (ovCanvas) {
        ovCanvas.addEventListener('click', (e) => {
            const rect = e.target.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const hit = getOverviewBars().find(b => x >= b.x && x <= b.x + b.w);
            if (hit) {
                onBarSelect(hit.gal.name);
                scrollSelectedRowIntoView('#gal-table');
            }
        });
        ovCanvas.addEventListener('mousemove', (e) => {
            const rect = e.target.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const hit = getOverviewBars().find(b => x >= b.x && x <= b.x + b.w);
            const nextHover = hit ? hit.gal.name : null;
            if (nextHover !== getHoveredName()) {
                setHoveredName(nextHover);
                drawOverview();
            }
        });
        ovCanvas.addEventListener('mouseleave', () => {
            if (getHoveredName() !== null) {
                setHoveredName(null);
                drawOverview();
            }
        });
    }

    window.addEventListener('resize', () => {
        drawOverview();
        drawProfile();
    });
}

function hexToRgba(hex, alpha) {
    const clean = (hex || '#ffffff').replace('#', '');
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawDashboardProfileGrid(ctx, W, H, rmax, yBot, ySpan, xLabel, yLabel) {
    const gridColor = 'rgba(255,255,255,0.09)';
    const textColor = '#94a3b8';
    const ml = 68, mr = 18, mt = 18, mb = 42;
    const pw = W - ml - mr;
    const ph = H - mt - mb;
    const yTop = yBot + ySpan;

    function xpx(r) { return ml + (r / rmax) * pw; }
    function ypx(v) { return mt + ph - ((Math.min(yTop, v) - yBot) / ySpan) * ph; }

    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const yv = yBot + (i / 4) * ySpan;
        const y = ypx(yv);
        ctx.strokeStyle = gridColor;
        ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
        ctx.fillStyle = textColor;
        ctx.fillText(yv.toExponential(1), ml - 6, y + 3);
    }

    if (yBot < 0) {
        const y0 = ypx(0);
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.beginPath(); ctx.moveTo(ml, y0); ctx.lineTo(ml + pw, y0); ctx.stroke();
    }

    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
        const rv = (i / 4) * rmax;
        const x = xpx(rv);
        ctx.strokeStyle = gridColor;
        ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, mt + ph); ctx.stroke();
        ctx.fillStyle = textColor;
        ctx.fillText(rv.toExponential(1), x, mt + ph + 15);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(ml, mt, pw, ph);

    ctx.fillStyle = textColor;
    ctx.fillText(xLabel, ml + pw / 2, H - 6);
    ctx.save();
    ctx.translate(14, mt + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    return { ml, mt, pw, ph, xpx, ypx };
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED DATA GENERATOR UTILITIES (Node.js: gen_data_dashboard1/2/3.js)
// ═══════════════════════════════════════════════════════════════════════════

function computeCompStats(pts, acKey, pctKey) {
    let maxAc = 0, sumAbsAll = 0, cntAll = 0;
    for (const pt of pts) {
        const a = Math.abs(pt[acKey] || 0);
        if (a > maxAc) maxAc = a;
    }
    for (const pt of pts) {
        const acVal = Math.abs(pt[acKey] || 0);
        if (acVal === 0 && pt[pctKey] === 0) continue;
        // Ignore exact zero-crossing sign-flip points (< 1.5% of peak component accel) in summary mean %
        if (maxAc > 0 && acVal < 0.015 * maxAc) continue;
        sumAbsAll += Math.abs(pt[pctKey]);
        cntAll++;
    }
    return {
        meanAbsAll: n2(cntAll > 0 ? sumAbsAll / cntAll : 0),
        k0Pct: pts.length ? pts[0][pctKey] : 0,
        lastPct: pts.length ? pts[pts.length - 1][pctKey] : 0
    };
}

function computeFormulaStats(pts, rmax, aKey, pctKey) {
    const absAll = [], dexSqAll = [];
    const absInner = [], dexSqInner = [];
    const absOuter50 = [], dexSqOuter50 = [];
    for (const pt of pts) {
        if (pt.a_obs <= 0) continue;
        const absP = Math.abs(pt[pctKey]);
        const ap = Math.max(1e-16, pt[aKey]);
        const d = Math.log10(ap / pt.a_obs);
        absAll.push(absP);
        dexSqAll.push(d * d);
        if (pt.r <= 0.2 * rmax) {
            absInner.push(absP);
            dexSqInner.push(d * d);
        }
        if (pt.r >= 0.5 * rmax) {
            absOuter50.push(absP);
            dexSqOuter50.push(d * d);
        }
    }
    return {
        allMedAbs: n2(median(absAll)),
        allMeanAbs: n2(mean(absAll)),
        allRmsDex: n3(Math.sqrt(mean(dexSqAll))),
        innerMedAbs: absInner.length ? n2(median(absInner)) : null,
        innerMeanAbs: absInner.length ? n2(mean(absInner)) : null,
        innerRmsDex: absInner.length ? n3(Math.sqrt(mean(dexSqInner))) : null,
        outerMedAbs: absOuter50.length ? n2(median(absOuter50)) : null,
        outerMeanAbs: absOuter50.length ? n2(mean(absOuter50)) : null,
        outerRmsDex: absOuter50.length ? n3(Math.sqrt(mean(dexSqOuter50))) : null,
        k0Pct: pts.length ? pts[0][pctKey] : 0,
        lastPct: pts.length ? pts[pts.length - 1][pctKey] : 0
    };
}

function buildGravityDashboardData(opts) {
    const { fs, path, dirname, formulaKeys, includeF4GroupFits } = opts;
    const vflatSet = new Set(typeof gal_vflat !== 'undefined' ? gal_vflat : []);
    const concSet = new Set(typeof gal_concentratedmass !== 'undefined' ? gal_concentratedmass : []);

    const origLog = console.log, origTable = console.table;
    console.log = () => {};
    console.table = () => {};

    let cachedBasisMap = null;
    const cachePath = '/tmp/grav_basis_175.json';
    const srcFiles = ['lib.js', 'data_sparcgalaxies.js', 'logic.js', 'logic_dsk.js', 'logic_blg.js', 'logic_gas.js'];
    const newestSrcMtime = Math.max(...srcFiles.map(f => fs.statSync(path.join(dirname, f)).mtimeMs));
    const forceRecompute = typeof process !== 'undefined' && process.argv && process.argv.includes('--recompute');

    if (!forceRecompute && fs.existsSync(cachePath) && fs.statSync(cachePath).mtimeMs >= newestSrcMtime) {
        try {
            const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            if (raw.length && raw[0].pts && raw[0].pts[0]['GMr^2'] !== undefined) {
                cachedBasisMap = {};
                for (const item of raw) cachedBasisMap[item.name] = item;
            }
        } catch (e) {
            cachedBasisMap = null;
        }
    }

    let cacheUpdated = false;
    const freshBasisCache = [];

    const dataset = galaxieslist.map(name => {
        const g = galaxiesobj[name];
        thegal = name;
        init_gas_profile(g);

        const cached = cachedBasisMap && cachedBasisMap[name];
        if (cached && cached.pts && cached.pts.length === g.radiusdata.length && cached.pts[0]['GMr^2'] !== undefined) {
            for (let k = 0; k < g.radiusdata.length; k++) {
                const d = g.radiusdata[k], cp = cached.pts[k];
                for (const key of GRAV_MOMENT_KEYS) d[key] = cp[key];
            }
        } else {
            eval_galaxy_grav_moments(g);
            cacheUpdated = true;
        }

        freshBasisCache.push({
            name,
            rmax: g.rmax,
            has_blg: Boolean(g.has_blg),
            pts: g.radiusdata.map(d => {
                const pt = { r: d.r, a_obs: d.a };
                for (const key of GRAV_MOMENT_KEYS) pt[key] = d[key];
                return pt;
            })
        });

        logic_grav(g);

        const pts = g.radiusdata.map(d => {
            const a_obs = d.a || 0;
            const pt = {
                r: n4(d.r),
                a_obs: n4(a_obs)
            };
            for (const fk of formulaKeys) {
                const reg = GRAV_FORMULA_REGISTRY[fk];
                const a_val = d[reg.aField] || 0;
                pt['a_' + fk] = n4(a_val);
                pt['pct_' + fk] = pctDiff(a_val, a_obs);
                if (includeF4GroupFits && reg.evalGroupFn) {
                    for (const grp of ['vflat', 'conc']) {
                        const a_grp = reg.evalGroupFn(d, grp);
                        pt[`a_${fk}_${grp}`] = n4(a_grp);
                        pt[`pct_${fk}_${grp}`] = pctDiff(a_grp, a_obs);
                    }
                }
            }
            return pt;
        });

        const stats = {};
        for (const fk of formulaKeys) {
            stats[fk] = computeFormulaStats(pts, g.rmax, 'a_' + fk, 'pct_' + fk);
            if (includeF4GroupFits && GRAV_FORMULA_REGISTRY[fk] && GRAV_FORMULA_REGISTRY[fk].evalGroupFn) {
                stats[`${fk}_all`] = stats[fk];
                stats[`${fk}_vflat`] = computeFormulaStats(pts, g.rmax, `a_${fk}_vflat`, `pct_${fk}_vflat`);
                stats[`${fk}_conc`] = computeFormulaStats(pts, g.rmax, `a_${fk}_conc`, `pct_${fk}_conc`);
            }
        }

        const n_inner = pts.filter(p => p.a_obs > 0 && p.r <= 0.2 * g.rmax).length;
        const n_outer = pts.filter(p => p.a_obs > 0 && p.r >= 0.5 * g.rmax).length;

        g.voxels_dsk_sim = g.voxels_blg_sim = g.voxels_gas_sim = g.voxels_dskgas_sim = g.voxels_tot_sim = null;

        return {
            name,
            n: pts.length,
            n_inner,
            n_outer,
            has_blg: Boolean(g.has_blg),
            is_vflat: vflatSet.has(name),
            is_conc: concSet.has(name),
            rmax: Number(g.rmax.toPrecision(6)),
            r_dsk_efold: n4(get_r_dsk_efold(g)),
            stats,
            pts
        };
    });

    if (cacheUpdated) {
        try {
            fs.writeFileSync(cachePath, JSON.stringify(freshBasisCache), 'utf8');
        } catch (e) {}
    }

    console.log = origLog;
    console.table = origTable;

    return dataset;
}

function printDashboardSummary(dataset, formulaKeys, opts) {
    const includeF4GroupFits = opts && opts.includeF4GroupFits;
    for (const [grpKey, grpLabel, subset] of [
        ['all', 'ALL 175 GALAXIES', dataset],
        ['vflat', 'GAL_VFLAT (137 GALAXIES)', dataset.filter(g => g.is_vflat)],
        ['conc', 'GAL_CONCENTRATEDMASS (12 GALAXIES)', dataset.filter(g => g.is_conc)]
    ]) {
        console.log(`\n=== ${grpLabel} ===`);
        for (const f of formulaKeys) {
            const hasGrpFit = includeF4GroupFits && typeof GRAV_FORMULA_REGISTRY !== 'undefined' && GRAV_FORMULA_REGISTRY[f] && GRAV_FORMULA_REGISTRY[f].evalGroupFn;
            const useGrp = hasGrpFit && grpKey !== 'all';
            const aKey = useGrp ? `a_${f}_${grpKey}` : `a_${f}`;
            const pKey = useGrp ? `pct_${f}_${grpKey}` : `pct_${f}`;
            const stKey = hasGrpFit ? `${f}_${grpKey}` : f;
            const allPt = [], innerPt = [], outerPt = [], dexSq = [];
            for (const g of subset) {
                for (const p of g.pts) {
                    if (p.a_obs <= 0) continue;
                    const absP = Math.abs(p[pKey]);
                    allPt.push(absP);
                    if (p.r <= 0.2 * g.rmax) innerPt.push(absP);
                    if (p.r >= 0.5 * g.rmax) outerPt.push(absP);
                    const d = Math.log10(Math.max(1e-16, p[aKey]) / p.a_obs);
                    dexSq.push(d * d);
                }
            }
            const galMedMed = median(subset.map(g => g.stats[stKey].allMedAbs).filter(v => v !== null));
            console.log(
                `${f.toUpperCase().padEnd(9)} -> AllMed: ${median(allPt).toFixed(2)}% (Mean ${mean(allPt).toFixed(2)}%) | ` +
                `InnerMed(<=0.2r): ${median(innerPt).toFixed(2)}% | OuterMed(>=0.5r): ${median(outerPt).toFixed(2)}% | ` +
                `GalMed(med): ${galMedMed.toFixed(2)}% | RMS: ${Math.sqrt(mean(dexSq)).toFixed(3)} dex`
            );
        }
    }

    // High-acceleration regime sanity check (Earth orbit & Solar surface)
    console.log('\n=== HIGH-ACCELERATION REGIME SANITY CHECK (da / a_cl) ===');
    const a_earth = 5.93e-3; // m/s^2 (Earth orbit around Sun)
    const a_sun = 274.0;     // m/s^2 (Solar surface)
    for (const f of formulaKeys) {
        const reg = typeof GRAV_FORMULA_REGISTRY !== 'undefined' ? GRAV_FORMULA_REGISTRY[f] : null;
        if (!reg || !reg.evalFn) continue;
        const pEarth = { r: 1.496e11, 'GM/r^2': a_earth, 'GM/r': a_earth * 1.496e11, 'GM': a_earth * (1.496e11 ** 2), 'GMr': a_earth * (1.496e11 ** 3), 'GMr^2': a_earth * (1.496e11 ** 4) };
        const pSun = { r: 6.96e8, 'GM/r^2': a_sun, 'GM/r': a_sun * 6.96e8, 'GM': a_sun * (6.96e8 ** 2), 'GMr': a_sun * (6.96e8 ** 3), 'GMr^2': a_sun * (6.96e8 ** 4) };
        const daEarth = (reg.evalFn(pEarth) - a_earth) / a_earth;
        const daSun = (reg.evalFn(pSun) - a_sun) / a_sun;
        console.log(`${f.toUpperCase().padEnd(9)} -> Earth orbit (a=5.93e-3): da/a = ${daEarth.toExponential(2)} | Sun surface (a=274): da/a = ${daSun.toExponential(2)}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED GRAVITY FORMULA DASHBOARD ENGINE (dashboard2.html & dashboard3.html)
// ═══════════════════════════════════════════════════════════════════════════

function renderDashboardNav(activePage) {
    const items = [
        { id: 'viewer', href: './index.html', label: 'Mass Voxels' },
        { id: 'd1', href: './dashboard1.html', label: 'D1: Classical' },
        { id: 'd2', href: './dashboard2.html', label: 'D2: Formulas 1–5' },
        { id: 'd3', href: './dashboard3.html', label: 'D3: a-Term' }
    ];
    return `<nav class="header-nav">${items.map(it =>
        `<a class="nav-pill${it.id === activePage ? ' active' : ''}" href="${it.href}">${it.label}</a>`
    ).join('')}</nav>`;
}

function mountGravityDashboardLayout(cfg) {
    const root = document.getElementById('dashboard-root') || document.querySelector('.container');
    if (!root || document.getElementById('formula-cards')) return;
    const chips = cfg.quickChips || ['NGC3198', 'NGC2403', 'NGC5055', 'NGC2841', 'UGC00128', 'DDO154', 'F568-3'];
    root.innerHTML = `
  <div class="header">
    <div class="header-title-row">
      <h1 id="main-title">${cfg.mainTitleHtml || ''}</h1>
      <span class="header-sub" id="sub-title"></span>
    </div>
    <div class="header-right">
      ${renderDashboardNav(cfg.activeNav || 'd2')}
    </div>
  </div>
  <div class="formula-grid" id="formula-cards"></div>
  <div class="controls-bar" style="flex-direction:column;align-items:flex-start;">
    <div style="display:flex;width:100%;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <div class="btn-group" id="formula-group"></div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <div class="btn-group" id="test-group">
          <button class="btn active" data-group="all">All 175</button>
          <button class="btn" data-group="vflat">vflat (137)</button>
          <button class="btn" data-group="conc">conc (12)</button>
        </div>
        <div class="btn-group" id="radial-group">
          <button class="btn active" data-rad="all_r">All Radii</button>
          <button class="btn" data-rad="inner">Inner &le;0.2r</button>
          <button class="btn" data-rad="outer">Outer &ge;0.5r</button>
        </div>
        <div class="btn-group" id="plot-mode-group">
          <button class="btn active" data-pm="accel">Acceleration a(r)</button>
          <button class="btn" data-pm="vel">Velocity v(r) = &radic;(r&middot;a)</button>
        </div>
      </div>
    </div>
    <div style="display:flex;width:100%;align-items:center;gap:10px;flex-wrap:wrap;">
      <input type="text" class="search-input" id="search-input" placeholder="${cfg.searchPlaceholder || 'Search galaxy (NGC3198)'}">
      <div class="quick-chips">
        <span style="font-size:11px;color:var(--text-tertiary);">Quick inspect:</span>
        ${chips.map(g => `<span class="chip" data-gal="${g}">${g}</span>`).join('')}
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-header">
      <h2 class="card-title" id="overview-title">Galaxies Ranked by Median |diff|</h2>
      <div class="legend" id="overview-legend"></div>
    </div>
    <canvas id="overview-canvas" height="225"></canvas>
  </div>
  <div class="split-grid">
    <div class="card">
      <div class="card-header">
        <h2 class="card-title" id="inspector-title">Radial Profile Inspector</h2>
        <div class="legend" id="inspector-legend"></div>
      </div>
      <canvas id="profile-canvas" height="300"></canvas>
      <div id="inspector-meta" style="margin-top:10px;font-size:12px;font-family:var(--font-mono);color:var(--text-secondary);"></div>
    </div>
    <div class="card">
      <div class="card-header">
        <h2 class="card-title" id="pt-table-title">Point-by-Point Radial Comparison vs Observed a_obs</h2>
      </div>
      <div class="table-wrap" style="max-height:335px;">
        <table id="pt-table"><thead><tr id="pt-table-head"></tr></thead><tbody></tbody></table>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-header">
      <h2 class="card-title" id="bench-table-title">Complete Galaxy Gravity Formula Benchmark Table</h2>
      <span style="font-size:12px;color:var(--text-tertiary);">Click any column header to sort; click any row to inspect</span>
    </div>
    <div class="table-wrap">
      <table id="gal-table"><thead><tr></tr></thead><tbody></tbody></table>
    </div>
  </div>`;
}

function initGravityDashboard(cfg) {
    mountGravityDashboardLayout(cfg);
    const DATA = cfg.data;
    const FORMULA_KEYS = cfg.formulaKeys;
    const FORMULA_INFO = cfg.formulaMeta;
    const WIN_FORMULA_KEYS = cfg.winFormulaKeys || FORMULA_KEYS;
    const PROFILE_DRAW_ORDER = cfg.profileDrawOrder || [...FORMULA_KEYS].reverse();
    const PRIMARY_HIGHLIGHT_KEYS = new Set(cfg.primaryHighlightKeys || [FORMULA_KEYS[0]]);

    let currentGroup = 'all';   // 'all' (175 galaxies) | 'vflat' (137 gal_vflat) | 'conc' (12 gal_concentratedmass)
    let currentRad = 'all_r';   // 'all_r' (All Radii) | 'inner' (r <= 0.20 rmax) | 'outer' (r >= 0.50 rmax)
    let currentFormula = 'all'; // 'all' | formulaKey
    let plotMode = 'accel';     // 'accel' | 'vel'
    let searchQuery = '';
    let selectedGalaxyName = getUrlGalaxy(DATA, cfg.defaultGalaxy || 'NGC3198');
    let sortKey = cfg.defaultSortKey || (FORMULA_KEYS[0] + '_med');
    let sortAsc = true;
    let overviewBars = [];
    let hoveredGalaxyName = null;

    // 1. Dynamically build #formula-group buttons and #gal-table header from FORMULA_KEYS
    const formulaGroupEl = document.getElementById('formula-group');
    if (formulaGroupEl) {
        formulaGroupEl.innerHTML =
            `<button class="btn active" data-f="all">${cfg.allFormulasBtnLabel || 'All Formulas'}</button>` +
            FORMULA_KEYS.map(fk => `<button class="btn" data-f="${fk}">${FORMULA_INFO[fk].btnHtml || FORMULA_INFO[fk].short}</button>`).join('');
    }

    const galTableHeadRow = document.querySelector('#gal-table thead tr');
    if (galTableHeadRow) {
        galTableHeadRow.innerHTML = `
            <th data-sort="name">Galaxy</th>
            <th data-sort="is_vflat">vflat</th>
            <th data-sort="is_conc">conc</th>
            <th data-sort="has_blg">has_blg</th>
            <th data-sort="n">Pts</th>
            <th data-sort="rmax">rmax (m)</th>
            ${FORMULA_KEYS.map(fk => `<th data-sort="${fk}_med">${FORMULA_INFO[fk].thHtml || FORMULA_INFO[fk].short}</th>`).join('')}
            <th data-sort="best">${cfg.bestColHeader || 'Best Formula'}</th>
        `;
    }

    function applyActiveFormulaButtonStyles() {
        document.querySelectorAll('#formula-group .btn').forEach(btn => {
            const fk = btn.getAttribute('data-f');
            const isActive = fk === currentFormula;
            btn.classList.toggle('active', isActive);
            if (isActive && fk !== 'all' && FORMULA_INFO[fk]) {
                const c = FORMULA_INFO[fk].color;
                btn.style.background = hexToRgba(c, 0.20);
                btn.style.color = c;
                btn.style.borderColor = hexToRgba(c, 0.55);
            } else {
                btn.style.background = '';
                btn.style.color = '';
                btn.style.borderColor = '';
            }
        });
    }

    function getGalStatObj(g, fk) {
        if (g.stats[fk + '_' + currentGroup]) {
            return g.stats[fk + '_' + currentGroup];
        }
        return g.stats[fk] || g.stats[FORMULA_KEYS[0]];
    }

    function getGalMed(g, fk) {
        const st = getGalStatObj(g, fk);
        if (!st) return null;
        if (currentRad === 'all_r') return st.allMedAbs !== undefined ? st.allMedAbs : null;
        if (currentRad === 'inner') return st.innerMedAbs !== undefined ? st.innerMedAbs : null;
        return st.outerMedAbs !== undefined ? st.outerMedAbs : null;
    }

    function getGalMean(g, fk) {
        const st = getGalStatObj(g, fk);
        if (!st) return null;
        if (currentRad === 'all_r') return st.allMeanAbs !== undefined ? st.allMeanAbs : null;
        if (currentRad === 'inner') return st.innerMeanAbs !== undefined ? st.innerMeanAbs : null;
        return st.outerMeanAbs !== undefined ? st.outerMeanAbs : null;
    }

    function getPtA(p, fk) {
        if (currentGroup !== 'all' && p['a_' + fk + '_' + currentGroup] !== undefined) {
            return p['a_' + fk + '_' + currentGroup];
        }
        return p['a_' + fk];
    }

    function getPtPct(p, fk) {
        if (currentGroup !== 'all' && p['pct_' + fk + '_' + currentGroup] !== undefined) {
            return p['pct_' + fk + '_' + currentGroup];
        }
        return p['pct_' + fk];
    }

    function getGroupData() {
        if (currentGroup === 'vflat') return DATA.filter(d => d.is_vflat);
        if (currentGroup === 'conc') return DATA.filter(d => d.is_conc);
        return DATA;
    }

    function inRadialRange(p, rmax) {
        if (currentRad === 'inner') return p.r <= 0.2 * rmax;
        if (currentRad === 'outer') return p.r >= 0.5 * rmax;
        return true;
    }

    function getRadLabel() {
        if (currentRad === 'inner') return 'Inner Disk (r \u2264 0.20 r_max)';
        if (currentRad === 'outer') return 'Outer Disk (r \u2265 0.50 r_max)';
        return 'All Radii (Full Galaxy)';
    }

    function computeGlobalSummary(fKey) {
        const subset = getGroupData();
        const radPt = [], outerPt = [], dexSq = [];
        for (const g of subset) {
            for (const p of g.pts) {
                if (p.a_obs <= 0) continue;
                if (p.r >= 0.5 * g.rmax) outerPt.push(Math.abs(getPtPct(p, fKey)));
                if (!inRadialRange(p, g.rmax)) continue;
                const absP = Math.abs(getPtPct(p, fKey));
                radPt.push(absP);
                const ap = Math.max(1e-16, getPtA(p, fKey));
                const d = Math.log10(ap / p.a_obs);
                dexSq.push(d * d);
            }
        }
        const validGals = subset.filter(g => getGalMed(g, fKey) !== null);
        const galMedMean = median(validGals.map(g => getGalMean(g, fKey)));
        const galMedMed = median(validGals.map(g => getGalMed(g, fKey)));
        let wins = 0;
        for (const g of validGals) {
            const meds = FORMULA_KEYS.map(k => getGalMed(g, k)).filter(v => v !== null);
            if (!meds.length) continue;
            const best = Math.min(...meds);
            if (getGalMed(g, fKey) === best) wins++;
        }
        return {
            ptMed: median(radPt),
            ptMean: mean(radPt),
            galMedMean,
            galMedMed,
            outerMed: median(outerPt),
            rmsDex: Math.sqrt(mean(dexSq)),
            wins,
            totalPts: radPt.length,
            totalGals: validGals.length
        };
    }

    function renderBadge(fk, text) {
        const info = FORMULA_INFO[fk];
        const style = info ? `background:${hexToRgba(info.color, 0.20)};color:${info.color};` : '';
        return `<span class="badge badge-${fk}" style="${style}">${text}</span>`;
    }

    function renderFormulaCards() {
        for (const fk of FORMULA_KEYS) {
            const info = FORMULA_INFO[fk];
            if (info && info.eqByGroup) {
                info.eq = info.eqByGroup[currentGroup] || info.eqByGroup.all;
            }
        }
        const subset = getGroupData();
        const summaries = {};
        for (const fk of FORMULA_KEYS) {
            summaries[fk] = computeGlobalSummary(fk);
        }
        const primarySummary = summaries[FORMULA_KEYS[0]];
        const totalPts = primarySummary.totalPts;
        const radLbl = getRadLabel();
        const grpTitle = currentGroup === 'vflat'
            ? `gal_vflat (${subset.length} gals, ${totalPts.toLocaleString()} pts)`
            : (currentGroup === 'conc'
                ? `gal_concentratedmass (${subset.length} gals, ${totalPts.toLocaleString()} pts)`
                : `${subset.length} SPARC galaxies (${totalPts.toLocaleString()} pts)`);

        const subEl = document.getElementById('sub-title');
        if (subEl) {
            subEl.innerHTML = cfg.subTitleHtml
                ? cfg.subTitleHtml({ radLbl, grpTitle, summaries, subset })
                : `${radLbl} &middot; ${grpTitle}`;
        }
        const grpShort = currentGroup === 'vflat' ? 'gal_vflat' : (currentGroup === 'conc' ? 'gal_concentratedmass' : 'All 175');
        document.getElementById('bench-table-title').textContent =
            `Complete ${subset.length}-Galaxy ${cfg.benchTitleTopic || 'Gravity Formula'} Benchmark Table (${radLbl} — ${grpShort})`;

        const order = [...FORMULA_KEYS].sort((a, b) => summaries[a].ptMed - summaries[b].ptMed);
        const html = order.map(fk => {
            const info = FORMULA_INFO[fk];
            const s = summaries[fk];
            const isWinner = fk === order[0];
            const isActiveCard = currentFormula === fk;
            return `
                <div class="formula-card ${isWinner ? 'winner' : ''} ${isActiveCard ? 'active-card' : ''}" data-fk="${fk}" title="Click to filter overview & chart by ${info.name} (and sort table)">
                    <div class="formula-title">
                        <span style="color:${info.color}">${info.name}</span>
                        ${isWinner ? renderBadge(fk, 'Lowest Error') : `<span style="font-size:11px;color:var(--text-tertiary)">Best in ${s.wins} gals</span>`}
                    </div>
                    <div class="formula-eq">${info.eq}</div>
                    <div class="formula-metrics">
                        <div class="fm-box">
                            <span class="fm-lbl">Pt Median |diff|</span>
                            <span class="fm-val" style="color:${info.color}">${s.ptMed.toFixed(2)}%</span>
                        </div>
                        <div class="fm-box">
                            <span class="fm-lbl">Pt Mean |diff|</span>
                            <span class="fm-val">${s.ptMean.toFixed(2)}%</span>
                        </div>
                        <div class="fm-box">
                            <span class="fm-lbl">Gal Med(med)</span>
                            <span class="fm-val">${s.galMedMed.toFixed(2)}%</span>
                        </div>
                        <div class="fm-box">
                            <span class="fm-lbl">${currentRad === 'inner' ? 'Log Scatter' : 'Outer (\u22650.5r)'}</span>
                            <span class="fm-val">${currentRad === 'inner' ? (s.rmsDex.toFixed(3) + ' dex') : (s.outerMed.toFixed(2) + '%')}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        const cardsEl = document.getElementById('formula-cards');
        cardsEl.innerHTML = html;
        cardsEl.querySelectorAll('.formula-card[data-fk]').forEach(card => {
            card.addEventListener('click', () => {
                const fk = card.getAttribute('data-fk');
                currentFormula = (currentFormula === fk) ? 'all' : fk;
                sortKey = fk + '_med';
                sortAsc = true;
                updateAll();
            });
        });
    }

    function getFilteredData() {
        return getGroupData().filter(d => {
            if (searchQuery && !d.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
        });
    }

    function getActiveFormulaKey() {
        return currentFormula === 'all' ? (cfg.defaultFormula || FORMULA_KEYS[0]) : currentFormula;
    }

    function drawOverviewChart() {
        const fk = getActiveFormulaKey();
        const info = FORMULA_INFO[fk];
        const filtered = getFilteredData()
            .filter(d => getGalMed(d, fk) !== null)
            .sort((a, b) => getGalMed(a, fk) - getGalMed(b, fk));
        const radLbl = getRadLabel();

        document.getElementById('overview-title').textContent =
            `Ranked Overview [${info.name}] (${filtered.length} Galaxies, ${radLbl}) — Sorted by Galaxy Median |diff|`;
        document.getElementById('overview-legend').innerHTML = `
            <span><i class="legend-dot" style="background:${info.color}"></i>${info.short} Median |diff| (${radLbl})</span>
            <span><i class="legend-dot" style="background:#ffffff"></i>Selected Galaxy (${selectedGalaxyName})</span>
        `;

        overviewBars = drawRankedOverviewCanvas({
            canvas: document.getElementById('overview-canvas'),
            height: 225,
            ml: 48,
            items: filtered,
            getVal: d => getGalMed(d, fk),
            maxVal: 100,
            ticks: [0, 20, 40, 60, 80, 100],
            refTick: 20,
            refColor: 'rgba(34, 197, 94, 0.35)',
            barColor: info.color,
            selectedColor: '#ffffff',
            selectedName: selectedGalaxyName,
            hoveredName: hoveredGalaxyName,
            hoverLabel: info.short + ' Med |diff|',
            footerText: `${filtered.length} Galaxies ranked from lowest to highest median |diff| on ${radLbl} (click any bar to inspect)`
        });
    }

    function toVal(a, r) {
        if (plotMode === 'vel') {
            return Math.sign(a) * Math.sqrt(r * Math.abs(a));
        }
        return a;
    }

    function fmtMedOrDash(val) {
        return val !== null && val !== undefined ? (val.toFixed(1) + '%') : '—';
    }

    function drawProfileInspector() {
        const subset = getGroupData();
        const gal = subset.find(d => d.name === selectedGalaxyName) || subset[0] || DATA[0];
        if (!gal) return;
        selectedGalaxyName = gal.name;

        const unitLbl = plotMode === 'vel' ? 'v (m/s)' : 'a (m/s\u00b2)';
        document.getElementById('inspector-title').innerHTML =
            `${galaxy3DLink(gal.name)} — Observed vs Predicted ${plotMode === 'vel' ? 'Rotation Curve v(r)' : 'Acceleration a(r)'}`;
        document.getElementById('pt-table-title').innerHTML =
            `${galaxy3DLink(gal.name)} — Point-by-Point Radial Comparison (${gal.n_inner ?? 0} inner \u22640.2r | ${gal.n_outer ?? 0} outer \u22650.5r | ${gal.n} pts)`;

        const activeKeys = currentFormula === 'all' ? PROFILE_DRAW_ORDER : [currentFormula];
        document.getElementById('inspector-legend').innerHTML =
            `<span><i class="legend-dot" style="background:#ffffff;border-radius:50%"></i>a_obs</span>` +
            activeKeys.map(fk => `<span><i class="legend-dot" style="background:${FORMULA_INFO[fk].color}"></i>${FORMULA_INFO[fk].short}</span>`).join('');

        document.getElementById('inspector-meta').innerHTML =
            `3D Voxel Model: ${galaxy3DLink(gal.name)} &nbsp;|&nbsp; ` +
            FORMULA_KEYS.map(fk => {
                const info = FORMULA_INFO[fk];
                return `${info.metaLabel || info.short}: <b style="color:${info.color}">${fmtMedOrDash(getGalMed(gal, fk))}</b>`;
            }).join(' &nbsp;|&nbsp; ');

        const canvas = document.getElementById('profile-canvas');
        const { ctx, W, H } = setupHiDPICanvas(canvas, 560, 300);

        const pts = gal.pts;
        const rmax = gal.rmax || 1;

        let ymax = plotMode === 'vel' ? 10 : 1e-13;
        pts.forEach(p => {
            const vo = toVal(p.a_obs, p.r);
            if (vo > ymax) ymax = vo;
            activeKeys.forEach(fk => {
                const vp = toVal(getPtA(p, fk), p.r);
                if (vp > ymax) ymax = vp;
            });
        });
        const yTop = ymax * 1.12;

        const innerRgb = cfg.innerShadeRgb || '168, 85, 247';
        const innerColorName = cfg.innerShadeName || 'purple';
        const innerStarHex = cfg.innerStarColor || '#a855f7';

        const { ml, mt, pw, ph, xpx, ypx } = drawDashboardProfileGrid(
            ctx, W, H, rmax, 0, yTop,
            `r (m)  [shaded ${innerColorName}: r \u2264 0.2 rmax (inner disk) | shaded teal: r \u2265 0.5 rmax]`,
            unitLbl
        );

        // Shade inner r <= 0.20 * rmax core
        const xR20 = xpx(0.2 * rmax);
        ctx.fillStyle = `rgba(${innerRgb}, 0.07)`;
        ctx.fillRect(ml, mt, xR20 - ml, ph);
        ctx.strokeStyle = `rgba(${innerRgb}, 0.45)`;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xR20, mt); ctx.lineTo(xR20, mt + ph); ctx.stroke();
        ctx.setLineDash([]);

        // Highlight outer flat rotation zone r >= 0.5 * rmax
        const xFlat = xpx(0.5 * rmax);
        ctx.fillStyle = 'rgba(20, 184, 166, 0.04)';
        ctx.fillRect(xFlat, mt, ml + pw - xFlat, ph);
        ctx.strokeStyle = 'rgba(20, 184, 166, 0.22)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xFlat, mt); ctx.lineTo(xFlat, mt + ph); ctx.stroke();
        ctx.setLineDash([]);

        // Plot each formula curve
        activeKeys.forEach(fk => {
            const color = FORMULA_INFO[fk].color;
            const isPrimary = PRIMARY_HIGHLIGHT_KEYS.has(fk);
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = isPrimary ? 2.5 : 1.7;
            ctx.beginPath();
            pts.forEach((p, idx) => {
                const cx = xpx(p.r), cy = ypx(toVal(getPtA(p, fk), p.r));
                if (idx === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
            });
            ctx.stroke();
            ctx.restore();

            pts.forEach(p => {
                const cx = xpx(p.r), cy = ypx(toVal(getPtA(p, fk), p.r));
                ctx.beginPath();
                ctx.arc(cx, cy, isPrimary ? 2.8 : 2.1, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
            });
        });

        // Plot observed acceleration datum['a'] as crisp white dots on top
        pts.forEach(p => {
            const cx = xpx(p.r), cy = ypx(toVal(p.a_obs, p.r));
            const inRange = inRadialRange(p, rmax);
            ctx.beginPath();
            ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
            ctx.fillStyle = inRange ? '#ffffff' : 'rgba(255,255,255,0.45)';
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = '#000000';
            ctx.stroke();
        });

        document.getElementById('pt-table-head').innerHTML = `
            <th>k</th>
            <th>r (m)</th>
            <th>a_obs</th>
            ${FORMULA_KEYS.map(fk => `<th style="color:${FORMULA_INFO[fk].color}">${FORMULA_INFO[fk].ptThHtml || FORMULA_INFO[fk].short}</th>`).join('')}
        `;

        const fmtPct = pct => {
            const cls = Math.abs(pct) < 15 ? 'good' : (Math.abs(pct) < 30 ? 'warn' : 'bad');
            return `<td class="${cls}">${(pct >= 0 ? '+' : '') + pct.toFixed(1)}%</td>`;
        };

        const tbody = document.querySelector('#pt-table tbody');
        tbody.innerHTML = pts.map((p, idx) => {
            const isInner = p.r <= 0.2 * rmax;
            const isOuter = p.r >= 0.5 * rmax;
            const inRange = inRadialRange(p, rmax);
            const zoneTitle = isInner
                ? 'Inner disk r <= 0.20 rmax'
                : (isOuter ? 'Outer disk r >= 0.50 rmax' : 'Mid disk 0.20 rmax < r < 0.50 rmax');
            return `
            <tr style="${inRange ? '' : 'opacity:0.42;'}" title="${zoneTitle}">
                <td>${idx}${isInner ? `<span style="color:${innerStarHex}">*</span>` : ''}</td>
                <td>${p.r.toExponential(2)}</td>
                <td><b>${p.a_obs.toExponential(2)}</b></td>
                ${FORMULA_KEYS.map(fk => fmtPct(getPtPct(p, fk))).join('')}
            </tr>
            `;
        }).join('');
    }

    function getBestFormulaKey(d) {
        let bestKey = null;
        let bestVal = Infinity;
        for (const fk of WIN_FORMULA_KEYS) {
            const val = getGalMed(d, fk);
            if (val !== null && val < bestVal) {
                bestVal = val;
                bestKey = fk;
            }
        }
        return bestKey;
    }

    function getSortVal(d, key) {
        if (key === 'n') return d.n;
        if (key.endsWith('_med')) {
            const fk = key.slice(0, -4);
            const val = getGalMed(d, fk);
            return val === null ? (sortAsc ? Infinity : -Infinity) : val;
        }
        if (key === 'best') {
            const bk = getBestFormulaKey(d);
            return bk ? bk.toUpperCase() : 'ZZZ';
        }
        return d[key];
    }

    function renderTable() {
        const filtered = [...getFilteredData()].sort((a, b) => {
            const va = getSortVal(a, sortKey);
            const vb = getSortVal(b, sortKey);
            if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            return sortAsc ? (va - vb) : (vb - va);
        });

        const cls = v => v < 18 ? 'good' : (v < 30 ? 'warn' : 'bad');
        const tbody = document.querySelector('#gal-table tbody');
        tbody.innerHTML = filtered.map(d => {
            const sel = d.name === selectedGalaxyName ? 'selected' : '';
            const bestKey = getBestFormulaKey(d);
            const ptsCount = currentRad === 'inner'
                ? `${d.n_inner ?? 0}/${d.n}`
                : (currentRad === 'outer' ? `${d.n_outer ?? 0}/${d.n}` : `${d.n}`);

            const formulaCells = FORMULA_KEYS.map(fk => {
                const m = getGalMed(d, fk);
                if (m === null) return `<td>—</td>`;
                if (fk === 'f1' || fk === 'f3') return `<td>${m.toFixed(1)}%</td>`;
                const isBold = PRIMARY_HIGHLIGHT_KEYS.has(fk) || fk !== 'f4';
                const colorStyle = (fk !== 'f2' && fk !== 'f4') ? ` style="color:${FORMULA_INFO[fk].color}"` : '';
                return `<td class="${cls(m)}"${colorStyle}>${isBold ? `<b>${m.toFixed(1)}%</b>` : `${m.toFixed(1)}%`}</td>`;
            }).join('');

            const bestCell = bestKey
                ? renderBadge(bestKey, FORMULA_INFO[bestKey].bestLabel || FORMULA_INFO[bestKey].short)
                : '—';

            return `<tr class="gal-row ${sel}" data-name="${d.name}">
                <td>${galaxy3DLink(d.name)}</td>
                <td>${d.is_vflat ? 'true' : 'false'}</td>
                <td>${d.is_conc ? 'true' : 'false'}</td>
                <td>${d.has_blg ? 'true' : 'false'}</td>
                <td>${ptsCount}</td>
                <td>${d.rmax.toExponential(2)}</td>
                ${formulaCells}
                <td>${bestCell}</td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('tr.gal-row').forEach(row => {
            row.addEventListener('click', () => {
                selectedGalaxyName = row.getAttribute('data-name');
                updateAll();
            });
        });
        updateSortHeaders('#gal-table', sortKey, sortAsc);
    }

    function updateAll() {
        const subset = getGroupData();
        if (subset.length && !subset.some(d => d.name === selectedGalaxyName)) {
            selectedGalaxyName = subset[0].name;
        }
        document.querySelectorAll('.chip').forEach(c => {
            c.classList.toggle('active', c.getAttribute('data-gal') === selectedGalaxyName);
        });
        applyActiveFormulaButtonStyles();
        renderFormulaCards();
        drawOverviewChart();
        drawProfileInspector();
        renderTable();
        syncUrlAndNavLinks(selectedGalaxyName);
    }

    document.querySelectorAll('#test-group .btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#test-group .btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentGroup = btn.getAttribute('data-group');
            updateAll();
        });
    });

    document.querySelectorAll('#radial-group .btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#radial-group .btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRad = btn.getAttribute('data-rad');
            updateAll();
        });
    });

    document.querySelectorAll('#formula-group .btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFormula = btn.getAttribute('data-f');
            updateAll();
        });
    });

    document.querySelectorAll('#plot-mode-group .btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#plot-mode-group .btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            plotMode = btn.getAttribute('data-pm');
            drawProfileInspector();
        });
    });

    bindDashboardInteractions({
        onSearch: (q) => { searchQuery = q; updateAll(); },
        onChipSelect: (name) => {
            selectedGalaxyName = name;
            if (!getGroupData().some(d => d.name === name)) {
                currentGroup = 'all';
                document.querySelectorAll('#test-group .btn').forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-group') === 'all');
                });
            }
            updateAll();
        },
        onSort: (k) => {
            if (sortKey === k) sortAsc = !sortAsc;
            else { sortKey = k; sortAsc = true; }
            renderTable();
        },
        getOverviewBars: () => overviewBars,
        getHoveredName: () => hoveredGalaxyName,
        setHoveredName: (name) => { hoveredGalaxyName = name; },
        onBarSelect: (name) => { selectedGalaxyName = name; updateAll(); },
        drawOverview: drawOverviewChart,
        drawProfile: drawProfileInspector
    });

    updateAll();
}
