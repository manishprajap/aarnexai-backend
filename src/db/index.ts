/* import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

const poolConnection = mysql.createPool({
  uri: process.env.DATABASE_URL,
});

export const db = drizzle(poolConnection, { schema, mode: 'default' }); */


import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';


declare global {
  // eslint-disable-next-line no-var
  var __mysqlPool: mysql.Pool | undefined;
}

const pool =
  global.__mysqlPool ??
  mysql.createPool({
    uri: process.env.DATABASE_URL,
    connectionLimit: 10,        // max simultaneous connections in the pool
    waitForConnections: true,   // queue requests instead of throwing immediately
    queueLimit: 0,               // 0 = unlimited queued requests (waitForConnections still applies)
    connectTimeout: 10000,      // fail fast (10s) instead of hanging indefinitely
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });

if (process.env.NODE_ENV !== 'production') {
  global.__mysqlPool = pool;
}

export const db = drizzle(pool, { schema, mode: 'default' });