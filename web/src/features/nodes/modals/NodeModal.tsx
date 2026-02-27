import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Select,
  SelectItem,
  Switch,
  Textarea,
  Card,
  CardBody,
  Chip,
  Accordion,
  AccordionItem,
} from '@nextui-org/react';
import { Link } from 'lucide-react';
import type { Node, UnifiedNode } from '../../../store';
import {
  nodeTypeOptions,
  countryOptions,
  ssMethodOptions,
  vmessSecurityOptions,
  flowOptions,
  transportTypeOptions,
  utlsFingerprintOptions,
  congestionControlOptions,
  protocolsWithTls,
  protocolsWithTransport,
  knownExtraKeys,
} from '../types';

interface NodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingNode: UnifiedNode | null;
  nodeForm: Node;
  setNodeForm: (form: Node) => void;
  nodeUrl: string;
  setNodeUrl: (v: string) => void;
  isParsing: boolean;
  parseError: string;
  isSubmitting: boolean;
  onParseUrl: () => void;
  onSave: () => void;
  getExtra: (...keys: string[]) => any;
  setExtra: (...args: any[]) => void;
}

export default function NodeModal({
  isOpen,
  onClose,
  editingNode,
  nodeForm,
  setNodeForm,
  nodeUrl,
  setNodeUrl,
  isParsing,
  parseError,
  isSubmitting,
  onParseUrl,
  onSave,
  getExtra,
  setExtra,
}: NodeModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>{editingNode ? 'Edit Node' : 'Add Node'}</ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            {!editingNode && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    label="Node Link"
                    placeholder="Paste node link, e.g. hysteria2://... vmess://... ss://... socks://..."
                    value={nodeUrl}
                    onChange={(e) => setNodeUrl(e.target.value)}
                    startContent={<Link className="w-4 h-4 text-gray-400" />}
                    className="flex-1"
                  />
                  <Button
                    color="primary"
                    variant="flat"
                    onPress={onParseUrl}
                    isLoading={isParsing}
                    isDisabled={!nodeUrl.trim()}
                    className="self-end"
                  >
                    Parse
                  </Button>
                </div>
                {parseError && (
                  <p className="text-sm text-danger">{parseError}</p>
                )}
                <p className="text-xs text-gray-400">
                  Supported protocols: ss://, vmess://, vless://, trojan://, hysteria2://, tuic://, socks://
                </p>
              </div>
            )}

            {nodeForm.tag && (
              <Card className="bg-default-100">
                <CardBody className="py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{nodeForm.country_emoji || '🌐'}</span>
                    <div className="flex-1">
                      <h4 className="font-medium">{nodeForm.tag}</h4>
                      {nodeForm.source_tag && nodeForm.source_tag !== nodeForm.tag && (
                        <p className="text-xs text-gray-500 truncate" title={nodeForm.source_tag}>
                          Original: {nodeForm.source_tag}
                        </p>
                      )}
                      <p className="text-sm text-gray-500">
                        {nodeForm.type} · {nodeForm.server}:{nodeForm.server_port}
                      </p>
                    </div>
                    <Chip size="sm" variant="flat" color="success">Parsed</Chip>
                  </div>
                </CardBody>
              </Card>
            )}

            <Accordion variant="bordered" selectionMode="multiple">
              <AccordionItem key="basic" aria-label="Basic Settings" title="Basic Settings">
                <div className="space-y-4 pb-2">
                  <Input
                    label="Node Name"
                    placeholder="e.g.: Hong Kong-01"
                    value={nodeForm.tag}
                    onChange={(e) => setNodeForm({ ...nodeForm, tag: e.target.value, display_name: e.target.value })}
                  />

                  <Input
                    label="Original Name (source)"
                    placeholder="Original name from subscription/link"
                    value={nodeForm.source_tag || ''}
                    onChange={(e) => setNodeForm({ ...nodeForm, source_tag: e.target.value })}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <Select
                      label="Node Type"
                      selectedKeys={[nodeForm.type]}
                      onChange={(e) => setNodeForm({ ...nodeForm, type: e.target.value })}
                    >
                      {nodeTypeOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </Select>

                    <Select
                      label="Country/Region"
                      selectedKeys={[nodeForm.country || 'HK']}
                      onChange={(e) => {
                        const country = countryOptions.find(c => c.code === e.target.value);
                        setNodeForm({
                          ...nodeForm,
                          country: e.target.value,
                          country_emoji: country?.emoji || '🌐',
                        });
                      }}
                    >
                      {countryOptions.map((opt) => (
                        <SelectItem key={opt.code} value={opt.code}>
                          {opt.emoji} {opt.name}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="Server Address"
                      placeholder="example.com"
                      value={nodeForm.server}
                      onChange={(e) => setNodeForm({ ...nodeForm, server: e.target.value })}
                    />

                    <Input
                      type="number"
                      label="Port"
                      placeholder="443"
                      value={String(nodeForm.server_port)}
                      onChange={(e) => setNodeForm({ ...nodeForm, server_port: parseInt(e.target.value) || 443 })}
                    />
                  </div>
                </div>
              </AccordionItem>

              <AccordionItem key="protocol" aria-label="Protocol Settings" title="Protocol Settings">
                <div className="space-y-4 pb-2">
                  {nodeForm.type === 'shadowsocks' && (
                    <>
                      <Select
                        label="Encryption Method"
                        selectedKeys={getExtra('method') ? [getExtra('method')] : []}
                        onChange={(e) => setExtra('method', e.target.value)}
                      >
                        {ssMethodOptions.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </Select>
                      <Input
                        label="Password"
                        placeholder="Password"
                        value={getExtra('password') || ''}
                        onChange={(e) => setExtra('password', e.target.value)}
                      />
                    </>
                  )}

                  {nodeForm.type === 'vmess' && (
                    <>
                      <Input
                        label="UUID"
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        value={getExtra('uuid') || ''}
                        onChange={(e) => setExtra('uuid', e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <Select
                          label="Security"
                          selectedKeys={getExtra('security') ? [getExtra('security')] : ['auto']}
                          onChange={(e) => setExtra('security', e.target.value)}
                        >
                          {vmessSecurityOptions.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </Select>
                        <Input
                          type="number"
                          label="Alter ID"
                          placeholder="0"
                          value={String(getExtra('alter_id') ?? 0)}
                          onChange={(e) => setExtra('alter_id', parseInt(e.target.value) || 0)}
                        />
                      </div>
                    </>
                  )}

                  {nodeForm.type === 'vless' && (
                    <>
                      <Input
                        label="UUID"
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        value={getExtra('uuid') || ''}
                        onChange={(e) => setExtra('uuid', e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <Select
                          label="Flow"
                          selectedKeys={[getExtra('flow') || '']}
                          onChange={(e) => setExtra('flow', e.target.value)}
                        >
                          {flowOptions.map((f) => (
                            <SelectItem key={f} value={f}>{f || '(none)'}</SelectItem>
                          ))}
                        </Select>
                        <Select
                          label="Packet Encoding"
                          selectedKeys={[getExtra('packet_encoding') || '']}
                          onChange={(e) => setExtra('packet_encoding', e.target.value)}
                        >
                          <SelectItem key="" value="">(none)</SelectItem>
                          <SelectItem key="xudp" value="xudp">xudp</SelectItem>
                        </Select>
                      </div>
                    </>
                  )}

                  {nodeForm.type === 'trojan' && (
                    <>
                      <Input
                        label="Password"
                        placeholder="Password"
                        value={getExtra('password') || ''}
                        onChange={(e) => setExtra('password', e.target.value)}
                      />
                      <Select
                        label="Flow"
                        selectedKeys={[getExtra('flow') || '']}
                        onChange={(e) => setExtra('flow', e.target.value)}
                      >
                        {flowOptions.map((f) => (
                          <SelectItem key={f} value={f}>{f || '(none)'}</SelectItem>
                        ))}
                      </Select>
                    </>
                  )}

                  {nodeForm.type === 'hysteria2' && (
                    <>
                      <Input
                        label="Password"
                        placeholder="Password"
                        value={getExtra('password') || ''}
                        onChange={(e) => setExtra('password', e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          type="number"
                          label="Upload (Mbps)"
                          placeholder="0"
                          value={String(getExtra('up_mbps') ?? '')}
                          onChange={(e) => setExtra('up_mbps', e.target.value ? parseInt(e.target.value) : undefined)}
                        />
                        <Input
                          type="number"
                          label="Download (Mbps)"
                          placeholder="0"
                          value={String(getExtra('down_mbps') ?? '')}
                          onChange={(e) => setExtra('down_mbps', e.target.value ? parseInt(e.target.value) : undefined)}
                        />
                      </div>
                      <p className="text-xs text-gray-400 -mt-2">Obfuscation</p>
                      <div className="grid grid-cols-2 gap-4">
                        <Select
                          label="Obfs Type"
                          selectedKeys={[getExtra('obfs', 'type') || '']}
                          onChange={(e) => {
                            if (e.target.value) {
                              setExtra('obfs', 'type', e.target.value);
                            } else {
                              const extra = { ...nodeForm.extra } as Record<string, any>;
                              delete extra.obfs;
                              setNodeForm({ ...nodeForm, extra });
                            }
                          }}
                        >
                          <SelectItem key="" value="">(none)</SelectItem>
                          <SelectItem key="salamander" value="salamander">salamander</SelectItem>
                        </Select>
                        {getExtra('obfs', 'type') && (
                          <Input
                            label="Obfs Password"
                            placeholder="Obfuscation password"
                            value={getExtra('obfs', 'password') || ''}
                            onChange={(e) => setExtra('obfs', 'password', e.target.value)}
                          />
                        )}
                      </div>
                    </>
                  )}

                  {nodeForm.type === 'tuic' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          label="UUID"
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          value={getExtra('uuid') || ''}
                          onChange={(e) => setExtra('uuid', e.target.value)}
                        />
                        <Input
                          label="Password"
                          placeholder="Password"
                          value={getExtra('password') || ''}
                          onChange={(e) => setExtra('password', e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <Select
                          label="Congestion Control"
                          selectedKeys={getExtra('congestion_control') ? [getExtra('congestion_control')] : []}
                          onChange={(e) => setExtra('congestion_control', e.target.value)}
                        >
                          {congestionControlOptions.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </Select>
                        <Select
                          label="UDP Relay Mode"
                          selectedKeys={[getExtra('udp_relay_mode') || '']}
                          onChange={(e) => setExtra('udp_relay_mode', e.target.value)}
                        >
                          <SelectItem key="" value="">(default)</SelectItem>
                          <SelectItem key="native" value="native">native</SelectItem>
                          <SelectItem key="quic" value="quic">quic</SelectItem>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Zero RTT Handshake</span>
                        <Switch
                          size="sm"
                          isSelected={!!getExtra('zero_rtt_handshake')}
                          onValueChange={(v) => setExtra('zero_rtt_handshake', v || undefined)}
                        />
                      </div>
                      <Input
                        label="Heartbeat"
                        placeholder="e.g. 10s"
                        value={getExtra('heartbeat') || ''}
                        onChange={(e) => setExtra('heartbeat', e.target.value)}
                      />
                    </>
                  )}

                  {nodeForm.type === 'socks' && (
                    <>
                      <Select
                        label="SOCKS Version"
                        selectedKeys={[getExtra('version') || '5']}
                        onChange={(e) => setExtra('version', e.target.value)}
                      >
                        <SelectItem key="4" value="4">SOCKS4</SelectItem>
                        <SelectItem key="5" value="5">SOCKS5</SelectItem>
                      </Select>
                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          label="Username"
                          placeholder="(optional)"
                          value={getExtra('username') || ''}
                          onChange={(e) => setExtra('username', e.target.value)}
                        />
                        <Input
                          label="Password"
                          placeholder="(optional)"
                          value={getExtra('password') || ''}
                          onChange={(e) => setExtra('password', e.target.value)}
                        />
                      </div>
                    </>
                  )}
                </div>
              </AccordionItem>
            </Accordion>

            {protocolsWithTls.includes(nodeForm.type) && (
              <Accordion variant="bordered" selectionMode="multiple">
                <AccordionItem key="tls" aria-label="TLS Settings" title="TLS Settings">
                  <div className="space-y-4 pb-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Enable TLS</span>
                      <Switch
                        size="sm"
                        isSelected={!!getExtra('tls', 'enabled')}
                        onValueChange={(v) => {
                          if (v) {
                            setExtra('tls', 'enabled', true);
                          } else {
                            const extra = { ...nodeForm.extra } as Record<string, any>;
                            delete extra.tls;
                            setNodeForm({ ...nodeForm, extra });
                          }
                        }}
                      />
                    </div>

                    {!!getExtra('tls', 'enabled') && (
                      <>
                        <Input
                          label="SNI (Server Name)"
                          placeholder="example.com"
                          value={getExtra('tls', 'server_name') || ''}
                          onChange={(e) => setExtra('tls', 'server_name', e.target.value)}
                        />

                        <div className="flex items-center justify-between">
                          <span className="text-sm">Allow Insecure</span>
                          <Switch
                            size="sm"
                            isSelected={!!getExtra('tls', 'insecure')}
                            onValueChange={(v) => setExtra('tls', 'insecure', v || undefined)}
                          />
                        </div>

                        <Input
                          label="ALPN"
                          placeholder="h2,http/1.1 (comma-separated)"
                          value={Array.isArray(getExtra('tls', 'alpn')) ? getExtra('tls', 'alpn').join(',') : (getExtra('tls', 'alpn') || '')}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val) {
                              setExtra('tls', 'alpn', val.split(',').map((s: string) => s.trim()).filter(Boolean));
                            } else {
                              setExtra('tls', 'alpn', undefined);
                            }
                          }}
                        />

                        <Select
                          label="uTLS Fingerprint"
                          selectedKeys={[getExtra('tls', 'utls', 'fingerprint') || '']}
                          onChange={(e) => {
                            if (e.target.value) {
                              const tls = { ...(nodeForm.extra?.tls || {}), utls: { enabled: true, fingerprint: e.target.value } };
                              const extra = { ...nodeForm.extra, tls } as Record<string, any>;
                              setNodeForm({ ...nodeForm, extra });
                            } else {
                              const tls = { ...(nodeForm.extra?.tls || {}) };
                              delete tls.utls;
                              const extra = { ...nodeForm.extra, tls } as Record<string, any>;
                              setNodeForm({ ...nodeForm, extra });
                            }
                          }}
                        >
                          {utlsFingerprintOptions.map((f) => (
                            <SelectItem key={f} value={f}>{f || '(none)'}</SelectItem>
                          ))}
                        </Select>

                        {(nodeForm.type === 'vless' || nodeForm.type === 'trojan') && (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-sm">Reality</span>
                              <Switch
                                size="sm"
                                isSelected={!!getExtra('tls', 'reality', 'enabled')}
                                onValueChange={(v) => {
                                  if (v) {
                                    setExtra('tls', 'reality', { enabled: true, public_key: '', short_id: '' });
                                  } else {
                                    const tls = { ...(nodeForm.extra?.tls || {}) };
                                    delete tls.reality;
                                    const extra = { ...nodeForm.extra, tls } as Record<string, any>;
                                    setNodeForm({ ...nodeForm, extra });
                                  }
                                }}
                              />
                            </div>

                            {!!getExtra('tls', 'reality', 'enabled') && (
                              <div className="grid grid-cols-2 gap-4">
                                <Input
                                  label="Public Key"
                                  placeholder="Reality public key"
                                  value={getExtra('tls', 'reality', 'public_key') || ''}
                                  onChange={(e) => setExtra('tls', 'reality', { ...getExtra('tls', 'reality'), public_key: e.target.value })}
                                />
                                <Input
                                  label="Short ID"
                                  placeholder="Reality short ID"
                                  value={getExtra('tls', 'reality', 'short_id') || ''}
                                  onChange={(e) => setExtra('tls', 'reality', { ...getExtra('tls', 'reality'), short_id: e.target.value })}
                                />
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </AccordionItem>
              </Accordion>
            )}

            {protocolsWithTransport.includes(nodeForm.type) && (
              <Accordion variant="bordered" selectionMode="multiple">
                <AccordionItem key="transport" aria-label="Transport" title="Transport">
                  <div className="space-y-4 pb-2">
                    <Select
                      label="Transport Type"
                      selectedKeys={[getExtra('transport', 'type') || '']}
                      onChange={(e) => {
                        if (e.target.value) {
                          setExtra('transport', 'type', e.target.value);
                        } else {
                          const extra = { ...nodeForm.extra } as Record<string, any>;
                          delete extra.transport;
                          setNodeForm({ ...nodeForm, extra });
                        }
                      }}
                    >
                      {['' , ...transportTypeOptions].map((t) => (
                        <SelectItem key={t} value={t}>{t || '(none)'}</SelectItem>
                      ))}
                    </Select>

                    {getExtra('transport', 'type') === 'ws' && (
                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          label="Path"
                          placeholder="/"
                          value={getExtra('transport', 'path') || ''}
                          onChange={(e) => setExtra('transport', 'path', e.target.value)}
                        />
                        <Input
                          label="Host Header"
                          placeholder="example.com"
                          value={getExtra('transport', 'headers', 'Host') || ''}
                          onChange={(e) => {
                            const transport = { ...(nodeForm.extra?.transport || {}) };
                            if (e.target.value) {
                              transport.headers = { ...(transport.headers || {}), Host: e.target.value };
                            } else {
                              if (transport.headers) {
                                delete transport.headers.Host;
                                if (Object.keys(transport.headers).length === 0) delete transport.headers;
                              }
                            }
                            const extra = { ...nodeForm.extra, transport } as Record<string, any>;
                            setNodeForm({ ...nodeForm, extra });
                          }}
                        />
                      </div>
                    )}

                    {(getExtra('transport', 'type') === 'http' || getExtra('transport', 'type') === 'h2') && (
                      <div className="grid grid-cols-2 gap-4">
                        <Input
                          label="Path"
                          placeholder="/"
                          value={getExtra('transport', 'path') || ''}
                          onChange={(e) => setExtra('transport', 'path', e.target.value)}
                        />
                        <Input
                          label="Host"
                          placeholder="example.com (comma-separated)"
                          value={Array.isArray(getExtra('transport', 'host')) ? getExtra('transport', 'host').join(',') : (getExtra('transport', 'host') || '')}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val) {
                              setExtra('transport', 'host', val.split(',').map((s: string) => s.trim()).filter(Boolean));
                            } else {
                              setExtra('transport', 'host', undefined);
                            }
                          }}
                        />
                      </div>
                    )}

                    {getExtra('transport', 'type') === 'grpc' && (
                      <Input
                        label="Service Name"
                        placeholder="grpc-service"
                        value={getExtra('transport', 'service_name') || ''}
                        onChange={(e) => setExtra('transport', 'service_name', e.target.value)}
                      />
                    )}
                  </div>
                </AccordionItem>
              </Accordion>
            )}

            {(() => {
              const known = new Set(knownExtraKeys[nodeForm.type] || []);
              const unknownKeys = Object.keys(nodeForm.extra || {}).filter(k => !known.has(k));
              if (unknownKeys.length === 0) return null;
              const unknownObj: Record<string, any> = {};
              for (const k of unknownKeys) unknownObj[k] = (nodeForm.extra as Record<string, any>)[k];
              return (
                <Accordion variant="bordered" selectionMode="multiple">
                  <AccordionItem key="other" aria-label="Other" title={`Other (${unknownKeys.length})`}>
                    <div className="space-y-3 pb-2">
                      <p className="text-xs text-gray-400">
                        Extra fields not covered by the editor above. Edit as JSON.
                      </p>
                      <Textarea
                        label="Other Fields (JSON)"
                        minRows={3}
                        maxRows={10}
                        value={JSON.stringify(unknownObj, null, 2)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
                            const extra = { ...nodeForm.extra } as Record<string, any>;
                            for (const k of unknownKeys) delete extra[k];
                            for (const [k, v] of Object.entries(parsed)) extra[k] = v;
                            setNodeForm({ ...nodeForm, extra });
                          } catch {
                            // Ignore invalid JSON while user is typing
                          }
                        }}
                      />
                    </div>
                  </AccordionItem>
                </Accordion>
              );
            })()}

          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={onSave}
            isLoading={isSubmitting}
            isDisabled={!nodeForm.tag || !nodeForm.server}
          >
            {editingNode ? 'Save' : 'Add'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
