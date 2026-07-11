#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import mysql from "mysql2/promise";

const cwd = process.cwd();
const envFile = process.env.ENV_FILE || ".env.local";
const fileEnv = readEnvFile(path.resolve(cwd, envFile));
const backupDir = path.resolve(cwd, process.env.BACKUP_DIR || "./backups/mysql");
const backupStateFile = path.resolve(cwd, process.env.BACKUP_STATE_FILE || "./.ops/mysql-backup-last-success.json");
const restoreStateFile = path.resolve(cwd, process.env.RESTORE_STATE_FILE || "./.ops/mysql-restore-last-success.json");
const timeoutSeconds = readPositiveInt(process.env.RESTORE_VERIFY_TIMEOUT_SECONDS, 600);
const queryTimeoutMs = readPositiveInt(process.env.RESTORE_QUERY_TIMEOUT_MS, 120_000);
const keepRestoreDatabase = process.env.KEEP_RESTORE_DATABASE === "true";

const config = {
  host: readConfig("MYSQL_HOST"),
  port: Number(readConfig("MYSQL_PORT") || "3306"),
  database: readConfig("MYSQL_DATABASE"),
  user: readConfig("MYSQL_USER"),
  password: readConfig("MYSQL_PASSWORD")
};

let connection = null;
let restoreMode = null;
let restoreDatabase = "";
let restoreTablePrefix = "";
let restorePhysicalTables = [];
let restoreArtifactsRemoved = false;

const timeout = setTimeout(() => {
  console.error(`ERROR: MySQL restore verification timed out after ${timeoutSeconds}s.`);
  connection?.destroy();
  process.exit(1);
}, timeoutSeconds * 1000);

try {
  await run();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.stack || error.message : "MySQL restore verification failed."}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  if (connection && restoreMode && !keepRestoreDatabase && !restoreArtifactsRemoved) {
    await removeRestoreArtifacts().catch(() => {});
  }
  await connection?.end().catch(() => {});
}

async function run() {
  if (!config.host || !config.database || !config.user) {
    throw new Error("MYSQL_HOST, MYSQL_DATABASE and MYSQL_USER are required.");
  }

  const source = await resolveBackupSource(process.argv[2]);
  const compressed = await fsp.readFile(source);
  const sql = zlib.gunzipSync(compressed).toString("utf8");
  if (!sql.includes(`-- Database: ${config.database}`)) {
    throw new Error("Backup metadata does not match MYSQL_DATABASE.");
  }
  const backupRowCounts = extractBackupRowCounts(sql);

  connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    connectTimeout: 15_000,
    multipleStatements: true,
    namedPlaceholders: false,
    timezone: "Z"
  });

  const productionTables = await listTables(config.database);
  const backupTables = [...backupRowCounts.keys()].sort();
  const missingBackupTables = productionTables.filter((table) => !backupRowCounts.has(table));
  const staleBackupTables = backupTables.filter((table) => !productionTables.includes(table));
  if (missingBackupTables.length > 0 || staleBackupTables.length > 0) {
    throw new Error(JSON.stringify({ missingBackupTables, staleBackupTables }));
  }
  let restoreSql = sql;
  restoreDatabase = buildRestoreDatabaseName(config.database);
  console.log(`==> Creating isolated restore database: ${restoreDatabase}`);
  try {
    await query(`create database ${quoteIdentifier(restoreDatabase)} character set utf8mb4 collate utf8mb4_unicode_ci`);
    restoreMode = "isolated_database";
    await connection.changeUser({ database: restoreDatabase });
  } catch (error) {
    if (!isCreateDatabaseDenied(error)) throw error;
    restoreMode = "prefixed_tables";
    restoreDatabase = config.database;
    restoreTablePrefix = buildRestoreTablePrefix();
    restorePhysicalTables = productionTables.map((table) => `${restoreTablePrefix}${table}`);
    restoreSql = renameBackupTables(sql, productionTables, restoreTablePrefix);
    await connection.changeUser({ database: config.database });
    console.log(`==> CREATE DATABASE is not permitted; using isolated table prefix: ${restoreTablePrefix}`);
  }

  console.log(`==> Restoring backup: ${source}`);
  await query(restoreSql);

  const restoredTables = restoreMode === "isolated_database"
    ? await listTables(restoreDatabase)
    : (await listTables(config.database))
        .filter((table) => table.startsWith(restoreTablePrefix))
        .map((table) => table.slice(restoreTablePrefix.length));
  const missingTables = productionTables.filter((table) => !restoredTables.includes(table));
  const extraTables = restoredTables.filter((table) => !productionTables.includes(table));
  const rowCounts = [];

  for (const table of productionTables) {
    const backupRows = backupRowCounts.get(table);
    const restoredTable = restoreMode === "isolated_database" ? table : `${restoreTablePrefix}${table}`;
    const restoredRows = await countRows(restoreDatabase, restoredTable);
    rowCounts.push({ table, backupRows, restoredRows, matches: backupRows === restoredRows });
  }

  const mismatches = rowCounts.filter((item) => !item.matches);
  if (missingTables.length > 0 || extraTables.length > 0 || mismatches.length > 0) {
    throw new Error(JSON.stringify({ missingTables, extraTables, mismatches }));
  }

  const totalRows = rowCounts.reduce((sum, item) => sum + item.restoredRows, 0);
  if (!keepRestoreDatabase) {
    await removeRestoreArtifacts();
  }

  await fsp.mkdir(path.dirname(restoreStateFile), { recursive: true });
  await fsp.writeFile(
    restoreStateFile,
    `${JSON.stringify({
      checkedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      database: config.database,
      source,
      restoreMode,
      restoreDatabase,
      restoreTablePrefix: restoreTablePrefix || null,
      restoreArtifactsRemoved,
      tableCount: restoredTables.length,
      totalRows,
      rowCountMismatches: 0
    }, null, 2)}\n`,
    { mode: 0o600 }
  );
  await fsp.chmod(restoreStateFile, 0o600);

  console.log(`==> Restore verification passed: ${restoredTables.length} tables, ${totalRows} rows`);
  console.log(`==> Temporary restore artifacts ${restoreArtifactsRemoved ? "removed" : "retained"}`);
}

async function removeRestoreArtifacts() {
  if (restoreMode === "isolated_database") {
    await connection.changeUser({ database: config.database });
    await query(`drop database if exists ${quoteIdentifier(restoreDatabase)}`);
  } else if (restoreMode === "prefixed_tables" && restorePhysicalTables.length > 0) {
    await connection.changeUser({ database: config.database });
    await query([
      "set foreign_key_checks=0",
      `drop table if exists ${restorePhysicalTables.map(quoteIdentifier).join(", ")}`,
      "set foreign_key_checks=1"
    ].join("; "));
  }
  restoreArtifactsRemoved = true;
}

async function resolveBackupSource(argument) {
  const requested = argument ? path.resolve(cwd, argument) : await readLatestBackupTarget();
  const relative = path.relative(backupDir, requested);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !requested.endsWith(".sql.gz")) {
    throw new Error(`Backup source must be a .sql.gz file inside ${backupDir}.`);
  }
  const stats = await fsp.stat(requested);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error("Backup source is empty or is not a file.");
  }
  return requested;
}

async function readLatestBackupTarget() {
  const raw = await fsp.readFile(backupStateFile, "utf8");
  const state = JSON.parse(raw);
  if (!state?.target) {
    throw new Error("Latest backup state does not contain a target path.");
  }
  return path.resolve(String(state.target));
}

async function listTables(database) {
  const [rows] = await query(
    `select table_name from information_schema.tables where table_schema = ? and table_type = 'BASE TABLE' order by table_name asc`,
    [database]
  );
  return rows.map((row) => row.TABLE_NAME || row.table_name);
}

async function countRows(database, table) {
  const [rows] = await query(`select count(*) as row_count from ${quoteIdentifier(database)}.${quoteIdentifier(table)}`);
  return Number(rows[0]?.row_count ?? 0);
}

function extractBackupRowCounts(sql) {
  const counts = new Map();
  const pattern = /^-- Data for `((?:``|[^`])+)` \((\d+) rows\)$/gm;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    counts.set(match[1].replace(/``/g, "`"), Number(match[2]));
  }
  if (counts.size === 0) {
    throw new Error("Backup does not contain immutable table row-count metadata.");
  }
  return counts;
}

function query(sql, params = []) {
  return connection.query({ sql, timeout: queryTimeoutMs }, params);
}

function buildRestoreDatabaseName(database) {
  const safe = database.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32) || "app";
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${safe}_restore_verify_${timestamp}_${suffix}`.slice(0, 64);
}

function buildRestoreTablePrefix() {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `_rv_${timestamp}_${suffix}_`;
}

function renameBackupTables(sql, tables, prefix) {
  let renamed = sql;
  for (const table of tables) {
    const source = quoteIdentifier(table);
    const target = quoteIdentifier(`${prefix}${table}`);
    for (const keyword of ["DROP TABLE IF EXISTS", "CREATE TABLE", "INSERT INTO", "REFERENCES"]) {
      renamed = renamed.split(`${keyword} ${source}`).join(`${keyword} ${target}`);
    }
  }
  return renamed;
}

function isCreateDatabaseDenied(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return code === "ER_DBACCESS_DENIED_ERROR" || /access denied.+database/i.test(message);
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

function readConfig(key) {
  return process.env[key] || fileEnv[key] || "";
}

function readEnvFile(filePath) {
  try {
    const entries = {};
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      entries[key] = value;
    }
    return entries;
  } catch {
    return {};
  }
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
