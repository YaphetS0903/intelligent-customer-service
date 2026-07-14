import { existsSync } from "fs";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

type TableRow = RowDataPacket & { tableName: string };

export default async function globalTeardown() {
  if (existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }

  if (process.env.E2E_ALLOW_DATABASE_WRITE !== "true") {
    throw new Error("拒绝清理数据库：E2E_ALLOW_DATABASE_WRITE 未显式开启");
  }

  const database = process.env.MYSQL_DATABASE ?? "";
  if (!/(test|ci|e2e)/i.test(database)) {
    throw new Error("拒绝清理数据库：数据库名必须包含 test、ci 或 e2e");
  }

  if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER) {
    return;
  }

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT ?? "3306"),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database,
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS ?? "10000")
  });

  try {
    const [rows] = await connection.query<TableRow[]>(
      "select table_name as tableName from information_schema.tables where table_schema = ? and table_type = 'BASE TABLE'",
      [database]
    );
    await connection.query("set foreign_key_checks = 0");
    for (const { tableName } of rows) {
      await connection.query(`truncate table ${mysql.escapeId(tableName)}`);
    }
  } finally {
    await connection.query("set foreign_key_checks = 1").catch(() => undefined);
    await connection.end();
  }
}
