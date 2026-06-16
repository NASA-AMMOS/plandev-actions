import type { ActionsAPI } from '../index';

// parameter/setting schema types
export * from './schema';

export type ActionResult = {
  status: 'FAILED' | 'SUCCESS';
  data: any;
  /**
   * Optional human-facing summary, written in Markdown, rendered in the action
   * run's "Report" block in the UI (above the raw Results). Use this for the
   * legible, click-through output a person reads — links, tables, formatted text.
   *
   * Supported: headings, bold/italic/strikethrough, inline code & code blocks,
   * lists, tables, blockquotes, horizontal rules, hyperlinks, and inline text
   * color via `<span style="color: ...">` (only `color`/`background-color`, with
   * validated color values). The UI sanitizes this content: scripts, event
   * handlers, images, video, iframes, other raw HTML, and any other CSS are
   * stripped.
   */
  report?: string;
  [key: string]: any;
};

export type ActionMain = (
  // Parameters and settings are user-defined
  actionParameters: { [key: string]: any },
  actionSettings: { [key: string]: any },
  actionsAPI: ActionsAPI,
) => Promise<ActionResult>;

export type UserRole = string | 'aerie_admin';

export type ActionsConfig = {
  ACTION_RUN_ID?: string;
  ACTION_FILE_STORE: string;
  SEQUENCING_FILE_STORE: string;
  WORKSPACE_BASE_URL: string;
  SECRETS?: Record<string, string>;
  USER_ROLE?: string;
  USERNAME?: string;
};
