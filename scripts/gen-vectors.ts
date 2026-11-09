import { writeFile } from "node:fs/promises";
import { buildVectors } from "./build-vectors.js";

const vectors = await buildVectors();
for (const [file, data] of Object.entries(vectors)) {
  await writeFile(new URL(`../vectors/${file}`, import.meta.url), JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote vectors/${file}`);
}
