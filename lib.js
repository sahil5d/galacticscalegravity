// ═══════════════════════════════════════════════════════════════════════════
// 1. PHYSICAL CONSTANTS, SI UNITS & MASS-TO-LIGHT COEFFICIENTS
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// 2. 3D SCENE MARKER & LINE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function trim(arg) {
    if (typeof arg === 'number') {
        // return parseFloat(arg.toPrecision(3));
        return parseFloat(arg.toPrecision(5));
    } else {
        return { x: trim(arg.x), y: trim(arg.y), z: trim(arg.z) };
    }
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

// Render multiple sphere markers in a single GPU draw call
function plotpoints_instanced(pointsList, arghex = '#ffffff', argr = 0.6) {
    if (!pointsList || pointsList.length === 0) return null;
    const geometry = new THREE.SphereGeometry(argr, 12, 8);
    const material = new THREE.MeshBasicMaterial({ color: arghex });
    const mesh = new THREE.InstancedMesh(geometry, material, pointsList.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < pointsList.length; i++) {
        const pt = pointsList[i];
        if (typeof pt === 'number') {
            dummy.position.set(pt, 0, 0);
        } else {
            dummy.position.set(pt.x, pt.y || 0, pt.z || 0);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return mesh;
}

function plotlinesegment(argvec, argorigin, arghex = '#ffffff') {
    const points = [argorigin, argorigin.clone().add(argvec)];

    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(points);

    const material = new THREE.LineBasicMaterial({ color: arghex });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. GPU-INSTANCED 3D CUBE VOXEL RENDERER & O(log N) DENSITY SCALING
// ═══════════════════════════════════════════════════════════════════════════

// Render all voxels as 3D cubes in a single GPU draw call using THREE.InstancedBufferGeometry + THREE.ShaderMaterial with additive light.
// Uses an 8-vertex indexed cube, an Int16Array 'instancePos' attribute (6 bytes/voxel), a Float32Array 'instanceRho' attribute (4 bytes/voxel),
// and 'invDenom' uniform with O(log N) binary-searched geometry.instanceCount culling of zero-brightness (q <= 0) cubes.
function plotcubes_instanced(items, size = 1) {
    let positions, rhos;
    if (items && (items.positions instanceof Int16Array || items.positions instanceof Float32Array) && items.rhos instanceof Float32Array) {
        positions = items.positions;
        rhos = items.rhos;
    } else {
        const n = items ? items.length : 0;
        positions = new Int16Array(n * 3);
        rhos = new Float32Array(n);
        for (let idx = 0; idx < n; idx++) {
            const item = items[idx];
            const j = idx * 3;
            positions[j] = item.x;
            positions[j + 1] = item.y;
            positions[j + 2] = item.z || 0;
            rhos[idx] = item.rho !== undefined ? item.rho : 1;
        }
    }

    const h = 0.5 * size;
    const cubeVertices = new Float32Array([
         h,  h,  h,   h,  h, -h,   h, -h,  h,   h, -h, -h,
        -h,  h, -h,  -h,  h,  h,  -h, -h, -h,  -h, -h,  h
    ]);
    const cubeIndices = new Uint16Array([
        0, 2, 1,  2, 3, 1,  4, 6, 5,  6, 7, 5,
        4, 5, 1,  5, 0, 1,  7, 6, 2,  6, 3, 2,
        5, 7, 0,  7, 2, 0,  1, 3, 4,  3, 6, 4
    ]);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(cubeIndices, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(cubeVertices, 3));
    geometry.setAttribute('instancePos', new THREE.InstancedBufferAttribute(positions, 3));
    geometry.setAttribute('instanceRho', new THREE.InstancedBufferAttribute(rhos, 1));
    geometry.instanceCount = rhos.length;

    const material = new THREE.ShaderMaterial({
        uniforms: {
            invDenom: { value: 0.0 }
        },
        vertexShader: [
            'attribute vec3 instancePos;',
            'attribute float instanceRho;',
            'uniform float invDenom;',
            'varying float vGray;',
            'void main() {',
            '    float q = floor(instanceRho * invDenom + 0.5);',
            '    if (q <= 0.0) {',
            '        vGray = 0.0;',
            '        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);',
            '        return;',
            '    }',
            '    vGray = min(q, 255.0) * (1.0 / 255.0);',
            '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position + instancePos, 1.0);',
            '}'
        ].join('\n'),
        fragmentShader: [
            'varying float vGray;',
            'void main() {',
            '    gl_FragColor = vec4(vGray, vGray, vGray, 1.0);',
            '}'
        ].join('\n'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
}

// Update the density normalization scale of an existing instanced cube mesh in O(log N) via its shader uniform
// and binary-searched geometry.instanceCount prefix (skipping GPU execution on all q <= 0 cubes).
function recolor_instanced_mesh(mesh, items, denom) {
    if (!mesh) return;
    if (mesh.material && mesh.material.uniforms && mesh.material.uniforms.invDenom !== undefined) {
        const hasValidDenom = denom !== undefined && denom > 0;
        mesh.material.uniforms.invDenom.value = hasValidDenom ? (255 / denom) : 0;
        if (mesh.geometry && items && items.sorted && items.rhos instanceof Float32Array) {
            const rhos = items.rhos;
            const n = rhos.length;
            let activeCount = 0;
            if (hasValidDenom && n > 0) {
                const threshold = denom / 510;
                if (rhos[n - 1] >= threshold) {
                    activeCount = n;
                } else if (rhos[0] >= threshold) {
                    let lo = 0, hi = n;
                    while (lo < hi) {
                        const mid = (lo + hi) >>> 1;
                        if (rhos[mid] >= threshold) {
                            lo = mid + 1;
                        } else {
                            hi = mid;
                        }
                    }
                    activeCount = lo;
                }
            }
            if (mesh.geometry.isInstancedBufferGeometry) {
                mesh.geometry.instanceCount = activeCount;
            } else {
                mesh.geometry.setDrawRange(0, activeCount);
            }
        }
        return;
    }
    if (!mesh.geometry || !items) return;
    const colorAttr = mesh.geometry.getAttribute('color');
    if (!colorAttr) return;
    const colors = colorAttr.array;
    const n = items.length;
    const invDenom = (denom !== undefined && denom > 0) ? (255 / denom) : 0;
    for (let idx = 0; idx < n; idx++) {
        const rho = items.rhos ? items.rhos[idx] : items[idx].rho;
        const q = Math.round(rho * invDenom);
        const g = q > 0 ? (q >= 255 ? 1 : q / 255) : 0;
        const j = idx * 3;
        colors[j] = g;
        colors[j + 1] = g;
        colors[j + 2] = g;
    }
    colorAttr.needsUpdate = true;
}
