import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";

export function integrationCredentialEncryptionConfigured() {
  return (process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY?.trim().length ?? 0) >= 32;
}

export function encryptIntegrationCredential(value: string, context: string) {
  if (!value) throw new Error("凭证不能为空");
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptIntegrationCredential(value: string, context: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("邮箱凭证格式无效，请重新绑定");
  try {
    const decipher = createDecipheriv(algorithm, encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("邮箱凭证无法解密，请重新绑定");
  }
}

function encryptionKey() {
  const secret = process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY?.trim() ?? "";
  if (secret.length < 32) throw new Error("服务器尚未配置集成凭证加密密钥");
  return createHash("sha256").update(secret, "utf8").digest();
}
