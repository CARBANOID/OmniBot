import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "@/lib/db/schema"

// Reuse the pool across Next.js dev hot-reloads to avoid leaking
// connections on every HMR cycle.
const globalForDb = globalThis as unknown as { neonPool?: Pool }

function createPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL })
}

const pool = globalForDb.neonPool ?? createPool()

if (process.env.NODE_ENV !== "production") {
  globalForDb.neonPool = pool
}

export const db = drizzle(pool, { schema })

export type { Bot, NewBot } from "@/lib/db/schema"
