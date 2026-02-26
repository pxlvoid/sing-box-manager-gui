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
  Tab,
  Tabs,
  useDisclosure,
  Spinner,
  Tooltip,
} from '@nextui-org/react';
import { Shield, Globe, Tv, MessageCircle, Github, Bot, Apple, Monitor, Plus, Pencil, Trash2, CheckCircle, XCircle, RotateCcw, AlertTriangle } from 'lucide-react';
import { useStore } from '../store';
import { ruleApi, ruleGroupApi, ruleSetApi, settingsApi } from '../api';
import { toast } from '../components/Toast';
import type { Rule, RuleGroup, ProxyMode } from '../store';

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

const switchyHeader = '[SwitchyOmega Conditions]\n@with result';

const outboundAliases: Record<string, string> = {
  direct: 'DIRECT',
  proxy: 'Proxy',
  outline: 'Proxy',
  reject: 'REJECT',
  block: 'REJECT',
};

// Check if a rule group differs from its default version
function isRuleGroupModified(group: RuleGroup, defaults: RuleGroup[]): boolean {
  const defaultGroup = defaults.find((d) => d.id === group.id);
  if (!defaultGroup) return false;
  return (
    group.name !== defaultGroup.name ||
    JSON.stringify(group.site_rules || []) !== JSON.stringify(defaultGroup.site_rules || []) ||
    JSON.stringify(group.ip_rules || []) !== JSON.stringify(defaultGroup.ip_rules || [])
  );
}

export default function Rules() {
  const {
    ruleGroups,
    defaultRuleGroups,
    rules,
    settings,
    filters,
    countryGroups,
    fetchRuleGroups,
    fetchDefaultRuleGroups,
    fetchRules,
    fetchSettings,
    fetchFilters,
    fetchCountryGroups,
    toggleRuleGroup,
    updateRuleGroupOutbound,
    updateRuleGroup,
    resetRuleGroup,
    addRule,
    updateRule,
    deleteRule,
    proxyMode,
    proxyModeRunning,
    proxyModeSwitching,
    fetchProxyMode,
    setProxyMode,
  } = useStore();

  // Custom rule modal
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [formData, setFormData] = useState<Omit<Rule, 'id'>>(defaultRule);
  const [valuesText, setValuesText] = useState('');
  const [customRulesView, setCustomRulesView] = useState<'visual' | 'text'>('visual');
  const [switchyText, setSwitchyText] = useState('');
  const [switchyDirty, setSwitchyDirty] = useState(false);
  const [switchyErrors, setSwitchyErrors] = useState<string[]>([]);
  const [isApplyingSwitchyText, setIsApplyingSwitchyText] = useState(false);
  const [presetRuleGroupsView, setPresetRuleGroupsView] = useState<'visual' | 'text'>('visual');
  const [presetRuleGroupsText, setPresetRuleGroupsText] = useState('');
  const [presetRuleGroupsDirty, setPresetRuleGroupsDirty] = useState(false);
  const [presetRuleGroupsErrors, setPresetRuleGroupsErrors] = useState<string[]>([]);
  const [isApplyingPresetRuleGroupsText, setIsApplyingPresetRuleGroupsText] = useState(false);

  // Rule group edit modal
  const { isOpen: isRuleGroupModalOpen, onOpen: onRuleGroupModalOpen, onClose: onRuleGroupModalClose } = useDisclosure();
  const [editingRuleGroup, setEditingRuleGroup] = useState<RuleGroup | null>(null);
  const [rgName, setRgName] = useState('');
  const [rgSiteRulesText, setRgSiteRulesText] = useState('');
  const [rgIpRulesText, setRgIpRulesText] = useState('');

  // Rule set validation state (shared between both modals)
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResult>>({});
  const [isValidating, setIsValidating] = useState(false);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rule group validation state
  const [rgSiteValidation, setRgSiteValidation] = useState<Record<string, ValidationResult>>({});
  const [rgIpValidation, setRgIpValidation] = useState<Record<string, ValidationResult>>({});
  const [rgSiteValidating, setRgSiteValidating] = useState(false);
  const [rgIpValidating, setRgIpValidating] = useState(false);
  const rgSiteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rgIpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchRuleGroups();
    fetchDefaultRuleGroups();
    fetchRules();
    fetchSettings();
    fetchFilters();
    fetchCountryGroups();
    fetchProxyMode();
  }, []);

  // Validate rule sets helper
  const doValidate = useCallback(async (type: 'geosite' | 'geoip', names: string[]): Promise<Record<string, ValidationResult>> => {
    const results: Record<string, ValidationResult> = {};
    for (const name of names) {
      if (!name.trim()) continue;
      try {
        const response = await ruleSetApi.validate(type, name.trim());
        results[name] = response.data;
      } catch (error) {
        results[name] = { valid: false, url: '', tag: '', message: 'Validation request failed' };
      }
    }
    return results;
  }, []);

  // Validate rule set for custom rules (debounced)
  const validateRuleSet = useCallback(async (type: 'geosite' | 'geoip', names: string[]) => {
    if (names.length === 0) {
      setValidationResults({});
      return;
    }
    setIsValidating(true);
    const results = await doValidate(type, names);
    setValidationResults(results);
    setIsValidating(false);
  }, [doValidate]);

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

  // Rule group site_rules validation (debounced)
  useEffect(() => {
    if (!isRuleGroupModalOpen) return;
    const names = rgSiteRulesText.split('\n').map((v) => v.trim()).filter((v) => v);
    if (names.length === 0) { setRgSiteValidation({}); return; }
    if (rgSiteTimerRef.current) clearTimeout(rgSiteTimerRef.current);
    rgSiteTimerRef.current = setTimeout(async () => {
      setRgSiteValidating(true);
      const results = await doValidate('geosite', names);
      setRgSiteValidation(results);
      setRgSiteValidating(false);
    }, 500);
    return () => { if (rgSiteTimerRef.current) clearTimeout(rgSiteTimerRef.current); };
  }, [rgSiteRulesText, isRuleGroupModalOpen, doValidate]);

  // Rule group ip_rules validation (debounced)
  useEffect(() => {
    if (!isRuleGroupModalOpen) return;
    const names = rgIpRulesText.split('\n').map((v) => v.trim()).filter((v) => v);
    if (names.length === 0) { setRgIpValidation({}); return; }
    if (rgIpTimerRef.current) clearTimeout(rgIpTimerRef.current);
    rgIpTimerRef.current = setTimeout(async () => {
      setRgIpValidating(true);
      const results = await doValidate('geoip', names);
      setRgIpValidation(results);
      setRgIpValidating(false);
    }, 500);
    return () => { if (rgIpTimerRef.current) clearTimeout(rgIpTimerRef.current); };
  }, [rgIpRulesText, isRuleGroupModalOpen, doValidate]);

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

  // Check if rule group form validation passes
  const rgValidationsPassed = useCallback(() => {
    const siteNames = rgSiteRulesText.split('\n').map((v) => v.trim()).filter((v) => v);
    const ipNames = rgIpRulesText.split('\n').map((v) => v.trim()).filter((v) => v);

    if (siteNames.length === 0 && ipNames.length === 0) return false;

    const sitesOk = siteNames.length === 0 || siteNames.every((n) => rgSiteValidation[n]?.valid);
    const ipsOk = ipNames.length === 0 || ipNames.every((n) => rgIpValidation[n]?.valid);

    return sitesOk && ipsOk;
  }, [rgSiteRulesText, rgIpRulesText, rgSiteValidation, rgIpValidation]);

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

  const outboundToTextToken = (outbound: string) => {
    if (outbound === 'DIRECT') return 'direct';
    if (outbound === 'Proxy') return 'proxy';
    if (outbound === 'REJECT') return 'reject';
    return outbound;
  };

  const textPatternToRule = (pattern: string): { rule_type: string; value: string } | null => {
    const trimmed = pattern.trim();
    if (!trimmed) return null;

    const prefixedRuleTypes = [
      { prefix: 'keyword:', rule_type: 'domain_keyword' },
      { prefix: 'ip:', rule_type: 'ip_cidr' },
      { prefix: 'geosite:', rule_type: 'geosite' },
      { prefix: 'geoip:', rule_type: 'geoip' },
      { prefix: 'port:', rule_type: 'port' },
      { prefix: 'domain:', rule_type: 'domain' },
      { prefix: 'suffix:', rule_type: 'domain_suffix' },
    ];

    const lower = trimmed.toLowerCase();
    for (const item of prefixedRuleTypes) {
      if (lower.startsWith(item.prefix)) {
        const value = trimmed.slice(item.prefix.length).trim();
        if (!value) return null;
        return { rule_type: item.rule_type, value };
      }
    }

    if (trimmed.startsWith('*.') && !trimmed.slice(2).includes('*')) {
      const value = trimmed.slice(2).trim();
      return value ? { rule_type: 'domain_suffix', value } : null;
    }

    if (trimmed.includes('*')) {
      return null;
    }

    return { rule_type: 'domain', value: trimmed };
  };

  const ruleToTextPattern = (ruleType: string, value: string) => {
    if (ruleType === 'domain_suffix') return `*.${value}`;
    if (ruleType === 'domain') return value;
    if (ruleType === 'domain_keyword') return `keyword:${value}`;
    if (ruleType === 'ip_cidr') return `ip:${value}`;
    if (ruleType === 'geosite') return `geosite:${value}`;
    if (ruleType === 'geoip') return `geoip:${value}`;
    if (ruleType === 'port') return `port:${value}`;
    return null;
  };

  const buildSwitchyTextFromRules = useCallback(() => {
    const lines: string[] = [];
    const sorted = [...rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sorted) {
      for (const rawValue of rule.values || []) {
        const value = rawValue.trim();
        if (!value) continue;
        const pattern = ruleToTextPattern(rule.rule_type, value);
        if (!pattern) continue;
        const disabledPrefix = rule.enabled ? '' : '!';
        lines.push(`${disabledPrefix}${pattern} +${outboundToTextToken(rule.outbound)}`);
      }
    }

    if (settings?.final_outbound) {
      lines.push(`* +${outboundToTextToken(settings.final_outbound)}`);
    }

    return `${switchyHeader}\n\n${lines.join('\n')}`;
  }, [rules, settings?.final_outbound]);

  const normalizeOutboundToken = (rawOutbound: string, knownOutbounds: Map<string, string>) => {
    const token = rawOutbound.trim();
    if (!token) return '';
    const alias = outboundAliases[token.toLowerCase()];
    if (alias) return alias;
    return knownOutbounds.get(token.toLowerCase()) || '';
  };

  const parseSwitchyText = (): {
    rules: Omit<Rule, 'id'>[];
    finalOutbound?: string;
    errors: string[];
  } => {
    const knownOutbounds = new Map<string, string>();
    for (const opt of getAllOutboundOptions()) {
      knownOutbounds.set(opt.value.toLowerCase(), opt.value);
    }
    for (const rule of rules) {
      knownOutbounds.set(rule.outbound.toLowerCase(), rule.outbound);
    }
    if (settings?.final_outbound) {
      knownOutbounds.set(settings.final_outbound.toLowerCase(), settings.final_outbound);
    }
    for (const aliasTarget of Object.values(outboundAliases)) {
      knownOutbounds.set(aliasTarget.toLowerCase(), aliasTarget);
    }

    const parsedRules: Omit<Rule, 'id'>[] = [];
    const errors: string[] = [];
    let finalOutbound: string | undefined;
    let priority = 1;
    const lines = switchyText.split('\n');

    for (let i = 0; i < lines.length; i += 1) {
      const lineNumber = i + 1;
      const rawLine = lines[i].trim();
      if (!rawLine) continue;
      if (rawLine === '[SwitchyOmega Conditions]' || rawLine.toLowerCase() === '@with result') continue;
      if (rawLine.startsWith('#') || rawLine.startsWith('//')) continue;

      let enabled = true;
      let line = rawLine;
      if (line.startsWith('!')) {
        enabled = false;
        line = line.slice(1).trim();
      }

      const match = line.match(/^(.*?)\s+\+(.+)$/);
      if (!match) {
        errors.push(`Line ${lineNumber}: expected "<pattern> +<outbound>"`);
        continue;
      }

      const pattern = match[1].trim();
      const rawOutbound = match[2].trim();
      const outbound = normalizeOutboundToken(rawOutbound, knownOutbounds);
      if (!outbound) {
        errors.push(`Line ${lineNumber}: unknown outbound "${rawOutbound}"`);
        continue;
      }

      if (pattern === '*') {
        finalOutbound = outbound;
        continue;
      }

      const parsed = textPatternToRule(pattern);
      if (!parsed) {
        errors.push(`Line ${lineNumber}: unsupported pattern "${pattern}"`);
        continue;
      }

      const shortValue = parsed.value.length > 60 ? `${parsed.value.slice(0, 57)}...` : parsed.value;
      parsedRules.push({
        name: `${parsed.rule_type}:${shortValue}`,
        rule_type: parsed.rule_type,
        values: [parsed.value],
        outbound,
        enabled,
        priority,
      });
      priority += 1;
    }

    return { rules: parsedRules, finalOutbound, errors };
  };

  const handleReloadSwitchyText = () => {
    setSwitchyText(buildSwitchyTextFromRules());
    setSwitchyDirty(false);
    setSwitchyErrors([]);
  };

  const handleApplySwitchyText = async () => {
    const parsed = parseSwitchyText();
    if (parsed.errors.length > 0) {
      setSwitchyErrors(parsed.errors.slice(0, 8));
      toast.error(`Text parse failed: ${parsed.errors[0]}`);
      return;
    }

    if (parsed.rules.length === 0 && !parsed.finalOutbound) {
      toast.error('Nothing to apply: no valid rules found');
      return;
    }

    if (!confirm(`Replace all custom rules with ${parsed.rules.length} rule(s) from text mode?`)) {
      return;
    }

    setIsApplyingSwitchyText(true);
    setSwitchyErrors([]);
    try {
      const ruleRes = await ruleApi.replaceAll(parsed.rules);
      if (ruleRes.data.warning) {
        toast.info(ruleRes.data.warning);
      } else {
        toast.success(`Applied ${parsed.rules.length} text rule(s)`);
      }
      await fetchRules();

      if (parsed.finalOutbound && settings && settings.final_outbound !== parsed.finalOutbound) {
        const settingsRes = await settingsApi.update({
          ...settings,
          final_outbound: parsed.finalOutbound,
        });
        if (settingsRes.data.warning) {
          toast.info(settingsRes.data.warning);
        } else {
          toast.success(`Final outbound set to ${parsed.finalOutbound}`);
        }
        await fetchSettings();
      } else if (parsed.finalOutbound && !settings) {
        toast.info(`Parsed fallback "* +${parsed.finalOutbound}", but settings are not loaded`);
      }

      setSwitchyDirty(false);
    } catch (error: any) {
      console.error('Failed to apply text rules:', error);
      toast.error(error.response?.data?.error || 'Failed to apply text rules');
    } finally {
      setIsApplyingSwitchyText(false);
    }
  };

  useEffect(() => {
    if (switchyDirty) return;
    setSwitchyText(buildSwitchyTextFromRules());
  }, [buildSwitchyTextFromRules, switchyDirty]);

  const buildPresetRuleGroupsText = useCallback(() => {
    return JSON.stringify(
      ruleGroups.map((group) => ({
        id: group.id,
        name: group.name,
        enabled: group.enabled,
        outbound: group.outbound,
        site_rules: group.site_rules || [],
        ip_rules: group.ip_rules || [],
      })),
      null,
      2,
    );
  }, [ruleGroups]);

  const parsePresetRuleGroupsText = (): {
    groups: RuleGroup[];
    errors: string[];
  } => {
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(presetRuleGroupsText);
    } catch (error: any) {
      return { groups: [], errors: [`Invalid JSON: ${error.message}`] };
    }

    if (!Array.isArray(parsedData)) {
      return { groups: [], errors: ['Top-level value must be a JSON array'] };
    }

    const knownGroups = new Map(ruleGroups.map((group) => [group.id, group]));
    const seenIDs = new Set<string>();
    const knownOutbounds = new Map<string, string>();

    for (const opt of getAllOutboundOptions()) {
      knownOutbounds.set(opt.value.toLowerCase(), opt.value);
    }
    for (const group of ruleGroups) {
      knownOutbounds.set(group.outbound.toLowerCase(), group.outbound);
    }
    for (const aliasTarget of Object.values(outboundAliases)) {
      knownOutbounds.set(aliasTarget.toLowerCase(), aliasTarget);
    }

    const parseBooleanValue = (value: unknown): boolean | null => {
      if (typeof value === 'boolean') return value;
      if (typeof value !== 'string') return null;
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
        return false;
      }
      return null;
    };

    const parseStringList = (value: unknown): string[] | null => {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) return null;
      const values: string[] = [];
      for (const item of value) {
        if (typeof item !== 'string') return null;
        const trimmed = item.trim();
        if (!trimmed) continue;
        values.push(trimmed);
      }
      return values;
    };

    const groups: RuleGroup[] = [];
    const errors: string[] = [];

    parsedData.forEach((item, index) => {
      const itemNumber = index + 1;
      const itemErrors: string[] = [];

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`Item ${itemNumber}: expected object`);
        return;
      }

      const raw = item as Record<string, unknown>;
      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!id) {
        itemErrors.push(`Item ${itemNumber}: id must be a non-empty string`);
      } else if (!knownGroups.has(id)) {
        itemErrors.push(`Item ${itemNumber}: unknown id "${id}"`);
      } else if (seenIDs.has(id)) {
        itemErrors.push(`Item ${itemNumber}: duplicate id "${id}"`);
      } else {
        seenIDs.add(id);
      }

      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) {
        itemErrors.push(`Item ${itemNumber}: name must be a non-empty string`);
      }

      const enabled = parseBooleanValue(raw.enabled);
      if (enabled === null) {
        itemErrors.push(`Item ${itemNumber}: enabled must be boolean`);
      }

      const outboundRaw = typeof raw.outbound === 'string' ? raw.outbound.trim() : '';
      const outbound = normalizeOutboundToken(outboundRaw, knownOutbounds);
      if (!outbound) {
        itemErrors.push(`Item ${itemNumber}: unknown outbound "${outboundRaw}"`);
      }

      const siteRules = parseStringList(raw.site_rules);
      if (!siteRules) {
        itemErrors.push(`Item ${itemNumber}: site_rules must be an array of strings`);
      }

      const ipRules = parseStringList(raw.ip_rules);
      if (!ipRules) {
        itemErrors.push(`Item ${itemNumber}: ip_rules must be an array of strings`);
      }

      if (siteRules && ipRules && siteRules.length === 0 && ipRules.length === 0) {
        itemErrors.push(`Item ${itemNumber}: at least one of site_rules or ip_rules is required`);
      }

      if (itemErrors.length > 0) {
        errors.push(...itemErrors);
        return;
      }

      groups.push({
        id,
        name,
        enabled: Boolean(enabled),
        outbound,
        site_rules: siteRules || [],
        ip_rules: ipRules || [],
      });
    });

    return { groups, errors };
  };

  const handleReloadPresetRuleGroupsText = () => {
    setPresetRuleGroupsText(buildPresetRuleGroupsText());
    setPresetRuleGroupsDirty(false);
    setPresetRuleGroupsErrors([]);
  };

  const handleApplyPresetRuleGroupsText = async () => {
    const parsed = parsePresetRuleGroupsText();
    if (parsed.errors.length > 0) {
      setPresetRuleGroupsErrors(parsed.errors.slice(0, 8));
      toast.error(`Text parse failed: ${parsed.errors[0]}`);
      return;
    }

    if (parsed.groups.length === 0) {
      toast.error('Nothing to apply: no valid rule groups found');
      return;
    }

    if (!confirm(`Apply ${parsed.groups.length} preset rule group(s) from text mode?`)) {
      return;
    }

    setIsApplyingPresetRuleGroupsText(true);
    setPresetRuleGroupsErrors([]);
    try {
      for (const group of parsed.groups) {
        await ruleGroupApi.update(group.id, group);
      }
      await fetchRuleGroups();
      toast.success(`Applied ${parsed.groups.length} preset rule group(s)`);
      setPresetRuleGroupsDirty(false);
    } catch (error: any) {
      console.error('Failed to apply text rule groups:', error);
      toast.error(error.response?.data?.error || 'Failed to apply text rule groups');
    } finally {
      setIsApplyingPresetRuleGroupsText(false);
    }
  };

  useEffect(() => {
    if (presetRuleGroupsDirty) return;
    setPresetRuleGroupsText(buildPresetRuleGroupsText());
  }, [buildPresetRuleGroupsText, presetRuleGroupsDirty]);

  const handleToggle = async (id: string, enabled: boolean) => {
    await toggleRuleGroup(id, enabled);
  };

  const handleOutboundChange = async (group: RuleGroup, outbound: string) => {
    await updateRuleGroupOutbound(group.id, outbound);
  };

  // Rule group edit handlers
  const handleEditRuleGroup = (group: RuleGroup) => {
    setEditingRuleGroup(group);
    setRgName(group.name);
    setRgSiteRulesText((group.site_rules || []).join('\n'));
    setRgIpRulesText((group.ip_rules || []).join('\n'));
    setRgSiteValidation({});
    setRgIpValidation({});
    onRuleGroupModalOpen();
  };

  const handleRuleGroupSubmit = async () => {
    if (!editingRuleGroup) return;

    const siteRules = rgSiteRulesText.split('\n').map((v) => v.trim()).filter((v) => v);
    const ipRules = rgIpRulesText.split('\n').map((v) => v.trim()).filter((v) => v);

    await updateRuleGroup(editingRuleGroup.id, {
      name: rgName,
      site_rules: siteRules,
      ip_rules: ipRules,
    });

    onRuleGroupModalClose();
  };

  const handleResetRuleGroup = async (id: string) => {
    await resetRuleGroup(id);
  };

  // Custom rule handlers
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

  // Render validation results inline
  const renderValidationList = (
    text: string,
    results: Record<string, ValidationResult>,
    validating: boolean,
  ) => {
    const names = text.split('\n').map((v) => v.trim()).filter((v) => v);
    if (names.length === 0) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <span>Rule Set Validation Results</span>
          {validating && <Spinner size="sm" />}
        </div>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {names.map((name) => {
            const result = results[name];
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
                {result.valid ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                <span className="font-medium">{name}</span>
                <span className="text-xs opacity-75">- {result.message}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Rule Management</h1>
      </div>

      {/* Proxy Mode */}
      <Card>
        <CardBody className="gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Proxy Mode</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Режим маршрутизации трафика. Rule — по правилам, Global — весь через прокси, Direct — весь напрямую.
                {!proxyModeRunning && (
                  <span className="ml-1 text-warning-500">Сервис остановлен — режим применится при запуске.</span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              {(['rule', 'global', 'direct'] as ProxyMode[]).map((mode) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={proxyMode === mode ? 'solid' : 'bordered'}
                  color={proxyMode === mode ? 'primary' : 'default'}
                  isDisabled={proxyModeSwitching}
                  isLoading={proxyModeSwitching && proxyMode !== mode}
                  onPress={() => {
                    if (proxyMode !== mode) setProxyMode(mode);
                  }}
                  className="capitalize"
                >
                  {mode}
                </Button>
              ))}
            </div>
          </div>
          {proxyMode !== 'rule' && (
            <div className="flex items-center gap-2 p-2 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 rounded-lg text-warning-700 dark:text-warning-400 text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                {proxyMode === 'global'
                  ? 'Режим Global — весь трафик идёт через прокси. Правила маршрутизации не применяются.'
                  : 'Режим Direct — весь трафик идёт напрямую. Правила маршрутизации не применяются.'}
              </span>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Preset Rule Groups */}
      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <h2 className="text-lg font-semibold">Preset Rule Groups</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Предустановленные группы правил маршрутизации по сервисам. Каждая группа содержит GeoSite/GeoIP rule set и направляет трафик на выбранный outbound. Нажмите на карандаш, чтобы изменить правила группы. Изменённые группы помечаются меткой «modified» — их можно сбросить до стандартных.
          </p>
        </CardHeader>
        <CardBody>
          <Tabs
            aria-label="Preset rule group editor view"
            selectedKey={presetRuleGroupsView}
            onSelectionChange={(key) => setPresetRuleGroupsView(String(key) as 'visual' | 'text')}
          >
            <Tab key="visual" title="Visual">
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {ruleGroups.map((group) => {
                  const modified = isRuleGroupModified(group, defaultRuleGroups);
                  return (
                    <div
                      key={group.id}
                      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="p-2 bg-white dark:bg-gray-700 rounded-lg shrink-0">
                          {iconMap[group.id] || <Globe className="w-5 h-5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="font-medium truncate">{group.name}</h3>
                            {modified && (
                              <Chip size="sm" variant="dot" color="warning" className="shrink-0">
                                modified
                              </Chip>
                            )}
                          </div>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {(group.site_rules || []).slice(0, 2).map((rule) => (
                              <Chip key={`site-${rule}`} size="sm" variant="flat">
                                {rule}
                              </Chip>
                            ))}
                            {(group.ip_rules || []).slice(0, 1).map((rule) => (
                              <Chip key={`ip-${rule}`} size="sm" variant="flat" color="secondary">
                                ip:{rule}
                              </Chip>
                            ))}
                            {((group.site_rules || []).length + (group.ip_rules || []).length > 3) && (
                              <Chip size="sm" variant="flat">
                                +{(group.site_rules || []).length + (group.ip_rules || []).length - 3}
                              </Chip>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                        {modified && (
                          <Tooltip content="Reset to default">
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              color="warning"
                              onPress={() => handleResetRuleGroup(group.id)}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip content="Edit rule group">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            onPress={() => handleEditRuleGroup(group)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </Tooltip>
                        <Select
                          size="sm"
                          className="w-28 sm:w-32"
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
                  );
                })}
              </div>
            </Tab>
            <Tab key="text" title="Text (JSON)">
              <div className="space-y-3 mt-4">
                <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                  Формат: JSON-массив объектов с полями <code>id</code>, <code>name</code>, <code>enabled</code>, <code>outbound</code>, <code>site_rules</code>, <code>ip_rules</code>.
                  <br />
                  <code>id</code> должен совпадать с существующей группой, <code>site_rules</code>/<code>ip_rules</code> — массивы строк.
                </div>
                <Textarea
                  aria-label="Preset rule groups text editor"
                  value={presetRuleGroupsText}
                  onChange={(e) => {
                    setPresetRuleGroupsText(e.target.value);
                    setPresetRuleGroupsDirty(true);
                  }}
                  minRows={16}
                  classNames={{ input: 'font-mono text-sm' }}
                />
                {presetRuleGroupsErrors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm space-y-1">
                    {presetRuleGroupsErrors.map((err) => (
                      <div key={err}>{err}</div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="flat" onPress={handleReloadPresetRuleGroupsText}>
                    Reload from current groups
                  </Button>
                  <Button
                    color="primary"
                    onPress={handleApplyPresetRuleGroupsText}
                    isLoading={isApplyingPresetRuleGroupsText}
                    isDisabled={!presetRuleGroupsText.trim()}
                  >
                    Apply text
                  </Button>
                </div>
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>

      {/* Custom Rules */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start gap-3">
          <div className="flex-col gap-1">
            <h2 className="text-lg font-semibold">Custom Rules</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Собственные правила маршрутизации. Поддерживаются domain suffix, keyword, full domain, IP CIDR, GeoSite/GeoIP rule set и порты. Правила с меньшим приоритетом (числом) обрабатываются первыми.
            </p>
          </div>
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
          <Tabs
            aria-label="Custom rule editor view"
            selectedKey={customRulesView}
            onSelectionChange={(key) => setCustomRulesView(String(key) as 'visual' | 'text')}
          >
            <Tab key="visual" title="Visual">
              <div className="mt-4">
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
                          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
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
                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
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
              </div>
            </Tab>
            <Tab key="text" title="Text (Switchy-like)">
              <div className="space-y-3 mt-4">
                <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                  Формат строки: <code>&lt;pattern&gt; +&lt;outbound&gt;</code>. Поддерживаются: <code>*.domain.com</code>,
                  <code>domain.com</code>, <code>keyword:</code>, <code>ip:</code>, <code>geosite:</code>, <code>geoip:</code>,
                  <code>port:</code>. Строка <code>* +direct</code> меняет fallback (final outbound). Префикс <code>!</code> делает правило выключенным.
                </div>
                <Textarea
                  aria-label="Switchy text editor"
                  value={switchyText}
                  onChange={(e) => {
                    setSwitchyText(e.target.value);
                    setSwitchyDirty(true);
                  }}
                  minRows={16}
                  classNames={{ input: 'font-mono text-sm' }}
                />
                {switchyErrors.length > 0 && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm space-y-1">
                    {switchyErrors.map((err) => (
                      <div key={err}>{err}</div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="flat" onPress={handleReloadSwitchyText}>
                    Reload from current rules
                  </Button>
                  <Button
                    color="primary"
                    onPress={handleApplySwitchyText}
                    isLoading={isApplyingSwitchyText}
                    isDisabled={!switchyText.trim()}
                  >
                    Apply text
                  </Button>
                </div>
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>

      {/* Add/Edit Custom Rule Modal */}
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
              {(formData.rule_type === 'geosite' || formData.rule_type === 'geoip') && valuesText.trim() &&
                renderValidationList(valuesText, validationResults, isValidating)}

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

      {/* Edit Rule Group Modal */}
      <Modal isOpen={isRuleGroupModalOpen} onClose={onRuleGroupModalClose} size="lg">
        <ModalContent>
          <ModalHeader>Edit Rule Group</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                Укажите название группы и списки GeoSite/GeoIP rule set (по одному на строку). Они определяют, какой трафик попадёт в эту группу. Outbound и статус вкл/выкл задаются на основной странице.
              </div>
              <Input
                label="Group Name"
                placeholder="e.g.: Google"
                value={rgName}
                onChange={(e) => setRgName(e.target.value)}
              />

              <Textarea
                label="GeoSite Rules"
                placeholder="One geosite rule set name per line, e.g.:\ngoogle\nyoutube"
                value={rgSiteRulesText}
                onChange={(e) => setRgSiteRulesText(e.target.value)}
                minRows={3}
              />

              {rgSiteRulesText.trim() && renderValidationList(rgSiteRulesText, rgSiteValidation, rgSiteValidating)}

              <Textarea
                label="GeoIP Rules"
                placeholder="One geoip rule set name per line, e.g.:\ngoogle\ncn"
                value={rgIpRulesText}
                onChange={(e) => setRgIpRulesText(e.target.value)}
                minRows={2}
              />

              {rgIpRulesText.trim() && renderValidationList(rgIpRulesText, rgIpValidation, rgIpValidating)}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onRuleGroupModalClose}>
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={handleRuleGroupSubmit}
              isDisabled={!rgName || rgSiteValidating || rgIpValidating || !rgValidationsPassed()}
            >
              Save
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
