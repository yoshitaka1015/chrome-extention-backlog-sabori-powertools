export interface BacklogIssueLite {
  id: number;
  issueKey: string;
  summary: string;
  description: string;
  status: string;
  statusId: number | null;
  projectId: number;
  projectName: string;
  categoryName: string | null;
  dueDate: string | null;
  created: string;
  url: string;
}

export interface BacklogStatusLite {
  id: number;
  name: string;
  displayOrder: number;
}

export interface BacklogProjectStatuses {
  projectId: number;
  statuses: BacklogStatusLite[];
}

export interface BacklogCategoryLite {
  id: number;
  name: string;
}

export interface BacklogProjectCategoryMap {
  projectId: number;
  categories: BacklogCategoryLite[];
}

export interface BacklogUserLite {
  id: number;
  name: string;
}

export interface BacklogIssueTypeLite {
  id: number;
  name: string;
  color?: string;
}

export interface BacklogProjectIssueTypeMap {
  projectId: number;
  issueTypes: BacklogIssueTypeLite[];
}

export interface BacklogIssueBuckets {
  past: BacklogIssueLite[];
  today: BacklogIssueLite[];
  thisWeek: BacklogIssueLite[];
  noDue: BacklogIssueLite[];
  statuses: BacklogProjectStatuses[];
  fetchedAt: string;
  stale?: boolean;
  errorCode?: "missing-config" | "permission-denied" | "request-denied" | "network-error";
  errorMessage?: string;
}
