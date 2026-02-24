import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, Button, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip } from '@nextui-org/react';
import { Play, Square, RefreshCw, Cpu, HardDrive, Wifi, Info, Activity } from 'lucide-react';
import { useStore } from '../store';
import { serviceApi, configApi } from '../api';
import { toast } from '../components/Toast';

export default function Dashboard() {
  const { serviceStatus, subscriptions, manualNodes, systemInfo, fetchServiceStatus, fetchSubscriptions, fetchManualNodes, fetchSystemInfo, fetchUnsupportedNodes } = useStore();

  // Error modal state
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

  // Helper function to display errors
  const showError = (title: string, error: any) => {
    const message = error.response?.data?.error || error.message || 'Operation failed';
    setErrorModal({
      isOpen: true,
      title,
      message
    });
  };

  useEffect(() => {
    fetchServiceStatus();
    fetchSubscriptions();
    fetchManualNodes();
    fetchSystemInfo();

    // Refresh status and system info every 5 seconds
    const interval = setInterval(() => {
      fetchServiceStatus();
      fetchSystemInfo();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    try {
      await serviceApi.start();
      await fetchServiceStatus();
      toast.success('Service started');
    } catch (error) {
      showError('Failed to start', error);
    }
  };

  const handleStop = async () => {
    try {
      await serviceApi.stop();
      await fetchServiceStatus();
      toast.success('Service stopped');
    } catch (error) {
      showError('Failed to stop', error);
    }
  };

  const handleRestart = async () => {
    try {
      await serviceApi.restart();
      await fetchServiceStatus();
      toast.success('Service restarted');
    } catch (error) {
      showError('Failed to restart', error);
    }
  };

  const handleApplyConfig = async () => {
    try {
      const res = await configApi.apply();
      await fetchServiceStatus();
      await fetchUnsupportedNodes();
      if (res.data.warning) {
        toast.info(res.data.warning);
      } else {
        toast.success('Configuration applied');
      }
    } catch (error) {
      showError('Failed to apply configuration', error);
    }
  };

  const totalNodes = subscriptions.reduce((sum, sub) => sum + sub.node_count, 0) + manualNodes.length;
  const enabledSubs = subscriptions.filter(sub => sub.enabled).length;
  const enabledManualNodes = manualNodes.filter(mn => mn.enabled).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Dashboard</h1>

      {/* Service status card */}
      <Card>
        <CardHeader className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">sing-box Service</h2>
            <Chip
              color={serviceStatus?.running ? 'success' : 'danger'}
              variant="flat"
              size="sm"
            >
              {serviceStatus?.running ? 'Running' : 'Stopped'}
            </Chip>
          </div>
          <div className="flex gap-2">
            {serviceStatus?.running ? (
              <>
                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  startContent={<Square className="w-4 h-4" />}
                  onPress={handleStop}
                >
                  Stop
                </Button>
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  startContent={<RefreshCw className="w-4 h-4" />}
                  onPress={handleRestart}
                >
                  Restart
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                color="success"
                startContent={<Play className="w-4 h-4" />}
                onPress={handleStart}
              >
                Start
              </Button>
            )}
            <Button
              size="sm"
              color="primary"
              onPress={handleApplyConfig}
            >
              Apply Config
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-500">Version</p>
              <div className="flex items-center gap-1">
                <p className="font-medium">
                  {serviceStatus?.version?.match(/version\s+([\d.]+)/)?.[1] || serviceStatus?.version || '-'}
                </p>
                {serviceStatus?.version && (
                  <Tooltip
                    content={
                      <div className="max-w-xs whitespace-pre-wrap text-xs p-1">
                        {serviceStatus.version}
                      </div>
                    }
                    placement="bottom"
                  >
                    <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
                  </Tooltip>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-500">Process ID</p>
              <p className="font-medium">{serviceStatus?.pid || '-'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className="font-medium">
                {serviceStatus?.running ? 'Running normally' : 'Not running'}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Statistics cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Wifi className="w-6 h-6 text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Subscriptions</p>
              <p className="text-2xl font-bold">{enabledSubs} / {subscriptions.length}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-cyan-100 dark:bg-cyan-900 rounded-lg">
              <HardDrive className="w-6 h-6 text-cyan-600 dark:text-cyan-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Manual Nodes</p>
              <p className="text-2xl font-bold">{enabledManualNodes} / {manualNodes.length}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
              <HardDrive className="w-6 h-6 text-green-600 dark:text-green-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Nodes</p>
              <p className="text-2xl font-bold">{totalNodes}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Cpu className="w-6 h-6 text-purple-600 dark:text-purple-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">sbm Resources</p>
              <p className="text-lg font-bold">
                {systemInfo?.sbm ? (
                  <>
                    <span className="text-sm font-normal text-gray-500">CPU </span>
                    {systemInfo.sbm.cpu_percent.toFixed(1)}%
                    <span className="text-sm font-normal text-gray-500 ml-2">Mem </span>
                    {systemInfo.sbm.memory_mb.toFixed(1)}MB
                  </>
                ) : '-'}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-row items-center gap-4">
            <div className="p-3 bg-orange-100 dark:bg-orange-900 rounded-lg">
              <Activity className="w-6 h-6 text-orange-600 dark:text-orange-300" />
            </div>
            <div>
              <p className="text-sm text-gray-500">sing-box Resources</p>
              <p className="text-lg font-bold">
                {serviceStatus?.running && systemInfo?.singbox ? (
                  <>
                    <span className="text-sm font-normal text-gray-500">CPU </span>
                    {systemInfo.singbox.cpu_percent.toFixed(1)}%
                    <span className="text-sm font-normal text-gray-500 ml-2">Mem </span>
                    {systemInfo.singbox.memory_mb.toFixed(1)}MB
                  </>
                ) : (
                  <span className="text-gray-400">Not running</span>
                )}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Subscription list preview */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Subscription Overview</h2>
        </CardHeader>
        <CardBody>
          {subscriptions.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No subscriptions yet. Go to the Nodes page to add one.</p>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Chip
                      size="sm"
                      color={sub.enabled ? 'success' : 'default'}
                      variant="dot"
                    >
                      {sub.name}
                    </Chip>
                    <span className="text-sm text-gray-500">
                      {sub.node_count} nodes
                    </span>
                  </div>
                  <span className="text-sm text-gray-400">
                    Updated {new Date(sub.updated_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Manual nodes list preview */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Manual Nodes Overview</h2>
        </CardHeader>
        <CardBody>
          {manualNodes.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No manual nodes yet. Go to the Nodes page to add one.</p>
          ) : (
            <div className="space-y-3">
              {manualNodes.map((mn) => (
                <div
                  key={mn.id}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Chip
                      size="sm"
                      color={mn.enabled ? 'success' : 'default'}
                      variant="dot"
                    >
                      {mn.node.country_emoji && `${mn.node.country_emoji} `}{mn.node.tag}
                    </Chip>
                    <span className="text-sm text-gray-500">
                      {mn.node.type}
                    </span>
                  </div>
                  <span className="text-sm text-gray-400">
                    {mn.node.server}:{mn.node.server_port}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Error modal */}
      <Modal isOpen={errorModal.isOpen} onClose={() => setErrorModal({ ...errorModal, isOpen: false })}>
        <ModalContent>
          <ModalHeader className="text-danger">{errorModal.title}</ModalHeader>
          <ModalBody>
            <p className="whitespace-pre-wrap text-sm">{errorModal.message}</p>
          </ModalBody>
          <ModalFooter>
            <Button color="primary" onPress={() => setErrorModal({ ...errorModal, isOpen: false })}>
              OK
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
