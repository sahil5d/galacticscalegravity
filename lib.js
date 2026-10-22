if (typeof THREE === 'undefined') {
    globalThis.THREE = { Vector3: function (x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } };
}
const p = THREE.Vector3;
const vec = THREE.Vector3;
const ZEROALL = new p(0, 0, 0);

const CSPEED = 2.9979 * 10 ** 8;  // m / s
const G = 6.6743e-11;  // m^3 / kg / s^2
const H = 2.29260201156637e-18;  // 1 / s
const a0 = CSPEED ** 2 / (2 * Math.PI * CSPEED / H);  // m / s^2

const Msun = 1.99e30; // kg
const Lsun = 3.83e26; // W

const coeff_dsk = 0.5;
const coeff_blg = 0.7;

function trim(arg) {
    if (typeof arg === 'number') {
        // return parseFloat(arg.toPrecision(3));
        return parseFloat(arg.toPrecision(5));
    } else {
        return { x: trim(arg.x), y: trim(arg.y), z: trim(arg.z) };
    }
}

// input from 0 to 1
function floattohexgray(f) {
    // const val = Math.min(255, Math.max(0, Math.round(f * 255)));
    const val = Math.floor(f * 255);
    const hex = val.toString(16).padStart(2, '0');
    return '#' + hex.repeat(3);
}

function plotpoint(point, arghex = '#ffffff', argr = .02) {
    var geometry = new THREE.SphereGeometry(argr);
    var material = new THREE.MeshBasicMaterial({
        color: arghex,
    });
    var sphere = new THREE.Mesh(geometry, material);
    if (typeof point === 'number') {
        sphere.position.set(point, 0, 0);
    } else {
        sphere.position.x = point.x;
        sphere.position.y = point.y;
        sphere.position.z = point.z;
    }
    scene.add(sphere);
}

function plotlinesegment(argvec, argorigin, arghex = '#ffffff') {
    const points = [argorigin, argorigin.clone().add(argvec)];

    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(points);

    const material = new THREE.LineBasicMaterial({ color: arghex });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
}

function plotcube(point, arghex = '#ffffff', args = .3) {
    const geometry = new THREE.BoxGeometry(args, args, args);
    const material = new THREE.MeshBasicMaterial({ color: arghex, wireframe: false });
    const cube = new THREE.Mesh(geometry, material);
    cube.position.x = point.x;
    cube.position.y = point.y;
    cube.position.z = point.z;
    scene.add(cube);
}

// Render thousands of cubes in a single GPU draw call with additive light
function plotcubes_instanced(items, size = 1) {
    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const instancedMesh = new THREE.InstancedMesh(geometry, material, items.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const s = item.size !== undefined ? item.size : 1;
        dummy.scale.set(s, s, s);
        dummy.position.set(item.x, item.y, item.z || 0);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(idx, dummy.matrix);
        color.set(item.color || '#ffffff');
        instancedMesh.setColorAt(idx, color);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
    scene.add(instancedMesh);
    return instancedMesh;
}

// Update instance colors of an existing InstancedMesh in place
function recolor_instanced_mesh(instancedMesh, items) {
    if (!instancedMesh || !items) return;
    const color = new THREE.Color();
    for (let idx = 0; idx < items.length; idx++) {
        color.set(items[idx].color || '#000000');
        instancedMesh.setColorAt(idx, color);
    }
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
}

function getrandompointinsphere(R) {
    var x, y, z, r;
    do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        r = Math.sqrt(x * x + y * y + z * z);
    } while (r > 1);

    return new p(x * R, y * R, z * R);
}

// from https://stackoverflow.com/questions/9600801/evenly-distributing-n-points-on-a-sphere
function getapproxequidistantpointsonsphere(n, R) {
    var out = [];

    var phiradians = Math.PI * (Math.sqrt(5) - 1); // golden angle in radians
    var y;
    var flatradius;
    var theta;
    for (var i = 0; i < n; i++) {
        y = 1 - 2 * i / (n - 1); // y goes from 1 to -1
        flatradius = Math.sqrt(1 - y * y); // horizontal radius at y. the radius swinging around yaxis.
        theta = phiradians * i; // golden angle increment

        out.push(new p(Math.cos(theta) * flatradius * R, y * R, Math.sin(theta) * flatradius * R));
    }
    return out;
}

function getpointsoncircle(n, R = 1) {
    var arr = [];
    for (var i = 0; i < n; i++) {
        var angle = (i / n) * (2 * Math.PI);
        arr.push(new p(Math.cos(angle) * R, Math.sin(angle) * R, 0));
    }
    return arr;
}
