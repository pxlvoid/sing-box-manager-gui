import { useEffect, useState, useRef } from 'react';
import { Card, CardBody, CardHeader, Button, Tabs, Tab, Switch } from '@nextui-org/react';
import { RefreshCw, Trash2, Terminal, Server, Pause, Play } from 'lucide-react';
import { monitorApi } from '../api';

type LogType = 'sbm' | 'singbox';

export default function Logs() {
  const [activeTab, setActiveTab] = useState<LogType>('singbox');
  const [sbmLogs, setSbmLogs] = useState<string[]>([]);
  const [singboxLogs, setSingboxLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = async (type: LogType) => {
    try {
      setLoading(true);
      if (type === 'sbm') {
        const res = await monitorApi.appLogs(500);
        setSbmLogs(res.data.data || []);
      } else {
        const res = await monitorApi.singboxLogs(500);
        setSingboxLogs(res.data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentLogs = () => {
    fetchLogs(activeTab);
  };

  // Scroll to bottom
  const scrollToBottom = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  };

  // Initial load
  useEffect(() => {
    fetchLogs('sbm');
    fetchLogs('singbox');
  }, []);

  // Auto refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchLogs(activeTab);
      }, 5000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, activeTab]);

  // Scroll to bottom after logs update
  useEffect(() => {
    scrollToBottom();
  }, [sbmLogs, singboxLogs, activeTab]);

  const handleClear = () => {
    if (activeTab === 'sbm') {
      setSbmLogs([]);
    } else {
      setSingboxLogs([]);
    }
  };

  const currentLogs = activeTab === 'sbm' ? sbmLogs : singboxLogs;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Logs</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {autoRefresh ? (
              <Pause className="w-4 h-4 text-gray-500" />
            ) : (
              <Play className="w-4 h-4 text-gray-500" />
            )}
            <span className="text-sm text-gray-500">Auto refresh</span>
            <Switch
              size="sm"
              isSelected={autoRefresh}
              onValueChange={setAutoRefresh}
            />
          </div>
          <Button
            size="sm"
            color="primary"
            variant="flat"
            startContent={<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
            onPress={fetchCurrentLogs}
            isDisabled={loading}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            color="danger"
            variant="flat"
            startContent={<Trash2 className="w-4 h-4" />}
            onPress={handleClear}
          >
            Clear
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-0">
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={(key) => setActiveTab(key as LogType)}
            aria-label="Log Type"
          >
            <Tab
              key="singbox"
              title={
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4" />
                  <span>sing-box Logs</span>
                </div>
              }
            />
            <Tab
              key="sbm"
              title={
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  <span>Application Logs</span>
                </div>
              }
            />
          </Tabs>
        </CardHeader>
        <CardBody>
          <div
            ref={logContainerRef}
            className="bg-gray-900 text-gray-100 rounded-lg p-4 h-[600px] overflow-auto font-mono text-sm"
          >
            {currentLogs.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                No logs
              </div>
            ) : (
              currentLogs.map((line, index) => (
                <div
                  key={index}
                  className={`whitespace-pre-wrap break-all py-0.5 ${
                    line.includes('error') || line.includes('ERROR') || line.includes('fatal') || line.includes('FATAL')
                      ? 'text-red-400'
                      : line.includes('warn') || line.includes('WARN')
                      ? 'text-yellow-400'
                      : line.includes('info') || line.includes('INFO')
                      ? 'text-blue-400'
                      : ''
                  }`}
                >
                  {line}
                </div>
              ))
            )}
          </div>
          <div className="mt-2 text-sm text-gray-500 flex justify-between">
            <span>
              {currentLogs.length} lines
            </span>
            <span>
              {autoRefresh ? 'Auto refresh every 5 seconds' : 'Auto refresh paused'}
            </span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
