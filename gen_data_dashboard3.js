// Node.js script to generate deploy/data_dashboard3.js (a-Term Formulas & Screening Variations)
// from deploy/logic_grav.js and shared generator utilities in deploy/dashboard_common.js.
// Usage: node deploy/gen_data_dashboard3.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

for (const file of [
    'lib.js',
    'data_sparcgalaxies.js',
    'data_bestgalaxies.js',
    'logic.js',
    'logic_dsk.js',
    'logic_blg.js',
    'logic_gas.js',
    'logic_grav.js',
    'dashboard_common.js'
]) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { filename: file });
}

const t0 = Date.now();
const formulaKeys = DASHBOARD3_FORMULA_KEYS;
const formulaMeta = getDashboardFormulaMeta(formulaKeys, true);
const DATA_GRAV3 = buildGravityDashboardData({
    fs,
    path,
    dirname: __dirname,
    formulaKeys,
    includeF4GroupFits: false
});

const outputPath = path.join(__dirname, 'data_dashboard3.js');
fs.writeFileSync(
    outputPath,
    'const DASHBOARD3_KEYS = ' + JSON.stringify(formulaKeys) + ';\n' +
    'const DASHBOARD3_META = ' + JSON.stringify(formulaMeta) + ';\n' +
    'const DATA_GRAV3 = ' + JSON.stringify(DATA_GRAV3) + ';\n',
    'utf8'
);
console.log(`Generated DATA_GRAV3 for ${DATA_GRAV3.length} galaxies in ${Date.now() - t0} ms -> ${outputPath}`);

printDashboardSummary(DATA_GRAV3, formulaKeys, { includeF4GroupFits: false });
