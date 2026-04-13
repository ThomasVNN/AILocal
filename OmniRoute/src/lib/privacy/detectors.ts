import type { CompiledPrivacyBundle, CompiledPrivacyRule } from "./bundle";
import type {
  PrivacyEntityType,
  PrivacyLevel,
  PrivacyPolicyProfile,
  PrivacyTransformMode,
} from "./types";

export interface DetectedPrivacyEntity {
  text: string;
  start: number;
  end: number;
  entityType: PrivacyEntityType;
  rule: CompiledPrivacyRule;
  level: PrivacyLevel;
  transformMode: PrivacyTransformMode;
}

const LEVEL_ORDER: Record<PrivacyLevel, number> = {
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

function getResolvedLevel(entityType: PrivacyEntityType, profile: PrivacyPolicyProfile) {
  return profile.levelOverrides[entityType.id] || entityType.defaultLevel;
}

function getResolvedTransform(entityType: PrivacyEntityType, profile: PrivacyPolicyProfile) {
  return profile.transformOverrides[entityType.id] || entityType.defaultTransform;
}

function compareDetections(a: DetectedPrivacyEntity, b: DetectedPrivacyEntity) {
  if (a.start !== b.start) {
    return a.start - b.start;
  }

  const levelDiff = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
  if (levelDiff !== 0) {
    return levelDiff;
  }

  if (a.rule.priority !== b.rule.priority) {
    return b.rule.priority - a.rule.priority;
  }

  return b.text.length - a.text.length;
}

function selectNonOverlappingDetections(detections: DetectedPrivacyEntity[]) {
  const sorted = [...detections].sort(compareDetections);
  const selected: DetectedPrivacyEntity[] = [];

  for (const detection of sorted) {
    const last = selected[selected.length - 1];
    if (!last || detection.start >= last.end) {
      selected.push(detection);
      continue;
    }

    const currentWins =
      LEVEL_ORDER[detection.level] < LEVEL_ORDER[last.level] ||
      (LEVEL_ORDER[detection.level] === LEVEL_ORDER[last.level] &&
        detection.rule.priority > last.rule.priority);

    if (currentWins) {
      selected[selected.length - 1] = detection;
    }
  }

  return selected.sort((a, b) => a.start - b.start);
}

export function resolvePrivacyProfile(bundle: CompiledPrivacyBundle, sourceApp: string) {
  if (bundle.profiles.length === 0) {
    return null;
  }

  const matched = bundle.profiles.find((profile) => {
    const sourceApps = profile.appliesTo.sourceApps || [];
    return sourceApps.length === 0 || sourceApps.includes(sourceApp);
  });

  return matched || bundle.profiles[0] || null;
}

export function detectSensitiveEntities(
  text: string,
  bundle: CompiledPrivacyBundle,
  profile: PrivacyPolicyProfile
) {
  const detections: DetectedPrivacyEntity[] = [];

  for (const rule of bundle.compiledRules) {
    const entityType = bundle.entityTypesById.get(rule.entityTypeId);
    if (!entityType || !entityType.enabled) {
      continue;
    }

    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = rule.regex.exec(text))) {
      const value = match[0];
      if (!value) {
        break;
      }

      detections.push({
        text: value,
        start: match.index,
        end: match.index + value.length,
        entityType,
        rule,
        level: getResolvedLevel(entityType, profile),
        transformMode: getResolvedTransform(entityType, profile),
      });

      if (rule.regex.lastIndex === match.index) {
        rule.regex.lastIndex += 1;
      }
    }
  }

  return selectNonOverlappingDetections(detections);
}
