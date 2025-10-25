import { db } from '../db';
import { strategies, tradeSessions } from '../../shared/schema';
import { eq } from 'drizzle-orm';

async function checkSession() {
  const targetSessionId = '0e2da39e-7b40-4f20-9f34-324a6bcc48f8';

  // Check if session exists
  const session = await db.select().from(tradeSessions).where(eq(tradeSessions.id, targetSessionId));
  console.log('Session:', session[0] ? { id: session[0].id, strategyId: session[0].strategyId, isActive: session[0].isActive } : 'NOT FOUND');

  if (session[0]) {
    // Check if strategy exists
    const strategy = await db.select().from(strategies).where(eq(strategies.id, session[0].strategyId));
    console.log('Strategy:', strategy[0] ? { id: strategy[0].id, name: strategy[0].name } : 'NOT FOUND');
  }

  process.exit(0);
}

checkSession();
