// RGB component palette (Red + Green + Blue = White)
var color_dsk = '#ef4444'; // Red   (Disk)
var color_blg = '#22c55e'; // Green (Bulge)
var color_gas = '#3b82f6'; // Blue  (Gas)
var color_all = '#ffffff'; // White (All = Disk + Bulge + Gas)

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
        var btns = document.querySelectorAll('.hud-mode-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('active', btns[i].getAttribute('data-mode') === hud_mode);
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

    var rho_common_peak = galaxyobj.rho_common_peak || 0;
    if (!rho_common_peak) {
        rho_common_peak = Math.max(rho_dsk_peak, rho_blg_peak, rho_gas_peak);
        var colSums = {};
        var lists = [galaxyobj.voxels_dsk_viz, galaxyobj.voxels_blg_viz, galaxyobj.voxels_gas_viz];
        for (var li = 0; li < lists.length; li++) {
            var arr = lists[li];
            if (!arr) continue;
            for (var vi = 0; vi < arr.length; vi++) {
                var vox = arr[vi];
                var key = vox.x + ',' + vox.y;
                var s = (colSums[key] || 0) + vox.rho;
                colSums[key] = s;
                if (s > rho_common_peak) rho_common_peak = s;
            }
        }
        galaxyobj.rho_common_peak = rho_common_peak;
    }

    function recolorVoxels(voxels, mesh, denom) {
        if (!voxels) return;
        for (var i = 0; i < voxels.length; i++) {
            var vox = voxels[i];
            // var dither = (((vox.x * 73856093) ^ (vox.y * 19349663)) & 0xffff) / 65536 - 0.5;
            var val = denom > 0 ? Math.min(1, vox.rho / denom) : 0;
            var q = Math.min(255, Math.max(0, Math.round(val * 255)));
            vox.color = q > 0 ? floattohexgray(q / 255) : '#000000';
        }
        if (typeof recolor_instanced_mesh === 'function' && mesh) {
            recolor_instanced_mesh(mesh, voxels);
        }
    }

    var isCommon = density_scale_mode === 'common';
    recolorVoxels(galaxyobj.voxels_dsk_viz, galaxyobj.mesh_dsk, isCommon ? rho_common_peak : rho_dsk_peak);
    recolorVoxels(galaxyobj.voxels_blg_viz, galaxyobj.mesh_blg, isCommon ? rho_common_peak : rho_blg_peak);
    recolorVoxels(galaxyobj.voxels_gas_viz, galaxyobj.mesh_gas, isCommon ? rho_common_peak : rho_gas_peak);

    if (typeof document !== 'undefined') {
        var infoEl = document.getElementById('rho-scale-info');
        if (infoEl) {
            if (isCommon) {
                infoEl.textContent = '\u03c1_col_peak (common): ' + rho_common_peak.toExponential(2) + ' kg/m\u00b3' +
                    '  [dsk: ' + rho_dsk_peak.toExponential(2) +
                    ', blg: ' + rho_blg_peak.toExponential(2) +
                    ', gas: ' + rho_gas_peak.toExponential(2) + ']';
            } else {
                infoEl.textContent = '\u03c1_col_peak (separate): dsk=' + rho_dsk_peak.toExponential(2) +
                    ', blg=' + rho_blg_peak.toExponential(2) +
                    ', gas=' + rho_gas_peak.toExponential(2) + ' kg/m\u00b3';
            }
        }
    }
}

// ─── Surface-Brightness HUD ──────────────────────────────────────────────────
// Draws a linear-y chart of observed surface brightness points and the model fit.
// galaxyobj : the galaxy object (has_blg, rmax, sb_dsk_max, sb_blg_max, radiusdata)
// mode      : 'all' | 'dsk' | 'blg' | 'gas' (or legacy 'sb_dsk' | 'sb_blg')
function draw_sb_hud(galaxyobj, mode) {
    var canvas = document.getElementById('sb-hud');
    if (!canvas || !galaxyobj) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    var H = canvas.height;
    var m = normalize_hud_mode(mode);

    var ml = 58, mr = 14, mt = 18, mb = 36;
    var pw = W - ml - mr;
    var ph = H - mt - mb;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,10,18,0.88)';
    ctx.fillRect(0, 0, W, H);

    var radiusdata = galaxyobj.radiusdata;
    var rmax = galaxyobj.rmax;
    var rplot = rmax;
    var hasBlg = Boolean(galaxyobj.has_blg && typeof interpolate_sb_blg === 'function');

    var showAll = (m === 'all');
    var showDsk = (m === 'dsk');
    var showBlg = (m === 'blg');
    var showGas = (m === 'gas');

    var sbmax = 0;
    if (showAll) {
        if (typeof interpolate_sb_dsk === 'function') {
            sbmax = Math.max(
                sbmax,
                (interpolate_sb_dsk(0, galaxyobj) || 0) +
                (hasBlg ? (interpolate_sb_blg(0, galaxyobj) || 0) : 0) +
                (interpolate_sb_gas(0, galaxyobj) || 0)
            );
        }
        for (var k = 0; k < radiusdata.length; k++) {
            var sb_tot = radiusdata[k]['sb_tot'] !== undefined
                ? radiusdata[k]['sb_tot']
                : ((radiusdata[k]['sb_dsk'] || 0) +
                    (hasBlg ? (radiusdata[k]['sb_blg'] || 0) : 0) +
                    (radiusdata[k]['sb_gas'] || 0));
            if (sb_tot > sbmax) sbmax = sb_tot;
        }
    } else if (showDsk && typeof interpolate_sb_dsk === 'function') {
        sbmax = Math.max(sbmax, galaxyobj.sb_dsk_max || 0, interpolate_sb_dsk(0, galaxyobj) || 0);
    } else if (showBlg && hasBlg) {
        sbmax = Math.max(sbmax, galaxyobj.sb_blg_max || 0, interpolate_sb_blg(0, galaxyobj) || 0);
    } else if (showGas && typeof interpolate_sb_gas === 'function') {
        sbmax = Math.max(sbmax, galaxyobj.sb_gas_peak || 0, galaxyobj.sb_gas_max || 0, interpolate_sb_gas(0, galaxyobj) || 0);
    }
    if (sbmax <= 0) sbmax = 1e-6;
    var ymax = sbmax * 1.05;

    function xpx(r) { return ml + (r / rplot) * pw; }
    function ypx(sb) { return mt + ph - (Math.max(0, sb) / ymax) * ph; }

    // Y-axis grid lines & ticks (linear, 5 ticks)
    var nyticks = 5;
    for (var ti = 0; ti <= nyticks; ti++) {
        var sbv = (ti / nyticks) * sbmax;
        var yg = ypx(sbv);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ml, yg); ctx.lineTo(ml + pw, yg); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(sbv.toExponential(1), ml - 4, yg + 3);
    }

    // X-axis ticks: 5 marks across rplot
    for (var frac = 0; frac <= 1; frac += 0.25) {
        var xg = xpx(frac * rplot);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xg, mt); ctx.lineTo(xg, mt + ph); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText((frac * rplot).toExponential(1), xg, mt + ph + 14);
    }

    // Axes border
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ml, mt, pw, ph);

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('r  (m)', ml + pw / 2, H - 4);
    ctx.save();
    ctx.translate(10, mt + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('SB  (W/m\u00b2)', 0, 0);
    ctx.restore();

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

    function drawSbComponent(key, interpFn, lineColor, dotColor) {
        for (var k = 0; k < radiusdata.length; k++) {
            var sb_obs = radiusdata[k][key];
            if (sb_obs < 0 || isNaN(sb_obs) || sb_obs === undefined) continue;
            var rx = xpx(radiusdata[k]['r']);
            var ry = ypx(sb_obs);
            ctx.beginPath();
            ctx.arc(rx, ry, 3.2, 0, 2 * Math.PI);
            ctx.fillStyle = dotColor;
            ctx.fill();
        }

        drawSbCurveSegment(0, r_first, interpFn, lineColor, true);
        drawSbCurveSegment(r_first, r_last, interpFn, lineColor, false);
    }

    if (showAll && typeof interpolate_sb_dsk === 'function') {
        for (var k = 0; k < radiusdata.length; k++) {
            var sb_tot_obs = radiusdata[k]['sb_tot'] !== undefined
                ? radiusdata[k]['sb_tot']
                : ((radiusdata[k]['sb_dsk'] || 0) +
                    (hasBlg ? (radiusdata[k]['sb_blg'] || 0) : 0) +
                    (radiusdata[k]['sb_gas'] || 0));
            if (sb_tot_obs < 0 || isNaN(sb_tot_obs)) continue;
            var rx = xpx(radiusdata[k]['r']);
            var ry = ypx(sb_tot_obs);
            ctx.beginPath();
            ctx.arc(rx, ry, 3.2, 0, 2 * Math.PI);
            ctx.fillStyle = color_all;
            ctx.fill();
        }
        drawSbCurveSegment(0, r_last, function (r2, g) {
            return (interpolate_sb_dsk(r2, g) || 0) +
                (hasBlg ? (interpolate_sb_blg(r2, g) || 0) : 0) +
                (interpolate_sb_gas(r2, g) || 0);
        }, color_all, true);
    } else if (showDsk && typeof interpolate_sb_dsk === 'function') {
        drawSbComponent('sb_dsk', interpolate_sb_dsk, color_dsk, '#ffffff');
    } else if (showBlg) {
        if (hasBlg) {
            drawSbComponent('sb_blg', interpolate_sb_blg, color_blg, '#ffffff');
        } else {
            var y0 = ypx(0);
            ctx.save();
            ctx.strokeStyle = color_blg;
            ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(ml, y0); ctx.lineTo(ml + pw, y0); ctx.stroke();
            ctx.restore();
        }
    } else if (showGas && typeof interpolate_sb_gas === 'function') {
        drawSbComponent('sb_gas', interpolate_sb_gas, color_gas, '#ffffff');
    }

    // Legend (top-right)
    var legendItems = [];
    if (showAll) {
        legendItems.push({ type: 'dot', color: color_all, label: 'observed sb_tot' });
        legendItems.push({ type: 'line', color: color_all, dashed: true, label: 'sim sb_tot' });
    } else if (showDsk) {
        legendItems.push({ type: 'dot', color: '#ffffff', label: 'observed sb_dsk' });
        legendItems.push({ type: 'line', color: color_dsk, dashed: false, label: 'interpolation' });
        legendItems.push({ type: 'line', color: color_dsk, dashed: true, label: 'extrapolation' });
    } else if (showBlg) {
        legendItems.push({ type: 'dot', color: '#ffffff', label: hasBlg ? 'observed sb_blg' : 'sb_blg (no bulge)' });
        legendItems.push({ type: 'line', color: color_blg, dashed: false, label: 'interpolation' });
        legendItems.push({ type: 'line', color: color_blg, dashed: true, label: 'extrapolation' });
    } else if (showGas) {
        legendItems.push({ type: 'dot', color: '#ffffff', label: 'reconstructed sb_gas' });
        legendItems.push({ type: 'line', color: color_gas, dashed: false, label: 'interpolation' });
        legendItems.push({ type: 'line', color: color_gas, dashed: true, label: 'extrapolation' });
    }

    var boxW = 152;
    var boxH = 8 + legendItems.length * 14;
    var bx = ml + pw - boxW - 8;
    var by = mt + 8;
    ctx.fillStyle = 'rgba(10,10,18,0.82)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, boxW, boxH);

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
            ctx.lineWidth = 1.8;
            ctx.setLineDash(item.dashed ? [4, 4] : []);
            ctx.beginPath(); ctx.moveTo(bx + 6, iy); ctx.lineTo(bx + 22, iy); ctx.stroke();
            ctx.restore();
        }
        ctx.fillStyle = item.color;
        ctx.font = '9px monospace';
        ctx.fillText(item.label, tx, iy + 3);
    }
}

// ─── Acceleration HUD ─────────────────────────────────────────────────────────
// Draws a chart comparing claimed SPARC accelerations and 3D Voxel Simulation
// accelerations according to the selected mode ('all' | 'dsk' | 'blg' | 'gas').
function draw_accel_hud(galaxyobj, mode) {
    var canvas = document.getElementById('accel-hud');
    if (!canvas || !galaxyobj) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    var H = canvas.height;
    var m = normalize_hud_mode(mode);

    var ml = 58, mr = 14, mt = 18, mb = 36;
    var pw = W - ml - mr;
    var ph = H - mt - mb;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,10,18,0.88)';
    ctx.fillRect(0, 0, W, H);

    var radiusdata = galaxyobj.radiusdata;
    var rmax = galaxyobj.rmax;
    var rplot = rmax;
    var hasBlg = Boolean(galaxyobj.has_blg && radiusdata.length > 0 && radiusdata[0]['a_classic_blg_sim'] !== undefined);

    // Collect min/max acceleration across active series
    var a_max = 1e-13;
    var a_min = 0;
    for (var k = 0; k < radiusdata.length; k++) {
        var d = radiusdata[k];
        var ac_dsk = d['a_classic_dsk'] || 0;
        var as_dsk = d['a_classic_dsk_sim'] || 0;
        var ac_blg = hasBlg ? (d['a_classic_blg'] || 0) : 0;
        var as_blg = hasBlg ? (d['a_classic_blg_sim'] || 0) : 0;
        var ac_gas = d['a_classic_gas'] || 0;
        var as_gas = d['a_classic_gas_sim'] || 0;

        if (m === 'all') {
            var ac_tot = d['a_classic_tot'] !== undefined ? d['a_classic_tot'] : (ac_dsk + ac_blg + ac_gas);
            var as_tot = d['a_classic_tot_sim'] !== undefined ? d['a_classic_tot_sim'] : (as_dsk + as_blg + as_gas);
            if (ac_tot > a_max) a_max = ac_tot;
            if (as_tot > a_max) a_max = as_tot;
            if (ac_tot < a_min) a_min = ac_tot;
            if (as_tot < a_min) a_min = as_tot;
        } else if (m === 'dsk') {
            if (ac_dsk > a_max) a_max = ac_dsk;
            if (as_dsk > a_max) a_max = as_dsk;
            if (ac_dsk < a_min) a_min = ac_dsk;
            if (as_dsk < a_min) a_min = as_dsk;
        } else if (m === 'blg') {
            if (ac_blg > a_max) a_max = ac_blg;
            if (as_blg > a_max) a_max = as_blg;
            if (ac_blg < a_min) a_min = ac_blg;
            if (as_blg < a_min) a_min = as_blg;
        } else if (m === 'gas') {
            if (ac_gas > a_max) a_max = ac_gas;
            if (as_gas > a_max) a_max = as_gas;
            if (ac_gas < a_min) a_min = ac_gas;
            if (as_gas < a_min) a_min = as_gas;
        }
    }
    var yTop = a_max * 1.1;
    var yBot = a_min < 0 ? a_min * 1.15 : 0;
    var ySpan = (yTop - yBot) || 1e-12;

    function xpx(r) { return ml + (r / rplot) * pw; }
    function ypx(a) { return mt + ph - ((a - yBot) / ySpan) * ph; }

    // Y-axis grid lines & ticks (5 ticks)
    var nyticks = 5;
    for (var ti = 0; ti <= nyticks; ti++) {
        var av = yBot + (ti / nyticks) * ySpan;
        var yg = ypx(av);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ml, yg); ctx.lineTo(ml + pw, yg); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(av.toExponential(1), ml - 4, yg + 3);
    }

    // X-axis ticks (5 marks)
    for (var frac = 0; frac <= 1; frac += 0.25) {
        var xg = xpx(frac * rplot);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xg, mt); ctx.lineTo(xg, mt + ph); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText((frac * rplot).toExponential(1), xg, mt + ph + 14);
    }

    // Axes border
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ml, mt, pw, ph);

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('r  (m)', ml + pw / 2, H - 4);
    ctx.save();
    ctx.translate(10, mt + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('a  (m/s\u00b2)', 0, 0);
    ctx.restore();

    function drawAccelValues(claimedArr, simArr, simColor, dotColor, dashed) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ml, mt, pw, ph);
        ctx.clip();
        ctx.beginPath();
        ctx.strokeStyle = simColor;
        ctx.lineWidth = 1.8;
        ctx.setLineDash(dashed ? [5, 4] : []);
        for (var k = 0; k < radiusdata.length; k++) {
            var a_sim = simArr[k];
            if (a_sim === undefined || isNaN(a_sim)) continue;
            var cx = xpx(radiusdata[k]['r']), cy = ypx(a_sim);
            if (k === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        if (!dashed) {
            for (var k = 0; k < radiusdata.length; k++) {
                var a_sim = simArr[k];
                if (a_sim === undefined || isNaN(a_sim)) continue;
                var cx = xpx(radiusdata[k]['r']), cy = ypx(a_sim);
                ctx.beginPath();
                ctx.arc(cx, cy, 2.3, 0, 2 * Math.PI);
                ctx.fillStyle = simColor;
                ctx.fill();
            }
        }
        ctx.restore();

        if (claimedArr && dotColor) {
            for (var k = 0; k < radiusdata.length; k++) {
                var a_cla = claimedArr[k];
                if (a_cla === undefined || isNaN(a_cla)) continue;
                var rx = xpx(radiusdata[k]['r']), ry = ypx(a_cla);
                ctx.beginPath();
                ctx.arc(rx, ry, 3.3, 0, 2 * Math.PI);
                ctx.fillStyle = dotColor;
                ctx.fill();
            }
        }
    }

    var a_classic_dsk = radiusdata.map(function (d) { return d['a_classic_dsk'] || 0; });
    var a_classic_dsk_sim = radiusdata.map(function (d) { return d['a_classic_dsk_sim'] || 0; });
    var a_classic_blg = radiusdata.map(function (d) { return hasBlg ? (d['a_classic_blg'] || 0) : 0; });
    var a_classic_blg_sim = radiusdata.map(function (d) { return hasBlg ? (d['a_classic_blg_sim'] || 0) : 0; });
    var a_classic_gas = radiusdata.map(function (d) { return d['a_classic_gas'] || 0; });
    var a_classic_gas_sim = radiusdata.map(function (d) { return d['a_classic_gas_sim'] || 0; });

    var legendItems = [];

    if (m === 'all') {
        var a_classic_tot = radiusdata.map(function (d, i) {
            return d['a_classic_tot'] !== undefined ? d['a_classic_tot'] : (a_classic_dsk[i] + a_classic_blg[i] + a_classic_gas[i]);
        });
        var a_classic_tot_sim = radiusdata.map(function (d, i) {
            return d['a_classic_tot_sim'] !== undefined ? d['a_classic_tot_sim'] : (a_classic_dsk_sim[i] + a_classic_blg_sim[i] + a_classic_gas_sim[i]);
        });
        drawAccelValues(a_classic_tot, a_classic_tot_sim, color_all, color_all, true);
        legendItems.push({ type: 'dot', color: color_all, label: 'a_classic_tot_claimed' });
        legendItems.push({ type: 'line', color: color_all, dashed: true, label: 'a_classic_tot_sim' });
    } else if (m === 'dsk') {
        drawAccelValues(a_classic_dsk, a_classic_dsk_sim, color_dsk, '#ffffff', false);
        legendItems.push({ type: 'dot', color: '#ffffff', label: 'a_classic_dsk_claimed' });
        legendItems.push({ type: 'line', color: color_dsk, dashed: false, label: 'a_classic_dsk_sim' });
    } else if (m === 'blg') {
        drawAccelValues(a_classic_blg, a_classic_blg_sim, color_blg, '#ffffff', false);
        legendItems.push({ type: 'dot', color: '#ffffff', label: 'a_classic_blg_claimed' });
        legendItems.push({ type: 'line', color: color_blg, dashed: false, label: 'a_classic_blg_sim' });
    } else if (m === 'gas') {
        drawAccelValues(a_classic_gas, a_classic_gas_sim, color_gas, '#ffffff', false);
        legendItems.push({ type: 'dot', color: '#ffffff', label: 'a_classic_gas_claimed' });
        legendItems.push({ type: 'line', color: color_gas, dashed: false, label: 'a_classic_gas_sim' });
    }

    // Legend (top-right)
    var boxW = 166;
    var boxH = 8 + legendItems.length * 14;
    var bx = ml + pw - boxW - 8;
    var by = mt + 8;
    ctx.fillStyle = 'rgba(10,10,18,0.85)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, boxW, boxH);

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
            ctx.lineWidth = 2;
            ctx.setLineDash(item.dashed ? [4, 3] : []);
            ctx.beginPath(); ctx.moveTo(bx + 6, iy); ctx.lineTo(bx + 22, iy); ctx.stroke();
            if (!item.dashed) {
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
