const fs = require('fs');
const path = require('path');
const vm = require('vm');

vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'lib.js'), 'utf8'), { filename: 'lib.js' });

// (from SPARC table2.mrt)
const filePath = path.join(__dirname, 'data_sparcgalaxies.csv');
const fileContent = fs.readFileSync(filePath, 'utf8');
// console.log(fileContent);

const rows = fileContent.split(/\r\n|\n/);

// console.log(rows[0]);
//   Galaxy identifier
//   Assumed distance (Mpc)
//   Galactocentric radius (kpc)
//   Galactocentric radius (m)
//   Observed circular velocity (km/s)
//   Observed circular velocity (m/s)
//   Uncertainty in v obs (km/s)
//   Gas velocity contribution (km/s)
//   Gas velocity contribution (m/s)
//   Disk velocity contribution (km/s)
//   Disk velocity contribution (m/s)
//   Bulge velocity contribution (km/s)
//   Bulge velocity contribution (m/s)
//   Disk surface brightness (solLum/pc2)
//   Bulge surface brightness (solLum/pc2)

var galaxiesobj = {};

for (var i = 1; i < rows.length; i++) {
    // console.log(rows[i]);
    const columns = rows[i].split(',');
    // console.log(columns.length);

    var name = columns[0];
    if (!galaxiesobj[name]) {
        galaxiesobj[name] = {
            'name': name,
            'has_blg': false,
            'rmax': 0,
            'sb_dsk_max': 0,
            'sb_blg_max': 0,
            'radiusdata': [],
        };
    }

    // use meters, m/s, W/m^2
    galaxiesobj[name]['radiusdata'].push({
        'r': parseFloat(columns[3]),
        'v': parseFloat(columns[5]),
        'v_gas': parseFloat(columns[8]),
        'v_dsk': parseFloat(columns[10]),
        'v_blg': parseFloat(columns[12]),
        'sb_dsk': trim(parseFloat(columns[13]) * 4.02e-7), // 1 solLum/pc^2 = 4.02e-7 W/m^2
        'sb_blg': trim(parseFloat(columns[14]) * 4.02e-7),
    });
}

// note:
// some velocities have high uncertainty. don't need to remove but keep in mind.
// some galaxies low quality data (in SPARC Table1.mrt) (asymmetries, non-circular motions). don't need to remove but keep in mind.

for (const [gname, galaxyobj] of Object.entries(galaxiesobj)) {

    var radiusdata = galaxyobj['radiusdata'];

    var has_blg = false;
    var sb_dsk_max = 0;
    var sb_blg_max = 0;
    for (var i = 0; i < radiusdata.length; i++) {
        var datum = radiusdata[i];
        var r = datum['r'];

        // acceleration (m/s^2)
        datum['a'] = trim(datum['v'] ** 2 / r);

        // classic accel according to SPARC authors
        //   doing abs(v) * v instead of v^2 to preserve sign (see SPARC data)
        //   sometimes a_classic < 0 at small radius
        //   need to *mlcoeff bc authors reported v as if coeff is 1. need to undo. they should have done it.
        //     so use the corrected a, don't use v after that.
        //     the idea is the coeff means that for every luminosityofsun observed, there is massofsun*coeff mass.
        datum['a_classic_gas'] = trim(Math.abs(datum['v_gas']) * datum['v_gas'] / r);
        datum['a_classic_dsk'] = trim(Math.abs(datum['v_dsk']) * datum['v_dsk'] / r * coeff_dsk);
        datum['a_classic_blg'] = trim(Math.abs(datum['v_blg']) * datum['v_blg'] / r * coeff_blg);
        datum['a_classic_tot'] = trim(datum['a_classic_gas'] + datum['a_classic_dsk'] + datum['a_classic_blg']);

        if (datum['sb_blg']) {
            has_blg = true;
        }
        if (datum['sb_dsk'] > sb_dsk_max) {
            sb_dsk_max = datum['sb_dsk'];
        }
        if (datum['sb_blg'] > sb_blg_max) {
            sb_blg_max = datum['sb_blg'];
        }

    }

    galaxyobj['has_blg'] = has_blg;
    galaxyobj['rmax'] = radiusdata.at(-1)['r'];
    galaxyobj['sb_dsk_max'] = sb_dsk_max;
    galaxyobj['sb_blg_max'] = sb_blg_max;
}

// fs.writeFile('data_sparcgalaxies.json', JSON.stringify(galaxiesobj, null, 2), () => { });

fs.writeFileSync(path.join(__dirname, 'data_sparcgalaxies.js'), 'var galaxiesobj = ' + JSON.stringify(galaxiesobj, null, 2) + ';', 'utf8');
