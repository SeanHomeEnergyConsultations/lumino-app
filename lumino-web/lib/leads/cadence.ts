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

function cadenceNote(key: string, instruction: string, suggestedText?: string) {
  return `[cadence:${key}] ${instruction}${suggestedText ? ` Suggested text: "${suggestedText}"` : ""}`;
}

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
  const isEngaged = (input.engagementScore ?? 0) >= 4;
  const fastFollowUpOffset = input.interestLevel === "high" || isEngaged ? 1 : 2;
  const channelType = canText ? "text" : "call";

  const tasks: PlannedCadenceTask[] = [];
  tasks.push(
    buildTask(
      channelType,
      addMinutes(new Date(), isEngaged ? 30 : 10),
      cadenceNote(
        "warm_with_contact:immediate",
        isEngaged
          ? "Homeowner is engaged. Take over personally while the conversation is still active."
          : "Send a low-pressure thank-you and make future replies easy.",
        "Hey {first_name}, this is {your_name} — nice meeting you. This is my number in case anything comes up about solar or your bill 👍"
      )
    )
  );
  tasks.push(
    buildTask(
      channelType,
      dueAtForOffset({ offsetDays: fastFollowUpOffset, preferredChannel, decisionMakerStatus, bestContactTime }),
      cadenceNote(
        "warm_with_contact:value",
        isEngaged
          ? "Follow through on the active conversation with the promised info or next step."
          : "Send a value touch or recap without forcing the close.",
        "Hey {first_name}, just following up from when we met. If you want, I can take a look at your setup and give you a rough idea of what solar could look like for your home. No rush 👍"
      )
    )
  );
  tasks.push(
    buildTask(
      "call",
      dueAtForOffset({ offsetDays: 4, preferredChannel: "call", decisionMakerStatus, bestContactTime }),
      cadenceNote(
        "warm_with_contact:call",
        isEngaged
          ? "Do not let the conversation cool off. Call and lock a real next step."
          : "Call to move from passive interest into a real next step.",
        "Hey {first_name}, tried giving you a quick call — no rush at all, just following up from when we met. Feel free to text me here if that's easier 👍"
      )
    )
  );
  tasks.push(
    buildTask(
      channelType,
      dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }),
      cadenceNote(
        "warm_with_contact:final",
        isEngaged
          ? "Close the loop cleanly if the homeowner goes quiet, then move to nurture instead of drifting."
          : "Final short check-in before longer-term nurture.",
        "Hey {first_name}, just wanted to check in one last time for now. If solar is something you want to revisit later, feel free to reach out anytime 👍"
      )
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
        cadenceNote(
          "appointment_active:immediate",
          "Confirm the appointment right away and reduce no-show risk.",
          "Hey {first_name}, this is {your_name} — we're all set for {appointment_date} at {appointment_time}. Looking forward to it 👍"
        )
      )
    );
  }

  const twentyFourHour = addDays(appointment, -1);
  if (twentyFourHour.getTime() > now.getTime()) {
    tasks.push(
      buildTask(
        "appointment_confirm",
        setTime(twentyFourHour, 18, 0),
        cadenceNote(
          "appointment_active:24h",
          "Ask for a direct yes/no confirmation the day before.",
          "Hey {first_name}, just confirming we're still good for tomorrow at {appointment_time} 👍"
        )
      )
    );
  }

  const twoHour = addMinutes(appointment, -120);
  if (twoHour.getTime() > now.getTime()) {
    tasks.push(
      buildTask(
        "appointment_confirm",
        twoHour,
        cadenceNote(
          "appointment_active:2h",
          "Final reminder to protect show rate.",
          "Hey {first_name}, just a quick reminder — I'll see you today at {appointment_time} 👍"
        )
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
        buildTask(
          channelType,
          addMinutes(new Date(), 30),
          cadenceNote(
            "post_appt_spouse:recap",
            "Recap and re-anchor around getting every decision-maker present.",
            "Hey {first_name}, good meeting with you today. I'd be happy to go back through everything whenever it makes sense for both of you to look at it together 👍"
          )
        ),
        buildTask(
          "call",
          dueAtForOffset({ offsetDays: 1, preferredChannel: "call", decisionMakerStatus, bestContactTime }),
          cadenceNote("post_appt_spouse:call", "Lock the next conversation with the spouse or decision-maker.")
        ),
        buildTask(
          "rebook_appointment",
          dueAtForOffset({ offsetDays: 3, preferredChannel, decisionMakerStatus, bestContactTime }),
          cadenceNote("post_appt_spouse:rebook", "Rebook the appointment with everyone present.")
        ),
        buildTask(
          channelType,
          dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }),
          cadenceNote("post_appt_spouse:final", "Final check-in before the lead cools off.")
        )
      ];
    case "post_appt_numbers":
      return [
        buildTask(
          "proposal_follow_up",
          addMinutes(new Date(), 30),
          cadenceNote(
            "post_appt_numbers:recap",
            "Send the numbers recap while the appointment is still fresh.",
            "Hey {first_name}, good meeting with you today. I can put together the numbers more clearly and walk you through them whenever you want 👍"
          )
        ),
        buildTask(
          "call",
          dueAtForOffset({ offsetDays: 3, preferredChannel: "call", decisionMakerStatus, bestContactTime }),
          cadenceNote("post_appt_numbers:call", "Review the savings math live.")
        ),
        buildTask(
          channelType,
          dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }),
          cadenceNote("post_appt_numbers:check", "Light check-in after the numbers recap.")
        ),
        buildTask(
          "proposal_follow_up",
          dueAtForOffset({ offsetDays: 10, preferredChannel, decisionMakerStatus, bestContactTime }),
          cadenceNote("post_appt_numbers:final", "Final proposal recap before nurture.")
        )
      ];
    case "post_appt_price":
      return [
        buildTask(
          channelType,
          addMinutes(new Date(), 30),
          cadenceNote(
            "post_appt_price:recap",
            "Acknowledge the price or payment concern without pressure.",
            "Hey {first_name}, I understand. If you want, we can take another look and see whether there's an option that fits more comfortably 👍"
          )
        ),
        buildTask(
          "call",
          dueAtForOffset({ offsetDays: 3, preferredChannel: "call", decisionMakerStatus, bestContactTime }),
          cadenceNote("post_appt_price:call", "Talk through payment options and value framing.")
        ),
        buildTask(
          "customer_check_in",
          dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }),
          cadenceNote("post_appt_price:check", "Check if the payment concern still feels like the blocker.")
        ),
        buildTask(
          channelType,
          dueAtForOffset({ offsetDays: 10, preferredChannel, decisionMakerStatus, bestContactTime }),
          cadenceNote("post_appt_price:final", "Final low-pressure follow-up.")
        )
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
        buildTask(
          channelType,
          addMinutes(new Date(), 10),
          cadenceNote(
            "customer_onboarding:thanks",
            "Thank the customer and reset expectations right away.",
            "Hey {first_name}, really appreciate you moving forward with this. Excited to help get everything going, and if anything comes up along the way just reach out 👍"
          )
        ),
        buildTask(
          "customer_check_in",
          dueAtForOffset({ offsetDays: 1, preferredChannel, decisionMakerStatus, bestContactTime }),
          cadenceNote("customer_onboarding:day1", "Onboarding check-in with next steps.")
        ),
        buildTask(
          "customer_check_in",
          dueAtForOffset({ offsetDays: 7, preferredChannel, decisionMakerStatus, bestContactTime }),
          cadenceNote("customer_onboarding:day7", "Reduce buyer's remorse and keep trust high.")
        ),
        buildTask(
          "referral_request",
          dueAtForOffset({ offsetDays: 30, preferredChannel, decisionMakerStatus, bestContactTime }),
          cadenceNote(
            "customer_onboarding:referral",
            "Ask for a referral or review after the relationship has settled in.",
            "Hey {first_name}, hope everything's been going smoothly. Also, if you know anyone else who's talked about solar, feel free to send them my way — I'd be happy to help 👍"
          )
        )
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
