import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from "@shared/schema";

const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "NEON_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

if (process.env.NEON_DATABASE_URL) {
  console.log('✅ Using shared Neon database (NEON_DATABASE_URL) with HTTP driver');
} else if (process.env.DATABASE_URL) {
  console.log('⚠️ Using local database (DATABASE_URL) - Consider setting NEON_DATABASE_URL for shared data');
}

const sql = neon(databaseUrl);
export const db = drizzle({ client: sql, schema });
