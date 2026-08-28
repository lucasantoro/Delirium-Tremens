import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const achievementDirectory = path.join(rootDirectory, "content", "guides", "achievements");
const raidDirectory = path.join(rootDirectory, "content", "guides", "raids");
const raidAddonsFile = path.join(rootDirectory, "content", "guides", "raid-addons.json");
const outputFile = path.join(rootDirectory, "data", "guides-manifest.json");

const achievementGuides = await readAchievementGuides();
const raidGuides = await readRaidGuides();
const raidAddonsGuide = await readRaidAddonsGuide();
const guides = [...achievementGuides, ...raidGuides, ...(raidAddonsGuide ? [raidAddonsGuide] : [])];
assertUniqueIds(guides);

const manifest = {
  schemaVersion: 1,
  categories: [
    {
      id: "achievement",
      title: "Achievement e collezioni",
      description: "Glory, cavalcature e obiettivi organizzati boss per boss."
    },
    {
      id: "raid",
      title: "Raid",
      description: "Fight, preparazione e strumenti obbligatori per arrivare pronti al raid."
    }
  ],
  guides: guides.sort((left, right) => {
    if (left.type !== right.type) return left.type.localeCompare(right.type, "it");
    return left.title.localeCompare(right.title, "it");
  })
};

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Guide indicizzate: ${achievementGuides.length} achievement, ${raidGuides.length} PDF raid, ${raidAddonsGuide ? 1 : 0} raccolte addon.`);

async function readAchievementGuides() {
  const entries = await readDirectorySafe(achievementDirectory);
  const guides = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
    const absolutePath = path.join(achievementDirectory, entry.name);
    const payload = JSON.parse(await fs.readFile(absolutePath, "utf8"));
    validateAchievementGuide(payload, entry.name);
    const relativeSource = toWebPath(path.relative(rootDirectory, absolutePath));

    guides.push({
      id: payload.id,
      type: "achievement",
      title: payload.title,
      subtitle: payload.subtitle || "",
      summary: payload.summary || "",
      expansion: payload.expansion || "",
      instance: payload.instance || "",
      updated: payload.updated || "",
      badge: payload.badge || "Achievement",
      coverImage: payload.cover?.image || "",
      source: relativeSource,
      href: `pages/guide-detail.html?id=${encodeURIComponent(payload.id)}`
    });
  }
  return guides;
}

async function readRaidGuides() {
  const files = await findFilesRecursive(raidDirectory, ".pdf");
  const guides = [];

  for (const absolutePath of files) {
    const title = path.basename(absolutePath, path.extname(absolutePath));
    const id = slugify(title);
    const relativeRaidPath = path.relative(raidDirectory, absolutePath);
    const sectionDirectory = relativeRaidPath.split(path.sep)[0].toLowerCase();
    const section = sectionDirectory === "preparation" ? "preparation" : "fights";
    const [stats, bytes] = await Promise.all([fs.stat(absolutePath), fs.readFile(absolutePath)]);

    guides.push({
      id,
      type: "raid",
      section,
      title,
      subtitle: section === "preparation" ? "Attività prima del raid" : "Guida ai fight",
      summary: section === "preparation"
        ? "Procedura da completare prima del raid, consultabile pagina per pagina."
        : "Strategie Normal e Heroic consultabili pagina per pagina.",
      badge: section === "preparation" ? "Preparazione" : "Fight",
      file: toWebPath(path.relative(rootDirectory, absolutePath)),
      href: `pages/guide-raid.html?id=${encodeURIComponent(id)}`,
      pages: countPdfPages(bytes),
      sizeBytes: stats.size
    });
  }
  return guides;
}

async function readRaidAddonsGuide() {
  try {
    const payload = JSON.parse(await fs.readFile(raidAddonsFile, "utf8"));
    if (!payload?.title || !Array.isArray(payload.addons) || !payload.addons.length) {
      throw new Error("raid-addons.json: servono title e almeno un addon");
    }
    return {
      id: "addon-obbligatori-raid",
      type: "raid",
      section: "addons",
      title: payload.title,
      subtitle: "Configurazione minima del raider",
      summary: payload.summary || "Gli addon che ogni raider deve installare e mantenere aggiornati.",
      badge: "Addon",
      source: toWebPath(path.relative(rootDirectory, raidAddonsFile)),
      href: "pages/guide-raid-addons.html"
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function findFilesRecursive(directory, extension) {
  const entries = await readDirectorySafe(directory);
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findFilesRecursive(absolutePath, extension));
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === extension) files.push(absolutePath);
  }
  return files;
}

async function readDirectorySafe(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function validateAchievementGuide(payload, filename) {
  for (const key of ["id", "title", "summary", "bosses"]) {
    if (!payload?.[key] || (key === "bosses" && !Array.isArray(payload.bosses))) {
      throw new Error(`${filename}: campo obbligatorio non valido: ${key}`);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(payload.id)) {
    throw new Error(`${filename}: id deve contenere solo lettere minuscole, numeri e trattini`);
  }
  if (!payload.bosses.length) {
    throw new Error(`${filename}: inserire almeno un boss`);
  }
}

function assertUniqueIds(guides) {
  const seen = new Set();
  for (const guide of guides) {
    if (seen.has(guide.id)) throw new Error(`ID guida duplicato: ${guide.id}`);
    seen.add(guide.id);
  }
}

function countPdfPages(bytes) {
  const source = bytes.toString("latin1");
  return (source.match(/\/Type\s*\/Page\b/g) || []).length || null;
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "guida-raid";
}

function toWebPath(value) {
  return value.split(path.sep).join("/");
}
