import { useEffect, useState } from 'react';
import { loadDataset } from '@/data/loaders/loadDataset';
import type { Dataset } from '@/types';

export type DatasetState =
  | { status: 'loading'; dataset: null; error: null }
  | { status: 'ready'; dataset: Dataset; error: null }
  | { status: 'error'; dataset: null; error: string };

export function useDataset(): DatasetState {
  const [state, setState] = useState<DatasetState>({
    status: 'loading',
    dataset: null,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    loadDataset()
      .then((dataset) => {
        if (alive) setState({ status: 'ready', dataset, error: null });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({
          status: 'error',
          dataset: null,
          error: e instanceof Error ? e.message : 'Unknown error loading the dataset.',
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
