import { Link } from "react-router-dom";
import { CATEGORIES } from "../lib/categories";
import { ArrowUpRight } from "lucide-react";

export default function DashboardPage() {
  const main = CATEGORIES.filter((c) => c.group === "main");
  const claude = CATEGORIES.filter((c) => c.group === "claude");

  return (
    <div className="page-fade-in pt-16 pb-32 px-6 sm:px-12 md:px-20 max-w-7xl mx-auto" data-testid="dashboard-page">
      <div className="mb-16">
        <div className="text-xs font-mono uppercase tracking-[0.3em] text-neutral-400 mb-4">
          The Library
        </div>
        <h1 className="font-display text-5xl md:text-7xl font-black tracking-tighter leading-[0.9]">
          Training slides,
          <br />
          <span className="text-neutral-400">filed properly.</span>
        </h1>
        <p className="mt-6 text-neutral-600 max-w-2xl leading-relaxed">
          Pick a domain to browse. Add folders, drop in PDFs, decks, links, or
          notes. Everything is searchable and structured the Notion way.
        </p>
      </div>

      <section className="mb-16">
        <div className="flex items-baseline justify-between mb-6 border-b border-neutral-200 pb-3">
          <h2 className="font-display text-2xl font-bold tracking-tight">Domains</h2>
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-400">
            {main.length} sections
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {main.map((c) => (
            <CategoryCard key={c.id} category={c} />
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-6 border-b border-neutral-200 pb-3">
          <h2 className="font-display text-2xl font-bold tracking-tight">Claude</h2>
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-400">
            3 modes
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {claude.map((c) => (
            <CategoryCard key={c.id} category={c} small />
          ))}
        </div>
      </section>
    </div>
  );
}

function CategoryCard({ category, small }) {
  return (
    <Link
      to={`/c/${category.id}`}
      data-testid={`dashboard-category-${category.id}`}
      className="group block border border-neutral-200 bg-white hover-card relative overflow-hidden hard-shadow"
    >
      <div className={`${small ? "h-40" : "h-56"} w-full overflow-hidden border-b border-neutral-200 relative`}>
        <img
          src={category.cover}
          alt=""
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
        />
        <div className={`absolute top-3 left-3 ${category.bgSoft} ${category.accent} text-[10px] font-mono uppercase tracking-[0.2em] px-2 py-1`}>
          {category.group === "claude" ? "Claude" : "Domain"}
        </div>
      </div>
      <div className="p-5 flex items-center justify-between">
        <div>
          <div className="font-display font-bold text-xl tracking-tight">
            {category.name}
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            Open library
          </div>
        </div>
        <ArrowUpRight
          size={20}
          className="text-neutral-400 group-hover:text-[#0A0A0A] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all"
        />
      </div>
    </Link>
  );
}
