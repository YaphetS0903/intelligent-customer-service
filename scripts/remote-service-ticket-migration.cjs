const fs = require("node:fs");
const mysql = require("mysql2/promise");

function loadEnvFile(path) {
  const text = fs.readFileSync(path, "utf8");

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const index = normalized.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = normalized.slice(0, index).trim();
    let value = normalized.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  loadEnvFile(".env.local");

  const db = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || "3306"),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    timezone: "Z"
  });

  const statements = [
    "alter table service_tickets add column due_at datetime null",
    "alter table service_tickets add column resolved_at datetime null",
    "alter table service_tickets add index service_tickets_due_at_idx (due_at)",
    `create table if not exists service_ticket_comments (
      id varchar(128) primary key,
      ticket_id varchar(128) not null,
      author_id varchar(128) not null,
      author_role varchar(32) not null,
      body mediumtext not null,
      is_internal tinyint(1) not null default 0,
      created_at datetime not null default current_timestamp,
      index service_ticket_comments_ticket_id_idx (ticket_id),
      index service_ticket_comments_created_at_idx (created_at)
    )`
  ];

  for (const statement of statements) {
    try {
      await db.query(statement);
      console.log("applied", statement.split("\n")[0]);
    } catch (error) {
      if (["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME", "ER_TABLE_EXISTS_ERROR"].includes(error.code)) {
        console.log("exists", statement.split("\n")[0]);
        continue;
      }
      throw error;
    }
  }

  await db.end();
  console.log("service ticket migration ok");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
