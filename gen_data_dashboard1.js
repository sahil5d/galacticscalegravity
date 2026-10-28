// Node.js script to generate deploy/data_dashboard1.js from deploy/lib.js,
// deploy/data_sparcgalaxies.js, deploy/logic.js, deploy/logic_dsk.js, deploy/logic_blg.js, and deploy/logic_gas.js.
// Usage: node deploy/gen_data_dashboard1.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

for (const file of ['lib.js', 'data_sparcgalaxies.js', 'logic.js', 'logic_dsk.js', 'logic_blg.js', 'logic_gas.js', 'dashboard_common.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
}

const t0 = Date.now();
const origLog = console.log, origTable = console.table;
console.log = () => {};
console.table = () => {};

const DATA = galaxieslist.map(name => {
    const g = galaxiesobj[name];
    thegal = name;
    logic_dsk();
    if (g.has_blg) logic_blg();
    logic_gas();
    calc_diff_tot(g);

    const pts = g.radiusdata.map(d => {
        const ac_dsk = d.a_classic_dsk || 0, asim_dsk = d.a_classic_dsk_sim || 0;
        const ac_blg = g.has_blg ? (d.a_classic_blg || 0) : 0, asim_blg = g.has_blg ? (d.a_classic_blg_sim || 0) : 0;
        const ac_gas = d.a_classic_gas || 0, asim_gas = d.a_classic_gas_sim || 0;
        const ac_all = d.a_classic_tot, asim_all = d.a_classic_tot_sim;
        return {
            r: n4(d.r),
            sb_dsk: n4(d.sb_dsk), sb_blg: n4(d.sb_blg), sb_gas: n4(d.sb_gas), sb_tot: n4(d.sb_tot),
            ac_dsk: n4(ac_dsk), asim_dsk: n4(asim_dsk), pct_dsk: pctDiff(asim_dsk, ac_dsk),
            ac_blg: n4(ac_blg), asim_blg: n4(asim_blg), pct_blg: pctDiff(asim_blg, ac_blg),
            ac_gas: n4(ac_gas), asim_gas: n4(asim_gas), pct_gas: pctDiff(asim_gas, ac_gas),
            ac_all: n4(ac_all), asim_all: n4(asim_all), pct_all: pctDiff(asim_all, ac_all)
        };
    });

    const stats = {};
    for (const c of ['all', 'dsk', 'blg', 'gas']) {
        stats[c] = computeCompStats(pts, 'ac_' + c, 'pct_' + c);
    }

    g.voxels_dsk_sim = g.voxels_blg_sim = g.voxels_gas_sim = null;

    return {
        name,
        n: pts.length,
        stats,
        pts,
        has_blg: Boolean(g.has_blg),
        rmax: Number(g.rmax.toPrecision(6)),
        sb_dsk_max: n5(g.sb_dsk_max),
        sb_blg_max: n5(g.sb_blg_max),
        sb_gas_peak: n5(g.sb_gas_peak),
        sigma_gas_peak: n5(g.sigma_gas_peak),
        z_gas_outer: n4(g.z_gas_outer),
        r_dsk_efold: n4(g.r_dsk_efold),
        z_dsk: n4(g.z_dsk),
        r_blg_efold: g.has_blg ? n4(get_r_blg_efold(g)) : 0,
        r_blg_max: g.has_blg ? n4(get_r_blg_max(g)) : 0
    };
});

console.log = origLog;
console.table = origTable;

const outputPath = path.join(__dirname, 'data_dashboard1.js');
fs.writeFileSync(outputPath, 'const DATA = ' + JSON.stringify(DATA) + ';\n', 'utf8');
console.log(`Generated DATA for ${DATA.length} galaxies in ${Date.now() - t0} ms -> ${outputPath}`);

const blg = DATA.filter(d => d.has_blg);
const avg = (arr, comp) => (arr.reduce((s, d) => s + d.stats[comp].meanAbsAll, 0) / arr.length).toFixed(2) + '%';
console.log(`meanAbsAll — All: ${avg(DATA, 'all')} | Disk: ${avg(DATA, 'dsk')} | Bulge (29): ${avg(blg, 'blg')} | Gas: ${avg(DATA, 'gas')}`);
