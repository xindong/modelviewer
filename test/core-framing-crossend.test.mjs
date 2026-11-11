import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeCameraPoses } from '../packages/core/src/index.ts';

// Fixture captured from the browser ViewerEngine.frameRenderView (framing-check.html).
// Locks the cross-end contract: browser offscreen framing == shared core == Node render.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/browser-framing.json', import.meta.url), 'utf8'));
const bounds = { radius: Math.sqrt(1.3125), center: [0, 0, 0], size: [2, 1, 0.5] };
const views = ['front', 'back', 'left', 'right', 'side', 'top', 'bottom', 'angled', 'none'];
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} vs ${expected}`);

test('browser camera poses match core computeCameraPoses for every view/projection', () => {
  for (const projection of ['perspective', 'orthographic']) {
    for (const view of views) {
      const [pose] = computeCameraPoses(bounds, {
        aspect: fixture.aspect, padding: fixture.padding, projection, views: [view],
      });
      const captured = fixture.poses[`${projection}:${view}`];
      assert.ok(captured, `missing fixture for ${projection}:${view}`);
      for (let index = 0; index < 3; index++) close(pose.position[index], captured.position[index], `${projection}:${view}.pos${index}`);
      for (let index = 0; index < 3; index++) close(pose.up[index], captured.up[index], `${projection}:${view}.up`);
      close(pose.near, captured.near, 'near');
      close(pose.far, captured.far, 'far');
      if (projection === 'perspective') close(pose.fov, captured.fov, 'fov');
      if (pose.ortho) for (const key of ['left', 'right', 'top', 'bottom']) close(pose.ortho[key], captured.ortho[key], `${projection}:${view}.ortho.${key}`);
    }
  }
});

test('a batch containing none frames every view by the bounding sphere (Node batch semantics)', () => {
  const poses = computeCameraPoses(bounds, { aspect: 1, padding: 0.1, projection: 'orthographic', views });
  const sphereHalfExtent = bounds.radius * 1.1;
  for (const pose of poses) close(pose.ortho.right, sphereHalfExtent, `${pose.view}.ortho.right`);
});

test('a batch containing angled (without none) also frames every view by the sphere', () => {
  const poses = computeCameraPoses(bounds, { aspect: 1, padding: 0.1, projection: 'orthographic', views: ['front', 'angled'] });
  const sphereHalfExtent = bounds.radius * 1.1;
  for (const pose of poses) close(pose.ortho.right, sphereHalfExtent, `${pose.view}.ortho.right`);
});

test('an axis-only batch frames by the axis extent, not the sphere', () => {
  const poses = computeCameraPoses(bounds, { aspect: 1, padding: 0.1, projection: 'orthographic', views: ['front', 'top'] });
  const axisHalfExtent = (Math.max(...bounds.size) / 2) * 1.1;
  for (const pose of poses) close(pose.ortho.right, axisHalfExtent, `${pose.view}.ortho.right`);
});
