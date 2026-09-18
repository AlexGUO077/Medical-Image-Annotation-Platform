export interface AppRoute {
  path: string;
  label: string;
  implementationWorkPackage: string;
}

export const appRoutes: readonly AppRoute[] = [
  { path: '/login', label: '登录', implementationWorkPackage: 'WP-02' },
  { path: '/tasks', label: '任务列表', implementationWorkPackage: 'WP-06' },
  { path: '/workbench/:caseId', label: '标注工作台', implementationWorkPackage: 'WP-08' },
  { path: '/review/:caseId', label: '审核台', implementationWorkPackage: 'WP-11' },
  { path: '/cases/import', label: '病例录入', implementationWorkPackage: 'WP-05' },
  { path: '/cases/:id', label: '病例与临床信息', implementationWorkPackage: 'WP-05' },
  { path: '/library', label: '检索与归类', implementationWorkPackage: 'WP-12' },
  { path: '/dashboard', label: '统计看板', implementationWorkPackage: 'WP-13' },
  { path: '/admin', label: '系统管理', implementationWorkPackage: 'WP-15' },
];

const darkThemeRoutePattern = /^\/(?:workbench|review)\/[^/]+$/;

export function isDarkThemePath(pathname: string): boolean {
  return darkThemeRoutePattern.test(pathname);
}
