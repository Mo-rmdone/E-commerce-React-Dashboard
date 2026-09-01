import { useState } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { AlertOctagon, Loader2 } from 'lucide-react';
import { useDataset } from '@/hooks/useDataset';
import { FilterProvider, useFilters } from '@/hooks/useFilters';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useDrillthrough } from '@/hooks/useDrilldown';
import { AppShell, type PageId } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/filters/FilterBar';
import { DetailPanel } from '@/components/drilldown/DetailPanel';
import { ExecutiveOverview } from '@/pages/ExecutiveOverview/ExecutiveOverview';
import { ProductIntelligence } from '@/pages/ProductIntelligence/ProductIntelligence';
import { CustomerInsights } from '@/pages/CustomerInsights/CustomerInsights';
import type { Dataset } from '@/types';
import './styles/global.css';
import '@/components/charts/charts.css';

export default function App() {
  const state = useDataset();

  if (state.status === 'loading') return <Booting />;
  if (state.status === 'error') return <LoadError message={state.error} />;

  return (
    // `reducedMotion="user"` makes every Framer animation in the tree resolve
    // instantly for viewers who ask their OS for reduced motion, rather than
    // each component re-implementing the check.
    <MotionConfig reducedMotion="user">
      <FilterProvider>
        <Dashboard ds={state.dataset} />
      </FilterProvider>
    </MotionConfig>
  );
}

function Dashboard({ ds }: { ds: Dataset }) {
  const [page, setPage] = useState<PageId>('executive');
  const drillthrough = useDrillthrough();
  const data = useDashboardData(ds);
  const { toggle } = useFilters();

  return (
    <AppShell
      ds={ds}
      page={page}
      onNavigate={setPage}
      filterBar={<FilterBar ds={ds} rowsInView={data.rows.length} totalRows={ds.rowCount} />}
    >
      {/* The page swap is a CSS entrance, not a Framer transition. Its resting
          state is fully visible and the keyframe only supplies the arrival, so
          navigation can never leave a blank canvas if the animation is skipped,
          throttled, or interrupted. `key` restarts it on every page change. */}
      <div key={page} className="page-enter">
        {page === 'executive' ? (
          <ExecutiveOverview ds={ds} onOpenDetail={drillthrough.open} />
        ) : page === 'products' ? (
          <ProductIntelligence ds={ds} onOpenDetail={drillthrough.open} />
        ) : (
          <CustomerInsights ds={ds} onOpenDetail={drillthrough.open} />
        )}
      </div>

      <AnimatePresence>
        {drillthrough.entity ? (
          <DetailPanel
            ds={ds}
            entity={drillthrough.entity}
            rows={data.rows}
            comparison={data.comparison}
            basis={data.basis}
            onClose={drillthrough.close}
            onFilter={(dimension, value) => toggle(dimension, value, 'Detail panel', 'replace')}
          />
        ) : null}
      </AnimatePresence>
    </AppShell>
  );
}

function Booting() {
  return (
    <div className="boot">
      <Loader2 className="boot__spin" size={20} aria-hidden />
      <p className="boot__title">Loading the workbook</p>
      <p className="boot__msg">Decoding 51,288 order lines into the analytical model.</p>
    </div>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="boot boot--error" role="alert">
      <AlertOctagon size={20} aria-hidden />
      <p className="boot__title">The dataset could not be loaded</p>
      <p className="boot__msg">{message}</p>
      <pre className="boot__cmd">npm run etl</pre>
      <p className="boot__msg boot__msg--small">
        That rebuilds <code>public/data/dataset.json</code> from the source workbook.
      </p>
    </div>
  );
}
