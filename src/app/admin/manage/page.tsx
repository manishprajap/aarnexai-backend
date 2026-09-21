'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_URL } from '@/lib/config';

/*
|--------------------------------------------------------------------------
| Types
|--------------------------------------------------------------------------
*/

interface Category {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number | null;
  isActive: boolean | null;
}

interface Subcategory {
  id: string;
  categoryId: string;
  name: string;
  sortOrder: number | null;
}

interface Preset {
  id: string;
  presetKey: string;
  name: string;
  group: string;
  categoryId: string | null;
  aspectRatio: string;
  promptModifier: string;
  requiresOffer: boolean | null;
  icon: string | null;
  sortOrder: number | null;
}

type Tab = 'category' | 'subcategory' | 'preset';

const VALID_TABS: Tab[] = ['category', 'subcategory', 'preset'];

const TAB_LABELS: Record<Tab, string> = {
  category: 'Category',
  subcategory: 'Subcategory',
  preset: 'Prompt',
};

/*
|--------------------------------------------------------------------------
| Inner component — this is the one that calls useSearchParams()
|--------------------------------------------------------------------------
*/

const ManagePageInner: React.FC = () => {
  const searchParams = useSearchParams();

  /*
  |--------------------------------------------------------------------------
  | Initial tab from ?tab= query, falls back to 'category'
  |--------------------------------------------------------------------------
  */

  const tabFromUrl = searchParams.get('tab');

  const initialTab: Tab = VALID_TABS.includes(tabFromUrl as Tab)
    ? (tabFromUrl as Tab)
    : 'category';

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  /*
  |--------------------------------------------------------------------------
  | Keep the active tab in sync if the sidebar link changes the query
  | (e.g. clicking "Subcategories" while already on this page).
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (VALID_TABS.includes(tabFromUrl as Tab)) {
      setActiveTab(tabFromUrl as Tab);
    }
  }, [tabFromUrl]);

  /*
  |--------------------------------------------------------------------------
  | Data
  |--------------------------------------------------------------------------
  */

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  /*
  |--------------------------------------------------------------------------
  | Category form
  |--------------------------------------------------------------------------
  */

  const [categoryName, setCategoryName] = useState('');
  const [categoryIcon, setCategoryIcon] = useState('');

  /*
  |--------------------------------------------------------------------------
  | Subcategory form
  |--------------------------------------------------------------------------
  */

  const [subcategoryCategoryId, setSubcategoryCategoryId] = useState('');
  const [subcategoryName, setSubcategoryName] = useState('');

  /*
  |--------------------------------------------------------------------------
  | Preset (prompt) form
  |--------------------------------------------------------------------------
  */

  const [presetKey, setPresetKey] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetGroup, setPresetGroup] = useState<'style' | 'creative_type'>('style');
  const [presetCategoryId, setPresetCategoryId] = useState('');
  const [presetAspectRatio, setPresetAspectRatio] = useState('1:1');
  const [presetPromptModifier, setPresetPromptModifier] = useState('');
  const [presetRequiresOffer, setPresetRequiresOffer] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Load data
  |--------------------------------------------------------------------------
  */

  const loadCategories = async () => {
    const res = await fetch(`${API_URL}/categories`);
    const data = await res.json();
    if (data.success) {
      setCategories(data.categories);
    }
  };

  const loadSubcategories = async () => {
    const res = await fetch(`${API_URL}/subcategories`);
    const data = await res.json();
    if (data.success) {
      setSubcategories(data.subcategories);
    }
  };

  const loadPresets = async () => {
    const res = await fetch(`${API_URL}/presets`);
    const data = await res.json();
    if (data.success) {
      setPresets(data.presets);
    }
  };

  useEffect(() => {
    loadCategories();
    loadSubcategories();
    loadPresets();
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Submit handlers
  |--------------------------------------------------------------------------
  */

  const handleAddCategory = async () => {
    if (!categoryName.trim()) {
      setMessage('Category name is required');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/categories`, {
		  method: 'POST',
		  headers: { 'Content-Type': 'application/json' },
		  body: JSON.stringify({
			name: categoryName,
			icon: categoryIcon || undefined,
		  }),
		});

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to add category');
      }

      setMessage('Category added');
      setCategoryName('');
      setCategoryIcon('');
      loadCategories();
    } catch (error: any) {
      setMessage(error?.message || 'Failed to add category');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSubcategory = async () => {
    if (!subcategoryCategoryId) {
      setMessage('Select a category first');
      return;
    }

    if (!subcategoryName.trim()) {
      setMessage('Subcategory name is required');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/subcategories`, {
			  method: 'POST',
			  headers: { 'Content-Type': 'application/json' },
			  body: JSON.stringify({
				categoryId: subcategoryCategoryId,
				name: subcategoryName,
			  }),
			});

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to add subcategory');
      }

      setMessage('Subcategory added');
      setSubcategoryName('');
      loadSubcategories();
    } catch (error: any) {
      setMessage(error?.message || 'Failed to add subcategory');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPreset = async () => {
    if (!presetKey.trim() || !presetName.trim() || !presetPromptModifier.trim()) {
      setMessage('presetKey, name and prompt are required');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/presets`, {
		  method: 'POST',
		  headers: { 'Content-Type': 'application/json' },
		  body: JSON.stringify({
			presetKey,
			name: presetName,
			group: presetGroup,
			categoryId: presetCategoryId || undefined,
			aspectRatio: presetAspectRatio,
			promptModifier: presetPromptModifier,
			requiresOffer: presetRequiresOffer,
		  }),
		});

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to add preset');
      }

      setMessage('Prompt added');
      setPresetKey('');
      setPresetName('');
      setPresetPromptModifier('');
      setPresetRequiresOffer(false);
      loadPresets();
    } catch (error: any) {
      setMessage(error?.message || 'Failed to add preset');
    } finally {
      setLoading(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | UI
  |--------------------------------------------------------------------------
  */

  const tabButtons = VALID_TABS.map(function renderTabButton(tab) {
    const isActive = activeTab === tab;

    const buttonClassName = isActive
      ? 'border-b-2 border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-600'
      : 'border-b-2 border-transparent px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700';

    return (
      <button key={tab} onClick={() => setActiveTab(tab)} className={buttonClassName}>
        {TAB_LABELS[tab]}
      </button>
    );
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-gray-900">Manage Categories, Subcategories & Prompts</h1>

      {/* Tabs */}

      <div className="mb-6 flex gap-2 border-b border-gray-200">{tabButtons}</div>

      {message && (
        <div className="mb-4 rounded-lg bg-indigo-50 px-4 py-2 text-sm text-indigo-700">
          {message}
        </div>
      )}

      {/* Category tab */}

      {activeTab === 'category' && (
        <div>
          <div className="mb-6 rounded-2xl border border-gray-200 p-4">
            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">Name</label>
              <input
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="e.g. Restaurant"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">Icon (optional)</label>
              <input
                value={categoryIcon}
                onChange={(e) => setCategoryIcon(e.target.value)}
                placeholder="icon name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <button
              onClick={handleAddCategory}
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Add Category
            </button>
          </div>

          <div className="space-y-2">
            {categories.map((c) => (
              <div key={c.id} className="rounded-lg border border-gray-200 px-4 py-2 text-sm">
                {c.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subcategory tab */}

      {activeTab === 'subcategory' && (
        <div>
          <div className="mb-6 rounded-2xl border border-gray-200 p-4">
            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">Category</label>
              <select
                value={subcategoryCategoryId}
                onChange={(e) => setSubcategoryCategoryId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">Name</label>
              <input
                value={subcategoryName}
                onChange={(e) => setSubcategoryName(e.target.value)}
                placeholder="e.g. North Indian"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <button
              onClick={handleAddSubcategory}
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Add Subcategory
            </button>
          </div>

          <div className="space-y-2">
            {subcategories.map((s) => (
              <div key={s.id} className="rounded-lg border border-gray-200 px-4 py-2 text-sm">
                {s.name}{' '}
                <span className="text-gray-400">
                  ({categories.find((c) => c.id === s.categoryId)?.name || 'unknown'})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preset (prompt) tab */}

      {activeTab === 'preset' && (
        <div>
          <div className="mb-6 rounded-2xl border border-gray-200 p-4">
            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">Preset Key</label>
              <input
                value={presetKey}
                onChange={(e) => setPresetKey(e.target.value)}
                placeholder="e.g. luxury_gold"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">Name</label>
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="e.g. Luxury"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">Group</label>
              <select
                value={presetGroup}
                onChange={(e) => setPresetGroup(e.target.value as 'style' | 'creative_type')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="style">Style</option>
                <option value="creative_type">Creative Type</option>
              </select>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">
                Category (optional — leave blank for universal)
              </label>
              <select
                value={presetCategoryId}
                onChange={(e) => setPresetCategoryId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Universal (all categories)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">Aspect Ratio</label>
              <select
                value={presetAspectRatio}
                onChange={(e) => setPresetAspectRatio(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="1:1">1:1 (Square)</option>
                <option value="4:5">4:5 (Portrait)</option>
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Story/Reel)</option>
              </select>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-gray-600">Prompt</label>
              <textarea
                value={presetPromptModifier}
                onChange={(e) => setPresetPromptModifier(e.target.value)}
                placeholder="Prompt modifier sent to the AI generation step"
                rows={4}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={presetRequiresOffer}
                onChange={(e) => setPresetRequiresOffer(e.target.checked)}
              />
              Requires offer/discount details
            </label>

            <button
              onClick={handleAddPreset}
              disabled={loading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Add Prompt
            </button>
          </div>

          <div className="space-y-2">
            {presets.map((p) => (
              <div key={p.id} className="rounded-lg border border-gray-200 px-4 py-2 text-sm">
                <span className="font-semibold">{p.name}</span>{' '}
                <span className="text-gray-400">({p.group})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/*
|--------------------------------------------------------------------------
| Default export — wraps the inner component in Suspense so
| useSearchParams() doesn't trigger a CSR bailout during prerender.
|--------------------------------------------------------------------------
*/

const ManagePage: React.FC = () => {
  return (
    <Suspense fallback={null}>
      <ManagePageInner />
    </Suspense>
  );
};

export default ManagePage;