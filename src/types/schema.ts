type ActionValueSchemaMetadata = {
  metadata?: Record<string, any>;
  description?: string;
  required?: boolean;
  defaultValue?: any;
  validate?: () => null | string;
};

export type ActionValueSchemaBoolean = {
  type: 'boolean';
} & ActionValueSchemaMetadata;

export type ActionValueSchemaDuration = {
  type: 'duration';
} & ActionValueSchemaMetadata;

export type ActionValueSchemaInt = {
  type: 'int';
} & ActionValueSchemaMetadata;

export type ActionValueSchemaReal = {
  type: 'real';
} & ActionValueSchemaMetadata;

export type ActionValueSchemaSequence = {
  type: 'sequence';
  primary?: boolean;
  /** Whether the parameter represents a file and its revision or just a file path. */
  withRevision?: boolean;
  /** With `withRevision`, whether the working copy may be chosen (default `true`) or every file needs a named revision. */
  allowWorkingCopy?: boolean;
} & ActionValueSchemaMetadata;

export type ActionValueSchemaSequenceList = {
  type: 'sequenceList';
  primary?: boolean;
  /** Whether the parameter represents a file and its revision or just a file path. */
  withRevision?: boolean;
  /** With `withRevision`, whether the working copy may be chosen (default `true`) or every file needs a named revision. */
  allowWorkingCopy?: boolean;
} & ActionValueSchemaMetadata;

export type ActionValueSchemaFile = {
  type: 'file';
  pattern?: string;
  primary?: boolean;
  /** Whether the parameter represents a file and its revision or just a file path. */
  withRevision?: boolean;
  /** With `withRevision`, whether the working copy may be chosen (default `true`) or every file needs a named revision. */
  allowWorkingCopy?: boolean;
} & ActionValueSchemaMetadata;

export type ActionValueSchemaFileList = {
  type: 'fileList';
  pattern?: string;
  primary?: boolean;
  /** Whether the parameter represents a file and its revision or just a file path. */
  withRevision?: boolean;
  /** With `withRevision`, whether the working copy may be chosen (default `true`) or every file needs a named revision. */
  allowWorkingCopy?: boolean;
} & ActionValueSchemaMetadata;

/**
 * A file chosen for a `file`/`sequence` (or list) parameter that sets `withRevision: true`. `path` is relative to the workspace root.
 * - No `revision` is the working copy: the file's latest saved contents at the time the action reads it. It is not a
 *   snapshot; re-running reads whatever is saved then.
 * - A revision name (e.g. `'b'`) is that revision's immutable contents, as the file at `path` has it.
 * - `'latest'` is whichever revision is newest at the moment the action reads the file. It fails if the file has none.
 *
 * Pass either form straight to `ActionsAPI.readFile`.
 */
export type FileRef = { path: string; revision?: string };

export type ActionValueSchemaSecret = {
  type: 'secret';
} & ActionValueSchemaMetadata;

export type ActionValueSchemaSeries = {
  items: ActionValueSchema;
  type: 'series';
} & ActionValueSchemaMetadata;

export type ActionValueSchemaString = {
  type: 'string';
} & ActionValueSchemaMetadata;

export type ActionValueSchemaStruct = {
  items: Record<string, ActionValueSchema>;
  type: 'struct';
} & ActionValueSchemaMetadata;

export type Variant = {
  key: any;
  label: string;
};

export type ActionValueSchemaVariant = {
  type: 'variant';
  variants: Variant[];
} & ActionValueSchemaMetadata;

export type ActionValueSchema =
  | ActionValueSchemaBoolean
  | ActionValueSchemaDuration
  | ActionValueSchemaFile
  | ActionValueSchemaFileList
  | ActionValueSchemaInt
  | ActionValueSchemaReal
  | ActionValueSchemaSequence
  | ActionValueSchemaSequenceList
  | ActionValueSchemaSecret
  | ActionValueSchemaSeries
  | ActionValueSchemaString
  | ActionValueSchemaStruct
  | ActionValueSchemaVariant;

export type ActionParameterDefinitions = Record<string, ActionValueSchema>;
export type ActionSettingDefinitions = Record<string, ActionValueSchema>;

// type util which, given a ParameterDefinition of a *variant* type parameter,
// extracts all the valid variant `key` values and makes a union of them
// (for the type of value passed into the action main function)
type VariantKeyUnion<T extends { variants: readonly { key: unknown }[] }> = T['variants'][number]['key'];

// the types of the values that will be passed in for file/fileList/sequence/sequenceList type parameters
// if withRevision is not set, the value is just the file's path (string)
// if withRevision is true, it is a FileRef: an object with 'path' and, unless it is the working copy, 'revision'
// if allowWorkingCopy is false, 'revision' is always present (a revision must be chosen for every file)
type FileInputValueType<T extends ActionValueSchemaFile | ActionValueSchemaSequence> = T extends {
  withRevision: true;
  allowWorkingCopy: false;
}
  ? Required<FileRef>
  : T extends { withRevision: true }
    ? FileRef
    : string;

type FileListInputValueType<T extends ActionValueSchemaFileList | ActionValueSchemaSequenceList> = T extends {
  withRevision: true;
  allowWorkingCopy: false;
}
  ? Required<FileRef>[]
  : T extends { withRevision: true }
    ? FileRef[]
    : string[];

// InferSchemaType is a type that resolves to the underlying value type,
// given an ActionValueSchema as a generic
// eg. InferSchemaType<ActionValueSchemaString> => string
type InferSchemaType<T extends ActionValueSchema> = T extends ActionValueSchemaBoolean
  ? boolean
  : T extends ActionValueSchemaString
    ? string
    : T extends ActionValueSchemaDuration
      ? string // ???
      : T extends ActionValueSchemaInt
        ? number
        : T extends ActionValueSchemaReal
          ? number // do we need this ???
          : T extends ActionValueSchemaFile | ActionValueSchemaSequence
            ? FileInputValueType<T>
            : T extends ActionValueSchemaFileList | ActionValueSchemaSequenceList
              ? FileListInputValueType<T>
              : T extends ActionValueSchemaSeries
                ? any[] // how to type???
                : T extends ActionValueSchemaStruct
                  ? object
                  : T extends ActionValueSchemaVariant
                    ? VariantKeyUnion<T>
                    : never;

// the type of the user's parameters/settings object
export type ActionParameters<T extends ActionParameterDefinitions> = {
  [K in keyof T]: InferSchemaType<T[K]>;
};
export type ActionSettings<T extends ActionParameterDefinitions> = ActionParameters<T>;

export type ActionParameterDefinition = {
  name: string;
  schema: ActionValueSchema;
};
