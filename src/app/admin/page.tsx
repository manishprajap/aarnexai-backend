'use client';

import { useEffect, useState } from 'react';
import { NEXT_PUBLIC_BASE_PATH, API_URL } from '@/lib/config';

interface Counts {
  categories: number;
  subcategories: number;
  presets: number;
}

function StatCategoryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

function StatSubcategoryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4v16M7 4h10a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H7M7 15h6a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

function StatPromptIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

const STAT_CARDS = [
  {
    key: 'categories' as const,
    label: 'Categories',
    icon: <StatCategoryIcon />,
    tint: 'bg-indigo-50 text-indigo-600',
  },
  {
    key: 'subcategories' as const,
    label: 'Subcategories',
    icon: <StatSubcategoryIcon />,
    tint: 'bg-sky-50 text-sky-600',
  },
  {
    key: 'presets' as const,
    label: 'Prompts',
    icon: <StatPromptIcon />,
    tint: 'bg-amber-50 text-amber-600',
  },
];

const QUICK_ACTIONS = [
  {
    label: 'Add a category',
    description: 'Create a new top-level category like Restaurant or Coaching',
    href: `${NEXT_PUBLIC_BASE_PATH}/admin/manage?tab=category`,
  },
  {
    label: 'Add a subcategory',
    description: 'Break a category down into more specific types',
     href: `${NEXT_PUBLIC_BASE_PATH}/admin/manage?tab=subcategory`,
  },
  {
    label: 'Add a prompt',
    description: 'Define a new style or creative type for ad generation',
        href: `${NEXT_PUBLIC_BASE_PATH}/admin/manage?tab=preset`,
  },
];

const AdminDashboardPage: React.FC = () => {
  const [counts, setCounts] = useState<Counts>({
    categories: 0,
    subcategories: 0,
    presets: 0,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCounts = async () => {
      try {
        const [categoriesRes, subcategoriesRes, presetsRes] = await Promise.all([
  fetch(`${API_URL}/categories`).then((r) => r.json()),
  fetch(`${API_URL}/subcategories`).then((r) => r.json()),
  fetch(`${API_URL}/presets`).then((r) => r.json()),
]);

        setCounts({
          categories: categoriesRes.categories?.length || 0,
          subcategories: subcategoriesRes.subcategories?.length || 0,
          presets: presetsRes.presets?.length || 0,
        });
      } finally {
        setLoading(false);
      }
    };

    loadCounts();
  }, []);

  const statCards = STAT_CARDS.map(function renderStatCard(card) {
    const value = loading ? '—' : counts[card.key];
    const tintClassName = 'mb-4 flex h-10 w-10 items-center justify-center rounded-lg ' + card.tint;

    return (
      <div key={card.key} className="rounded-xl border border-slate-200 bg-white p-5">
        <div className={tintClassName}>{card.icon}</div>
        <p className="text-sm font-medium text-slate-500">{card.label}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{value}</p>
      </div>
    );
  });

  const quickActions = QUICK_ACTIONS.map(function renderQuickAction(action) {
    return (
      <a
        key={action.href}
        href={action.href}
        className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 hover:border-indigo-300"
      >
        <div>
          <p className="text-sm font-semibold text-slate-900">{action.label}</p>
          <p className="mt-1.5 text-sm leading-5 text-slate-500">{action.description}</p>
        </div>

        <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-indigo-600">
          Go
          <ArrowRightIcon />
        </div>
      </a>
    );
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Overview of the categories, subcategories and prompts powering ad generation.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{statCards}</div>

      <div className="mt-10">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Quick actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{quickActions}</div>
      </div>
    </div>
  );
};

export default AdminDashboardPage;