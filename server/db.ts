import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "NEON_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

if (process.env.NEON_DATABASE_URL) {
  console.log('✅ Using shared Neon database (NEON_DATABASE_URL)');
} else if (process.env.DATABASE_URL) {
  console.log('⚠️ Using local database (DATABASE_URL) - Consider setting NEON_DATABASE_URL for shared data');
}

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle({ client: pool, schema });
