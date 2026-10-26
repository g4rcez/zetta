/** The raw driver, for code that must open its own connections (bot databases log in as their own role). */
export { Pool, type PoolClient, type QueryResult } from "pg";
