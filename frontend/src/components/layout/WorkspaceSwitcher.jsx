import { Link, useNavigate } from "react-router-dom";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useState } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import {
  Building2,
  Check,
  Plus,
  Users,
  ChevronsUpDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "../ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../ui/dialog";

export default function WorkspaceSwitcher() {
  const { workspaces, current, refresh, switchTo } = useWorkspace();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const { data } = await api.post("/workspaces", { name: name.trim() });
      await refresh();
      await switchTo(data.id);
      toast.success(`Workspace "${data.name}" created`);
      setShowCreate(false);
      setName("");
      navigate("/");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setCreating(false);
    }
  };

  const onSwitch = async (id) => {
    if (id === current?.id) return;
    try {
      await switchTo(id);
      navigate("/");
      toast.success("Workspace switched");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-full flex items-center gap-2 px-2 py-2 border border-neutral-200 bg-white hover:bg-neutral-50 transition-colors text-left"
            data-testid="workspace-switcher-trigger"
          >
            <div className="w-7 h-7 bg-[#0A0A0A] text-white flex items-center justify-center text-xs font-bold">
              {(current?.name || "P").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-400 leading-none">
                Workspace
              </div>
              <div className="text-sm font-medium truncate mt-0.5">
                {current?.name || "Loading…"}
              </div>
            </div>
            <ChevronsUpDown size={14} className="text-neutral-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-64"
          data-testid="workspace-switcher-content"
        >
          <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-500">
            Your workspaces
          </DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onClick={() => onSwitch(w.id)}
              data-testid={`workspace-item-${w.id}`}
            >
              <div className="flex items-center gap-2 flex-1">
                <Building2 size={14} />
                <span className="flex-1 truncate">{w.name}</span>
                <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-neutral-400">
                  {w.role}
                </span>
                {w.id === current?.id && <Check size={14} />}
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShowCreate(true)}
            data-testid="workspace-new-button"
          >
            <Plus size={14} className="mr-2" /> New workspace
          </DropdownMenuItem>
          {current && !current.is_personal && (
            <DropdownMenuItem asChild>
              <Link
                to={`/workspace/${current.id}/settings`}
                data-testid="workspace-settings-link"
              >
                <Users size={14} className="mr-2" /> Manage members
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent data-testid="workspace-create-dialog">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">
              Create workspace
            </DialogTitle>
            <DialogDescription>
              Workspaces let you collaborate with teammates on shared decks and notes.
            </DialogDescription>
          </DialogHeader>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Team name"
            className="w-full border-b border-neutral-300 bg-transparent py-2 focus:outline-none focus:border-[#0A0A0A]"
            autoFocus
            data-testid="workspace-create-input"
          />
          <DialogFooter>
            <button
              onClick={() => setShowCreate(false)}
              className="bg-white border border-neutral-300 px-4 py-2 text-sm"
              data-testid="workspace-create-cancel"
            >
              Cancel
            </button>
            <button
              onClick={create}
              disabled={creating}
              className="bg-[#0A0A0A] text-white px-4 py-2 text-sm disabled:opacity-50"
              data-testid="workspace-create-confirm"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
