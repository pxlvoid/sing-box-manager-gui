import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, CardHeader, Button, Tabs, Tab, Switch, Input } from '@nextui-org/react';
import { RefreshCw, Trash2, Terminal, Server, Pause, Play, Activity } from 'lucide-react';
import { monitorApi } from '../api';

type LogType = 'sbm' | 'singbox' | 'probe';
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'other';

type ParsedLogLine = {
  text: string;
  lineNumber: number;
  level: LogLevel;
};

const ANSI_ESCAPE_REGEX = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const LOG_LEVEL_REGEX = /\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|PANIC)\b/i;
const LINE_LIMIT_OPTIONS = [500, 1000, 2000, 5000, 10000] as const;
const ALL_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'other'];

const levelLabels: Record<LogLevel, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  other: 'OTHER',
};

const stripAnsi = (line: string): string => line.replace(ANSI_ESCAPE_REGEX, '');

const detectLogLevel = (line: string): LogLevel => {
  const match = line.match(LOG_LEVEL_REGEX);
  if (!match) {
    return 'other';
  }

  switch (match[1].toUpperCase()) {
    case 'TRACE':
      return 'trace';
    case 'DEBUG':
      return 'debug';
    case 'INFO':
      return 'info';
    case 'WARN':
    case 'WARNING':
      return 'warn';
    case 'ERROR':
    case 'FATAL':
    case 'PANIC':
      return 'error';
    default:
      return 'other';
  }
};

const getLevelColorClass = (level: LogLevel): string => {
  switch (level) {
    case 'trace':
      return 'text-gray-400';
    case 'debug':
      return 'text-cyan-300';
    case 'info':
      return 'text-blue-300';
    case 'warn':
      return 'text-yellow-300';
    case 'error':
      return 'text-red-300';
    case 'other':
      return 'text-gray-100';
    default:
      return 'text-gray-100';
  }
};

export default function Logs() {
  const [activeTab, setActiveTab] = useState<LogType>('singbox');
  const [sbmLogs, setSbmLogs] = useState<string[]>([]);
  const [singboxLogs, setSingboxLogs] = useState<string[]>([]);
  const [probeLogs, setProbeLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [lineLimit, setLineLimit] = useState<number>(2000);
  const [searchTerm, setSearchTerm] = useState('');
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(() => new Set(ALL_LEVELS));
  const logContainerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = async (type: LogType, lines: number) => {
    try {
      setLoading(true);
      if (type === 'sbm') {
        const res = await monitorApi.appLogs(lines);
        setSbmLogs(res.data.data || []);
      } else if (type === 'probe') {
        const res = await monitorApi.probeLogs(lines);
        setProbeLogs(res.data.data || []);
      } else {
        const res = await monitorApi.singboxLogs(lines);
        setSingboxLogs(res.data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentLogs = () => {
    void fetchLogs(activeTab, lineLimit);
  };

  // Scroll to bottom
  const scrollToBottom = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  };

  // Load logs when tab or requested line limit changes
  useEffect(() => {
    void fetchLogs(activeTab, lineLimit);
  }, [activeTab, lineLimit]);

  // Auto refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        void fetchLogs(activeTab, lineLimit);
      }, 5000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, activeTab, lineLimit]);

  const handleClear = () => {
    if (activeTab === 'sbm') {
      setSbmLogs([]);
    } else if (activeTab === 'probe') {
      setProbeLogs([]);
    } else {
      setSingboxLogs([]);
    }
  };

  const toggleLevel = (level: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        if (next.size === 1) {
          return prev;
        }
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const resetLevelFilter = () => {
    setEnabledLevels(new Set(ALL_LEVELS));
  };

  const currentLogs = activeTab === 'sbm' ? sbmLogs : activeTab === 'probe' ? probeLogs : singboxLogs;

  const parsedLogs = useMemo<ParsedLogLine[]>(() => {
    return currentLogs.map((line, index) => {
      const text = stripAnsi(line);
      return {
        text,
        lineNumber: index + 1,
        level: detectLogLevel(text),
      };
    });
  }, [currentLogs]);

  const filteredLogs = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return parsedLogs.filter((entry) => {
      if (!enabledLevels.has(entry.level)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return entry.text.toLowerCase().includes(query);
    });
  }, [parsedLogs, enabledLevels, searchTerm]);

  useEffect(() => {
    if (autoScroll) {
      scrollToBottom();
    }
  }, [filteredLogs, autoScroll, activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Logs</h1>
        <div className="flex flex-wrap items-center gap-3">
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
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Auto scroll</span>
            <Switch
              size="sm"
              isSelected={autoScroll}
              onValueChange={setAutoScroll}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-500">
            <span>Buffer</span>
            <select
              value={lineLimit}
              onChange={(event) => setLineLimit(Number(event.target.value))}
              className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1 text-sm text-gray-700 dark:text-gray-200"
            >
              {LINE_LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
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
              key="probe"
              title={
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  <span>Probe Logs</span>
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
          <div className="mb-3 space-y-3">
            <Input
              size="sm"
              value={searchTerm}
              onValueChange={setSearchTerm}
              placeholder="Search in logs..."
              className="w-full sm:max-w-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500 uppercase tracking-wide">Level filter</span>
              {ALL_LEVELS.map((level) => (
                <Button
                  key={level}
                  size="sm"
                  variant={enabledLevels.has(level) ? 'flat' : 'bordered'}
                  color={
                    level === 'error'
                      ? 'danger'
                      : level === 'warn'
                      ? 'warning'
                      : level === 'info'
                      ? 'primary'
                      : 'default'
                  }
                  onPress={() => toggleLevel(level)}
                >
                  {levelLabels[level]}
                </Button>
              ))}
              <Button
                size="sm"
                variant="light"
                onPress={resetLevelFilter}
                isDisabled={enabledLevels.size === ALL_LEVELS.length}
              >
                Reset
              </Button>
            </div>
          </div>
          <div
            ref={logContainerRef}
            className="bg-gray-900 text-gray-100 rounded-lg p-3 sm:p-4 h-[400px] sm:h-[600px] overflow-auto font-mono text-xs sm:text-sm"
          >
            {currentLogs.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                No logs
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                No logs match current filters
              </div>
            ) : (
              filteredLogs.map((entry, index) => (
                <div
                  key={`${entry.lineNumber}-${index}`}
                  className={`flex items-start gap-3 whitespace-pre-wrap break-all py-0.5 ${getLevelColorClass(entry.level)}`}
                >
                  <span className="w-12 shrink-0 text-right text-gray-500 select-none">
                    {entry.lineNumber}
                  </span>
                  <span className="flex-1 break-all">
                    {entry.text}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="mt-2 text-xs sm:text-sm text-gray-500 flex flex-col sm:flex-row justify-between gap-1">
            <span>
              {filteredLogs.length}/{currentLogs.length} lines (loaded: {lineLimit})
            </span>
            <span>
              {autoRefresh ? 'Auto refresh every 5 seconds' : 'Auto refresh paused'}
              {' · '}
              {autoScroll ? 'Auto scroll enabled' : 'Auto scroll disabled'}
            </span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
