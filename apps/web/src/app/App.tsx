import { useAtomValue } from "jotai";
import { viewAtom } from "../atoms/view-atom";
import { ChatPage } from "../features/chat/ChatPage";
import { McpServersPage } from "../features/mcp/McpServersPage";
import { MemoryPage } from "../features/memory/MemoryPage";
import { PermissionsPage } from "../features/permissions/PermissionsPage";
import { SkillsPage } from "../features/skills/SkillsPage";
import { WorkflowsPage } from "../features/workflows/WorkflowsPage";

export function App() {
  const view = useAtomValue(viewAtom);
  if (view === "mcp-servers") return <McpServersPage />;
  if (view === "skills") return <SkillsPage />;
  if (view === "memory") return <MemoryPage />;
  if (view === "permissions") return <PermissionsPage />;
  if (view === "workflows") return <WorkflowsPage />;
  return <ChatPage />;
}
