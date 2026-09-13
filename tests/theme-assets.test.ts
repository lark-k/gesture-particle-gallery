import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { THEMES, parseTheme } from '../src/scene/themes';
import { ringColumns, photoSlot } from '../src/scene/layout';

test('unknown or corrupted stored preferences fall back to the forest', () => {
  for (const value of [undefined, null, '', 'toString', '__proto__', 'unknown', {}]) {
    assert.equal(parseTheme(value), 'forest');
  }
  assert.equal(parseTheme('lake'), 'lake');
  assert.equal(parseTheme('meadow'), 'meadow');
});

test('each shipped theme has a panorama, genuine alpha foreground and Radiance HDR', async () => {
  for (const id of Object.keys(THEMES)) {
    const panorama = await sharp(`public/environments/${id}-panorama.jpg`).metadata();
    assert.equal(panorama.width! / panorama.height!, 2);
    const foreground = sharp(`public/environments/${id}-foreground.png`);
    assert.equal((await foreground.metadata()).hasAlpha, true);
    const alpha = await foreground.extractChannel('alpha').stats();
    assert.equal(alpha.channels[0].min, 0);
    assert.equal(alpha.channels[0].max, 255);
    const hdr = await readFile(`public/environments/${id}-light.hdr`);
    assert.match(hdr.subarray(0, 512).toString('ascii'), /#\?RADIANCE|#\?RGBE/);
    assert.ok(hdr.length > 1_000_000);
  }
});

test('all default samples fit the first annular band pair and preserve source aspect', async () => {
  const samples = JSON.parse(await readFile('public/samples/manifest.json', 'utf8'));
  const columns = ringColumns(samples.length);
  assert.ok(columns * 2 >= samples.length, 'default photographs must not spill behind the header into a higher tier');
  for (const [i, photo] of samples.entries()) {
    const slot = photoSlot(i, columns, photo.width / photo.height);
    assert.ok(Math.abs(slot.y) < 2);
    const file = await sharp(`public${photo.fullUrl}`).metadata();
    assert.equal(file.width, photo.width);
    assert.equal(file.height, photo.height);
  }
});
