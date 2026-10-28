// ═══════════════════════════════════════════════════════════════════════════
// 1. MERGED 1-OCTANT HIGH-RESOLUTION AMR VOXEL BUILDER (DISK + BULGE + GAS)
// ═══════════════════════════════════════════════════════════════════════════

// Build a single merged 1-octant (x >= 0, y >= 0, z >= 0) high-resolution AMR voxel buffer
// combining stellar disk, spherical bulge (if present), and flared gas disk into galaxyobj.voxels_tot_sim.
function build_sim_voxels_tot(galaxyobj) {
    if (!galaxyobj && typeof galaxiesobj !== 'undefined' && typeof thegal !== 'undefined') {
        galaxyobj = galaxiesobj[thegal];
    }
    if (!galaxyobj) return { data: new Float64Array(0), length: 0 };

    var rmax = galaxyobj.rmax;
    var voxellen = rmax / rgrid100;
    var r_efold = get_r_dsk_efold(galaxyobj);
    var r_efold_grid = r_efold / voxellen;
    var outer_L = get_outer_taper_length(galaxyobj, r_efold);
    var rgridmax_dsk = Math.ceil((rmax + outer_L) / voxellen);
    var rgridmax_gas = 115;
    var rgridmax = Math.max(rgridmax_dsk, rgridmax_gas);

    var z_dsk = get_z_dsk(galaxyobj);
    var z_data = build_z_profiles(z_dsk, voxellen);
    var sim_profiles_dsk = z_data.sim_profiles;

    // Ensure gas surface density profile sigma_gas(R) is initialized from GAS_SIGMA_NODES (or fallback NNLS)
    if (!galaxyobj.gas_sigma_nodes) {
        if (!init_gas_profile(galaxyobj)) {
            build_sim_voxels_gas(galaxyobj);
        }
    }

    var conv_dsk = (Msun / Lsun) * coeff_dsk;
    var dskgas_buf = create_sim_voxel_buffer(32768);

    // 1. Merged 1-octant AMR horizontal grid for stellar disk + flared gas disk
    for_each_1octant_amr_subcol(
        rgridmax,
        voxellen,
        function (r_grid) {
            var S_dsk = r_grid <= rgridmax_dsk ? get_amr_dsk(r_grid, r_efold_grid) : 1;
            var S_gas = r_grid <= rgridmax_gas ? get_amr_gas(r_grid) : 1;
            return Math.max(S_dsk, S_gas);
        },
        function (x, y, R, area_sym, S, r_grid) {
            var S_dsk_prof = Math.min(9, S);
            var z_list_dsk = sim_profiles_dsk[S_dsk_prof];
            var dsk_has_z0 = z_list_dsk.length > 0 && z_list_dsk[0].z < 1e-9;

            var sb_d = r_grid <= rgridmax_dsk ? interpolate_sb_dsk(R, galaxyobj) : 0;
            var col_dsk = sb_d > 0 ? (sb_d * area_sym * conv_dsk) : 0;

            var sig_g = r_grid <= rgridmax_gas ? interpolate_sigma_gas(R, galaxyobj) : 0;
            var col_gas = sig_g > 0 ? (area_sym * sig_g) : 0;

            if (col_dsk <= 0 && col_gas <= 0) return;

            // Merge midplane (z = 0) disk + gas voxel mass at identical (x, y, 0)
            var m_z0 = (col_dsk > 0 && dsk_has_z0 ? col_dsk * z_list_dsk[0].w_half : 0) +
                       (col_gas > 0 ? col_gas * GAS_W_LAYERS[0] : 0);
            if (m_z0 > 0) {
                push_sim_voxel(dskgas_buf, x, y, 0, m_z0);
            }

            // Upper disk sech²(z / z_dsk) layers (z > 0)
            if (col_dsk > 0) {
                for (var idx = dsk_has_z0 ? 1 : 0; idx < z_list_dsk.length; idx++) {
                    var zl = z_list_dsk[idx];
                    push_sim_voxel(dskgas_buf, x, y, zl.z, col_dsk * zl.w_half);
                }
            }

            // Upper flared gas sech²(z / z_gas(R)) layers (z > 0)
            if (col_gas > 0) {
                var z_gas = get_z_gas(R, galaxyobj);
                for (var l = 1; l < GAS_U_LAYERS.length; l++) {
                    push_sim_voxel(dskgas_buf, x, y, GAS_U_LAYERS[l] * z_gas, col_gas * GAS_W_LAYERS[l]);
                }
            }
        }
    );

    var dskgas_voxels = finalize_sim_voxel_buffer(dskgas_buf);
    galaxyobj.voxels_dskgas_sim = dskgas_voxels;

    // 2. Append 3D spherical AMR bulge sub-voxels (for the 29 galaxies with has_blg === true)
    var sim_voxels = dskgas_voxels;
    if (galaxyobj.has_blg) {
        var blg_voxels = galaxyobj.voxels_blg_sim || build_sim_voxels_blg(galaxyobj);
        sim_voxels = concat_sim_voxel_buffers(dskgas_voxels, blg_voxels);
    }

    galaxyobj.voxellen_tot = voxellen;
    galaxyobj.r_efold_grid_tot = r_efold_grid;
    return (galaxyobj.voxels_tot_sim = sim_voxels);
}


// ═══════════════════════════════════════════════════════════════════════════
// 2. 3D VOXEL VECTOR-PROJECTED GRAVITY SUMS (GM/r^2, GM/r, GM, GMr)
// ═══════════════════════════════════════════════════════════════════════════

// Bracket radius r_k between adjacent disk/gas AMR sub-voxel centers x0 and x1 and linearly interpolate
// the 3D vector-projected gravity sums { 'GM/r^2', 'GM/r', 'GM', 'GMr' } using eval_bracketed_grav_moments_h from logic.js.
function eval_bracketed_grav_moments(voxels_sim, r_k, voxellen, r_efold_grid) {
    var r_grid = r_k / voxellen;
    var S_test = Math.max(get_amr_dsk(r_grid, r_efold_grid), get_amr_gas(r_grid));
    return eval_bracketed_grav_moments_h(voxels_sim, r_k, voxellen / S_test);
}

// Compute and cache 3D voxel gravity sums across all radial data points of galaxyobj.
// Evaluates disk+gas voxels on the merged disk/gas AMR bracket (cut = 1.5 * h_test) and,
// for galaxies with has_blg === true, evaluates spherical bulge voxels on the bulge AMR bracket (cut = 0.5 * h_blg).
function eval_galaxy_grav_moments(galaxyobj) {
    if (!galaxyobj.voxels_dskgas_sim) {
        build_sim_voxels_tot(galaxyobj);
    }
    var voxels_dskgas = galaxyobj.voxels_dskgas_sim;
    var voxels_blg = galaxyobj.has_blg ? (galaxyobj.voxels_blg_sim || build_sim_voxels_blg(galaxyobj)) : null;
    var voxellen = galaxyobj.voxellen_tot || (galaxyobj.rmax / rgrid100);
    var r_efold_grid = galaxyobj.r_efold_grid_tot || (get_r_dsk_efold(galaxyobj) / voxellen);
    var rd = galaxyobj.radiusdata;

    for (var k = 0; k < rd.length; k++) {
        var Rk = rd[k]['r'];
        var mom = eval_bracketed_grav_moments(voxels_dskgas, Rk, voxellen, r_efold_grid);
        var mom_blg = voxels_blg ? eval_bracketed_grav_moments_blg(voxels_blg, Rk, galaxyobj.voxellen_blg) : null;
        for (var mi = 0; mi < GRAV_MOMENT_KEYS.length; mi++) {
            var mk = GRAV_MOMENT_KEYS[mi];
            rd[k][mk] = mom[mk] + (mom_blg ? mom_blg[mk] : 0);
        }
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// 3. GRAVITY FORMULA TRIALS (FORMULAS 1 THROUGH 5 & a-TERM VARIATIONS)
// ═══════════════════════════════════════════════════════════════════════════
// Physical constants (CSPEED, G, H, a0) are defined in lib.js.

// Mannheim Conformal Gravity constants in SI units:
//   accel = GM/r^2 + (gamma_M / G) * GM + g0_M - kappa_M * r
var GAMMA_MANNHEIM = 1.23e-52; // m / (s^2 * kg)
var G0_MANNHEIM = 1.38e-11;    // m / s^2
var KAPPA_MANNHEIM = 8.57e-33; // 1 / s^2

// Formula 4 (Pairwise 4-Parameter Mass-Moment Laurent/Taylor Polynomial):
//   a_4 = GM/r^2 + k1 GM/r + k2 GM + k3 GMr + k4 GMr^2
//   Per voxel i: a_i = G * m_i * (1/d_i^2 + k1/d_i + k2 + k3*d_i + k4*d_i^2) * (-dir_x)
// Optimal parameters [k1..k4] fitted on r > 0.2 * rmax (2,350 radial points across 175 galaxies):
var K_F4 = [
     5.4308e-21,  // k1 * GM/r   [m^-1]
    -5.8129e-42,  // k2 * GM     [m^-2]
     3.0688e-63,  // k3 * GMr    [m^-3]
    -5.0422e-85   // k4 * GMr^2  [m^-4]
];

// Best-fit Formula 4 [k1..k4] coefficients (fitted on r > 0.2 * rmax) for each test group:
var F4_COEFFS_BY_GROUP = {
    all:   K_F4,
    vflat: [4.9723e-21, -5.0036e-42,  2.7130e-63, -4.6054e-85],
    conc:  [2.6450e-21,  2.3626e-42, -2.0514e-63,  3.5622e-85]
};

// Formula 1: Classic 3D Voxel Gravity
//   a_1 = -4 * sum( (G * m_i / d_i^2) * dir_x ) = GM/r^2
function eval_grav_formula1(d) {
    return d['GM/r^2'];
}

// Formula 2: MOND (Milgrom 1983 / McGaugh et al. 2016 Radial Acceleration Relation)
//   a_2 = a_N / (1 - exp(-sqrt(a_N / a0))), where a_N = GM/r^2
function eval_grav_formula2(d) {
    var a_N = d['GM/r^2'];
    if (a_N <= 0) return a_N;
    return a_N / (1 - Math.exp(-Math.sqrt(a_N / a0)));
}

// Formula 3: Mannheim Conformal Gravity (3D Voxel Vector Sum)
//   a_3 = GM/r^2 + (gamma_M / G) * GM + g0_M - kappa_M * r
// where (gamma_M / G) * GM = -4 * sum( gamma_M * m_i * dir_x ) is the 3D vector-projected linear potential force.
function eval_grav_formula3(d) {
    return d['GM/r^2'] + (GAMMA_MANNHEIM / G) * d['GM'] + G0_MANNHEIM - KAPPA_MANNHEIM * d['r'];
}

// Formula 4: Pairwise 5-Term GM Polynomial (4 free parameters k1..k4)
//   a_4 = GM/r^2 + k1 GM/r + k2 GM + k3 GMr + k4 GMr^2
function eval_grav_formula4_k(d, k) {
    return d['GM/r^2']
        + k[0] * d['GM/r']
        + k[1] * d['GM']
        + k[2] * d['GMr']
        + k[3] * d['GMr^2'];
}

function eval_grav_formula4(d) {
    return eval_grav_formula4_k(d, K_F4);
}

// Formula 5 Basic: Simple Acceleration-Coupled Formula (zero free parameters, x = a / a0)
//   Pairwise:  a_i = (G * m_i / d_i^2) * (1 + 1/x) * (-dir_x),  where x = a / a0
//   Voxel sum: a_5 = (GM/r^2) * (1 + a0 / a_5)  =>  a_5 = 0.5 * (GM/r^2 + sqrt((GM/r^2)^2 + 4 * a0 * (GM/r^2)))
function eval_grav_formula5(d) {
    var gmr2 = d['GM/r^2'];
    if (gmr2 <= 0) return gmr2;
    return 0.5 * (gmr2 + Math.sqrt(gmr2 * gmr2 + 4 * a0 * gmr2));
}

// Solve self-consistent acceleration equation a = gmr2 * (1 + boostFn(a / a0)) via 52-step bisection
function solve_self_consistent_a(gmr2, boostFn) {
    if (gmr2 <= 0) return gmr2;
    var lo = gmr2, hi = 0.5 * (gmr2 + Math.sqrt(gmr2 * gmr2 + 4 * a0 * gmr2));
    for (var it = 0; it < 52; it++) {
        var mid = 0.5 * (lo + hi);
        if (gmr2 * (1 + boostFn(mid / a0)) > mid) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
}

// Formula 5 Planck Screening: 1 / (e^x - 1) replacement of 1/x, where x = a / a0
//   Voxel sum: a = (GM/r^2) * (1 + 1 / (exp(a / a0) - 1)) = (GM/r^2) / (1 - exp(-a / a0))
function eval_grav_formula5_planck(d) {
    return solve_self_consistent_a(d['GM/r^2'], function (x) { return x > 50 ? 0 : 1 / (Math.exp(x) - 1); });
}

// Formula 5 Wien Exponential Screening: e^-x / x, where x = a / a0
//   Voxel sum: a = (GM/r^2) * (1 + (a0 / a) * exp(-a / a0))
function eval_grav_formula5_wien(d) {
    return solve_self_consistent_a(d['GM/r^2'], function (x) { return Math.exp(-x) / x; });
}

// Formula 5 Rational Cushion: 1 / (x * (1 + x)), where x = a / a0
//   Voxel sum: a = (GM/r^2) * (1 + a0^2 / (a * (a0 + a)))
function eval_grav_formula5_rat(d) {
    return solve_self_consistent_a(d['GM/r^2'], function (x) { return 1 / (x * (1 + x)); });
}

// Central Gravity Formula Sandbox Registry (single source of truth for logic_grav, generators, and dashboards)
var GRAV_FORMULA_REGISTRY = {
    f1: {
        key: 'f1',
        aField: 'a_grav1',
        diffField: 'diff_grav1',
        tableCol: 'F1_Classic',
        color: '#ef4444',
        name: 'Formula 1: Classic GM/r\u00b2',
        d3Name: 'F1 Classic Reference: GM/d\u00b2 (No a-Term)',
        short: 'F1: Classic',
        d3Short: 'F1: Classic GM/d\u00b2',
        btnHtml: 'F1: Classic GM/d&sup2;',
        thHtml: 'F1 Classic Med',
        d3ThHtml: 'F1 Classic GM/d&sup2;',
        ptThHtml: 'F1 diff',
        metaLabel: 'F1',
        bestLabel: 'F1 Classic',
        eq: 'a\u2081 = GM/r\u00b2 = -4 \u2211 (G m\u1d62 / d\u1d62\u00b2) dir_x',
        evalFn: eval_grav_formula1
    },
    f2: {
        key: 'f2',
        aField: 'a_grav2',
        diffField: 'diff_grav2',
        tableCol: 'F2_MOND',
        color: '#f59e0b',
        name: 'Formula 2: MOND (RAR with a\u2080)',
        short: 'F2: MOND',
        btnHtml: 'F2: MOND (RAR)',
        thHtml: 'F2 MOND Med',
        ptThHtml: 'F2 MOND',
        metaLabel: 'F2 MOND',
        bestLabel: 'F2 MOND',
        eq: 'a\u2082 = (GM/r\u00b2) / (1 - exp(-\u221a((GM/r\u00b2) / a\u2080))),  a\u2080 = c\u00b2/(2\u03c0 c/H) = 1.094e-10 m/s\u00b2',
        evalFn: eval_grav_formula2
    },
    f3: {
        key: 'f3',
        aField: 'a_grav3',
        diffField: 'diff_grav3',
        tableCol: 'F3_Mannheim',
        color: '#3b82f6',
        name: 'Formula 3: Mannheim Conformal (3 params)',
        short: 'F3: Mannheim',
        btnHtml: 'F3: Mannheim',
        thHtml: 'F3 Mannheim Med',
        ptThHtml: 'F3 Mann',
        metaLabel: 'F3 Mann',
        bestLabel: 'F3 Mannheim',
        eq: 'a\u2083 = GM/r\u00b2 + k\u2081GM + k\u2082 + k\u2083r_galaxy  [k\u2081=1.84e-42, k\u2082=1.38e-11, k\u2083=-8.57e-33]',
        evalFn: eval_grav_formula3
    },
    f4: {
        key: 'f4',
        aField: 'a_grav4',
        diffField: 'diff_grav4',
        tableCol: 'F4_PolyGM',
        color: '#14b8a6',
        name: 'Formula 4: Pairwise GM Polynomial (4 params)',
        short: 'F4: GM Poly (4p)',
        btnHtml: 'F4: GM Poly (4p)',
        thHtml: 'F4 GM Poly (4p)',
        ptThHtml: 'F4 Poly',
        metaLabel: 'F4 Poly',
        bestLabel: 'F4 Poly',
        eq: 'a\u2084 = GM/r\u00b2 + k\u2081GM/r + k\u2082GM + k\u2083GMr + k\u2084GMr\u00b2',
        eqByGroup: {
            all:   'a\u2084 = GM/r\u00b2 + k\u2081GM/r + k\u2082GM + k\u2083GMr + k\u2084GMr\u00b2  [All 175 r>0.2 fit: k\u2081=5.43e-21, k\u2082=-5.81e-42, k\u2083=3.07e-63, k\u2084=-5.04e-85]',
            vflat: 'a\u2084 = GM/r\u00b2 + k\u2081GM/r + k\u2082GM + k\u2083GMr + k\u2084GMr\u00b2  [gal_vflat r>0.2 fit: k\u2081=4.97e-21, k\u2082=-5.00e-42, k\u2083=2.71e-63, k\u2084=-4.61e-85]',
            conc:  'a\u2084 = GM/r\u00b2 + k\u2081GM/r + k\u2082GM + k\u2083GMr + k\u2084GMr\u00b2  [conc r>0.2 fit: k\u2081=2.65e-21, k\u2082=2.36e-42, k\u2083=-2.05e-63, k\u2084=3.56e-85]'
        },
        evalFn: eval_grav_formula4,
        evalGroupFn: function (d, grp) {
            return eval_grav_formula4_k(d, F4_COEFFS_BY_GROUP[grp] || K_F4);
        }
    },
    f5: {
        key: 'f5',
        aField: 'a_grav5',
        diffField: 'diff_grav5',
        tableCol: 'F5_Accel',
        color: '#a855f7',
        name: 'Formula 5: Accel-Term (1 + a\u2080/a, 1 param)',
        d3Name: 'F5 Basic (1/x): 1 + a\u2080/a  [x = a/a\u2080]',
        short: 'F5: Accel 1+a0/a',
        d3Short: 'F5 Basic (a\u2080/a)',
        btnHtml: 'F5: Accel (1+a0/a)',
        d3BtnHtml: 'F5 Basic: 1/x (a<sub>0</sub>/a)',
        thHtml: 'F5 Accel (1+a0/a)',
        d3ThHtml: 'F5 Basic (a<sub>0</sub>/a)',
        ptThHtml: 'F5 Accel',
        d3PtThHtml: 'F5 (a<sub>0</sub>/a)',
        metaLabel: 'F5 Accel',
        d3MetaLabel: 'Basic 1/x',
        bestLabel: 'F5 Accel',
        d3BestLabel: 'F5 Basic (a0/a)',
        eq: 'a\u2085 = (GM/r\u00b2)(1 + a\u2080 / a\u2085) = \u00bd(GM/r\u00b2 + \u221a((GM/r\u00b2)\u00b2 + 4 a\u2080 (GM/r\u00b2)))',
        d3Eq: 'a = (GM/r\u00b2)(1 + 1/x) = (GM/r\u00b2)(1 + a\u2080/a) = \u00bd(GM/r\u00b2 + \u221a((GM/r\u00b2)\u00b2 + 4 a\u2080 (GM/r\u00b2)))',
        evalFn: eval_grav_formula5
    },
    f5_planck: {
        key: 'f5_planck',
        aField: 'a_grav5_planck',
        diffField: 'diff_grav5_planck',
        tableCol: 'F5_Planck',
        color: '#d8b4fe',
        name: 'F5 Planck Screening: 1/(e\u02e3 - 1)  [x = a/a\u2080]',
        short: 'F5 Planck 1/(e^x-1)',
        btnHtml: 'F5 Planck: 1/(e<sup>x</sup>&minus;1)',
        thHtml: 'F5 Planck 1/(e<sup>x</sup>&minus;1)',
        ptThHtml: 'Planck 1/(e<sup>x</sup>&minus;1)',
        metaLabel: 'Planck 1/(e^x-1)',
        bestLabel: 'F5 Planck 1/(e^x-1)',
        eq: 'a = (GM/r\u00b2)(1 + 1/(e^(a/a\u2080) - 1)) = (GM/r\u00b2) / (1 - e^(-a/a\u2080))',
        evalFn: eval_grav_formula5_planck
    },
    f5_wien: {
        key: 'f5_wien',
        aField: 'a_grav5_wien',
        diffField: 'diff_grav5_wien',
        tableCol: 'F5_Wien',
        color: '#e879f9',
        name: 'F5 Wien Exponential: e\u207b\u02e3 / x  [x = a/a\u2080]',
        short: 'F5 Wien e^-x/x',
        btnHtml: 'F5 Wien: e<sup>&minus;x</sup>/x',
        thHtml: 'F5 Wien e<sup>&minus;x</sup>/x',
        ptThHtml: 'Wien e<sup>&minus;x</sup>/x',
        metaLabel: 'Wien e^-x/x',
        bestLabel: 'F5 Wien e^-x/x',
        eq: 'a = (GM/r\u00b2)(1 + e\u207b\u02e3/x) = (GM/r\u00b2)(1 + (a\u2080/a) e^(-a/a\u2080))',
        evalFn: eval_grav_formula5_wien
    },
    f5_rat: {
        key: 'f5_rat',
        aField: 'a_grav5_rat',
        diffField: 'diff_grav5_rat',
        tableCol: 'F5_rat',
        color: '#7c3aed',
        name: 'F5 Rational: 1 / (x (1 + x))  [x = a/a\u2080]',
        short: 'F5 Rat 1/(x(1+x))',
        btnHtml: 'F5 Rat: 1/(x(1+x))',
        thHtml: 'F5 Rat 1/(x(1+x))',
        ptThHtml: 'Rat 1/(x(1+x))',
        metaLabel: 'Rat 1/(x(1+x))',
        bestLabel: 'F5 Rat 1/(x(1+x))',
        eq: 'a = (GM/r\u00b2)(1 + 1/(x(1 + x))) = (GM/r\u00b2)(1 + a\u2080\u00b2 / (a (a\u2080 + a)))',
        evalFn: eval_grav_formula5_rat
    }
};

var DASHBOARD2_FORMULA_KEYS = ['f5', 'f2', 'f4', 'f3', 'f1'];
var DASHBOARD3_FORMULA_KEYS = ['f5', 'f5_planck', 'f5_wien', 'f5_rat', 'f1'];

// Export serializable formula metadata for Dashboard 2 or Dashboard 3
function getDashboardFormulaMeta(formulaKeys, isD3) {
    var meta = {};
    for (var i = 0; i < formulaKeys.length; i++) {
        var fk = formulaKeys[i];
        var reg = GRAV_FORMULA_REGISTRY[fk];
        if (!reg) continue;
        meta[fk] = {
            key: fk,
            color: reg.color,
            name: (isD3 && reg.d3Name) ? reg.d3Name : reg.name,
            short: (isD3 && reg.d3Short) ? reg.d3Short : reg.short,
            btnHtml: (isD3 && reg.d3BtnHtml) ? reg.d3BtnHtml : reg.btnHtml,
            thHtml: (isD3 && reg.d3ThHtml) ? reg.d3ThHtml : reg.thHtml,
            ptThHtml: (isD3 && reg.d3PtThHtml) ? reg.d3PtThHtml : reg.ptThHtml,
            metaLabel: (isD3 && reg.d3MetaLabel) ? reg.d3MetaLabel : reg.metaLabel,
            bestLabel: (isD3 && reg.d3BestLabel) ? reg.d3BestLabel : reg.bestLabel,
            eq: (isD3 && reg.d3Eq) ? reg.d3Eq : reg.eq,
            eqByGroup: reg.eqByGroup || null
        };
    }
    return meta;
}

// Run all registered gravity formulas on galaxyobj and compare against observed acceleration datum['a'].
function logic_grav(galaxyobj) {
    if (!galaxyobj && typeof galaxiesobj !== 'undefined' && typeof thegal !== 'undefined') {
        galaxyobj = galaxiesobj[thegal];
    }
    if (!galaxyobj) return;

    var rd = galaxyobj.radiusdata;
    if (rd.length > 0 && rd[0]['GM/r^2'] === undefined) {
        eval_galaxy_grav_moments(galaxyobj);
    }

    var regKeys = Object.keys(GRAV_FORMULA_REGISTRY);
    var table = [];
    for (var k = 0; k < rd.length; k++) {
        var d = rd[k];
        var a_obs = d['a'];
        var row = {
            'r (m)': d['r'].toExponential(2),
            'a_obs': a_obs.toExponential(2)
        };
        for (var j = 0; j < regKeys.length; j++) {
            var reg = GRAV_FORMULA_REGISTRY[regKeys[j]];
            var a_pred = reg.evalFn(d);
            var diff_pct = a_obs > 0 ? ((a_pred - a_obs) / a_obs) * 100 : 0;
            d[reg.aField] = a_pred;
            d[reg.diffField] = diff_pct;
            row[reg.tableCol] = a_pred.toExponential(2) + ' (' + diff_pct.toFixed(1) + '%)';
        }
        table.push(row);
    }

    console.table(table);
}


// ═══════════════════════════════════════════════════════════════════════════
// 4. COEFFICIENT SOLVER (FORMULA 4) & MASS CONCENTRATION BUILDER
// ═══════════════════════════════════════════════════════════════════════════

// Compute the fraction of a galaxy's total 3D voxel mass (disk + bulge + gas)
// enclosed within a 3D galactocentric sphere of radius (r_frac * rmax).
function compute_galaxy_mass_concentration(galaxyobj, r_frac) {
    if (r_frac === undefined) r_frac = 0.20;
    var voxels = galaxyobj.voxels_tot_sim || build_sim_voxels_tot(galaxyobj);
    var r_cut = r_frac * galaxyobj.rmax;
    var r_cut2 = r_cut * r_cut;
    var m_inner = 0;
    var m_tot = 0;

    var data = voxels.data;
    var n4 = voxels.length * 4;
    for (var idx = 0; idx < n4; idx += 4) {
        var x = data[idx], y = data[idx + 1], z = data[idx + 2], m = data[idx + 3];
        var d2 = x * x + y * y + z * z;
        var m2 = x > 0 ? 2 * m : m;
        m_tot += m2;
        if (d2 <= r_cut2) {
            m_inner += m2;
        }
    }

    // Factor of 4 converts ±x sum (with y >= 0, z >= 0) to full 8-octant total mass (kg)
    return {
        name: galaxyobj.name,
        m_inner: 4 * m_inner,
        m_tot: 4 * m_tot,
        frac: m_tot > 0 ? (m_inner / m_tot) : 0
    };
}

// Build the gal_concentratedmass array by selecting all SPARC galaxies where
// at least `threshold` (default 0.70, the top 12 most centrally concentrated galaxies;
// max across all 175 galaxies is 0.833 for UGC02953 because extended HI gas reaches rmax)
// of the total 3D voxel mass lies within `r_frac * rmax` (default 0.20 * rmax).
function compute_gal_concentratedmass(threshold, r_frac) {
    if (threshold === undefined) threshold = 0.70;
    if (r_frac === undefined) r_frac = 0.20;
    var names = typeof galaxieslist !== 'undefined' ? galaxieslist : Object.keys(galaxiesobj);
    var results = [];

    for (var i = 0; i < names.length; i++) {
        var g = galaxiesobj[names[i]];
        var stats = compute_galaxy_mass_concentration(g, r_frac);
        if (stats.frac >= threshold) {
            results.push(stats);
        }
    }

    results.sort(function(a, b) { return a.name.localeCompare(b.name); });
    return results.map(function(r) { return r.name; });
}

// Fit Formula 4 coefficients [k1..k4] in:
//   a_4 = GM/r^2 + k1 GM/r + k2 GM + k3 GMr + k4 GMr^2
// using column-scaled Iteratively Reweighted Least Squares (IRLS).
// Optional `min_r_frac` (e.g. 0.2) restricts the fit to radial points with r > min_r_frac * rmax.
function fit_formula4_coeffs(galaxy_names, min_r_frac) {
    var names = galaxy_names || (typeof galaxieslist !== 'undefined' ? galaxieslist : Object.keys(galaxiesobj));
    var rFrac = min_r_frac || 0;
    var pts = [];

    for (var i = 0; i < names.length; i++) {
        var g = galaxiesobj[names[i]];
        if (!g) continue;
        var rd = g.radiusdata;
        if (rd.length > 0 && rd[0]['GMr^2'] === undefined) {
            eval_galaxy_grav_moments(g);
        }
        var rCut = rFrac * g.rmax;
        for (var k = 0; k < rd.length; k++) {
            var d = rd[k];
            if (d['a'] > 0 && d['r'] > rCut) {
                pts.push({
                    a_obs: d['a'],
                    gmr2: d['GM/r^2'],
                    phi: [d['GM/r'], d['GM'], d['GMr'], d['GMr^2']]
                });
            }
        }
    }

    var n = pts.length, m = 4;
    var scales = new Float64Array(m);
    for (var j = 0; j < m; j++) {
        var sumSq = 0;
        for (var pIdx = 0; pIdx < n; pIdx++) {
            var v = pts[pIdx].phi[j] / pts[pIdx].a_obs;
            sumSq += v * v;
        }
        scales[j] = Math.sqrt(sumSq / n) || 1;
    }

    var X = new Float64Array(n * m);
    var y = new Float64Array(n);
    for (var pIdx = 0; pIdx < n; pIdx++) {
        var invA = 1 / pts[pIdx].a_obs;
        y[pIdx] = (pts[pIdx].a_obs - pts[pIdx].gmr2) * invA;
        for (var j = 0; j < m; j++) {
            X[pIdx * m + j] = (pts[pIdx].phi[j] * invA) / scales[j];
        }
    }

    function solveWLS(weights) {
        var M = [];
        for (var j = 0; j < m; j++) {
            var row = new Float64Array(m + 1);
            row[j] = 1e-12;
            M.push(row);
        }
        for (var i = 0; i < n; i++) {
            var w = weights[i], off = i * m, yi = y[i];
            for (var j = 0; j < m; j++) {
                var wXj = w * X[off + j];
                M[j][m] += wXj * yi;
                for (var c = j; c < m; c++) M[j][c] += wXj * X[off + c];
            }
        }
        for (var j = 0; j < m; j++) {
            for (var c = 0; c < j; c++) M[j][c] = M[c][j];
        }
        return Array.from(solve_gaussian_linear_system(M));
    }

    var buf = new Float64Array(n);
    function evalMedPct(u) {
        for (var i = 0; i < n; i++) {
            var off = i * m, dot = 0;
            for (var j = 0; j < m; j++) dot += X[off + j] * u[j];
            buf[i] = Math.abs(dot - y[i]) * 100;
        }
        buf.sort();
        var mid = n >> 1;
        return (n % 2) ? buf[mid] : 0.5 * (buf[mid - 1] + buf[mid]);
    }

    var w = new Float64Array(n).fill(1);
    var u = solveWLS(w);
    for (var it = 0; it < 100; it++) {
        for (var i = 0; i < n; i++) {
            var off = i * m, dot = 0;
            for (var j = 0; j < m; j++) dot += X[off + j] * u[j];
            w[i] = Math.pow(Math.max(1e-3, Math.abs(dot - y[i])), -1.3);
        }
        u = solveWLS(w);
    }

    var bestMed = evalMedPct(u);
    var kOut = u.map(function (val, j) { return val / scales[j]; });
    return { k: kOut, ptMedPct: bestMed, nPts: n };
}
