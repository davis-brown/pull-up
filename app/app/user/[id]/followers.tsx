import { useLocalSearchParams } from "expo-router";
import { FollowList } from "@/components/FollowList";
import { QueryError } from "@/components/QueryError";
import { useFollowers } from "@/lib/hooks";
import { parseRouteId } from "@/lib/routes";

export default function FollowersScreen() {
  const params = useLocalSearchParams();
  const id = parseRouteId(params.id);
  const q = useFollowers(id);
  if (!id) return <QueryError error={new Error("Invalid user id")} title="Invalid player link" message="This player link is not valid." />;
  return <FollowList query={q} emptyText="No followers yet." />;
}
