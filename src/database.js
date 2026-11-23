require("dotenv").config();

const { MongoClient } = require("mongodb");

const databaseName = process.env.MONGODB_DATABASE || "pop-figure-api-main";
const collectionName = process.env.MONGODB_COLLECTION || "Pop";

let client;

async function connectDatabase() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  }
  const collection = client.db(databaseName).collection(collectionName);
  await collection.createIndex({ popNumber: 1 }, { unique: true });
  return collection;
}

async function closeDatabase() {
  if (client) {
    await client.close();
    client = undefined;
  }
}

module.exports = { connectDatabase, closeDatabase };
