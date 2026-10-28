// RGB component palette (Red + Green + Blue = White)
var color_dsk = '#ef4444'; // Red   (Disk)
var color_blg = '#22c55e'; // Green (Bulge)
var color_gas = '#3b82f6'; // Blue  (Gas)
var color_all = '#ffffff'; // White (All = Disk + Bulge + Gas)

var HUD_COMP_CFG = {
    dsk: { color: color_dsk, sbKey: 'sb_dsk', sbMaxKey: 'sb_dsk_max', sbLabel: 'observed sb_dsk', acKey: 'a_classic_dsk', asKey: 'a_classic_dsk_sim' },
    blg: { color: color_blg, sbKey: 'sb_blg', sbMaxKey: 'sb_blg_max', sbLabel: 'observed sb_blg', acKey: 'a_classic_blg', asKey: 'a_classic_blg_sim' },
    gas: { color: color_gas, sbKey: 'sb_gas', sbMaxKey: 'sb_gas_peak', sbLabel: 'reconstructed sb_gas', acKey: 'a_classic_gas', asKey: 'a_classic_gas_sim' }
};

// Active HUD & 3D component mode: 'all' | 'dsk' | 'blg' | 'gas'
var hud_mode = 'all';

// Active 3D mass density linear color scale mode: 'common' | 'separate'
var density_scale_mode = 'common';

function normalize_hud_mode(mode) {
    if (!mode) return hud_mode || 'all';
    if (mode === 'sb_dsk' || mode === 'a_classic_dsk') return 'dsk';
    if (mode === 'sb_blg' || mode === 'a_classic_blg') return 'blg';
    if (mode === 'sb_gas' || mode === 'a_classic_gas') return 'gas';
    return mode;
}

function set_hud_mode(mode, galaxyobj) {
    hud_mode = normalize_hud_mode(mode);
    if (!galaxyobj && typeof galaxiesobj !== 'undefined' && typeof thegal !== 'undefined') {
        galaxyobj = galaxiesobj[thegal];
    }

    if (typeof document !== 'undefined') {
        var hasBlg = Boolean(galaxyobj && galaxyobj.has_blg);
        var btns = document.querySelectorAll('.hud-mode-btn');
        for (var i = 0; i < btns.length; i++) {
            var btnMode = btns[i].getAttribute('data-mode');
            btns[i].classList.toggle('active', btnMode === hud_mode);
            if (btnMode === 'blg') {
                btns[i].textContent = hasBlg ? 'Bulge' : 'Bulge (none)';
                btns[i].classList.toggle('no-bulge', !hasBlg);
            }
        }
    }

    if (galaxyobj) {
        if (galaxyobj.mesh_dsk) galaxyobj.mesh_dsk.visible = (hud_mode === 'all' || hud_mode === 'dsk');
        if (galaxyobj.mesh_blg) galaxyobj.mesh_blg.visible = (hud_mode === 'all' || hud_mode === 'blg');
        if (galaxyobj.mesh_gas) galaxyobj.mesh_gas.visible = (hud_mode === 'all' || hud_mode === 'gas');
        draw_sb_hud(galaxyobj, hud_mode);
        draw_accel_hud(galaxyobj, hud_mode);
    }
}

// Toggle 3D voxel mass density linear color scale between:
// - 'common': single linear scale using the peak combined z-column mass density across (dsk + blg + gas)
// - 'separate': each component linearly scaled so its own peak z-column mass density equals #ffffff
function set_density_scale(mode, galaxyobj) {
    density_scale_mode = (mode === 'separate') ? 'separate' : 'common';
    if (!galaxyobj && typeof galaxiesobj !== 'undefined' && typeof thegal !== 'undefined') {
        galaxyobj = galaxiesobj[thegal];
    }

    if (typeof document !== 'undefined') {
        var btns = document.querySelectorAll('.density-scale-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('active', btns[i].getAttribute('data-scale') === density_scale_mode);
        }
    }

    if (!galaxyobj) return;

    var rho_dsk_peak = galaxyobj.rho_dsk_peak || 0;
    var rho_blg_peak = galaxyobj.has_blg ? (galaxyobj.rho_blg_peak || 0) : 0;
    var rho_gas_peak = galaxyobj.rho_gas_peak || 0;

    var rho_common_peak = Math.max(galaxyobj.rho_common_peak || 0, rho_dsk_peak, rho_blg_peak, rho_gas_peak);
    galaxyobj.rho_common_peak = rho_common_peak;

    var isCommon = density_scale_mode === 'common';
    if (typeof recolor_instanced_mesh === 'function') {
        recolor_instanced_mesh(galaxyobj.mesh_dsk, galaxyobj.voxels_dsk_viz, isCommon ? rho_common_peak : rho_dsk_peak);
        recolor_instanced_mesh(galaxyobj.mesh_blg, galaxyobj.voxels_blg_viz, isCommon ? rho_common_peak : rho_blg_peak);
        recolor_instanced_mesh(galaxyobj.mesh_gas, galaxyobj.voxels_gas_viz, isCommon ? rho_common_peak : rho_gas_peak);
    }
}

function setup_hud_canvas(canvas, cssW, cssH) {
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    var targetW = Math.round(cssW * dpr);
    var targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, W: cssW, H: cssH };
}

function draw_hud_axes(canvas, rplot, yBot, ySpan, yTickSpan, xLabel, yLabel, yLabelX) {
    var setup = setup_hud_canvas(canvas, 340, 220);
    var ctx = setup.ctx, W = setup.W, H = setup.H;
    var ml = 66, mr = 19, mt = 18, mb = 40;
    var pw = W - ml - mr, ph = H - mt - mb;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,10,18,0.88)';
    ctx.fillRect(0, 0, W, H);

    function xpx(r) { return ml + (r / rplot) * pw; }
    function ypx(v) { return mt + ph - ((v - yBot) / ySpan) * ph; }

    var nyticks = 5;
    for (var ti = 0; ti <= nyticks; ti++) {
        var yv = yBot + (ti / nyticks) * yTickSpan;
        var yg = ypx(yv);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ml, yg); ctx.lineTo(ml + pw, yg); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(yv.toExponential(1), ml - 5, yg + 3);
    }

    for (var frac = 0; frac <= 1; frac += 0.25) {
        var xg = xpx(frac * rplot);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xg, mt); ctx.lineTo(xg, mt + ph); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText((frac * rplot).toExponential(1), xg, mt + ph + 13);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ml + 0.5, mt + 0.5, pw - 1, ph - 1);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(xLabel, ml + pw / 2, H - 9);
    ctx.save();
    ctx.translate(yLabelX, mt + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    return { ctx: ctx, ml: ml, mt: mt, pw: pw, ph: ph, xpx: xpx, ypx: ypx };
}

function draw_hud_legend(ctx, ml, mt, pw, boxW, legendItems, showLineDot) {
    var boxH = 8 + legendItems.length * 14;
    var bx = ml + pw - boxW - 8;
    var by = mt + 8;
    ctx.fillStyle = 'rgba(10,10,18,0.85)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, boxW, boxH);

    ctx.textAlign = 'left';
    var tx = bx + 28;
    for (var li = 0; li < legendItems.length; li++) {
        var item = legendItems[li];
        var iy = by + 11 + li * 14;
        if (item.type === 'dot') {
            ctx.beginPath(); ctx.arc(bx + 14, iy, 3, 0, 2 * Math.PI);
            ctx.fillStyle = item.color; ctx.fill();
        } else {
            ctx.save();
            ctx.strokeStyle = item.color;
            ctx.lineWidth = showLineDot ? 2 : 1.8;
            ctx.setLineDash(item.dashed ? (showLineDot ? [4, 3] : [4, 4]) : []);
            ctx.beginPath(); ctx.moveTo(bx + 6, iy); ctx.lineTo(bx + 22, iy); ctx.stroke();
            if (showLineDot && !item.dashed) {
                ctx.beginPath(); ctx.arc(bx + 14, iy, 2, 0, 2 * Math.PI);
                ctx.fillStyle = item.color; ctx.fill();
            }
            ctx.restore();
        }
        ctx.fillStyle = item.color;
        ctx.font = '9px monospace';
        ctx.fillText(item.label, tx, iy + 3);
    }
}

// ─── Surface-Brightness HUD ──────────────────────────────────────────────────
// Draws a linear-y chart of observed surface brightness points and the model fit.
// galaxyobj : the galaxy object (has_blg, rmax, sb_dsk_max, sb_blg_max, radiusdata)
// mode      : 'all' | 'dsk' | 'blg' | 'gas' (or legacy 'sb_dsk' | 'sb_blg')
function draw_sb_hud(galaxyobj, mode) {
    if (typeof document === 'undefined') return;
    var canvas = document.getElementById('sb-hud');
    if (!canvas || !galaxyobj) return;
    var m = normalize_hud_mode(mode);

    var radiusdata = galaxyobj.radiusdata;
    var rmax = galaxyobj.rmax;
    var rplot = rmax;
    var hasBlg = Boolean(galaxyobj.has_blg && typeof interpolate_sb_blg === 'function');
    var comp = HUD_COMP_CFG[m];
    var interpFn = m === 'dsk' ? (typeof interpolate_sb_dsk === 'function' ? interpolate_sb_dsk : null)
        : (m === 'blg' ? (hasBlg ? interpolate_sb_blg : null)
        : (m === 'gas' && typeof interpolate_sb_gas === 'function' ? interpolate_sb_gas : null));

    function evalTotSb(r2, g) {
        return (interpolate_sb_dsk(r2, g) || 0) +
            (hasBlg ? (interpolate_sb_blg(r2, g) || 0) : 0) +
            (interpolate_sb_gas(r2, g) || 0);
    }
    function getObsTotSb(d) {
        return d['sb_tot'] !== undefined
            ? d['sb_tot']
            : ((d['sb_dsk'] || 0) + (hasBlg ? (d['sb_blg'] || 0) : 0) + (d['sb_gas'] || 0));
    }

    var sbmax = 0;
    if (m === 'all') {
        if (typeof interpolate_sb_dsk === 'function') sbmax = Math.max(sbmax, evalTotSb(0, galaxyobj));
        for (var k = 0; k < radiusdata.length; k++) {
            var sb_tot = getObsTotSb(radiusdata[k]);
            if (sb_tot > sbmax) sbmax = sb_tot;
        }
    } else if (comp && interpFn) {
        sbmax = Math.max(sbmax, galaxyobj[comp.sbMaxKey] || 0, galaxyobj[comp.sbKey + '_max'] || 0, interpFn(0, galaxyobj) || 0);
    }
    if (sbmax <= 0) sbmax = 1e-6;
    var ymax = sbmax * 1.05;

    var frame = draw_hud_axes(canvas, rplot, 0, ymax, sbmax, 'r  (m)', 'SB (W/m\u00b2)', 17);
    var ctx = frame.ctx, ml = frame.ml, mt = frame.mt, pw = frame.pw, ph = frame.ph;
    var xpx = frame.xpx, ypx = frame.ypx;

    var r_first = radiusdata[0]['r'];
    var r_last = rmax;
    var steps = 300;

    function drawSbCurveSegment(rA, rB, evalFn, lineColor, dashed) {
        if (rB <= rA) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(ml, mt, pw, ph);
        ctx.clip();

        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.6;
        if (dashed) ctx.setLineDash([4, 4]); else ctx.setLineDash([]);
        var first = true;
        var segSteps = Math.max(30, Math.round(steps * ((rB - rA) / rplot)));
        for (var si = 0; si <= segSteps; si++) {
            var r2 = rA + (si / segSteps) * (rB - rA);
            var sb2 = evalFn(r2, galaxyobj);
            if (sb2 < 0) { first = true; continue; }
            var cx = xpx(r2), cy = ypx(sb2);
            if (first) { ctx.moveTo(cx, cy); first = false; } else { ctx.lineTo(cx, cy); }
        }
        ctx.stroke();
        ctx.restore();
    }

    function drawSbDots(getValFn, dotColor) {
        for (var k = 0; k < radiusdata.length; k++) {
            var sb_obs = getValFn(radiusdata[k]);
            if (sb_obs < 0 || isNaN(sb_obs) || sb_obs === undefined) continue;
            ctx.beginPath();
            ctx.arc(xpx(radiusdata[k]['r']), ypx(sb_obs), 3.2, 0, 2 * Math.PI);
            ctx.fillStyle = dotColor;
            ctx.fill();
        }
    }

    var legendItems = [];
    if (m === 'all' && typeof interpolate_sb_dsk === 'function') {
        drawSbDots(getObsTotSb, color_all);
        drawSbCurveSegment(0, r_last, evalTotSb, color_all, true);
        legendItems.push({ type: 'dot', color: color_all, label: 'observed sb_tot' });
        legendItems.push({ type: 'line', color: color_all, dashed: true, label: 'sim sb_tot' });
    } else if (comp) {
        if (interpFn) {
            drawSbDots(function (d) { return d[comp.sbKey]; }, '#ffffff');
            drawSbCurveSegment(0, r_first, interpFn, comp.color, true);
            drawSbCurveSegment(r_first, r_last, interpFn, comp.color, false);
        } else if (m === 'blg') {
            var y0 = ypx(0);
            ctx.save();
            ctx.strokeStyle = color_blg;
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(ml, y0); ctx.lineTo(ml + pw, y0); ctx.stroke();
            ctx.restore();
        }
        legendItems.push({ type: 'dot', color: '#ffffff', label: (m === 'blg' && !hasBlg) ? 'sb_blg (no bulge)' : comp.sbLabel });
        legendItems.push({ type: 'line', color: comp.color, dashed: false, label: 'interpolation' });
        legendItems.push({ type: 'line', color: comp.color, dashed: true, label: 'extrapolation' });
    }

    draw_hud_legend(ctx, ml, mt, pw, 152, legendItems, false);
}

// ─── Acceleration HUD ─────────────────────────────────────────────────────────
// Draws a chart comparing claimed SPARC accelerations and 3D Voxel Simulation
// accelerations according to the selected mode ('all' | 'dsk' | 'blg' | 'gas').
function draw_accel_hud(galaxyobj, mode) {
    if (typeof document === 'undefined') return;
    var canvas = document.getElementById('accel-hud');
    if (!canvas || !galaxyobj) return;
    var m = normalize_hud_mode(mode);

    var radiusdata = galaxyobj.radiusdata;
    var rplot = galaxyobj.rmax;
    var hasBlg = Boolean(galaxyobj.has_blg && radiusdata.length > 0 && radiusdata[0]['a_classic_blg_sim'] !== undefined);
    var comp = HUD_COMP_CFG[m];

    var n = radiusdata.length;
    var claimedArr = new Array(n);
    var simArr = new Array(n);
    var a_max = 1e-13, a_min = 0;

    for (var k = 0; k < n; k++) {
        var d = radiusdata[k];
        var ac, asim;
        if (m === 'all') {
            ac = d['a_classic_tot'] !== undefined ? d['a_classic_tot']
                : ((d['a_classic_dsk'] || 0) + (hasBlg ? (d['a_classic_blg'] || 0) : 0) + (d['a_classic_gas'] || 0));
            asim = d['a_classic_tot_sim'] !== undefined ? d['a_classic_tot_sim']
                : ((d['a_classic_dsk_sim'] || 0) + (hasBlg ? (d['a_classic_blg_sim'] || 0) : 0) + (d['a_classic_gas_sim'] || 0));
        } else {
            var active = (m !== 'blg' || hasBlg) && comp;
            ac = active ? (d[comp.acKey] || 0) : 0;
            asim = active ? (d[comp.asKey] || 0) : 0;
        }
        claimedArr[k] = ac;
        simArr[k] = asim;
        if (ac > a_max) a_max = ac;
        if (asim > a_max) a_max = asim;
        if (ac < a_min) a_min = ac;
        if (asim < a_min) a_min = asim;
    }

    var yTop = a_max * 1.1;
    var yBot = a_min < 0 ? a_min * 1.15 : 0;
    var ySpan = (yTop - yBot) || 1e-12;

    var frame = draw_hud_axes(canvas, rplot, yBot, ySpan, ySpan, 'r (m)', 'a (m/s\u00b2)', 15);
    var ctx = frame.ctx, ml = frame.ml, mt = frame.mt, pw = frame.pw, ph = frame.ph;
    var xpx = frame.xpx, ypx = frame.ypx;

    var isAll = (m === 'all');
    var simColor = isAll ? color_all : comp.color;
    var dotColor = isAll ? color_all : '#ffffff';
    var dashed = isAll;

    ctx.save();
    ctx.beginPath();
    ctx.rect(ml, mt, pw, ph);
    ctx.clip();
    ctx.beginPath();
    ctx.strokeStyle = simColor;
    ctx.lineWidth = 1.8;
    ctx.setLineDash(dashed ? [5, 4] : []);
    for (var k = 0; k < n; k++) {
        var cx = xpx(radiusdata[k]['r']), cy = ypx(simArr[k]);
        if (k === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    if (!dashed) {
        for (var k = 0; k < n; k++) {
            ctx.beginPath();
            ctx.arc(xpx(radiusdata[k]['r']), ypx(simArr[k]), 2.3, 0, 2 * Math.PI);
            ctx.fillStyle = simColor;
            ctx.fill();
        }
    }
    ctx.restore();

    for (var k = 0; k < n; k++) {
        ctx.beginPath();
        ctx.arc(xpx(radiusdata[k]['r']), ypx(claimedArr[k]), 3.3, 0, 2 * Math.PI);
        ctx.fillStyle = dotColor;
        ctx.fill();
    }

    var legendItems = [
        { type: 'dot', color: dotColor, label: (isAll ? 'a_classic_tot' : comp.acKey) + '_claimed' },
        { type: 'line', color: simColor, dashed: dashed, label: isAll ? 'a_classic_tot_sim' : comp.asKey }
    ];
    draw_hud_legend(ctx, ml, mt, pw, 166, legendItems, true);
}
