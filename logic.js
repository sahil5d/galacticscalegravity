// ═══════════════════════════════════════════════════════════════════════════
// SHARED GALAXY SELECTION, MONOTONIC CUBIC PIECEWISE INTERPOLATION & 3D VOXEL GRAVITY SOLVER
// ═══════════════════════════════════════════════════════════════════════════

var gridR = 100;
var galaxieslist = Object.keys(galaxiesobj);

var thegal = galaxieslist[Math.floor(Math.random() * galaxieslist.length)];
if (typeof window !== 'undefined' && window.location && window.location.search) {
    var urlParams = new URLSearchParams(window.location.search);
    var urlGal = urlParams.get('gal') || urlParams.get('galaxy') || urlParams.get('name') || decodeURIComponent(window.location.search.slice(1));
    if (urlGal && galaxiesobj[urlGal]) thegal = urlGal;
}

// Monotonic cubic piecewise slopes for galaxyobj.radiusdata, cached per key ('sb_dsk' or 'sb_blg').
function get_monotonic_cubic_piecewise_slopes(galaxyobj, key = 'sb_dsk') {
    if (!galaxyobj.monotonic_cubic_piecewise_slopes) galaxyobj.monotonic_cubic_piecewise_slopes = {};
    if (galaxyobj.monotonic_cubic_piecewise_slopes[key]) return galaxyobj.monotonic_cubic_piecewise_slopes[key];

    var rd = galaxyobj.radiusdata, n = rd.length;
    if (n === 1) return (galaxyobj.monotonic_cubic_piecewise_slopes[key] = [0]);

    var delta = new Array(n - 1), m = new Array(n);
    for (var k = 0; k < n - 1; k++) {
        delta[k] = (rd[k + 1][key] - rd[k][key]) / (rd[k + 1]['r'] - rd[k]['r']);
    }
    m[0] = delta[0];
    m[n - 1] = delta[n - 2];
    for (var k = 1; k < n - 1; k++) m[k] = (delta[k - 1] + delta[k]) / 2;

    for (var k = 0; k < n - 1; k++) {
        if (Math.abs(delta[k]) < 1e-300) { m[k] = 0; m[k + 1] = 0; continue; }
        var alpha = m[k] / delta[k], beta = m[k + 1] / delta[k];
        var tau2 = alpha * alpha + beta * beta;
        if (tau2 > 9) {
            var tau = 3 / Math.sqrt(tau2);
            m[k] = tau * alpha * delta[k];
            m[k + 1] = tau * beta * delta[k];
        }
    }
    return (galaxyobj.monotonic_cubic_piecewise_slopes[key] = m);
}

// Evaluate monotonic cubic piecewise polynomial on normalized interval t in [0, 1], clamped >= 0.
function eval_monotonic_cubic_piecewise(v0, v1, h, mk, mk1, t) {
    var t2 = t * t, t3 = t2 * t;
    return Math.max(0, (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * mk + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * mk1);
}

// Blend monotonic cubic piecewise base value with lower (wk < 0) or upper (wk > 0) quartic transition curve.
function blend_quartic_segment(base, v0, v1, t, wk) {
    if (!wk) return base;
    var t2 = t * t, s = 1 - t, s2 = s * s;
    if (wk < 0) {
        var b_low = v0 > 1.05 * v1 ? v1 + (v0 - v1) * s2 * s2 : v0 * s2 * s2 + v1 * t2 * t2;
        return (1 + wk) * base - wk * b_low;
    }
    return (1 - wk) * base + wk * (v0 - (v0 - v1) * t2 * t2);
}

// Compute inward radial gravitational acceleration at test position (x_eval, 0, 0)
// by summing over the 2 octants (y >= 0, z >= 0, all x) and multiplying accel_x by 4
// to account for all 8 octants (±y, ±z symmetry). Shared by disk, bulge, and gas simulations.
function compute_voxel_accel_x(voxels_sim, x_eval, cut) {
    var accel_x = 0;

    for (var i = 0; i < voxels_sim.length; i++) {
        var vox = voxels_sim[i];
        var dx = vox.p.x - x_eval;
        var dy = vox.p.y;
        var dz = vox.p.z;
        if (
            Math.abs(dx) < cut &&
            Math.abs(dy) < cut &&
            Math.abs(dz) < cut
        ) {
            continue;
        }

        var dist2 = dx * dx + dy * dy + dz * dz;
        var dist = Math.sqrt(dist2);
        var mag = G * vox.mass / dist2;
        // dir.copy(vox.p).sub(testp).normalize();
        // accel.add(dir.multiplyScalar(mag));
        var dir_x = dx / dist;
        accel_x += mag * dir_x;
    }

    return -4 * accel_x;
}

// Evaluate radial gravitational acceleration at radius r_k (in meters) by linearly interpolating
// between the two bracketing AMR sub-voxel centers x0 = i0 * h_test and x1 = i1 * h_test.
function eval_bracketed_radial_accel(voxels_sim, r_k, h_test) {
    var u_rk = r_k / h_test;
    var i0 = Math.floor(u_rk), i1 = i0 + 1;
    var frac = u_rk - i0;
    var cut = 1.5 * h_test;

    var a0 = i0 > 0 ? compute_voxel_accel_x(voxels_sim, i0 * h_test, cut) : 0;
    var a1 = compute_voxel_accel_x(voxels_sim, i1 * h_test, cut);
    return (1 - frac) * a0 + frac * a1;
}

// Log comparison table of simulated vs SPARC claimed accelerations.
function log_accel_diff_table(galaxyobj, claimed_key, sim_key) {
    var radiusdata = galaxyobj.radiusdata;
    var table = [];

    for (var k = 0; k < radiusdata.length; k++) {
        var datum = radiusdata[k], Rk = datum['r'];
        var a_claimed = datum[claimed_key], a_sim = datum[sim_key];
        var pctDiff = a_claimed !== 0
            ? (((a_sim - a_claimed) / Math.abs(a_claimed)) * 100).toFixed(1) + '%'
            : '-';

        var row = { 'r (m)': Rk.toExponential(2) };
        row[claimed_key + '_claimed'] = a_claimed.toExponential(2);
        row[sim_key] = a_sim.toExponential(2);
        row['diff_sim'] = pctDiff;
        table.push(row);
    }

    console.table(table);
}

// Populate total classic baryonic acceleration (a_classic_tot, a_classic_tot_sim) and total
// equivalent surface brightness (sb_tot) on galaxyobj.radiusdata, and log comparison table.
function calc_diff_tot(galaxyobj) {
    if (!galaxyobj && typeof galaxiesobj !== 'undefined' && typeof thegal !== 'undefined') {
        galaxyobj = galaxiesobj[thegal];
    }
    if (!galaxyobj) return;

    var radiusdata = galaxyobj.radiusdata;
    var hasBlg = Boolean(galaxyobj.has_blg);

    for (var k = 0; k < radiusdata.length; k++) {
        var d = radiusdata[k];
        var ac_dsk = d['a_classic_dsk'] || 0;
        var as_dsk = d['a_classic_dsk_sim'] || 0;
        var ac_blg = hasBlg ? (d['a_classic_blg'] || 0) : 0;
        var as_blg = hasBlg ? (d['a_classic_blg_sim'] || 0) : 0;
        var ac_gas = d['a_classic_gas'] || 0;
        var as_gas = d['a_classic_gas_sim'] || 0;

        d['a_classic_tot'] = ac_dsk + ac_blg + ac_gas;
        d['a_classic_tot_sim'] = as_dsk + as_blg + as_gas;
        d['sb_tot'] = (d['sb_dsk'] || 0) + (hasBlg ? (d['sb_blg'] || 0) : 0) + (d['sb_gas'] || 0);
    }

    log_accel_diff_table(galaxyobj, 'a_classic_tot', 'a_classic_tot_sim');
}
