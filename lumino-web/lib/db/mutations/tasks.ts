import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { syncTaskToGoogleCalendar } from "@/lib/google-calendar/service";
import { getAppBaseUrl } from "@/lib/utils/env";
import type { AuthSessionContext } from "@/types/auth";
import type { TaskInput } from "@/types/entities";

async function insertTask(
  input: TaskInput,
  context: AuthSessionContext,
  notes: string | null,
  dueAt: string | null
) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: context.organizationId,
      property_id: input.propertyId ?? null,
      lead_id: input.leadId ?? null,
      assigned_to: context.appUser.id,
      created_by: context.appUser.id,
      type: input.type,
      status: "open",
      due_at: dueAt,
      notes
    })
    .select("id")
    .single();

  if (error) throw error;

  await supabase.from("activities").insert({
    organization_id: context.organizationId,
    entity_type: input.leadId ? "lead" : "property",
    entity_id: input.leadId ?? input.propertyId,
    actor_user_id: context.appUser.id,
    type: "task_created",
    data: {
      task_id: data.id,
      task_type: input.type,
      due_at: dueAt,
      notes
    }
  });

  return data.id as string;
}

export async function createTask(input: TaskInput, context: AuthSessionContext) {
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const notes = input.notes?.trim() || null;
  const dueAt = input.dueAt ?? null;
  const taskId = await insertTask(input, context, notes, dueAt);
  const appBaseUrl = getAppBaseUrl() ?? "http://localhost:3000";
  await syncTaskToGoogleCalendar({
    context,
    taskId,
    appUrl: appBaseUrl
  }).catch(() => null);
  return { taskId };
}

export async function ensureOutcomeTask(params: {
  context: AuthSessionContext;
  propertyId: string;
  leadId?: string | null;
  type: TaskInput["type"];
  dueAt?: string | null;
  notes?: string | null;
}) {
  const { context, propertyId, leadId, type } = params;
  if (!context.organizationId) {
    throw new Error("No active organization found for this user.");
  }

  const supabase = createServerSupabaseClient();
  const dueAt = params.dueAt ?? null;
  const notes = params.notes?.trim() || null;

  let query = supabase
    .from("tasks")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("property_id", propertyId)
    .eq("type", type)
    .in("status", ["open", "overdue", "blocked"])
    .limit(1);

  if (leadId) {
    query = query.eq("lead_id", leadId);
  }

  const { data: existing, error: existingError } = await query.maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        due_at: dueAt,
        notes,
        assigned_to: context.appUser.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", existing.id);

    if (updateError) throw updateError;
    const appBaseUrl = getAppBaseUrl() ?? "http://localhost:3000";
    await syncTaskToGoogleCalendar({
      context,
      taskId: existing.id as string,
      appUrl: appBaseUrl
    }).catch(() => null);
    return { taskId: existing.id as string, created: false };
  }

  const taskId = await insertTask(
    {
      propertyId,
      leadId: leadId ?? null,
      type,
      dueAt,
      notes
    },
    context,
    notes,
    dueAt
  );

  const appBaseUrl = getAppBaseUrl() ?? "http://localhost:3000";
  await syncTaskToGoogleCalendar({
    context,
    taskId,
    appUrl: appBaseUrl
  }).catch(() => null);

  return { taskId, created: true };
}
