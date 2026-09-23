const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

const API_THINGS_URL = "https://baiakidle.com/api/things";
const IMG_BASE_URL = "https://baiakidle.com/jogar/img";
const OUTPUT_BASE_DIR = "."; // Saves directly in the current directory

// Your existing numeric ID configurations
const CONFIG_NUMERIC = {
  outfit: { start: 1, end: 5000, maxConsecutive404: 2000, includeMask: true },
  effect: { start: 1, end: 2000, maxConsecutive404: 2000, includeMask: false },
  missile: { start: 1, end: 500, maxConsecutive404: 200, includeMask: false },
  object: { start: 1, end: 120000, maxConsecutive404: null, includeMask: false },
};

// New named configurations based on standard OpenTibia terminology
const CONFIG_NAMED = {
  elements: [
    "ice",
    "fire",
    "energy",
    "earth",
    "holy",
    "death",
    "physical",
    "healing",
    "lifedrain",
    "manadrain",
    "drown",
    "fatal",
    "agony",
  ],
  conditions: [
    "burning",
    "poison",
    "energy",
    "freezing",
    "dazzled",
    "cursed",
    "bleeding",
    "electrified",
    "pacified",
    "haste",
    "paralyze",
    "invisible",
    "magic_shield",
    "drunk",
    "soul",
    "protection",
    "strengthened",
    "infight",
    "pz",
    "logout",
    "mute",
    "swords",
  ],
};

const CONCURRENCY_LIMIT = 40;

// List-driven category: the hunt-map windows'
// distinct ground/object ids, emitted by `npm run gen:huntmaps` into
// maps/generated/spriteIds.json. `objectanim/<id>.png` is a frame strip for
// animated ids (water 4597 → 448×32 = 14 frames) and the SAME 32×32 image as
// `object/<id>.png` for static ones, so a full-range scan would waste ~48k
// requests — only these ids are fetched and only the genuinely animated TILE
// strips are kept (a 32×32 response, or a 64×64 / 64-tall 2×2 object sprite, is
// static for the arena's single-tile grid).
// The mirror lives next to this script (packages/client/things/objectanim), independent
// of the cwd the existing categories use (`OUTPUT_BASE_DIR = "."`).
const OBJECTANIM_DIR = path.join(__dirname, "objectanim");
const OBJECTANIM_IDS_PATH = path.join(__dirname, "..", "..", "maps", "generated", "spriteIds.json");
/** The static tile tree — its 32×32 size is what makes an id tile-animatable. */
const OBJECT_DIR = path.join(__dirname, "object");

async function fetchAndSave(url: string, filePath: string) {
  if (fsSync.existsSync(filePath)) {
    return "skipped";
  }

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });

    if (response.status === 200) {
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(filePath, buffer);
      return "success";
    }
    return response.status === 404 ? "404" : `HTTP_${response.status}`;
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------
// 1. Logic for Numeric IDs (/api/things/...)
// ---------------------------------------------------------
async function downloadNumericAsset(category: string, id: number, includeMask: boolean) {
  const folderPath = path.join(OUTPUT_BASE_DIR, category);
  const baseFilePath = path.join(folderPath, `${id}.png`);
  const baseUrl = `${API_THINGS_URL}/${category}/${id}.png`;

  const baseStatus = await fetchAndSave(baseUrl, baseFilePath);

  if (includeMask) {
    const maskFilePath = path.join(folderPath, `${id}_mask.png`);
    const maskUrl = `${API_THINGS_URL}/${category}/${id}_mask.png`;
    await fetchAndSave(maskUrl, maskFilePath);
  }

  return baseStatus;
}

async function processNumericCategory(
  category: string,
  bounds: { start: number; end: number; maxConsecutive404: number | null; includeMask: boolean },
) {
  const folderPath = path.join(OUTPUT_BASE_DIR, category);
  await fs.mkdir(folderPath, { recursive: true });

  console.log(
    `\n--- Starting Category: [${category.toUpperCase()}] (IDs: ${bounds.start} -> ${bounds.end}) ---`,
  );

  let consecutive404s = 0;
  let currentId = bounds.start;
  const stats = { downloaded: 0, skipped: 0, not_found: 0, errors: 0 };

  async function worker() {
    while (currentId <= bounds.end) {
      if (bounds.maxConsecutive404 !== null && consecutive404s >= bounds.maxConsecutive404) {
        break;
      }

      const id = currentId++;
      const status = await downloadNumericAsset(category, id, bounds.includeMask);

      if (status === "success") {
        consecutive404s = 0;
        stats.downloaded++;
        console.log(`[+] Downloaded ${category}/${id}.png${bounds.includeMask ? " (+ mask)" : ""}`);
      } else if (status === "skipped") {
        consecutive404s = 0;
        stats.skipped++;
      } else if (status === "404") {
        consecutive404s++;
        stats.not_found++;
      } else {
        stats.errors++;
        console.log(`[!] ${category}/${id}: ${status}`);
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY_LIMIT }, () => worker());
  await Promise.all(workers);

  if (bounds.maxConsecutive404 !== null && consecutive404s >= bounds.maxConsecutive404) {
    console.log(`[i] Auto-stopped ${category} early after ${consecutive404s} consecutive 404s.`);
  }

  console.log(
    `Finished ${category}: ${stats.downloaded} downloaded, ${stats.skipped} skipped, ${stats.not_found} missing.`,
  );
}

// ---------------------------------------------------------
// 2. Logic for Named Strings (/jogar/img/...)
// ---------------------------------------------------------
async function processNamedCategory(category: string, namesArray: string[]) {
  const folderPath = path.join(OUTPUT_BASE_DIR, category);
  await fs.mkdir(folderPath, { recursive: true });

  console.log(`\n--- Starting Named Category: [${category.toUpperCase()}] ---`);

  let currentIndex = 0;
  const stats = { downloaded: 0, skipped: 0, not_found: 0, errors: 0 };

  async function worker() {
    while (currentIndex < namesArray.length) {
      const name = namesArray[currentIndex++];
      const baseUrl = `${IMG_BASE_URL}/${category}/${name}.png`;
      const filePath = path.join(folderPath, `${name}.png`);

      const status = await fetchAndSave(baseUrl, filePath);

      if (status === "success") {
        stats.downloaded++;
        console.log(`[+] Downloaded ${category}/${name}.png`);
      } else if (status === "skipped") {
        stats.skipped++;
      } else if (status === "404") {
        stats.not_found++;
        // Print 404s for named arrays so you know if you guessed a name wrong
        console.log(`[-] Missing ${category}/${name}.png`);
      } else {
        stats.errors++;
        console.log(`[!] ${category}/${name}: ${status}`);
      }
    }
  }

  // Use smaller concurrency if the array is small
  const limit = Math.min(CONCURRENCY_LIMIT, namesArray.length);
  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);

  console.log(
    `Finished ${category}: ${stats.downloaded} downloaded, ${stats.skipped} skipped, ${stats.not_found} missing.`,
  );
}

// ---------------------------------------------------------
// 3. Logic for the list-driven objectanim strips (Task 1.8)
// ---------------------------------------------------------

/** PNG IHDR `[width, height]` (big-endian u32 at bytes 16/20), or null when the
 *  buffer is not a PNG. */
function pngSize(buffer: Buffer): [number, number] | null {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

/** Local static tile sprite size (`packages/client/things/object/<id>.png`), read from
 *  the 24-byte header, or null when the file is missing. */
function objectSpriteSize(id: number): [number, number] | null {
  let fd: number | null = null;
  try {
    fd = fsSync.openSync(path.join(OBJECT_DIR, `${id}.png`), "r");
    const buffer = Buffer.alloc(24);
    const read = fsSync.readSync(fd, buffer, 0, 24, 0);
    return pngSize(read < 24 ? buffer.subarray(0, read) : buffer);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      fsSync.closeSync(fd);
    }
  }
}

/**
 * Fetch `/api/things/objectanim/<id>.png?v=2` and KEEP it only when it is a
 * genuine TILE animation strip: 32 px tall (the tile frame height), wider than
 * one tile and owned by an id whose static `object/<id>.png` is itself a 32×32
 * tile. Everything else is not drawable on the arena's single-tile grid and is
 * reported as "static":
 *   - 32×32        → the id is static, `object/<id>.png` already covers it
 *   - 64×64/64×32  → a 2×2 / 2×1 static object (not a frame strip)
 *   - <N>×64       → an animation of a 2×2 object (needs 64-px frames)
 * Existing files are skipped (they already passed this check).
 */
async function downloadObjectAnim(id: number) {
  const filePath = path.join(OBJECTANIM_DIR, `${id}.png`);

  if (fsSync.existsSync(filePath)) {
    return "skipped";
  }

  const url = `${API_THINGS_URL}/objectanim/${id}.png?v=2`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });

    if (response.status !== 200) {
      return response.status === 404 ? "404" : `HTTP_${response.status}`;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const size = pngSize(buffer);
    const base = objectSpriteSize(id);
    const tileStrip =
      size !== null &&
      size[1] === 32 &&
      size[0] > 32 &&
      base !== null &&
      base[0] === 32 &&
      base[1] === 32;
    if (!tileStrip) {
      // Static id — never keep the copy (unlink is a no-op when nothing was written).
      await fs.unlink(filePath).catch(() => {});
      return "static";
    }

    await fs.writeFile(filePath, buffer);
    return "animated";
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function processObjectAnimCategory() {
  if (!fsSync.existsSync(OBJECTANIM_IDS_PATH)) {
    console.log(
      `\n--- Skipping Category: [OBJECTANIM] (${OBJECTANIM_IDS_PATH} not found — run npm run gen:huntmaps) ---`,
    );
    return;
  }

  await fs.mkdir(OBJECTANIM_DIR, { recursive: true });

  const parsed = JSON.parse(fsSync.readFileSync(OBJECTANIM_IDS_PATH, "utf-8"));
  const ids = [...new Set([...(parsed.grounds ?? []), ...(parsed.objects ?? [])])].sort(
    (a, b) => a - b,
  );

  console.log(`\n--- Starting Category: [OBJECTANIM] (${ids.length} sprite ids) ---`);

  let currentIndex = 0;
  const stats = { animated: 0, static: 0, missing: 0, skipped: 0, errors: 0 };

  async function worker() {
    while (currentIndex < ids.length) {
      const id = ids[currentIndex++];
      const status = await downloadObjectAnim(id);

      if (status === "animated") {
        stats.animated++;
        console.log(`[+] Downloaded objectanim/${id}.png`);
      } else if (status === "static") {
        stats.static++;
      } else if (status === "skipped") {
        stats.skipped++;
      } else if (status === "404") {
        stats.missing++;
      } else {
        stats.errors++;
        console.log(`[!] objectanim/${id}: ${status}`);
      }
    }
  }

  const limit = Math.min(CONCURRENCY_LIMIT, ids.length);
  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);

  console.log(
    `Finished objectanim: animated: ${stats.animated}, static: ${stats.static}, ` +
      `missing: ${stats.missing} (skipped: ${stats.skipped}, errors: ${stats.errors}).`,
  );
}

// ---------------------------------------------------------
// Main Execution
// ---------------------------------------------------------
async function main() {
  // 1. Process the hunt-map animated strips (list-driven objectanim, Task 1.8) —
  //    first so the small, targeted category reports even if the full-range
  //    numeric scan below is interrupted.
  await processObjectAnimCategory();

  // 2. Process named images (Elements, Conditions, etc.)
  for (const [category, namesArray] of Object.entries(CONFIG_NAMED)) {
    await processNamedCategory(category, namesArray);
  }

  // 3. Process numerical IDs (Outfits, Effects, etc.)
  for (const [category, bounds] of Object.entries(CONFIG_NUMERIC)) {
    await processNumericCategory(category, bounds);
  }

  console.log("\nAll asset downloads finished!");
}

main().catch(console.error);
