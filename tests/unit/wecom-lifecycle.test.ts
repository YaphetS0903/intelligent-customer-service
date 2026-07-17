import assert from "node:assert/strict";
import test from "node:test";
import { decideWecomLifecycleAction, isWecomMemberActive } from "../../lib/integrations/providers/wecom/lifecycle-rules.ts";
import { isWecomDirectorySyncDue, nextWecomDirectorySyncAt } from "../../lib/integrations/providers/wecom/schedule-rules.ts";

test("disables an active JIT employee when the directory member is inactive", () => {
  assert.equal(decideWecomLifecycleAction({
    memberActive: false,
    bindingSource: "jit",
    identityMetadata: { auto_provisioned: true },
    userRole: "employee",
    userStatus: "active"
  }), "disable");
});

test("treats Enterprise WeChat disabled and exited statuses as inactive", () => {
  assert.equal(isWecomMemberActive(1, 1), true);
  assert.equal(isWecomMemberActive(0, 1), false);
  assert.equal(isWecomMemberActive(1, 2), false);
  assert.equal(isWecomMemberActive(1, 5), false);
});

test("restores only an employee previously disabled by lifecycle sync", () => {
  assert.equal(decideWecomLifecycleAction({
    memberActive: true,
    bindingSource: "jit",
    identityMetadata: { auto_provisioned: true, lifecycle_disabled: true },
    userRole: "employee",
    userStatus: "disabled"
  }), "restore");
  assert.equal(decideWecomLifecycleAction({
    memberActive: true,
    bindingSource: "jit",
    identityMetadata: { auto_provisioned: true },
    userRole: "employee",
    userStatus: "disabled"
  }), "none");
});

test("never changes administrators or manually managed accounts", () => {
  assert.equal(decideWecomLifecycleAction({
    memberActive: false,
    bindingSource: "jit",
    identityMetadata: { auto_provisioned: true },
    userRole: "admin",
    userStatus: "active"
  }), "none");
  assert.equal(decideWecomLifecycleAction({
    memberActive: false,
    bindingSource: "manual",
    identityMetadata: {},
    userRole: "employee",
    userStatus: "active"
  }), "none");
});

test("runs scheduled synchronization only after the configured interval", () => {
  const now = new Date("2026-07-18T01:00:00.000Z");
  assert.equal(isWecomDirectorySyncDue("2026-07-18T00:40:00.000Z", 30, now), false);
  assert.equal(isWecomDirectorySyncDue("2026-07-18T00:30:00.000Z", 30, now), true);
  assert.equal(nextWecomDirectorySyncAt("2026-07-18T00:40:00.000Z", 30, now).toISOString(), "2026-07-18T01:10:00.000Z");
});
