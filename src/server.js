require("dotenv").config();

const express = require("express");
const path = require("node:path");
const { connectDatabase } = require("./database");

const app = express();
const port = Number(process.env.PORT || 3000);
const githubOwner = process.env.GITHUB_OWNER || "ramojasm";
const githubRepository = process.env.GITHUB_REPO || "pop-figure-api";
const githubFile = process.env.GITHUB_FILE || "data/figures.json";
const githubBranch = process.env.GITHUB_BRANCH || "main";
let figuresCollection;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function validateFigure(input, partial = false) {
  const allowed = [
    "popNumber", "name", "releaseYear", "releaseYearEstimated", "category",
    "franchise", "imageUrl", "retailPrice", "resalePrice"
  ];
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) return `Unknown field(s): ${unknown.join(", ")}`;

  const required = ["popNumber", "name", "releaseYear", "category", "franchise"];
  if (!partial) {
    const missing = required.filter((key) => input[key] === undefined);
    if (missing.length) return `Missing required field(s): ${missing.join(", ")}`;
  }

  if (input.popNumber !== undefined && !/^[0-9]+$/.test(String(input.popNumber))) {
    return "popNumber must contain digits only";
  }
  if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim())) {
    return "name must be a non-empty string";
  }
  if (input.releaseYear !== undefined && (!Number.isInteger(input.releaseYear) || input.releaseYear < 1900)) {
    return "releaseYear must be an integer of 1900 or later";
  }
  for (const field of ["category", "franchise"]) {
    if (input[field] !== undefined && (typeof input[field] !== "string" || !input[field].trim())) {
      return `${field} must be a non-empty string`;
    }
  }
  if (input.imageUrl !== undefined) {
    if (typeof input.imageUrl !== "string" || !input.imageUrl.trim()) {
      return "imageUrl must be a non-empty URL";
    }
    for (const field of ["retailPrice", "resalePrice"]) {
      if (input[field] !== undefined
        && (!Number.isFinite(input[field]) || input[field] < 0)) {
        return `${field} must be a non-negative number`;
      }
    }
    try {
      const imageUrl = new URL(input.imageUrl);
      if (!["http:", "https:"].includes(imageUrl.protocol)) {
        return "imageUrl must use http or https";
      }
    } catch {
      return "imageUrl must be a valid URL";
    }
  }
  if (input.releaseYearEstimated !== undefined && typeof input.releaseYearEstimated !== "boolean") {
    return "releaseYearEstimated must be a boolean";
  }
  return null;
}

function normalizeFigure(input) {
  return {
    popNumber: String(input.popNumber),
    name: input.name.trim(),
    releaseYear: input.releaseYear,
    ...(input.releaseYearEstimated ? { releaseYearEstimated: true } : {}),
    category: input.category.trim(),
    franchise: input.franchise.trim(),
    ...(input.imageUrl ? { imageUrl: input.imageUrl.trim() } : {}),
    ...(input.retailPrice !== undefined ? { retailPrice: input.retailPrice } : {}),
    ...(input.resalePrice !== undefined ? { resalePrice: input.resalePrice } : {})
  };
}

class GithubSyncError extends Error {
  statusCode = 502;
}

async function syncFiguresToGitHub() {
  if (!process.env.GITHUB_TOKEN) {
    throw new GithubSyncError("GitHub sync is not configured: GITHUB_TOKEN is required");
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(githubOwner)}`
    + `/${encodeURIComponent(githubRepository)}/contents/${githubFile}`;
  const fileResponse = await fetch(`${apiUrl}?ref=${encodeURIComponent(githubBranch)}`, { headers });
  if (!fileResponse.ok) {
    throw new GithubSyncError(`Could not read GitHub file (${fileResponse.status})`);
  }
  const file = await fileResponse.json();
  const figures = await figuresCollection.find({}, { projection: { _id: 0 } })
    .sort({ popNumber: 1 })
    .toArray();
  const content = `${JSON.stringify(figures, null, 2)}\n`;
  const updateResponse = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Update figures from API",
      content: Buffer.from(content).toString("base64"),
      sha: file.sha,
      branch: githubBranch
    })
  });
  if (!updateResponse.ok) {
    throw new GithubSyncError(`Could not update GitHub file (${updateResponse.status})`);
  }
}

async function syncWithWarning() {
  try {
    await syncFiguresToGitHub();
    return null;
  } catch (error) {
    console.error("GitHub sync failed after MongoDB update:", error);
    return error.message;
  }
}

app.get("/health", (_req, res) => {
  res.json({
    status: figuresCollection ? "ok" : "starting",
    githubSync: Boolean(process.env.GITHUB_TOKEN)
  });
});

app.get("/figures", async (req, res, next) => {
  if (!figuresCollection) return res.status(503).json({ error: "Database is not connected" });
  const { search, category, franchise, releaseYear } = req.query;
  const page = Math.max(Number.parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "50", 10), 1), 100);
  const query = String(search || "").trim();
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  try {
    const filter = {};
    if (query) {
      filter.$or = [
        { popNumber: { $regex: escapedQuery, $options: "i" } },
        { name: { $regex: escapedQuery, $options: "i" } },
        { category: { $regex: escapedQuery, $options: "i" } },
        { franchise: { $regex: escapedQuery, $options: "i" } }
      ];
    }
    if (category) filter.category = String(category);
    if (franchise) filter.franchise = String(franchise);
    if (releaseYear) filter.releaseYear = Number(releaseYear);

    const total = await figuresCollection.countDocuments(filter);
    const data = await figuresCollection.find(filter)
      .skip((page - 1) * limit)
      .limit(limit)
      .project({ _id: 0 })
      .toArray();
    return res.json({
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/figures/:popNumber", async (req, res, next) => {
  if (!figuresCollection) return res.status(503).json({ error: "Database is not connected" });
  try {
    const figure = await figuresCollection.findOne(
      { popNumber: req.params.popNumber },
      { projection: { _id: 0 } }
    );
    if (!figure) return res.status(404).json({ error: "Figure not found" });
    return res.json(figure);
  } catch (error) {
    return next(error);
  }
});

app.post("/figures", async (req, res, next) => {
  if (!figuresCollection) return res.status(503).json({ error: "Database is not connected" });
  const error = validateFigure(req.body);
  if (error) return res.status(400).json({ error });
  const figure = normalizeFigure(req.body);
  try {
    if (await figuresCollection.findOne({ popNumber: figure.popNumber })) {
      return res.status(409).json({ error: "A figure with that popNumber already exists" });
    }
    await figuresCollection.insertOne(figure);
    await syncWithWarning();
    return res.status(201).json(figure);
  } catch (saveError) {
    return next(saveError);
  }
});

app.patch("/figures/:popNumber", async (req, res, next) => {
  if (!figuresCollection) return res.status(503).json({ error: "Database is not connected" });
  const error = validateFigure(req.body, true);
  if (error) return res.status(400).json({ error });
  try {
    const current = await figuresCollection.findOne({ popNumber: req.params.popNumber });
    if (!current) return res.status(404).json({ error: "Figure not found" });
    const updated = normalizeFigure({ ...current, ...req.body });
    if (updated.popNumber !== req.params.popNumber
      && await figuresCollection.findOne({ popNumber: updated.popNumber })) {
      return res.status(409).json({ error: "A figure with that popNumber already exists" });
    }
    await figuresCollection.replaceOne({ popNumber: req.params.popNumber }, updated);
    await syncWithWarning();
    return res.json(updated);
  } catch (saveError) {
    return next(saveError);
  }
});

app.delete("/figures/:popNumber", async (req, res, next) => {
  if (!figuresCollection) return res.status(503).json({ error: "Database is not connected" });
  try {
    const result = await figuresCollection.deleteOne({ popNumber: req.params.popNumber });
    if (!result.deletedCount) return res.status(404).json({ error: "Figure not found" });
    await syncWithWarning();
    return res.status(204).send();
  } catch (saveError) {
    return next(saveError);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.statusCode || 500).json({
    error: error.statusCode === 502
      ? error.message
      : "Could not save your collection. Make sure only one API server is running and try again."
  });
});

async function start() {
  figuresCollection = await connectDatabase();
  if (!process.env.GITHUB_TOKEN) {
    console.warn("GitHub sync is disabled because GITHUB_TOKEN is not set");
  }
  app.listen(port, () => console.log(
    `Pop figure API listening on port ${port} with MongoDB connected`
  ));
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Could not connect to MongoDB", error);
    process.exitCode = 1;
  });
}

module.exports = { app, validateFigure, normalizeFigure };
