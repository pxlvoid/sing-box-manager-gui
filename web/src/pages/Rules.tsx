import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  Switch,
  Chip,
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Select,
  SelectItem,
  Textarea,
  useDisclosure,
  Spinner,
} from '@nextui-org/react';
import { Shield, Globe, Tv, MessageCircle, Github, Bot, Apple, Monitor, Plus, Pencil, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { useStore } from '../store';
import { ruleSetApi } from '../api';
import type { Rule, RuleGroup } from '../store';

// Rule set validation result type
interface ValidationResult {
  valid: boolean;
  url: string;
  tag: string;
  message: string;
}

const iconMap: Record<string, React.ReactNode> = {
  'ad-block': <Shield className="w-5 h-5" />,
  'ai-services': <Bot className="w-5 h-5" />,
  'google': <Globe className="w-5 h-5" />,
  'youtube': <Tv className="w-5 h-5" />,
  'github': <Github className="w-5 h-5" />,
  'telegram': <MessageCircle className="w-5 h-5" />,
  'twitter': <MessageCircle className="w-5 h-5" />,
  'netflix': <Tv className="w-5 h-5" />,
  'spotify': <Tv className="w-5 h-5" />,
  'apple': <Apple className="w-5 h-5" />,
  'microsoft': <Monitor className="w-5 h-5" />,
  'cn': <Globe className="w-5 h-5" />,
  'private': <Shield className="w-5 h-5" />,
};

const baseOutboundOptions = [
  { value: 'Proxy', label: 'Proxy' },
  { value: 'DIRECT', label: 'DIRECT' },
  { value: 'REJECT', label: 'REJECT (Block)' },
];

const ruleTypeOptions = [
  { value: 'domain_suffix', label: 'Domain Suffix (domain_suffix)' },
  { value: 'domain_keyword', label: 'Domain Keyword (domain_keyword)' },
  { value: 'domain', label: 'Full Domain (domain)' },
  { value: 'ip_cidr', label: 'IP Range (ip_cidr)' },
  { value: 'geosite', label: 'GeoSite Rule Set' },
  { value: 'geoip', label: 'GeoIP Rule Set' },
  { value: 'port', label: 'Port (port)' },
];

const defaultRule: Omit<Rule, 'id'> = {
  name: '',
  rule_type: 'domain_suffix',
  values: [],
  outbound: 'Proxy',
  enabled: true,
  priority: 100,
};

export default function Rules() {
  const {
    ruleGroups,
    rules,
    filters,
    countryGroups,
    fetchRuleGroups,
    fetchRules,
    fetchFilters,
    fetchCountryGroups,
    toggleRuleGroup,
    updateRuleGroupOutbound,
    addRule,
    updateRule,
    deleteRule,
  } = useStore();

  const { isOpen, onOpen, onClose } = useDisclosure();
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [formData, setFormData] = useState<Omit<Rule, 'id'>>(defaultRule);
  const [valuesText, setValuesText] = useState('');

  // Rule set validation state
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResult>>({});
  const [isValidating, setIsValidating] = useState(false);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchRuleGroups();
    fetchRules();
    fetchFilters();
    fetchCountryGroups();
  }, []);

  // Validate rule set (debounced)
  const validateRuleSet = useCallback(async (type: 'geosite' | 'geoip', names: string[]) => {
    if (names.length === 0) {
      setValidationResults({});
      return;
    }

    setIsValidating(true);
    const results: Record<string, ValidationResult> = {};

    for (const name of names) {
      if (!name.trim()) continue;
      try {
        const response = await ruleSetApi.validate(type, name.trim());
        results[name] = response.data;
      } catch (error) {
        results[name] = {
          valid: false,
          url: '',
          tag: '',
          message: 'Validation request failed',
        };
      }
    }

    setValidationResults(results);
    setIsValidating(false);
  }, []);

  // Trigger validation when rule values change (debounce 500ms)
  useEffect(() => {
    if (formData.rule_type !== 'geosite' && formData.rule_type !== 'geoip') {
      setValidationResults({});
      return;
    }

    const names = valuesText
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v);

    if (names.length === 0) {
      setValidationResults({});
      return;
    }

    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current);
    }

    validationTimerRef.current = setTimeout(() => {
      validateRuleSet(formData.rule_type as 'geosite' | 'geoip', names);
    }, 500);

    return () => {
      if (validationTimerRef.current) {
        clearTimeout(validationTimerRef.current);
      }
    };
  }, [valuesText, formData.rule_type, validateRuleSet]);

  // Check if all rule sets passed validation
  const allValidationsPassed = useCallback(() => {
    if (formData.rule_type !== 'geosite' && formData.rule_type !== 'geoip') {
      return true;
    }

    const names = valuesText
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v);

    if (names.length === 0) return false;

    return names.every((name) => validationResults[name]?.valid);
  }, [formData.rule_type, valuesText, validationResults]);

  // Get all available outbound options (including country node groups and filters)
  const getAllOutboundOptions = () => {
    const options = [...baseOutboundOptions];

    // Add country node groups
    countryGroups.forEach((group) => {
      const label = `${group.emoji} ${group.name}`;
      options.push({ value: label, label: `${label} (${group.node_count} nodes)` });
    });

    // Add filters
    filters.forEach((filter) => {
      if (filter.enabled) {
        options.push({ value: filter.name, label: `${filter.name} (Filter)` });
      }
    });

    return options;
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await toggleRuleGroup(id, enabled);
  };

  const handleOutboundChange = async (group: RuleGroup, outbound: string) => {
    await updateRuleGroupOutbound(group.id, outbound);
  };

  const handleAddRule = () => {
    setEditingRule(null);
    setFormData(defaultRule);
    setValuesText('');
    setValidationResults({});
    onOpen();
  };

  const handleEditRule = (rule: Rule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      rule_type: rule.rule_type,
      values: rule.values,
      outbound: rule.outbound,
      enabled: rule.enabled,
      priority: rule.priority,
    });
    setValuesText(rule.values.join('\n'));
    setValidationResults({});
    onOpen();
  };

  const handleDeleteRule = async (rule: Rule) => {
    if (confirm(`Are you sure you want to delete rule "${rule.name}"?`)) {
      await deleteRule(rule.id);
    }
  };

  const handleSubmit = async () => {
    const values = valuesText
      .split('\n')
      .map((v) => v.trim())
      .filter((v) => v);

    const ruleData = {
      ...formData,
      values,
    };

    if (editingRule) {
      await updateRule(editingRule.id, ruleData);
    } else {
      await addRule(ruleData);
    }

    onClose();
  };

  const handleToggleCustomRule = async (rule: Rule) => {
    await updateRule(rule.id, { ...rule, enabled: !rule.enabled });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Rule Management</h1>
      </div>

      {/* Preset Rule Groups */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Preset Rule Groups</h2>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ruleGroups.map((group) => (
              <div
                key={group.id}
                className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white dark:bg-gray-700 rounded-lg">
                    {iconMap[group.id] || <Globe className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="font-medium">{group.name}</h3>
                    <div className="flex gap-1 mt-1">
                      {group.site_rules.slice(0, 2).map((rule) => (
                        <Chip key={rule} size="sm" variant="flat">
                          {rule}
                        </Chip>
                      ))}
                      {group.site_rules.length > 2 && (
                        <Chip size="sm" variant="flat">
                          +{group.site_rules.length - 2}
                        </Chip>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Select
                    size="sm"
                    className="w-32"
                    selectedKeys={[group.outbound]}
                    onChange={(e) => handleOutboundChange(group, e.target.value)}
                    aria-label="Select outbound"
                  >
                    {getAllOutboundOptions().map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.value}
                      </SelectItem>
                    ))}
                  </Select>
                  <Switch
                    isSelected={group.enabled}
                    onValueChange={(enabled) => handleToggle(group.id, enabled)}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Custom Rules */}
      <Card>
        <CardHeader className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Custom Rules</h2>
          <Button
            color="primary"
            size="sm"
            startContent={<Plus className="w-4 h-4" />}
            onPress={handleAddRule}
          >
            Add Rule
          </Button>
        </CardHeader>
        <CardBody>
          {rules.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No custom rules yet. Click the button above to add one.
            </p>
          ) : (
            <div className="space-y-3">
              {rules
                .sort((a, b) => a.priority - b.priority)
                .map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{rule.name}</h3>
                        <Chip size="sm" variant="flat" color="secondary">
                          {ruleTypeOptions.find((t) => t.value === rule.rule_type)?.label.split(' ')[0] || rule.rule_type}
                        </Chip>
                        <Chip
                          size="sm"
                          color={
                            rule.outbound === 'DIRECT'
                              ? 'success'
                              : rule.outbound === 'REJECT'
                              ? 'danger'
                              : 'primary'
                          }
                          variant="flat"
                        >
                          {rule.outbound}
                        </Chip>
                      </div>
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {rule.values.slice(0, 3).map((val, idx) => (
                          <Chip key={idx} size="sm" variant="bordered">
                            {val}
                          </Chip>
                        ))}
                        {rule.values.length > 3 && (
                          <Chip size="sm" variant="bordered">
                            +{rule.values.length - 3} more
                          </Chip>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Chip size="sm" variant="flat">
                        Priority: {rule.priority}
                      </Chip>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        onPress={() => handleEditRule(rule)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        color="danger"
                        onPress={() => handleDeleteRule(rule)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <Switch
                        isSelected={rule.enabled}
                        onValueChange={() => handleToggleCustomRule(rule)}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Add/Edit Rule Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalContent>
          <ModalHeader>{editingRule ? 'Edit Rule' : 'Add Rule'}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Input
                label="Rule Name"
                placeholder="e.g.: Block ad domains"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />

              <Select
                label="Rule Type"
                selectedKeys={[formData.rule_type]}
                onChange={(e) => setFormData({ ...formData, rule_type: e.target.value })}
              >
                {ruleTypeOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>

              <Textarea
                label="Rule Values"
                placeholder={
                  formData.rule_type === 'domain_suffix'
                    ? 'One domain suffix per line, e.g.:\ngoogle.com\nyoutube.com'
                    : formData.rule_type === 'ip_cidr'
                    ? 'One IP range per line, e.g.:\n192.168.0.0/16\n10.0.0.0/8'
                    : formData.rule_type === 'geosite'
                    ? 'One geosite rule set name per line, e.g.:\ngoogle\nyoutube\ncursor'
                    : formData.rule_type === 'geoip'
                    ? 'One geoip rule set name per line, e.g.:\ncn\ngoogle'
                    : 'One value per line'
                }
                value={valuesText}
                onChange={(e) => setValuesText(e.target.value)}
                minRows={4}
              />

              {/* Rule set validation results */}
              {(formData.rule_type === 'geosite' || formData.rule_type === 'geoip') && valuesText.trim() && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <span>Rule Set Validation Results</span>
                    {isValidating && <Spinner size="sm" />}
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {valuesText
                      .split('\n')
                      .map((v) => v.trim())
                      .filter((v) => v)
                      .map((name) => {
                        const result = validationResults[name];
                        if (!result) {
                          return (
                            <div key={name} className="flex items-center gap-2 text-sm text-gray-500">
                              <Spinner size="sm" />
                              <span>{name} - Validating...</span>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={name}
                            className={`flex items-center gap-2 text-sm ${
                              result.valid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            {result.valid ? (
                              <CheckCircle className="w-4 h-4" />
                            ) : (
                              <XCircle className="w-4 h-4" />
                            )}
                            <span className="font-medium">{name}</span>
                            <span className="text-xs opacity-75">- {result.message}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              <Select
                label="Outbound"
                selectedKeys={[formData.outbound]}
                onChange={(e) => setFormData({ ...formData, outbound: e.target.value })}
              >
                {getAllOutboundOptions().map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </Select>

              <Input
                type="number"
                label="Priority"
                placeholder="Lower number = higher priority"
                value={String(formData.priority)}
                onChange={(e) =>
                  setFormData({ ...formData, priority: parseInt(e.target.value) || 100 })
                }
              />

              <div className="flex items-center justify-between">
                <span>Enable Rule</span>
                <Switch
                  isSelected={formData.enabled}
                  onValueChange={(enabled) => setFormData({ ...formData, enabled })}
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onClose}>
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={handleSubmit}
              isDisabled={!formData.name || !valuesText.trim() || isValidating || !allValidationsPassed()}
            >
              {editingRule ? 'Save' : 'Add'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
