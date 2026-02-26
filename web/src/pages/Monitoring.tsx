import TrafficMonitoringPanel from '../components/TrafficMonitoringPanel';

export default function Monitoring() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Traffic Monitoring</h1>
      <TrafficMonitoringPanel />
    </div>
  );
}
