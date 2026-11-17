import type { Page } from '@playwright/test';
import type { Archive } from '../../src/domain';

/**
 * The saved workspace as the app would load it. Designer edits are saved in a separate draft until the playground is
 * shown again, so the drafted components are applied over their project here.
 */
export function savedWorkspace(page: Page): Promise<Archive> {
  return page.evaluate(() => {
    const archive = JSON.parse(localStorage.getItem('tablecraft.workspace.v1')!) as Archive;
    const draft = JSON.parse(localStorage.getItem('tablecraft.design-draft.v1') ?? 'null') as
      { projectId: string; edits: { component: Archive['projects'][number]['components'][number] }[] } | null;
    const project = draft && archive.projects.find(item => item.id === draft.projectId);
    if (draft && project) for (const { component } of draft.edits) {
      const index = project.components.findIndex(item => item.id === component.id);
      if (index < 0) project.components.push(component); else project.components[index] = component;
    }
    return archive;
  });
}
