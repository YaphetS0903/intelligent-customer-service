export type WecomLifecycleAction = "disable" | "restore" | "none";

export function isWecomMemberActive(enable: number | undefined, status: number | undefined) {
  return enable !== 0 && status !== 2 && status !== 5;
}

export function decideWecomLifecycleAction(input: {
  memberActive: boolean;
  bindingSource: string | null | undefined;
  identityMetadata: Record<string, unknown> | null | undefined;
  userRole: string;
  userStatus: string;
}): WecomLifecycleAction {
  const managed = input.bindingSource === "jit" || input.identityMetadata?.auto_provisioned === true;
  if (!managed || input.userRole !== "employee") return "none";

  if (!input.memberActive && input.userStatus === "active") return "disable";
  if (input.memberActive && input.userStatus === "disabled" && input.identityMetadata?.lifecycle_disabled === true) return "restore";
  return "none";
}
