import { mkdir, writeFile, cp, access } from "node:fs/promises";
import sharp from "sharp";
const photos = [
  ["1519681393784-d120267933ba", "雪山来信"],
  ["1464822759023-fed622ff2c3b", "山的轮廓"],
  ["1470770841072-f978cf4d019e", "湖畔静谧"],
  ["1441974231531-c6227db76b6e", "林间呼吸"],
  ["1500530855697-b586d89ba3ee", "旷野之上"],
  ["1472396961693-142e6e269027", "森林来客"],
  ["1501785888041-af3ef285b470", "远方的蓝"],
  ["1469474968028-56623f02e42e", "群山之间"],
  ["1426604966848-d7adac402bff", "绿野回声"],
  ["1470252649378-9c29740c9fa8", "日出之前"],
  ["1447752875215-b2761acb3c5d", "苔绿秘境"],
  ["1473448912268-2022ce9509d8", "晨雾穿林"],
  ["1500534314209-a25ddb2bd429", "沙丘之息"],
  ["1518837695005-2083093ee35b", "海的边界"],
  ["1511497584788-876760111969", "仰望时间"],
  ["1433086966358-54859d0ed716", "溪谷清音"],
  ["1501854140801-50d01698950b", "大地的褶皱"],
  ["1448375240586-882707db888b", "光落林间"],
  ["1475924156734-496f6cac6ec1", "潮汐独白"],
  ["1493246507139-91e8fad9978e", "秋山倒影"],
];
await mkdir("public/samples", { recursive: true });
await mkdir("public/mediapipe", { recursive: true });
const manifest = [];
for (let i = 0; i < photos.length; i++) {
  const [id, name] = photos[i];
  const path = `public/samples/${i + 1}.jpg`;
  try {
    await access(path);
  } catch {
    const res = await fetch(
      `https://images.unsplash.com/photo-${id}?auto=format&fit=max&w=1920&q=88`,
    );
    if (!res.ok) throw new Error(`Sample ${id}: ${res.status}`);
    await writeFile(
      path,
      await sharp(Buffer.from(await res.arrayBuffer()))
        .rotate()
        .jpeg({ quality: 88 })
        .toBuffer(),
    );
  }
  const meta = await sharp(path).metadata();
  await sharp(path)
    .resize({
      width: 800,
      height: 800,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toFile(`public/samples/${i + 1}-thumb.jpg`);
  manifest.push({
    id: `sample-${i + 1}`,
    name,
    width: meta.width,
    height: meta.height,
    thumbUrl: `/samples/${i + 1}-thumb.jpg`,
    fullUrl: `/samples/${i + 1}.jpg`,
    createdAt: "2026-01-01T00:00:00Z",
    source: "sample",
    credit: `https://images.unsplash.com/photo-${id}`,
  });
}
// Generated editorial photographs ship with the project; never fetched remotely.
const additions = [];
for (const [id, name] of [["forest-boardwalk", "林光尽头"], ["quiet-traveller", "一个人的远行"], ["fern-dew", "露水停留的地方"], ["lake-pier", "走向镜湖"], ["stone-passage", "时间的回廊"]]) {
  const path = `public/samples/${id}.jpg`;
  const meta = await sharp(path).metadata();
  await sharp(path).resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(`public/samples/${id}-thumb.jpg`);
  additions.push({ id: `sample-${id}`, name, width: meta.width, height: meta.height, thumbUrl: `/samples/${id}-thumb.jpg`, fullUrl: `/samples/${id}.jpg`, source: "sample", createdAt: "2026-09-13T00:00:00Z", credit: "AI-generated with OpenAI ImageGen for Stillspace" });
}
// Primary slots 0/2/4/6: boardwalk, human scale, lake perspective, macro detail.
const firstTwo = manifest.splice(0, 2);
manifest.unshift(additions[0], additions[4], additions[1], firstTwo[0], additions[3], firstTwo[1], additions[2]);
await writeFile(
  "public/samples/manifest.json",
  JSON.stringify(manifest, null, 2),
);
await cp("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", {
  recursive: true,
});
try {
  await access("public/mediapipe/hand_landmarker.task");
} catch {
  const res = await fetch(
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  );
  if (!res.ok) throw new Error(`Hand model: ${res.status}`);
  await writeFile(
    "public/mediapipe/hand_landmarker.task",
    Buffer.from(await res.arrayBuffer()),
  );
}
console.log(`Prepared ${manifest.length} local photos, WASM and hand model.`);
