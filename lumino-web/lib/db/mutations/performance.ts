import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";
import type { PerformanceCompetitionMetric } from "@/types/api";

export async function createPerformanceCompetition(
  input: {
    title: string;
    description?: string | null;
    metric: PerformanceCompetitionMetric;
    periodType: "day" | "week" | "custom";
    startAt: string;
    endAt: string;
  },
  context: AuthSessionContext
) {
  const supabase = createServerSupabaseClient();
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const now = Date.now();
  const start = new Date(input.startAt).getTime();
  const end = new Date(input.endAt).getTime();
  const status = end < now ? "completed" : start > now ? "scheduled" : "active";

  const { data, error } = await supabase
    .from("performance_competitions")
    .insert({
      organization_id: context.organizationId,
      created_by: context.appUser.id,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      metric: input.metric,
      period_type: input.periodType,
      start_at: input.startAt,
      end_at: input.endAt,
      status
    })
    .select("id")
    .single();

  if (error) throw error;

  return { competitionId: data.id as string };
}
