import { neon } from '@neondatabase/serverless'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Go to Vercel → Settings → Environment Variables and add it.')
}

export const sql = neon(connectionString)
