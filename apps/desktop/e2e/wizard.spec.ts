import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_ROOT } from './global-setup.js';

/**
 * Phase 4 acceptance, "wizard to chapter end to end": the story setup wizard creates a project
 * with defaults, the palette writes a whole chapter through the scripted model, the Author
 * accepts it, the chronicle update is proposed and applied, the summary is cached. Everything
 * runs in the browser against the dev bridge; the Tauri shell is the only piece not exercised.
 */
test.describe('wizard to chapter (browser, scripted model)', () => {
  test('new story → chapter → accept → chronicle → summary', async ({ page }) => {
    const root = path.join(E2E_ROOT, 'wizard-story');
    fs.rmSync(root, { recursive: true, force: true });
    await page.goto('/');

    // Welcome → New story → the wizard with its defaults.
    await page.getByRole('button', { name: /^(New story|Новая история)$/ }).click();
    await page.getByLabel(/^(Title|Название)/).fill('Штрек');
    await page.getByLabel(/^(Folder|Папка)/).fill(root);
    // Every other step keeps its defaults: Next until the summary offers to create the project.
    const next = page.getByRole('button', { name: /^(Next|Дальше)$/ });
    const create = page.getByRole('button', { name: /^(Create project|Создать проект)$/ });
    for (let i = 0; i < 14 && !(await create.isVisible()); i += 1) {
      await next.click();
      await page.waitForTimeout(150);
    }
    await expect(create).toBeVisible();
    await create.click();

    // The project is open: the tree, the title, project.yaml on disk with the defaults.
    const tree = page.getByRole('navigation', { name: /Project tree|Дерево проекта/ });
    await expect(tree).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => fs.existsSync(path.join(root, 'project.yaml')), { timeout: 15_000 }).toBe(true);
    const projectYaml = fs.readFileSync(path.join(root, 'project.yaml'), 'utf8');
    expect(projectYaml).toContain('storyteller: cassandra');
    expect(projectYaml).toContain('harshness: 3');

    // Write a whole chapter from the palette (plan + prose, both from the scripted model).
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('combobox');
    await palette.fill('new chapter');
    await palette.press('Enter');
    const titleField = page.getByLabel(/Chapter title|Название главы/);
    await expect(titleField).toBeVisible({ timeout: 10_000 });
    await titleField.fill('Фары');
    await titleField.press('Enter');

    const accept = page.getByRole('button', { name: /^(Accept|Принять)$/ });
    await expect(accept).toBeVisible({ timeout: 90_000 });
    const chapterCount = () => (fs.existsSync(path.join(root, 'chapters')) ? fs.readdirSync(path.join(root, 'chapters')).length : 0);
    expect(chapterCount()).toBe(0);
    await accept.click();
    await expect.poll(chapterCount, { timeout: 30_000 }).toBe(1);
    const chapterFile = path.join(root, 'chapters', fs.readdirSync(path.join(root, 'chapters'))[0]!);
    expect(fs.readFileSync(chapterFile, 'utf8')).toContain('title: Фары');

    // The chronicle offer after the accept → the dialog → Apply → the summary.
    await page.getByRole('button', { name: /^(Update|Обновить)$/ }).click();
    const apply = page.getByRole('button', { name: /^(Apply|Применить)$/ });
    await expect(apply).toBeVisible({ timeout: 60_000 });
    await apply.click();
    await expect.poll(() => fs.readFileSync(path.join(root, 'chronicle', 'state.yaml'), 'utf8'), { timeout: 30_000 }).toContain('last_chapter: 1');
    expect(fs.readFileSync(path.join(root, 'chronicle', 'chronicle.md'), 'utf8')).toMatch(/## (Глава|Chapter) 1/);
    const summarize = page.getByRole('button', { name: /^(Summarize|Суммировать)$/ });
    await expect(summarize).toBeVisible({ timeout: 15_000 });
    await summarize.click();
    await expect.poll(() => fs.existsSync(path.join(root, 'chronicle', 'summaries')) && fs.readdirSync(path.join(root, 'chronicle', 'summaries')).length, { timeout: 30_000 }).toBe(1);

    // The beat sheet was stored, the d20 was not rolled (Cassandra), the key never touched the disk.
    expect(fs.existsSync(path.join(root, 'plan', 'beats', '01.json'))).toBe(true);
    const state = fs.readFileSync(path.join(root, 'chronicle', 'state.yaml'), 'utf8');
    expect(state).toContain('rolls: []');
    const calls = fs.readFileSync(path.join(root, 'history', 'calls.jsonl'), 'utf8');
    expect(calls).toContain('"task":"plan.chapter"');
    expect(calls).toContain('"task":"write.chapter"');
    expect(calls).toContain('"task":"chronicle.propose"');
    expect(calls).not.toMatch(/sk-ant-/);
  });
});
