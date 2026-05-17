import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  ChevronLeft,
  Users,
  Mail,
  Trash2,
  ShieldCheck,
  Crown,
  Eye,
  PenLine,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";

const ROLE_BADGE = {
  owner: { Icon: Crown, label: "Owner", className: "bg-[#0A0A0A] text-white" },
  editor: { Icon: PenLine, label: "Editor", className: "bg-neutral-100 text-neutral-800" },
  viewer: { Icon: Eye, label: "Viewer", className: "bg-neutral-50 text-neutral-600" },
};

export default function WorkspaceSettingsPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const { workspaces, refresh } = useWorkspace();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviting, setInviting] = useState(false);
  const [deleteWsOpen, setDeleteWsOpen] = useState(false);

  const ws = workspaces.find((w) => w.id === workspaceId);
  const isOwner = ws?.role === "owner";

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/workspaces/${workspaceId}/members`);
      setMembers(data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const sendInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await api.post(`/workspaces/${workspaceId}/invite`, {
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });
      setInviteEmail("");
      await load();
      toast.success("Invite sent");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setInviting(false);
    }
  };

  const removeMember = async (memberId) => {
    try {
      await api.delete(`/workspaces/${workspaceId}/members/${memberId}`);
      await load();
      toast.success("Member removed");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const deleteWs = async () => {
    try {
      await api.delete(`/workspaces/${workspaceId}`);
      await refresh();
      toast.success("Workspace deleted");
      navigate("/");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  if (!ws) {
    return (
      <div className="p-12">
        <Link to="/" className="text-sm underline">
          Back to home
        </Link>
        <div className="mt-3 text-sm text-neutral-500">Workspace not found</div>
      </div>
    );
  }

  return (
    <div
      className="page-fade-in pt-12 pb-32 px-6 md:px-12 max-w-4xl mx-auto"
      data-testid="workspace-settings-page"
    >
      <Link
        to="/"
        className="flex items-center gap-2 text-sm text-neutral-500 hover:text-[#0A0A0A] mb-6"
        data-testid="workspace-back-link"
      >
        <ChevronLeft size={14} /> Back
      </Link>

      <div className="mb-10">
        <div className="text-xs font-mono uppercase tracking-[0.3em] text-neutral-400 mb-3">
          Workspace settings
        </div>
        <h1 className="font-display text-4xl md:text-5xl font-black tracking-tighter flex items-center gap-3">
          <Users size={32} strokeWidth={1.5} />
          {ws.name}
        </h1>
      </div>

      {isOwner && (
        <section className="mb-12">
          <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-500 mb-3 border-b border-neutral-200 pb-2">
            Invite a teammate
          </h2>
          <form
            onSubmit={sendInvite}
            className="flex flex-col sm:flex-row gap-2 items-stretch"
            data-testid="invite-form"
          >
            <div className="flex items-center gap-2 border border-neutral-200 bg-white px-3 py-2 flex-1">
              <Mail size={14} className="text-neutral-400" />
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
                type="email"
                className="flex-1 bg-transparent focus:outline-none text-sm placeholder:text-neutral-400"
                data-testid="invite-email-input"
              />
            </div>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="border border-neutral-200 bg-white px-3 py-2 text-sm"
              data-testid="invite-role-select"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              type="submit"
              disabled={inviting}
              className="bg-[#0A0A0A] text-white px-4 py-2 text-sm disabled:opacity-50"
              data-testid="invite-submit-button"
            >
              {inviting ? "Sending…" : "Send invite"}
            </button>
          </form>
          <p className="text-xs text-neutral-500 mt-2">
            New users will activate the invite automatically when they register with that email.
          </p>
        </section>
      )}

      <section className="mb-12">
        <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-500 mb-3 border-b border-neutral-200 pb-2">
          Members
        </h2>
        {loading ? (
          <div className="text-sm text-neutral-400">Loading…</div>
        ) : members.length === 0 ? (
          <div className="text-sm text-neutral-500">No members yet.</div>
        ) : (
          <div className="space-y-1">
            {members.map((m) => {
              const badge = ROLE_BADGE[m.role] || ROLE_BADGE.viewer;
              const Icon = badge.Icon;
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 border border-neutral-200 bg-white p-3"
                  data-testid={`member-row-${m.id}`}
                >
                  <div className="w-9 h-9 bg-neutral-100 flex items-center justify-center font-bold text-neutral-700">
                    {(m.name || m.user_email || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {m.name || m.user_email}
                      {m.status === "pending" && (
                        <span className="ml-2 text-[10px] font-mono uppercase tracking-[0.15em] text-yellow-700 bg-yellow-50 px-1.5 py-0.5">
                          Pending
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-500 truncate">
                      {m.user_email}
                    </div>
                  </div>
                  <div
                    className={`flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.15em] px-2 py-1 ${badge.className}`}
                  >
                    <Icon size={11} /> {badge.label}
                  </div>
                  {isOwner && m.role !== "owner" && (
                    <button
                      onClick={() => removeMember(m.id)}
                      className="p-1.5 text-neutral-500 hover:text-red-600 hover:bg-red-50"
                      title="Remove"
                      data-testid={`member-remove-${m.id}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {isOwner && !ws.is_personal && (
        <section>
          <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-red-600 mb-3 border-b border-red-200 pb-2 flex items-center gap-2">
            <AlertTriangle size={12} /> Danger zone
          </h2>
          <button
            onClick={() => setDeleteWsOpen(true)}
            className="bg-white border border-red-200 text-red-600 px-4 py-2 text-sm hover:bg-red-50"
            data-testid="workspace-delete-button"
          >
            Delete this workspace
          </button>
        </section>
      )}

      <AlertDialog open={deleteWsOpen} onOpenChange={setDeleteWsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display tracking-tight">
              Delete workspace "{ws.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              All folders inside will be removed and every document & note will be moved to the trash.
              Members will lose access immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteWs}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="workspace-delete-confirm"
            >
              Delete workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
