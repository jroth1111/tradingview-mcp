export interface StudyInputMeta {
  id: string;
  type?: string;
  defval?: unknown;
  isHidden?: boolean;
}

export interface BuildStudyInputsOptions {
  inputMeta: StudyInputMeta[];
  overrides?: Record<string, unknown>;
  ilScript?: string;
  pineId?: string;
  pineVersion?: string;
  pineFeatures?: string;
}

const RAW_INPUT_IDS = new Set(["text", "pineId", "pineVersion"]);

function isWrappedInput(value: unknown): value is { v: unknown; f?: boolean; t?: string } {
  return !!value && typeof value === "object" && "v" in value && "t" in value;
}

export function buildStudyInputs(options: BuildStudyInputsOptions): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  const overrides = options.overrides ?? {};
  const seen = new Set<string>();

  for (const meta of options.inputMeta) {
    if (!meta?.id) continue;
    const overrideValue = overrides[meta.id];
    const value = overrideValue !== undefined ? overrideValue : meta.defval;

    if (RAW_INPUT_IDS.has(meta.id)) {
      if (meta.id === "text") {
        inputs.text = options.ilScript ?? value ?? "";
      } else if (meta.id === "pineId") {
        inputs.pineId = overrideValue ?? options.pineId ?? value ?? "";
      } else if (meta.id === "pineVersion") {
        inputs.pineVersion = overrideValue ?? options.pineVersion ?? value ?? "";
      }
      seen.add(meta.id);
      continue;
    }

    if (meta.id === "pineFeatures") {
      const pineFeaturesValue = overrideValue ?? options.pineFeatures ?? value;
      if (isWrappedInput(pineFeaturesValue)) {
        inputs.pineFeatures = pineFeaturesValue;
      } else if (!isWrappedInput(pineFeaturesValue) && pineFeaturesValue !== undefined) {
        inputs.pineFeatures = {
          v: pineFeaturesValue,
          f: true,
          t: meta.type ?? "text",
        };
      }
      seen.add(meta.id);
      continue;
    }

    if (isWrappedInput(value)) {
      inputs[meta.id] = value;
    } else {
      inputs[meta.id] = { v: value, f: true, t: meta.type ?? "text" };
    }
    seen.add(meta.id);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (!seen.has(key)) {
      inputs[key] = value;
    }
  }

  return inputs;
}
