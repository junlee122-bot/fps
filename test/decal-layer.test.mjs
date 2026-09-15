/**
 * test/decal-layer.test.mjs — 시각 DECAL 가상층 (P3 C3 §10 단청 배치).
 *
 * decal 태그가 있는 오브젝트에 진입하면 두께 0의 DECAL 층(DANCHEONG/LACQUER)이 하부재 층
 * 앞에 삽입되고, 관통 판정은 하부재 두께로만 결정된다(정점 추가 없음 — §9 동결).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/index.js';
import { collectRayChain } from '../src/physics/raychain.js';
import { classify } from '../src/weapons/ballistics.js';
import { WEAPONS } from '../src/weapons/params.js';

function world(decal) {
  const physics = new PhysicsWorld();
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.30));
  m.name = 'beam'; m.position.set(0, 0, -5); m.updateMatrixWorld(true);
  physics.addStaticMesh(m, 'WOOD_COLUMN', undefined, decal ? { decal } : {});
  physics.build();
  return physics;
}

test('단청 DECAL 가상층: 하부재 앞 두께 0, 관통 결과는 하부재와 동일', () => {
  const plain = collectRayChain(world(null).static, 0, 0, 0, 0, 0, -1, 50);
  const tagged = collectRayChain(world('DANCHEONG').static, 0, 0, 0, 0, 0, -1, 50);
  assert.equal(plain.layers.length, 1);
  assert.equal(tagged.layers.length, 2);
  assert.equal(tagged.layers[0].surface, 'DANCHEONG');
  assert.equal(tagged.layers[0].thicknessCm, 0);
  assert.equal(tagged.layers[1].surface, 'WOOD_COLUMN');
  assert.ok(Math.abs(tagged.layers[1].thicknessCm - 30) < 0.05);
  assert.equal(tagged.layers[0].entryT, tagged.layers[1].entryT);
  for (const w of Object.values(WEAPONS)) assert.equal(classify(w, tagged.layers), classify(w, plain.layers));
});

test('옻칠 DECAL 가상층 + userData.decal 경로', () => {
  const physics = new PhysicsWorld();
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.045));
  m.name = 'door'; m.position.set(0, 0, -3); m.userData.decal = 'LACQUER'; m.updateMatrixWorld(true);
  physics.addStaticMesh(m, 'WOOD_PLANK');
  physics.build();
  const c = collectRayChain(physics.static, 0, 0, 0, 0, 0, -1, 50);
  assert.deepEqual(c.layers.map((l) => l.surface), ['LACQUER', 'WOOD_PLANK']);
});
