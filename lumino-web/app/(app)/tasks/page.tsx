import { ProtectedAppShell } from "@/components/app-shell/protected-app-shell";
import { TasksPage } from "@/components/tasks/tasks-page";

export default function TasksRoute() {
  return (
    <ProtectedAppShell requiredFeature="tasksEnabled">
      <TasksPage />
    </ProtectedAppShell>
  );
}
