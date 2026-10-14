import mysql from "mysql2/promise";

const globalForDb = globalThis as unknown as { pool?: mysql.Pool };

export const pool =
  globalForDb.pool ??
  mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl:
      process.env.DB_SSL === "true"
        ? {
            ca: process.env.DB_CA?.replace(/\\n/g, "\n"),
            rejectUnauthorized: true,
          }
        : undefined,
    connectionLimit: 3,
    waitForConnections: true,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;