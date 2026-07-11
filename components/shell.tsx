import { ShellClient } from "@/components/shell-client";
import { getCurrentUserOrNull } from "@/lib/db";

export async function Shell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserOrNull();

  return <ShellClient user={user}>{children}</ShellClient>;
}
