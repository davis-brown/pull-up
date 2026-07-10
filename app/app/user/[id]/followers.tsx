import { useLocalSearchParams } from "expo-router";
import { FollowList } from "@/components/FollowList";
import { useFollowers } from "@/lib/hooks";

export default function FollowersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useFollowers(id);
  return <FollowList query={q} emptyText="No followers yet." />;
}
