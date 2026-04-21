import type {
  LeadAppointmentOutcome,
  LeadCadenceTrack,
  LeadDecisionMakerStatus,
  LeadInterestLevel,
  LeadObjectionType,
  LeadPreferredChannel,
  TaskInput
} from "@/types/entities";

type LeadCadenceContext = {
  phone?: string | null;
  email?: string | null;
  interestLevel?: LeadInterestLevel | null;
  nextFollowUpAt?: string | null;
  appointmentAt?: string | null;
  decisionMakerStatus?: LeadDecisionMakerStatus | null;
  preferredChannel?: LeadPreferredChannel | null;
  bestContactTime?: string | null;
  textConsent?: boolean | null;
  objectionType?: LeadObjectionType | null;
  appointmentOutcome?: LeadAppointmentOutcome | null;
  engagementScore?: number | null;
  cadenceTrack?: LeadCadenceTrack | null;
};

export type PlannedCadenceTask = {
  type: TaskInput["type"];
  dueAt: string;
  notes: string;
};

export type LeadCadencePlan = {
  cadenceTrack: LeadCadenceTrack;
  suggestedNextFollowUpAt: string | null;
  tasks: PlannedCadenceTask[];
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function setTime(date: Date, hour: number, minute = 0) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function normalizeWindow(bestContactTime: string | null | undefined) {
  const value = bestContactTime?.trim().toLowerCase() ?? "";
  if (!value) return null;
  if (value.includes("even")) return "evening" as const;
  if (value.includes("after")) return "afternoon" as const;
  if (value.includes("morn")) return "morning" as const;
  if (value.includes("weekend")) return "weekend" as const;
  return null;
}

function dueAtForOffset(input: {
  offsetDays: number;
  preferredChannel: LeadPreferredChannel | null;
  decisionMakerStatus: LeadDecisionMakerStatus | null;
  bestContactTime: string | null;
}) {
  const base = addDays(new Date(), input.offsetDays);
  const window = normalizeWindow(input.bestContactTime);
  const prefersEvening = input.decisionMakerStatus === "spouse_missing" || window === "evening";

  if (window === "weekend") {
    const day = base.getDay();
    if (day !== 6 && day !== 0) {
      base.setDate(base.getDate() + ((6 - day + 7) % 7));
    }
    return setTime(base, 11, 0);
  }

  if (prefersEvening) {
    return setTime(base, 18, 30);
  }

  if (window === "morning") {
    return setTime(base, 10, 0);
  }

  if (window === "afternoon") {
    return setTime(base, 14, 0);
  }

  if (input.preferredChannel === "door") {
    return setTime(base, 17, 30);
  }

  if (input.preferredChannel === "call") {
    return setTime(base, 16, 30);
  }

  return setTime(base, 11, 0);
}

function buildTask(
  type: TaskInput["type"],
  dueAt: Date,
  notes: string
): PlannedCadenceTask {
  return {
    type,
    dueAt: dueAt.toISOString(),
    notes
  };
}

function inferCadenceTrack(input: LeadCadenceContext): LeadCadenceTrack {
  if (input.cadenceTrack) return input.cadenceTrack;
  if (input.appointmentAt) return "appointment_active";

  switch (input.appointmentOutcome) {
    case "closed":
      return "customer_onboarding";
    case "moved":
    case "canceled":
      return "rebook_recovery";
    case "sat_not_closed":
      if (input.decisionMakerStatus === "spouse_missing" || input.objectionType === "spouse") {
        return "post_appt_spouse";
      }
      if (input.objectionType === "needs_numbers") return "post_appt_numbers";
      if (input.objectionType === "price") return "post_appt_price";
      if (input.objectionType === "timing") return "post_appt_timing";
      return "post_appt_trust";
    default:
      break;
  }

  return input.phone || input.email ? "warm_with_contact" : "warm_no_contact";
}

function shouldText(input: LeadCadenceContext) {
  if (!input.phone) return false;
  if (input.preferredChannel === "call" || input.preferredChannel === "door") return false;
  return input.textConsent !== false;
}

function buildWarmNoContactTasks(input: LeadCadenceContext) {
  const preferredChannel = input.preferredChannel ?? "door";
  const decisionMakerStatus = input.decisionMakerStatus ?? null;
  const bestContactTime = input.bestContactTime ?? null;

  return [
    buildTask(
      "revisit",
      dueAtForOffset({ offsetDays: 2, preferredChannel, decisionMakerStatus, bestContactTime }),
      "[cadence:warm_no_contact:day2] Revisit after a good doorstep conversation without captured contact info."
    ),
    buildTask(
      "revisit",
      dueAtForOffset({ offsetDays: 5, preferredChannel, decisionMakerStatus, bestContactTime }),
      "[cadence:warm_no_contact:day5] Second meaningful revisit for a warm doorstep lead."
    ),
    buildTask(
      "revisit",
      dueAtForOffset({ offsetDays: 12, preferredChannel, decisionMakerStatus, bestContactTime }),
      "[cadence:warm_no_contact:day12] Final revisit attempt before nurture/archive."
    )
  ];
}

function buildWarmContactTasks(input: LeadCadenceContext) {
  const preferredChannel = input.preferredChannel ?? (input.phone ? "text" : "call");
  const decisionMakerStatus = input.decisionMakerStatus ?? null;
  const bestContactTime = input.bestContactTime ?? null;
  const canText = shouldText(input);
  const fastFollowUpOffset = input.interestLevel === "high" || (input.engagementScore ?? 0) >= 4 ? 1 : 2;

  const tasks: PlannedCadenceTask[] = [];
  tasks.push(
    buildTask(
      canText ? "text" : "call",
      addMinutes(new Date(), 10),
      "[cadence:warm_with_contact:immediate] Send a low-pressure thank-you and make future replies easy."
    )
  );
  tasks.push(
    buildTask(
      canText ? "text" : "call",
      dueAtForOffset({ offsetDays: fastFollowUpOffset, preferredChannel, decisionMakerStatus, bestContactTime }),
      "[cadence:warm_with_contact:value] Send a value touch or recap without forcing the close."
    )
  );
  tasks.push(
    buildTask(
      "call",
      dueAtForOffset({ offsetDays: 4, preferredChannel: "call", decisionMakerStatus, bestContactTime }),
      "[cadence:warm_with_contact:call] Call to move from passive interest into a real next step."
    )
  );
  tasks.push(
    buildTask(
      canText ? "text" : "call",
      dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }),
      "[cadence:warm_with_contact:final] Final short check-in before longer-term nurture."
    )
  );
  return tasks;
}

function buildAppointmentTasks(input: LeadCadenceContext) {
  if (!input.appointmentAt) return [];
  const appointment = new Date(input.appointmentAt);
  const tasks: PlannedCadenceTask[] = [];
  const now = new Date();
  const immediate = addMinutes(now, 10);
  if (immediate.getTime() < appointment.getTime()) {
    tasks.push(
      buildTask(
        "appointment_confirm",
        immediate,
        "[cadence:appointment_active:immediate] Confirm the appointment right away and reduce no-show risk."
      )
    );
  }

  const twentyFourHour = addDays(appointment, -1);
  if (twentyFourHour.getTime() > now.getTime()) {
    tasks.push(
      buildTask(
        "appointment_confirm",
        setTime(twentyFourHour, 18, 0),
        "[cadence:appointment_active:24h] Ask for a direct yes/no confirmation the day before."
      )
    );
  }

  const twoHour = addMinutes(appointment, -120);
  if (twoHour.getTime() > now.getTime()) {
    tasks.push(
      buildTask(
        "appointment_confirm",
        twoHour,
        "[cadence:appointment_active:2h] Final reminder to protect show rate."
      )
    );
  }

  return tasks;
}

function buildPostAppointmentTasks(input: LeadCadenceContext, track: LeadCadenceTrack) {
  const preferredChannel = input.preferredChannel ?? (input.phone ? "text" : "call");
  const bestContactTime = input.bestContactTime ?? null;
  const decisionMakerStatus = input.decisionMakerStatus ?? null;
  const canText = shouldText(input);
  const channelType = canText ? "text" : "call";

  switch (track) {
    case "post_appt_spouse":
      return [
        buildTask(channelType, addMinutes(new Date(), 30), "[cadence:post_appt_spouse:recap] Recap and re-anchor around getting every decision-maker present."),
        buildTask("call", dueAtForOffset({ offsetDays: 1, preferredChannel: "call", decisionMakerStatus, bestContactTime }), "[cadence:post_appt_spouse:call] Lock the next conversation with the spouse/decision-maker."),
        buildTask("rebook_appointment", dueAtForOffset({ offsetDays: 3, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:post_appt_spouse:rebook] Rebook the appointment with everyone present."),
        buildTask(channelType, dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:post_appt_spouse:final] Final check-in before the lead cools off.")
      ];
    case "post_appt_numbers":
      return [
        buildTask("proposal_follow_up", addMinutes(new Date(), 30), "[cadence:post_appt_numbers:recap] Send the numbers recap while the appointment is still fresh."),
        buildTask("call", dueAtForOffset({ offsetDays: 3, preferredChannel: "call", decisionMakerStatus, bestContactTime }), "[cadence:post_appt_numbers:call] Review the savings math live."),
        buildTask(channelType, dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:post_appt_numbers:check] Light check-in after the numbers recap."),
        buildTask("proposal_follow_up", dueAtForOffset({ offsetDays: 10, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:post_appt_numbers:final] Final proposal recap before nurture.")
      ];
    case "post_appt_price":
      return [
        buildTask(channelType, addMinutes(new Date(), 30), "[cadence:post_appt_price:recap] Acknowledge the price/payment concern without pressure."),
        buildTask("call", dueAtForOffset({ offsetDays: 3, preferredChannel: "call", decisionMakerStatus, bestContactTime }), "[cadence:post_appt_price:call] Talk through payment options and value framing."),
        buildTask("customer_check_in", dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:post_appt_price:check] Check if the payment concern still feels like the blocker."),
        buildTask(channelType, dueAtForOffset({ offsetDays: 10, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:post_appt_price:final] Final low-pressure follow-up.")
      ];
    case "post_appt_timing":
      return [
        buildTask(channelType, addMinutes(new Date(), 30), "[cadence:post_appt_timing:recap] Keep the timing follow-up low-pressure and specific."),
        buildTask("customer_check_in", dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:post_appt_timing:check] Check whether timing has changed."),
        buildTask(channelType, dueAtForOffset({ offsetDays: 14, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:post_appt_timing:final] Final timing check before longer nurture.")
      ];
    case "post_appt_trust":
      return [
        buildTask(channelType, addMinutes(new Date(), 30), "[cadence:post_appt_trust:recap] Send reassurance, social proof, and process clarity."),
        buildTask("call", dueAtForOffset({ offsetDays: 3, preferredChannel: "call", decisionMakerStatus, bestContactTime }), "[cadence:post_appt_trust:call] Address any lingering trust concerns live."),
        buildTask("customer_check_in", dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:post_appt_trust:check] Soft trust-building check-in."),
        buildTask(channelType, dueAtForOffset({ offsetDays: 10, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:post_appt_trust:final] Final follow-up before nurture.")
      ];
    case "rebook_recovery":
      return [
        buildTask("rebook_appointment", addMinutes(new Date(), 10), "[cadence:rebook_recovery:immediate] Low-friction rebook attempt right away."),
        buildTask("call", dueAtForOffset({ offsetDays: 3, preferredChannel: "call", decisionMakerStatus, bestContactTime }), "[cadence:rebook_recovery:call] Recover the appointment with a live call."),
        buildTask(channelType, dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:rebook_recovery:final] Final rebook attempt before nurture.")
      ];
    case "customer_onboarding":
      return [
        buildTask(channelType, addMinutes(new Date(), 10), "[cadence:customer_onboarding:thanks] Thank the customer and reset expectations right away."),
        buildTask("customer_check_in", dueAtForOffset({ offsetDays: 1, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:customer_onboarding:day1] Onboarding check-in with next steps."),
        buildTask("customer_check_in", dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:customer_onboarding:day7] Reduce buyer's remorse and keep trust high."),
        buildTask("referral_request", dueAtForOffset({ offsetDays: 30, preferredChannel, decisionMakerStatus, bestContactTime }), "[cadence:customer_onboarding:referral] Ask for a referral or review after the relationship has settled in.")
      ];
    default:
      return [];
  }
}

export function buildLeadCadencePlan(input: LeadCadenceContext): LeadCadencePlan {
  const cadenceTrack = inferCadenceTrack(input);

  let tasks: PlannedCadenceTask[];
  if (cadenceTrack === "warm_no_contact") {
    tasks = buildWarmNoContactTasks(input);
  } else if (cadenceTrack === "warm_with_contact") {
    tasks = buildWarmContactTasks(input);
  } else if (cadenceTrack === "appointment_active") {
    tasks = buildAppointmentTasks(input);
  } else {
    tasks = buildPostAppointmentTasks(input, cadenceTrack);
  }

  const futureTasks = tasks
    .map((task) => new Date(task.dueAt).getTime())
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > Date.now())
    .sort((a, b) => a - b);

  return {
    cadenceTrack,
    suggestedNextFollowUpAt: futureTasks.length ? new Date(futureTasks[0]).toISOString() : null,
    tasks
  };
}
