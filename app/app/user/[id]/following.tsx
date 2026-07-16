import { useLocalSearchParams } from "expo-router";
import { FollowList } from "@/components/FollowList";
import { QueryError } from "@/components/QueryError";
import { useFollowing } from "@/lib/hooks";
import { parseRouteId } from "@/lib/routes";

export default function FollowingScreen() {
  const params = useLocalSearchParams();
  const id = parseRouteId(params.id);
  const q = useFollowing(id);
  if (!id) return <QueryError error={new Error("Invalid user id")} title="Invalid player link" message="This player link is not valid." />;
  return <FollowList query={q} emptyText="Not following anyone yet." />;
}
