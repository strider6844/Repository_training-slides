import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { useAuth } from "./AuthContext";

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState([]);
  const [currentId, setCurrentId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/workspaces");
      setWorkspaces(data);
      if (data.length && !data.find((w) => w.id === currentId)) {
        // fall back to user's current_workspace_id or first
        const fallback = user?.current_workspace_id || data[0].id;
        setCurrentId(fallback);
      }
    } catch {
      // ignore (unauthed)
    }
  }, [currentId, user]);

  useEffect(() => {
    if (user && user.id) {
      setCurrentId(user.current_workspace_id || null);
      refresh();
    } else {
      setWorkspaces([]);
      setCurrentId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const switchTo = async (id) => {
    await api.post("/workspaces/switch", { workspace_id: id });
    setCurrentId(id);
    window.dispatchEvent(new CustomEvent("workspace-changed", { detail: { id } }));
  };

  const current = workspaces.find((w) => w.id === currentId) || null;

  return (
    <WorkspaceContext.Provider value={{ workspaces, current, currentId, refresh, switchTo }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);
