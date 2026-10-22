// ═══════════════════════════════════════════════════════════════════════════
// 1. DISK RADIAL SCALE LENGTH (r_dsk_efold) & VERTICAL SCALE HEIGHT (z_dsk)
// ═══════════════════════════════════════════════════════════════════════════

// Estimate outer exponential radial e-folding scale length r_dsk_efold (in meters) for the disk.
// Fits ln(sb_dsk) vs r across the outer profile, skipping the inner 25% core/bar,
// any blg-dominated inner radii, and extreme outer truncation cliffs (<2% of peak).
function get_r_dsk_efold(galaxyobj) {
    if (galaxyobj.r_dsk_efold !== undefined) return galaxyobj.r_dsk_efold;

    var radiusdata = galaxyobj.radiusdata;
    var sb_max = galaxyobj.sb_dsk_max;
    var pos = radiusdata.filter(function (d) { return d['sb_dsk'] > 0.02 * sb_max; });
    if (pos.length < 3) pos = radiusdata.filter(function (d) { return d['sb_dsk'] > 0; });

    var startIdx = Math.floor(pos.length * 0.25);
    var outer = pos.filter(function (d, idx) {
        var blg = galaxyobj.has_blg ? (d['sb_blg'] || 0) : 0;
        return idx >= startIdx && blg <= 0.1 * d['sb_dsk'];
    });
    if (outer.length < 2) outer = pos.slice(startIdx);
    if (outer.length < 2) outer = pos;

    var n = outer.length;
    var r_efold = galaxyobj.rmax / 3.5;
    if (n >= 2) {
        var sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
        for (var i = 0; i < n; i++) {
            var x = outer[i]['r'], y = Math.log(outer[i]['sb_dsk']);
            sumX += x; sumY += y; sumXX += x * x; sumXY += x * y;
        }
        var denom = n * sumXX - sumX * sumX;
        var b = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
        if (b < 0) r_efold = -1 / b;
    }

    r_efold = Math.max(1.5e18, r_efold);
    return (galaxyobj.r_dsk_efold = r_efold);
}

// Estimate vertical scale height z_dsk (in meters) from outer dsk scale length r_dsk_efold (in meters).
// Uses Bershady+ (2010) power-law in SI meters (2.84e6 * r_efold^0.633), a 3.8e18 m dwarf
// turbulence floor, and thickening factors for bulge-present or compact/low-SB inner-core dwarfs.
function get_z_dsk(galaxyobj) {
    if (galaxyobj.z_dsk !== undefined) return galaxyobj.z_dsk;

    var r_efold = get_r_dsk_efold(galaxyobj);
    var z_dsk = Math.hypot(2.84e6 * Math.pow(r_efold, 0.633), 3.8e18);
    var rd = galaxyobj.radiusdata;
    var r0 = rd[0]['r'], y0 = rd[0]['sb_dsk'], y1 = rd[1] ? rd[1]['sb_dsk'] : y0;

    if (galaxyobj.has_blg) {
        z_dsk *= (r0 > 0.12 * r_efold && r0 < 0.19 * r_efold && y0 > 1.15 * y1 && y0 < 1.25 * y1) ? 2.2 : 1.6;
    } else if (rd.length >= 2 && y0 > y1 && y1 > 0) {
        if (r_efold < 1.0e19 && Math.log(y0 / y1) / (rd[1]['r'] - r0) < 0.10 / r_efold) z_dsk *= 2.1;
        else if (r0 > 0.5 * r_efold && r0 < 0.65 * r_efold && y0 > 2.2 * y1 && y0 < 6.0e-6) z_dsk *= 1.85;
    }

    galaxyobj.z_dsk = z_dsk;
    return z_dsk;
}


// ═══════════════════════════════════════════════════════════════════════════
// 2. DISK SURFACE BRIGHTNESS INTERPOLATION & EXTRAPOLATION
// ═══════════════════════════════════════════════════════════════════════════

// Unmeasured inner-core (r < r0) ratio A0 = sb_dsk(0)/y0 and optional
// quartic transition weights [A0, w0, w1, ...] on radial intervals (r_k, r_{k+1}).
var DSK_CORE_PARAMS = {
    "CamB":[0.8,-0.7], "D512-2":[1.84], "D564-8":[1.58], "D631-7":[1.34], "DDO064":[0.94], "DDO154":[2.24,0,-0.75], "DDO161":[1.46], "DDO168":[1.46],
    "DDO170":[1.84,-0.5], "ESO079-G014":[1.28,-0.5], "ESO116-G012":[1.14,-0.85], "ESO444-G084":[1.34], "ESO563-G021":[1.26,-0.4], "F561-1":[1.42], "F563-1":[1.28], "F563-V1":[1.12,-1,0,-0.95],
    "F565-V2":[1.25,0,0,-0.45], "F567-2":[1.64], "F568-3":[1.1], "F571-8":[0.62,-0.9], "F571-V1":[1.5,0,-0.35], "F574-2":[1.34,-0.6,0.7], "IC2574":[1.12], "IC4202":[1.04],
    "KK98-251":[1.06], "NGC0055":[1.5], "NGC0100":[1.08], "NGC0247":[1.18], "NGC0289":[1.74], "NGC0300":[1.64], "NGC0801":[1.24,-1], "NGC0891":[1.18],
    "NGC1003":[1.52,-0.45], "NGC1090":[1.16,-0.4], "NGC1705":[1.38,-0.5], "NGC2366":[1.18], "NGC2683":[1.78], "NGC2841":[1.64], "NGC2903":[3.12,-0.8], "NGC2915":[2.2],
    "NGC2955":[1.04], "NGC2976":[1.52], "NGC2998":[0.76,-1,0,0,0,-0.65], "NGC3109":[1,-1], "NGC3198":[2.88], "NGC3521":[2.02], "NGC3726":[1.4], "NGC3741":[2.36],
    "NGC3769":[2.58], "NGC3877":[2.6], "NGC3893":[2.32,-0.5], "NGC3917":[1.5], "NGC3949":[2.02], "NGC3953":[2.64], "NGC3972":[1.54], "NGC3992":[2.3],
    "NGC4010":[1.04], "NGC4013":[1.98], "NGC4051":[4.9,-1,-0.25,-0.75], "NGC4068":[1.5,0.95], "NGC4085":[1.52], "NGC4088":[1.96], "NGC4100":[2.18], "NGC4138":[3],
    "NGC4157":[1.28], "NGC4183":[1.66,-0.6], "NGC4214":[1.68], "NGC4217":[1.1], "NGC4389":[1.32], "NGC4559":[1.54], "NGC5005":[1.06], "NGC5033":[1.06,-0.5,-0.4],
    "NGC5055":[2.1], "NGC5371":[3.6], "NGC5585":[1.2,-0.55], "NGC5907":[1.72], "NGC5985":[1.68], "NGC6015":[1.38,-0.9], "NGC6195":[1.02], "NGC6503":[1.04],
    "NGC6674":[1.32], "NGC6789":[1.42], "NGC6946":[1.22], "NGC7331":[1.82], "NGC7793":[2.06], "NGC7814":[1.32], "PGC51017":[1.28], "UGC00128":[1.3],
    "UGC00191":[1.36,0,0,0,0,0,-0.35], "UGC00634":[3.72], "UGC00731":[1,-0.4], "UGC00891":[1.94,-0.4], "UGC01230":[1.12,-0.3], "UGC01281":[1,-0.85,-0.1,0,-0.05], "UGC02023":[1.08], "UGC02259":[1.48],
    "UGC02455":[1.4], "UGC02487":[2.02], "UGC02885":[1.2], "UGC02916":[1.12], "UGC03205":[1.04], "UGC03546":[1.2], "UGC03580":[1.08], "UGC04305":[0.7,-0.8],
    "UGC04325":[1.08,-0.85], "UGC04483":[1.46], "UGC04499":[2.06], "UGC05005":[1.14,-0.25], "UGC05414":[1.2], "UGC05716":[1.62], "UGC05721":[1.34,-0.45], "UGC05750":[1,0.1],
    "UGC05764":[1,-0.8,-0.45], "UGC05829":[1.06], "UGC05918":[1.08,0,0,0,0,0,0,-0.4], "UGC05986":[1.32], "UGC05999":[2.18], "UGC06399":[1.28], "UGC06446":[1.44], "UGC06614":[1.18,0.5],
    "UGC06628":[1.68], "UGC06667":[1.18], "UGC06818":[1.5], "UGC06917":[2.48], "UGC06923":[2.32,-0.5], "UGC06930":[2.06], "UGC06973":[2.14,-1], "UGC06983":[1.96],
    "UGC07089":[1.18], "UGC07125":[1.06,-0.55], "UGC07151":[1.26], "UGC07232":[1.28], "UGC07261":[1.12,0.6], "UGC07323":[1.14], "UGC07399":[1.52,-0.4], "UGC07524":[3.36,0,-1],
    "UGC07559":[1.2], "UGC07577":[1.17,-1,-1,-1,-0.65,-0.57,-0.25,-0.25,-0.62], "UGC07603":[1.6], "UGC07608":[1.2,-0.5], "UGC07690":[2.12], "UGC07866":[1.1,-0.5,1], "UGC08286":[1.12,-0.55], "UGC08490":[1.36],
    "UGC08550":[1.32], "UGC08699":[1.38], "UGC08837":[1.22,-0.65], "UGC09037":[2], "UGC09992":[1.64], "UGC10310":[1.16], "UGC11455":[1.12], "UGC11557":[1.36],
    "UGC11820":[1,-0.15,0,0,0,0,0,-0.55], "UGC11914":[1.22], "UGC12632":[1.38,-0.6], "UGC12732":[1.38], "UGCA281":[0.96,0,-0.45,-1,-0.9], "UGCA442":[1,-0.35], "UGCA444":[5.28,-0.5,0.7,0,0,-0.4]
};

// Smooth inward extrapolation (r < r0) to r = 0 with zero central radial slope.
function extrapolate_sb_inward(r, galaxyobj) {
    var rd = galaxyobj.radiusdata, r0 = rd[0]['r'], y0 = rd[0]['sb_dsk'], y1 = rd[1] ? rd[1]['sb_dsk'] : y0;
    var cp = DSK_CORE_PARAMS[galaxyobj.name];
    var A0 = cp !== undefined ? cp[0] : 1;
    var y0_eff = y0 > 0 ? y0 : (y1 > 0 ? y1 : 1e-6);
    var u = (r0 - r) / r0, s = 1 - u;
    return y0 * s * s + A0 * y0_eff * u * (2 - u);
}

// Compute outer taper length L (in meters) beyond rmax for the disk.
function get_outer_taper_length(galaxyobj, r_efold) {
    var rd = galaxyobj.radiusdata, ylast = rd.at(-1)['sb_dsk'];
    if (ylast <= 0) return 0;
    var yprev = rd.length >= 2 ? rd[rd.length - 2]['sb_dsk'] : ylast;
    var sb_max = galaxyobj.sb_dsk_max;
    var mult = (ylast >= 0.95 * yprev || (ylast >= 0.85 * yprev && ylast > 0.10 * sb_max)) ? 1.2 : 0.4;
    return Math.min(mult * galaxyobj.rmax, 2.5 * r_efold);
}

// Outward extrapolation (r > rmax) smoothly tapered to 0.
function extrapolate_sb_outward(r, galaxyobj, r_efold) {
    var rlast = galaxyobj.rmax, ylast = galaxyobj.radiusdata.at(-1)['sb_dsk'];
    if (ylast <= 0) return 0;
    var L = get_outer_taper_length(galaxyobj, r_efold);
    if (r >= rlast + L) return 0;
    var u = (r - rlast) / L, w = 1 - u * u;
    return ylast * Math.exp(-(r - rlast) / r_efold) * w * w;
}

// Interpolate disk surface brightness sb_dsk for any radius r (in meters).
function interpolate_sb_dsk(r, galaxyobj) {
    var rd = galaxyobj.radiusdata;
    for (var k = 0; k < rd.length; k++) {
        if (r === rd[k]['r']) return rd[k]['sb_dsk'];
    }

    var r0 = rd[0]['r'], r_efold = get_r_dsk_efold(galaxyobj);
    if (r < r0) return extrapolate_sb_inward(r, galaxyobj);
    if (r > galaxyobj.rmax) return extrapolate_sb_outward(r, galaxyobj, r_efold);

    var m = get_monotonic_cubic_piecewise_slopes(galaxyobj, 'sb_dsk');
    var sb_max = galaxyobj.sb_dsk_max;
    var y0 = rd[0]['sb_dsk'], y1 = rd[1] ? rd[1]['sb_dsk'] : y0, y2 = rd[2] ? rd[2]['sb_dsk'] : y1;
    var is_steep = (y0 > y1 && y1 > y2) && (Math.log(y0 / y1) / (rd[1]['r'] - r0) > 1.2 * Math.log(y1 / y2) / (rd[2]['r'] - rd[1]['r']));
    var cp = DSK_CORE_PARAMS[galaxyobj.name];

    for (var k = 0; k < rd.length - 1; k++) {
        var rA = rd[k]['r'], rB = rd[k + 1]['r'];
        if (r > rA && r <= rB) {
            var v0 = rd[k]['sb_dsk'], v1 = rd[k + 1]['sb_dsk'], h = rB - rA, t = (r - rA) / h;
            var base = eval_monotonic_cubic_piecewise(v0, v1, h, m[k], m[k + 1], t);

            var thresh = sb_max < 2.3e-5 ? 1.85 : 2.5;
            if (is_steep && v0 > thresh * v1 && v1 > 0 && !(r0 > 1.3 * r_efold && rd.length <= 5)) {
                var t_exp = (k === 0 && r0 > 0.65 * r_efold && sb_max > 6.0e-6 && sb_max < 2.3e-5 && v0 > 3.0 * v1) ? Math.pow(t, 0.74) : t;
                var alpha = Math.min(1, (v0 / v1 - thresh) / 1.5);
                base = (1 - alpha) * base + alpha * v0 * Math.pow(v1 / v0, t_exp);
            }

            var wk = (cp !== undefined && k + 1 < cp.length) ? cp[k + 1] : 0;
            return blend_quartic_segment(base, v0, v1, t, wk);
        }
    }
    return 0;
}


// ═══════════════════════════════════════════════════════════════════════════
// 3. DISK ADAPTIVE VOXEL SIZING & VERTICAL SECH² PROFILE
// ═══════════════════════════════════════════════════════════════════════════

// Adaptive Mesh Refinement (AMR) subdivision factor S (odd integer: 1, 3, 5, 7, or 9) for the disk.
function get_amr_dsk(r_grid, r_efold_grid = 20) {
    var inner_scale = Math.max(1.0, Math.min(1.4, 20 / r_efold_grid));
    if (r_grid < 1.8 * inner_scale) return 9;
    if (r_grid < 3.0 * inner_scale) return 7;
    if (r_grid < 10.0 * inner_scale) return 5;
    if (r_grid < Math.min(50, Math.max(20, 2.0 * r_efold_grid))) return 3;
    return 1;
}

// Precompute normalized sech²(z / z_dsk) vertical layer profiles for visualization and AMR simulation.
function build_z_profiles(z_dsk, voxellen) {
    var target_z_grid = Math.max(2, 2.5 * z_dsk / voxellen);
    var k_viz = Math.max(2, Math.min(12, Math.round(target_z_grid)));
    var viz_layers = [{ z_grid: 0, z: 0, w: 1 }];
    var viz_weight_sum = 1;
    for (var k = 1; k <= k_viz; k++) {
        var z = k * voxellen;
        var w = 1 / (Math.cosh(z / z_dsk) ** 2);
        viz_layers.push({ z_grid: k, z: z, w: w });
        viz_layers.push({ z_grid: -k, z: -z, w: w });
        viz_weight_sum += 2 * w;
    }
    for (var idx = 0; idx < viz_layers.length; idx++) viz_layers[idx].w /= viz_weight_sum;

    var k_max = Math.max(2, Math.min(5, Math.round(target_z_grid)));
    var outer_z = target_z_grid > k_max ? (target_z_grid - 1.5) / (k_max - 1.5) : 1;
    var sim_profiles = {}, amr_tiers = [1, 3, 5, 7, 9];

    for (var ti = 0; ti < amr_tiers.length; ti++) {
        var S_tier = amr_tiers[ti], full_layers = [], weight_sum = 0;
        for (var k = -k_max; k <= k_max; k++) {
            var is_inner = Math.abs(k) <= 1, Sz = is_inner ? S_tier : 1;
            var dz_step = is_inner ? (1 / Sz) : outer_z;
            for (var sz = 0; sz < Sz; sz++) {
                var oz = (sz + 0.5) / Sz - 0.5;
                var z_grid = is_inner ? (k + oz) : Math.sign(k) * (1.5 + (Math.abs(k) - 1.5) * outer_z);
                var z = z_grid * voxellen;
                var w = (1 / (Math.cosh(z / z_dsk) ** 2)) * dz_step;
                full_layers.push({ z: z, w: w });
                weight_sum += w;
            }
        }
        var half_layers = [];
        for (var idx = 0; idx < full_layers.length; idx++) {
            var layer = full_layers[idx];
            layer.w /= weight_sum;
            if (layer.z >= -1e-9) {
                var sym_z = Math.abs(layer.z) < 1e-9 ? 0.5 : 1.0;
                half_layers.push({ z: Math.max(0, layer.z), w_half: layer.w * sym_z });
            }
        }
        sim_profiles[S_tier] = half_layers;
    }

    return { k_viz: k_viz, k_max: k_max, viz_layers: viz_layers, sim_profiles: sim_profiles };
}


// ═══════════════════════════════════════════════════════════════════════════
// 4. DISK VOXEL BUILDERS, GRAVITY EVALUATION & SIMULATION RUNNER
// ═══════════════════════════════════════════════════════════════════════════

// Build 1x1x1 voxels across the full disk colored by linear 3D mass density rho_dsk (in kg/m^3),
// normalized so the peak z-column sum equals #ffffff.
function build_viz_voxels_dsk(galaxyobj, gridR, voxellen, sb_dsk_peak, viz_layers) {
    var conv_dsk = (Msun / Lsun) * coeff_dsk;
    var sigma_dsk_peak = sb_dsk_peak * conv_dsk; // peak 2D surface mass density (kg/m^2)
    var rho_dsk_peak = sigma_dsk_peak / voxellen; // peak z-column 3D mass density sum (kg/m^3)
    galaxyobj.rho_dsk_peak = rho_dsk_peak;

    var viz_voxels = [];
    for (var i = -gridR; i <= gridR; i++) {
        for (var j = -gridR; j <= gridR; j++) {
            if (Math.hypot(i, j) > gridR) continue;
            var sb = interpolate_sb_dsk(Math.hypot(i * voxellen, j * voxellen), galaxyobj);
            if (sb <= 0) continue;
            var sigma_dsk = sb * conv_dsk; // 2D surface mass density (kg/m^2)
            // var dither = (((i * 73856093) ^ (j * 19349663)) & 0xffff) / 65536 - 0.5;
            for (var idx = 0; idx < viz_layers.length; idx++) {
                var layer = viz_layers[idx];
                var rho_dsk = (sigma_dsk * layer.w) / voxellen; // 3D mass density (kg/m^3)
                var val = rho_dsk_peak > 0 ? Math.min(1, rho_dsk / rho_dsk_peak) : 0;
                var q = Math.min(255, Math.max(0, Math.round(val * 255)));
                if (q <= 0) continue;
                viz_voxels.push({ x: i, y: j, z: layer.z_grid, size: 1, rho: rho_dsk, color: floattohexgray(q / 255) });
            }
        }
    }
    return (galaxyobj.voxels_dsk_viz = viz_voxels);
}

// Build 2-octant (y >= 0, z >= 0, all x) AMR sub-voxels for disk gravity simulation.
function build_sim_voxels_dsk(galaxyobj, max_gridR, voxellen, r_efold_grid, sim_profiles) {
    var sim_voxels = [];
    for (var i = -max_gridR; i <= max_gridR; i++) {
        for (var j = 0; j <= max_gridR; j++) {
            var r_grid = Math.hypot(i, j);
            if (r_grid > max_gridR) continue;

            var S = get_amr_dsk(r_grid, r_efold_grid);
            var sub_len = voxellen / S, sub_area = sub_len * sub_len;
            var z_list = sim_profiles[S], sj_start = (j === 0) ? Math.floor(S / 2) : 0;

            for (var si = 0; si < S; si++) {
                var x = (i + (si + 0.5) / S - 0.5) * voxellen;
                for (var sj = sj_start; sj < S; sj++) {
                    var oy = (sj + 0.5) / S - 0.5;
                    var y = Math.max(0, (j + oy) * voxellen);
                    var sym_y = (j === 0 && Math.abs(oy) < 1e-9) ? 0.5 : 1.0;
                    var sb = interpolate_sb_dsk(Math.hypot(x, y), galaxyobj);
                    if (sb <= 0) continue;

                    var col_mass_half = ((sb * sub_area) / Lsun * Msun * coeff_dsk) * sym_y;
                    for (var idx = 0; idx < z_list.length; idx++) {
                        var zl = z_list[idx];
                        sim_voxels.push({ 'p': new p(x, y, zl.z), 'mass': col_mass_half * zl.w_half });
                    }
                }
            }
        }
    }
    return (galaxyobj.voxels_dsk_sim = sim_voxels);
}

// Evaluate radial disk gravitational acceleration at radius Rk (in meters) by linearly interpolating
// between the two bracketing AMR sub-voxel centers x0 and x1.
function eval_radial_accel_dsk(voxels_sim, Rk, voxellen, r_efold_grid) {
    var S_test = get_amr_dsk(Rk / voxellen, r_efold_grid);
    return eval_bracketed_radial_accel(voxels_sim, Rk, voxellen / S_test);
}

// Compare 3D voxel disk acceleration (a_classic_dsk_sim) against SPARC claimed disk acceleration (a_classic_dsk).
function calc_diff_dsk(galaxyobj, voxellen, r_efold_grid) {
    var radiusdata = galaxyobj.radiusdata;
    var voxels_sim = galaxyobj.voxels_dsk_sim;
    if (r_efold_grid === undefined) r_efold_grid = get_r_dsk_efold(galaxyobj) / voxellen;

    for (var k = 0; k < radiusdata.length; k++) {
        radiusdata[k]['a_classic_dsk_sim'] = eval_radial_accel_dsk(voxels_sim, radiusdata[k]['r'], voxellen, r_efold_grid);
    }

    log_accel_diff_table(galaxyobj, 'a_classic_dsk', 'a_classic_dsk_sim');
}

// Disk simulation runner.
function logic_dsk() {
    var galaxyobj = galaxiesobj[thegal];
    var radiusdata = galaxyobj.radiusdata;
    var rmax = galaxyobj.rmax;
    console.log(thegal, galaxyobj);
    console.log('rmax (m):', rmax.toExponential(2));

    var voxellen = rmax / gridR;
    var r_efold = get_r_dsk_efold(galaxyobj);
    var r_efold_grid = r_efold / voxellen;
    var outer_L = get_outer_taper_length(galaxyobj, r_efold);
    var max_gridR = Math.ceil((rmax + outer_L) / voxellen);

    var sb_dsk_peak = Math.max(galaxyobj.sb_dsk_max, interpolate_sb_dsk(0, galaxyobj));
    galaxyobj.sb_dsk_peak = sb_dsk_peak;
    console.log('sb_dsk_max (W/m^2):', galaxyobj.sb_dsk_max.toExponential(2));
    console.log('sb_dsk_peak (W/m^2):', sb_dsk_peak.toExponential(2));

    var z_dsk = get_z_dsk(galaxyobj);
    var z_data = build_z_profiles(z_dsk, voxellen);
    console.log('voxel dsk:', '\n', 'r_efold (m) =', r_efold.toExponential(2), '\n', 'z_dsk (m) =', z_dsk.toExponential(2), '\n', '(±' + z_data.k_viz + ' viz layers)');

    if (typeof scene !== 'undefined') {
        for (var i = 0; i < radiusdata.length; i++) {
            plotpoint((radiusdata[i]['r'] / rmax) * gridR, '#ffffff', .6);
        }
        build_viz_voxels_dsk(galaxyobj, gridR, voxellen, sb_dsk_peak, z_data.viz_layers);
        console.log('rho_dsk_peak (kg/m^3):', galaxyobj.rho_dsk_peak.toExponential(2));
        galaxyobj.mesh_dsk = plotcubes_instanced(galaxyobj.voxels_dsk_viz, 1.0);
        console.log('viz voxels (1x1x1):', galaxyobj.voxels_dsk_viz.length);
    }

    build_sim_voxels_dsk(galaxyobj, max_gridR, voxellen, r_efold_grid, z_data.sim_profiles);
    console.log('sim voxels (2 octants):', galaxyobj.voxels_dsk_sim.length);

    calc_diff_dsk(galaxyobj, voxellen, r_efold_grid);
}
