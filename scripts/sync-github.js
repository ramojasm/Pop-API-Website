const { MongoClient } = require("mongodb");

const databaseName = process.env.MONGODB_DATABASE || "pop-figure-api-main";
const collectionName = process.env.MONGODB_COLLECTION || "Pop";
const owner = process.env.GITHUB_OWNER || "ramojasm";
const repository = process.env.GITHUB_REPO || "pop-figure-api";
const filePath = process.env.GITHUB_FILE || "data/figures.json";
const branch = process.env.GITHUB_BRANCH || "main";

async function sync() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required");

  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const figures = await client.db(databaseName).collection(collectionName)
      .find({}, { projection: { _id: 0 } })
      .sort({ popNumber: 1 })
      .toArray();

    const url = `https://api.github.com/repos/${owner}/${repository}/contents/${filePath}`;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28"
    };
    const currentResponse = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers });
    if (!currentResponse.ok) {
      throw new Error(`Could not read GitHub file (${currentResponse.status})`);
    }
    const currentFile = await currentResponse.json();
    const content = `${JSON.stringify(figures, null, 2)}\n`;
    const updateResponse = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Sync figures from MongoDB",
        content: Buffer.from(content).toString("base64"),
        sha: currentFile.sha,
        branch
      })
    });
    if (!updateResponse.ok) {
      throw new Error(`Could not update GitHub file (${updateResponse.status})`);
    }
    console.log(`Synced ${figures.length} figures to ${owner}/${repository}:${branch}/${filePath}`);
  } finally {
    await client.close();
  }
}

sync().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
