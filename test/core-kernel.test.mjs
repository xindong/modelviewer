import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extFromMagic, extFromMime, extensionOf, hasModelExtension, ensureModelExtension,
  MODEL_FORMATS, VIEW_DIRECTIONS, PRESET_VIEWS, DEFAULT_RENDER_PADDING,
  computeCameraPoses, RENDER_FOV,
  defaultBackground, assertValidPadding, RENDER_DEFAULTS, TEXTURE_MODES, IMAGE_FORMATS,
  MAX_RENDER_PIXELS, MAX_RENDER_DIMENSION,
  SLOT_KEYWORDS, matchTextureByKeywords, findTextureByReference, textureBasename, stripTextureExt,
} from '../packages/core/src/index.ts';

const close = (actual, expected, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} !~ ${expected}`);

test('extFromMagic identifies formats from headers', () => {
  assert.equal(extFromMagic(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02])), 'glb');
  assert.equal(extFromMagic(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), 'zip');
  const enc = (text) => new TextEncoder().encode(text);
  assert.equal(extFromMagic(enc('Kaydara FBX Binary  \x00')), 'fbx');
  assert.equal(extFromMagic(enc('#VRML V2.0 utf8\n')), 'wrl');
  assert.equal(extFromMagic(enc('ISO-10303-21;\nHEADER;')), 'step');
  assert.equal(extFromMagic(enc('ply\nformat ascii 1.0\n')), 'ply');
  assert.equal(extFromMagic(enc('solid m\nfacet normal 0 0 1\nendsolid m\n')), 'stl');
  assert.equal(extFromMagic(enc('v 0 0 0\nv 1 0 0\nf 1 2 3\n')), 'obj');
  assert.equal(extFromMagic(enc('{"asset":{"version":"2.0"}}')), 'gltf');
  assert.equal(extFromMagic(new Uint8Array([0x00, 0x01, 0x02, 0x03])), null);
});

test('extension helpers strip paths and queries', () => {
  assert.equal(extensionOf('/a/b/model.GLb?x=1#y'), 'glb');
  assert.equal(extensionOf('noext'), '');
  assert.equal(hasModelExtension('a.obj'), true);
  assert.equal(ensureModelExtension('model', 'obj'), 'model.obj');
  assert.equal(ensureModelExtension('model.fbx', 'obj'), 'model.fbx');
  assert.equal(extFromMime('model/gltf-binary'), 'glb');
  assert.equal(extFromMime('application/zip; charset=binary'), 'zip');
});

test('canonical views: side aliases left, none is a fixed 3/4 view', () => {
  assert.deepEqual(VIEW_DIRECTIONS.side, VIEW_DIRECTIONS.left);
  assert.deepEqual(VIEW_DIRECTIONS.none, [1, 0.65, 1]);
  assert.equal(DEFAULT_RENDER_PADDING, 0.1);
  assert.ok(PRESET_VIEWS.includes('none'));
  assert.ok(MODEL_FORMATS.includes('glb'));
});

test('computeCameraPoses: perspective framing matches the Node formula', () => {
  const [pose] = computeCameraPoses(
    { radius: 1, center: [0, 0, 0], size: [2, 2, 2] },
    { aspect: 1, padding: 0.1, projection: 'perspective', views: ['front'] }
  );
  const expected = (1 / Math.sin(Math.PI / 8)) * 1.1;
  close(pose.distance, expected);
  close(pose.position[2], expected);
  assert.equal(pose.fov, RENDER_FOV);
  assert.equal(pose.ortho, null);
  assert.deepEqual(pose.up, [0, 1, 0]);
  assert.deepEqual(pose.target, [0, 0, 0]);
});

test('computeCameraPoses: orthographic frustum and distance', () => {
  const [pose] = computeCameraPoses(
    { radius: 1, center: [0, 0, 0], size: [2, 2, 2] },
    { aspect: 1, padding: 0.1, projection: 'orthographic', views: ['front'] }
  );
  close(pose.ortho.right, 1.1);
  close(pose.ortho.left, -1.1);
  close(pose.ortho.top, 1.1);
  assert.equal(pose.distance, 4);
});

test('computeCameraPoses: none view frames by bounding sphere, not axis extent', () => {
  const [pose] = computeCameraPoses(
    { radius: 1, center: [0, 0, 0], size: [10, 1, 1] },
    { aspect: 1, padding: 0, projection: 'orthographic', views: ['none'] }
  );
  close(pose.ortho.right, 1);
});

test('computeCameraPoses: top/bottom up vectors and multi-view order', () => {
  const poses = computeCameraPoses(
    { radius: 1, center: [0, 0, 0], size: [2, 2, 2] },
    { aspect: 1, views: ['top', 'bottom', 'front'] }
  );
  assert.deepEqual(poses.map(p => p.view), ['top', 'bottom', 'front']);
  assert.deepEqual(poses[0].up, [0, 0, -1]);
  assert.deepEqual(poses[1].up, [0, 0, 1]);
});

test('renderOptions: canonical defaults, background and padding guard', () => {
  assert.equal(RENDER_DEFAULTS.width, 1024);
  assert.equal(RENDER_DEFAULTS.format, 'png');
  assert.equal(RENDER_DEFAULTS.padding, 0.1);
  assert.equal(RENDER_DEFAULTS.textureMode, 'textured');
  assert.equal(defaultBackground('jpeg'), '#ffffff');
  assert.equal(defaultBackground('png'), 'transparent');
  assert.equal(defaultBackground('webp'), 'transparent');
  assert.deepEqual([...IMAGE_FORMATS], ['png', 'jpeg', 'webp']);
  assert.deepEqual([...TEXTURE_MODES], ['textured', 'clay', 'white', 'normal', 'albedo']);
  assert.equal(MAX_RENDER_DIMENSION, 8192);
  assert.equal(MAX_RENDER_PIXELS, 16777216);
  assertValidPadding(undefined);
  assertValidPadding(0);
  assertValidPadding(10);
  assert.throws(() => assertValidPadding(-0.01), RangeError);
  assert.throws(() => assertValidPadding(10.01), RangeError);
  assert.throws(() => assertValidPadding(NaN), RangeError);
});

test('materials: slot keyword matching and reference resolution', () => {
  assert.ok(SLOT_KEYWORDS.map.includes('albedo'));
  assert.equal(textureBasename('/a/B/Color.PNG'), 'color.png');
  assert.equal(stripTextureExt('color.png'), 'color');
  const files = [
    { path: 'textures/chair_albedo.png', lowerBase: 'chair_albedo.png', ext: 'png' },
    { path: 'textures/chair_normal.png', lowerBase: 'chair_normal.png', ext: 'png' },
    { path: 'textures/chair_rough.png', lowerBase: 'chair_rough.png', ext: 'png' },
  ];
  const matched = matchTextureByKeywords(files, ['map', 'normalMap', 'roughnessMap']);
  assert.equal(matched.map.path, 'textures/chair_albedo.png');
  assert.equal(matched.normalMap.path, 'textures/chair_normal.png');
  assert.equal(matched.roughnessMap.path, 'textures/chair_rough.png');
  assert.equal(findTextureByReference(files, 'chair_albedo.png').path, 'textures/chair_albedo.png');
  const withDir = [
    { path: 'other/color.png', lowerBase: 'color.png', ext: 'png' },
    { path: 'model/color.png', lowerBase: 'color.png', ext: 'png' },
  ];
  assert.equal(findTextureByReference(withDir, 'color.png', 'model').path, 'model/color.png');
  assert.equal(findTextureByReference(files, ''), null);
});
