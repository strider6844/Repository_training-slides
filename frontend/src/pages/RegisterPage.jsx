import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { formatApiError } from "../lib/api";
import { toast } from "sonner";
import { Library, ArrowRight } from "lucide-react";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(email, password, name);
      toast.success("Account created");
      navigate("/");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-white">
      <div className="hidden md:flex flex-col justify-between p-12 bg-[#0A0A0A] text-white relative overflow-hidden">
        <div className="bg-grid absolute inset-0 opacity-20"></div>
        <div className="relative">
          <div className="flex items-center gap-2">
            <Library size={22} strokeWidth={1.5} />
            <span className="font-display font-bold text-lg tracking-tight">
              Slidevault
            </span>
          </div>
        </div>
        <div className="relative">
          <h1 className="font-display text-5xl lg:text-6xl font-black tracking-tighter leading-none">
            Build your
            <br />
            knowledge
            <br />
            <span className="text-neutral-500">vault.</span>
          </h1>
        </div>
        <div className="relative text-xs font-mono uppercase tracking-[0.3em] text-neutral-500">
          PDFs · DOCX · PPTX · Links · Notes
        </div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-sm space-y-8 page-fade-in"
          data-testid="register-form"
        >
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-400 mb-3">
              Get started
            </div>
            <h2 className="font-display text-3xl font-black tracking-tighter">
              Create your account
            </h2>
          </div>
          <div className="space-y-5">
            <div>
              <label className="text-xs font-mono uppercase tracking-[0.15em] text-neutral-500">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                data-testid="register-name-input"
                className="w-full border-b border-neutral-300 bg-transparent py-2 focus:outline-none focus:border-[#0A0A0A]"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="text-xs font-mono uppercase tracking-[0.15em] text-neutral-500">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="register-email-input"
                className="w-full border-b border-neutral-300 bg-transparent py-2 focus:outline-none focus:border-[#0A0A0A]"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-xs font-mono uppercase tracking-[0.15em] text-neutral-500">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                data-testid="register-password-input"
                className="w-full border-b border-neutral-300 bg-transparent py-2 focus:outline-none focus:border-[#0A0A0A]"
                placeholder="At least 6 characters"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            data-testid="register-submit-button"
            className="group w-full bg-[#0A0A0A] text-white px-6 py-3 font-medium transition-transform hover:-translate-y-0.5 disabled:opacity-50 flex items-center justify-between"
          >
            <span>{loading ? "Creating…" : "Create account"}</span>
            <ArrowRight
              size={18}
              className="group-hover:translate-x-1 transition-transform"
            />
          </button>
          <div className="text-sm text-neutral-500">
            Already have an account?{" "}
            <Link
              to="/login"
              data-testid="login-link"
              className="text-[#0A0A0A] underline underline-offset-4"
            >
              Sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
