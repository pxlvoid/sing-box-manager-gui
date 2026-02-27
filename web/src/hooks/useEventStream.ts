import { useEffect, useRef } from 'react';
import { useStore } from '../store';

function formatNodeIdentity(data: Record<string, unknown>): string {
  const displayName = typeof data.display_name === 'string' ? data.display_name : '';
  const sourceTag = typeof data.source_tag === 'string' ? data.source_tag : '';
  const tag = displayName || (typeof data.tag === 'string' ? data.tag : '');
  const server = typeof data.server === 'string' ? data.server : '';
  const portRaw = data.server_port;
  const port = typeof portRaw === 'number'
    ? portRaw
    : typeof portRaw === 'string'
      ? Number(portRaw)
      : 0;

  if (server && Number.isFinite(port) && port > 0) {
    if (tag) {
      if (sourceTag && sourceTag !== tag) {
        return `${tag} / ${sourceTag} (${server}:${port})`;
      }
      return `${tag} (${server}:${port})`;
    }
    return `${server}:${port}`;
  }
  return tag || 'unknown';
}

export function useEventStream() {
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function connect() {
      if (esRef.current) {
        esRef.current.close();
      }

      const es = new EventSource('/api/events/stream');
      esRef.current = es;

      es.addEventListener('verify:start', (e) => {
        const data = JSON.parse(e.data);
        const s = useStore.getState();
        s.addPipelineEvent('verify:start', `Verification started: ${data.pending_count} pending, ${data.verified_count} verified`);
        s.resetRunCounters();
        s.setVerificationProgress({ phase: 'pending', current: 0, total: data.pending_count });
      });

      es.addEventListener('verify:health_start', (e) => {
        const data = JSON.parse(e.data);
        const s = useStore.getState();
        s.addPipelineEvent('verify:health_start', `Health check: ${data.total_nodes} nodes`);
        s.setVerificationProgress({ phase: 'health_check', current: 0, total: data.total_nodes });
      });

      es.addEventListener('verify:site_start', (e) => {
        const data = JSON.parse(e.data);
        const s = useStore.getState();
        const siteTotal = Number(data.total_nodes) || 0;
        const healthTotal = Number(data.health_total_nodes) || 0;
        const suffix = healthTotal > 0
          ? ` (${((siteTotal / healthTotal) * 100).toFixed(1)}% of health check)`
          : '';
        s.addPipelineEvent('verify:site_start', `Site check: ${siteTotal} nodes${suffix}`);
        s.setVerificationProgress({ phase: 'site_check', current: 0, total: data.total_nodes });
      });

      es.addEventListener('verify:health_progress', (e) => {
        const data = JSON.parse(e.data);
        useStore.getState().setVerificationProgress({ phase: 'health_check', current: data.current, total: data.total });
      });

      es.addEventListener('verify:site_progress', (e) => {
        const data = JSON.parse(e.data);
        useStore.getState().setVerificationProgress({ phase: 'site_check', current: data.current, total: data.total });
      });

      es.addEventListener('verify:progress', (e) => {
        const data = JSON.parse(e.data);
        useStore.getState().setVerificationProgress({ phase: data.phase, current: data.current, total: data.total });
      });

      es.addEventListener('verify:geo_start', (e) => {
        const data = JSON.parse(e.data);
        const s = useStore.getState();
        s.addPipelineEvent('verify:geo_start', `GEO detection: ${data.total_nodes} nodes`);
        s.setVerificationProgress({ phase: 'geo', current: 0, total: data.total_nodes });
      });

      es.addEventListener('verify:geo_progress', (e) => {
        const data = JSON.parse(e.data);
        useStore.getState().setVerificationProgress({ phase: 'geo', current: data.current, total: data.total });
      });

      es.addEventListener('verify:geo_complete', (e) => {
        const data = JSON.parse(e.data);
        useStore.getState().addPipelineEvent('verify:geo_complete', `GEO detection complete: ${data.checked} nodes`);
      });

      es.addEventListener('verify:node_promoted', (e) => {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        const s = useStore.getState();
        s.addPipelineEvent('verify:node_promoted', `Node promoted: ${formatNodeIdentity(data)}`);
        s.incrementRunCounter('promoted');
      });

      es.addEventListener('verify:node_demoted', (e) => {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        const s = useStore.getState();
        s.addPipelineEvent('verify:node_demoted', `Node demoted: ${formatNodeIdentity(data)}`);
        s.incrementRunCounter('demoted');
      });

      es.addEventListener('verify:node_archived', () => {
        useStore.getState().incrementRunCounter('archived');
      });

      es.addEventListener('verify:complete', (e) => {
        const data = JSON.parse(e.data);
        const s = useStore.getState();
        s.addPipelineEvent('verify:complete', `Verification complete in ${data.duration_ms}ms — promoted: ${data.promoted}, demoted: ${data.demoted}, archived: ${data.archived}`);
        s.setVerificationProgress(null);
        // Refresh data
        s.fetchNodes();
        s.fetchNodeCounts();
        s.fetchVerificationStatus();
        s.fetchVerificationLogs();
        s.fetchLatestMeasurements();
        // Reset verificationRunning flag
        useStore.setState({ verificationRunning: false });
      });

      es.addEventListener('pipeline:start', () => {
        useStore.getState().addPipelineEvent('pipeline:start', 'Pipeline started');
      });

      es.addEventListener('pipeline:stop', () => {
        useStore.getState().addPipelineEvent('pipeline:stop', 'Pipeline stopped');
      });

      es.addEventListener('sub:refresh', (e) => {
        const data = JSON.parse(e.data);
        useStore.getState().addPipelineEvent('sub:refresh', `Subscription refreshed: ${data.name} (${data.node_count} nodes)`);
      });

      es.addEventListener('sub:nodes_synced', (e) => {
        const data = JSON.parse(e.data);
        useStore.getState().addPipelineEvent('sub:nodes_synced', `Nodes synced: ${data.total} processed, +${data.added} added, ${data.skipped} skipped`);
      });

      es.addEventListener('probe:started', (e) => {
        const data = JSON.parse(e.data);
        useStore.getState().addPipelineEvent('probe:started', `Probe started on port ${data.port} with ${data.node_count} nodes`);
      });

      es.addEventListener('probe:stopped', () => {
        useStore.getState().addPipelineEvent('probe:stopped', 'Probe stopped');
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        reconnectTimer.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []);
}
