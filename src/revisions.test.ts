import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  ActionsAPI,
  type ActionsConfig,
  type ActionParameterDefinitions,
  type ActionParameters,
  type CreateFileRevisionOptions,
  type FileRef,
  type FileRevision,
  type RevisionWriteOptions, defineParameters,
} from './index';

const etag = '"current-content-hash"';
const savedEtag = '"saved-content-hash"';
const revision: FileRevision = {
  name: 'aa',
  pathAtRevision: 'old/location.seq',
  message: 'validated',
  createdBy: 'alice',
  createdAt: '2026-10-26T18:00:00Z',
  lastEditedBy: null,
  lastEditedAt: null,
};

function makeApi() {
  const config: ActionsConfig = {
    ACTION_FILE_STORE: '/actions',
    SEQUENCING_FILE_STORE: '/sequences',
    WORKSPACE_BASE_URL: 'http://workspace.local',
    SECRETS: { authorization: 'Bearer test-token' },
    USER_ROLE: 'test-role',
  };
  return new ActionsAPI({} as PoolClient, 42, config);
}

describe('workspace revisions and concurrency tokens', () => {
  let api: ActionsAPI;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    api = makeApi();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  test('reads empty current content and preserves the exact quoted ETag', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { headers: { ETag: etag } }));
    await expect(api.readFileWithEtag('folder/a #?.seq')).resolves.toEqual({ content: '', etag });
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspace.local/ws/42/folder%2Fa%20%23%3F.seq');
  });

  test('reports an absent ETag as null without substituting a force token', async () => {
    fetchMock.mockResolvedValueOnce(new Response('contents'));
    await expect(api.readFileWithEtag('a.seq')).resolves.toEqual({ content: 'contents', etag: null });
  });

  test('existing writes retain their exact result, authentication, and multipart boundary handling', async () => {
    fetchMock.mockResolvedValueOnce(new Response('saved', { headers: { ETag: savedEtag } }));
    await expect(api.writeFile('folder/a.seq', 'new content', true)).resolves.toStrictEqual({ success: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/ws/42/folder%2Fa.seq?type=file&overwrite=true');
    expect(options.headers).toEqual({
      authorization: 'Bearer test-token',
      'x-hasura-role': 'test-role',
    });
    const file = (options.body as FormData).get('file') as File;
    expect(file.name).toBe('a.seq');
    expect(await file.text()).toBe('new content');
  });

  test('existing three-argument writes remain unconditional and succeed without an ETag', async () => {
    fetchMock.mockResolvedValueOnce(new Response('saved'));
    await expect(api.writeFile('a.seq', 'content', true)).resolves.toStrictEqual({ success: true });
    expect(fetchMock.mock.calls[0][1].headers['If-Match']).toBeUndefined();
  });

  test('lists parsed revisions without dropping matchingRevision or historical paths', async () => {
    const listing = { revisions: [revision], matchingRevision: 'aa' };
    fetchMock.mockResolvedValueOnce(Response.json(listing));
    await expect(api.listFileRevisions('new/location.seq')).resolves.toEqual(listing);
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspace.local/versioning/42/new%2Flocation.seq');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  test.each([[] as FileRevision[], [revision]])(
    'preserves a null match independently of the revision list (%j)',
    async revisions => {
      const listing = { revisions, matchingRevision: null };
      fetchMock.mockResolvedValueOnce(Response.json(listing));
      await expect(api.listFileRevisions('a.seq')).resolves.toEqual(listing);
    },
  );

  test('historical content may be empty and the path and revision are encoded separately', async () => {
    fetchMock.mockResolvedValueOnce(new Response(''));
    await expect(api.readFileAtRevision('folder/a #?.seq', 'a&revision=b')).resolves.toBe('');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/versioning/42/folder%2Fa%20%23%3F.seq?revision=a%26revision%3Db');
    expect(options.method).toBe('GET');
    expect(options.headers['If-Match']).toBeUndefined();
  });

  test('historical metadata returns both revision metadata and optional file fields', async () => {
    const metadata = { versionMetadata: revision, fileMetadata: { user: { reviewed: true } } };
    fetchMock.mockResolvedValueOnce(Response.json(metadata));
    await expect(api.getFileRevisionMetadata('new/location.seq', 'aa')).resolves.toEqual(metadata);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://workspace.local/versioning/metadata/42/new%2Flocation.seq?revision=aa',
    );
  });

  test('creates a revision with the supplied message and precondition and returns the server-assigned name', async () => {
    fetchMock.mockResolvedValueOnce(new Response('aa'));
    await expect(
      api.createFileRevision('folder/a.seq', { ifMatch: etag, message: 'passed\nvalidation' }),
    ).resolves.toEqual({
      name: 'aa',
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/versioning/42/folder%2Fa.seq');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      'If-Match': etag,
      authorization: 'Bearer test-token',
      'x-hasura-role': 'test-role',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(options.body)).toEqual({ message: 'passed\nvalidation' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test('an explicit wildcard is forwarded and an omitted message defaults to empty', async () => {
    fetchMock.mockResolvedValueOnce(new Response('a'));
    await api.createFileRevision('a.seq', { ifMatch: '*' });
    const options = fetchMock.mock.calls[0][1];
    expect(options.headers['If-Match']).toBe('*');
    expect(JSON.parse(options.body)).toEqual({ message: '' });
  });

  test('creates a revision without any options', async () => {
    fetchMock.mockResolvedValueOnce(new Response('a'));
    await expect(api.createFileRevision('a.seq')).resolves.toEqual({ name: 'a' });
    const options = fetchMock.mock.calls[0][1];
    expect(options.headers['If-Match']).toBe('*');
    expect(JSON.parse(options.body)).toEqual({ message: '' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test.each([{}, { message: 'generated output' }, { ifMatch: undefined }])(
    'creates a revision when options omit the concurrency token (%j)',
    async options => {
      fetchMock.mockResolvedValueOnce(new Response('a'));
      await api.createFileRevision('a.seq', options);
      const request = fetchMock.mock.calls[0][1];
      expect(request.headers['If-Match']).toBe('*');
      expect(JSON.parse(request.body)).toEqual({ message: 'message' in options ? options.message : '' });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  test('restores a revision without any options', async () => {
    fetchMock.mockResolvedValueOnce(new Response('restored', { headers: { ETag: savedEtag } }));
    await expect(api.restoreFileRevision('a.seq', 'b')).resolves.toEqual({ success: true, etag: savedEtag });
    expect(fetchMock.mock.calls[0][1].headers['If-Match']).toBe('*');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test.each([{}, { ifMatch: undefined }])('restores when options omit the concurrency token (%j)', async options => {
    fetchMock.mockResolvedValueOnce(new Response('restored'));
    await api.restoreFileRevision('a.seq', 'b', options);
    expect(fetchMock.mock.calls[0][1].headers['If-Match']).toBe('*');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test.each([{ ifMatch: null }, { ifMatch: '' }, { ifMatch: '  ' }])(
    'rejects explicitly invalid revision preconditions before sending a request (%j)',
    async options => {
      await expect(api.createFileRevision('a.seq', options as CreateFileRevisionOptions)).rejects.toThrow(TypeError);
      await expect(api.restoreFileRevision('a.seq', 'a', options as RevisionWriteOptions)).rejects.toThrow(TypeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test.each([etag, '*'])('restores directly through the backend endpoint with If-Match %s', async ifMatch => {
    fetchMock.mockResolvedValueOnce(new Response('restored', { headers: { ETag: savedEtag } }));
    await expect(api.restoreFileRevision('folder/a.seq', 'a&x=1', { ifMatch })).resolves.toEqual({
      success: true,
      etag: savedEtag,
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workspace.local/versioning/restore/42/folder%2Fa.seq?revision=a%26x%3D1');
    expect(options.method).toBe('POST');
    expect(options.headers['If-Match']).toBe(ifMatch);
    expect(options.body).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test('a successful restore without an ETag is still successful', async () => {
    fetchMock.mockResolvedValueOnce(new Response('restored'));
    await expect(api.restoreFileRevision('a.seq', 'a', { ifMatch: etag })).resolves.toEqual({
      success: true,
      etag: null,
    });
  });

  test('supports validate-then-revise using the token read from the working file', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('validated content', { headers: { ETag: etag } }))
      .mockResolvedValueOnce(new Response('b'));
    const read = await api.readFileWithEtag('a.seq');
    expect(read.content).toBe('validated content');
    if (read.etag === null) throw new Error('missing ETag');
    await expect(api.createFileRevision('a.seq', { ifMatch: read.etag })).resolves.toEqual({ name: 'b' });
    expect(fetchMock.mock.calls[1][1].headers['If-Match']).toBe(etag);
  });

  test('supports ordinary write-then-revise without involving concurrency tokens', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('saved', { headers: { ETag: savedEtag } }))
      .mockResolvedValueOnce(new Response('a'));
    const written = await api.writeFile('a.seq', 'generated content');
    expect(written).toStrictEqual({ success: true });
    await api.createFileRevision('a.seq', { message: 'generated' });
    expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['PUT', 'POST']);
    expect(fetchMock.mock.calls[1][1].headers['If-Match']).toBe('*');
  });

  test('a conflict after validation is surfaced without rereading or forcing the revision', async () => {
    const conflict = { type: 'FILE_SAVE_CONFLICT', message: 'changed', currentETag: '"other"' };
    fetchMock
      .mockResolvedValueOnce(new Response('validated content', { headers: { ETag: etag } }))
      .mockResolvedValueOnce(Response.json(conflict, { status: 412 }));
    const read = await api.readFileWithEtag('a.seq');
    if (read.etag === null) throw new Error('missing ETag');
    await expect(api.createFileRevision('a.seq', { ifMatch: read.etag })).rejects.toThrow(
      `412 - ${JSON.stringify(conflict)}`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers['If-Match']).toBe(etag);
  });

  test.each([400, 403, 404, 412, 423, 500])(
    'keeps plain Error objects and the existing message format for status %s without retrying',
    async status => {
      const body = { type: 'TEST_ERROR', message: 'details', context: { file: 'a.seq' } };
      const text = JSON.stringify(body);
      fetchMock.mockResolvedValueOnce(new Response(text, { status }));
      const error = await api.restoreFileRevision('a.seq', 'a', { ifMatch: etag }).catch(error => error);
      expect(error.constructor).toBe(Error);
      expect(error.name).toBe('Error');
      expect(error.message).toBe(`${status} - ${text}`);
      expect(String(error)).toBe(`Error: ${status} - ${text}`);
      expect(JSON.stringify(error)).toBe('{}');
      expect(Object.keys(error)).toEqual([]);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  test('preserves non-JSON error bodies and the existing error-message format', async () => {
    fetchMock.mockResolvedValueOnce(new Response('upstream unavailable', { status: 502 }));
    await expect(api.listFileRevisions('a.seq')).rejects.toThrow('502 - upstream unavailable');
  });

  test.each(['readFile', 'listFiles', 'writeFile', 'getFileMetadata'] as const)(
    'retains the original error shape for existing %s callers',
    async method => {
      const text = '{"type":"TEST_ERROR","message":"details"}';
      fetchMock.mockResolvedValueOnce(new Response(text, { status: 404 }));
      const request = method === 'writeFile' ? api.writeFile('a.seq', 'contents') : api[method]('a.seq');
      const error = await request.catch(error => error);
      expect(error.constructor).toBe(Error);
      expect(error.name).toBe('Error');
      expect(error.message).toBe(`404 - ${text}`);
      expect(String(error)).toBe(`Error: 404 - ${text}`);
      expect(JSON.stringify(error)).toBe('{}');
      expect(Object.keys(error)).toEqual([]);
    },
  );

  test('does not retry revision creation after an ambiguous network failure', async () => {
    const error = new TypeError('fetch failed');
    fetchMock.mockRejectedValueOnce(error);
    await expect(api.createFileRevision('a.seq', { ifMatch: etag })).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('readFile with file references', () => {
  let api: ActionsAPI;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    api = makeApi();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  test('paths and working-copy references read the current file', async () => {
    fetchMock.mockResolvedValueOnce(new Response('now')).mockResolvedValueOnce(new Response('now'));
    await expect(api.readFile('dir/a.seq')).resolves.toBe('now');
    await expect(api.readFile({ path: 'dir/a.seq' })).resolves.toBe('now');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://workspace.local/ws/42/dir%2Fa.seq',
      'http://workspace.local/ws/42/dir%2Fa.seq',
    ]);
  });

  test('a pinned reference reads that revision', async () => {
    fetchMock.mockResolvedValueOnce(new Response('then'));
    await expect(api.readFile({ path: 'dir/a.seq', revision: 'aa' })).resolves.toBe('then');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspace.local/versioning/42/dir%2Fa.seq?revision=aa');
  });

  test('the latest revision is forwarded as is, to be resolved by the server when the file is read', async () => {
    fetchMock.mockResolvedValueOnce(new Response('newest'));
    await expect(api.readFile({ path: 'dir/a.seq', revision: 'latest' })).resolves.toBe('newest');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('http://workspace.local/versioning/42/dir%2Fa.seq?revision=latest');
  });

  test('a missing pinned revision fails rather than falling back to the working copy', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"type":"NO_SUCH_REVISION"}', { status: 404 }));
    await expect(api.readFile({ path: 'a.seq', revision: 'zz' })).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

test('withRevision: true makes file and sequence parameters FileRefs', () => {
  const definitions = {
    config: { type: 'file', withRevision: true },
    input: { type: 'sequence', withRevision: true },
    inputs: { type: 'sequenceList', withRevision: true },
    files: { type: 'fileList', withRevision: true },
    plain: { type: 'file' },
    plainList: { type: 'sequenceList' },
  } as const;
  type Params = ActionParameters<typeof definitions>;
  expectTypeOf<Params['config']>().toEqualTypeOf<FileRef>();
  expectTypeOf<Params['input']>().toEqualTypeOf<FileRef>();
  expectTypeOf<Params['inputs']>().toEqualTypeOf<FileRef[]>();
  expectTypeOf<Params['files']>().toEqualTypeOf<FileRef[]>();
  expectTypeOf<Params['plain']>().toEqualTypeOf<string>();
  expectTypeOf<Params['plainList']>().toEqualTypeOf<string[]>();
});

test('allowWorkingCopy: false requires a revision on every FileRef', () => {
  const definitions = {
    allowed: { type: 'file', withRevision: true, allowWorkingCopy: true },
    allowedList: { type: 'fileList', withRevision: true, allowWorkingCopy: true },
    pinned: { type: 'file', withRevision: true, allowWorkingCopy: false },
    pinnedSequence: { type: 'sequence', withRevision: true, allowWorkingCopy: false },
    pinnedList: { type: 'sequenceList', withRevision: true, allowWorkingCopy: false },
    pinnedFiles: { type: 'fileList', withRevision: true, allowWorkingCopy: false },
    plain: { type: 'file', allowWorkingCopy: false },
  } as const satisfies ActionParameterDefinitions;
  type Params = ActionParameters<typeof definitions>;
  expectTypeOf<Params['allowed']>().toEqualTypeOf<FileRef>();
  expectTypeOf<Params['allowedList']>().toEqualTypeOf<FileRef[]>();
  expectTypeOf<Params['pinned']>().toEqualTypeOf<{ path: string; revision: string }>();
  expectTypeOf<Params['pinnedSequence']>().toEqualTypeOf<{ path: string; revision: string }>();
  expectTypeOf<Params['pinnedList']>().toEqualTypeOf<{ path: string; revision: string }[]>();
  expectTypeOf<Params['pinnedFiles']>().toEqualTypeOf<{ path: string; revision: string }[]>();
  expectTypeOf<Params['plain']>().toEqualTypeOf<string>();
});

test('File inputs with constant `withRevision: true` config provide FileRef value types', () => {
  // when options are declared with `as const`, TS knows it is *definitely true*
  // and provides the correct `FileRef` type to callers
  const options = { withRevision: true } as const;
  const definitions = {
    file: { type: 'file', ...options },
    files: { type: 'fileList', ...options },
    sequence: { type: 'sequence', ...options },
    sequences: { type: 'sequenceList', ...options },
  } as const satisfies ActionParameterDefinitions;

  expectTypeOf<typeof definitions.file.withRevision>().toEqualTypeOf<true>();

  type Params = ActionParameters<typeof definitions>;
  expectTypeOf<Params['file']>().toEqualTypeOf<FileRef>();
  expectTypeOf<Params['files']>().toEqualTypeOf<FileRef[]>();
  expectTypeOf<Params['sequence']>().toEqualTypeOf<FileRef>();
  expectTypeOf<Params['sequences']>().toEqualTypeOf<FileRef[]>();
});

test('File inputs with constant `withRevision: false` config provide string value types', () => {
  // similarly, when defined false with `as const`, we know to expect a string
  const options = { withRevision: false } as const;
  const definitions = {
    file: { type: 'file', ...options },
    files: { type: 'fileList', ...options },
    sequence: { type: 'sequence', ...options },
    sequences: { type: 'sequenceList', ...options },
  } as const satisfies ActionParameterDefinitions;

  expectTypeOf<typeof definitions.file.withRevision>().toEqualTypeOf<false>();

  type Params = ActionParameters<typeof definitions>;
  expectTypeOf<Params['file']>().toEqualTypeOf<string>();
  expectTypeOf<Params['files']>().toEqualTypeOf<string[]>();
  expectTypeOf<Params['sequence']>().toEqualTypeOf<string>();
  expectTypeOf<Params['sequences']>().toEqualTypeOf<string[]>();
});

test('File inputs with a widened withRevision boolean preserves both possible parameter types', () => {
  // Mutable object properties get widened to `boolean`, even when initialized to true.
  // as a result, TS can't tell that this has `withRevision: true` set and can't tell callers
  // to expect a FileRef object. Fallback to the union of FileRef | string
  const options = { withRevision: true };
  const definitions = {
    file: { type: 'file', ...options },
    files: { type: 'fileList', ...options },
    sequence: { type: 'sequence', ...options },
    sequences: { type: 'sequenceList', ...options },
  } as const satisfies ActionParameterDefinitions;

  expectTypeOf<typeof definitions.file.withRevision>().toEqualTypeOf<boolean>();

  type Params = ActionParameters<typeof definitions>;
  expectTypeOf<Params['file']>().toEqualTypeOf<FileRef | string>();
  expectTypeOf<Params['files']>().toEqualTypeOf<FileRef[] | string[]>();
  expectTypeOf<Params['sequence']>().toEqualTypeOf<FileRef | string>();
  expectTypeOf<Params['sequences']>().toEqualTypeOf<FileRef[] | string[]>();
});

test('File inputs which omit withRevision default to paths', () => {
  const definitions = {
    file: { type: 'file' },
    files: { type: 'fileList' },
    sequence: { type: 'sequence' },
    sequences: { type: 'sequenceList' },
  } as const satisfies ActionParameterDefinitions;

  type Params = ActionParameters<typeof definitions>;
  expectTypeOf<Params['file']>().toEqualTypeOf<string>();
  expectTypeOf<Params['files']>().toEqualTypeOf<string[]>();
  expectTypeOf<Params['sequence']>().toEqualTypeOf<string>();
  expectTypeOf<Params['sequences']>().toEqualTypeOf<string[]>();
});

test('defineParameters preserves inline flags without as const', () => {
  const definitions = defineParameters({
    file: { type: 'file', withRevision: true },
    files: { type: 'fileList', withRevision: true },
    sequence: { type: 'sequence', withRevision: true },
    sequences: { type: 'sequenceList', withRevision: true },
    path: { type: 'file' },
    pinned: { type: 'file', withRevision: true, allowWorkingCopy: false },
  });

  expectTypeOf<typeof definitions.file.withRevision>().toEqualTypeOf<true>();

  type Params = ActionParameters<typeof definitions>;
  expectTypeOf<Params['file']>().toEqualTypeOf<FileRef>();
  expectTypeOf<Params['files']>().toEqualTypeOf<FileRef[]>();
  expectTypeOf<Params['sequence']>().toEqualTypeOf<FileRef>();
  expectTypeOf<Params['sequences']>().toEqualTypeOf<FileRef[]>();
  expectTypeOf<Params['path']>().toEqualTypeOf<string>();
  expectTypeOf<Params['pinned']>().toEqualTypeOf<Required<FileRef>>();
});
