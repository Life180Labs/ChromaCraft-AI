/**
 * ChromaCraft App Store — Zustand
 *
 * Centralizes all global UI state that was previously scattered across
 * page.tsx useState hooks. Components can subscribe to only the slices
 * they need, preventing unnecessary re-renders.
 *
 * Usage:
 *   import { useAppStore } from '@/lib/store';
 *   const { selectedJob, setSelectedJob } = useAppStore();
 */
import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type { Job, Provider } from '../components/shared/types';
import type { TabId } from '../components/shared/types';

// ── State shape ───────────────────────────────────────────────────────────────

interface AppState {
  // Navigation
  activeTab: TabId;
  nightMode: boolean;

  // Jobs
  jobs: Job[];
  selectedJob: Job | null;

  // Providers
  providers: Provider[];
  selectedProviderId: number | null;

  // Setup form
  industry: string;
  modelName: string;
  filenamePrefix: string;
  targetAudience: string;
  targetMarket: string;
  targetPurpose: string;
  additionalContext: string;
  gridCols: number;
  gridRows: number;
  lifestyleEnabled: boolean;
  videoEnabled: boolean;
  videoPrompt: string;
  spinEnabled: boolean;
  cropsEnabled: boolean;
  customColors: string[];
  uploadFile: File | null;
  uploadError: string;

  // Generation
  promptText: string;
  exportUrl: string | null;

  // Loading
  loading: boolean;
  authError: string;
}

// ── Actions shape ─────────────────────────────────────────────────────────────

interface AppActions {
  // Navigation
  setActiveTab: (tab: TabId) => void;
  setNightMode: (v: boolean) => void;

  // Jobs
  setJobs: (jobs: Job[]) => void;
  setSelectedJob: (job: Job | null) => void;
  upsertJob: (job: Job) => void;      // Add or update a job in the list

  // Providers
  setProviders: (providers: Provider[]) => void;
  setSelectedProviderId: (id: number | null) => void;

  // Setup form — batch setter for efficient resets
  setSetupField: <K extends keyof AppState>(key: K, value: AppState[K]) => void;
  resetSetup: () => void;

  // Generation
  setPromptText: (v: string) => void;
  setExportUrl: (v: string | null) => void;

  // Loading
  setLoading: (v: boolean) => void;
  setAuthError: (v: string) => void;

  // Async: select job and hydrate full asset data
  selectJobWithHydration: (job: Job) => Promise<void>;

  // Async: fetch and refresh jobs list
  fetchJobs: () => Promise<void>;

  // Async: fetch and refresh providers list
  fetchProviders: () => Promise<void>;
}

// ── Default setup values ──────────────────────────────────────────────────────

const UC1_STANDARD_COLORS = [
  'White', 'Black', 'Blue', 'Red', 'Green', 'Brown',
  'Silver', 'Yellow', 'Cream', 'Pink', 'Dark Blue', 'Orange',
];

const defaultSetup: Pick<
  AppState,
  | 'industry' | 'modelName' | 'filenamePrefix' | 'targetAudience'
  | 'targetMarket' | 'targetPurpose' | 'additionalContext'
  | 'gridCols' | 'gridRows' | 'lifestyleEnabled' | 'videoEnabled'
  | 'videoPrompt' | 'spinEnabled' | 'cropsEnabled' | 'customColors'
  | 'uploadFile' | 'uploadError'
> = {
  industry: 'Automotive',
  modelName: '',
  filenamePrefix: '',
  targetAudience: 'General consumers',
  targetMarket: 'India',
  targetPurpose: 'Product catalog',
  additionalContext: '',
  gridCols: 4,
  gridRows: 3,
  lifestyleEnabled: false,
  videoEnabled: false,
  videoPrompt: 'Cinematic showcase of the product under dynamic studio lighting',
  spinEnabled: false,
  cropsEnabled: true,
  customColors: [...UC1_STANDARD_COLORS],
  uploadFile: null,
  uploadError: '',
};

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState & AppActions>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // Initial state
      activeTab: 'home',
      nightMode: false,
      jobs: [],
      selectedJob: null,
      providers: [],
      selectedProviderId: null,
      promptText: '',
      exportUrl: null,
      loading: false,
      authError: '',
      ...defaultSetup,

      // ── Actions ────────────────────────────────────────────────────────────

      setActiveTab: (tab) => set({ activeTab: tab }),
      setNightMode: (v) => set({ nightMode: v }),

      setJobs: (jobs) => set({ jobs }),
      setSelectedJob: (job) => set({ selectedJob: job }),
      upsertJob: (job) =>
        set((state) => {
          const exists = state.jobs.some((j) => j.id === job.id);
          return {
            jobs: exists
              ? state.jobs.map((j) => (j.id === job.id ? job : j))
              : [job, ...state.jobs],
          };
        }),

      setProviders: (providers) => set({ providers }),
      setSelectedProviderId: (id) => set({ selectedProviderId: id }),

      setSetupField: (key, value) => set({ [key]: value } as any),
      resetSetup: () => set({ ...defaultSetup, selectedJob: null, exportUrl: null }),

      setPromptText: (v) => set({ promptText: v }),
      setExportUrl: (v) => set({ exportUrl: v }),
      setLoading: (v) => set({ loading: v }),
      setAuthError: (v) => set({ authError: v }),

      // ── Async: select job + hydrate full asset data from /api/v1/jobs/:id ──
      selectJobWithHydration: async (job) => {
        set({ selectedJob: job }); // immediate optimistic update
        try {
          const res = await fetch(`/api/v1/jobs/${job.id}`);
          if (res.ok) {
            const fullJob: Job = await res.json();
            if (fullJob?.id) {
              set({ selectedJob: fullJob });
              get().upsertJob(fullJob);
            }
          }
        } catch {
          // Keep the optimistic job if fetch fails
        }
      },

      // ── Async: fetch all jobs (paginated list) ─────────────────────────────
      fetchJobs: async () => {
        try {
          const res = await fetch('/api/v1/jobs');
          if (res.ok) {
            const data = await res.json();
            set({ jobs: Array.isArray(data) ? data : [] });
          } else {
            set({ jobs: [] });
          }
        } catch {
          set({ jobs: [] });
        }
      },

      // ── Async: fetch providers ──────────────────────────────────────────────
      fetchProviders: async () => {
        try {
          const res = await fetch('/api/v1/providers');
          if (res.ok) {
            const data = await res.json();
            const safe = Array.isArray(data) ? data : [];
            set({ providers: safe });
            const def = safe.find((p: Provider) => p.default);
            if (def) set({ selectedProviderId: def.id });
          } else {
            set({ providers: [] });
          }
        } catch {
          set({ providers: [] });
        }
      },
    })),
    { name: 'ChromaCraft' },
  ),
);

// ── Typed selectors (use these instead of destructuring for perf) ──────────────
export const selectSelectedJob = (s: AppState & AppActions) => s.selectedJob;
export const selectJobs = (s: AppState & AppActions) => s.jobs;
export const selectActiveTab = (s: AppState & AppActions) => s.activeTab;
export const selectLoading = (s: AppState & AppActions) => s.loading;
