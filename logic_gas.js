// ═══════════════════════════════════════════════════════════════════════════
// 1. THIN FLARED GAS DISK GEOMETRY, AMR & NON-NEGATIVE LEAST SQUARES SOLVER
// ═══════════════════════════════════════════════════════════════════════════

// Normalized vertical quadrature coordinates u = z / z_gas(R) and half-space weights
// for sech²(u) across the thin flared gas disk (W_0/2 + W_1 + W_2 + W_3 = 0.5).
var GAS_U_LAYERS = [0, 0.5, 1.1, 1.9];
var GAS_W_LAYERS = (function () {
    var raw = GAS_U_LAYERS.map(function (u, idx) {
        var du = idx === 0 ? 0.25 : (GAS_U_LAYERS[idx] - GAS_U_LAYERS[idx - 1]);
        var sech2 = 1 / (Math.cosh(u) ** 2);
        return sech2 * du;
    });
    var sum = raw[0] + 2 * (raw[1] + raw[2] + raw[3]);
    return [raw[0] / sum, raw[1] / sum, raw[2] / sum, raw[3] / sum];
})();

// Radial Adaptive Mesh Refinement (AMR) subdivision factor S (odd integer: 1, 3, 5, 7, 9, 15)
// for the thin flared gas disk.
function get_amr_gas(r_grid) {
    if (r_grid < 1.2) return 15;
    if (r_grid < 2.5) return 9;
    if (r_grid < 5.0) return 7;
    if (r_grid < 14.0) return 5;
    if (r_grid < 40.0) return 3;
    return 1;
}

// Local vertical scale height z_gas(r) (in meters) for the thin flared gas disk:
// genuinely thin near the galactic center (z_gas << r) and flaring outward as (r / rmax)^1.5.
function get_z_gas(r, galaxyobj) {
    var rmax = galaxyobj.rmax;
    var voxellen = rmax / gridR;
    var uR = Math.max(0, r) / rmax;
    return 0.03 * Math.max(0, r) + 2.2 * voxellen * uR * Math.sqrt(uR);
}

// Gaussian elimination with partial pivoting on active index subset for NNLS.
function solve_active_linear_system(H_in, b_in, activeIdx) {
    var m = activeIdx.length;
    if (m === 0) return [];
    var M = new Array(m);
    for (var r = 0; r < m; r++) {
        var row = new Float64Array(m + 1);
        var i = activeIdx[r];
        for (var c = 0; c < m; c++) row[c] = H_in[i][activeIdx[c]];
        row[m] = b_in[i];
        M[r] = row;
    }
    for (var col = 0; col < m; col++) {
        var piv = col;
        for (var r = col + 1; r < m; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
        }
        var tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
        var diag = M[col][col];
        if (Math.abs(diag) < 1e-35) continue;
        for (var c = col; c <= m; c++) M[col][c] /= diag;
        for (var r = 0; r < m; r++) {
            if (r === col) continue;
            var f = M[r][col];
            if (f === 0) continue;
            for (var c = col; c <= m; c++) M[r][c] -= f * M[col][c];
        }
    }
    var out = new Float64Array(m);
    for (var r = 0; r < m; r++) out[r] = M[r][m];
    return out;
}

// Lawson-Hanson active-set Non-Negative Least Squares (NNLS) solver for H * sigma = b (sigma >= 0)
// with diagonal preconditioning in variable selection.
function solve_nnls_gas(H, b, M) {
    var x = new Float64Array(M);
    var passive = new Array(M).fill(false);

    for (var step = 0; step < 5 * M; step++) {
        var bestIdx = -1, bestScore = 1e-12;
        for (var i = 0; i < M; i++) {
            if (passive[i]) continue;
            var wi = b[i];
            for (var j = 0; j < M; j++) wi -= H[i][j] * x[j];
            var score = wi / Math.sqrt(Math.max(1e-30, H[i][i]));
            if (score > bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }
        if (bestIdx === -1) break;
        passive[bestIdx] = true;

        var innerGuard = 0;
        while (innerGuard++ < 5 * M) {
            var activeIdx = [];
            for (var i = 0; i < M; i++) if (passive[i]) activeIdx.push(i);
            var z_act = solve_active_linear_system(H, b, activeIdx);
            var z = new Float64Array(M);
            var allPos = true;
            for (var c = 0; c < activeIdx.length; c++) {
                z[activeIdx[c]] = z_act[c];
                if (z_act[c] <= 0) allPos = false;
            }
            if (allPos) {
                x = z;
                break;
            }
            var alpha = 1.0, dropIdx = -1;
            for (var c = 0; c < activeIdx.length; c++) {
                var i = activeIdx[c];
                if (z[i] <= 0) {
                    var ratio = x[i] / (x[i] - z[i] + 1e-30);
                    if (ratio <= alpha) {
                        alpha = ratio;
                        dropIdx = i;
                    }
                }
            }
            for (var i = 0; i < M; i++) {
                x[i] += alpha * (z[i] - x[i]);
                if (passive[i] && x[i] <= 1e-15) {
                    x[i] = 0;
                    passive[i] = false;
                }
            }
            if (dropIdx !== -1) {
                x[dropIdx] = 0;
                passive[dropIdx] = false;
            }
        }
    }
    return x;
}


// ═══════════════════════════════════════════════════════════════════════════
// 2. 3D VOXEL GAS SURFACE DENSITY RECONSTRUCTION & INTERPOLATION
// ═══════════════════════════════════════════════════════════════════════════

// Reconstruct non-negative radial gas surface mass density profile sigma_gas(R) (in kg/m^2)
// and 2-octant 3D AMR simulation voxels directly from SPARC's claimed a_classic_gas.
function build_sim_voxels_gas(galaxyobj) {
    var rd = galaxyobj.radiusdata;
    var n = rd.length;
    var rmax = galaxyobj.rmax;
    var voxellen = rmax / gridR;
    var max_gridR = 115;

    // Construct radial basis nodes r_nodes with AMR-aware minimum spacing
    var r_nodes = [0];
    if (rd[0]['r'] > 1.5 * voxellen) {
        r_nodes.push(0.4 * rd[0]['r']);
        r_nodes.push(0.75 * rd[0]['r']);
    }
    for (var k = 0; k < n; k++) {
        var rk = rd[k]['r'];
        var S_loc = get_amr_gas(rk / voxellen);
        var min_dr = 1.05 * (voxellen / S_loc);
        if (rk - r_nodes[r_nodes.length - 1] >= min_dr) {
            r_nodes.push(rk);
        }
    }
    if (rmax - r_nodes[r_nodes.length - 1] < 0.2 * voxellen) {
        r_nodes[r_nodes.length - 1] = rmax;
    } else {
        r_nodes.push(rmax);
    }
    r_nodes.push(1.07 * rmax);
    r_nodes.push(1.15 * rmax);
    var M = r_nodes.length - 1; // r_nodes[M] = 0 outer taper boundary

    // Build 2-octant (y >= 0, z >= 0, all x) thin flared disk geometry voxels
    var geom_voxels = [];
    for (var i = -max_gridR; i <= max_gridR; i++) {
        for (var j = 0; j <= max_gridR; j++) {
            var r_grid = Math.hypot(i, j);
            if (r_grid > max_gridR) continue;
            var S = get_amr_gas(r_grid);
            var sub_len = voxellen / S, sub_area = sub_len * sub_len;
            var sj_start = (j === 0) ? Math.floor(S / 2) : 0;

            for (var si = 0; si < S; si++) {
                var x = (i + (si + 0.5) / S - 0.5) * voxellen;
                for (var sj = sj_start; sj < S; sj++) {
                    var oy = (sj + 0.5) / S - 0.5;
                    var y = Math.max(0, (j + oy) * voxellen);
                    var sym_y = (j === 0 && Math.abs(oy) < 1e-9) ? 0.5 : 1.0;
                    var R = Math.hypot(x, y);
                    if (R >= r_nodes[M]) continue;

                    var z_gas = get_z_gas(R, galaxyobj);
                    var m = 0;
                    while (m + 1 < M && r_nodes[m + 1] <= R) m++;
                    var t = (R - r_nodes[m]) / (r_nodes[m + 1] - r_nodes[m]);
                    var area_sym = sub_area * sym_y;

                    for (var l = 0; l < GAS_U_LAYERS.length; l++) {
                        geom_voxels.push({
                            x: x,
                            y: y,
                            z: GAS_U_LAYERS[l] * z_gas,
                            W: area_sym * GAS_W_LAYERS[l],
                            m: m,
                            t: t
                        });
                    }
                }
            }
        }
    }

    // Assemble exact 3D voxel Newtonian kernel matrix A[k][m]
    var A = new Array(n);
    for (var k = 0; k < n; k++) {
        var row = new Float64Array(M);
        A[k] = row;
        var Rk = rd[k]['r'];
        var r_grid = Rk / voxellen;
        var S_test = get_amr_gas(r_grid);
        var h_test = voxellen / S_test;
        var u_rk = Rk / h_test;
        var i0 = Math.floor(u_rk), i1 = i0 + 1;
        var frac = u_rk - i0;
        var cut = 1.5 * h_test;

        var x_evals = i0 > 0
            ? [{ x: i0 * h_test, w: 1 - frac }, { x: i1 * h_test, w: frac }]
            : [{ x: i1 * h_test, w: frac }];

        for (var ei = 0; ei < x_evals.length; ei++) {
            var xe = x_evals[ei].x, we = x_evals[ei].w;
            for (var vi = 0; vi < geom_voxels.length; vi++) {
                var vox = geom_voxels[vi];
                if (Math.abs(vox.x - xe) < cut && vox.y < cut && vox.z < cut) continue;
                var dx = vox.x - xe, dy = vox.y, dz = vox.z;
                var dist2 = dx * dx + dy * dy + dz * dz;
                var dist = Math.sqrt(dist2);
                var mag = 4 * G * vox.W / dist2;
                var dir_x = dx / dist;
                var g_val = -mag * dir_x * we;
                var m = vox.m, t = vox.t;
                row[m] += (1 - t) * g_val;
                if (m + 1 < M) row[m + 1] += t * g_val;
            }
        }
    }

    // Solve weighted NNLS for non-negative surface mass density nodes sigma[0..M-1] (kg/m^2)
    var a_target = new Float64Array(n);
    var a_scale = 0;
    for (var k = 0; k < n; k++) {
        var ak = rd[k]['a_classic_gas'] || 0;
        a_target[k] = ak;
        if (Math.abs(ak) > a_scale) a_scale = Math.abs(ak);
    }

    var sigma = new Float64Array(M);
    if (a_scale > 0) {
        var H = new Array(M);
        for (var i = 0; i < M; i++) H[i] = new Float64Array(M);
        var b = new Float64Array(M);

        for (var k = 0; k < n; k++) {
            var ak = a_target[k];
            var w = 1 / Math.max(Math.abs(ak), 0.005 * a_scale);
            var w2 = w * w;
            var row = A[k];
            for (var i = 0; i < M; i++) {
                b[i] += w2 * row[i] * ak;
                for (var j = 0; j < M; j++) {
                    H[i][j] += w2 * row[i] * row[j];
                }
            }
        }

        var colNorm2 = new Float64Array(M);
        for (var i = 0; i < M; i++) {
            var s = 0;
            for (var k = 0; k < n; k++) {
                var ratio = A[k][i] / a_scale;
                s += ratio * ratio;
            }
            colNorm2[i] = Math.max(1e-30, s);
        }
        for (var i = 0; i < M - 1; i++) {
            var scale_i = Math.sqrt(colNorm2[i] * colNorm2[i + 1]);
            var l1 = (i === M - 2) ? 1e-3 * scale_i : 1e-5 * scale_i;
            H[i][i] += l1;
            H[i + 1][i + 1] += l1;
            H[i][i + 1] -= l1;
            H[i + 1][i] -= l1;
        }

        sigma = solve_nnls_gas(H, b, M);
    }

    // Store piecewise-linear node table [r_nodes, sigma_nodes] with sigma_nodes[M] = 0
    var sigma_nodes = new Float64Array(M + 1);
    for (var i = 0; i < M; i++) sigma_nodes[i] = sigma[i];
    sigma_nodes[M] = 0;
    galaxyobj.gas_r_nodes = r_nodes;
    galaxyobj.gas_sigma_nodes = sigma_nodes;
    galaxyobj.z_gas_outer = get_z_gas(rmax, galaxyobj);

    // Populate sigma_gas (kg/m^2) and equivalent sb_gas (W/m^2) on radiusdata
    var conv_dsk = (Msun / Lsun) * coeff_dsk;
    var sb_gas_max = 0, sigma_gas_max = 0;
    for (var k = 0; k < n; k++) {
        var sig_k = interpolate_sigma_gas(rd[k]['r'], galaxyobj);
        var sb_k = sig_k / conv_dsk;
        rd[k]['sigma_gas'] = sig_k;
        rd[k]['sb_gas'] = sb_k;
        if (sig_k > sigma_gas_max) sigma_gas_max = sig_k;
        if (sb_k > sb_gas_max) sb_gas_max = sb_k;
    }
    var sigma_gas_peak = sigma_gas_max;
    for (var i = 0; i <= M; i++) {
        if (sigma_nodes[i] > sigma_gas_peak) sigma_gas_peak = sigma_nodes[i];
    }
    galaxyobj.sigma_gas_max = sigma_gas_max;
    galaxyobj.sigma_gas_peak = sigma_gas_peak;
    galaxyobj.sb_gas_max = sb_gas_max;
    galaxyobj.sb_gas_peak = sigma_gas_peak / conv_dsk;

    // Instantiate 2-octant 3D simulation voxels with exact masses m_v = W_v * sigma_gas(R_v)
    var sim_voxels = [];
    for (var vi = 0; vi < geom_voxels.length; vi++) {
        var gv = geom_voxels[vi];
        var sig_v = (1 - gv.t) * sigma_nodes[gv.m] + gv.t * sigma_nodes[gv.m + 1];
        var mass = gv.W * sig_v;
        if (mass <= 0) continue;
        sim_voxels.push({ 'p': new p(gv.x, gv.y, gv.z), 'mass': mass });
    }

    galaxyobj.voxellen_gas = voxellen;
    return (galaxyobj.voxels_gas_sim = sim_voxels);
}

// Interpolate reconstructed 2D gas surface mass density sigma_gas(r) (in kg/m^2) at radius r (in meters).
function interpolate_sigma_gas(r, galaxyobj) {
    var r_nodes = galaxyobj.gas_r_nodes;
    var sigma_nodes = galaxyobj.gas_sigma_nodes;
    if (!r_nodes || !sigma_nodes) return 0;
    var M = r_nodes.length - 1;
    if (r <= 0) return sigma_nodes[0];
    if (r >= r_nodes[M]) return 0;

    var m = 0;
    while (m + 1 < M && r_nodes[m + 1] <= r) m++;
    var h = r_nodes[m + 1] - r_nodes[m];
    var t = h > 0 ? (r - r_nodes[m]) / h : 0;
    return Math.max(0, (1 - t) * sigma_nodes[m] + t * sigma_nodes[m + 1]);
}

// Interpolate gas surface mass density expressed in equivalent surface brightness units (W/m^2)
// using the disk mass-to-light conversion factor so HUD and Dashboard can plot it alongside sb_dsk & sb_blg.
function interpolate_sb_gas(r, galaxyobj) {
    var conv_dsk = (Msun / Lsun) * coeff_dsk;
    return interpolate_sigma_gas(r, galaxyobj) / conv_dsk;
}


// ═══════════════════════════════════════════════════════════════════════════
// 3. 3D VISUALIZATION VOXELS, GRAVITY EVALUATION & SIMULATION RUNNER
// ═══════════════════════════════════════════════════════════════════════════

// Build 1x1x1 3D visualization voxels across the thin flared gas disk colored by linear 3D mass density rho_gas (in kg/m^3),
// normalized so the peak z-column sum equals #ffffff.
function build_viz_voxels_gas(galaxyobj, gridR, voxellen) {
    var columns = [];
    var rho_gas_peak = 0;

    for (var i = -gridR; i <= gridR; i++) {
        for (var j = -gridR; j <= gridR; j++) {
            var r_grid = Math.hypot(i, j);
            if (r_grid > gridR) continue;
            var R = r_grid * voxellen;
            var sigma_gas = interpolate_sigma_gas(R, galaxyobj);
            if (sigma_gas <= 0) continue;

            var z_gas = Math.max(0.35 * voxellen, get_z_gas(R, galaxyobj));
            var k_local = Math.min(6, Math.max(1, Math.ceil(2.2 * z_gas / voxellen)));
            var z_order = [0];
            for (var kz = 1; kz <= k_local; kz++) {
                z_order.push(kz, -kz);
            }

            var w_arr = new Float64Array(z_order.length);
            var w_sum = 0;
            for (var idx = 0; idx < z_order.length; idx++) {
                var z = z_order[idx] * voxellen;
                var w = 1 / (Math.cosh(z / z_gas) ** 2);
                w_arr[idx] = w;
                w_sum += w;
            }

            var col_rho = sigma_gas / voxellen;
            if (col_rho > rho_gas_peak) rho_gas_peak = col_rho;

            var col_voxels = [];
            for (var idx = 0; idx < z_order.length; idx++) {
                var w_norm = w_arr[idx] / w_sum;
                var rho_gas = col_rho * w_norm; // 3D mass density (kg/m^3)
                col_voxels.push({ x: i, y: j, z: z_order[idx], rho: rho_gas });
            }
            columns.push(col_voxels);
        }
    }

    galaxyobj.rho_gas_peak = rho_gas_peak;
    var viz_voxels = [];
    for (var c = 0; c < columns.length; c++) {
        var col = columns[c];
        // var dither = (((col[0].x * 73856093) ^ (col[0].y * 19349663)) & 0xffff) / 65536 - 0.5;
        for (var idx = 0; idx < col.length; idx++) {
            var rv = col[idx];
            var val = rho_gas_peak > 0 ? Math.min(1, rv.rho / rho_gas_peak) : 0;
            var q = Math.min(255, Math.max(0, Math.round(val * 255)));
            if (q <= 0) continue;
            viz_voxels.push({ x: rv.x, y: rv.y, z: rv.z, size: 1, rho: rv.rho, color: floattohexgray(q / 255) });
        }
    }
    return (galaxyobj.voxels_gas_viz = viz_voxels);
}

// Evaluate radial gas gravitational acceleration at radius Rk (in meters) by linearly interpolating
// between the two bracketing AMR sub-voxel centers x0 and x1.
function eval_radial_accel_gas(voxels_sim, Rk, voxellen) {
    var r_grid = Rk / voxellen;
    var S_test = get_amr_gas(r_grid);
    return eval_bracketed_radial_accel(voxels_sim, Rk, voxellen / S_test);
}

// Compare 3D voxel gas acceleration (a_classic_gas_sim) against SPARC claimed gas acceleration (a_classic_gas).
function calc_diff_gas(galaxyobj, voxellen) {
    var radiusdata = galaxyobj.radiusdata;
    var voxels_sim = galaxyobj.voxels_gas_sim;
    if (!voxels_sim) return;
    if (voxellen === undefined) voxellen = galaxyobj.voxellen_gas || (galaxyobj.rmax / gridR);

    for (var k = 0; k < radiusdata.length; k++) {
        radiusdata[k]['a_classic_gas_sim'] = eval_radial_accel_gas(voxels_sim, radiusdata[k]['r'], voxellen);
    }

    log_accel_diff_table(galaxyobj, 'a_classic_gas', 'a_classic_gas_sim');
}

// Thin flared gas disk simulation runner.
function logic_gas() {
    var galaxyobj = galaxiesobj[thegal];
    if (!galaxyobj) return;

    var rmax = galaxyobj.rmax;
    var voxellen = rmax / gridR;

    build_sim_voxels_gas(galaxyobj);
    if (typeof scene !== 'undefined') {
        build_viz_voxels_gas(galaxyobj, gridR, voxellen);
        galaxyobj.mesh_gas = plotcubes_instanced(galaxyobj.voxels_gas_viz, 1.0);
        console.log(
            'voxel gas:', '\n',
            'z_gas_outer (m) =', galaxyobj.z_gas_outer.toExponential(2), '\n',
            'sigma_gas_peak (kg/m^2) =', galaxyobj.sigma_gas_peak.toExponential(2), '\n',
            'rho_gas_peak (kg/m^3) =', galaxyobj.rho_gas_peak.toExponential(2), '\n',
            'gas viz voxels (1x1x1):', galaxyobj.voxels_gas_viz.length, '\n',
            'gas sim voxels (2 octants):', galaxyobj.voxels_gas_sim.length
        );
    }

    calc_diff_gas(galaxyobj, voxellen);
}
