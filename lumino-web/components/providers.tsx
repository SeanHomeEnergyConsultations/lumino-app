"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AppFeedbackProvider } from "@/components/shared/app-feedback";
import { AuthProvider } from "@/lib/auth/client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppFeedbackProvider>{children}</AppFeedbackProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
