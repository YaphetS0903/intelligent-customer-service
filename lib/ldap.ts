import { Client } from "ldapts";
import { env, hasLdapConfig } from "@/lib/config";

export type LdapUserInfo = {
  subject: string;
  email: string;
  name: string;
  department: string;
  position: string;
  raw: Record<string, unknown>;
};

export function isLdapEnabled() {
  return hasLdapConfig();
}

export async function authenticateLdapUser(login: string, password: string): Promise<LdapUserInfo | null> {
  if (!hasLdapConfig()) {
    return null;
  }

  const normalizedLogin = login.trim();
  if (!normalizedLogin || !password) {
    return null;
  }

  const client = new Client({ url: env.ldapUrl });

  try {
    if (env.ldapUserDnTemplate) {
      const userDn = renderDnTemplate(env.ldapUserDnTemplate, normalizedLogin);
      await client.bind(userDn, password);
      return userInfoFromEntry({
        dn: userDn,
        [env.ldapEmailAttribute]: buildEmail(normalizedLogin),
        [env.ldapNameAttribute]: normalizedLogin
      }, normalizedLogin);
    }

    await client.bind(env.ldapBindDn, env.ldapBindPassword);
    const filter = renderFilterTemplate(env.ldapSearchFilter, normalizedLogin);
    const { searchEntries } = await client.search(env.ldapSearchBase, {
      scope: "sub",
      filter,
      sizeLimit: 2,
      attributes: [
        env.ldapEmailAttribute,
        env.ldapNameAttribute,
        env.ldapDepartmentAttribute,
        env.ldapPositionAttribute,
        "mail",
        "cn",
        "displayName",
        "department",
        "title"
      ]
    });

    const entry = searchEntries[0] as Record<string, unknown> | undefined;
    if (!entry || typeof entry.dn !== "string") {
      return null;
    }

    await client.bind(entry.dn, password);
    return userInfoFromEntry(entry, normalizedLogin);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

function renderFilterTemplate(template: string, login: string) {
  return template
    .replaceAll("{{login}}", escapeLdapFilterValue(login))
    .replaceAll("{login}", escapeLdapFilterValue(login));
}

function renderDnTemplate(template: string, login: string) {
  return template
    .replaceAll("{{login}}", escapeLdapDnValue(login))
    .replaceAll("{login}", escapeLdapDnValue(login));
}

function readString(entry: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string" && item.trim());
      if (typeof first === "string") {
        return first.trim();
      }
    }
  }

  return "";
}

function userInfoFromEntry(entry: Record<string, unknown>, login: string): LdapUserInfo {
  const email = readString(entry, [env.ldapEmailAttribute, "mail", "userPrincipalName"]) || buildEmail(login);
  if (!email.includes("@")) {
    throw new Error("LDAP 用户未返回有效邮箱，请配置 LDAP_DEFAULT_DOMAIN 或邮箱属性。");
  }

  return {
    subject: readString(entry, ["dn", "distinguishedName", "uid", "sAMAccountName"]) || email,
    email: email.toLowerCase(),
    name: readString(entry, [env.ldapNameAttribute, "displayName", "cn", "name"]) || email.split("@")[0],
    department: readString(entry, [env.ldapDepartmentAttribute, "department", "ou"]),
    position: readString(entry, [env.ldapPositionAttribute, "title", "description"]),
    raw: entry
  };
}

function buildEmail(login: string) {
  if (login.includes("@")) {
    return login.toLowerCase();
  }

  if (env.ldapDefaultDomain) {
    return `${login}@${env.ldapDefaultDomain}`.toLowerCase();
  }

  return login.toLowerCase();
}

function escapeLdapFilterValue(value: string) {
  return value
    .replace(/\\/g, "\\5c")
    .replace(/\*/g, "\\2a")
    .replace(/\(/g, "\\28")
    .replace(/\)/g, "\\29")
    .replace(/\0/g, "\\00");
}

function escapeLdapDnValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/\+/g, "\\+")
    .replace(/"/g, "\\\"")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/;/g, "\\;")
    .replace(/^#/, "\\#")
    .replace(/^ /, "\\ ")
    .replace(/ $/, "\\ ");
}
