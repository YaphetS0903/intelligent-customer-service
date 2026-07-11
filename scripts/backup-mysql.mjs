#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import mysql from "mysql2/promise";

const cwd = process.cwd();
const envFile = process.env.ENV_FILE || ".env.local";
const fileEnv = readEnvFile(path.resolve(cwd, envFile));
const backupDir = process.env.BACKUP_DIR || "./backups/mysql";
const keepDays = readPositiveInt(process.env.KEEP_DAYS, 14);
const backupStateFile = process.env.BACKUP_STATE_FILE || "./.ops/mysql-backup-last-success.json";
const backupTimeoutSeconds = readPositiveInt(process.env.BACKUP_TIMEOUT_SECONDS, 300);
const queryTimeoutMs = readPositiveInt(process.env.BACKUP_QUERY_TIMEOUT_MS, 30000);

const config = {
  host: readConfig("MYSQL_HOST"),
  port: Number(readConfig("MYSQL_PORT") || "3306"),
  database: readConfig("MYSQL_DATABASE"),
  user: readConfig("MYSQL_USER"),
  password: readConfig("MYSQL_PASSWORD")
};

let connection = null;
let tmpTarget = "";

const timeout = setTimeout(() => {
  void cleanupAfterFailure();
  console.error(`ERROR: MySQL backup failed or timed out after ${backupTimeoutSeconds}s.`);
  connection?.destroy();
  process.exit(1);
}, backupTimeoutSeconds * 1000);

try {
  await run();
} catch (error) {
  await cleanupAfterFailure();
  console.error(`ERROR: ${error instanceof Error ? error.stack || error.message : "MySQL backup failed."}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await connection?.end().catch(() => {});
}

async function run() {
  if (!config.host || !config.database || !config.user) {
    throw new Error("MYSQL_HOST, MYSQL_DATABASE and MYSQL_USER are required.");
  }

  const resolvedBackupDir = path.resolve(cwd, backupDir);
  await fsp.mkdir(resolvedBackupDir, { recursive: true });

  const timestamp = formatTimestamp(new Date());
  const target = path.join(resolvedBackupDir, `${config.database}-${timestamp}.sql.gz`);
  tmpTarget = `${target}.tmp`;

  console.log(`==> Backing up ${config.database} to ${target}`);
  await fsp.rm(tmpTarget, { force: true });

  connection = await mysql.createConnection({
    ...config,
    connectTimeout: 15000,
    namedPlaceholders: false,
    timezone: "Z"
  });

  const output = fs.createWriteStream(tmpTarget, { mode: 0o600 });
  const gzip = zlib.createGzip({ level: 9 });
  gzip.pipe(output);

  const finish = new Promise((resolve, reject) => {
    output.on("finish", resolve);
    output.on("error", reject);
    gzip.on("error", reject);
  });

  await write(gzip, `-- Tianrui MySQL logical backup\n`);
  await write(gzip, `-- Database: ${config.database}\n`);
  await write(gzip, `-- Generated at: ${new Date().toISOString()}\n\n`);
  await write(gzip, "SET FOREIGN_KEY_CHECKS=0;\n");
  await write(gzip, "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n");

  const tables = await listTables();
  console.log(`==> Found ${tables.length} tables`);
  for (const table of tables) {
    console.log(`==> Dumping schema: ${table}`);
    await dumpTableSchema(gzip, table);
  }

  for (const table of tables) {
    console.log(`==> Dumping data: ${table}`);
    await dumpTableRows(gzip, table);
  }

  await write(gzip, "SET FOREIGN_KEY_CHECKS=1;\n");
  gzip.end();
  await finish;

  await fsp.chmod(tmpTarget, 0o600);
  await fsp.rename(tmpTarget, target);

  console.log(`==> Removing backups older than ${keepDays} days`);
  await removeOldBackups(resolvedBackupDir, keepDays);

  const resolvedStateFile = path.resolve(cwd, backupStateFile);
  await fsp.mkdir(path.dirname(resolvedStateFile), { recursive: true });
  await fsp.writeFile(
    resolvedStateFile,
    `${JSON.stringify({
      checkedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      database: config.database,
      target
    }, null, 2)}\n`,
    { mode: 0o600 }
  );
  await fsp.chmod(resolvedStateFile, 0o600);

  console.log(`==> Backup complete: ${target}`);
}

function readConfig(key) {
  return process.env[key] || fileEnv[key] || "";
}

function readEnvFile(filePath) {
  try {
    const entries = {};
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separator = trimmed.indexOf("=");
      if (separator <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      entries[key] = value;
    }

    return entries;
  } catch {
    return {};
  }
}

async function listTables() {
  const [rows] = await connection.query(
    {
      sql: `
        select table_name
        from information_schema.tables
        where table_schema = ? and table_type = 'BASE TABLE'
        order by table_name asc
      `,
      timeout: queryTimeoutMs
    },
    [config.database]
  );

  return rows.map((row) => row.TABLE_NAME || row.table_name);
}

async function dumpTableSchema(gzip, table) {
  const [rows] = await connection.query({
    sql: `show create table ${quoteIdentifier(table)}`,
    timeout: queryTimeoutMs
  });
  const createTable = rows[0]?.["Create Table"];
  if (!createTable) {
    throw new Error(`Failed to read schema for ${table}`);
  }

  await write(gzip, `\n--\n-- Table structure for ${quoteIdentifier(table)}\n--\n`);
  await write(gzip, `DROP TABLE IF EXISTS ${quoteIdentifier(table)};\n`);
  await write(gzip, `${createTable};\n`);
}

async function dumpTableRows(gzip, table) {
  const [rows] = await connection.query({
    sql: `select * from ${quoteIdentifier(table)}`,
    timeout: queryTimeoutMs,
    rowsAsArray: false
  });

  await write(gzip, `\n--\n-- Data for ${quoteIdentifier(table)} (${rows.length} rows)\n--\n`);
  if (rows.length === 0) {
    return;
  }

  const columns = Object.keys(rows[0]);
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const batchSize = 100;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const valuesSql = batch
      .map((row) => `(${columns.map((column) => encodeSqlValue(row[column])).join(", ")})`)
      .join(",\n");
    await write(gzip, `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES\n${valuesSql};\n`);
  }
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

function encodeSqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (Buffer.isBuffer(value)) {
    return `X'${value.toString("hex")}'`;
  }

  if (value instanceof Date) {
    return quoteString(value.toISOString().slice(0, 19).replace("T", " "));
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  if (typeof value === "object") {
    return quoteString(JSON.stringify(value));
  }

  return quoteString(String(value));
}

function quoteString(value) {
  return `'${value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\x1a/g, "\\Z")}'`;
}

function write(stream, chunk) {
  return new Promise((resolve, reject) => {
    if (stream.write(chunk, "utf8", reject)) {
      resolve();
      return;
    }

    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function removeOldBackups(directory, days) {
  const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
  const oldestAllowed = Date.now() - days * 24 * 60 * 60 * 1000;

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql.gz"))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const stats = await fsp.stat(filePath);
        if (stats.mtime.getTime() < oldestAllowed) {
          await fsp.rm(filePath, { force: true });
        }
      })
  );
}

async function cleanupAfterFailure() {
  if (tmpTarget) {
    await fsp.rm(tmpTarget, { force: true }).catch(() => {});
  }
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
