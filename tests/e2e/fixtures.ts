import { expect, type BrowserContext, type Page } from '@playwright/test';

export interface MockLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}
export interface MockIssue {
  id: number;
  node_id: string;
  number: number;
  html_url: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  state_reason?: string | null;
  labels: MockLabel[];
  created_at: string;
  updated_at: string;
  pull_request?: object;
}
export interface MockGitHubState {
  issues: MockIssue[];
  labels: MockLabel[];
  dropNextCreateResponse: boolean;
  failNextDeleteIssue: boolean;
  writes: { method: string; path: string; body: Record<string, unknown> | null }[];
  requests: { method: string; path: string }[];
}
export const mockLabels: MockLabel[] = [
  { id: 11, name: 'Ideas', color: 'b1c6b0', description: null },
  { id: 12, name: 'Personal', color: 'dec8a7', description: null },
];
export function mockIssue(
  number: number,
  title: string,
  markdown = 'A thought worth keeping.',
  metadata: Record<string, unknown> = {},
  patch: Partial<MockIssue> = {},
): MockIssue {
  const meta = {
    schemaVersion: 1,
    id: `16f66da6-2d3a-4f05-a21b-${String(number).padStart(12, '0')}`,
    kind: 'markdown',
    color: 'default',
    pinned: false,
    trashedAt: null,
    ...metadata,
  };
  return {
    id: 1000 + number,
    node_id: `I_test${number}`,
    number,
    html_url: `https://github.com/scarletkc/Tebikae-dev/issues/${number}`,
    title,
    body: `<!-- issue-notes\n${JSON.stringify(meta)}\n-->\n\n${markdown}`,
    state: 'open',
    labels: [],
    created_at: '2026-09-10T08:00:00Z',
    updated_at: '2026-09-16T08:00:00Z',
    ...patch,
  };
}
export function standardIssues(): MockIssue[] {
  return [
    mockIssue(
      1,
      'Weekend ideas',
      'Visit the bookshop.\n\nKeep a slow Sunday.',
      { color: 'yellow' },
      { labels: [...mockLabels] },
    ),
    mockIssue(
      2,
      'A little checklist',
      '- [ ] Buy tea\n- [x] Read a chapter',
      { kind: 'checklist', color: 'green' },
      { labels: [mockLabels[0]!] },
    ),
    mockIssue(3, 'A finished thought', 'Saved for later.', {}, { state: 'closed' }),
    mockIssue(4, 'An ordinary Issue', 'This stays untouched.', {}, { body: 'This stays untouched.' }),
    mockIssue(5, 'Hidden pull request', 'Not a note.', {}, { pull_request: {} }),
  ];
}
export async function mockGitHub(
  context: BrowserContext,
  seed: MockIssue[] = standardIssues(),
): Promise<MockGitHubState> {
  const state: MockGitHubState = {
    issues: structuredClone(seed),
    labels: structuredClone(mockLabels),
    writes: [],
    requests: [],
    dropNextCreateResponse: false,
    failNextDeleteIssue: false,
  };
  let clock = Date.parse('2026-09-16T09:00:00Z');
  await context.route('https://api.github.com/**', async (route) => {
    const request = route.request(),
      method = request.method(),
      url = new URL(request.url()),
      path = url.pathname;
    state.requests.push({ method, path });
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'content-type': 'application/json',
    };
    const send = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
      route.fulfill({ status, headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return send(null, 200);
    if (request.headers().authorization !== 'Bearer browser-test-token')
      return send({ message: 'Bad credentials' }, 401);
    const payload = request.postData() ? (request.postDataJSON() as Record<string, unknown>) : null;
    if (method !== 'GET') state.writes.push({ method, path, body: payload });
    if (path === '/user') return send({ id: 1, login: 'scarletkc' });
    if (path === '/graphql') {
      const query = String(payload?.query || '');
      const issueId = String(
        (payload?.variables as { input?: { issueId?: string } } | null)?.input?.issueId || '',
      );
      if (!query.includes('deleteIssue')) return send({ message: 'Unexpected GraphQL operation' }, 400);
      if (state.failNextDeleteIssue) {
        state.failNextDeleteIssue = false;
        return send({ errors: [{ type: 'NETWORK', message: 'deletion failed' }], data: null });
      }
      const nodeId = String(issueId);
      const before = state.issues.length;
      state.issues = state.issues.filter((issue) => issue.node_id !== nodeId);
      if (state.issues.length === before) return send({ errors: [{ type: 'NOT_FOUND' }], data: null });
      return send({ data: { deleteIssue: { clientMutationId: null } } });
    }
    if (path === '/repos/scarletkc/Tebikae-dev')
      return send({
        id: 2,
        name: 'Tebikae-dev',
        owner: { id: 1, login: 'scarletkc', type: 'User' },
        private: true,
        archived: false,
        has_issues: true,
        permissions: { push: true },
      });
    if (path === '/repos/scarletkc/Tebikae-dev/labels') {
      if (method === 'POST') {
        const label = {
          id: 20 + state.labels.length,
          name: String(payload?.name),
          color: String(payload?.color ?? '888888'),
          description: typeof payload?.description === 'string' ? payload.description : null,
        };
        state.labels.push(label);
        return send(label, 201);
      }
      return send(state.labels);
    }
    const labelMatch = /^\/repos\/scarletkc\/Tebikae-dev\/labels\/(.+)$/u.exec(path);
    if (labelMatch) {
      const label = state.labels.find((l) => l.name === decodeURIComponent(labelMatch[1]!));
      if (!label) return send({ message: 'Not found' }, 404);
      if (method === 'DELETE') {
        state.labels = state.labels.filter((l) => l.id !== label.id);
        for (const issue of state.issues) issue.labels = issue.labels.filter((l) => l.id !== label.id);
        return route.fulfill({ status: 204, headers });
      }
      if (method === 'PATCH') {
        if (typeof payload?.new_name === 'string') label.name = payload.new_name;
        if (typeof payload?.color === 'string') label.color = payload.color;
        for (const issue of state.issues)
          issue.labels = issue.labels.map((l) => (l.id === label.id ? { ...label } : l));
        return send(label);
      }
    }
    const match = /^\/repos\/scarletkc\/Tebikae-dev\/issues(?:\/(\d+))?(?:\/labels(?:\/(.*))?)?$/u.exec(path);
    if (!match) return send({ message: 'Unexpected mocked endpoint' }, 404);
    const number = match[1] ? Number(match[1]) : undefined;
    if (number === undefined) {
      if (method === 'POST') {
        const next = Math.max(0, ...state.issues.map((issue) => issue.number)) + 1;
        const issue = mockIssue(
          next,
          String(payload?.title),
          '',
          {},
          {
            body: String(payload?.body),
            labels: state.labels.filter((label) =>
              (payload?.labels as string[] | undefined)?.includes(label.name),
            ),
            updated_at: new Date(++clock).toISOString(),
          },
        );
        state.issues.push(issue);
        if (state.dropNextCreateResponse) {
          state.dropNextCreateResponse = false;
          return route.abort('failed');
        }
        return send(issue, 201);
      }
      const sorted = [...state.issues].sort((a, b) =>
        url.searchParams.get('sort') === 'updated'
          ? b.updated_at.localeCompare(a.updated_at)
          : a.number - b.number,
      );
      const since = url.searchParams.get('since');
      const values = since
        ? sorted.filter((issue) => Date.parse(issue.updated_at) >= Date.parse(since))
        : sorted;
      const perPage = Number(url.searchParams.get('per_page') ?? 100),
        page = Number(url.searchParams.get('page') ?? 1);
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      const extra: Record<string, string> =
        values.length > page * perPage ? { link: `<${next.href}>; rel="next"` } : {};
      return send(values.slice((page - 1) * perPage, page * perPage), 200, extra);
    }
    const issue = state.issues.find((item) => item.number === number);
    if (!issue) return send({ message: 'Not Found' }, 404);
    if (path.includes('/labels')) {
      if (method === 'POST')
        issue.labels = [
          ...new Map(
            [
              ...issue.labels,
              ...state.labels.filter((label) => (payload?.labels as string[]).includes(label.name)),
            ].map((label) => [label.id, label]),
          ).values(),
        ];
      if (method === 'DELETE')
        issue.labels = issue.labels.filter((label) => label.name !== decodeURIComponent(match[2]!));
      issue.updated_at = new Date(++clock).toISOString();
      return send(issue.labels);
    }
    if (method === 'PATCH') {
      if (typeof payload?.title === 'string') issue.title = payload.title;
      if (typeof payload?.body === 'string') issue.body = payload.body;
      if (payload?.state === 'open' || payload?.state === 'closed') issue.state = payload.state;
      if (typeof payload?.state_reason === 'string') issue.state_reason = payload.state_reason;
      issue.updated_at = new Date(++clock).toISOString();
    }
    return send(issue);
  });
  return state;
}
export async function connect(page: Page, remember = true): Promise<void> {
  await page.goto('/');
  await page.getByLabel('GitHub repository', { exact: true }).fill('scarletkc/Tebikae-dev');
  await page.getByLabel('Personal access token', { exact: true }).fill('browser-test-token');
  await expect(
    page.getByRole('checkbox', { name: 'Remember this connection in this browser' }),
  ).not.toBeChecked();
  if (remember)
    await page.getByRole('checkbox', { name: 'Remember this connection in this browser' }).check();
  await page.getByRole('button', { name: 'Connect repository', exact: true }).click();
  await expect(
    page
      .getByRole('searchbox', { name: 'Search your notes' })
      .or(page.getByLabel('Search your notes', { exact: true })),
  ).toBeVisible();
  await expect(page.locator('.workspace-status')).toHaveAttribute('data-loading', 'false', {
    timeout: 20_000,
  });
}
export async function closeDialog(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
