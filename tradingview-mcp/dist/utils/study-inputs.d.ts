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
export declare function buildStudyInputs(options: BuildStudyInputsOptions): Record<string, unknown>;
//# sourceMappingURL=study-inputs.d.ts.map