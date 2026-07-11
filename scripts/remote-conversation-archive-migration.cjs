const fs = require("fs");
const mysql = require("mysql2/promise");

function readEnv(path) {
  const output = {};

  if (!fs.existsSync(path)) {
    return output;
  }

  for (const rawLine of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    output[key] = value;
  }

  return output;
}

async function safeQuery(connection, sql, ignorableCodes) {
  try {
    await connection.query(sql);
  } catch (error) {
    if (!ignorableCodes.includes(error.code)) {
      throw error;
    }
  }
}

async function main() {
  const env = {
    ...readEnv(".env"),
    ...readEnv(".env.local"),
    ...process.env
  };

  const connection = await mysql.createConnection({
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT || 3306),
    database: env.MYSQL_DATABASE,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    connectTimeout: 10000
  });

  await safeQuery(connection, "alter table conversations add column archived_at datetime null", ["ER_DUP_FIELDNAME"]);
  await safeQuery(connection, "alter table conversations add index conversations_archived_at_idx (archived_at)", ["ER_DUP_KEYNAME"]);

  const [columns] = await connection.query("show columns from conversations like 'archived_at'");
  await connection.end();

  console.log(JSON.stringify({ archived_at_column_ready: columns.length > 0 }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
