// ═══════════════════════════════════════════════════════════════════════════
// 1. BULGE RADIAL SCALES (r_blg_max & r_blg_efold)
// ═══════════════════════════════════════════════════════════════════════════

// Outer radius r_blg_max (in meters) where sb_blg drops to 0.
// In all 29 SPARC bulge galaxies, sb_blg reaches exact 0 before rmax.
function get_r_blg_max(galaxyobj) {
    if (galaxyobj.r_blg_max !== undefined) return galaxyobj.r_blg_max;
    var rd = galaxyobj.radiusdata;
    var lastPos = -1;
    for (var k = 0; k < rd.length; k++) {
        if (rd[k]['sb_blg'] > 0) lastPos = k;
    }
    if (lastPos < 0) return (galaxyobj.r_blg_max = rd[0]['r']);
    var r_blg_max = lastPos + 1 < rd.length ? rd[lastPos + 1]['r'] : rd[lastPos]['r'];
    return (galaxyobj.r_blg_max = r_blg_max);
}

// Estimate bulge radial e-folding scale length r_blg_efold (in meters) directly from sb_blg.
// Unlike get_r_dsk_efold (which skips the inner 25% core/bar of the disk), a bulge is
// centrally concentrated and compact, so we fit across all positive sb_blg points.
function get_r_blg_efold(galaxyobj) {
    if (galaxyobj.r_blg_efold !== undefined) return galaxyobj.r_blg_efold;

    var rd = galaxyobj.radiusdata;
    var pos = rd.filter(function (d) { return d['sb_blg'] > 0; });
    var n = pos.length;
    var r_efold = get_r_blg_max(galaxyobj) / 3.5;

    if (n >= 2) {
        var sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
        for (var i = 0; i < n; i++) {
            var x = pos[i]['r'], y = Math.log(pos[i]['sb_blg']);
            sumX += x; sumY += y; sumXX += x * x; sumXY += x * y;
        }
        var denom = n * sumXX - sumX * sumX;
        var b = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
        if (b < 0) r_efold = -1 / b;
    } else if (n === 1) {
        r_efold = pos[0]['r'] * 0.5;
    }

    r_efold = Math.max(5.0e17, r_efold);
    return (galaxyobj.r_blg_efold = r_efold);
}


// ═══════════════════════════════════════════════════════════════════════════
// 2. BULGE SURFACE BRIGHTNESS INTERPOLATION & 3D ABEL DEPROJECTION
// ═══════════════════════════════════════════════════════════════════════════

// Interpolate projected bulge surface brightness sb_blg(R) at projected radius R (in meters).
function interpolate_sb_blg(r, galaxyobj) {
    var rd = galaxyobj.radiusdata;
    for (var k = 0; k < rd.length; k++) {
        if (r === rd[k]['r']) return rd[k]['sb_blg'];
    }

    var r0 = rd[0]['r'], y0 = rd[0]['sb_blg'];
    var params = BLG_CORE_PARAMS[galaxyobj.name];
    var A0 = (params && params[0] !== undefined) ? params[0] : 1.0;

    if (r < r0) {
        var u = (r0 - r) / r0, s = 1 - u;
        return y0 * s * s + A0 * y0 * u * (2 - u);
    }
    if (r >= get_r_blg_max(galaxyobj)) return 0;

    var m = get_monotonic_cubic_piecewise_slopes(galaxyobj, 'sb_blg');
    for (var k = 0; k < rd.length - 1; k++) {
        var rA = rd[k]['r'], rB = rd[k + 1]['r'];
        if (r > rA && r <= rB) {
            var v0 = rd[k]['sb_blg'], v1 = rd[k + 1]['sb_blg'];
            if (v0 <= 0 && v1 <= 0) return 0;
            var h = rB - rA, t = (r - rA) / h;

            if (k >= 1 && v1 > 0 && v0 > 20 * v1 && h > 1.5 * (rA - rd[k - 1]['r'])) {
                return v0 * Math.pow(v1 / v0, Math.pow(t, 1.2));
            }

            var base = eval_monotonic_cubic_piecewise(v0, v1, h, m[k], m[k + 1], t);
            var wk = (params && k + 1 < params.length) ? params[k + 1] : 0;
            return blend_quartic_segment(base, v0, v1, t, wk);
        }
    }
    return 0;
}

// Evaluate -d(sb_blg)/dR on outer interval [r_k, r_{k+1}] for Abel spherical deprojection.
function eval_neg_dsb_dR_outer_blg(R, k, galaxyobj, params) {
    var rd = galaxyobj.radiusdata;
    var rA = rd[k]['r'], rB = rd[k + 1]['r'], h = rB - rA;
    var v0 = rd[k]['sb_blg'], v1 = rd[k + 1]['sb_blg'];
    if (v0 <= 0 && v1 <= 0) return 0;
    var t = (R - rA) / h, t2 = t * t, s = 1 - t;

    if (k >= 1 && v1 > 0 && v0 > 20 * v1 && h > 1.5 * (rA - rd[k - 1]['r'])) {
        var tp = Math.pow(t, 1.2);
        var dtp_dt = 1.2 * Math.pow(Math.max(1e-12, t), 0.2);
        return (Math.log(v0 / v1) / h) * dtp_dt * v0 * Math.pow(v1 / v0, tp);
    }

    var m = get_monotonic_cubic_piecewise_slopes(galaxyobj, 'sb_blg');
    var dbase_dt = (6 * t2 - 6 * t) * v0 + (3 * t2 - 4 * t + 1) * h * m[k] + (-6 * t2 + 6 * t) * v1 + (3 * t2 - 2 * t) * h * m[k + 1];
    var wk = (params && k + 1 < params.length) ? params[k + 1] : 0;
    var dsb_dt = dbase_dt;
    if (wk < 0) {
        var dblow_dt = -4 * (v0 - v1) * s * s * s;
        dsb_dt = (1 + wk) * dbase_dt - wk * dblow_dt;
    } else if (wk > 0) {
        var dbhigh_dt = -4 * (v0 - v1) * t * t * t;
        dsb_dt = (1 - wk) * dbase_dt + wk * dbhigh_dt;
    }
    return -dsb_dt / h;
}

// 4-point Gauss-Legendre nodes and weights on [0, 1] for exact interval-by-interval Abel integration.
var GL4_X = [0.0694318442, 0.3300094782, 0.6699905218, 0.9305681558];
var GL4_W = [0.1739274226, 0.3260725774, 0.3260725774, 0.1739274226];

// Precompute 1D radial lookup table of 3D spherical mass density rho_outer(r3d) (in kg/m^3)
// from exact Abel inversion: rho(r) = -(M/L)/pi * int_r^{r_blg_max} (dI/dR) / sqrt(R^2 - r^2) dR
// using substitution z = sqrt(R^2 - r^2) (dR / sqrt(R^2 - r^2) = dz / R) to remove the r = R singularity.
function build_rho_outer_table(galaxyobj, params) {
    var r_blg_max = get_r_blg_max(galaxyobj);
    var rd = galaxyobj.radiusdata;
    var conv = (Msun / Lsun) * coeff_blg;
    var N_tab = 240;
    var rho_tab = new Float64Array(N_tab + 1);

    for (var m = 0; m < N_tab; m++) {
        var u = m / N_tab;
        var r = r_blg_max * u * u;
        var sum = 0;
        for (var k = 0; k < rd.length - 1; k++) {
            if (rd[k]['r'] >= r_blg_max) break;
            var rA = Math.max(r, rd[k]['r']);
            var rB = rd[k + 1]['r'];
            if (rB <= rA) continue;
            var zA = Math.sqrt(rA * rA - r * r);
            var zB = Math.sqrt(rB * rB - r * r);
            var dz = zB - zA;
            for (var q = 0; q < 4; q++) {
                var z = zA + GL4_X[q] * dz;
                var R = Math.hypot(r, z);
                if (R > 0) sum += GL4_W[q] * dz * eval_neg_dsb_dR_outer_blg(R, k, galaxyobj, params) / R;
            }
        }
        rho_tab[m] = (conv / Math.PI) * sum;
    }
    rho_tab[N_tab] = 0;
    return { r_blg_max: r_blg_max, N_tab: N_tab, rho_tab: rho_tab };
}

function eval_rho_outer(r3d, tab) {
    if (r3d >= tab.r_blg_max) return 0;
    var u = Math.sqrt(r3d / tab.r_blg_max) * tab.N_tab;
    var idx = Math.min(tab.N_tab - 1, Math.floor(u));
    var f = u - idx;
    return (1 - f) * tab.rho_tab[idx] + f * tab.rho_tab[idx + 1];
}

// Evaluate total 3D spherical bulge mass density rho_blg(r3d) (in kg/m^3) at 3D radius r3d (in meters),
// combining the outer Abel-deprojected density (r >= r0) and the inner core Abel density (r < r_core).
function eval_rho_blg(r3d, galaxyobj, voxellen) {
    var r_blg_max = get_r_blg_max(galaxyobj);
    if (r3d >= r_blg_max) return 0;

    var params = BLG_CORE_PARAMS[galaxyobj.name] || [1];
    var tab = galaxyobj.rho_outer_tab || (galaxyobj.rho_outer_tab = build_rho_outer_table(galaxyobj, params));
    var rho = eval_rho_outer(r3d, tab);

    var r0 = galaxyobj.radiusdata[0]['r'], y0 = galaxyobj.radiusdata[0]['sb_blg'];
    var A0 = params[0] !== undefined ? params[0] : 1.0;
    var r_core = Math.max(r0, voxellen || 0);
    if (A0 > 1 && y0 > 0 && r3d < r_core) {
        var conv = (Msun / Lsun) * coeff_blg;
        var M_core = conv * 0.5 * Math.PI * r0 * r0 * (A0 - 1) * y0;
        rho += (4 * M_core * Math.sqrt(r_core * r_core - r3d * r3d)) / (Math.PI * Math.PI * (r_core ** 4));
    }
    return rho;
}


// ═══════════════════════════════════════════════════════════════════════════
// 3. 3D SPHERICAL BULGE VOXEL BUILDERS & GRAVITY EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

// 3D spherical AMR subdivision factor S (odd integer: 1, 3, 5, 7, 15) on the bulge grid.
function get_amr_blg(r_grid) {
    if (r_grid < 0.5) return 15;
    if (r_grid < 1.5) return 7;
    if (r_grid < 3.5) return 5;
    if (r_grid < 6.0) return 3;
    return 1;
}

// Build 1x1x1 3D spherical bulge voxels in a single pass over the 1/16th diagonal wedge (0 <= j <= i, k >= 0),
// expanding all 16 symmetries into density-sorted Int16Array/Float32Array buffers.
function build_viz_voxels_blg(galaxyobj, voxellen) {
    var r_blg_max = get_r_blg_max(galaxyobj);
    var gridR_viz = Math.ceil(r_blg_max / voxellen);

    var buf = create_viz_voxel_buffer(512);
    var col_rhos = new Float64Array(gridR_viz + 1);
    var rho_blg_peak = 0;

    for (var i = 0; i <= gridR_viz; i++) {
        for (var j = 0; j <= i; j++) {
            if (Math.hypot(i, j) * voxellen >= r_blg_max) continue;
            var col_rho_sum = 0;
            var k_count = 0;
            for (var k = 0; k <= gridR_viz; k++) {
                var r3d = Math.hypot(i, j, k) * voxellen;
                if (r3d >= r_blg_max) break;
                var rho_blg = eval_rho_blg(r3d, galaxyobj, voxellen);
                col_rhos[k] = rho_blg;
                k_count = k + 1;
                if (rho_blg > 0) {
                    col_rho_sum += (k === 0 ? 1 : 2) * rho_blg;
                }
            }
            if (col_rho_sum > 0) {
                if (col_rho_sum > rho_blg_peak) rho_blg_peak = col_rho_sum;
                add_octant_col_rho(galaxyobj, i, j, col_rho_sum);
                for (var k = 0; k < k_count; k++) {
                    if (col_rhos[k] > 0) {
                        push_wedge_viz_voxel(buf, i, j, k, col_rhos[k], rho_blg_peak);
                    }
                }
            }
        }
    }
    galaxyobj.rho_blg_peak = rho_blg_peak;
    return (galaxyobj.voxels_blg_viz = finalize_viz_voxel_buffer(buf, rho_blg_peak));
}

// Build 1-octant (x >= 0, y >= 0, z >= 0) 3D spherical AMR sub-voxels in a flat Float64Array buffer for bulge gravity simulation.
function build_sim_voxels_blg(galaxyobj) {
    var params = BLG_CORE_PARAMS[galaxyobj.name] || [1];
    var r_blg_max = get_r_blg_max(galaxyobj);
    var gridR_blg = 18;
    var voxellen_blg = r_blg_max / gridR_blg;
    var tab = galaxyobj.rho_outer_tab || (galaxyobj.rho_outer_tab = build_rho_outer_table(galaxyobj, params));
    var sim_buf = create_sim_voxel_buffer(16384);

    for (var i = 0; i <= gridR_blg; i++) {
        for (var j = 0; j <= gridR_blg; j++) {
            for (var k = 0; k <= gridR_blg; k++) {
                var r_grid = Math.hypot(i, j, k);
                if (r_grid > gridR_blg + 0.5) continue;
                var S = get_amr_blg(r_grid);
                var sub_len = voxellen_blg / S;
                var sub_vol = sub_len * sub_len * sub_len;
                var si_start = (i === 0) ? Math.floor(S / 2) : 0;
                var sj_start = (j === 0) ? Math.floor(S / 2) : 0;
                var sk_start = (k === 0) ? Math.floor(S / 2) : 0;

                for (var si = si_start; si < S; si++) {
                    var ox = (si + 0.5) / S - 0.5;
                    var x = (i === 0 && Math.abs(ox) < 1e-9) ? 0 : (i + ox) * voxellen_blg;
                    for (var sj = sj_start; sj < S; sj++) {
                        var oy = (sj + 0.5) / S - 0.5;
                        var is_y0 = (j === 0 && Math.abs(oy) < 1e-9);
                        var y = is_y0 ? 0 : (j + oy) * voxellen_blg;
                        var sym_y = is_y0 ? 0.5 : 1.0;
                        for (var sk = sk_start; sk < S; sk++) {
                            var oz = (sk + 0.5) / S - 0.5;
                            var is_z0 = (k === 0 && Math.abs(oz) < 1e-9);
                            var z = is_z0 ? 0 : (k + oz) * voxellen_blg;
                            var sym_z = is_z0 ? 0.5 : 1.0;
                            var rho = eval_rho_outer(Math.hypot(x, y, z), tab);
                            if (rho <= 0) continue;
                            push_sim_voxel(sim_buf, x, y, z, rho * sub_vol * sym_y * sym_z);
                        }
                    }
                }
            }
        }
    }

    // Inner core (r < r0) 3D spherical ball of 1-octant (x > 0, y > 0, z > 0) voxels carrying the exact Abel mass
    // M_core = (Msun/Lsun * coeff_blg) * (pi/2) * r0^2 * (A0 - 1) * y0.
    var r0 = galaxyobj.radiusdata[0]['r'], y0 = galaxyobj.radiusdata[0]['sb_blg'];
    var A0 = params[0] !== undefined ? params[0] : 1.0;
    if (A0 > 1 && y0 > 0) {
        var conv = (Msun / Lsun) * coeff_blg;
        var M_core_exact = conv * 0.5 * Math.PI * r0 * r0 * (A0 - 1) * y0;
        var r_core = 0.75 * r0;
        var N_in = 8, h_in = r_core / N_in;
        var core_start = sim_buf.length * 4;
        var weight_sum = 0;
        for (var ix = 0; ix < N_in; ix++) {
            var x = (ix + 0.5) * h_in;
            for (var iy = 0; iy < N_in; iy++) {
                var y = (iy + 0.5) * h_in;
                for (var iz = 0; iz < N_in; iz++) {
                    var z = (iz + 0.5) * h_in;
                    var r3d = Math.hypot(x, y, z);
                    if (r3d >= r_core) continue;
                    var w = Math.sqrt(r_core * r_core - r3d * r3d);
                    push_sim_voxel(sim_buf, x, y, z, w);
                    weight_sum += 8 * w;
                }
            }
        }
        var scale = M_core_exact / weight_sum;
        var core_end = sim_buf.length * 4;
        var data = sim_buf.data;
        for (var mIdx = core_start + 3; mIdx < core_end; mIdx += 4) {
            data[mIdx] *= scale;
        }
    }

    galaxyobj.voxellen_blg = voxellen_blg;
    return (galaxyobj.voxels_blg_sim = finalize_sim_voxel_buffer(sim_buf));
}

// Evaluate 3D vector-projected gravity sums { 'GM/r^2', 'GM/r', 'GM', 'GMr' } for the bulge at Rk (in meters)
// by bracketing Rk between adjacent positive x-axis bulge AMR sub-voxel centers (with cut = 0.5 * h).
function eval_bracketed_grav_moments_blg(voxels_sim, Rk, voxellen_blg) {
    var i_cell = Math.round(Rk / voxellen_blg);
    var pts = [];
    for (var ic = Math.max(0, i_cell - 1); ic <= i_cell + 1; ic++) {
        var S = get_amr_blg(ic);
        var h = voxellen_blg / S;
        var s_start = ic === 0 ? Math.floor(S / 2) : 0;
        for (var s = s_start; s < S; s++) {
            var x = (ic + (s + 0.5) / S - 0.5) * voxellen_blg;
            pts.push({ x: x, cut: 0.5 * h });
        }
    }
    var m = 0;
    while (m + 1 < pts.length - 1 && pts[m + 1].x <= Rk) m++;
    var p0 = pts[m], p1 = pts[m + 1];
    var frac = (p1.x > p0.x) ? (Rk - p0.x) / (p1.x - p0.x) : 0;
    // var a0 = p0.x > 0 ? compute_voxel_accel_x(voxels_sim, p0.x, p0.cut) : 0;
    // var a1 = compute_voxel_accel_x(voxels_sim, p1.x, p1.cut);
    // return (1 - frac) * a0 + frac * a1;
    var m0 = p0.x > 0 ? compute_voxel_grav_moments_x(voxels_sim, p0.x, p0.cut) : ZERO_GRAV_MOMENTS;
    var m1 = compute_voxel_grav_moments_x(voxels_sim, p1.x, p1.cut);
    return lerp_grav_moments(m0, m1, frac);
}

// Compare 3D voxel bulge acceleration (a_classic_blg_sim) against SPARC claimed bulge acceleration (a_classic_blg).
function calc_diff_blg(galaxyobj, voxellen_blg) {
    var radiusdata = galaxyobj.radiusdata;
    var voxels_sim = galaxyobj.voxels_blg_sim;
    if (!voxels_sim) return;
    if (voxellen_blg === undefined) voxellen_blg = galaxyobj.voxellen_blg;

    for (var k = 0; k < radiusdata.length; k++) {
        var mom = eval_bracketed_grav_moments_blg(voxels_sim, radiusdata[k]['r'], voxellen_blg);
        store_component_grav_moments(radiusdata[k], 'blg', mom);
    }

    log_accel_diff_table(galaxyobj, 'a_classic_blg', 'a_classic_blg_sim');
}

// Bulge simulation runner for galaxies with galaxyobj.has_blg === true.
function logic_blg() {
    var galaxyobj = galaxiesobj[thegal];
    if (!galaxyobj || !galaxyobj.has_blg) return;

    var rmax = galaxyobj.rmax;
    var voxellen = rmax / rgrid100;
    var r_blg_efold = get_r_blg_efold(galaxyobj);
    var r_blg_max = get_r_blg_max(galaxyobj);
    var sb_blg_peak = Math.max(galaxyobj.sb_blg_max, interpolate_sb_blg(0, galaxyobj));
    galaxyobj.sb_blg_peak = sb_blg_peak;

    console.log('voxel blg:', '\n', 'r_blg_efold (m) =', r_blg_efold.toExponential(2), '\n', 'r_blg_max (m) =', r_blg_max.toExponential(2), '\n', 'sb_blg_max (W/m^2) =', galaxyobj.sb_blg_max.toExponential(2), '\n', 'sb_blg_peak (W/m^2) =', sb_blg_peak.toExponential(2));

    if (typeof scene !== 'undefined') {
        build_viz_voxels_blg(galaxyobj, voxellen);
        console.log('rho_blg_peak (kg/m^3):', galaxyobj.rho_blg_peak.toExponential(2));
        galaxyobj.mesh_blg = plotcubes_instanced(galaxyobj.voxels_blg_viz, 1.0);
        console.log('blg viz voxels (1x1x1):', galaxyobj.voxels_blg_viz.length);
    }

    build_sim_voxels_blg(galaxyobj);
    console.log('blg sim voxels (1 octant):', galaxyobj.voxels_blg_sim.length);

    calc_diff_blg(galaxyobj, galaxyobj.voxellen_blg);
}


// ═══════════════════════════════════════════════════════════════════════════
// 4. PRECOMPUTED BULGE INNER-CORE & TRANSITION PARAMETERS (29 SPARC GALAXIES)
// ═══════════════════════════════════════════════════════════════════════════

// Inner-core (r < r0) parabolic-dome ratio A0 = sb_blg(0)/y0 and optional
// quartic transition weights [A0, w0, w1, ...] on radial intervals (r_k, r_{k+1})
// for the 29 SPARC galaxies with galaxyobj.has_blg === true.
var BLG_CORE_PARAMS = {
    "IC4202":[1.66,-0.2,0.2], "NGC0891":[7.73,-1], "NGC2841":[184], "NGC2955":[1.6,-0.2],
    "NGC4013":[47.48], "NGC4157":[42249], "NGC4217":[1.48,-0.2], "NGC5005":[1.66,-0.55,0.2],
    "NGC5033":[4.26,-0.9], "NGC5985":[541], "NGC6195":[2.37,-0.2], "NGC6674":[147,-1],
    "NGC6946":[8.54,-0.8], "NGC7814":[4.45,-0.55], "UGC02487":[31.37], "UGC02885":[5.45,-0.4],
    "UGC02916":[1.23], "UGC02953":[1.04,0.6], "UGC03205":[1.29,0.2], "UGC03546":[10.02],
    "UGC03580":[1.15], "UGC05253":[1.2,-0.3], "UGC06614":[7.71,-0.9], "UGC06786":[1.3],
    "UGC06787":[1.27], "UGC06973":[153700], "UGC08699":[1.36,-0.2], "UGC09133":[1.31,0.2],
    "UGC11914":[2.35]
};
