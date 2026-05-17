import { Routes, Route, BrowserRouter, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Toaster } from "./components/ui/sonner";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import CategoryPage from "./pages/CategoryPage";
import NoteEditorPage from "./pages/NoteEditorPage";
import FileViewerPage from "./pages/FileViewerPage";
import SearchPage from "./pages/SearchPage";
import AppShell from "./components/layout/AppShell";
import "./App.css";

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        data-testid="loading-screen"
      >
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-400">
          Loading…
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { user } = useAuth();
  if (user === null) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Toaster richColors position="bottom-right" />
          <Routes>
            <Route
              path="/login"
              element={
                <PublicOnly>
                  <LoginPage />
                </PublicOnly>
              }
            />
            <Route
              path="/register"
              element={
                <PublicOnly>
                  <RegisterPage />
                </PublicOnly>
              }
            />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<DashboardPage />} />
              <Route path="/c/:categoryId" element={<CategoryPage />} />
              <Route
                path="/c/:categoryId/folder/:folderId"
                element={<CategoryPage />}
              />
              <Route
                path="/c/:categoryId/note/:itemId"
                element={<NoteEditorPage />}
              />
              <Route
                path="/c/:categoryId/file/:itemId"
                element={<FileViewerPage />}
              />
              <Route path="/search" element={<SearchPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
