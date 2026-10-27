import type { FileMetadata } from './db-types';

/** A saved revision. Names are assigned by the server and scoped to a file's history. */
export type FileRevision = {
  name: string;
  fileId: string;
  pathAtRevision: string;
  message: string;
  createdBy: string;
  createdAt: string;
  lastEditedBy: string | null;
  lastEditedAt: string | null;
};

export type FileRevisionList = {
  /** Newest first, in the order supplied by the server. */
  revisions: FileRevision[];
  /** Newest revision matching the saved content and metadata, or null if none matches. */
  matchingRevision: string | null;
};

export type FileRevisionMetadata = {
  versionMetadata: FileRevision;
  fileMetadata: FileMetadata;
};

export type FileReadResult = {
  content: string;
  /** The exact response header, including quotes; null if the server omitted it. */
  etag: string | null;
};

export type FileWriteResult = {
  success: true;
  /** The exact response header, including quotes; null if the server omitted it. */
  etag: string | null;
};

export type RevisionWriteOptions = {
  /** Optional current-file ETag. Omit or pass '*' to operate on the current saved state without a version check. */
  ifMatch?: string;
};

export type CreateFileRevisionOptions = RevisionWriteOptions & {
  message?: string;
};

export type CreateFileRevisionResult = {
  name: string;
};
