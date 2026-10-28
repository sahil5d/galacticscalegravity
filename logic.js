// ═══════════════════════════════════════════════════════════════════════════
// SHARED GALAXY SELECTION, MONOTONIC CUBIC PIECEWISE INTERPOLATION & 3D VOXEL GRAVITY SOLVER
// ═══════════════════════════════════════════════════════════════════════════
//
// File Pipeline Overview:
//   - data_sparcgalaxies.js : 175 SPARC galaxies in SI units (r in m, sb in W/m^2, a in m/s^2)
//   - lib.js                : Physical constants (G, CSPEED, H, a0, Msun, Lsun, coeff_dsk, coeff_blg) & GPU-instanced 3D cube renderer
//   - logic.js              : Shared interpolation, 1-octant AMR iterator, voxel buffers & 3D vector gravity solver
//   - logic_dsk.js          : 3D Stellar Disk voxel model (sech^2(z / z0) vertical profile + inner/outer radial extrapolation)
//   - logic_blg.js          : 3D Spherical Bulge voxel model (Abel inversion + spherical shell adaptive quadrature)
//   - logic_gas.js          : 3D Flared Gas Disk voxel model (linearly flared sech^2(z / z_gas(R)) vertical profile)
//   - logic_grav.js         : Merged 1-octant AMR voxel solver & gravity formula evaluator (Formulas 1-5 & variations)
//   - hud.js / hud.css      : 2D canvas HUD charts (Surface Brightness & Radial Acceleration) and 3D component/scale controls

// Calc 1/16th Diagonal Wedge (0 <= j <= i, k >= 0) (half of octant1) for Visualization (copy over to all 8 octants)
// Calc 1 Octant (x >= 0, y >= 0, z >= 0) for Vector Gravity (important: evaluates x - testp.x and -x - testp.x)

// ═══════════════════════════════════════════════════════════════════════════
// 1. GALAXY SELECTION & URL QUERY PARSING
// ═══════════════════════════════════════════════════════════════════════════

var rgrid100 = 100;
var galaxieslist = Object.keys(galaxiesobj);

var thegal = galaxieslist[Math.floor(Math.random() * galaxieslist.length)];
if (typeof window !== 'undefined' && window.location && window.location.search) {
    var urlParams = new URLSearchParams(window.location.search);
    var urlGal = urlParams.get('gal') || urlParams.get('galaxy') || urlParams.get('name') || decodeURIComponent(window.location.search.slice(1));
    if (urlGal && galaxiesobj[urlGal]) thegal = urlGal;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. MONOTONIC CUBIC PIECEWISE INTERPOLATION & 1-OCTANT AMR GRID ITERATOR
// ═══════════════════════════════════════════════════════════════════════════

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

// Evaluate monotonic cubic piecewise polynomial on normalized interval t in [0, 1].
function eval_monotonic_cubic_piecewise(v0, v1, h, mk, mk1, t) {
    var t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * mk + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * mk1;
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

// Solve an m x (m + 1) augmented linear system M in-place via Gaussian elimination with partial pivoting.
function solve_gaussian_linear_system(M) {
    var m = M.length;
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

// Iterate over all 1-octant (x >= 0, y >= 0) AMR horizontal sub-columns within r_grid <= rgridmax.
// Calls callback(x, y, R, area_sym, S, r_grid) for each sub-column, where area_sym = sub_area * sym_y
// includes the y = 0 boundary half-weight (0.5) for y >= 0 -> ±y symmetry, while x > 0 is mirrored
// into (+x, -x) during gravity evaluation in compute_voxel_grav_moments_x.
function for_each_1octant_amr_subcol(rgridmax, voxellen, get_S_fn, callback) {
    for (var i = 0; i <= rgridmax; i++) {
        for (var j = 0; j <= rgridmax; j++) {
            var r_grid = Math.hypot(i, j);
            if (r_grid > rgridmax) continue;

            var S = get_S_fn(r_grid, i, j);
            var sub_len = voxellen / S;
            var sub_area = sub_len * sub_len;
            var si_start = (i === 0) ? Math.floor(S / 2) : 0;
            var sj_start = (j === 0) ? Math.floor(S / 2) : 0;

            for (var si = si_start; si < S; si++) {
                var ox = (si + 0.5) / S - 0.5;
                var x = (i === 0 && Math.abs(ox) < 1e-9) ? 0 : (i + ox) * voxellen;
                for (var sj = sj_start; sj < S; sj++) {
                    var oy = (sj + 0.5) / S - 0.5;
                    var is_y0 = (j === 0 && Math.abs(oy) < 1e-9);
                    var y = is_y0 ? 0 : (j + oy) * voxellen;
                    var R = Math.hypot(x, y);
                    var sym_y = is_y0 ? 0.5 : 1.0;
                    callback(x, y, R, sub_area * sym_y, S, r_grid);
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 1-OCTANT SIMULATION & 1/16TH-WEDGE VISUALIZATION VOXEL BUFFERS
// ═══════════════════════════════════════════════════════════════════════════

// Growable flat Float64Array buffer for 1-octant (x >= 0, y >= 0, z >= 0) gravity simulation voxels.
// Each voxel occupies 4 consecutive Float64 elements: [x, y, z, mass].
function create_sim_voxel_buffer(initialCapacity) {
    var cap = initialCapacity || 16384;
    return {
        data: new Float64Array(cap * 4),
        length: 0,
        capacity: cap
    };
}

function push_sim_voxel(buf, x, y, z, mass) {
    var n = buf.length;
    if (n >= buf.capacity) {
        var newCap = buf.capacity * 2;
        var next = new Float64Array(newCap * 4);
        next.set(buf.data);
        buf.data = next;
        buf.capacity = newCap;
    }
    var idx = n * 4;
    var data = buf.data;
    data[idx] = x;
    data[idx + 1] = y;
    data[idx + 2] = z;
    data[idx + 3] = mass;
    buf.length = n + 1;
}

function finalize_sim_voxel_buffer(buf) {
    var n4 = buf.length * 4;
    return {
        data: n4 === buf.data.length ? buf.data : buf.data.slice(0, n4),
        length: buf.length
    };
}

function concat_sim_voxel_buffers(bufA, bufB) {
    var lenA = bufA ? bufA.length : 0;
    var lenB = bufB ? bufB.length : 0;
    var total = lenA + lenB;
    var merged = new Float64Array(total * 4);
    if (lenA > 0) merged.set(bufA.data, 0);
    if (lenB > 0) merged.set(bufB.data, lenA * 4);
    return {
        data: merged,
        length: total
    };
}

// Growable staging buffer for 1/16th-wedge (0 <= j <= i, k >= 0) visualization voxel entries.
// Tracks exact 3D symmetric voxel multiplicity so final Int16Array/Float32Array buffers are allocated once at exact size.
function create_viz_voxel_buffer(initialWedgeCapacity) {
    var cap = initialWedgeCapacity || 8192;
    return {
        coords: new Int16Array(cap * 3),
        rhos: new Float64Array(cap),
        length: 0,
        capacity: cap,
        totalVoxels: 0
    };
}

// Record a 1/16th-wedge voxel (0 <= j <= i, k >= 0) if its quantized brightness round((rho / rho_peak) * 255) > 0.
function push_wedge_viz_voxel(wbuf, i, j, k, rho, rho_peak) {
    if (rho_peak <= 0 || Math.round((rho / rho_peak) * 255) <= 0) return;
    var n = wbuf.length;
    if (n >= wbuf.capacity) {
        var newCap = wbuf.capacity * 2;
        var nextCoords = new Int16Array(newCap * 3);
        nextCoords.set(wbuf.coords);
        var nextRhos = new Float64Array(newCap);
        nextRhos.set(wbuf.rhos);
        wbuf.coords = nextCoords;
        wbuf.rhos = nextRhos;
        wbuf.capacity = newCap;
    }
    var cIdx = n * 3;
    wbuf.coords[cIdx] = i;
    wbuf.coords[cIdx + 1] = j;
    wbuf.coords[cIdx + 2] = k;
    wbuf.rhos[n] = rho;
    wbuf.length = n + 1;

    var multXY = i === 0 ? 1 : (j === 0 || i === j ? 4 : 8);
    var multZ = k === 0 ? 1 : 2;
    wbuf.totalVoxels += multXY * multZ;
}

// Helper to emit all (±x, ±y, ±z) sign permutations for an unsigned (x >= 0, y >= 0, z >= 0) tuple.
function emit_octant_permutations(pos, rhos, offset, x, y, z, rhoFloat) {
    var nx = x === 0 ? 1 : 2;
    var ny = y === 0 ? 1 : 2;
    var nz = z === 0 ? 1 : 2;
    for (var sx = 0; sx < nx; sx++) {
        var vx = sx === 0 ? x : -x;
        for (var sy = 0; sy < ny; sy++) {
            var vy = sy === 0 ? y : -y;
            for (var sz = 0; sz < nz; sz++) {
                var vz = sz === 0 ? z : -z;
                var pIdx = offset * 3;
                pos[pIdx] = vx;
                pos[pIdx + 1] = vy;
                pos[pIdx + 2] = vz;
                rhos[offset] = rhoFloat;
                offset++;
            }
        }
    }
    return offset;
}

// Sort 1/16th-wedge entries in descending order of rho (via O(M) 1024-bin bucket sort + insertion sort)
// and expand each wedge entry into all 16 symmetric (±i, ±j, ±k) / (±j, ±i, ±k) voxels in exact-sized Int16Array/Float32Array buffers.
function finalize_viz_voxel_buffer(wbuf, rho_peak) {
    var M = wbuf.length;
    var total = wbuf.totalVoxels;
    var positions = new Int16Array(total * 3);
    var rhos = new Float32Array(total);
    if (M === 0 || total === 0) {
        return { positions: positions, rhos: rhos, length: 0, sorted: true };
    }

    var coords = wbuf.coords;
    var wRhos = wbuf.rhos;
    var BINS = 1024;
    var counts = new Int32Array(BINS);
    var bucketOf = new Uint16Array(M);
    var scale = (rho_peak && rho_peak > 0) ? ((BINS - 1) / rho_peak) : 0;

    for (var idx = 0; idx < M; idx++) {
        var b = scale > 0 ? Math.min(BINS - 1, Math.max(0, (BINS - 1) - ((wRhos[idx] * scale) | 0))) : 0;
        bucketOf[idx] = b;
        counts[b]++;
    }

    var offsets = new Int32Array(BINS);
    var sum = 0;
    for (var b = 0; b < BINS; b++) {
        offsets[b] = sum;
        sum += counts[b];
    }

    var order = new Int32Array(M);
    for (var idx = 0; idx < M; idx++) {
        var b = bucketOf[idx];
        order[offsets[b]++] = idx;
    }

    // Insertion-sort within each bucket so order is strictly non-increasing in rho
    var start = 0;
    for (var b = 0; b < BINS; b++) {
        var end = start + counts[b];
        for (var p = start + 1; p < end; p++) {
            var cur = order[p];
            var curRho = wRhos[cur];
            var q = p - 1;
            while (q >= start && wRhos[order[q]] < curRho) {
                order[q + 1] = order[q];
                q--;
            }
            order[q + 1] = cur;
        }
        start = end;
    }

    var outOffset = 0;
    for (var s = 0; s < M; s++) {
        var wIdx = order[s];
        var cIdx = wIdx * 3;
        var i = coords[cIdx];
        var j = coords[cIdx + 1];
        var k = coords[cIdx + 2];
        var rhoFloat = Math.fround(wRhos[wIdx]);
        outOffset = emit_octant_permutations(positions, rhos, outOffset, i, j, k, rhoFloat);
        if (j < i) {
            outOffset = emit_octant_permutations(positions, rhos, outOffset, j, i, k, rhoFloat);
        }
    }

    return {
        positions: positions,
        rhos: rhos,
        length: outOffset,
        sorted: true
    };
}

// Accumulate 1/16th-wedge (0 <= j <= i) z-column mass density sum into galaxyobj so rho_common_peak is tracked in O(1).
function add_octant_col_rho(galaxyobj, i, j, col_rho) {
    var stride = rgrid100 + 1;
    if (i < 0 || j < 0 || i >= stride || j >= stride) return;
    if (!galaxyobj.octant_col_sums) {
        galaxyobj.octant_col_sums = new Float64Array(stride * stride);
    }
    var idx = i * stride + j;
    var s = galaxyobj.octant_col_sums[idx] + col_rho;
    galaxyobj.octant_col_sums[idx] = s;
    if (!galaxyobj.rho_common_peak || s > galaxyobj.rho_common_peak) {
        galaxyobj.rho_common_peak = s;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 3D VECTOR-PROJECTED GRAVITY SOLVER & MOMENT INTERPOLATION
// ═══════════════════════════════════════════════════════════════════════════

var ZERO_GRAV_MOMENTS = { 'GM/r^2': 0, 'GM/r': 0, 'GM': 0, 'GMr': 0, 'GMr^2': 0 };
var GRAV_MOMENT_KEYS = ['GM/r^2', 'GM/r', 'GM', 'GMr', 'GMr^2'];

// Store a component's 3D vector-projected gravity moments on a radial datum and set its classic simulated acceleration.
function store_component_grav_moments(datum, comp_suffix, mom) {
    datum['a_classic_' + comp_suffix + '_sim'] = mom['GM/r^2'];
    datum['grav_moments_' + comp_suffix] = mom;
}

// Linearly interpolate between two 3D vector-projected gravity moment objects m0 and m1.
function lerp_grav_moments(m0, m1, frac) {
    var w0 = 1 - frac, out = {};
    for (var i = 0; i < GRAV_MOMENT_KEYS.length; i++) {
        var k = GRAV_MOMENT_KEYS[i];
        out[k] = w0 * m0[k] + frac * m1[k];
    }
    return out;
}

// Compute inward radial 3D vector-projected gravity sums at test position (x_eval, 0, 0)
// from 1-octant (x >= 0, y >= 0, z >= 0) simulation voxels by evaluating both +x and (when x > 0) -x
// and multiplying by 4 to account for all 8 octants (±y, ±z symmetry):
//   'GM/r^2' = -4 * sum( (G * m / dist^2) * dir_x )   [m/s^2]   (Classic 1/d^2 acceleration)
//   'GM/r'   = -4 * sum( (G * m / dist)   * dir_x )   [m^2/s^2] (3D 1/d logarithmic-potential force sum)
//   'GM'     = -4 * sum( (G * m)          * dir_x )   [m^3/s^2] (3D Mannheim constant-force / vector-mass sum)
//   'GMr'    = -4 * sum( (G * m * dist)   * dir_x )   [m^4/s^2] (3D linear-distance / horizon-dipole sum)
//   'GMr^2'  = -4 * sum( (G * m * dist^2) * dir_x )   [m^5/s^2] (3D quadratic-distance vector sum)
function compute_voxel_grav_moments_x(voxels_sim, x_eval, cut) {
    if (!voxels_sim || !voxels_sim.data || voxels_sim.length === 0) return ZERO_GRAV_MOMENTS;
    if (!voxels_sim._momCache) voxels_sim._momCache = Object.create(null);
    var cacheKey = x_eval + '|' + cut;
    var cached = voxels_sim._momCache[cacheKey];
    if (cached) return cached;

    var sum_gm_r2 = 0, sum_gm_r = 0, sum_gm = 0, sum_gmr = 0, sum_gmr2 = 0;
    var data = voxels_sim.data;
    var n4 = voxels_sim.length * 4;

    for (var idx = 0; idx < n4; idx += 4) {
        var x = data[idx];
        var dy = data[idx + 1];
        var dz = data[idx + 2];
        var gm = G * data[idx + 3];
        var in_yz_cut = (dy < cut && dz < cut);
        var dy2_dz2 = dy * dy + dz * dz;

        // Evaluate +x octant (s = 0) and, when x > 0, -x octant (s = 1)
        var nx = x > 0 ? 2 : 1;
        for (var s = 0; s < nx; s++) {
            var dx = (s === 0 ? x : -x) - x_eval;
            if (in_yz_cut && Math.abs(dx) < cut) continue;
            var dist2 = dx * dx + dy2_dz2;
            var dist = Math.sqrt(dist2);
            var gm_x = gm * (dx / dist);

            // var mag = G * vox.mass / dist2;
            // dir.copy(vox.p).sub(testp).normalize();
            // accel.add(dir.multiplyScalar(mag));
            // accel_x += mag * dir_x;
            // return -4 * accel_x;

            sum_gm_r2 += gm_x / dist2;
            sum_gm_r  += gm_x / dist;
            sum_gm    += gm_x;
            sum_gmr   += gm_x * dist;
            sum_gmr2  += gm_x * dist2;
        }
    }

    var res = {
        'GM/r^2': -4 * sum_gm_r2,
        'GM/r':   -4 * sum_gm_r,
        'GM':     -4 * sum_gm,
        'GMr':    -4 * sum_gmr,
        'GMr^2':  -4 * sum_gmr2
    };
    voxels_sim._momCache[cacheKey] = res;
    return res;
}

// Evaluate 3D vector-projected gravity sums { 'GM/r^2', 'GM/r', 'GM', 'GMr' } at radius r_k (in meters)
// by linearly interpolating between the two bracketing AMR sub-voxel centers x0 = i0 * h_test and x1 = i1 * h_test.
function eval_bracketed_grav_moments_h(voxels_sim, r_k, h_test) {
    var u_rk = r_k / h_test;
    var i0 = Math.floor(u_rk), i1 = i0 + 1;
    var frac = u_rk - i0;
    var cut = 1.5 * h_test;

    var m0 = i0 > 0 ? compute_voxel_grav_moments_x(voxels_sim, i0 * h_test, cut) : ZERO_GRAV_MOMENTS;
    var m1 = compute_voxel_grav_moments_x(voxels_sim, i1 * h_test, cut);

    return lerp_grav_moments(m0, m1, frac);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. RADIAL ACCELERATION BENCHMARKING & TOTAL BARYONIC AGGREGATION
// ═══════════════════════════════════════════════════════════════════════════

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

        var m_dsk = d.grav_moments_dsk;
        var m_blg = hasBlg ? d.grav_moments_blg : null;
        var m_gas = d.grav_moments_gas;
        if (m_dsk || m_blg || m_gas) {
            for (var mi = 0; mi < GRAV_MOMENT_KEYS.length; mi++) {
                var mk = GRAV_MOMENT_KEYS[mi];
                d[mk] = (m_dsk ? m_dsk[mk] : 0) + (m_blg ? m_blg[mk] : 0) + (m_gas ? m_gas[mk] : 0);
            }
        }
    }

    log_accel_diff_table(galaxyobj, 'a_classic_tot', 'a_classic_tot_sim');
}
