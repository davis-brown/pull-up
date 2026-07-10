import { useLocalSearchParams } from "expo-router";
import { FollowList } from "@/components/FollowList";
import { useFollowing } from "@/lib/hooks";

export default function FollowingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useFollowing(id);
  return <FollowList query={q} emptyText="Not following anyone yet." />;
}
