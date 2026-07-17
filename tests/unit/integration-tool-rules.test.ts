import assert from "node:assert/strict";
import test from "node:test";
import { decryptIntegrationCredential, encryptIntegrationCredential } from "../../lib/integrations/credential-crypto.ts";
import { detectBusinessToolIntent } from "../../lib/integrations/chat-tool-intent-rules.ts";

test("encrypts mailbox credentials and binds ciphertext to one system user", () => {
  process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = "unit-test-key-that-is-longer-than-thirty-two-characters";
  const encrypted = encryptIntegrationCredential("mailbox-password", "winmail:user-a");
  assert.notEqual(encrypted, "mailbox-password");
  assert.equal(encrypted.includes("mailbox-password"), false);
  assert.equal(decryptIntegrationCredential(encrypted, "winmail:user-a"), "mailbox-password");
  assert.throws(() => decryptIntegrationCredential(encrypted, "winmail:user-b"), /无法解密/);
});

test("routes unread and filtered inbox questions to Winmail tools", () => {
  assert.deepEqual(detectBusinessToolIntent("我有多少封未读邮件？"), { toolId: "winmail.unread_count", params: {} });
  const search = detectBusinessToolIntent("查一下最近 5 封未读邮件");
  assert.equal(search?.toolId, "winmail.search_inbox");
  assert.equal(search?.params.limit, 5);
  assert.equal(search?.params.unread_only, true);
  const senderSearch = detectBusinessToolIntent("查找来自张三的邮件");
  assert.equal(senderSearch?.params.sender, "张三");
});

test("does not hijack ordinary knowledge questions that merely mention email", () => {
  assert.equal(detectBusinessToolIntent("公司邮件使用制度是什么？"), null);
  assert.equal(detectBusinessToolIntent("报销流程是什么？"), null);
});
