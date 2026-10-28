// Node.js script to generate deploy/data_dashboard2.js (Formulas 1–5) from deploy/logic_grav.js
// and shared generator utilities in deploy/dashboard_common.js.
// Usage: node deploy/gen_data_dashboard2.js

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
const formulaKeys = DASHBOARD2_FORMULA_KEYS;
const formulaMeta = getDashboardFormulaMeta(formulaKeys, false);
const DATA_GRAV = buildGravityDashboardData({
    fs,
    path,
    dirname: __dirname,
    formulaKeys,
    includeF4GroupFits: true
});

const outputPath = path.join(__dirname, 'data_dashboard2.js');
fs.writeFileSync(
    outputPath,
    'const DASHBOARD2_KEYS = ' + JSON.stringify(formulaKeys) + ';\n' +
    'const DASHBOARD2_META = ' + JSON.stringify(formulaMeta) + ';\n' +
    'const DATA_GRAV = ' + JSON.stringify(DATA_GRAV) + ';\n',
    'utf8'
);
console.log(`Generated DATA_GRAV for ${DATA_GRAV.length} galaxies in ${Date.now() - t0} ms -> ${outputPath}`);

printDashboardSummary(DATA_GRAV, formulaKeys, { includeF4GroupFits: true });
