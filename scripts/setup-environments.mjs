import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = [
  ['forest', 'forest_grove', 'e1b083a9c3e307558ba434b9d7bc9f2e'],
  ['lake', 'lakeside_dawn', '30c7de35643e0286db00e9361b93d7dd'],
  ['meadow', 'hausdorf_meadow', '4c498eea84300ce1b6fae9a4052e429f'],
];
await mkdir('public/environments', { recursive: true });
for (const [theme, id, expected] of assets) {
  const file = `public/environments/${theme}-light.hdr`;
  let data;
  try { data = await readFile(file); } catch { /* Download below. */ }
  const valid = b => b && createHash('md5').update(b).digest('hex') === expected;
  if (!valid(data)) {
    const r = await fetch(`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr`);
    if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
    data = Buffer.from(await r.arrayBuffer());
    if (!valid(data)) throw new Error(`${id}: checksum mismatch`);
    await writeFile(file, data);
  }
  console.log(`${theme}: verified Radiance HDR (${data.length} bytes), CC0 Poly Haven / ${id}`);
}
