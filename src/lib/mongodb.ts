/**
 * MongoDB client for Next.js
 * Uses lazy Promise-based singleton to prevent connection pool exhaustion
 * without connecting at module load time (which breaks Next.js builds)
 */
import { MongoClient, Db } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE || 'inspired_analyst';

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  if (!uri) {
    throw new Error('MONGODB_URI is required in .env');
  }
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    global._mongoClientPromise = client.connect();
  }
  return global._mongoClientPromise;
}

async function connect(): Promise<{ client: MongoClient; db: Db }> {
  const mongoClient = await getClientPromise();
  const db = mongoClient.db(dbName);
  return { client: mongoClient, db };
}

export async function getDb(): Promise<Db> {
  const { db } = await connect();
  return db;
}

export async function getMongoClient(): Promise<MongoClient> {
  const { client } = await connect();
  return client;
}

/** Convert _id to id for API responses (MongoDB uses _id, app expects id) */
export function toApiDoc<T extends { _id?: unknown }>(doc: T | null): (Omit<T, '_id'> & { id: string }) | null {
  if (!doc) return null;
  const { _id, ...rest } = doc as T & { _id: string };
  return { ...rest, id: _id ?? (doc as { id?: string }).id } as Omit<T, '_id'> & { id: string };
}

/** Convert array of docs */
export function toApiDocs<T extends { _id?: unknown }>(docs: T[]): (Omit<T, '_id'> & { id: string })[] {
  return docs.map((d) => toApiDoc(d)!).filter(Boolean);
}

export default { getDb, getMongoClient, toApiDoc, toApiDocs };
