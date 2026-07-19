import { Redirect, usePathname, type Href } from "expo-router";
import type { ReactNode } from "react";
import { FullScreenLoader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { signInHref } from "@/lib/routes";

// Wraps route groups that require a signed-in user.
export function AuthGate({
  children,
  next,
}: {
  children: ReactNode;
  next?: string;
}) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  if (loading) {
    return <FullScreenLoader />;
  }
  if (!user) {
    return <Redirect href={signInHref(next ?? pathname) as Href} />;
  }
  return <>{children}</>;
}
