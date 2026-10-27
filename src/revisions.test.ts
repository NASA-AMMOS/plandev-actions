import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  ActionsAPI,
  type ActionsConfig,
  type CreateFileRevisionOptions,
  type FileRevision,
  type RevisionWriteOptions,
} from './index';

const etag = '"current-content-hash"';
const savedEtag = '"saved-content-hash"';
const revision: FileRevision = {
  name: 'aa',
  fileId: '842415fa-48e5-4c89-a4d3-92515837b326',
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

  test.each([[], [revision]])('preserves a null match independently of the revision list (%j)', async revisions => {
    const listing = { revisions, matchingRevision: null };
    fetchMock.mockResolvedValueOnce(Response.json(listing));
    await expect(api.listFileRevisions('a.seq')).resolves.toEqual(listing);
  });

  test('historical content may be empty and the path and revision are encoded separately', async () => {
    fetchMock.mockResolvedValueOnce(new Response(''));
    await expect(api.readFileRevision('folder/a #?.seq', 'a&revision=b')).resolves.toBe('');
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
